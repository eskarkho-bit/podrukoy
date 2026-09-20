import { logger } from 'firebase-functions';
import { onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { pushTo } from './push';
import { notifyMastersAbout, orderBurstExceeded } from './orderPush';
import { audit, SYSTEM } from './audit';

// Что делать, когда мастер исчезает.
//
// Исчезнуть он может двумя способами, и они не равнозначны:
//
//   удалил аккаунт        — человека больше нет, работать по заявке некому;
//   отозвал допуск        — человек есть, но личность не подтверждена
//                           (например, отозвал согласие на фотографию).
//
// В первом случае заявку в работе надо вернуть в поиск: клиент не должен
// сидеть с мастером-призраком. Во втором — оставить, там живой исполнитель,
// просто он больше не проходит проверку; но висящие предложения снять надо,
// потому что взяться за новое он уже не вправе.

/** Снимает все неотвеченные предложения мастера. Зовётся и блокировкой. */
export async function dropPendingOffers(masterId: string): Promise<number> {
  const db = getFirestore();
  const offers = await db
    .collectionGroup('offers')
    .where('masterId', '==', masterId)
    .where('status', '==', 'pending')
    .get();

  if (offers.empty) return 0;
  const batch = db.batch();
  offers.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return offers.size;
}

/**
 * Поля, которые возвращают заявку в поиск: мастера, его контактов и условий
 * оплаты в ней больше нет, телефон клиента тоже снят — открытую заявку снова
 * читают все мастера города. Один набор на два пути: удаление аккаунта
 * мастера и его отказ от заявки (orderDecline.ts) — разошедшиеся наборы
 * оставили бы номер в одном из них.
 */
/**
 * Клиент отметил оплату или мастер — получение. Такую заявку в поиск не
 * возвращают: деньги уже переходили из рук в руки, и новый исполнитель
 * увидел бы её «оплаченной». Правила ту же проверку делают на отметке
 * отказа; здесь она — для удаления аккаунта, где отметки нет.
 */
export const moneyMoved = (order: FirebaseFirestore.DocumentData) =>
  order.paidAt != null || order.paymentReceivedAt != null;

export function reopenedFields() {
  return {
    status: 'Поиск мастера',
    masterId: null,
    masterName: null,
    agreedPrice: null,
    agreedAt: null,
    masterPhone: null,
    clientPhone: null,
    masterBanks: null,
    masterAcceptsCash: null,
    // Способ оплаты клиент выбирал под прежнего мастера; отметка об отказе
    // должна быть доступна следующему
    paymentMethod: null,
    masterDeclinedAt: null,
    returnedToWorkAt: null,
    reopenedAt: new Date(),
  };
}

/**
 * Отвязывает исчезнувшего мастера от его заявок.
 *
 * «В работе» возвращаются в поиск: клиент не должен сидеть с
 * мастером-призраком. «Ждёт подтверждения» и завершённые остаются — работа
 * сделана, — но телефон мастера и условия оплаты из них уходят: человека
 * больше нет, звонить и переводить некому, а чужой номер без владельца —
 * это уже не контакт, а утечка.
 * Телефон клиента у возвращённой в поиск заявки тоже снимается: открытую
 * заявку снова читают все мастера города.
 *
 * Возвращает, сколько заявок вернулось в поиск. Каждый шаг идемпотентен:
 * повтор события перепишет те же значения.
 */
export async function detachMasterFromOrders(masterId: string): Promise<number> {
  const db = getFirestore();
  const orders = await db.collection('orders').where('masterId', '==', masterId).get();

  let reopened = 0;
  for (const d of orders.docs) {
    // Решение — транзакцией по свежему документу: между выборкой и записью
    // клиент мог отменить заявку, принять работу или отметить оплату
    const outcome = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref);
      if (!fresh.exists || fresh.get('masterId') !== masterId) return null;
      const data = fresh.data() ?? {};
      if (fresh.get('status') === 'В работе' && moneyMoved(data)) {
        // Деньги уже переходили из рук в руки — заявка закрывается, а не ищет
        // нового исполнителя; спор, если он есть, разбирает модерация
        tx.set(
          d.ref,
          {
            status: 'Отменена',
            masterPhone: null,
            clientPhone: null,
            masterBanks: null,
            masterAcceptsCash: null,
          },
          { merge: true },
        );
        return { kind: 'closed' as const, data };
      }
      if (fresh.get('status') === 'В работе') {
        tx.set(d.ref, reopenedFields(), { merge: true });
        return { kind: 'reopened' as const, data };
      }
      if (fresh.get('masterPhone') != null || fresh.get('masterBanks') != null) {
        // Вместе с номером уходят и условия оплаты: переводить больше некому
        tx.set(
          d.ref,
          { masterPhone: null, masterBanks: null, masterAcceptsCash: null },
          { merge: true },
        );
      }
      return { kind: 'kept' as const, data };
    });
    if (!outcome) continue;

    const clientId = outcome.data.clientId;
    if (outcome.kind === 'closed') {
      if (clientId) {
        await pushTo(
          [clientId],
          'Мастер удалил аккаунт',
          `${outcome.data.title ?? 'Заявка'} закрыта. Если вы уже платили — напишите в поддержку`,
          { href: '/' },
        );
      }
    } else if (outcome.kind === 'reopened') {
      reopened += 1;
      if (clientId) {
        await pushTo(
          [clientId],
          'Мастер отказался от заявки',
          `${outcome.data.title ?? 'Заявка'} снова ищет исполнителя`,
          { href: '/' },
        );
      }
      // Остальные мастера города узнают о заявке заново: пуш при создании
      // они получали, но тогда она ушла к другому, и о ней забыли. Тот же
      // лимит, что у новых заявок: связка «клиент + уходящий мастер» не
      // должна будить весь город без счёта.
      if (!clientId || !(await orderBurstExceeded(String(clientId)))) {
        await notifyMastersAbout(
          { ...outcome.data, ...reopenedFields() },
          'Заявка снова ищет мастера',
          { excludeUid: masterId },
        );
      }
    }
  }
  return reopened;
}

export const onMasterDeleted = onDocumentDeleted(
  { document: 'masters/{masterId}', retry: true },
  async (event) => {
    const masterId = event.params.masterId;

    const dropped = await dropPendingOffers(masterId);
    const reopened = await detachMasterFromOrders(masterId);

    await audit({
      action: 'master.deleted',
      actor: SYSTEM,
      subject: { type: 'master', id: masterId },
      correlationId: event.id,
      details: { offersDropped: dropped, ordersReopened: reopened },
    });
    logger.info('Мастер удалён', { masterId, dropped, reopened });
  },
);

export const onMasterUnverified = onDocumentUpdated(
  { document: 'masters/{masterId}', retry: true },
  async (event) => {
    const was = event.data?.before.get('verified') === true;
    const now = event.data?.after.get('verified') === true;
    if (!was || now) return;

    // Допуск снят: за новые заявки браться нельзя, поэтому неотвеченные
    // предложения убираем. Уже начатую работу оставляем — исполнитель на
    // месте, и бросать клиента посреди ремонта хуже.
    const dropped = await dropPendingOffers(event.params.masterId);
    await audit({
      action: 'master.unverified',
      actor: SYSTEM,
      subject: { type: 'master', id: event.params.masterId },
      correlationId: event.id,
      details: { offersDropped: dropped },
    });
    logger.info('Допуск мастера снят', { masterId: event.params.masterId, dropped });
  },
);
