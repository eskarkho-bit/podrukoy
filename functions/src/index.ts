// Первым — настройки: они действуют только на функции, объявленные после
import './options';
import { logger } from 'firebase-functions';
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { pushTo, pushToAdmins } from './push';
import { notifyMastersAbout, orderBurstExceeded } from './orderPush';
import { meterExceeded } from './meters';
import { shareOrderContacts } from './orderContacts';
import { notePaymentMarks } from './orderPayment';
import { handleMasterDecline } from './orderDecline';
import { claimOnce } from './once';
import { audit, SYSTEM, type AuditAction } from './audit';
import { recordCompletedOrder } from './orderStats';
import { recomputeRating, recountCompletedOrders } from './masterStats';

export { requestPhoneCode, verifyPhoneCode } from './phoneAuth';
export { onDeletionRequested } from './deletion';
export { onMasterDeleted, onMasterUnverified } from './masterExit';
export { reconcile } from './reconcile';
export { serviceReminders } from './serviceReminders';
export {
  adminCloseOrder,
  adminSetUserBlocked,
  adminSetMasterBlocked,
  adminSetReviewHidden,
  adminResolveComplaint,
  adminFindUserByPhone,
} from './adminActions';
export { dashboardDaily } from './dashboard';

// Серверная часть «domio». Здесь живёт всё, чему нельзя доверять клиенту:
// рассылка уведомлений (клиент не вправе читать чужие токены) и пересчёт
// рейтинга мастера (иначе он поставил бы себе любой).
//
// Требует тарифа Blaze: на бесплатном Spark функции не разворачиваются.

initializeApp();

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

// Обращения в поддержку: пуш модераторам не чаще раза в столько на человека
const SUPPORT_PUSH_WINDOW_MS = 10 * 60_000;

/**
 * Можно ли звать прошлого мастера лично: допуск на месте, клиент его не
 * заблокировал и у них действительно была общая заявка. Без последней
 * проверки поле preferredMasterId стало бы способом дёргать пушем любого
 * мастера по uid.
 */
async function preferredMasterAllowed(
  order: FirebaseFirestore.DocumentData,
  masterId: string,
): Promise<boolean> {
  const db = getFirestore();
  const clientId = String(order.clientId ?? '');
  const master = await db.doc(`masters/${masterId}`).get();
  if (master.get('verified') !== true || master.get('blocked') === true) return false;
  const blocked = (await db.doc(`users/${clientId}`).get()).get('blockedMasters');
  if (Array.isArray(blocked) && blocked.includes(masterId)) return false;
  // Два равенства — Firestore обходится одиночными индексами, составной не нужен
  const prior = await db
    .collection('orders')
    .where('clientId', '==', clientId)
    .where('masterId', '==', masterId)
    .limit(1)
    .get();
  return !prior.empty;
}

// ---------- новая заявка → мастерам ----------

// Выборка «кому слать» — в orderPush.ts: тот же код зовёт мастеров повторно
// из сверки, когда заявка долго остаётся без предложений.

export const onOrderCreated = onDocumentCreated('orders/{orderId}', async (event) => {
  const order = event.data?.data();
  if (!order || order.status !== 'Поиск мастера') return;

  // Повторная заявка зовёт прошлого мастера лично: «Повторить» в приложении
  // пишет preferredMasterId, и этому мастеру уходит именной пуш вместо общего
  const preferred =
    typeof order.preferredMasterId === 'string' && order.preferredMasterId !== order.clientId
      ? order.preferredMasterId
      : null;

  await audit({
    action: 'order.created',
    actor: { type: 'user', uid: String(order.clientId ?? '') },
    subject: { type: 'order', id: event.params.orderId },
    correlationId: event.id,
    details: {
      category: String(order.category ?? ''),
      city: String(order.city ?? ''),
      preferredMasterId: preferred,
    },
  });

  // Один аккаунт не должен будить всех мастеров города каждую минуту: сверх
  // лимита заявка создаётся и видна в ленте, но рассылки по ней нет
  if (await orderBurstExceeded(String(order.clientId ?? ''))) {
    await audit({
      action: 'order.push_throttled',
      actor: SYSTEM,
      subject: { type: 'order', id: event.params.orderId },
      correlationId: event.id,
    });
    logger.warn('Рассылка о заявке пропущена: слишком много заявок от клиента', {
      orderId: event.params.orderId,
    });
    return;
  }

  const preferredOk = preferred ? await preferredMasterAllowed(order, preferred) : false;

  await notifyMastersAbout(order, 'Новая заявка рядом', {
    excludeUid: preferredOk && preferred ? preferred : undefined,
  });

  if (preferredOk && preferred) {
    await pushTo([preferred], 'Ваш клиент снова зовёт вас', String(order.title ?? 'Заявка'), {
      href: '/profile',
    });
  }
});

