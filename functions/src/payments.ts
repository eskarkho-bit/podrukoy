import { logger } from 'firebase-functions';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import {
  DocumentReference,
  FieldValue,
  getFirestore,
} from 'firebase-admin/firestore';
import { audit, SYSTEM } from './audit';

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
// Исход платежа приходит двумя путями — вебхуком и почасовой сверкой, — и оба
// сходятся в settleBinding(). Это сделано намеренно: два места, применяющие
// один и тот же исход, рано или поздно разойдутся в поведении, и разойдутся
// они на деньгах.
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

/** Состояние попытки привязки. Живёт в заявке на проверку. */
export type BindingState = 'pending' | 'succeeded' | 'canceled' | 'failed';

/** Чем закончилась попытка применить исход платежа. */
export type SettleResult =
  | 'settled'        // карта привязана
  | 'canceled'       // человек отказался или банк отклонил
  | 'still-pending'  // платёж ещё не завершён, придём позже
  | 'ignored'        // не наш платёж
  | 'not-configured';

type Credentials = { auth: string };

function credentials(): Credentials | null {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) return null;
  return { auth: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}` };
}

/** Ошибка провайдера с кодом ответа — по нему решаем, повторять ли. */
class ProviderError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(`yookassa ${status}`);
  }
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

  // Без таймаута зависший провайдер держит функцию до её собственного предела
  // и съедает весь бюджет прогона сверки
  const res = await fetch(`${API}${path}`, {
    method: init.method,
    signal: AbortSignal.timeout(15_000),
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
    const code = (json as { code?: string }).code ?? null;
    logger.error('ЮKassa вернула ошибку', { path, status: res.status, code });
    throw new ProviderError(res.status, code);
  }
  return json as Record<string, any>;
}

const applicationRef = (uid: string): DocumentReference =>
  getFirestore().doc(`masters/${uid}/verification/application`);

/**
 * Возвращает удержанный рубль.
 *
 * Три рубежа против повторного возврата: отметка в базе, постоянный ключ
 * идемпотентности и проверка перед вызовом. При неудаче ставится флаг
 * refundPending — сверка вернётся к этому платежу в следующий прогон.
 * Деньги, зависшие у провайдера, — единственное здесь, что нельзя простить.
 */
async function refundHold(
  creds: Credentials,
  paymentId: string,
  ref: DocumentReference | null,
  correlationId: string,
  uid: string,
): Promise<void> {
  if (ref) {
    const snap = await ref.get();
    if (snap.exists && snap.get('refundedPaymentId') === paymentId) return;
  }

  try {
    await call(creds, '/refunds', {
      method: 'POST',
      idempotenceKey: `refund-${paymentId}`,
      body: { payment_id: paymentId, amount: { value: HOLD_AMOUNT, currency: 'RUB' } },
    });
    if (ref) {
      await ref.set({
        refundedPaymentId: paymentId,
        refundPending: false,
      }, { merge: true });
    }
    await audit({
      action: 'binding.refunded',
      actor: SYSTEM,
      subject: { type: 'payment', id: paymentId },
      correlationId,
      details: { uid },
    });
  } catch (e) {
    // Заявка могла исчезнуть вместе с аккаунтом — тогда пометить некуда,
    // и остаётся только журнал
    if (ref) {
      await ref.set({
        refundPending: true,
        refundPendingPaymentId: paymentId,
      }, { merge: true }).catch(() => {});
    }
    await audit({
      action: 'binding.refund_failed',
      actor: SYSTEM,
      subject: { type: 'payment', id: paymentId },
      correlationId,
      details: { uid, status: e instanceof ProviderError ? e.status : 0 },
    });
    logger.error('Не удалось вернуть рубль за привязку', { paymentId, uid });
  }
}

/**
 * Применяет исход платежа.
 *
 * Единственное место, где привязка становится состоявшейся. Вызывается из
 * вебхука и из сверки — поведение обязано быть одинаковым, иначе платёж,
 * пришедший разными путями, оставит разное состояние.
 *
 * Идемпотентна: повторный вызов с тем же платежом ничего не меняет.
 */
export async function settleBinding(
  paymentId: string,
  correlationId: string,
): Promise<SettleResult> {
  const creds = credentials();
  if (!creds) return 'not-configured';

  const payment = await call(creds, `/payments/${paymentId}`, { method: 'GET' });

  // Чужой платёж или платёж не за привязку — не наше дело
  if (payment.metadata?.purpose !== 'master-verification') return 'ignored';
  const uid = payment.metadata?.uid;
  if (typeof uid !== 'string' || !uid) return 'ignored';

  const ref = applicationRef(uid);
  const snap = await ref.get();
  // Заявка могла исчезнуть вместе с аккаунтом, пока платёж шёл. Записывать
  // некуда, но деньги вернуть всё равно обязаны.
  const target = snap.exists ? ref : null;

  if (payment.status === 'pending' || payment.status === 'waiting_for_capture') {
    return 'still-pending';
  }

  if (payment.status === 'canceled') {
    if (target) {
      await target.set({
        bindingState: 'canceled',
        bindingSettledAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await audit({
      action: 'binding.canceled',
      actor: SYSTEM,
      subject: { type: 'payment', id: paymentId },
      correlationId,
      details: { uid, reason: String(payment.cancellation_details?.reason ?? 'unknown') },
    });
    return 'canceled';
  }

  if (payment.status !== 'succeeded') {
    logger.warn('Неизвестный статус платежа', { paymentId, status: payment.status });
    return 'still-pending';
  }

  const bindingId = payment.payment_method?.id;
  const card = payment.payment_method?.card;

  if (!bindingId) {
    // Оплата прошла, но способ оплаты не сохранён — привязки не получилось.
    // Рубль всё равно возвращаем.
    if (target) {
      await target.set({
        bindingState: 'failed',
        bindingError: 'no-payment-method',
        bindingSettledAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await audit({
      action: 'binding.failed',
      actor: SYSTEM,
      subject: { type: 'payment', id: paymentId },
      correlationId,
      details: { uid, reason: 'no-payment-method' },
    });
    await refundHold(creds, paymentId, target, correlationId, uid);
    return 'canceled';
  }

  if (target) {
    // Пишем через Admin SDK: правила запрещают мастеру трогать эти поля,
    // и в этом весь смысл — привязку подтверждает банк, а не приложение.
    // Запись идемпотентна сама по себе: те же значения, тот же документ.
    await target.set({
      cardBindingId: bindingId,
      cardLast4: card?.last4 ?? null,
      cardBrand: card?.card_type ?? null,
      cardBoundAt: FieldValue.serverTimestamp(),
      bindingState: 'succeeded' satisfies BindingState,
      bindingError: null,
      bindingSettledAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await audit({
      action: 'binding.settled',
      actor: SYSTEM,
      subject: { type: 'master', id: uid },
      correlationId,
      details: { paymentId, hasCard: !!card?.last4 },
    });
  }

  await refundHold(creds, paymentId, target, correlationId, uid);
  return 'settled';
}

/** Повторяет возврат, застрявший в прошлый раз. Вызывается сверкой. */
export async function retryPendingRefund(
  uid: string,
  paymentId: string,
  correlationId: string,
): Promise<void> {
  const creds = credentials();
  if (!creds) return;
  await refundHold(creds, paymentId, applicationRef(uid), correlationId, uid);
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
  const ref = applicationRef(uid);
  const snap = await ref.get();
  const attempts: number = snap.get('bindingAttempts') ?? 0;
  const lastAt: number = snap.get('lastBindingAt')?.toMillis?.() ?? 0;

  if (snap.get('cardBindingId')) {
    // Карта уже привязана — второй платёж не нужен
    return { configured: true, alreadyBound: true };
  }
  if (attempts >= MAX_BINDING_ATTEMPTS) {
    throw new HttpsError(
      'resource-exhausted',
      'Слишком много попыток привязки. Напишите в поддержку',
    );
  }
  if (Date.now() - lastAt < BINDING_COOLDOWN_MS) {
    throw new HttpsError('resource-exhausted', 'Подождите полминуты перед следующей попыткой');
  }

  const attempt = attempts + 1;
  await ref.set({
    bindingAttempts: FieldValue.increment(1),
    lastBindingAt: FieldValue.serverTimestamp(),
    bindingState: 'pending' satisfies BindingState,
    bindingError: null,
  }, { merge: true });

  let payment: Record<string, any>;
  try {
    payment = await call(creds, '/payments', {
      method: 'POST',
      // Ключ привязан к попытке: двойной вызов подряд вернёт тот же платёж,
      // а не создаст второй
      idempotenceKey: `bind-${uid}-${attempt}`,
      body: {
        amount: { value: HOLD_AMOUNT, currency: 'RUB' },
        capture: true,
        save_payment_method: true,
        description: 'Подтверждение личности мастера «Подрукой»',
        confirmation: { type: 'redirect', return_url: 'podrukoy://card-bound' },
        metadata: { uid, purpose: 'master-verification' },
      },
    });
  } catch (e) {
    // Платёж не создан — состояние не должно остаться «ждём», иначе сверка
    // будет ходить за платежом, которого нет
    await ref.set({
      bindingState: 'failed' satisfies BindingState,
      bindingError: 'provider-unavailable',
    }, { merge: true });
    await audit({
      action: 'binding.failed',
      actor: { type: 'user', uid },
      subject: { type: 'master', id: uid },
      correlationId: `bind-${uid}-${attempt}`,
      details: { reason: 'provider-unavailable', attempt },
    });
    throw new HttpsError('unavailable', 'Банк не отвечает. Попробуйте позже');
  }

  const confirmationUrl = payment.confirmation?.confirmation_url;
  const paymentId = payment.id;

  if (!confirmationUrl || typeof paymentId !== 'string') {
    await ref.set({
      bindingState: 'failed' satisfies BindingState,
      bindingError: 'no-confirmation-url',
    }, { merge: true });
    throw new HttpsError('internal', 'Провайдер не вернул адрес оплаты');
  }

  // Идентификатор платежа обязателен: без него сверке нечего перечитывать,
  // и недоставленный вебхук означал бы навсегда потерянную привязку
  await ref.set({ bindingPaymentId: paymentId }, { merge: true });

  await audit({
    action: 'binding.started',
    actor: { type: 'user', uid },
    subject: { type: 'master', id: uid },
    correlationId: `bind-${uid}-${attempt}`,
    details: { paymentId, attempt },
  });

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
  const paymentId = req.body?.object?.id;
  if (typeof paymentId !== 'string') {
    res.status(400).send('bad request');
    return;
  }

  try {
    const result = await settleBinding(paymentId, `webhook-${paymentId}`);
    if (result === 'not-configured') {
      res.status(503).send('not configured');
      return;
    }
    res.status(200).send(result);
  } catch (e) {
    logger.error('Ошибка обработки уведомления ЮKassa', { paymentId, e });
    // 500 заставит провайдера повторить попытку позже. Повтор безопасен:
    // settleBinding идемпотентна.
    res.status(500).send('error');
  }
});
