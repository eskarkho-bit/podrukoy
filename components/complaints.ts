import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

// Жалоба мастера на отзыв о себе.
//
// Модуль-помощник по прецеденту verification.ts: MasterScreen — документиро-
// ванный долг с прямым доступом к Firestore, и тащить его логику в AppState
// не стоит; но и размазывать форму документа жалобы по экрану нельзя —
// правила проверяют её поля буквально, форма и правила меняются вместе.
//
// Вердикт по жалобе выносит только сервер: здесь создаётся документ со
// статусом «новая», и ничего больше.

export async function fileComplaint(input: {
  /** id отзыва == id заявки */
  orderId: string;
  /** автор отзыва — модератору для карточки */
  reviewClientId: string;
  text: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Нужен вход');
  await addDoc(collection(db, 'complaints'), {
    byUid: uid,
    subjectType: 'review',
    // Жалуются на отзыв в собственной анкете, поэтому masterId — это сам автор
    masterId: uid,
    orderId: input.orderId,
    reviewClientId: input.reviewClientId,
    text: input.text.trim(),
    status: 'новая',
    createdAt: serverTimestamp(),
  });
}
