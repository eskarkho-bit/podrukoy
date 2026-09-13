import { logger } from 'firebase-functions';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createHash, randomInt } from 'node:crypto';
import { audit } from './audit';
import { meterExceeded } from './meters';

// Вход по номеру телефона: свой одноразовый код, а не Firebase Phone Auth.
//
// Почему не встроенный: во-первых, вход по телефону в веб-SDK Firebase требует
// reCAPTCHA, а ей нужен DOM — в Expo-приложении без WebView его нет. Во-вторых,
// СМС от Google в российские сети доставляются плохо, а российский провайдер —
// надёжно и на порядок дешевле.
//
// Каналов доставки кода два, и по умолчанию — звонок: робот звонит на номер,
// кодом служат последние четыре цифры звонящего номера, отвечать не нужно.
// Звонок работает на любом аккаунте SMS.RU, а вот СМС требуют буквенного
// отправителя, которого оформляют только юрлицам и ИП по договору. Когда
// договор появится, канал переключается переменной SMSRU_CHANNEL=sms —
// без правки кода.
//
// Схема: requestPhoneCode доставляет код (звонком или СМС) и кладёт в базу
// его хэш; verifyPhoneCode сверяет код, находит или заводит аккаунт по номеру
// и возвращает custom-токен, которым клиент входит. Правила Firestore
// закрывают phoneCodes наглухо: узнать код можно только держа телефон в руках.
//
// Сам номер и сам код в базе не хранятся: документ называется хэшем номера и
// держит хэш кода. Утечка коллекции не даёт ни войти, ни узнать чей-то номер.
//
// Провайдер — SMS.RU. Всё общение с ним заперто в этом файле: чтобы перейти
// на SMSC или Твил, переписывается только он. Ключ — секрет SMSRU_API_ID в
// Secret Manager (firebase functions:secrets:set SMSRU_API_ID), а не
// переменная в functions/.env: переменные окружения видны всем, у кого есть
// доступ к проекту, секрет — только той функции, что его объявила. Пока
// ключа нет, requestPhoneCode честно отвечает «не настроено», и приложение
// не показывает вход по телефону как рабочий.
//
// В бою custom-токены подписывает сервисный аккаунт функций: ему нужна роль
// Service Account Token Creator (iam.serviceAccountTokenCreator) на самого
// себя. В эмуляторе токены не подписываются, роль не нужна.

const SMS_API = 'https://sms.ru/sms/send';
const CALL_API = 'https://sms.ru/code/call';

// Ключ провайдера объявлен секретом: в окружение функции он попадает только
// если перечислен в её secrets (см. requestPhoneCode), verifyPhoneCode его
// не получает — сверке кода провайдер не нужен. В тестах и в эмуляторе
// value() читает process.env, как обычную переменную.
const SMSRU_API_ID = defineSecret('SMSRU_API_ID');

export type CodeChannel = 'call' | 'sms';

const codeChannel = (): CodeChannel => (process.env.SMSRU_CHANNEL === 'sms' ? 'sms' : 'call');

// У звонка код назначает провайдер — четыре последние цифры номера;
// для СМС шестизначный код выбираем сами
const CODE_LENGTH: Record<CodeChannel, number> = { call: 4, sms: 6 };

// Код живёт недолго: перехватить его задним числом не выйдет
const CODE_TTL_MS = 5 * 60_000;

// Лимиты отправки. Без них функция — бесплатная СМС-пушка по любому номеру
// страны и способ выжечь баланс у провайдера.
const RESEND_COOLDOWN_MS = 60_000;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60_000;

// Попытки ввода. Шестизначный код — миллион вариантов; у четырёхзначного из
// звонка — десять тысяч, пять попыток дают шанс подбора один к двум тысячам
// при коде, живущем пять минут. Потом код сгорает.
const MAX_VERIFY_ATTEMPTS = 5;

// Неверные попытки копятся и через новые коды: пять на код, потом новый код
// и ещё пять — так подбор шёл бы бесконечно. Десять за час — и номер ждёт.
const MAX_FAILURES_PER_WINDOW = 10;
const FAILURE_WINDOW_MS = 60 * 60_000;

