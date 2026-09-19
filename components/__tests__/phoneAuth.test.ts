import { httpsCallable } from 'firebase/functions';
import { formatRuPhone, normalizeRuPhone, phoneAuthErrorText, requestSmsCode } from '../phoneAuth';

// Обращения к серверу подменяются: тесту важно не «дошёл ли вызов до
// Firebase», а как модуль переводит ответы и сбои на язык человека — и по
// какому маршруту идёт, когда один из адресов закрыт сетью.
jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(),
}));

const callableMock = httpsCallable as jest.Mock;

const HOSTING = 'https://domio-7ad1c.web.app/api';
const DIRECT = 'us-central1';

const networkError = () => Object.assign(new Error('internal'), { code: 'functions/internal' });

// Нормализация — та граница, где «как пишут люди» превращается в «как ждёт
// сервер». Ошибка здесь означает СМС, ушедшую не на тот номер, или человека,
// которому «ваш номер неверный» говорят про его собственный номер.

describe('normalizeRuPhone', () => {
  test('принимает всё, что реально печатают люди', () => {
    expect(normalizeRuPhone('+7 999 123-45-67')).toBe('+79991234567');
    expect(normalizeRuPhone('8 (999) 123 45 67')).toBe('+79991234567');
    expect(normalizeRuPhone('89991234567')).toBe('+79991234567');
    expect(normalizeRuPhone('9991234567')).toBe('+79991234567');
    expect(normalizeRuPhone('+79991234567')).toBe('+79991234567');
  });

  test('не мобильные и обрезанные номера отвергает', () => {
    // Городской: СМС туда не придёт
    expect(normalizeRuPhone('+7 495 123-45-67')).toBeNull();
    expect(normalizeRuPhone('999123456')).toBeNull();
    expect(normalizeRuPhone('79991234')).toBeNull();
    expect(normalizeRuPhone('')).toBeNull();
    expect(normalizeRuPhone('не номер')).toBeNull();
    // Иностранный код страны — сервис работает по номерам РФ
    expect(normalizeRuPhone('+380991234567')).toBeNull();
  });
});

describe('formatRuPhone', () => {
  test('раскладывает номер для показа', () => {
    expect(formatRuPhone('+79991234567')).toBe('+7 999 123-45-67');
  });

  test('незнакомый формат возвращает как есть, а не ломает', () => {
    expect(formatRuPhone('abc')).toBe('abc');
  });
});

describe('requestSmsCode', () => {
  const withCallable = (impl: () => Promise<unknown>) =>
    callableMock.mockReturnValue(jest.fn(impl));

  beforeEach(() => callableMock.mockReset());

  test('ответ сервера доходит как есть, включая канал доставки', async () => {
    withCallable(async () => ({ data: { configured: true, channel: 'call', codeLength: 4 } }));
    await expect(requestSmsCode('+79991234567')).resolves.toEqual({
      channel: 'call',
      codeLength: 4,
    });

    withCallable(async () => ({ data: { configured: false } }));
    await expect(requestSmsCode('+79991234567')).resolves.toBe('not-configured');
  });

  // Старый сервер канала не сообщал — считаем это СМС с шестью цифрами,
  // а не падаем на несовпадении форм
  test('ответ без канала означает СМС', async () => {
    withCallable(async () => ({ data: { configured: true } }));
    await expect(requestSmsCode('+79991234567')).resolves.toEqual({
      channel: 'sms',
      codeLength: 6,
    });
  });

  // Пока функции не развёрнуты, их адрес отвечает 404 — not-found. Человек
  // должен увидеть «вход по телефону пока недоступен», а не «не получилось».
  test('неразвёрнутый бэкенд — это честное «не настроено», а не сбой', async () => {
    withCallable(async () => {
      throw Object.assign(new Error('not-found'), { code: 'functions/not-found' });
    });
    await expect(requestSmsCode('+79991234567')).resolves.toBe('not-configured');
  });

  // Российские сети закрывают cloudfunctions.net выборочно: если один адрес
  // молчит, вызов уходит вторым маршрутом, и человек ничего не замечает
  test('обрыв на одном маршруте уводит вызов на другой', async () => {
    callableMock.mockImplementation((fns: { route: string }) =>
      jest.fn(async () => {
        if (fns.route === HOSTING) throw networkError();
        return { data: { configured: true, channel: 'call', codeLength: 4 } };
      }),
    );

    await expect(requestSmsCode('+79991234567')).resolves.toEqual({
      channel: 'call',
      codeLength: 4,
    });
    const routes = callableMock.mock.calls.map((c) => (c[0] as { route: string }).route);
    expect(routes).toEqual([HOSTING, DIRECT]);

    // Сработавший маршрут запоминается: следующий вызов идёт по нему сразу
    callableMock.mockClear();
    await requestSmsCode('+79991234567');
    expect(callableMock.mock.calls.map((c) => (c[0] as { route: string }).route)).toEqual([DIRECT]);
  });

  test('обрыв на обоих маршрутах — это ошибка связи, а не «не настроено»', async () => {
    withCallable(async () => {
      throw networkError();
    });
    await expect(requestSmsCode('+79991234567')).rejects.toMatchObject({
      code: 'functions/internal',
    });
    // Оба адреса перепробованы
    expect(callableMock).toHaveBeenCalledTimes(2);
  });

  test('настоящие отказы сервера пробрасываются наружу и не повторяются', async () => {
    const cooldown = Object.assign(new Error('Код уже отправлен — подождите минуту'), {
      code: 'functions/resource-exhausted',
    });
    withCallable(async () => {
      throw cooldown;
    });
    await expect(requestSmsCode('+79991234567')).rejects.toBe(cooldown);
    expect(callableMock).toHaveBeenCalledTimes(1);
  });
});

describe('phoneAuthErrorText', () => {
  test('русские формулировки сервера показываются как есть', () => {
    expect(phoneAuthErrorText(new Error('Неверный код'))).toBe('Неверный код');
    expect(phoneAuthErrorText(new Error('Код уже отправлен — подождите минуту'))).toBe(
      'Код уже отправлен — подождите минуту',
    );
  });

  test('технические сообщения не показываются человеку', () => {
    expect(phoneAuthErrorText(new Error('INTERNAL'))).toBe(
      'Не получилось войти. Попробуйте ещё раз',
    );
    expect(phoneAuthErrorText(null)).toBe('Не получилось войти. Попробуйте ещё раз');
  });

  // internal — так SDK называет любой обрыв сети; после двух маршрутов это
  // именно связь, и человек должен услышать про неё
  test('сетевые ошибки называются своим именем', () => {
    const unavailable = Object.assign(new Error('deadline'), { code: 'functions/unavailable' });
    expect(phoneAuthErrorText(unavailable)).toContain('Нет связи');
    expect(phoneAuthErrorText(networkError())).toContain('Нет связи');
  });

  // «Не получилось войти» на кнопке «Получить код» читается как ошибка не из
  // этого места — запасная фраза обязана называть шаг, где случился сбой
  test('запасная фраза подстраивается под шаг', () => {
    expect(phoneAuthErrorText(new Error('INTERNAL'), 'Не удалось отправить код')).toBe(
      'Не удалось отправить код',
    );
  });
});
