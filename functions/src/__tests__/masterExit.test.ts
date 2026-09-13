import { getFirestore } from 'firebase-admin/firestore';
import { fakeProvider, initTestApp, wipe } from './helpers';
import { detachMasterFromOrders, dropPendingOffers } from '../masterExit';

// Исчезновение мастера. Заявка «В работе» возвращается в поиск — и в этот
// момент её снова читают все мастера города, поэтому телефоны обеих сторон
// обязаны исчезнуть вместе с исполнителем. Из закрытых заявок уходит только
// его номер: звонить больше некому, а работа и история расчётов остаются.

initTestApp();
const db = getFirestore();

const MASTER = 'master-exit';

beforeEach(async () => {
  await wipe('orders', 'users', 'masters');
  fakeProvider((_path, body) => ({
    json: { data: (body as unknown[]).map(() => ({ status: 'ok' })) },
  }));

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
    masterBanks: ['sber'],
    masterAcceptsCash: true,
  });
  await db.doc('orders/done').set({
    clientId: 'c3',
    masterId: MASTER,
    masterName: 'Иван',
    status: 'Завершена',
    masterPhone: '+79280001122',
    masterBanks: ['sber'],
    masterAcceptsCash: true,
  });
  // Номер уже снят прежним прогоном, условия оплаты остались
  await db.doc('orders/done-terms-only').set({
    clientId: 'c5',
    masterId: MASTER,
    status: 'Завершена',
    masterPhone: null,
    masterBanks: ['tbank'],
    masterAcceptsCash: false,
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
    // Переводить тоже некому — условия оплаты уходят вместе с номером
    expect(order.get('masterBanks')).toBeNull();
    expect(order.get('masterAcceptsCash')).toBeNull();
    // Номер клиента остаётся: заявку читают только он сам и никто больше
    expect(order.get('clientPhone')).toBe('+79991234567');
  });

  test('из завершённых заявок номер и условия оплаты мастера тоже уходят', async () => {
    await detachMasterFromOrders(MASTER);
    const done = await db.doc('orders/done').get();
    expect(done.get('masterPhone')).toBeNull();
    expect(done.get('masterBanks')).toBeNull();
    // Заявка, где номера уже не было, а условия ещё лежали
    expect((await db.doc('orders/done-terms-only').get()).get('masterBanks')).toBeNull();
  });

  // Деньги уже переходили из рук в руки — в поиск такую заявку не вернуть,
  // новый исполнитель увидел бы её «оплаченной»
  test('оплаченная работа закрывается, а не ищет нового исполнителя', async () => {
    await db.doc('orders/in-work-paid').set({
      clientId: 'c6',
      masterId: MASTER,
      masterName: 'Иван',
      status: 'В работе',
      paidAt: new Date(),
      paymentMethod: 'transfer',
      masterPhone: '+79280001122',
      clientPhone: '+79991234567',
      masterBanks: ['sber'],
    });
    await db.doc('users/c6').set({ pushTokens: ['ExponentPushToken[c6]'] });
    const net = fakeProvider((_path, body) => ({
      json: { data: (body as unknown[]).map(() => ({ status: 'ok' })) },
    }));

    expect(await detachMasterFromOrders(MASTER)).toBe(1);

    const order = await db.doc('orders/in-work-paid').get();
    expect(order.get('status')).toBe('Отменена');
    // Кому платили — остаётся: без этого спор не разобрать
    expect(order.get('masterId')).toBe(MASTER);
    expect(order.get('paidAt')).toBeTruthy();
    expect(order.get('masterPhone')).toBeNull();
    expect(order.get('clientPhone')).toBeNull();
    const sent = net.of('exp.host').flatMap((c) => c.body as { to: string; title: string }[]);
    expect(sent.find((m) => m.to === 'ExponentPushToken[c6]')?.title).toBe('Мастер удалил аккаунт');
  });

  // Заявка снова в поиске — остальные мастера города узнают о ней заново
  test('о возвращённой в поиск заявке узнают остальные мастера', async () => {
    await db.doc('masters/m-other').set({ name: 'Пётр', verified: true, cities: [], skills: [] });
    await db.doc('users/m-other').set({ pushTokens: ['ExponentPushToken[other]'] });
    const net = fakeProvider((_path, body) => ({
      json: { data: (body as unknown[]).map(() => ({ status: 'ok' })) },
    }));

    await detachMasterFromOrders(MASTER);

    const sent = net.of('exp.host').flatMap((c) => c.body as { to: string; title: string }[]);
    expect(sent.filter((m) => m.to === 'ExponentPushToken[other]').map((m) => m.title)).toEqual([
      'Заявка снова ищет мастера',
    ]);
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
