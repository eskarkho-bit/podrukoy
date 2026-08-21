import { getFirestore } from 'firebase-admin/firestore';
import { initTestApp, wipe } from './helpers';
import { recordCompletedOrder } from '../orderStats';

// Гистограмма цен. Ломается тихо: посчитанная дважды заявка не даёт ошибки,
// она просто сдвигает медиану — а медиана здесь основание для ставки.

initTestApp();
const db = getFirestore();

const stats = () => db.doc('stats/orders');

async function order(id: string, price: number) {
  await db.doc(`orders/${id}`).set({ status: 'Завершена', agreedPrice: price });
}

beforeEach(async () => {
  await wipe('orders', 'stats');
});

describe('учёт цены', () => {
  test('первая заявка создаёт сводку', async () => {
    await order('o1', 3000);

    expect(await recordCompletedOrder('o1', 3000)).toBe(true);

    const s = await stats().get();
    expect(s.get('completed')).toBe(1);
    expect(s.get('sum')).toBe(3000);
    expect(s.get('buckets')['3000']).toBe(1);
  });

  test('цены складываются в корзины по 500', async () => {
    for (const [id, price] of [
      ['o1', 2500],
      ['o2', 2999],
      ['o3', 3000],
    ] as const) {
      await order(id, price);
      await recordCompletedOrder(id, price);
    }

    const buckets = (await stats().get()).get('buckets');
    // 2500 и 2999 — одна корзина, 3000 — следующая
    expect(buckets['2500']).toBe(2);
    expect(buckets['3000']).toBe(1);
  });

  test('дорогие заявки сваливаются в одну корзину', async () => {
    await order('o1', 45000);
    await recordCompletedOrder('o1', 45000);

    expect((await stats().get()).get('buckets')['20000']).toBe(1);
  });
});

describe('повторная доставка события', () => {
  // Ради этого всё и написано. Триггер доставляется минимум один раз, то есть
  // иногда дважды, и вторая цена сдвинула бы медиану молча.
  test('вторая попытка ничего не добавляет', async () => {
    await order('o1', 3000);

    expect(await recordCompletedOrder('o1', 3000)).toBe(true);
    expect(await recordCompletedOrder('o1', 3000)).toBe(false);
    expect(await recordCompletedOrder('o1', 3000)).toBe(false);

    const s = await stats().get();
    expect(s.get('completed')).toBe(1);
    expect(s.get('sum')).toBe(3000);
    expect(s.get('buckets')['3000']).toBe(1);
  });

  test('одновременные доставки не проходят обе', async () => {
    await order('o1', 3000);

    const results = await Promise.all([
      recordCompletedOrder('o1', 3000),
      recordCompletedOrder('o1', 3000),
      recordCompletedOrder('o1', 3000),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await stats().get()).get('completed')).toBe(1);
  });

  test('отметка ставится на самой заявке', async () => {
    await order('o1', 3000);
    await recordCompletedOrder('o1', 3000);

    expect((await db.doc('orders/o1').get()).get('statsCounted')).toBe(true);
    // Статус при этом не трогаем — иначе обработчик статуса сработал бы снова
    expect((await db.doc('orders/o1').get()).get('status')).toBe('Завершена');
  });
});

describe('что не считаем', () => {
  test('заявка без цены не учитывается', async () => {
    await order('o1', 0);

    expect(await recordCompletedOrder('o1', 0)).toBe(false);
    expect((await stats().get()).exists).toBe(false);
  });

  test('отрицательная и нечисловая цена не учитываются', async () => {
    await order('o1', 100);

    expect(await recordCompletedOrder('o1', -500)).toBe(false);
    expect(await recordCompletedOrder('o1', Number.NaN)).toBe(false);
    expect((await stats().get()).exists).toBe(false);
  });

  // Клиент мог удалить аккаунт, пока событие ехало
  test('исчезнувшая заявка не учитывается', async () => {
    expect(await recordCompletedOrder('нет-такой', 3000)).toBe(false);
    expect((await stats().get()).exists).toBe(false);
  });
});

describe('накопление', () => {
  test('десять заявок дают десять записей и верную сумму', async () => {
    const prices = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500];
    for (const [i, price] of prices.entries()) {
      await order(`o${i}`, price);
      await recordCompletedOrder(`o${i}`, price);
    }

    const s = await stats().get();
    expect(s.get('completed')).toBe(10);
    expect(s.get('sum')).toBe(prices.reduce((a, b) => a + b, 0));
    const total = Object.values(s.get('buckets') as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBe(10);
  });
});
