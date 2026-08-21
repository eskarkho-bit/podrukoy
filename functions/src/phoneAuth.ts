import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createHash, randomInt } from 'node:crypto';
import { audit } from './audit';

// Вход по номеру телефона: одноразовый код в СМС, свой, а не Firebase Phone Auth.
//
// Почему не встроенный: во-первых, вход по телефону в веб-SDK Firebase требует
// reCAPTCHA, а ей нужен DOM — в Expo-приложении без WebView его нет. Во-вторых,
// СМС от Google в российские сети доставляются плохо, а российский провайдер —
// надёжно и на порядок дешевле.
//
// Схема: requestPhoneCode шлёт шестизначный код по СМС и кладёт в базу его
// хэш; verifyPhoneCode сверяет код, находит или заводит аккаунт по номеру и
// возвращает custom-токен, которым клиент входит. Правила Firestore закрывают
// phoneCodes наглухо: код можно получить только из СМС, то есть только держа
// телефон в руках.
//
// Сам номер и сам код в базе не хранятся: документ называется хэшем номера и
// держит хэш кода. Утечка коллекции не даёт ни войти, ни узнать чей-то номер.
//
// Провайдер — SMS.RU. Всё общение с ним заперто в этом файле: чтобы перейти
// на SMSC или Твил, переписывается только он. Ключ — SMSRU_API_ID в окружении
// функций (functions/.env); пока ключа нет, requestPhoneCode честно отвечает
// «не настроено», и приложение не показывает вход по телефону как рабочий.
//
// В бою custom-токены подписывает сервисный аккаунт функций: ему нужна роль
// Service Account Token Creator (iam.serviceAccountTokenCreator) на самого
// себя. В эмуляторе токены не подписываются, роль не нужна.

const API = 'https://sms.ru/sms/send';

// Код живёт недолго: перехватить СМС задним числом не выйдет
const CODE_TTL_MS = 5 * 60_000;

// Лимиты отправки. Без них функция — бесплатная СМС-пушка по любому номеру
// страны и способ выжечь баланс у провайдера.
const RESEND_COOLDOWN_MS = 60_000;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60_000;

// Попытки ввода. Шестизначный код — миллион вариантов; пять попыток делают
// подбор бессмысленным, потом код сгорает.
const MAX_VERIFY_ATTEMPTS = 5;

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

function credentials(): { apiId: string } | null {
  const apiId = process.env.SMSRU_API_ID;
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
  const res = await fetch(API, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ api_id: apiId, to, msg: text, json: '1' }).toString(),
  });

  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    sms?: Record<string, { status?: string; status_code?: number }>;
  };

  // Провайдер отвечает 200 даже на отказ — смотреть надо в статус по номеру
  const perNumber = json.sms?.[to];
  if (!res.ok || json.status !== 'OK' || perNumber?.status !== 'OK') {
    // Номера в логе нет — только коды, по ним видно «нет денег» или «оператор отбил»
    logger.error('СМС не отправлена', {
      httpStatus: res.status,
      providerStatus: json.status ?? null,
      smsStatusCode: perNumber?.status_code ?? null,
    });
    throw new Error('sms-provider-failed');
  }
}

export type RequestCodeResult = { configured: false } | { configured: true; cooldownSec: number };

/**
 * Шлёт код входа на номер.
 *
 * Лимиты проверяются в транзакции: два одновременных запроса не обойдут
 * кулдаун наперегонки. Ответ не раскрывает, зарегистрирован ли номер, —
 * иначе форма входа стала бы способом проверять чужие номера.
 */
export async function sendLoginCode(phone: string): Promise<RequestCodeResult> {
  if (!PHONE_RE.test(phone)) {
    throw new HttpsError('invalid-argument', 'Нужен мобильный номер в формате +7 9…');
  }

  const creds = credentials();
  // Честный ответ вместо непонятной ошибки: приложение покажет «вход по
  // телефону пока недоступен», а не «что-то пошло не так»
  if (!creds) return { configured: false };

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const db = getFirestore();
  const ref = db.doc(`phoneCodes/${phoneCodeDocId(phone)}`);
  const now = Date.now();

  const verdict = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const lastSentAt: number = snap.get('lastSentAt')?.toMillis?.() ?? 0;
    const windowStartAt: number = snap.get('windowStartAt')?.toMillis?.() ?? 0;
    const windowActive = now - windowStartAt < SEND_WINDOW_MS;
    const sends: number = windowActive ? (snap.get('sends') ?? 0) : 0;

    if (now - lastSentAt < RESEND_COOLDOWN_MS) return 'cooldown';
    if (sends >= MAX_SENDS_PER_WINDOW) return 'exhausted';

    txn.set(ref, {
      codeHash: codeHash(phone, code),
      expiresAt: Timestamp.fromMillis(now + CODE_TTL_MS),
      attempts: 0,
      sends: sends + 1,
      windowStartAt: windowActive ? Timestamp.fromMillis(windowStartAt) : Timestamp.fromMillis(now),
      lastSentAt: Timestamp.fromMillis(now),
    });
    return 'ok';
  });

  if (verdict === 'cooldown') {
    throw new HttpsError('resource-exhausted', 'Код уже отправлен — подождите минуту');
  }
  if (verdict === 'exhausted') {
    throw new HttpsError('resource-exhausted', 'Слишком много запросов кода. Попробуйте через час');
  }

  try {
    await sendSms(creds.apiId, phone, `Код входа в domio: ${code}`);
  } catch {
    // Кулдаун снимается: человек не должен ждать минуту из-за сбоя провайдера.
    // Счётчик отправок остаётся — долбить лежачего провайдера тоже незачем.
    await ref.set({ lastSentAt: null }, { merge: true }).catch(() => {});
    throw new HttpsError('unavailable', 'СМС не отправилась. Попробуйте ещё раз');
  }

  await audit({
    action: 'phone.code_sent',
    actor: { type: 'user', uid: phoneAuditId(phone) },
    subject: { type: 'user', id: phoneAuditId(phone) },
    correlationId: `phone-${phoneCodeDocId(phone)}-${now}`,
    details: {},
  });

  return { configured: true, cooldownSec: Math.ceil(RESEND_COOLDOWN_MS / 1000) };
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
  if (!/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Код — шесть цифр из СМС');
  }

  const db = getFirestore();
  const ref = db.doc(`phoneCodes/${phoneCodeDocId(phone)}`);

  // Исход возвращается из транзакции, а ошибка бросается после: исключение
  // внутри колбэка откатило бы и запись счётчика попыток
  const verdict = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return 'missing';
    if ((snap.get('expiresAt')?.toMillis?.() ?? 0) < Date.now()) {
      txn.delete(ref);
      return 'expired';
    }
    if ((snap.get('attempts') ?? 0) >= MAX_VERIFY_ATTEMPTS) {
      txn.delete(ref);
      return 'locked';
    }
    if (snap.get('codeHash') !== codeHash(phone, code)) {
      txn.update(ref, { attempts: (snap.get('attempts') ?? 0) + 1 });
      return 'mismatch';
    }
    txn.delete(ref);
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
export const requestPhoneCode = onCall(async (request) =>
  sendLoginCode(String(request.data?.phone ?? '')),
);

/** Проверка кода. Возвращает custom-токен, которым клиент входит. */
export const verifyPhoneCode = onCall(async (request) =>
  confirmLoginCode(
    String(request.data?.phone ?? ''),
    String(request.data?.code ?? ''),
    request.data?.register === true,
  ),
);
