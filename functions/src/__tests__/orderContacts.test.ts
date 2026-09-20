import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initTestApp, wipe } from './helpers';
import { normalizePhone, shareOrderContacts } from '../orderContacts';

// Телефоны сторон в заявке. Ошибка здесь — это либо звонок в никуда, либо
// номер клиента, видимый всем мастерам города: оба исхода тихие, поэтому
// каждый шаг закрыт тестом.

initTestApp();
const db = getFirestore();

const MASTER = 'master-contact';
const CLIENT = 'client-contact';
const CLIENT_PHONE = '+79991234567';

beforeAll(async () => {
  // Клиент с номером — как после входа по телефону: номер живёт в Auth
  try {
    await getAuth().createUser({ uid: CLIENT, phoneNumber: CLIENT_PHONE });
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/uid-already-exists') throw e;
  }
});

beforeEach(async () => {
  await wipe('orders', 'masters', 'audit');
  await db.doc(`masters/${MASTER}`).set({ name: 'Иван', verified: true });
  await db.doc(`masters/${MASTER}/verification/application`).set({ phone: '79280001122' });
});

describe('normalizePhone', () => {
  test('приводит любой пригодный вид к +7', () => {
    expect(normalizePhone('79280001122')).toBe('+79280001122');
    expect(normalizePhone('89280001122')).toBe('+79280001122');
    expect(normalizePhone('9280001122')).toBe('+79280001122');
    expect(normalizePhone('+7 928 000-11-22')).toBe('+79280001122');
  });

  test('непригодное не превращает в номер', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(42)).toBeNull();
  });
});

describe('shareOrderContacts', () => {
  const seedOrder = (patch: Record<string, unknown> = {}) =>
    db.doc('orders/o1').set({
      clientId: CLIENT,
      masterId: MASTER,
      status: 'В работе',
      ...patch,
    });

  test('кладёт в заявку оба номера в виде для звонилки', async () => {
    await seedOrder();
    await shareOrderContacts('o1', 'test');

    const order = await db.doc('orders/o1').get();
    expect(order.get('masterPhone')).toBe('+79280001122');
    expect(order.get('clientPhone')).toBe(CLIENT_PHONE);
  });

  // Триггер доставляется минимум один раз — повтор не должен ничего менять
  test('повторная доставка перезаписывает те же значения', async () => {
    await seedOrder();
    await shareOrderContacts('o1', 'test');
    await shareOrderContacts('o1', 'test');

    const order = await db.doc('orders/o1').get();
    expect(order.get('masterPhone')).toBe('+79280001122');
    expect(order.get('clientPhone')).toBe(CLIENT_PHONE);
  });

  test('почтовый клиент без номера — есть только телефон мастера', async () => {
    await seedOrder({ clientId: 'client-nophone' });
    await shareOrderContacts('o1', 'test');

    const order = await db.doc('orders/o1').get();
    expect(order.get('masterPhone')).toBe('+79280001122');
    expect(order.get('clientPhone')).toBeNull();
  });

  test('без единого номера заявка не трогается', async () => {
    await db.doc(`masters/${MASTER}/verification/application`).set({ phone: '' });
    await seedOrder({ clientId: 'client-nophone' });
    await shareOrderContacts('o1', 'test');

    const order = await db.doc('orders/o1').get();
    expect(order.data()).not.toHaveProperty('masterPhone');
    expect(order.data()).not.toHaveProperty('clientPhone');
  });

  // Мастер мог удалить аккаунт, пока событие ехало: заявка снова открыта,
  // её читают все мастера города — номера в неё попасть не должны
  // Пока событие ехало, клиент отменил заявку — номера в неё уже не кладут
  test('в отменённую заявку номера не пишутся', async () => {
    await seedOrder({ status: 'Отменена' });
    await shareOrderContacts('o1', 'test');
    const order = await db.doc('orders/o1').get();
    expect(order.get('masterPhone')).toBeUndefined();
    expect(order.get('clientPhone')).toBeUndefined();
  });

  test('в заявку без мастера номера не пишутся', async () => {
    await seedOrder({ masterId: null, status: 'Поиск мастера' });
    await shareOrderContacts('o1', 'test');

    const order = await db.doc('orders/o1').get();
    expect(order.data()).not.toHaveProperty('clientPhone');
  });

  test('в журнале — только факт, без самих номеров', async () => {
    await seedOrder();
    await shareOrderContacts('o1', 'test');

    const entries = await db.collection('audit').get();
    const entry = entries.docs.find((d) => d.get('action') === 'order.contacts_shared');
    expect(entry).toBeTruthy();
    expect(entry?.get('details')).toEqual({
      hasMasterPhone: true,
      hasClientPhone: true,
      hasPaymentTerms: false,
    });
    expect(JSON.stringify(entry?.data())).not.toContain('1122');
  });

  // Как мастер принимает оплату, лежит в закрытой подколлекции — клиент
  // видит только копию в своей заявке, и кладёт её тот же серверный шаг
  test('вместе с номером в заявку едут банки и наличные мастера', async () => {
    await db
      .doc(`masters/${MASTER}/payment/details`)
      .set({ banks: ['tbank', 'sber', 'чужой-банк'], acceptsCash: false });
    await seedOrder();
    await shareOrderContacts('o1', 'test');

    const order = await db.doc('orders/o1').get();
    expect(order.get('masterBanks')).toEqual(['tbank', 'sber']);
    expect(order.get('masterAcceptsCash')).toBe(false);

    const entries = await db.collection('audit').get();
    const entry = entries.docs.find((d) => d.get('action') === 'order.contacts_shared');
    expect(entry?.get('details')).toMatchObject({ hasPaymentTerms: true });
  });

  test('мастер без настроек оплаты — в заявке честные null, а не пустые списки', async () => {
    await seedOrder();
    await shareOrderContacts('o1', 'test');

    const order = await db.doc('orders/o1').get();
    expect(order.get('masterBanks')).toBeNull();
    expect(order.get('masterAcceptsCash')).toBeNull();
  });

  // Телефонов нет, а условия оплаты есть: писать всё равно есть что
  test('условия оплаты пишутся и без единого номера', async () => {
    await db.doc(`masters/${MASTER}/verification/application`).set({ phone: '' });
    await db.doc(`masters/${MASTER}/payment/details`).set({ banks: ['vtb'], acceptsCash: true });
    await seedOrder({ clientId: 'client-nophone' });
    await shareOrderContacts('o1', 'test');

    const order = await db.doc('orders/o1').get();
    expect(order.get('masterPhone')).toBeNull();
    expect(order.get('masterBanks')).toEqual(['vtb']);
  });
});