// Потолки поверх лимитов на номер. С одного адреса — чтобы один источник не
// выжигал баланс провайдера по списку чужих номеров; за адресом мобильного
// оператора сидят сотни людей, поэтому потолок не тесный. За день — общий на
// всех: исчерпан — вход по телефону до полуночи UTC недоступен. Это
// осознанно: дешевле, чем счёт за тысячи СМС, а с ростом сервиса число
// поднимается здесь.
const MAX_SENDS_PER_IP_PER_HOUR = 30;
const MAX_SENDS_PER_DAY = 300;

/** Мобильный номер РФ в том виде, в каком его шлёт клиент. */
const PHONE_RE = /^\+79\d{9}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Идентификатор документа с кодом — хэш номера, а не сам номер. */
export const phoneCodeDocId = (phone: string) => sha256(`phone:${phone}`).slice(0, 32);

// Хэш кода солится номером: одинаковый код у двух номеров даёт разные хэши
const codeHash = (phone: string, code: string) => sha256(`${phone}:${code}`);

// В журнал номер класть нельзя — он переживает удаление аккаунта. Хэш
// позволяет связать записи по одному номеру, не раскрывая его.
const phoneAuditId = (phone: string) => phoneCodeDocId(phone);

// Адрес в счётчике тоже хэшем: он персональные данные не хуже номера
const ipMeterKey = (ip: string) => `phoneIp-${sha256(`ip:${ip}`).slice(0, 16)}`;
const dayMeterKey = () => `phoneDay-${new Date().toISOString().slice(0, 10)}`;

/** Адрес вызывающего: за балансировщиком — первый в X-Forwarded-For. */
function callerIp(request: CallableRequest): string | undefined {
  const forwarded = request.rawRequest.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : (forwarded ?? '')).split(',')[0].trim();
  return first || request.rawRequest.ip || undefined;
}

function credentials(): { apiId: string } | null {
  const apiId = SMSRU_API_ID.value();
  return apiId ? { apiId } : null;
}

/**
 * Отправляет СМС через провайдера.
 *
 * POST, а не GET: номер телефона не должен оказаться в строке запроса —
 * URL попадают в логи промежуточных систем.
 */
async function sendSms(apiId: string, phone: string, text: string): Promise<void> {
  const to = phone.replace('+', '');
  const res = await fetch(SMS_API, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ api_id: apiId, to, msg: text, json: '1' }).toString(),
  });

  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    sms?: Record<string, { status?: string; status_code?: number; status_text?: string }>;
  };

  // Провайдер отвечает 200 даже на отказ — смотреть надо в статус по номеру
  const perNumber = json.sms?.[to];
  if (!res.ok || json.status !== 'OK' || perNumber?.status !== 'OK') {
    // Номера в логе нет — только коды и словесная причина провайдера
    logger.error('СМС не отправлена', {
      httpStatus: res.status,
      providerStatus: json.status ?? null,
      smsStatusCode: perNumber?.status_code ?? null,
      smsStatusText: perNumber?.status_text ?? null,
    });
    throw new Error('sms-provider-failed');
  }
}

/**
 * Заказывает звонок с кодом. Код — последние четыре цифры звонящего номера,
 * его назначает и возвращает провайдер, мы не выбираем. POST по той же
 * причине, что у СМС: номер не должен оказаться в URL.
 */
