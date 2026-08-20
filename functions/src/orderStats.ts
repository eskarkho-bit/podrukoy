import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// Гистограмма цен по завершённым заявкам.
//
// Модератору нужна медиана чека, но заявок он не видит: в них адрес,
// комментарий и фото. Поэтому цена учитывается здесь, а наружу отдаётся один
// документ с числами — доступа к самим заявкам он не даёт.
//
// Хранится гистограмма, а не список цен: сорок чисел независимо от того,
// сколько было заказов. Полный перебор заявок ради медианы означал бы платить
// за чтение всей базы, а список цен рос бы без предела.

/** Должно совпадать с components/orderStats.ts — иначе корзины разъедутся. */
const BUCKET_WIDTH = 500;
const BUCKET_CAP = 20000;

const STATS = 'stats/orders';

function bucketOf(price: number): number {
  if (price >= BUCKET_CAP) return BUCKET_CAP;
  return Math.floor(price / BUCKET_WIDTH) * BUCKET_WIDTH;
}

/**
 * Учитывает цену завершённой заявки.
 *
 * Триггеры доставляются минимум один раз, то есть иногда дважды. Второй вызов
 * не должен добавить вторую цену — иначе медиана поедет, а заметить это будет
 * не по чему. Поэтому отметка ставится на самой заявке и в той же транзакции,
 * что и приращение счётчиков: пройти дважды нельзя.
 *
 * Отметка не меняет статус, поэтому обработчик статуса на неё не сработает.
 */
export async function recordCompletedOrder(orderId: string, price: number): Promise<boolean> {
  if (!Number.isFinite(price) || price <= 0) return false;

  const db = getFirestore();
  const orderRef = db.doc(`orders/${orderId}`);
  const statsRef = db.doc(STATS);

  return db.runTransaction(async (tx) => {
    const order = await tx.get(orderRef);
    // Заявку могли удалить, пока событие ехало
    if (!order.exists) return false;
    if (order.get('statsCounted') === true) return false;

    tx.set(
      statsRef,
      {
        completed: FieldValue.increment(1),
        sum: FieldValue.increment(price),
        buckets: { [String(bucketOf(price))]: FieldValue.increment(1) },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(orderRef, { statsCounted: true }, { merge: true });
    return true;
  });
}
