import { getFirestore } from 'firebase-admin/firestore';
import { fakeProvider, initTestApp, wipe } from './helpers';
import { handleMasterDecline } from '../orderDecline';

// Отказ мастера от взятой заявки. Тихие исходы, ради которых тесты: номер
// клиента, оставшийся в заявке, которую снова читают все мастера города;
// предложение, которое клиент выбирает второй раз; двойной пуш при повторе.

initTestApp();
const db = getFirestore();

const MASTER = 'master-decline';
const CLIENT = 'client-decline';

const seed = (patch: Record<string, unknown> = {}) =>
  db.doc('orders/o1').set({
    clientId: CLIENT,
    title: 'Розетка',
    status: 'В работе',
    masterId: MASTER,
    masterName: 'Иван',
    agreedPrice: 3500,
    masterPhone: '+79280001122',
    clientPhone: '+79991234567',
    masterBanks: ['sber'],
    masterAcceptsCash: true,
    masterDeclinedAt: new Date(),
    ...patch,
  });

// Пара before/after такая, какой её видит триггер: отметка появилась
const event = async () => {
  const after = (await db.doc('orders/o1').get()).data()!;
  return { before: { ...after, masterDeclinedAt: null }, after };
};

beforeEach(async () => {
  await wipe('orders', 'users', 'audit', 'masters');
  await db.doc(`users/${CLIENT}`).set({ pushTokens: ['ExponentPushToken[client]'] });
  await seed();
  await db.doc(`orders/o1/offers/${MASTER}`).set({ masterId: MASTER, status: 'accepted' });
});

test('заявка возвращается в поиск без мастера, контактов и его предложения', async () => {
  fakeProvider(() => ({ json: { data: [{ status: 'ok' }] } }));
  const { before, after } = await event();

  expect(await handleMasterDecline('o1', before, after, 'test')).toBe(true);

  const order = await db.doc('orders/o1').get();
  expect(order.get('status')).toBe('Поиск мастера');
  expect(order.get('masterId')).toBeNull();
  expect(order.get('agreedPrice')).toBeNull();
  expect(order.get('masterPhone')).toBeNull();
  expect(order.get('clientPhone')).toBeNull();
  expect(order.get('masterBanks')).toBeNull();
  expect(order.get('masterDeclinedAt')).toBeNull();
  expect((await db.doc(`orders/o1/offers/${MASTER}`).get()).exists).toBe(false);
});

test('клиент получает пуш, в журнале — отказ с мастером и без номеров', async () => {
  const net = fakeProvider(() => ({ json: { data: [{ status: 'ok' }] } }));
  const { before, after } = await event();

  await handleMasterDecline('o1', before, after, 'test');

  const sent = net.of('exp.host').flatMap((c) => c.body as { to: string; title: string }[]);
  expect(sent).toHaveLength(1);
  expect(sent[0].to).toBe('ExponentPushToken[client]');
  expect(sent[0].title).toBe('Мастер отказался от заявки');

  const entries = await db.collection('audit').get();
  const entry = entries.docs.find((d) => d.get('action') === 'order.master_declined');
  expect(entry?.get('details')).toEqual({ masterId: MASTER });
  expect(JSON.stringify(entry?.data())).not.toContain('1122');
});

// Событие доставляется минимум один раз
test('повтор доставки не шлёт второй пуш и не пишет вторую запись', async () => {
  const net = fakeProvider(() => ({ json: { data: [{ status: 'ok' }] } }));
  const { before, after } = await event();

  await handleMasterDecline('o1', before, after, 'test');
  await handleMasterDecline('o1', before, after, 'test');

  expect(net.of('exp.host')).toHaveLength(1);
  const entries = await db.collection('audit').get();
  expect(entries.docs.filter((d) => d.get('action') === 'order.master_declined')).toHaveLength(1);
});

// Заявка снова в поиске — остальные мастера должны узнать об этом так же,
// как о новой: при создании она ушла к другому, и о ней забыли
test('остальные мастера узнают, что заявка снова ищет исполнителя', async () => {
  const net = fakeProvider((_path, body) => ({
    json: { data: (body as unknown[]).map(() => ({ status: 'ok' })) },
  }));
  await db.doc('masters/m-other').set({ name: 'Пётр', verified: true, cities: [], skills: [] });
  await db.doc('users/m-other').set({ pushTokens: ['ExponentPushToken[other]'] });
  // Сам отказавшийся о своей заявке второй раз не слышит
  await db.doc(`masters/${MASTER}`).set({ name: 'Иван', verified: true, cities: [], skills: [] });
  await db.doc(`users/${MASTER}`).set({ pushTokens: ['ExponentPushToken[declined]'] });
  const { before, after } = await event();

  await handleMasterDecline('o1', before, after, 'test');

  const sent = net.of('exp.host').flatMap((c) => c.body as { to: string; title: string }[]);
  expect(sent.map((m) => m.to).sort()).toEqual([
    'ExponentPushToken[client]',
    'ExponentPushToken[other]',
  ]);
  expect(sent.find((m) => m.to === 'ExponentPushToken[other]')?.title).toBe(
    'Заявка снова ищет мастера',
  );
});

// Деньги уже переходили из рук в руки — новый исполнитель увидел бы заявку
// «оплаченной». Правила такую отметку не пропускают; сервер — тоже.
test('после отметки об оплате заявка в поиск не возвращается', async () => {
  const net = fakeProvider(() => ({ json: { data: [{ status: 'ok' }] } }));
  await seed({ paidAt: new Date(), paymentMethod: 'transfer' });
  const { before, after } = await event();

  expect(await handleMasterDecline('o1', before, after, 'test')).toBe(true);

  const order = await db.doc('orders/o1').get();
  expect(order.get('status')).toBe('В работе');
  expect(order.get('masterId')).toBe(MASTER);
  expect(net.calls).toHaveLength(0);
});

test('заявка уже не в работе — не трогается', async () => {
  const net = fakeProvider(() => ({ json: { data: [{ status: 'ok' }] } }));
  const { before, after } = await event();
  await db.doc('orders/o1').set({ status: 'Ждёт подтверждения' }, { merge: true });

  expect(await handleMasterDecline('o1', before, after, 'test')).toBe(true);

  const order = await db.doc('orders/o1').get();
  expect(order.get('status')).toBe('Ждёт подтверждения');
  expect(order.get('masterId')).toBe(MASTER);
  expect(net.calls).toHaveLength(0);
});

test('событие без отметки — не отказ', async () => {
  const { after } = await event();
  expect(await handleMasterDecline('o1', after, after, 'test')).toBe(false);
});