// ---------- предложение мастера → клиенту ----------

export const onOfferCreated = onDocumentCreated(
  'orders/{orderId}/offers/{masterId}',
  async (event) => {
    const offer = event.data?.data();
    if (!offer) return;

    const db = getFirestore();
    const orderRef = db.doc(`orders/${event.params.orderId}`);

    // Штамп первого предложения — из него дашборд считает «время до
    // отклика». Транзакция ставит его только если поля ещё нет: второе
    // предложение не должно переписать время первого.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists || snap.get('firstOfferAt')) return;
      tx.update(orderRef, { firstOfferAt: FieldValue.serverTimestamp() });
    });

    const order = await orderRef.get();
    const clientId = order.get('clientId');
    if (!clientId) return;

    await pushTo(
      [clientId],
      `${offer.masterName ?? 'Мастер'} предлагает ${rub(Number(offer.price ?? 0))}`,
      String(order.get('title') ?? 'Ваша заявка'),
      { href: '/' },
    );
  },
);

// ---------- сообщение → собеседнику ----------

export const onMessageCreated = onDocumentCreated(
  'orders/{orderId}/messages/{messageId}',
  async (event) => {
    const message = event.data?.data();
    if (!message) return;

    const db = getFirestore();
    const order = await db.doc(`orders/${event.params.orderId}`).get();
    const clientId = order.get('clientId');
    const masterId = order.get('masterId');

    // Отметка о последнем сообщении — в самой заявке: по ней список чатов
    // сортируется и считает непрочитанное, не подписываясь на переписку
    // каждой заявки. Текста здесь нет — только кто и когда.
    await db.doc(`orders/${event.params.orderId}`).set(
      {
        lastMessageAt: message.createdAt ?? FieldValue.serverTimestamp(),
        lastMessageBy: String(message.senderId ?? ''),
      },
      { merge: true },
    );

    // Уведомляем того, кто не отправлял
    const to = message.senderId === clientId ? masterId : clientId;
    if (!to) return;

    const fromClient = message.senderId === clientId;
    // Текст сообщения в пуш не кладём: он проходит через сервис Expo и
    // ложится на экран блокировки, а в переписке по заявке бывают адрес и
    // телефон. Пуш говорит, что есть новое, — само сообщение ждёт в чате.
    const body =
      message.imageUrl && !String(message.text ?? '').trim() ? 'Фото' : 'Новое сообщение';
    await pushTo(
      [to],
      fromClient
        ? String(order.get('clientName') ?? 'Клиент')
        : String(order.get('masterName') ?? 'Мастер'),
      body,
      { href: fromClient ? '/profile' : '/messages' },
    );
  },
);

// ---------- смена статуса заявки ----------

