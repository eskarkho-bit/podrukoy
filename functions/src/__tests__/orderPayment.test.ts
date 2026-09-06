import { getFirestore } from 'firebase-admin/firestore';
import { initTestApp, wipe } from './helpers';
import { notePaymentMarks, paymentTermsOf } from '../orderPayment';

// Отметки о расчёте — единственный след того, что деньги перешли из рук
// в руки: сервис их не видит. След обязан появляться ровно тогда, когда
// отметка поставлена, и не содержать ни номеров, ни сумм.

initTestApp();
const db = getFirestore();

// Свой идентификатор заявки: журнал общий на все файлы, и записи ищутся по
// нему, а не по «первая попавшаяся»
const ORDER_ID = 'pay-order-1';

const ORDER = {
  title: 'Не работает розетка',
  clientId: 'client-pay',
  masterId: 'master-pay',
  agreedPrice: 3500,
  status: 'Завершена',
  paymentMethod: 'transfer',
  masterPhone: '+79280001122',
};

const entriesFor = async (action: string) =>
  (await db.collection('audit').where('subjectId', '==', ORDER_ID).get()).docs.filter(
    (d) => d.get('action') === action,
  );

beforeEach(async () => {
  await wipe('audit', 'users');
});

describe('paymentTermsOf', () => {
  test('нет документа — null; чужие банки отсеиваются; наличные по умолчанию', () => {
    expect(paymentTermsOf(undefined)).toBeNull();
    expect(paymentTermsOf({ banks: ['sber', 'левый', 7] })).toEqual({
      banks: ['sber'],
      acceptsCash: true,
    });
    expect(paymentTermsOf({ acceptsCash: false })).toEqual({ banks: [], acceptsCash: false });
  });
});

describe('notePaymentMarks', () => {
  test('без новых отметок журнал молчит', async () => {
    await notePaymentMarks(ORDER_ID, ORDER, { ...ORDER, status: 'Завершена' }, 'test');
    await notePaymentMarks(
      ORDER_ID,
      { ...ORDER, paidAt: new Date() },
      { ...ORDER, paidAt: new Date() },
      'test',
    );
    expect(await entriesFor('order.paid_marked')).toHaveLength(0);
    expect(await entriesFor('order.payment_received')).toHaveLength(0);
  });

  test('клиент отметил оплату — запись от его имени, только способ', async () => {
    await notePaymentMarks(ORDER_ID, ORDER, { ...ORDER, paidAt: new Date() }, 'test');

    const entries = await entriesFor('order.paid_marked');
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.get('actorType')).toBe('user');
    expect(entry.get('actorUid')).toBe('client-pay');
    expect(entry.get('details')).toEqual({ method: 'transfer', masterId: 'master-pay' });
    // Ни телефона, ни суммы: журнал переживает удаление аккаунта
    const raw = JSON.stringify(entry.data());
    expect(raw).not.toContain('1122');
    expect(raw).not.toContain('3500');
    expect(await entriesFor('order.payment_received')).toHaveLength(0);
  });

  test('мастер подтвердил получение — запись от его имени', async () => {
    await notePaymentMarks(ORDER_ID, ORDER, { ...ORDER, paymentReceivedAt: new Date() }, 'test');

    const entries = await entriesFor('order.payment_received');
    expect(entries).toHaveLength(1);
    expect(entries[0].get('actorType')).toBe('user');
    expect(entries[0].get('actorUid')).toBe('master-pay');
    expect(await entriesFor('order.paid_marked')).toHaveLength(0);
  });

  // Клиент мог подтвердить работу и отметить оплату одним нажатием
  test('обе отметки в одном обновлении — две записи', async () => {
    await notePaymentMarks(
      ORDER_ID,
      ORDER,
      { ...ORDER, paidAt: new Date(), paymentReceivedAt: new Date() },
      'test',
    );
    expect(await entriesFor('order.paid_marked')).toHaveLength(1);
    expect(await entriesFor('order.payment_received')).toHaveLength(1);
  });

  test('без способа оплаты след всё равно есть', async () => {
    const { paymentMethod, ...noMethod } = ORDER;
    void paymentMethod;
    await notePaymentMarks(ORDER_ID, noMethod, { ...noMethod, paidAt: new Date() }, 'test');

    const [entry] = await entriesFor('order.paid_marked');
    expect(entry.get('details')).toEqual({ method: null, masterId: 'master-pay' });
  });
});
