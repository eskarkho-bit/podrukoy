import { getFirestore } from 'firebase-admin/firestore';

// Счётчик выполненных заказов в анкете мастера.
//
// Пересчёт, а не приращение: триггер доставляется минимум один раз, и «+1»
// на повторной доставке посчитал бы один заказ дважды. Пересчёту повтор
// безразличен — он каждый раз приходит к одному и тому же числу.
//
// Считает агрегат count(): сервер отдаёт число, не выкачивая сами заявки.
// Запросу нужен составной индекс orders(masterId, status) — он уже есть
// в firestore.indexes.json.

/**
 * Пересчитывает completedOrders в анкете мастера.
 *
 * Возвращает новое значение либо null, если анкеты больше нет: мастер мог
 * удалить аккаунт, пока событие ехало, и merge создал бы огрызок анкеты
 * из одного счётчика.
 */
export async function recountCompletedOrders(masterId: string): Promise<number | null> {
  const db = getFirestore();
  const masterRef = db.doc(`masters/${masterId}`);

  const count = db
    .collection('orders')
    .where('masterId', '==', masterId)
    .where('status', '==', 'Завершена')
    .count();

  // Транзакция ради проверки «анкета ещё существует»: между чтением и записью
  // анкету могло удалить удаление аккаунта
  return db.runTransaction(async (tx) => {
    const master = await tx.get(masterRef);
    if (!master.exists) return null;

    const completed = (await tx.get(count)).data().count;
    tx.set(masterRef, { completedOrders: completed }, { merge: true });
    return completed;
  });
}

/**
 * Полный пересчёт рейтинга мастера по видимым отзывам.
 *
 * Скрытые модерацией (hidden) не входят ни в среднее, ни в счётчик: цифра
 * у анкеты и список отзывов на экране обязаны сходиться, иначе «4,2 по трём
 * отзывам» при двух видимых выглядит подлогом. Если видимых не осталось —
 * рейтинга нет, как у мастера без отзывов вовсе.
 *
 * Пересчёт, а не приращение, по той же причине, что и completedOrders выше.
 * Возвращает null, не трогая базу, если анкеты больше нет.
 */
export async function recomputeRating(
  masterId: string,
): Promise<{ rating: number | null; reviewsCount: number } | null> {
  const db = getFirestore();
  const masterRef = db.doc(`masters/${masterId}`);

  const reviews = await db.collection(`masters/${masterId}/reviews`).get();
  const stars = reviews.docs
    .filter((d) => d.get('hidden') !== true)
    .map((d) => Number(d.get('stars')))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);

  const value = stars.length
    ? {
        // Округляем до десятых: показываем всё равно «4,8»
        rating: Math.round((stars.reduce((acc, n) => acc + n, 0) / stars.length) * 10) / 10,
        reviewsCount: stars.length,
      }
    : { rating: null, reviewsCount: 0 };

  return db.runTransaction(async (tx) => {
    const master = await tx.get(masterRef);
    if (!master.exists) return null;
    tx.set(masterRef, value, { merge: true });
    return value;
  });
}
