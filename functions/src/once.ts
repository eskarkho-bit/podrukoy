import { getFirestore } from 'firebase-admin/firestore';

// Событие доставляется минимум один раз, а с retry — и после сбоя на полпути.
// Пуш, ушедший до сбоя, при повторе ушёл бы второй раз. Отметка в самой
// заявке (notified.<ключ>) ставится транзакцией до отправки: кто поставил —
// тот и шлёт, повтор находит отметку и молчит. Клиенту это поле правила не
// дают ни создать, ни изменить.

/** true — отметка поставлена только что, событие ещё никто не обработал. */
export async function claimOnce(orderId: string, key: string): Promise<boolean> {
  const db = getFirestore();
  const ref = db.doc(`orders/${orderId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const notified = (snap.get('notified') ?? {}) as Record<string, unknown>;
    if (notified[key]) return false;
    tx.set(ref, { notified: { ...notified, [key]: true } }, { merge: true });
    return true;
  });
}
