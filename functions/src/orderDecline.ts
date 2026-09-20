import { logger } from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import { pushTo } from './push';
import { notifyMastersAbout, orderBurstExceeded } from './orderPush';
import { audit } from './audit';
import { moneyMoved, reopenedFields } from './masterExit';

// Отказ мастера от взятой заявки.
//
// Снять себя с заявки мастер не может: masterId, телефоны сторон и условия
// оплаты пишет только сервер. Поэтому он ставит отметку masterDeclinedAt —
// правила пускают её только назначенному мастеру и только у работы в
// процессе, — а здесь заявка возвращается в поиск тем же набором полей, что
// при удалении аккаунта мастера: контакты стёрты, клиент получает пуш,
// предложение мастера снято — иначе клиент мог бы выбрать его снова.
//
// Транзакция с перепроверкой: пока событие ехало, клиент мог отменить заявку
// или принять работу — тогда возвращать нечего. Повтор доставки увидит
// заявку уже в поиске и пройдёт мимо: ни второго пуша, ни второй записи.

/**
 * Возвращает true, если событие было отметкой об отказе — вызывающему
 * дальше нечего делать, статус в этом событии не менялся.
 */
export async function handleMasterDecline(
  orderId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData,
  correlationId: string,
): Promise<boolean> {
  if (after.masterDeclinedAt == null || before.masterDeclinedAt != null) return false;
  const masterId = typeof after.masterId === 'string' ? after.masterId : null;
  if (!masterId) return true;

  const db = getFirestore();
  const ref = db.doc(`orders/${orderId}`);
  const reopened = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    if (snap.get('status') !== 'В работе' || snap.get('masterId') !== masterId) return false;
    // Правила такую отметку не пропускают; здесь та же проверка на случай,
    // если оплату отметили, пока событие ехало
    if (moneyMoved(snap.data() ?? {})) return false;
    // Отметка снимается вместе с мастером: следующий исполнитель должен
    // иметь возможность поставить свою
    tx.set(ref, { ...reopenedFields(), masterDeclinedAt: null }, { merge: true });
    tx.delete(ref.collection('offers').doc(masterId));
    return true;
  });

  if (!reopened) {
    logger.info('Отказ мастера пришёл к заявке не в работе — пропущен', { orderId });
    return true;
  }

  await audit({
    action: 'order.master_declined',
    actor: { type: 'user', uid: masterId },
    subject: { type: 'order', id: orderId },
    correlationId,
    details: { masterId },
  });

  const clientId = typeof after.clientId === 'string' ? after.clientId : null;
  if (clientId) {
    await pushTo(
      [clientId],
      'Мастер отказался от заявки',
      `${String(after.title ?? 'Заявка')} снова ищет исполнителя`,
      { href: '/' },
    );
  }
  // Остальные мастера города узнают о заявке заново: пуш при создании они
  // получали, но тогда она ушла к другому, и о ней забыли. Тот же лимит, что
  // у новых заявок: связка «клиент + отказывающийся мастер» не должна будить
  // весь город без счёта.
  if (!clientId || !(await orderBurstExceeded(clientId))) {
    await notifyMastersAbout({ ...after, ...reopenedFields() }, 'Заявка снова ищет мастера', {
      excludeUid: masterId,
    });
  }
  return true;
}