// retry: потерянное событие оставило бы заявку без телефонов сторон или с
// необработанным отказом мастера; обработчики идемпотентны — повтор пуша
// дешевле такой заявки
export const onOrderStatusChanged = onDocumentUpdated(
  { document: 'orders/{orderId}', retry: true },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Отметки о расчёте («оплатил», «получил») приходят тем же событием, но
    // статус при этом обычно не меняется — смотрим на них до проверки статуса
    await notePaymentMarks(event.params.orderId, before, after, event.id);
    // Отказ мастера — тоже отметка без смены статуса: статус меняет уже сервер
    if (await handleMasterDecline(event.params.orderId, before, after, event.id)) return;
    if (before.status === after.status) return;

    const title = String(after.title ?? 'Заявка');
    const clientId = after.clientId as string | undefined;
    const masterId = after.masterId as string | undefined;

    // Клиент не согласился с «выполнено»: работа вернулась тому же мастеру.
    // Это не выбор исполнителя — контакты уже в заявке, и «Вас выбрали» здесь
    // было бы ложью, — поэтому ветка стоит до общей карты статусов
    // Отметка «уже обработано» — до пушей: с retry событие после сбоя на
    // полпути приходит снова, и без неё пуш ушёл бы дважды
    const transition = `${before.status}>${after.status}`;
    if (!(await claimOnce(event.params.orderId, `status:${transition}`))) return;

    if (before.status === 'Ждёт подтверждения' && after.status === 'В работе') {
      // Отметка для мастера: тот же статус «В работе», но повод не
      // праздновать, а доделать — экран по ней не показывает конфетти
      await getFirestore()
        .doc(`orders/${event.params.orderId}`)
        .set({ returnedToWorkAt: FieldValue.serverTimestamp() }, { merge: true });
      await audit({
        action: 'order.returned_to_work',
        actor: SYSTEM,
        subject: { type: 'order', id: event.params.orderId },
        correlationId: event.id,
        details: { masterId: masterId ?? null },
      });
      if (masterId) {
        await pushTo(
          [masterId],
          'Клиент вернул заявку в работу',
          `${title}: работа ещё не принята`,
          {
            href: '/profile',
          },
        );
      }
      return;
    }

    // Смена статуса — единственный след того, как двигалась сделка. Без него
    // спор «я не соглашался на эту цену» разобрать нечем.
    const ACTION_BY_STATUS: Record<string, AuditAction> = {
      'В работе': 'order.master_selected',
      'Ждёт подтверждения': 'order.finished',
      Завершена: 'order.confirmed',
      Отменена: 'order.cancelled',
      'Поиск мастера': 'order.reopened',
    };
    const action = ACTION_BY_STATUS[after.status as string];
    if (action) {
      await audit({
        action,
        actor: SYSTEM,
        subject: { type: 'order', id: event.params.orderId },
        correlationId: event.id,
        details: {
          from: String(before.status ?? ''),
          to: String(after.status ?? ''),
          masterId: masterId ?? null,
          agreedPrice: typeof after.agreedPrice === 'number' ? after.agreedPrice : null,
        },
      });
    }

    // Клиент выбрал исполнителя. С этого момента заявку читают только двое —
    // сервер кладёт в неё телефоны сторон, и у обеих появляется кнопка звонка
    if (after.status === 'В работе' && masterId) {
      await shareOrderContacts(event.params.orderId, event.id);
      await pushTo(
        [masterId],
        'Вас выбрали!',
        `${title} · ${rub(Number(after.agreedPrice ?? 0))}`,
        {
          href: '/profile',
        },
      );
      return;
    }

    if (after.status === 'Ждёт подтверждения' && clientId) {
      await pushTo([clientId], 'Работа выполнена', `Подтвердите завершение: ${title}`, {
        href: '/',
      });
      return;
    }

    // Закрытие модерацией должно и называться закрытием модерацией: клиент,
    // о котором «Клиент отменил заявку», решил бы, что сходит с ума
    const byAdmin = after.closedByAdmin === true && before.closedByAdmin !== true;
    const adminReason = String(after.adminCloseReason ?? title);
    // Клиент удалил аккаунт — сданную работу закрыл сервер, подтверждать
    // было некому; «клиент подтвердил» здесь было бы ложью
    const byDeletion = after.closedByDeletion === true && before.closedByDeletion !== true;

    if (after.status === 'Завершена') {
      // Цена уходит в гистограмму: медиана чека в сводке модератора считается
      // по ней, а не по заявкам. Отметка о зачёте ставится на саму заявку,
      // поэтому повтор события второй раз её не посчитает.
      await recordCompletedOrder(
        event.params.orderId,
        typeof after.agreedPrice === 'number' ? after.agreedPrice : 0,
      );
      if (masterId) {
        // Счётчик заказов в анкете — клиент видит его в профиле мастера
        await recountCompletedOrders(masterId);
        await pushTo(
          [masterId],
          byAdmin
            ? 'Заявка закрыта модерацией'
            : byDeletion
              ? 'Заявка закрыта: клиент удалил аккаунт'
              : 'Клиент подтвердил работу',
          byAdmin ? adminReason : byDeletion ? `${title} · работа засчитана` : title,
          { href: '/profile' },
        );
      }
      if (byAdmin && clientId) {
        await pushTo([clientId], 'Заявка закрыта модерацией', adminReason, { href: '/' });
      }
      return;
    }

    if (after.status === 'Отменена') {
      // Сделки больше нет — телефоны и реквизиты сторон из заявки уходят: без
      // этого отменённая заявка оставалась бы справочником чужих номеров
      if (after.masterPhone != null || after.clientPhone != null || after.masterBanks != null) {
        await getFirestore()
          .doc(`orders/${event.params.orderId}`)
          .set(
            { masterPhone: null, clientPhone: null, masterBanks: null, masterAcceptsCash: null },
            { merge: true },
          );
      }
      if (masterId) {
        await pushTo(
          [masterId],
          byAdmin ? 'Заявка отменена модерацией' : 'Клиент отменил заявку',
          byAdmin ? adminReason : title,
          { href: '/profile' },
        );
      }
      if (byAdmin && clientId) {
        await pushTo([clientId], 'Заявка отменена модерацией', adminReason, { href: '/' });
      }
    }
  },
);

