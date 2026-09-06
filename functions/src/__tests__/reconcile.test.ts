import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { fakeProvider, initTestApp, wipe } from './helpers';
import { reconcile } from '../reconcile';

// Сверка добирает то, что не доехало событиями. Проверяется в первую очередь
// блокировка: два прогона одновременно звали бы мастеров к одной заявке
// дважды, а удаление аккаунта вели бы вперемешку.

initTestApp();
const db = getFirestore();

const LOCK = db.doc('system/reconcile');

const minutesAgo = (m: number) => Timestamp.fromMillis(Date.now() - m * 60 * 1000);

/** Прогон в обход расписания: onSchedule отдаёт функцию с .run(). */
const run = () =>
  (reconcile as any).run({
    jobName: 'test',
    scheduleTime: new Date().toISOString(),
  });

const actions = async () => {
  const snap = await db.collection('audit').get();
  return snap.docs.map((d) => d.get('action'));
};

beforeEach(async () => {
  await wipe('masters', 'deletions', 'audit', 'system', 'users', 'orders');
});

describe('блокировка прогона', () => {
  test('идущий прогон не даёт начать второй', async () => {
    fakeProvider(() => ({ json: {} }));
    await LOCK.set({ runningSince: minutesAgo(1), runId: 'предыдущий' });

    await run();

    expect(await actions()).toContain('reconcile.skipped');
    expect(await actions()).not.toContain('reconcile.started');
    // Чужую блокировку прогон не трогает
    expect((await LOCK.get()).get('runId')).toBe('предыдущий');
  });

  // Функцию могут убить по таймауту, и блокировка останется висеть. Без
  // перехвата сверка встала бы навсегда и потребовала бы человека.
  test('брошенная блокировка перехватывается', async () => {
    fakeProvider(() => ({ json: {} }));
    await LOCK.set({ runningSince: minutesAgo(30), runId: 'упавший' });

    await run();

    expect(await actions()).toContain('reconcile.started');
    expect(await actions()).toContain('reconcile.finished');
  });

  test('после прогона блокировка снята', async () => {
    fakeProvider(() => ({ json: {} }));

    await run();

    const lock = await LOCK.get();
    expect(lock.get('runningSince')).toBeNull();
    expect(lock.get('lastFinishedAt')).toBeTruthy();
  });

  // Сбой снаружи не должен останавливать сверку на десять минут: рассылка
  // сама глотает ошибку сети, а на случай исключения внутри прогона снятие
  // блокировки вынесено в finally
  test('сбой сервиса пушей не роняет прогон и не оставляет блокировку', async () => {
    fakeProvider(() => {
      throw new Error('сервис пушей недоступен');
    });
    // Молчащая заявка с подходящим мастером — единственный путь наружу
    await db.doc('orders/o1').set({
      status: 'Поиск мастера',
      title: 'Не работает розетка',
      city: 'грозный',
      category: 'электрика',
      clientId: 'client1',
      createdAt: minutesAgo(180),
    });
    await db.doc('masters/m1').set({ verified: true, cities: ['грозный'], skills: ['электрика'] });
    await db.doc('users/m1').set({ pushTokens: ['ExponentPushToken[m1]'] });

    await run();

    const lock = await LOCK.get();
    expect(lock.get('runningSince')).toBeNull();
    // Заявку позвали повторно, хотя пуш не ушёл: отметка ставится до отправки
    expect(lock.get('lastCounters')).toMatchObject({ ordersRepushed: 1, errors: 0 });
    expect(await actions()).toContain('reconcile.finished');
  });
});

