import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Счётчики «не чаще, чем»: сколько раз за окно случилось событие с таким
// ключом. Один документ на ключ, транзакция — чтобы два одновременных вызова
// не проскочили оба под самый лимит. Окно не скользит: начинается с первого
// события и кончается через windowMs, потом счёт с нуля.
//
// Документы живут, пока живо окно, плюс сутки; просроченные убирает сверка
// (reconcile.ts), а не TTL-политика Firestore: её включают руками в консоли,
// и забытый шаг оставил бы коллекцию расти молча. Из приложения коллекция
// закрыта общим запретом в firestore.rules.

export const METERS = 'meters';

/** Через сколько после закрытия окна документ можно удалить. */
const KEEP_AFTER_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Считает событие и говорит, превышен ли лимит. Событие сверх лимита не
 * записывается: лишняя запись ничего не меняет, а стоит денег.
 */
export async function meterExceeded(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const db = getFirestore();
  const ref = db.collection(METERS).doc(key);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const startedAt: number = snap.get('windowStartAt')?.toMillis?.() ?? 0;
    const active = now - startedAt < windowMs;
    const count: number = active ? (snap.get('count') ?? 0) : 0;
    if (count >= limit) return true;
    const windowStart = active ? startedAt : now;
    tx.set(ref, {
      count: count + 1,
      windowStartAt: Timestamp.fromMillis(windowStart),
      expiresAt: Timestamp.fromMillis(windowStart + windowMs + KEEP_AFTER_WINDOW_MS),
    });
    return false;
  });
}

/** Удаляет просроченные счётчики. Возвращает, сколько убрано. */
export async function purgeExpiredMeters(limit: number): Promise<number> {
  const db = getFirestore();
  const snap = await db.collection(METERS).where('expiresAt', '<', new Date()).limit(limit).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}