async function requestCall(apiId: string, phone: string): Promise<string> {
  const res = await fetch(CALL_API, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      api_id: apiId,
      phone: phone.replace('+', ''),
      json: '1',
    }).toString(),
  });

  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    status_code?: number;
    status_text?: string;
    code?: number | string;
  };

  if (!res.ok || json.status !== 'OK' || json.code == null) {
    // Номера в логе нет — только коды и словесная причина провайдера:
    // «лимит звонков», «нет денег» и т.п. Без неё отказ анонимен.
    logger.error('Звонок с кодом не заказан', {
      httpStatus: res.status,
      providerStatus: json.status ?? null,
      providerStatusCode: json.status_code ?? null,
      providerStatusText: json.status_text ?? null,
    });
    // У SMS.RU свой лимит звонков на номер (три подряд), и числового кода
    // у отказа нет — узнаём по тексту. «Попробуйте ещё раз» здесь было бы
    // ложью: помогает только подождать.
    if (/много звонков/i.test(json.status_text ?? '')) {
      throw new HttpsError(
        'resource-exhausted',
        'Слишком много звонков на этот номер. Попробуйте позже',
      );
    }
    throw new Error('call-provider-failed');
  }

  // Провайдер отдаёт код числом — ведущий ноль восстанавливаем сами
  return String(json.code).padStart(CODE_LENGTH.call, '0');
}

export type RequestCodeResult =
  | { configured: false }
  | { configured: true; cooldownSec: number; channel: CodeChannel; codeLength: number };

/**
 * Шлёт код входа на номер.
 *
 * Лимиты проверяются в транзакции: два одновременных запроса не обойдут
 * кулдаун наперегонки. Ответ не раскрывает, зарегистрирован ли номер, —
 * иначе форма входа стала бы способом проверять чужие номера.
 *
 * ip — адрес вызывающего для потолка «с одного адреса»; без него (тесты,
 * эмулятор) действует только дневной.
 */
