import { httpsCallable } from 'firebase/functions';
import { formatRuPhone, normalizeRuPhone, phoneAuthErrorText, requestSmsCode } from '../phoneAuth';

// Обращения к серверу подменяются: тесту важно не «дошёл ли вызов до
// Firebase», а как модуль переводит ответы и сбои на язык человека.
jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(),
}));

const callableMock = httpsCallable as jest.Mock;

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

  test('ответ сервера доходит как есть', async () => {
    withCallable(async () => ({ data: { configured: true } }));
    await expect(requestSmsCode('+79991234567')).resolves.toBe('sent');

    withCallable(async () => ({ data: { configured: false } }));
    await expect(requestSmsCode('+79991234567')).resolves.toBe('not-configured');
  });

  // Пока функции не развёрнуты, их адрес отвечает 404: в браузере это
  // CORS-обрыв с кодом internal, на телефоне — not-found. Человек должен
  // увидеть «вход по телефону пока недоступен», а не «не получилось войти».
  test('неразвёрнутый бэкенд — это честное «не настроено», а не сбой', async () => {
    withCallable(async () => {
      throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    });
    await expect(requestSmsCode('+79991234567')).resolves.toBe('not-configured');

    withCallable(async () => {
      throw Object.assign(new Error('not-found'), { code: 'functions/not-found' });
    });
    await expect(requestSmsCode('+79991234567')).resolves.toBe('not-configured');
  });

  test('настоящие отказы сервера пробрасываются наружу', async () => {
    const cooldown = Object.assign(new Error('Код уже отправлен — подождите минуту'), {
      code: 'functions/resource-exhausted',
    });
    withCallable(async () => {
      throw cooldown;
    });
    await expect(requestSmsCode('+79991234567')).rejects.toBe(cooldown);
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

  test('сетевые ошибки называются своим именем', () => {
    const e = Object.assign(new Error('deadline'), { code: 'functions/unavailable' });
    expect(phoneAuthErrorText(e)).toBe('Нет связи с сервером. Проверьте интернет');
  });

  // «Не получилось войти» на кнопке «Получить код» читается как ошибка не из
  // этого места — запасная фраза обязана называть шаг, где случился сбой
  test('запасная фраза подстраивается под шаг', () => {
    expect(phoneAuthErrorText(new Error('INTERNAL'), 'Не удалось отправить код')).toBe(
      'Не удалось отправить код',
    );
  });
});
