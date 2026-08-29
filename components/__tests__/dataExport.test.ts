import { assembleExport, sanitize, ExportInput } from '../dataExport';

// Экспорт данных — юридическое обещание из LEGAL-BRIEF, поэтому проверяется
// не «файл собрался», а что именно в нём: служебное вырезано, даты читаемы,
// мастерская часть не выдумывается у клиента без анкеты.

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

const base: ExportInput = {
  uid: 'u1',
  email: 'client@test.ru',
  phone: '',
  profile: {
    name: 'Дмитрий',
    city: 'грозный',
    pushTokens: ['ExponentPushToken[secret]'],
    consents: { terms: '2026-07-01' },
  },
  orders: [
    {
      id: 'o1',
      data: { title: 'Розетка', createdAt: ts('2026-08-29T10:00:00Z') },
      messages: [{ text: 'когда прийти', createdAt: ts('2026-08-29T11:00:00Z') }],
    },
  ],
  supportMessages: [],
  master: undefined,
  verification: { phone: '79990000000', cardBindingId: 'pb-secret', cardLast4: '4242' },
  myReviews: [{ orderId: 'o9', data: { stars: 5, text: 'Отлично' } }],
};

describe('sanitize', () => {
  test('Timestamp становится ISO-строкой на любой глубине', () => {
    const out = sanitize({ a: ts('2026-01-02T03:04:05Z'), b: [{ c: ts('2026-05-06T07:08:09Z') }] });
    expect(out).toEqual({
      a: '2026-01-02T03:04:05.000Z',
      b: [{ c: '2026-05-06T07:08:09.000Z' }],
    });
  });
});

describe('assembleExport', () => {
  test('служебные поля не попадают в файл', () => {
    const out = JSON.stringify(assembleExport(base));
    // Пуш-токены — техника устройств, cardBindingId — токен провайдера
    expect(out).not.toContain('pushTokens');
    expect(out).not.toContain('ExponentPushToken');
    expect(out).not.toContain('cardBindingId');
    expect(out).not.toContain('pb-secret');
    // А маска карты и согласия — данные владельца, они на месте
    expect(out).toContain('4242');
    expect(out).toContain('2026-07-01');
  });

  test('переписка лежит внутри своей заявки, даты — строками', () => {
    const out = assembleExport(base) as {
      orders: { id: string; createdAt: string; messages: { text: string }[] }[];
    };
    expect(out.orders[0].id).toBe('o1');
    expect(out.orders[0].createdAt).toBe('2026-08-29T10:00:00.000Z');
    expect(out.orders[0].messages[0].text).toBe('когда прийти');
  });

  test('у клиента без анкеты мастерская часть — честный null', () => {
    const out = assembleExport(base) as { master: unknown; reviewsWritten: { stars: number }[] };
    expect(out.master).toBeNull();
    expect(out.reviewsWritten[0].stars).toBe(5);
  });
});
