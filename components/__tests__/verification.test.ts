import { applicationFrom, EMPTY_APPLICATION, phoneValid } from '../verification';

// Данные заявки приходят из Firestore, то есть из-под чужой записи: поля
// могут отсутствовать, быть не того типа или содержать мусор. Экран не должен
// падать ни на чём из этого.

describe('phoneValid', () => {
  test('одиннадцать цифр — годится', () => {
    expect(phoneValid('79991234567')).toBe(true);
  });

  test('разделители не мешают', () => {
    expect(phoneValid('+7 (999) 123-45-67')).toBe(true);
    expect(phoneValid('8-999-123-45-67')).toBe(true);
  });

  // Сервер отдаёт клиенту только номера вида +7…: с другой первой цифрой
  // «Позвонить» у клиента не появилось бы
  test('первая цифра — 7 или 8', () => {
    expect(phoneValid('19991234567')).toBe(false);
    expect(phoneValid('89991234567')).toBe(true);
  });

  test('короче или длиннее — не годится', () => {
    expect(phoneValid('7999123456')).toBe(false);
    expect(phoneValid('799912345678')).toBe(false);
    expect(phoneValid('')).toBe(false);
  });

  test('буквы вместо цифр не проходят', () => {
    expect(phoneValid('телефон')).toBe(false);
    expect(phoneValid('7999abc4567')).toBe(false);
  });
});

describe('applicationFrom', () => {
  test('пустой документ даёт пустую заявку, а не падение', () => {
    expect(applicationFrom(undefined)).toEqual(EMPTY_APPLICATION);
    expect(applicationFrom({})).toEqual(EMPTY_APPLICATION);
  });

  test('заполненный документ читается целиком', () => {
    const app = applicationFrom({
      phone: '79991234567',
      about: 'Электрик',
      photoUrl: 'https://example.com/face.jpg',
      status: 'pending',
      biometricConsent: '2026-08-06',
    });
    expect(app.phone).toBe('79991234567');
    expect(app.about).toBe('Электрик');
    expect(app.status).toBe('pending');
    expect(app.biometricConsent).toBe('2026-08-06');
  });

  // Заявки, поданные до отказа от платёжного провайдера, могли сохранить
  // маску карты и токен — экрану они не нужны и в объект не попадают
  test('поля старой привязки карты не протекают в интерфейс', () => {
    const app = applicationFrom({
      phone: '79991234567',
      cardLast4: '4242',
      cardBindingId: 'pm_1',
      bindingState: 'succeeded',
    });
    expect(app).not.toHaveProperty('cardLast4');
    expect(app).not.toHaveProperty('bindingState');
  });

  // Значения не из перечисления — это либо чужая запись, либо старая схема.
  // Показать «черновик» безопаснее, чем поверить неизвестному статусу.
  test('незнакомый статус считается черновиком', () => {
    expect(applicationFrom({ status: 'approved-ish' }).status).toBe('draft');
    expect(applicationFrom({ status: 42 }).status).toBe('draft');
    expect(applicationFrom({ status: null }).status).toBe('draft');
  });

  test('поля не того типа не протекают в интерфейс', () => {
    const app = applicationFrom({
      phone: 12345,
      about: { текст: 'да' },
      photoUrl: false,
    });
    expect(app.phone).toBe('');
    expect(app.about).toBe('');
    expect(app.photoUrl).toBeNull();
  });

  test('одобренная заявка читается как одобренная', () => {
    expect(applicationFrom({ status: 'approved' }).status).toBe('approved');
    expect(applicationFrom({ status: 'rejected' }).status).toBe('rejected');
  });
});