export async function sendLoginCode(phone: string, ip?: string): Promise<RequestCodeResult> {
  if (!PHONE_RE.test(phone)) {
    throw new HttpsError('invalid-argument', 'Нужен мобильный номер в формате +7 9…');
  }

  const creds = credentials();
  // Честный ответ вместо непонятной ошибки: приложение покажет «вход по
  // телефону пока недоступен», а не «что-то пошло не так»
  if (!creds) return { configured: false };

  const channel = codeChannel();
  // Для СМС код выбираем сами и знаем его до записи; для звонка его назначит
  // провайдер, и хэш ляжет в документ вторым шагом — после успешного звонка
  const smsCode = String(randomInt(0, 1_000_000)).padStart(CODE_LENGTH.sms, '0');
  const db = getFirestore();
  const ref = db.doc(`phoneCodes/${phoneCodeDocId(phone)}`);
  const now = Date.now();
  // Сколько отправок уже было в окне — понадобится, если потолок ниже
  // откатит бронь этой
  let sends = 0;

  const verdict = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const lastSentAt: number = snap.get('lastSentAt')?.toMillis?.() ?? 0;
    const windowStartAt: number = snap.get('windowStartAt')?.toMillis?.() ?? 0;
    const windowActive = now - windowStartAt < SEND_WINDOW_MS;
    sends = windowActive ? (snap.get('sends') ?? 0) : 0;
    const failWindowStartAt: number = snap.get('failWindowStartAt')?.toMillis?.() ?? 0;
    const failWindowActive = now - failWindowStartAt < FAILURE_WINDOW_MS;
    const failures: number = failWindowActive ? (snap.get('failures') ?? 0) : 0;

    if (failures >= MAX_FAILURES_PER_WINDOW) return 'locked';
    if (now - lastSentAt < RESEND_COOLDOWN_MS) return 'cooldown';
    if (sends >= MAX_SENDS_PER_WINDOW) return 'exhausted';

    const limits = {
      sends: sends + 1,
      windowStartAt: windowActive ? Timestamp.fromMillis(windowStartAt) : Timestamp.fromMillis(now),
      lastSentAt: Timestamp.fromMillis(now),
    };
    if (channel === 'sms') {
      txn.set(ref, {
        codeHash: codeHash(phone, smsCode),
        expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS),
        attempts: 0,
        // Счёт неверных попыток новый код не обнуляет — в этом его смысл
        ...(failures
          ? { failures, failWindowStartAt: Timestamp.fromMillis(failWindowStartAt) }
          : {}),
        ...limits,
      });
    } else {
      // Только бронь под лимиты: прежний код не трогаем — он действует,
      // пока новый звонок не прозвонился
      txn.set(ref, limits, { merge: true });
    }
    return 'ok';
  });

  if (verdict === 'locked') {
    throw new HttpsError(
      'resource-exhausted',
      'Слишком много неверных попыток. Попробуйте через час',
    );
  }
  if (verdict === 'cooldown') {
    throw new HttpsError('resource-exhausted', 'Код уже отправлен — подождите минуту');
  }
  if (verdict === 'exhausted') {
    throw new HttpsError('resource-exhausted', 'Слишком много запросов кода. Попробуйте через час');
  }

  // Потолки сверх лимитов на номер — после его брони, чтобы отказ по кулдауну
  // не тратил их; при отказе бронь снимается, иначе человек ждал бы минуту
  // за код, который не ушёл
  const overIp = ip
    ? await meterExceeded(ipMeterKey(ip), MAX_SENDS_PER_IP_PER_HOUR, 60 * 60_000)
    : false;
  const overDay =
    !overIp && (await meterExceeded(dayMeterKey(), MAX_SENDS_PER_DAY, 24 * 60 * 60_000));
  if (overIp || overDay) {
    await ref.set({ lastSentAt: null, sends: sends }, { merge: true }).catch(() => {});
    logger.warn('Запрос кода отклонён потолком', { reason: overIp ? 'ip' : 'day' });
    throw new HttpsError(
      'resource-exhausted',
      overIp
        ? 'Слишком много запросов кода с вашей сети. Попробуйте позже'
        : 'Вход по телефону сегодня недоступен — попробуйте завтра или войдите по почте',
    );
  }

  try {
    if (channel === 'sms') {
      await sendSms(creds.apiId, phone, `Код входа в domio: ${smsCode}`);
    } else {
      const callCode = await requestCall(creds.apiId, phone);
      await ref.set(
        {
          codeHash: codeHash(phone, callCode),
          expiresAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MS),
          attempts: 0,
        },
        { merge: true },
      );
    }
  } catch (e) {
    // Кулдаун снимается: человек не должен ждать минуту из-за сбоя провайдера.
    // Счётчик отправок остаётся — долбить лежачего провайдера тоже незачем.
    await ref.set({ lastSentAt: null }, { merge: true }).catch(() => {});
    // Отказ с внятной причиной (лимит звонков) доходит до человека как есть
    if (e instanceof HttpsError) throw e;
    throw new HttpsError(
      'unavailable',
      channel === 'sms'
        ? 'СМС не отправилась. Попробуйте ещё раз'
        : 'Не получилось позвонить. Попробуйте ещё раз',
    );
  }

  await audit({
    action: 'phone.code_sent',
    actor: { type: 'user', uid: phoneAuditId(phone) },
    subject: { type: 'user', id: phoneAuditId(phone) },
    correlationId: `phone-${phoneCodeDocId(phone)}-${now}`,
    details: { channel },
  });

  return {
    configured: true,
    cooldownSec: Math.ceil(RESEND_COOLDOWN_MS / 1000),
    channel,
    codeLength: CODE_LENGTH[channel],
  };
}

export type ConfirmCodeResult = { token: string; created: boolean };

/**
 * Сверяет код и возвращает custom-токен для входа.
 *
 * Код одноразовый: совпадение сжигает его в той же транзакции, что и
 * проверила, — второй вход по перехваченному коду невозможен. register
 * различает вход и регистрацию: без него «вход» по чужому свободному номеру
 * молча заводил бы аккаунт, на который никто не давал согласий.
 */
