import { getFirestore } from 'firebase-admin/firestore';
import { fakeProvider, initTestApp, wipe } from './helpers';
import { pushTo } from '../push';

// Выключатель «Push-уведомления» в профиле. Проверяется единственное, что
// в нём важно: выключенному не уходит ничего, включённому — как раньше, и
// токены выключенного остаются на месте — включит обратно без перерегистрации.

initTestApp();
const db = getFirestore();

const okTickets = (body: { to: string }[]) => ({
  json: { data: body.map(() => ({ status: 'ok' })) },
});

beforeEach(async () => {
  await wipe('users');
  await db.doc('users/u-on').set({ pushTokens: ['ExponentPushToken[on]'] });
  await db.doc('users/u-off').set({ pushTokens: ['ExponentPushToken[off]'], pushOff: true });
  // Профиль без поля — как у зарегистрировавшихся до появления выключателя
  await db.doc('users/u-old').set({ pushTokens: ['ExponentPushToken[old]'] });
});

test('выключенному в профиле пуш не уходит, остальным — уходит', async () => {
  const net = fakeProvider((_path, body) => okTickets(body));

  await pushTo(['u-on', 'u-off', 'u-old'], 'Заголовок', 'Текст', { href: '/' });

  const sent = net.of('exp.host').flatMap((c) => c.body as { to: string }[]);
  expect(sent.map((m) => m.to).sort()).toEqual(['ExponentPushToken[old]', 'ExponentPushToken[on]']);
});

test('если все получатели выключили пуши, наружу не ходим вовсе', async () => {
  const net = fakeProvider((_path, body) => okTickets(body));

  await pushTo(['u-off'], 'Заголовок', 'Текст', { href: '/' });

  expect(net.calls).toHaveLength(0);
});

test('токены выключенного остаются — включит обратно без перерегистрации', async () => {
  fakeProvider((_path, body) => okTickets(body));

  await pushTo(['u-off'], 'Заголовок', 'Текст', { href: '/' });

  const user = await db.doc('users/u-off').get();
  expect(user.get('pushTokens')).toEqual(['ExponentPushToken[off]']);
});
