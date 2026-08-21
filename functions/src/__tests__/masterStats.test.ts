import { getFirestore } from 'firebase-admin/firestore';
import { initTestApp, wipe } from './helpers';
import { recountCompletedOrders } from '../masterStats';

// Счётчик заказов в анкете. Ломается так же тихо, как гистограмма: лишний
// заказ не даёт ошибки, он просто завышает цифру, по которой клиент выбирает.

initTestApp();
const db = getFirestore();

async function completed(id: string, masterId: string) {
  await db.doc(`orders/${id}`).set({ masterId, status: 'Завершена', agreedPrice: 3000 });
}

beforeEach(async () => {
  await wipe('orders', 'masters');
  await db.doc('masters/m1').set({ name: 'Иван', verified: true });
});

describe('пересчёт', () => {
  test('считаются только завершённые заявки этого мастера', async () => {
    await completed('o1', 'm1');
    await completed('o2', 'm1');
    // Чужая завершённая и своя незакрытая счётчик не двигают
    await completed('o3', 'm2');
    await db.doc('orders/o4').set({ masterId: 'm1', status: 'В работе' });

    expect(await recountCompletedOrders('m1')).toBe(2);
    expect((await db.doc('masters/m1').get()).get('completedOrders')).toBe(2);
  });

  test('без завершённых заявок в анкете ноль, а не пусто', async () => {
    expect(await recountCompletedOrders('m1')).toBe(0);
    expect((await db.doc('masters/m1').get()).get('completedOrders')).toBe(0);
  });

  test('остальная анкета не затирается', async () => {
    await completed('o1', 'm1');
    await recountCompletedOrders('m1');

    const master = await db.doc('masters/m1').get();
    expect(master.get('name')).toBe('Иван');
    expect(master.get('verified')).toBe(true);
  });
});

describe('повторная доставка события', () => {
  // Ради этого пересчёт, а не «+1»: триггер доставляется минимум один раз
  test('второй прогон даёт то же число', async () => {
    await completed('o1', 'm1');

    expect(await recountCompletedOrders('m1')).toBe(1);
    expect(await recountCompletedOrders('m1')).toBe(1);
    expect((await db.doc('masters/m1').get()).get('completedOrders')).toBe(1);
  });

  test('одновременные прогоны не портят число', async () => {
    await completed('o1', 'm1');
    await completed('o2', 'm1');

    const results = await Promise.all([
      recountCompletedOrders('m1'),
      recountCompletedOrders('m1'),
      recountCompletedOrders('m1'),
    ]);

    expect(results).toEqual([2, 2, 2]);
    expect((await db.doc('masters/m1').get()).get('completedOrders')).toBe(2);
  });
});

describe('исчезнувший мастер', () => {
  // Мастер мог удалить аккаунт, пока событие ехало: счётчик не должен
  // воскресить анкету огрызком из одного поля
  test('пересчёт без анкеты не создаёт документ', async () => {
    await completed('o1', 'нет-такого');

    expect(await recountCompletedOrders('нет-такого')).toBeNull();
    expect((await db.doc('masters/нет-такого').get()).exists).toBe(false);
  });
});