export async function confirmLoginCode(
  phone: string,
  code: string,
  register: boolean,
): Promise<ConfirmCodeResult> {
  if (!PHONE_RE.test(phone)) {
    throw new HttpsError('invalid-argument', 'Нужен мобильный номер в формате +7 9…');
  }
  // Четыре цифры — код из звонка, шесть — из СМС; оба канала равноправны
  if (!/^\d{4}$/.test(code) && !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Код — четыре или шесть цифр');
  }

  const db = getFirestore();
  const ref = db.doc(`phoneCodes/${phoneCodeDocId(phone)}`);

  // Исход возвращается из транзакции, а ошибка бросается после: исключение
  // внутри колбэка откатило бы и запись счётчика попыток
  const now = Date.now();
  const verdict = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    // Сожжённый код — документ без хэша: счёт неверных попыток должен
    // пережить сам код, иначе новый код обнулял бы подбор
    if (!snap.exists || !snap.get('codeHash')) return 'missing';
    if ((snap.get('expiresAt')?.toMillis?.() ?? 0) < now) {
      txn.update(ref, { codeHash: null, expiresAt: null });
      return 'expired';
    }
    if ((snap.get('attempts') ?? 0) >= MAX_VERIFY_ATTEMPTS) {
      txn.update(ref, { codeHash: null, expiresAt: null });
      return 'locked';
    }
    if (snap.get('codeHash') !== codeHash(phone, code)) {
      const failWindowStartAt: number = snap.get('failWindowStartAt')?.toMillis?.() ?? 0;
      const failWindowActive = now - failWindowStartAt < FAILURE_WINDOW_MS;
      txn.update(ref, {
        attempts: (snap.get('attempts') ?? 0) + 1,
        failures: (failWindowActive ? (snap.get('failures') ?? 0) : 0) + 1,
        failWindowStartAt: failWindowActive
          ? Timestamp.fromMillis(failWindowStartAt)
          : Timestamp.fromMillis(now),
      });
      return 'mismatch';
    }
    // Код сошёлся, но здесь не сжигается: если номер не зарегистрирован, а
    // человек нажал «войти», ему предложат создать аккаунт — тем же кодом,
    // а не новым звонком. Сжигает код выдача токена ниже.
    return 'ok';
  });

  if (verdict === 'missing' || verdict === 'expired') {
    throw new HttpsError('deadline-exceeded', 'Код устарел — запросите новый');
  }
  if (verdict === 'locked') {
    throw new HttpsError(
      'resource-exhausted',
      'Слишком много неверных попыток. Запросите новый код',
    );
  }
  if (verdict === 'mismatch') {
    throw new HttpsError('invalid-argument', 'Неверный код');
  }

  // Код сошёлся — телефон в руках у звонящего. Только после этого можно
  // говорить, есть ли такой аккаунт: до проверки кода это была бы утечка.
  const auth = getAuth();
  let uid: string;
  let created = false;

  try {
    const user = await auth.getUserByPhoneNumber(phone);
    if (user.disabled) throw new HttpsError('permission-denied', 'Аккаунт заблокирован');
    uid = user.uid;
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    if (!register) {
      throw new HttpsError('not-found', 'Этот номер не зарегистрирован — создайте аккаунт');
    }
    try {
      uid = (await auth.createUser({ phoneNumber: phone })).uid;
      created = true;
    } catch (e2) {
      // Два одновременных подтверждения: второй создатель проиграл гонку —
      // аккаунт уже есть, входим в него
      if ((e2 as { code?: string }).code !== 'auth/phone-number-already-exists') throw e2;
      uid = (await auth.getUserByPhoneNumber(phone)).uid;
    }
  }

  // Теперь код одноразовый: второй вход по перехваченному коду невозможен
  await ref.delete();

  const token = await auth.createCustomToken(uid);

  await audit({
    action: created ? 'phone.registered' : 'phone.signed_in',
    actor: { type: 'user', uid },
    subject: { type: 'user', id: uid },
    correlationId: `phone-${phoneCodeDocId(phone)}-${Date.now()}`,
    details: {},
  });

  return { token, created };
}

/** Просьба прислать код. Доступна без входа — это и есть путь к входу. */
export const requestPhoneCode = onCall({ secrets: [SMSRU_API_ID] }, async (request) =>
  sendLoginCode(String(request.data?.phone ?? ''), callerIp(request)),
);

/** Проверка кода. Возвращает custom-токен, которым клиент входит. */
export const verifyPhoneCode = onCall(async (request) =>
  confirmLoginCode(
    String(request.data?.phone ?? ''),
    String(request.data?.code ?? ''),
    request.data?.register === true,
  ),
);
