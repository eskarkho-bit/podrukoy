import { logger } from 'firebase-functions';
import { onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { pushTo } from './push';
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

/** Снимает все неотвеченные предложения мастера. */
async function dropPendingOffers(masterId: string): Promise<number> {
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
 * Отвязывает исчезнувшего мастера от его заявок.
 *
 * «В работе» возвращаются в поиск: клиент не должен сидеть с
 * мастером-призраком. «Ждёт подтверждения» и завершённые остаются — работа
 * сделана, — но телефон мастера из них уходит: человека больше нет, звонить
 * некому, а чужой номер без владельца — это уже не контакт, а утечка.
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
    if (d.get('status') === 'В работе') {
      await d.ref.set(
        {
          status: 'Поиск мастера',
          masterId: null,
          masterName: null,
          agreedPrice: null,
          agreedAt: null,
          masterPhone: null,
          clientPhone: null,
          reopenedAt: new Date(),
        },
        { merge: true },
      );
      reopened += 1;

      const clientId = d.get('clientId');
      if (clientId) {
        await pushTo(
          [clientId],
          'Мастер отказался от заявки',
          `${d.get('title') ?? 'Заявка'} снова ищет исполнителя`,
          { href: '/' },
        );
      }
    } else if (d.get('masterPhone') != null) {
      await d.ref.set({ masterPhone: null }, { merge: true });
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
