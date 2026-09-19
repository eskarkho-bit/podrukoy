import { callFunction } from './callables';

// Вход по номеру телефона: нормализация номера и обращения к серверу.
//
// Код проверяет Cloud Function, а не приложение: клиенту нельзя доверять
// ни генерацию кода, ни сверку — иначе вход в чужой аккаунт был бы вопросом
// правки JS в отладчике. Сюда возвращается только custom-токен, которым
// AuthState выполняет вход.

/**
 * Приводит ввод к виду +79XXXXXXXXX.
 *
 * Принимает всё, что реально печатают люди: «8 999 123-45-67»,
 * «+7 (999) 123 45 67», «9991234567». Возвращает null, если это не
 * мобильный номер РФ: СМС уходят только на мобильные.
 */
export function normalizeRuPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const rest =
    digits.length === 10
      ? digits
      : digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))
        ? digits.slice(1)
        : null;
  if (!rest || !rest.startsWith('9')) return null;
  return `+7${rest}`;
}

/** +79991234567 → «+7 999 123-45-67» — для показа, не для хранения. */
export function formatRuPhone(phone: string): string {
  const m = phone.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  if (!m) return phone;
  return `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}`;
}

export type CodeChannel = 'sms' | 'call';

// Каналом доставки кода распоряжается сервер: звонок (код — последние четыре
// цифры звонящего номера) или СМС. Экран подстраивает тексты и длину поля.
export type SmsRequestResult = 'not-configured' | { channel: CodeChannel; codeLength: number };

/**
 * Развёрнут ли вообще бэкенд телефонного входа.
 *
 * Пока функции не выкачены (нужен тариф Blaze), их адрес отвечает 404, и
 * SDK превращает это в not-found. Сетевые сбои (internal, unavailable) сюда
 * больше не входят: их отрабатывает запасной маршрут в callFunction, а если
 * не сработал и он — человек должен услышать «нет связи», а не «входа по
 * телефону нет».
 */
function backendMissing(e: unknown): boolean {
  const code =
    typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
  return code === 'functions/not-found';
}

/**
 * Просит сервер прислать код. 'not-configured' — вход по телефону недоступен
 * честно, а не сломан: у функций нет ключа СМС-провайдера либо они вовсе
 * не развёрнуты. Приложение в обоих случаях предлагает войти по почте.
 */
export async function requestSmsCode(phone: string): Promise<SmsRequestResult> {
  try {
    const data = await callFunction<
      { phone: string },
      { configured: boolean; channel?: string; codeLength?: number }
    >('requestPhoneCode', { phone });
    if (data?.configured === false) return 'not-configured';
    // Старый сервер канала не сообщал — тогда это СМС с шестью цифрами
    return {
      channel: data?.channel === 'call' ? 'call' : 'sms',
      codeLength: data?.codeLength === 4 ? 4 : 6,
    };
  } catch (e) {
    if (backendMissing(e)) return 'not-configured';
    throw e;
  }
}

/**
 * Сверяет код и возвращает custom-токен для входа.
 *
 * register различает вход и регистрацию: «вход» по свободному номеру не
 * должен молча заводить аккаунт — согласий на обработку данных никто не давал.
 */
export async function verifySmsCode(
  phone: string,
  code: string,
  register: boolean,
): Promise<string> {
  const data = await callFunction<
    { phone: string; code: string; register: boolean },
    { token: string }
  >('verifyPhoneCode', { phone, code, register });
  if (!data?.token) throw new Error('Сервер не вернул токен входа');
  return data.token;
}

/**
 * Текст ошибки телефонного входа для показа человеку.
 *
 * Наши функции бросают HttpsError с русскими формулировками — они доходят
 * до клиента как message и показываются как есть. Всё остальное (сеть,
 * internal, английские заглушки SDK) сводится к запасной фразе — она должна
 * называть шаг, на котором случился сбой: «не получилось войти» на кнопке
 * «Получить код» звучит как ошибка не из этого места.
 */
export function phoneAuthErrorText(
  e: unknown,
  fallback = 'Не получилось войти. Попробуйте ещё раз',
): string {
  const message = e instanceof Error ? e.message : '';
  if (/[а-яё]/i.test(message)) return message;
  const code =
    typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
  // internal — так SDK называет любой обрыв сети; оба маршрута к серверу
  // уже перепробованы (callFunction), значит дело в связи
  if (
    ['functions/unavailable', 'functions/internal', 'functions/deadline-exceeded'].includes(code)
  ) {
    return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз';
  }
  return fallback;
}
