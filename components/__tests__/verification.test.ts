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
      cardLast4: '4242',
      cardBrand: 'MasterCard',
      cardBindingId: 'pm_1',
      status: 'pending',
      biometricConsent: '2026-08-06',
      bindingState: 'succeeded',
    });
    expect(app.phone).toBe('79991234567');
    expect(app.cardLast4).toBe('4242');
    expect(app.status).toBe('pending');
    expect(app.bindingState).toBe('succeeded');
  });

  // Значения не из перечисления — это либо чужая запись, либо старая схема.
  // Показать «черновик» безопаснее, чем поверить неизвестному статусу.
  test('незнакомый статус считается черновиком', () => {
    expect(applicationFrom({ status: 'approved-ish' }).status).toBe('draft');
    expect(applicationFrom({ status: 42 }).status).toBe('draft');
    expect(applicationFrom({ status: null }).status).toBe('draft');
  });

  test('незнакомое состояние привязки обнуляется', () => {
    expect(applicationFrom({ bindingState: 'что-то' }).bindingState).toBeNull();
    expect(applicationFrom({ bindingState: true }).bindingState).toBeNull();
  });

  test('поля не того типа не протекают в интерфейс', () => {
    const app = applicationFrom({
      phone: 12345,
      about: { текст: 'да' },
      photoUrl: false,
      cardLast4: 4242,
    });
    expect(app.phone).toBe('');
    expect(app.about).toBe('');
    expect(app.photoUrl).toBeNull();
    expect(app.cardLast4).toBeNull();
  });

  test('одобренная заявка читается как одобренная', () => {
    expect(applicationFrom({ status: 'approved' }).status).toBe('approved');
    expect(applicationFrom({ status: 'rejected' }).status).toBe('rejected');
  });
});
