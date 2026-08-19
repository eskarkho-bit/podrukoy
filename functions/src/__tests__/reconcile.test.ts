import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  fakeProvider,
  initTestApp,
  succeededPayment,
  wipe,
  withProviderKeys,
  withoutProviderKeys,
} from './helpers';
import { reconcile } from '../reconcile';

// Сверка добирает то, что не доехало событиями. Проверяется в первую очередь
// блокировка: два прогона одновременно означали бы два возврата за один
// платёж, то есть отданные дважды деньги.

initTestApp();
const db = getFirestore();

const LOCK = db.doc('system/reconcile');
const app = (uid: string) => db.doc(`masters/${uid}/verification/application`);

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
  withProviderKeys();
  await wipe('masters', 'deletions', 'audit', 'system', 'users', 'orders');
});

afterAll(withoutProviderKeys);

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

  // Одна ошибка не должна останавливать сверку на десять минут — ради этого
  // снятие блокировки и вынесено в finally
  test('блокировка снимается и после сбоя провайдера', async () => {
    fakeProvider(() => {
      throw new Error('провайдер недоступен');
    });
    await app('m1').set({
      bindingState: 'pending',
      bindingPaymentId: 'pay_1',
      lastBindingAt: minutesAgo(20),
    });

    await run();

    const lock = await LOCK.get();
    expect(lock.get('runningSince')).toBeNull();
    expect(lock.get('lastCounters').errors).toBe(1);
    // Заявку не тронули: придём за ней в следующий прогон
    expect((await app('m1').get()).get('bindingState')).toBe('pending');
  });
});

describe('привязки, по которым вебхук не пришёл', () => {
  test('оплаченная привязка доводится до конца', async () => {
    const provider = fakeProvider((path) => ({
      json: path.startsWith('/payments/') ? succeededPayment('m1') : { id: 'refund_1' },
    }));
    await app('m1').set({
      bindingState: 'pending',
      bindingPaymentId: 'pay_1',
      lastBindingAt: minutesAgo(20),
    });

    await run();

    const saved = await app('m1').get();
    expect(saved.get('bindingState')).toBe('succeeded');
    expect(saved.get('cardBindingId')).toBe('pm_saved_1');
    expect(provider.of('/refunds')).toHaveLength(1);
    expect((await LOCK.get()).get('lastCounters').bindingsSettled).toBe(1);
  });

  // Вебхук приходит за секунды. Трогать свежий платёж — верный способ
  // столкнуться с ним лбами и сделать работу дважды.
  test('свежий платёж не трогают — вебхук ещё в пути', async () => {
    const provider = fakeProvider(() => ({ json: succeededPayment('m1') }));
    await app('m1').set({
      bindingState: 'pending',
      bindingPaymentId: 'pay_1',
      lastBindingAt: minutesAgo(2),
    });

    await run();

    expect(provider.calls).toHaveLength(0);
    expect((await app('m1').get()).get('bindingState')).toBe('pending');
  });

  test('состояние без идентификатора платежа закрывают, а не перебирают вечно', async () => {
    fakeProvider(() => ({ json: {} }));
    await app('m1').set({ bindingState: 'pending', lastBindingAt: minutesAgo(20) });

    await run();

    const saved = await app('m1').get();
    expect(saved.get('bindingState')).toBe('failed');
    expect(saved.get('bindingError')).toBe('no-payment-id');
  });

  test('человек не дошёл до банка за сутки — попытка закрывается', async () => {
    fakeProvider(() => ({
      json: {
        id: 'pay_1',
        status: 'pending',
        metadata: { uid: 'm1', purpose: 'master-verification' },
      },
    }));
    await app('m1').set({
      bindingState: 'pending',
      bindingPaymentId: 'pay_1',
      lastBindingAt: minutesAgo(60 * 25),
    });

    await run();

    const saved = await app('m1').get();
    expect(saved.get('bindingState')).toBe('failed');
    expect(saved.get('bindingError')).toBe('abandoned');
    expect(await actions()).toContain('binding.failed');
  });

  test('до суток незавершённый платёж оставляют в ожидании', async () => {
    fakeProvider(() => ({
      json: {
        id: 'pay_1',
        status: 'pending',
        metadata: { uid: 'm1', purpose: 'master-verification' },
      },
    }));
    await app('m1').set({
      bindingState: 'pending',
      bindingPaymentId: 'pay_1',
      lastBindingAt: minutesAgo(60),
    });

    await run();

    expect((await app('m1').get()).get('bindingState')).toBe('pending');
    expect((await LOCK.get()).get('lastCounters').bindingsStillPending).toBe(1);
  });
});

describe('зависшие возвраты', () => {
  // Это чужие деньги, застрявшие у провайдера. Единственное, что может их
  // вернуть, — этот прогон.
  test('неудавшийся возврат повторяется', async () => {
    const provider = fakeProvider(() => ({ json: { id: 'refund_1' } }));
    await app('m1').set({
      bindingState: 'succeeded',
      refundPending: true,
      refundPendingPaymentId: 'pay_1',
    });

    await run();

    expect(provider.of('/refunds')).toHaveLength(1);
    const saved = await app('m1').get();
    expect(saved.get('refundPending')).toBe(false);
    expect(saved.get('refundedPaymentId')).toBe('pay_1');
  });

  test('ключ повтора тот же — провайдер не сделает второй возврат', async () => {
    const provider = fakeProvider(() => ({ json: { id: 'refund_1' } }));
    await app('m1').set({ refundPending: true, refundPendingPaymentId: 'pay_1' });

    await run();

    expect(provider.of('/refunds')[0].idempotenceKey).toBe('refund-pay_1');
  });

  test('отметка без идентификатора платежа снимается', async () => {
    const provider = fakeProvider(() => ({ json: {} }));
    await app('m1').set({ refundPending: true });

    await run();

    expect(provider.of('/refunds')).toHaveLength(0);
    expect((await app('m1').get()).get('refundPending')).toBe(false);
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

describe('итоги прогона', () => {
  test('счётчики сохраняются для наблюдения', async () => {
    fakeProvider((path) => ({
      json: path.startsWith('/payments/') ? succeededPayment('m1') : { id: 'refund_1' },
    }));
    await app('m1').set({
      bindingState: 'pending',
      bindingPaymentId: 'pay_1',
      lastBindingAt: minutesAgo(20),
    });
    await db.doc('deletions/u1').set({ status: 'pending', requestedAt: minutesAgo(30) });

    await run();

    expect((await LOCK.get()).get('lastCounters')).toMatchObject({
      bindingsSettled: 1,
      deletionsResumed: 1,
      errors: 0,
    });
    expect(await actions()).toContain('reconcile.finished');
  });
});
