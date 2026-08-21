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
