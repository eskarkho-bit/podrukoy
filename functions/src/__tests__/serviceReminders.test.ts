import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { fakeProvider, initTestApp, wipe } from './helpers';
import { runServiceReminders } from '../serviceReminders';

// Напоминания о повторяемых работах. Проверяется то, что отделяет напоминание
// от спама: ровно один раз на заявку, молчание вне сезона, молчание при уже
// созданной новой заявке и уважение к выключателю в профиле.
//
// Время передаётся в прогон снаружи: сезонность зависит от календаря, и тест,
// зелёный летом и красный зимой, не тест вовсе.

initTestApp();
const db = getFirestore();

// Июльский полдень по Москве: сезон стрижки газона в разгаре
const SUMMER = new Date('2026-07-15T09:00:00Z');
// Тот же час в январе: газон стоит до весны
const WINTER = new Date('2026-01-15T09:00:00Z');

const daysAgo = (days: number, from: Date = SUMMER) =>
  Timestamp.fromMillis(from.getTime() - days * 24 * 60 * 60 * 1000);

/** Завершённая месяц назад стрижка газона — эталонный кандидат на напоминание. */
const mowing = (id: string, data: Record<string, unknown> = {}) =>
  db.doc(`orders/${id}`).set({
    status: 'Завершена',
    title: 'Газон · Стрижка · Разовая',
    objectId: 'lawn',
    serviceLabel: 'Стрижка',
    category: 'участок',
    city: 'грозный',
    clientId: 'client1',
    createdAt: daysAgo(30),
    completedAt: daysAgo(28),
    ...data,
  });

const client = (data: Record<string, unknown> = {}) =>
  db.doc('users/client1').set({ pushTokens: ['ExponentPushToken[c1]'], ...data });

const run = (now: Date = SUMMER) => runServiceReminders(now, 'reminders-test');

const pushesOf = (provider: ReturnType<typeof fakeProvider>) =>
  provider.calls.filter((c) => c.path.includes('exp.host'));

const actions = async () => {
  const snap = await db.collection('audit').get();
  return snap.docs.map((d) => d.get('action'));
};

beforeEach(async () => {
  await wipe('orders', 'users', 'audit');
});

describe('напоминание о стрижке газона', () => {
  test('через месяц после стрижки клиенту приходит пуш', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1');
    await client();

    const counters = await run();

    expect(counters.remindersSent).toBe(1);
    const pushes = pushesOf(provider);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body[0].to).toBe('ExponentPushToken[c1]');
    // Отметка на заявке — то, что делает повтор невозможным
    expect((await db.doc('orders/o1').get()).get('reminderSentAt')).toBeTruthy();
    expect(await actions()).toContain('order.reminder_sent');
  });

  test('второй прогон молчит — напоминание ровно одно', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1');
    await client();

    await run();
    const counters = await run();

    expect(counters.remindersSent).toBe(0);
    expect(pushesOf(provider)).toHaveLength(1);
  });

  test('зимой газон не отрастает — прогон молчит', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1', { completedAt: daysAgo(28, WINTER) });
    await client();

    await run(WINTER);

    expect(pushesOf(provider)).toHaveLength(0);
    expect((await db.doc('orders/o1').get()).get('reminderSentAt')).toBeUndefined();
  });

  test('слишком рано не напоминают — трава ещё не выросла', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1', { completedAt: daysAgo(10) });
    await client();

    await run();

    expect(pushesOf(provider)).toHaveLength(0);
  });

  test('окно прошло — старую заявку не будят', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1', { completedAt: daysAgo(60) });
    await client();

    await run();

    expect(pushesOf(provider)).toHaveLength(0);
  });

  test('незавершённая заявка напоминания не рождает', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1', { status: 'В работе' });
    await client();

    await run();

    expect(pushesOf(provider)).toHaveLength(0);
  });
});

describe('когда напоминание неуместно', () => {
  test('клиент уже создал новую такую же заявку — молчим', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1');
    await mowing('o2', { status: 'Поиск мастера', createdAt: daysAgo(5), completedAt: null });
    await client();

    await run();

    expect(pushesOf(provider)).toHaveLength(0);
    // Отметки нет: если новую заявку отменят, напомнить ещё можно
    expect((await db.doc('orders/o1').get()).get('reminderSentAt')).toBeUndefined();
  });

  test('отменённая новая заявка не считается — работа так и не сделана', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1');
    await mowing('o2', { status: 'Отменена', createdAt: daysAgo(5), completedAt: null });
    await client();

    await run();

    expect(pushesOf(provider)).toHaveLength(1);
  });

  test('новая заявка другого вида напоминание не гасит', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1');
    await mowing('o2', {
      status: 'Поиск мастера',
      objectId: 'trees',
      serviceLabel: 'Обрезка',
      createdAt: daysAgo(5),
      completedAt: null,
    });
    await client();

    await run();

    expect(pushesOf(provider)).toHaveLength(1);
  });

  test('человек выключил напоминания — его слышат', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1');
    await client({ remindersOff: true });

    await run();

    expect(pushesOf(provider)).toHaveLength(0);
    expect((await db.doc('orders/o1').get()).get('reminderSentAt')).toBeUndefined();
  });

  test('профиль удалён — напоминать некому', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1');

    await run();

    expect(pushesOf(provider)).toHaveLength(0);
    expect((await db.doc('orders/o1').get()).get('reminderSentAt')).toBeUndefined();
  });
});

describe('услуги без сезона', () => {
  test('заточка инструмента напоминается и зимой', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await mowing('o1', {
      title: 'Инструмент · Заточка · Ножи и топоры',
      objectId: 'tools',
      serviceLabel: 'Заточка',
      category: 'инструмент',
      createdAt: daysAgo(130, WINTER),
      completedAt: daysAgo(125, WINTER),
    });
    await client();

    const counters = await run(WINTER);

    expect(counters.remindersSent).toBe(1);
    expect(pushesOf(provider)).toHaveLength(1);
  });
});
