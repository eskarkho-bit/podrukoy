import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebaseConfig';

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

export type SmsRequestResult = 'sent' | 'not-configured';

/**
 * Развёрнут ли вообще бэкенд телефонного входа.
 *
 * Пока функции не выкачены (нужен тариф Blaze), их адрес отвечает 404: на
 * телефоне SDK превращает это в not-found, а в браузере ответ без
 * CORS-заголовков обрывается ещё на preflight и приходит как internal.
 * Наша функция отправки таких кодов не бросает (её словарь — invalid-argument,
 * resource-exhausted, unavailable), поэтому оба кода означают одно и то же:
 * входа по телефону в этой среде пока нет.
 */
function backendMissing(e: unknown): boolean {
  const code =
    typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
  return code === 'functions/not-found' || code === 'functions/internal';
}

/**
 * Просит сервер прислать код. 'not-configured' — вход по телефону недоступен
 * честно, а не сломан: у функций нет ключа СМС-провайдера либо они вовсе
 * не развёрнуты. Приложение в обоих случаях предлагает войти по почте.
 */
export async function requestSmsCode(phone: string): Promise<SmsRequestResult> {
  const request = httpsCallable<{ phone: string }, { configured: boolean }>(
    functions,
    'requestPhoneCode',
  );
  try {
    const { data } = await request({ phone });
    return data?.configured === false ? 'not-configured' : 'sent';
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
  const verify = httpsCallable<
    { phone: string; code: string; register: boolean },
    { token: string }
  >(functions, 'verifyPhoneCode');
  const { data } = await verify({ phone, code, register });
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
  if (code === 'functions/unavailable') return 'Нет связи с сервером. Проверьте интернет';
  return fallback;
}
