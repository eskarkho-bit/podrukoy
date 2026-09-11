import { getFirestore } from 'firebase-admin/firestore';
import { fakeProvider, initTestApp, wipe } from './helpers';
import { notifyMastersAbout } from '../orderPush';

// Рассылка о новой заявке. Здесь важно то, что не видно в приложении: кого
// сервер зовёт, а кого обходит — заблокированного клиентом мастера правила
// всё равно не пустят к предложению, и звать его значило бы звать в
// закрытую дверь.

initTestApp();
const db = getFirestore();

const CLIENT = 'client-push';

beforeEach(async () => {
  await wipe('masters', 'users');
  for (const id of ['m-ok', 'm-blocked', 'm-other-city']) {
    await db.doc(`masters/${id}`).set({
      name: id,
      verified: true,
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
