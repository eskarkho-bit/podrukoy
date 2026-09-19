import { httpsCallable } from 'firebase/functions';
import { functions, functionsViaHosting, usingEmulator } from '../firebaseConfig';

// Вызов callable-функций с запасным маршрутом.
//
// К функциям ведут две дороги: прямой адрес (cloudfunctions.net, Google
// Frontend) и Firebase Hosting с rewrites /api/* (Fastly). В российских
// мобильных сетях прямой адрес временами закрыт при живых Firestore и
// хостинге — запрос кода входа тогда молча не доходил до сервера, а
// приложение отвечало «вход по телефону недоступен». Начинаем с хостинга:
// он доступен в обеих сетях; прямой адрес — запасной. Сработавший маршрут
// запоминается на сессию: на телефоне, где один адрес закрыт, каждый вызов
// иначе ждал бы его отказа.

/** Ожидание одной попытки. Закрытый адрес не отвечает вовсе, а штатные
 * семьдесят секунд SDK человек у формы входа не выдержит. */
const ATTEMPT_TIMEOUT_MS = 15_000;

/** Сетевой сбой, а не ответ нашей функции: у своих ошибок текст русский. */
export function isNetworkFailure(e: unknown): boolean {
  const code =
    typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
  const message =
    typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : '';
  return (
    ['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded'].includes(code) &&
    !/[а-яё]/i.test(message)
  );
}

let routes = [functionsViaHosting, functions];

export async function callFunction<Req, Res>(name: string, data: Req): Promise<Res> {
  if (usingEmulator) {
    return (await httpsCallable<Req, Res>(functions, name)(data)).data;
  }
  const [first, second] = routes;
  try {
    return (await httpsCallable<Req, Res>(first, name, { timeout: ATTEMPT_TIMEOUT_MS })(data)).data;
  } catch (e) {
    if (!isNetworkFailure(e)) throw e;
    const result = (
      await httpsCallable<Req, Res>(second, name, { timeout: ATTEMPT_TIMEOUT_MS })(data)
    ).data;
    routes = [second, first];
    return result;
  }
}
