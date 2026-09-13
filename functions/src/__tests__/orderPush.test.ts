import { getFirestore } from 'firebase-admin/firestore';
import { fakeProvider, initTestApp, wipe } from './helpers';
import { notifyMastersAbout, orderBurstExceeded, ORDER_BURST_LIMIT } from '../orderPush';

// Рассылка о новой заявке. Здесь важно то, что не видно в приложении: кого
// сервер зовёт, а кого обходит — заблокированного клиентом мастера правила
// всё равно не пустят к предложению, и звать его значило бы звать в
// закрытую дверь.

initTestApp();
const db = getFirestore();

const CLIENT = 'client-push';

beforeEach(async () => {
  await wipe('masters', 'users', 'meters');
  for (const id of ['m-ok', 'm-blocked', 'm-other-city', 'm-unverified', 'm-suspended']) {
    await db.doc(`masters/${id}`).set({
      name: id,
      verified: id !== 'm-unverified',
      blocked: id === 'm-suspended',
      cities: [id === 'm-other-city' ? 'аргун' : 'грозный'],
      skills: ['электрика'],
    });
    await db.doc(`users/${id}`).set({ pushTokens: [`ExponentPushToken[${id}]`] });
  }
  await db.doc(`users/${CLIENT}`).set({ blockedMasters: ['m-blocked'] });
});

const order = {
  clientId: CLIENT,
  title: 'Розетка',
  city: 'грозный',
  category: 'электрика',
  status: 'Поиск мастера',
};

test('заблокированный клиентом мастер о заявке не узнаёт, подходящий — узнаёт', async () => {
  const net = fakeProvider((_path, body) => ({
    json: { data: (body as unknown[]).map(() => ({ status: 'ok' })) },
  }));

  const notified = await notifyMastersAbout(order, 'Новая заявка рядом');

  expect(notified).toBe(1);
  const sent = net.of('exp.host').flatMap((c) => c.body as { to: string }[]);
  expect(sent.map((m) => m.to)).toEqual(['ExponentPushToken[m-ok]']);
});

// Непроверенного и отстранённого правила к предложению не пустят — звать их
// значит звать в закрытую дверь
test('непроверенный и отстранённый мастера о заявке не узнают', async () => {
  await db.doc(`users/${CLIENT}`).set({});
  const net = fakeProvider((_path, body) => ({
    json: { data: (body as unknown[]).map(() => ({ status: 'ok' })) },
  }));

  await notifyMastersAbout(order, 'Новая заявка рядом');

  const sent = net.of('exp.host').flatMap((c) => c.body as { to: string }[]);
  expect(sent.map((m) => m.to)).not.toContain('ExponentPushToken[m-unverified]');
  expect(sent.map((m) => m.to)).not.toContain('ExponentPushToken[m-suspended]');
});

// Заявка без города в ленте видна только мастерам без ограничения по городу —
// им она и уходит; остальные её бы не нашли
test('заявку без города получают только мастера без привязки к городу', async () => {
  await db.doc(`users/${CLIENT}`).set({});
  await db.doc('masters/m-anywhere').set({ name: 'Везде', verified: true, cities: [], skills: [] });
  await db.doc('users/m-anywhere').set({ pushTokens: ['ExponentPushToken[m-anywhere]'] });
  const net = fakeProvider((_path, body) => ({
    json: { data: (body as unknown[]).map(() => ({ status: 'ok' })) },
  }));

  const notified = await notifyMastersAbout({ ...order, city: '' }, 'Новая заявка рядом');

  expect(notified).toBe(1);
  const sent = net.of('exp.host').flatMap((c) => c.body as { to: string }[]);
  expect(sent.map((m) => m.to)).toEqual(['ExponentPushToken[m-anywhere]']);
});

// Один аккаунт не должен будить всех мастеров города каждую минуту
test('лимит рассылок на клиента: сверх него заявки не рассылаются', async () => {
  for (let i = 0; i < ORDER_BURST_LIMIT; i++) {
    expect(await orderBurstExceeded(CLIENT)).toBe(false);
  }
  expect(await orderBurstExceeded(CLIENT)).toBe(true);
  // Другого клиента чужой лимит не касается
  expect(await orderBurstExceeded('someone-else')).toBe(false);
});

test('без списка блокировок у клиента рассылка идёт всем подходящим', async () => {
  await db.doc(`users/${CLIENT}`).set({});
  const net = fakeProvider((_path, body) => ({
    json: { data: (body as unknown[]).map(() => ({ status: 'ok' })) },
  }));

  const notified = await notifyMastersAbout(order, 'Новая заявка рядом');

  expect(notified).toBe(2);
  const sent = net.of('exp.host').flatMap((c) => c.body as { to: string }[]);
  expect(sent.map((m) => m.to).sort()).toEqual([
    'ExponentPushToken[m-blocked]',
    'ExponentPushToken[m-ok]',
  ]);
});
