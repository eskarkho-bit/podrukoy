import { getFirestore } from 'firebase-admin/firestore';
import { initTestApp, wipe } from './helpers';
import { notePaymentMarks, paymentTermsOf } from '../orderPayment';

// Отметки о расчёте — единственный след того, что деньги перешли из рук
// в руки: сервис их не видит. След обязан появляться ровно тогда, когда
// отметка поставлена, и не содержать ни номеров, ни сумм.

initTestApp();
const db = getFirestore();

const ORDER = {
  title: 'Не работает розетка',
  clientId: 'client-pay',
  masterId: 'master-pay',
  agreedPrice: 3500,
  status: 'Завершена',
  paymentMethod: 'transfer',
  masterPhone: '+79280001122',
};

const auditActions = async () =>
  (await db.collection('audit').get()).docs.map((d) => d.get('action') as string);

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
    await notePaymentMarks('o1', ORDER, { ...ORDER, status: 'Завершена' }, 'test');
    await notePaymentMarks(
      'o1',
      { ...ORDER, paidAt: new Date() },
      { ...ORDER, paidAt: new Date() },
      'test',
    );
    expect(await auditActions()).toEqual([]);
  });

  test('клиент отметил оплату — запись от его имени, только способ', async () => {
    await notePaymentMarks('o1', ORDER, { ...ORDER, paidAt: new Date() }, 'test');

    const entries = await db.collection('audit').get();
    expect(entries.size).toBe(1);
    const entry = entries.docs[0];
    expect(entry.get('action')).toBe('order.paid_marked');
    expect(entry.get('actorType')).toBe('user');
    expect(entry.get('actorUid')).toBe('client-pay');
    expect(entry.get('details')).toEqual({ method: 'transfer', masterId: 'master-pay' });
    // Ни телефона, ни суммы: журнал переживает удаление аккаунта
    const raw = JSON.stringify(entry.data());
    expect(raw).not.toContain('1122');
    expect(raw).not.toContain('3500');
  });

  test('мастер подтвердил получение — запись от его имени', async () => {
    await notePaymentMarks('o1', ORDER, { ...ORDER, paymentReceivedAt: new Date() }, 'test');

    const entries = await db.collection('audit').get();
    expect(entries.size).toBe(1);
    expect(entries.docs[0].get('action')).toBe('order.payment_received');
    expect(entries.docs[0].get('actorType')).toBe('user');
    expect(entries.docs[0].get('actorUid')).toBe('master-pay');
  });

  // Клиент мог подтвердить работу и отметить оплату одним нажатием
  test('обе отметки в одном обновлении — две записи', async () => {
    await notePaymentMarks(
      'o1',
      ORDER,
      { ...ORDER, paidAt: new Date(), paymentReceivedAt: new Date() },
      'test',
    );
    expect((await auditActions()).sort()).toEqual(['order.paid_marked', 'order.payment_received']);
  });

  test('без способа оплаты след всё равно есть', async () => {
    const { paymentMethod, ...noMethod } = ORDER;
    void paymentMethod;
    await notePaymentMarks('o1', noMethod, { ...noMethod, paidAt: new Date() }, 'test');

    const entries = await db.collection('audit').get();
    expect(entries.docs[0].get('details')).toEqual({ method: null, masterId: 'master-pay' });
  });
});
