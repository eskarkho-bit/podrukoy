import { logger } from 'firebase-functions';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// Привязка карты мастера.
//
// Главное свойство схемы: **номер карты не проходит через наше приложение и
// не попадает в нашу базу**. Мастер вводит его на странице банка, оттуда
// возвращается только токен способа оплаты и маска вида «•••• 4242». Иначе мы
// хранили бы платёжные данные и подпадали под PCI-DSS со всеми вытекающими.
//
// Провайдер — ЮKassa. Всё общение с ним заперто в этом файле: чтобы перейти
// на CloudPayments или Тинькофф, переписывается только он.
//
// Ключи берутся из окружения (functions/.env, см. .env.example). Для боевой
// эксплуатации их стоит перенести в Secret Manager — переменные окружения
// видны всем, у кого есть доступ к проекту.

const API = 'https://api.yookassa.ru/v3';

// Списываем рубль и тут же возвращаем: банк подтверждает, что карта живая и
// принадлежит человеку, а мастер ничего не теряет
const HOLD_AMOUNT = '1.00';

// Сколько попыток привязки разрешаем и как часто. Без этого функцию можно
// вызывать в цикле, штампуя платежи в кабинете провайдера.
const MAX_BINDING_ATTEMPTS = 10;
const BINDING_COOLDOWN_MS = 30_000;

type Credentials = { auth: string };

function credentials(): Credentials | null {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) return null;
  return { auth: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}` };
}

async function call(
  creds: Credentials,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotenceKey?: string },
): Promise<Record<string, any>> {
  // Ключ идемпотентности обязан быть постоянным для одной и той же операции.
  // Раньше здесь стоял randomUUID() — и повторная доставка вебхука (а она
  // штатная: провайдер повторяет при любом не-200) выполняла второй возврат.
  if (init.method === 'POST' && !init.idempotenceKey) {
    throw new Error('POST к провайдеру без ключа идемпотентности');
  }

  const res = await fetch(`${API}${path}`, {
    method: init.method,
    headers: {
      Authorization: creds.auth,
      'Content-Type': 'application/json',
      ...(init.idempotenceKey ? { 'Idempotence-Key': init.idempotenceKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // В теле ответа могут быть данные платежа — в лог уходят только код
    // ошибки и путь
    logger.error('ЮKassa вернула ошибку', {
      path,
      status: res.status,
      code: (json as { code?: string }).code ?? null,
    });
    throw new Error(`yookassa ${res.status}`);
  }
  return json as Record<string, any>;
}

/**
 * Начинает привязку: создаёт платёж на рубль с сохранением способа оплаты и
 * возвращает адрес страницы банка. Карту вводит мастер, там же, а не у нас.
 */
export const createCardBinding = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Нужен вход');

  const creds = credentials();
  // Честный ответ вместо непонятной ошибки: приложение покажет «привязка
  // пока недоступна», а не «что-то пошло не так»
  if (!creds) return { configured: false };

  // Счётчик попыток живёт в самой заявке и пишется только отсюда: правила
  // Firestore мастеру эти поля не отдают
  const db = getFirestore();
  const ref = db.doc(`masters/${uid}/verification/application`);
  const snap = await ref.get();
  const attempts: number = snap.get('bindingAttempts') ?? 0;
  const lastAt: number = snap.get('lastBindingAt')?.toMillis?.() ?? 0;

  if (attempts >= MAX_BINDING_ATTEMPTS) {
    throw new HttpsError('resource-exhausted', 'Слишком много попыток привязки. Напишите в поддержку');
  }
  if (Date.now() - lastAt < BINDING_COOLDOWN_MS) {
    throw new HttpsError('resource-exhausted', 'Подождите полминуты перед следующей попыткой');
  }

  await ref.set({
    bindingAttempts: FieldValue.increment(1),
    lastBindingAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const payment = await call(creds, '/payments', {
    method: 'POST',
    // Ключ привязан к попытке: двойной вызов подряд вернёт тот же платёж,
    // а не создаст второй
    idempotenceKey: `bind-${uid}-${attempts + 1}`,
    body: {
      amount: { value: HOLD_AMOUNT, currency: 'RUB' },
      capture: true,
      save_payment_method: true,
      description: 'Подтверждение личности мастера «Подрукой»',
      confirmation: { type: 'redirect', return_url: 'podrukoy://card-bound' },
      metadata: { uid, purpose: 'master-verification' },
    },
  });

  const confirmationUrl = payment.confirmation?.confirmation_url;
  if (!confirmationUrl) throw new HttpsError('internal', 'Провайдер не вернул адрес оплаты');

  return { configured: true, confirmationUrl };
});

/**
 * Уведомление провайдера об оплате.
 *
 * Тело запроса не подписано, поэтому ему не верим ни на грамм: берём оттуда
 * только идентификатор и перечитываем платёж у самой ЮKassa. Подделать
 * привязку, отправив нам POST, так нельзя.
 */
export const yookassaWebhook = onRequest(async (req, res) => {
  const creds = credentials();
  if (!creds) {
    res.status(503).send('not configured');
    return;
  }

  const paymentId = req.body?.object?.id;
  if (typeof paymentId !== 'string') {
    res.status(400).send('bad request');
    return;
  }

  try {
    const payment = await call(creds, `/payments/${paymentId}`, { method: 'GET' });

    if (payment.status !== 'succeeded' || payment.metadata?.purpose !== 'master-verification') {
      res.status(200).send('ignored');
      return;
    }

    const uid = payment.metadata?.uid;
    const card = payment.payment_method?.card;
    const bindingId = payment.payment_method?.id;
    if (typeof uid !== 'string' || !bindingId) {
      res.status(200).send('ignored');
      return;
    }

    // Пишем через Admin SDK: правила запрещают мастеру трогать эти поля,
    // и в этом весь смысл — привязку подтверждает банк, а не приложение.
    // Запись идемпотентна сама по себе: те же значения, тот же документ.
    const ref = getFirestore().doc(`masters/${uid}/verification/application`);
    await ref.set({
      cardBindingId: bindingId,
      cardLast4: card?.last4 ?? null,
      cardBrand: card?.card_type ?? null,
      cardBoundAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Рубль возвращаем: он был нужен только чтобы банк подтвердил карту.
    // Два рубежа против повторного возврата при повторной доставке
    // уведомления — отметка в базе и постоянный ключ идемпотентности.
    const alreadyRefunded = (await ref.get()).get('refundedPaymentId') === paymentId;
    if (!alreadyRefunded) {
      try {
        await call(creds, '/refunds', {
          method: 'POST',
          idempotenceKey: `refund-${paymentId}`,
          body: { payment_id: paymentId, amount: { value: HOLD_AMOUNT, currency: 'RUB' } },
        });
        await ref.set({ refundedPaymentId: paymentId }, { merge: true });
      } catch (e) {
        logger.warn('Не удалось вернуть рубль за привязку', e);
      }
    }

    res.status(200).send('ok');
  } catch (e) {
    logger.error('Ошибка обработки уведомления ЮKassa', e);
    // 500 заставит провайдера повторить попытку позже
    res.status(500).send('error');
  }
});
