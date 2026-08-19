import { getFirestore } from 'firebase-admin/firestore';
import {
  fakeProvider,
  initTestApp,
  succeededPayment,
  wipe,
  withProviderKeys,
  withoutProviderKeys,
} from './helpers';
import { settleBinding } from '../payments';

// Привязка карты — единственное место, где приложение трогает деньги.
// Проверяется не «работает ли успешный сценарий», а то, что бывает при
// повторах и сбоях: уведомление провайдера доставляется минимум один раз,
// то есть иногда дважды.

initTestApp();
const db = getFirestore();

const UID = 'master-pay';
const app = () => db.doc(`masters/${UID}/verification/application`);

beforeEach(async () => {
  withProviderKeys();
  await wipe('masters', 'audit');
  await app().set({ status: 'draft', bindingState: 'pending', bindingPaymentId: 'pay_1' });
});

afterAll(withoutProviderKeys);

describe('успешный платёж', () => {
  test('карта привязывается, рубль возвращается', async () => {
    const provider = fakeProvider((path) => ({
      json: path.startsWith('/payments/') ? succeededPayment(UID) : { id: 'refund_1' },
    }));

    const result = await settleBinding('pay_1', 'test');

    expect(result).toBe('settled');
    const saved = await app().get();
    expect(saved.get('cardBindingId')).toBe('pm_saved_1');
    expect(saved.get('cardLast4')).toBe('4242');
    expect(saved.get('cardBrand')).toBe('MasterCard');
    expect(saved.get('bindingState')).toBe('succeeded');
    // Рубль был нужен только чтобы банк подтвердил карту
    expect(provider.of('/refunds')).toHaveLength(1);
    expect(saved.get('refundedPaymentId')).toBe('pay_1');
  });

  // Провайдер повторяет уведомление при любом не-200: сеть, деплой, холодный
  // старт. Раньше повтор делал второй возврат — ключ идемпотентности был
  // случайным, и провайдер считал операцию новой.
  test('повторное уведомление не делает второй возврат', async () => {
    const provider = fakeProvider((path) => ({
      json: path.startsWith('/payments/') ? succeededPayment(UID) : { id: 'refund_1' },
    }));

    await settleBinding('pay_1', 'test');
    await settleBinding('pay_1', 'test');
    await settleBinding('pay_1', 'test');

    expect(provider.of('/refunds')).toHaveLength(1);
  });

  test('ключ идемпотентности возврата привязан к платежу, а не случаен', async () => {
    const provider = fakeProvider((path) => ({
      json: path.startsWith('/payments/') ? succeededPayment(UID) : { id: 'refund_1' },
    }));

    await settleBinding('pay_1', 'test');

    expect(provider.of('/refunds')[0].idempotenceKey).toBe('refund-pay_1');
  });

  test('запись в заявку идемпотентна: те же значения, не дубли', async () => {
    fakeProvider((path) => ({
      json: path.startsWith('/payments/') ? succeededPayment(UID) : { id: 'refund_1' },
    }));

    await settleBinding('pay_1', 'test');
    const first = (await app().get()).data();
    await settleBinding('pay_1', 'test');
    const second = (await app().get()).data();

    expect(second!.cardBindingId).toBe(first!.cardBindingId);
    expect(second!.cardLast4).toBe(first!.cardLast4);
  });
});