// ---------- обращение в поддержку ----------

// Сообщение в тредах поддержки: от клиента — модераторам, от модератора —
// клиенту. Приветствие, которое приложение пишет при открытии чата, помечено
// auto и пушей не рождает: человек и так смотрит на этот экран.
export const onSupportMessageCreated = onDocumentCreated(
  'users/{uid}/threads/{threadId}/messages/{messageId}',
  async (event) => {
    if (event.params.threadId !== 'support') return;
    const message = event.data?.data();
    if (!message || message.auto === true) return;

    // Текст обращения в пуш не кладём — по той же причине, что и в переписке
    // по заявке: чужой сервис и экран блокировки. Читают его в приложении.
    if (message.from === 'user') {
      // Не чаще раза в десять минут на человека: серия сообщений подряд —
      // одно обращение, а не десять пушей всем модераторам
      const throttled = await meterExceeded(
        `supportPush-${event.params.uid}`,
        1,
        SUPPORT_PUSH_WINDOW_MS,
      );
      if (throttled) return;
      const delivered = await pushToAdmins('Обращение в поддержку', 'Новое сообщение', {
        href: '/profile',
      });
      if (!delivered) logger.warn('Обращение в поддержку, но модераторов нет — некому отвечать');
      return;
    }

    await pushTo([event.params.uid], 'Поддержка', 'Вам ответили — откройте переписку', {
      href: '/messages',
    });
  },
);

// ---------- проверка мастера ----------

// Заявка ушла на проверку → всем модераторам; вердикт вынесен → мастеру.
// Модератор должен узнать о заявке сам, а не заглядывать в раздел «вдруг
// кто-то подал».
export const onVerificationChanged = onDocumentWritten(
  'masters/{masterId}/verification/{docId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) return;

    const wasStatus = before?.status;
    const status = after.status;
    if (wasStatus === status) return;

    const db = getFirestore();
    const masterId = event.params.masterId;

    // Решение модератора — самое чувствительное действие в системе: оно
    // открывает доступ к адресам клиентов. Кто и когда его принял, должно
    // быть видно всегда.
    const VERDICT: Record<string, AuditAction> = {
      pending: 'master.applied',
      approved: 'master.approved',
      rejected: 'master.rejected',
    };
    const action = VERDICT[status as string];
    if (action) {
      const reviewer = after.reviewedBy;
      await audit({
        action,
        actor:
          typeof reviewer === 'string' && reviewer
            ? { type: 'admin', uid: reviewer }
            : { type: 'user', uid: masterId },
        subject: { type: 'master', id: masterId },
        correlationId: event.id,
        details: {
          hasPhoto: !!after.photoUrl,
          // Причина отказа — свободный текст мастеру, в журнале хватит факта
          rejected: status === 'rejected',
          // Повторная проверка: одобренный мастер сменил телефон или фото
          reapplied: wasStatus === 'approved',
        },
      });
    }

    // Отзыв согласия на снимок у одобренного: приложение снимает допуск тем
    // же пакетом, сервер повторяет — без снимка личность не подтверждена, и
    // адреса клиентов такому мастеру видеть нельзя
    if (wasStatus === 'approved' && status === 'draft') {
      await db.doc(`masters/${masterId}`).set({ verified: false }, { merge: true });
      return;
    }

    if (status === 'pending') {
      // Повторная проверка после смены телефона или фото: допуск снимается
      // сервером, даже если приложение не успело, — телефон, на который
      // клиенты переводят оплату, не должен работать непроверенным
      const reapplied = wasStatus === 'approved';
      if (reapplied) {
        // Транзакция с перепроверкой: модератор мог одобрить повторную
        // анкету раньше, чем событие доехало, — тогда снимать допуск поздно
        const applicationRef = db.doc(`masters/${masterId}/verification/application`);
        await db.runTransaction(async (tx) => {
          const current = await tx.get(applicationRef);
          if (current.get('status') !== 'pending') return;
          tx.set(db.doc(`masters/${masterId}`), { verified: false }, { merge: true });
        });
      }
      const master = await db.doc(`masters/${masterId}`).get();
      const delivered = await pushToAdmins(
        reapplied ? 'Повторная проверка мастера' : 'Заявка мастера на проверку',
        `${master.get('name') ?? 'Без имени'} · ${
          (master.get('cities') ?? []).join(', ') || master.get('city') || 'вся республика'
        }`,
        { href: '/profile' },
      );
      if (!delivered) logger.warn('Заявка мастера подана, но модераторов нет — некому проверять');
      return;
    }

    if (status === 'approved') {
      await pushTo(
        [masterId],
        'Анкета одобрена',
        'Заявки клиентов теперь видны в разделе «Я мастер»',
        { href: '/profile' },
      );
      return;
    }

    if (status === 'rejected') {
      await pushTo(
        [masterId],
        'Анкету отклонили',
        String(after.rejectionReason ?? 'Откройте раздел «Я мастер», чтобы исправить'),
        { href: '/profile' },
      );
    }
  },
);

