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

export const onMasterDeleted = onDocumentDeleted(
  { document: 'masters/{masterId}', retry: true },
  async (event) => {
    const db = getFirestore();
    const masterId = event.params.masterId;

    const dropped = await dropPendingOffers(masterId);

    // Заявки, где он был исполнителем. «Ждёт подтверждения» не трогаем:
    // работа сделана, клиенту остаётся её подтвердить, и отбирать у него
    // эту возможность нельзя.
    const orders = await db
      .collection('orders')
      .where('masterId', '==', masterId)
      .where('status', '==', 'В работе')
      .get();

    for (const d of orders.docs) {
      await d.ref.set(
        {
          status: 'Поиск мастера',
          masterId: null,
          masterName: null,
          agreedPrice: null,
          agreedAt: null,
          reopenedAt: new Date(),
        },
        { merge: true },
      );

      const clientId = d.get('clientId');
      if (clientId) {
        await pushTo(
          [clientId],
          'Мастер отказался от заявки',
          `${d.get('title') ?? 'Заявка'} снова ищет исполнителя`,
          { href: '/' },
        );
      }
    }

    await audit({
      action: 'master.deleted',
      actor: SYSTEM,
      subject: { type: 'master', id: masterId },
      correlationId: event.id,
      details: { offersDropped: dropped, ordersReopened: orders.size },
    });
    logger.info('Мастер удалён', { masterId, dropped, reopened: orders.size });
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