describe('платёж не удался', () => {
  test('отменённый платёж закрывает попытку, карта не привязывается', async () => {
    const provider = fakeProvider(() => ({
      json: {
        id: 'pay_1',
        status: 'canceled',
        metadata: { uid: UID, purpose: 'master-verification' },
        cancellation_details: { reason: 'card_expired' },
      },
    }));

    const result = await settleBinding('pay_1', 'test');

    expect(result).toBe('canceled');
    const saved = await app().get();
    expect(saved.get('bindingState')).toBe('canceled');
    expect(saved.get('cardBindingId')).toBeUndefined();
    // Возвращать нечего: деньги не списывались
    expect(provider.of('/refunds')).toHaveLength(0);
  });

  test('незавершённый платёж оставляют в ожидании, а не хоронят', async () => {
    fakeProvider(() => ({
      json: {
        id: 'pay_1',
        status: 'pending',
        metadata: { uid: UID, purpose: 'master-verification' },
      },
    }));

    expect(await settleBinding('pay_1', 'test')).toBe('still-pending');
    expect((await app().get()).get('bindingState')).toBe('pending');
  });

  // Оплата прошла, но банк не сохранил способ оплаты. Привязки не вышло, а
  // деньги списаны — вернуть обязаны.
  test('оплата без сохранённой карты: попытка провалена, рубль возвращён', async () => {
    const provider = fakeProvider((path) => ({
      json: path.startsWith('/payments/')
        ? {
          id: 'pay_1',
          status: 'succeeded',
          metadata: { uid: UID, purpose: 'master-verification' },
          payment_method: {},
        }
        : { id: 'refund_1' },
    }));

    await settleBinding('pay_1', 'test');

    const saved = await app().get();
    expect(saved.get('bindingState')).toBe('failed');
    expect(saved.get('bindingError')).toBe('no-payment-method');
    expect(provider.of('/refunds')).toHaveLength(1);
  });

  // Возврат не прошёл — это чужие деньги, зависшие у провайдера. Отметка
  // нужна, чтобы сверка вернулась к ним в следующий прогон.
  test('неудавшийся возврат помечается для повтора', async () => {
    fakeProvider((path) => (path.startsWith('/payments/')
      ? { json: succeededPayment(UID) }
      : { ok: false, status: 500, json: { code: 'internal' } }));

    await settleBinding('pay_1', 'test');

    const saved = await app().get();
    // Карта привязана — неудача возврата этого не отменяет
    expect(saved.get('cardBindingId')).toBe('pm_saved_1');
    expect(saved.get('refundPending')).toBe(true);
    expect(saved.get('refundPendingPaymentId')).toBe('pay_1');
    expect(saved.get('refundedPaymentId')).toBeUndefined();
  });
});

describe('чужие и негодные платежи', () => {
  test('платёж не за привязку игнорируется', async () => {
    const provider = fakeProvider(() => ({
      json: { id: 'pay_1', status: 'succeeded', metadata: { purpose: 'что-то другое' } },
    }));

    expect(await settleBinding('pay_1', 'test')).toBe('ignored');
    expect(provider.of('/refunds')).toHaveLength(0);
    expect((await app().get()).get('cardBindingId')).toBeUndefined();
  });

  test('платёж без uid игнорируется', async () => {
    fakeProvider(() => ({
      json: { id: 'pay_1', status: 'succeeded', metadata: { purpose: 'master-verification' } },
    }));

    expect(await settleBinding('pay_1', 'test')).toBe('ignored');
  });

  // Аккаунт мог быть удалён, пока платёж шёл. Записывать некуда, но деньги
  // вернуть всё равно обязаны.
  test('исчезнувшая заявка не отменяет возврат', async () => {
    await app().delete();
    const provider = fakeProvider((path) => ({
      json: path.startsWith('/payments/') ? succeededPayment(UID) : { id: 'refund_1' },
    }));

    expect(await settleBinding('pay_1', 'test')).toBe('settled');
    expect(provider.of('/refunds')).toHaveLength(1);
    expect((await app().get()).exists).toBe(false);
  });

  test('без ключей провайдера ничего не делается', async () => {
    withoutProviderKeys();
    const provider = fakeProvider(() => ({ json: {} }));

    expect(await settleBinding('pay_1', 'test')).toBe('not-configured');
    expect(provider.calls).toHaveLength(0);
  });
});

describe('журнал', () => {
  test('успешная привязка и возврат записаны', async () => {
    fakeProvider((path) => ({
      json: path.startsWith('/payments/') ? succeededPayment(UID) : { id: 'refund_1' },
    }));

    await settleBinding('pay_1', 'corr-42');

    const entries = await db.collection('audit').where('correlationId', '==', 'corr-42').get();
    const actions = entries.docs.map((d) => d.get('action'));
    expect(actions).toContain('binding.settled');
    expect(actions).toContain('binding.refunded');
  });

  // Журнал переживает удаление аккаунта, поэтому персональных данных в нём
  // быть не должно — только идентификаторы
  test('в журнале нет номера карты', async () => {
    fakeProvider((path) => ({
      json: path.startsWith('/payments/') ? succeededPayment(UID) : { id: 'refund_1' },
    }));

    await settleBinding('pay_1', 'corr-43');

    const entries = await db.collection('audit').where('correlationId', '==', 'corr-43').get();
    entries.docs.forEach((d) => {
      expect(JSON.stringify(d.get('details'))).not.toContain('4242');
    });
  });
});