// ---------- рейтинг мастера ----------

// Считается на сервере и только на сервере: правила запрещают писать rating
// и reviewsCount кому бы то ни было, поэтому цифре можно верить. Сам
// пересчёт — в masterStats.recomputeRating: его же зовёт скрытие отзыва
// модератором, и скрытые отзывы в цифру не входят.
export const onReviewWritten = onDocumentWritten(
  'masters/{masterId}/reviews/{orderId}',
  async (event) => {
    const masterId = event.params.masterId;

    if (event.data?.after.exists && !event.data.before.exists) {
      await audit({
        action: 'review.created',
        actor: { type: 'user', uid: String(event.data.after.get('clientId') ?? '') },
        subject: { type: 'master', id: masterId },
        correlationId: event.id,
        details: {
          orderId: event.params.orderId,
          stars: Number(event.data.after.get('stars')) || 0,
        },
      });
    }

    await recomputeRating(masterId);
  },
);

// ---------- жалоба на отзыв ----------

// Сама жалоба создаётся с клиента под правилами; серверу остаётся след в
// журнале и пуш модераторам. Текст жалобы в пуш не кладём: он уходит через
// сервис Expo, а свободному тексту пользователя там не место.
export const onComplaintCreated = onDocumentCreated('complaints/{complaintId}', async (event) => {
  const complaint = event.data?.data();
  if (!complaint) return;

  await audit({
    action: 'complaint.created',
    actor: { type: 'user', uid: String(complaint.byUid ?? '') },
    subject: { type: 'complaint', id: event.params.complaintId },
    correlationId: event.id,
    details: {
      subjectType: String(complaint.subjectType ?? 'review'),
      masterId: String(complaint.masterId ?? ''),
      orderId: String(complaint.orderId ?? ''),
    },
  });

  // Модератору важно с порога понять, кто на кого жалуется: отзыв разбирают
  // по анкете, мастера и сообщение — по заявке и переписке
  const PUSH_BY_TYPE: Record<string, [string, string]> = {
    review: ['Жалоба на отзыв', 'Мастер просит проверить отзыв'],
    master: ['Жалоба на мастера', 'Клиент просит разобраться с исполнителем'],
    message: ['Жалоба на сообщение', 'Клиент просит проверить переписку'],
  };
  const [pushTitle, pushBody] = PUSH_BY_TYPE[String(complaint.subjectType)] ?? PUSH_BY_TYPE.review;
  const delivered = await pushToAdmins(pushTitle, pushBody, { href: '/profile' });
  if (!delivered) logger.warn('Жалоба подана, но модераторов нет — некому разбирать');
});
