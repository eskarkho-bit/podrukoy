import { BANK_IDS, bankLabel, banksFrom } from '../banks';
import {
  availableMethods,
  banksLine,
  formatPhone,
  paymentDetailsFrom,
  paymentMethodFrom,
} from '../payment';

// Расчёты идут мимо сервиса, но то, что он показывает о них, должно быть
// предсказуемым: чужие значения из базы не превращаются в кнопки, а мастер
// без настроек не оставляет клиента без способов оплаты.

describe('banksFrom', () => {
  test('оставляет только известные банки, в порядке списка', () => {
    expect(banksFrom(['tbank', 'sber', 'что-то', 42])).toEqual(['sber', 'tbank']);
  });

  test('не массив — пусто', () => {
    expect(banksFrom(undefined)).toEqual([]);
    expect(banksFrom('sber')).toEqual([]);
  });

  test('у каждого банка есть подпись', () => {
    for (const id of BANK_IDS) expect(bankLabel(id)).not.toBe(id);
    expect(bankLabel('неизвестный')).toBe('неизвестный');
  });
});

describe('paymentDetailsFrom', () => {
  test('документа нет — null, а не пустые настройки', () => {
    expect(paymentDetailsFrom(undefined)).toBeNull();
  });

  test('наличные приняты по умолчанию, банки — из закрытого списка', () => {
    expect(paymentDetailsFrom({ banks: ['vtb', 'x'] })).toEqual({
      banks: ['vtb'],
      acceptsCash: true,
    });
    expect(paymentDetailsFrom({ banks: [], acceptsCash: false })).toEqual({
      banks: [],
      acceptsCash: false,
    });
  });
});

describe('paymentMethodFrom', () => {
  test('чужое значение — null', () => {
    expect(paymentMethodFrom('cash')).toBe('cash');
    expect(paymentMethodFrom('transfer')).toBe('transfer');
    expect(paymentMethodFrom('card')).toBeNull();
    expect(paymentMethodFrom(null)).toBeNull();
  });
});

describe('availableMethods', () => {
  test('мастер ничего не настраивал — оба способа', () => {
    expect(availableMethods({})).toEqual(['cash', 'transfer']);
    expect(availableMethods({ masterBanks: null, masterAcceptsCash: null })).toEqual([
      'cash',
      'transfer',
    ]);
  });

  test('без наличных — только перевод, без банков — только наличные', () => {
    expect(availableMethods({ masterBanks: ['sber'], masterAcceptsCash: false })).toEqual([
      'transfer',
    ]);
    expect(availableMethods({ masterBanks: [], masterAcceptsCash: true })).toEqual(['cash']);
  });

  // Закрыть оба способа — ошибка настройки, а не способ не получить оплату
  test('всё закрыто — считается ненастроенным', () => {
    expect(availableMethods({ masterBanks: [], masterAcceptsCash: false })).toEqual([
      'cash',
      'transfer',
    ]);
  });
});

describe('подписи', () => {
  test('банки через запятую, телефон с разделителями', () => {
    expect(banksLine(['sber', 'tbank'])).toBe('Сбербанк, Т-Банк');
    expect(banksLine(null)).toBe('');
    expect(formatPhone('+79991234567')).toBe('+7 999 123-45-67');
    expect(formatPhone('79991234567')).toBe('+7 999 123-45-67');
    expect(formatPhone('12345')).toBe('12345');
  });
});
