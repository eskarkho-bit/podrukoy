import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { audit, SYSTEM } from './audit';

// Удаление аккаунта.
//
// Клиент пишет одну запись — саму просьбу, — и на этом его роль кончается.
// Всё остальное делает эта функция: обходит данные этапами и отмечает, где
// остановилась. Обрыв на любом шаге не страшен: повтор продолжит с того же
// места, а каждый этап написан так, что повторное выполнение ничего не портит.
//
// Заодно здесь делается то, что клиенту недоступно и не должно быть доступно:
// обезличивание заявок. Заявки не удаляются — они общие с мастером и служат
// историей расчётов, — но имя, адрес, комментарий и фотография из них уходят.

export type DeletionStage =
  'orders' | 'threads' | 'complaints' | 'verification' | 'master' | 'profile' | 'auth' | 'done';

const ORDER: DeletionStage[] = [
  'orders',
  'threads',
  'complaints',
  'verification',
  'master',
  'profile',
  'auth',
  'done',
];

const ANONYMOUS = 'Удалённый аккаунт';

/** Пройден ли этап: сравниваем позиции в списке, а не строки. */
const reached = (current: DeletionStage | undefined, stage: DeletionStage) =>
  ORDER.indexOf(current ?? 'orders') > ORDER.indexOf(stage);

/**
 * Выполняет удаление, начиная с незавершённого этапа.
 * Вызывается и триггером, и сверкой — поэтому вынесена отдельно.
 */