describe('застрявшие удаления', () => {
  test('удаление, не сдвинувшееся за пятнадцать минут, доводится до конца', async () => {
    fakeProvider(() => ({ json: {} }));
    await db.doc('users/u1').set({ name: 'Дмитрий' });
    await db.doc('deletions/u1').set({ status: 'pending', requestedAt: minutesAgo(30) });

    await run();

    expect((await db.doc('deletions/u1').get()).get('status')).toBe('done');
    expect((await db.doc('users/u1').get()).exists).toBe(false);
    expect((await LOCK.get()).get('lastCounters').deletionsResumed).toBe(1);
  });

  test('свежую заявку не трогают — её ещё доделывает триггер', async () => {
    fakeProvider(() => ({ json: {} }));
    await db.doc('users/u1').set({ name: 'Дмитрий' });
    await db.doc('deletions/u1').set({ status: 'pending', requestedAt: minutesAgo(2) });

    await run();

    expect((await db.doc('users/u1').get()).exists).toBe(true);
  });
});

describe('заявки без ответа', () => {
  const order = (id: string, data: Record<string, unknown>) =>
    db.doc(`orders/${id}`).set({
      status: 'Поиск мастера',
      title: 'Не работает розетка',
      city: 'грозный',
      category: 'электрика',
      clientId: 'client1',
      ...data,
    });

  test('заявка два часа без предложений — мастеров зовут повторно', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await order('o1', { createdAt: minutesAgo(180) });
    // Подходящий проверенный мастер с токеном — пуш должен дойти до Expo
    await db.doc('masters/m1').set({ verified: true, cities: ['грозный'], skills: ['электрика'] });
    await db.doc('users/m1').set({ pushTokens: ['ExponentPushToken[m1]'] });
    // Непроверенному не шлют: правила всё равно не пустят его к заявке
    await db.doc('masters/m2').set({ verified: false, cities: [], skills: [] });
    await db.doc('users/m2').set({ pushTokens: ['ExponentPushToken[m2]'] });

    await run();

    expect((await db.doc('orders/o1').get()).get('repushedAt')).toBeTruthy();
    expect(await actions()).toContain('order.repushed');
    expect((await LOCK.get()).get('lastCounters').ordersRepushed).toBe(1);

    const pushes = provider.calls.filter((c) => c.path.includes('exp.host'));
    expect(pushes).toHaveLength(1);
    const tokens = pushes[0].body.map((m: { to: string }) => m.to);
    expect(tokens).toEqual(['ExponentPushToken[m1]']);
  });

  test('второй раз не зовут — повтор ровно один', async () => {
    fakeProvider(() => ({ json: {} }));
    await order('o1', { createdAt: minutesAgo(180), repushedAt: minutesAgo(60) });

    await run();

    expect(await actions()).not.toContain('order.repushed');
    expect((await LOCK.get()).get('lastCounters').ordersRepushed).toBe(0);
  });

  test('заявка с предложением молчащей не считается', async () => {
    fakeProvider(() => ({ json: {} }));
    await order('o1', { createdAt: minutesAgo(180) });
    await db.doc('orders/o1/offers/m1').set({ masterId: 'm1', price: 1000, status: 'pending' });

    await run();

    expect((await db.doc('orders/o1').get()).get('repushedAt')).toBeUndefined();
    expect((await LOCK.get()).get('lastCounters').ordersRepushed).toBe(0);
  });

  test('свежую заявку не трогают — мастера ещё отвечают', async () => {
    fakeProvider(() => ({ json: {} }));
    await order('o1', { createdAt: minutesAgo(30) });

    await run();

    expect((await db.doc('orders/o1').get()).get('repushedAt')).toBeUndefined();
  });

  test('заявку старше суток не будят', async () => {
    fakeProvider(() => ({ json: {} }));
    await order('o1', { createdAt: minutesAgo(60 * 30) });

    await run();

    expect((await db.doc('orders/o1').get()).get('repushedAt')).toBeUndefined();
  });
});

describe('итоги прогона', () => {
  test('счётчики сохраняются для наблюдения', async () => {
    fakeProvider(() => ({ json: {} }));
    await db.doc('deletions/u1').set({ status: 'pending', requestedAt: minutesAgo(30) });

    await run();

    expect((await LOCK.get()).get('lastCounters')).toMatchObject({
      deletionsResumed: 1,
      ordersRepushed: 0,
      errors: 0,
    });
    expect(await actions()).toContain('reconcile.finished');
  });
});
