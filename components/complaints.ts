import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

// Жалобы: мастера — на отзыв о себе, клиента — на мастера своей заявки или
// на его сообщение в чате.
//
// Модуль-помощник по прецеденту verification.ts: MasterScreen — документиро-
// ванный долг с прямым доступом к Firestore, и тащить его логику в AppState
// не стоит; но и размазывать форму документа жалобы по экранам нельзя —
// правила проверяют её поля буквально, форма и правила меняются вместе.
//
// Вердикт по жалобе выносит только сервер: здесь создаётся документ со
// статусом «новая», и ничего больше.

export type ComplaintInput =
  | {
      subjectType: 'review';
      /** id отзыва == id заявки */
      orderId: string;
      /** автор отзыва — модератору для карточки */
      reviewClientId: string;
      text: string;
    }
  | { subjectType: 'master'; orderId: string; masterId: string; text: string }
  | { subjectType: 'message'; orderId: string; masterId: string; messageId: string; text: string };

export async function fileComplaint(input: ComplaintInput): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Нужен вход');
  const base = {
    byUid: uid,
    subjectType: input.subjectType,
    orderId: input.orderId,
    text: input.text.trim(),
    status: 'новая',
    createdAt: serverTimestamp(),
  };
  if (input.subjectType === 'review') {
    // Жалуются на отзыв в собственной анкете, поэтому masterId — это сам автор
    await addDoc(collection(db, 'complaints'), {
      ...base,
      masterId: uid,
      reviewClientId: input.reviewClientId,
    });
    return;
  }
  await addDoc(collection(db, 'complaints'), {
    ...base,
    masterId: input.masterId,
    ...(input.subjectType === 'message' ? { messageId: input.messageId } : {}),
  });
}