export async function runDeletion(uid: string, correlationId: string): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`deletions/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) return;

  let stage = (snap.get('stage') ?? 'orders') as DeletionStage;
  if (stage === 'done' || snap.get('status') === 'done') return;

  const advance = async (next: DeletionStage) => {
    stage = next;
    await ref.set({ stage: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await audit({
      action: 'account.deletion_stage',
      actor: SYSTEM,
      subject: { type: 'user', id: uid },
      correlationId,
      details: { stage: next },
    });
  };

  // 1. Заявки: незакрытые отменяем, сданные — засчитываем мастеру, все —
  //    обезличиваем. Свои сообщения в переписке и подпись под отзывами
  //    уходят тем же этапом: и то и другое — его слова и его имя.
  if (!reached(stage, 'orders')) {
    const orders = await db.collection('orders').where('clientId', '==', uid).get();
    let anonymized = 0;
    for (const d of orders.docs) {
      const status = String(d.get('status') ?? '');
      const open = ['Поиск мастера', 'Есть предложения', 'В работе'].includes(status);
      // Работа сдана, а подтвердить её больше некому — считаем принятой:
      // иначе она висела бы у мастера «ждёт подтверждения» вечно
      const awaiting = status === 'Ждёт подтверждения';
      await d.ref.set(
        {
          // Мастер не должен ехать к исчезнувшему клиенту; сделки нет —
          // и его контактов в заявке тоже
          ...(open
            ? {
                status: 'Отменена',
                masterPhone: null,
                masterBanks: null,
                masterAcceptsCash: null,
              }
            : {}),
          ...(awaiting ? { status: 'Завершена', completedAt: FieldValue.serverTimestamp() } : {}),
          clientName: ANONYMOUS,
          clientPhone: null,
          address: '',
          comment: '',
          photoUrl: null,
          anonymizedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await deletePrefix(`orders/${d.id}/`);
      await redactMessages(d.ref, uid);
      // Подпись под отзывом: сам отзыв остаётся мастеру, имя — нет
      const masterId = d.get('masterId');
      if (typeof masterId === 'string' && masterId) {
        const review = db.doc(`masters/${masterId}/reviews/${d.id}`);
        if ((await review.get()).exists) {
          await review.set({ clientName: ANONYMOUS }, { merge: true });
        }
      }
      anonymized += 1;
    }
    // Заявки, где он был исполнителем: имя и его сообщения уходят, работа и
    // расчёты остаются клиенту. Незаконченные разберёт удаление анкеты
    // (masterExit.ts) этапом позже.
    const asMaster = await db.collection('orders').where('masterId', '==', uid).get();
    for (const d of asMaster.docs) {
      await d.ref.set({ masterName: ANONYMOUS }, { merge: true });
      await redactMessages(d.ref, uid);
      // Снимки в переписке названы по отправителю — уходят по префиксу
      await deletePrefix(`orders/${d.id}/chat/${uid}-`);
    }
    await audit({
      action: 'order.anonymized',
      actor: SYSTEM,
      subject: { type: 'user', id: uid },
      correlationId,
      details: { count: anonymized },
    });
    await advance('threads');
  }

  // 2. Переписка с поддержкой — Firestore не удаляет подколлекции сам
  if (!reached(stage, 'threads')) {
    const threads = await db.collection(`users/${uid}/threads`).get();
    for (const t of threads.docs) {
      await deleteAll(t.ref.collection('messages'));
      await t.ref.delete();
    }
    await advance('complaints');
  }

  // 3. Жалобы на отзывы: их текст — свободный текст автора и умирает вместе
  //    с ним. Жалобы на отзывы, написанные этим человеком о других, остаются:
  //    они принадлежат пожаловавшимся мастерам.
  if (!reached(stage, 'complaints')) {
    const complaints = await db.collection('complaints').where('byUid', '==', uid).get();
    for (const d of complaints.docs) await d.ref.delete();
    await advance('verification');
  }

  // 4. Заявка на проверку и снимок лица — самое чувствительное. Тем же
  //    этапом уходят и реквизиты: банки для перевода — данные того же рода
  if (!reached(stage, 'verification')) {
    await deleteAll(db.collection(`masters/${uid}/verification`));
    await deleteAll(db.collection(`masters/${uid}/payment`));
    await deletePrefix(`verification/${uid}/`);
    await advance('master');
  }

  // 5. Анкета мастера вместе с отзывами о нём: анкеты, к которой они были
  //    написаны, больше нет, а рейтинг без анкеты никому не показать.
  //    Подколлекцию Firestore сам не удалит — обходим руками.
  if (!reached(stage, 'master')) {
    await deleteAll(db.collection(`masters/${uid}/reviews`));
    await db.doc(`masters/${uid}`).delete();
    await advance('profile');
  }

  // 6. Профиль со всем поддеревом
  if (!reached(stage, 'profile')) {
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await advance('auth');
  }

  // 7. Сам аккаунт — последним. Клиент мог удалить его сам, тогда его уже нет.
  if (!reached(stage, 'auth')) {
    try {
      await getAuth().deleteUser(uid);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/user-not-found') throw e;
    }
    await advance('done');
  }

  // status закрывает документ для сверки: она ищет ровно 'pending'
  await ref.set(
    {
      status: 'done',
      completedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await audit({
    action: 'account.deleted',
    actor: SYSTEM,
    subject: { type: 'user', id: uid },
    correlationId,
  });
  logger.info('Аккаунт удалён', { uid });
}

/**
 * Стирает слова одного участника из переписки заявки: текст и снимок уходят,
 * место сообщения остаётся — собеседник видит, что здесь что-то было.
 * Повтор безвреден.
 */
async function redactMessages(order: FirebaseFirestore.DocumentReference, uid: string) {
  const mine = await order.collection('messages').where('senderId', '==', uid).get();
  for (let i = 0; i < mine.docs.length; i += 300) {
    const batch = getFirestore().batch();
    mine.docs
      .slice(i, i + 300)
      .forEach((m) =>
        batch.set(
          m.ref,
          { text: '', imageUrl: null, redactedAt: FieldValue.serverTimestamp() },
          { merge: true },
        ),
      );
    await batch.commit();
  }
}

/** Удаляет все документы коллекции пачками. */
async function deleteAll(col: FirebaseFirestore.CollectionReference) {
  for (;;) {
    const snap = await col.limit(300).get();
    if (snap.empty) return;
    const batch = getFirestore().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 300) return;
  }
}

/** Удаляет файлы Storage по префиксу. Отсутствие файлов — не ошибка. */
async function deletePrefix(prefix: string) {
  try {
    await getStorage().bucket().deleteFiles({ prefix });
  } catch (e) {
    logger.warn('Не удалось удалить файлы', { prefix, e });
  }
}

// retry: true — при исключении событие повторится с нарастающей задержкой,
// а отметка этапа не даст начать сначала
export const onDeletionRequested = onDocumentCreated(
  { document: 'deletions/{uid}', retry: true },
  async (event) => {
    const uid = event.params.uid;
    await audit({
      action: 'account.deletion_requested',
      actor: { type: 'user', uid },
      subject: { type: 'user', id: uid },
      correlationId: event.id,
    });
    await runDeletion(uid, event.id);
  },
);
