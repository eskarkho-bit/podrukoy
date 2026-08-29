import { getFirestore } from 'firebase-admin/firestore';
import { initTestApp, wipe } from './helpers';
import { detachMasterFromOrders, dropPendingOffers } from '../masterExit';

// Исчезновение мастера. Заявка «В работе» возвращается в поиск — и в этот
// момент её снова читают все мастера города, поэтому телефоны обеих сторон
// обязаны исчезнуть вместе с исполнителем. Из закрытых заявок уходит только
// его номер: звонить больше некому, а работа и история расчётов остаются.

initTestApp();
const db = getFirestore();

const MASTER = 'master-exit';

beforeEach(async () => {
  await wipe('orders', 'users');

  await db.doc('orders/in-work').set({
    clientId: 'c1',
    masterId: MASTER,
    masterName: 'Иван',
    status: 'В работе',
    agreedPrice: 2500,
    masterPhone: '+79280001122',
    clientPhone: '+79991234567',
  });
  await db.doc('orders/awaiting').set({
    clientId: 'c2',
    masterId: MASTER,
    masterName: 'Иван',
    status: 'Ждёт подтверждения',
    masterPhone: '+79280001122',
    clientPhone: '+79991234567',
  });
  await db.doc('orders/done').set({
    clientId: 'c3',
    masterId: MASTER,
    masterName: 'Иван',
    status: 'Завершена',
    masterPhone: '+79280001122',
  });
  await db.doc('orders/foreign').set({
    clientId: 'c4',
    masterId: 'другой-мастер',
    status: 'В работе',
    masterPhone: '+79995556677',
  });
});

describe('detachMasterFromOrders', () => {
  test('работа возвращается в поиск без следов исполнителя и номеров', async () => {
    expect(await detachMasterFromOrders(MASTER)).toBe(1);

    const order = await db.doc('orders/in-work').get();
    expect(order.get('status')).toBe('Поиск мастера');
    expect(order.get('masterId')).toBeNull();
    expect(order.get('masterName')).toBeNull();
    expect(order.get('agreedPrice')).toBeNull();
    expect(order.get('masterPhone')).toBeNull();
    // Открытую заявку снова читают все мастера города — номер клиента ушёл
    expect(order.get('clientPhone')).toBeNull();
  });

  test('сданная работа остаётся у клиента, но телефон мастера уходит', async () => {
    await detachMasterFromOrders(MASTER);

    const order = await db.doc('orders/awaiting').get();
    expect(order.get('status')).toBe('Ждёт подтверждения');
    expect(order.get('masterName')).toBe('Иван');
    expect(order.get('masterPhone')).toBeNull();
    // Номер клиента остаётся: заявку читают только он сам и никто больше
    expect(order.get('clientPhone')).toBe('+79991234567');
  });

  test('из завершённых заявок номер мастера тоже уходит', async () => {
    await detachMasterFromOrders(MASTER);
    expect((await db.doc('orders/done').get()).get('masterPhone')).toBeNull();
  });

  test('чужие заявки не тронуты', async () => {
    await detachMasterFromOrders(MASTER);

    const foreign = await db.doc('orders/foreign').get();
    expect(foreign.get('status')).toBe('В работе');
    expect(foreign.get('masterPhone')).toBe('+79995556677');
  });

  // Событие удаления доставляется минимум один раз
  test('повторный прогон ничего не ломает', async () => {
    await detachMasterFromOrders(MASTER);
    expect(await detachMasterFromOrders(MASTER)).toBe(0);

    const order = await db.doc('orders/in-work').get();
    expect(order.get('status')).toBe('Поиск мастера');
  });
});

describe('dropPendingOffers', () => {
  beforeEach(async () => {
    await db.doc('orders/open-x').set({ clientId: 'c9', status: 'Поиск мастера' });
    await db
      .doc(`orders/open-x/offers/${MASTER}`)
      .set({ masterId: MASTER, status: 'pending', price: 500 });
    await db
      .doc('orders/open-x/offers/other')
      .set({ masterId: 'другой-мастер', status: 'pending', price: 700 });
    await db
      .doc(`orders/done/offers/${MASTER}`)
      .set({ masterId: MASTER, status: 'accepted', price: 900 });
  });

  // Удаление, снятие допуска и блокировка зовут одно и то же: за новое
  // браться нельзя, а принятое предложение — уже сделка, его не трогаем
  test('снимает только неотвеченные предложения этого мастера', async () => {
    expect(await dropPendingOffers(MASTER)).toBe(1);

    expect((await db.doc(`orders/open-x/offers/${MASTER}`).get()).exists).toBe(false);
    expect((await db.doc('orders/open-x/offers/other').get()).exists).toBe(true);
    expect((await db.doc(`orders/done/offers/${MASTER}`).get()).exists).toBe(true);
  });

  test('повтор находит пустоту и ничего не ломает', async () => {
    await dropPendingOffers(MASTER);
    expect(await dropPendingOffers(MASTER)).toBe(0);
  });
});
