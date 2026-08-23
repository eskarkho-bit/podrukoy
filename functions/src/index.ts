import { setGlobalOptions } from 'firebase-functions/v2';
import { logger } from 'firebase-functions';
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { pushTo } from './push';
import { notifyMastersAbout } from './orderPush';
import { audit, SYSTEM, type AuditAction } from './audit';
import { recordCompletedOrder } from './orderStats';
import { recountCompletedOrders } from './masterStats';

export { createCardBinding, yookassaWebhook } from './payments';
export { requestPhoneCode, verifyPhoneCode } from './phoneAuth';
export { onDeletionRequested } from './deletion';
export { onMasterDeleted, onMasterUnverified } from './masterExit';
export { reconcile } from './reconcile';

// Серверная часть «domio». Здесь живёт всё, чему нельзя доверять клиенту:
// рассылка уведомлений (клиент не вправе читать чужие токены) и пересчёт
// рейтинга мастера (иначе он поставил бы себе любой).
//
// Требует тарифа Blaze: на бесплатном Spark функции не разворачиваются.

initializeApp();

// Потолок инстансов — страховка от неожиданного счёта: всплеск заявок не
// должен превращаться в неограниченную рассылку
setGlobalOptions({ maxInstances: 10 });

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

// ---------- новая заявка → мастерам ----------

// Выборка «кому слать» — в orderPush.ts: тот же код зовёт мастеров повторно
// из сверки, когда заявка долго остаётся без предложений.

export const onOrderCreated = onDocumentCreated('orders/{orderId}', async (event) => {
  const order = event.data?.data();
  if (!order || order.status !== 'Поиск мастера') return;

  await audit({
    action: 'order.created',
    actor: { type: 'user', uid: String(order.clientId ?? '') },
    subject: { type: 'order', id: event.params.orderId },
    correlationId: event.id,
    details: { category: String(order.category ?? ''), city: String(order.city ?? '') },
  });

  await notifyMastersAbout(order, 'Новая заявка рядом');
});

// ---------- предложение мастера → клиенту ----------

export const onOfferCreated = onDocumentCreated(
  'orders/{orderId}/offers/{masterId}',
  async (event) => {
    const offer = event.data?.data();
    if (!offer) return;

    const db = getFirestore();
    const order = await db.doc(`orders/${event.params.orderId}`).get();
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

    // Уведомляем того, кто не отправлял
    const to = message.senderId === clientId ? masterId : clientId;
    if (!to) return;

    const fromClient = message.senderId === clientId;
    await pushTo(
      [to],
      fromClient
        ? String(order.get('clientName') ?? 'Клиент')
        : String(order.get('masterName') ?? 'Мастер'),
      String(message.text ?? ''),
      { href: fromClient ? '/profile' : '/messages' },
    );
  },
);

// ---------- смена статуса заявки ----------

export const onOrderStatusChanged = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status) return;

  const title = String(after.title ?? 'Заявка');
  const clientId = after.clientId as string | undefined;
  const masterId = after.masterId as string | undefined;

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

  // Клиент выбрал исполнителя
  if (after.status === 'В работе' && masterId) {
    await pushTo([masterId], 'Вас выбрали!', `${title} · ${rub(Number(after.agreedPrice ?? 0))}`, {
      href: '/profile',
    });
    return;
  }

  if (after.status === 'Ждёт подтверждения' && clientId) {
    await pushTo([clientId], 'Работа выполнена', `Подтвердите завершение: ${title}`, { href: '/' });
    return;
  }

  if (after.status === 'Завершена') {
    // Цена уходит в гистограмму: модератору нужна медиана чека, а заявок он
    // не видит. Отметка о зачёте ставится на саму заявку, поэтому повтор
    // события второй раз её не посчитает.
    await recordCompletedOrder(
      event.params.orderId,
      typeof after.agreedPrice === 'number' ? after.agreedPrice : 0,
    );
    if (masterId) {
      // Счётчик заказов в анкете — клиент видит его в профиле мастера
      await recountCompletedOrders(masterId);
      await pushTo([masterId], 'Клиент подтвердил работу', title, { href: '/profile' });
    }
    return;
  }

  if (after.status === 'Отменена' && masterId) {
    await pushTo([masterId], 'Клиент отменил заявку', title, { href: '/profile' });
  }
});

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

    const text = String(message.text ?? '');

    if (message.from === 'user') {
      const db = getFirestore();
      const admins = await db.collection('admins').get();
      if (admins.empty) {
        logger.warn('Обращение в поддержку, но модераторов нет — некому отвечать');
        return;
      }
      await pushTo(
        admins.docs.map((d) => d.id),
        'Обращение в поддержку',
        text,
        { href: '/profile' },
      );
      return;
    }

    await pushTo([event.params.uid], 'Поддержка', text, { href: '/messages' });
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
          hasCard: !!after.cardLast4,
          // Причина отказа — свободный текст мастеру, в журнале хватит факта
          rejected: status === 'rejected',
        },
      });
    }

    if (status === 'pending') {
      const admins = await db.collection('admins').get();
      if (admins.empty) {
        logger.warn('Заявка мастера подана, но модераторов нет — некому проверять');
        return;
      }
      const master = await db.doc(`masters/${masterId}`).get();
      await pushTo(
        admins.docs.map((d) => d.id),
        'Заявка мастера на проверку',
        `${master.get('name') ?? 'Без имени'} · ${
          (master.get('cities') ?? []).join(', ') || master.get('city') || 'вся республика'
        }`,
        { href: '/profile' },
      );
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

// Считается здесь и только здесь: правила запрещают писать rating и
// reviewsCount кому бы то ни было, поэтому цифре можно верить.
export const onReviewWritten = onDocumentWritten(
  'masters/{masterId}/reviews/{orderId}',
  async (event) => {
    const db = getFirestore();
    const masterId = event.params.masterId;

    const reviews = await db.collection(`masters/${masterId}/reviews`).get();
    if (reviews.empty) {
      await db.doc(`masters/${masterId}`).set({ rating: null, reviewsCount: 0 }, { merge: true });
      return;
    }

    const stars = reviews.docs
      .map((d) => Number(d.get('stars')))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
    if (!stars.length) return;

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

    const sum = stars.reduce((acc, n) => acc + n, 0);
    await db.doc(`masters/${masterId}`).set(
      {
        // Округляем до десятых: показываем всё равно «4,8»
        rating: Math.round((sum / stars.length) * 10) / 10,
        reviewsCount: stars.length,
      },
      { merge: true },
    );
  },
);
