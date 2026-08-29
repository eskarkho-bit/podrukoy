import { randomUUID, createHash } from 'node:crypto';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { audit } from './audit';
import { pushTo } from './push';
import { dropPendingOffers } from './masterExit';
import { recomputeRating } from './masterStats';
import { normalizePhone } from './orderContacts';

// Действия модератора: блокировки, скрытие отзывов, принудительное закрытие
// заявок, вердикты по жалобам, поиск по телефону.
//
// Всё это — только через сервер. Правила Firestore нарочно не дают модератору
// таких записей с клиента: у каждого действия есть побочные шаги (снять
// предложения, пересчитать рейтинг, уведомить стороны), и журнал обязан
// фиксировать каждое решение. Admin SDK правила обходит, поэтому право
// модератора проверяется здесь руками — по документу admins/{uid}, тому же,
// на который смотрят и правила.
//
// Каждое действие идемпотентно: повтор вызова приходит к тому же состоянию
// и не делает второго побочного шага там, где он опасен.

/** Пускает дальше только модератора. */
export async function requireAdmin(request: CallableRequest<unknown>): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Нужен вход');
  const admin = await getFirestore().doc(`admins/${uid}`).get();
  if (!admin.exists) throw new HttpsError('permission-denied', 'Требуются права модератора');
  return uid;
}

/** Причина обязательна: решение без причины не объяснить ни стороне, ни себе. */
function requiredReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (!reason) throw new HttpsError('invalid-argument', 'Укажите причину');
  if (reason.length > 500) throw new HttpsError('invalid-argument', 'Причина длиннее 500 символов');
  return reason;
}

function requiredId(raw: unknown, message: string): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new HttpsError('invalid-argument', message);
  return raw.trim();
}

// ---------- принудительное закрытие заявки ----------

/**
 * Закрывает заявку решением модератора: «Отменена» для споров и зависших,
 * «Завершена» — когда работа сделана, а клиент пропал и не подтверждает.
 *
 * Пуши сторонам не отсюда: смену статуса видит onOrderStatusChanged и по
 * closedByAdmin подбирает честные тексты — иначе клиенту ушло бы
 * «Клиент отменил заявку» о нём самом.
 */
export async function closeOrder(
  adminUid: string,
  orderId: string,
  outcome: 'Отменена' | 'Завершена',
  reason: string,
  correlationId: string,
): Promise<{ already: boolean }> {
  const db = getFirestore();
  const ref = db.doc(`orders/${orderId}`);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Заявка не найдена');
    const from = String(snap.get('status') ?? '');
    // Закрытую заявку не трогаем: повтор вызова не должен переписать ни
    // исход, ни причину, ни completedAt
    if (from === 'Завершена' || from === 'Отменена') return { already: true, from };
    tx.set(
      ref,
      {
        status: outcome,
        closedByAdmin: true,
        adminCloseReason: reason,
        // Без даты завершения заказ не попал бы в доход мастера по месяцам
        ...(outcome === 'Завершена' ? { completedAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true },
    );
    return { already: false, from };
  });

  if (!result.already) {
    await audit({
      action: outcome === 'Завершена' ? 'order.force_closed' : 'order.force_cancelled',
      actor: { type: 'admin', uid: adminUid },
      subject: { type: 'order', id: orderId },
      correlationId,
      // Причина — сторонам сделки, в заявке; журналу хватает факта
      details: { from: result.from, to: outcome },
    });
  }
  return { already: result.already };
}

export const adminCloseOrder = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const orderId = requiredId(data.orderId, 'Не указана заявка');
  const outcome = data.outcome;
  if (outcome !== 'Отменена' && outcome !== 'Завершена') {
    throw new HttpsError('invalid-argument', 'Исход — «Отменена» либо «Завершена»');
  }
  return closeOrder(adminUid, orderId, outcome, requiredReason(data.reason), randomUUID());
});

// ---------- блокировка клиента ----------

/**
 * Ставит или снимает блокировку клиента. Заблокированный не создаёт новых
 * заявок (это держат правила), старые остаются как были.
 *
 * Причина лежит в самом профиле: его читают только владелец и модератор,
 * и заблокированный имеет право знать, за что.
 */
export async function setUserBlocked(
  adminUid: string,
  uid: string,
  blocked: boolean,
  reason: string,
  correlationId: string,
): Promise<void> {
  const db = getFirestore();
  if (uid === adminUid) throw new HttpsError('failed-precondition', 'Нельзя заблокировать себя');
  if ((await db.doc(`admins/${uid}`).get()).exists) {
    throw new HttpsError('failed-precondition', 'Модератора нельзя заблокировать');
  }
  const profile = await db.doc(`users/${uid}`).get();
  if (!profile.exists) throw new HttpsError('not-found', 'Пользователь не найден');

  await profile.ref.set({ blocked, blockedReason: blocked ? reason : null }, { merge: true });

  await audit({
    action: blocked ? 'user.blocked' : 'user.unblocked',
    actor: { type: 'admin', uid: adminUid },
    subject: { type: 'user', id: uid },
    correlationId,
  });

  await pushTo(
    [uid],
    blocked ? 'Создание заявок ограничено' : 'Ограничение снято',
    blocked ? reason : 'Вы снова можете создавать заявки',
    { href: '/' },
  );
}

export const adminSetUserBlocked = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = requiredId(data.uid, 'Не указан пользователь');
  const blocked = data.blocked === true;
  const reason = blocked ? requiredReason(data.reason) : '';
  await setUserBlocked(adminUid, uid, blocked, reason, randomUUID());
  return { ok: true };
});

// ---------- блокировка мастера ----------

/**
 * Отстраняет мастера: флаг в анкете закрывает ленту и предложения (это
 * держат правила), неотвеченные предложения снимаются — браться за новое
 * он больше не вправе. Уже идущая работа остаётся, как при снятии допуска.
 *
 * Причина — в приватной заявке на проверку, а не в мировой анкете: анкету
 * читает любой авторизованный, и свободному тексту модератора там не место.
 */
export async function setMasterBlocked(
  adminUid: string,
  uid: string,
  blocked: boolean,
  reason: string,
  correlationId: string,
): Promise<{ offersDropped: number }> {
  const db = getFirestore();
  if (uid === adminUid) throw new HttpsError('failed-precondition', 'Нельзя заблокировать себя');
  if ((await db.doc(`admins/${uid}`).get()).exists) {
    throw new HttpsError('failed-precondition', 'Модератора нельзя заблокировать');
  }
  const master = await db.doc(`masters/${uid}`).get();
  if (!master.exists) throw new HttpsError('not-found', 'Анкета мастера не найдена');

  await master.ref.set({ blocked }, { merge: true });
  await db
    .doc(`masters/${uid}/verification/application`)
    .set({ blockedReason: blocked ? reason : null }, { merge: true });

  // Повтор вызова находит пустой список — второго снятия не бывает
  const offersDropped = blocked ? await dropPendingOffers(uid) : 0;

  await audit({
    action: blocked ? 'master.blocked' : 'master.unblocked',
    actor: { type: 'admin', uid: adminUid },
    subject: { type: 'master', id: uid },
    correlationId,
    details: { offersDropped },
  });

  await pushTo(
    [uid],
    blocked ? 'Доступ к заявкам приостановлен' : 'Доступ к заявкам восстановлен',
    blocked ? reason : 'Лента заявок снова открыта',
    { href: '/profile' },
  );
  return { offersDropped };
}

export const adminSetMasterBlocked = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = requiredId(data.uid, 'Не указан мастер');
  const blocked = data.blocked === true;
  const reason = blocked ? requiredReason(data.reason) : '';
  return setMasterBlocked(adminUid, uid, blocked, reason, randomUUID());
});

// ---------- скрытие отзыва ----------

/**
 * Скрывает отзыв с витрины и исключает его из рейтинга — или возвращает.
 *
 * Причина скрытия в базе не хранится нигде: отзыв читают все авторизованные,
 * жалобу — только модератор и автор, а мастеру причина уходит текстом пуша.
 */
export async function setReviewHidden(
  adminUid: string,
  masterId: string,
  orderId: string,
  hidden: boolean,
  reason: string,
  correlationId: string,
): Promise<{ rating: number | null; reviewsCount: number } | null> {
  const db = getFirestore();
  const ref = db.doc(`masters/${masterId}/reviews/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Отзыв не найден');

  await ref.set(
    hidden
      ? { hidden: true, hiddenAt: FieldValue.serverTimestamp(), hiddenBy: adminUid }
      : { hidden: false, hiddenAt: null, hiddenBy: null },
    { merge: true },
  );

  // Пересчёт сразу, не дожидаясь триггера: модератор должен увидеть новую
  // цифру в ту же секунду. Триггер onReviewWritten пересчитает следом ещё
  // раз — полному пересчёту повтор безразличен.
  const recount = await recomputeRating(masterId);

  await audit({
    action: hidden ? 'review.hidden' : 'review.unhidden',
    actor: { type: 'admin', uid: adminUid },
    subject: { type: 'master', id: masterId },
    correlationId,
    details: { orderId },
  });

  await pushTo(
    [masterId],
    hidden ? 'Отзыв скрыт после проверки' : 'Отзыв возвращён в анкету',
    hidden ? reason : 'Отзыв снова виден клиентам',
    { href: '/profile' },
  );
  return recount;
}

export const adminSetReviewHidden = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const masterId = requiredId(data.masterId, 'Не указан мастер');
  const orderId = requiredId(data.orderId, 'Не указан отзыв');
  const hidden = data.hidden === true;
  const reason = hidden ? requiredReason(data.reason) : '';
  return setReviewHidden(adminUid, masterId, orderId, hidden, reason, randomUUID());
});

// ---------- вердикт по жалобе ----------

/**
 * Закрывает жалобу: «решена» или «отклонена». Скрытие самого отзыва — не
 * здесь, а отдельным вызовом setReviewHidden: путь скрытия один, и в
 * журнале он один.
 */
export async function resolveComplaint(
  adminUid: string,
  complaintId: string,
  outcome: 'решена' | 'отклонена',
  note: string | null,
  correlationId: string,
): Promise<{ already: boolean }> {
  const db = getFirestore();
  const ref = db.doc(`complaints/${complaintId}`);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Жалоба не найдена');
    // Решённую не перерешиваем: повтор вызова не меняет ни вердикт, ни даты
    if (snap.get('status') !== 'новая') return { already: true, byUid: null };
    tx.set(
      ref,
      {
        status: outcome,
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedBy: adminUid,
        resolutionNote: note,
      },
      { merge: true },
    );
    return {
      already: false,
      byUid: String(snap.get('byUid') ?? ''),
      masterId: String(snap.get('masterId') ?? ''),
      orderId: String(snap.get('orderId') ?? ''),
    };
  });

  if (result.already) return { already: true };

  await audit({
    action: 'complaint.resolved',
    actor: { type: 'admin', uid: adminUid },
    subject: { type: 'complaint', id: complaintId },
    correlationId,
    details: { outcome, masterId: result.masterId ?? '', orderId: result.orderId ?? '' },
  });

  if (result.byUid) {
    await pushTo(
      [result.byUid],
      outcome === 'решена' ? 'Жалоба решена' : 'Жалоба отклонена',
      note || (outcome === 'решена' ? 'Отзыв скрыт после проверки' : 'Отзыв остаётся в анкете'),
      { href: '/profile' },
    );
  }
  return { already: false };
}

export const adminResolveComplaint = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const complaintId = requiredId(data.complaintId, 'Не указана жалоба');
  const outcome = data.outcome;
  if (outcome !== 'решена' && outcome !== 'отклонена') {
    throw new HttpsError('invalid-argument', 'Исход — «решена» либо «отклонена»');
  }
  const note =
    typeof data.note === 'string' && data.note.trim() ? data.note.trim().slice(0, 500) : null;
  return resolveComplaint(adminUid, complaintId, outcome, note, randomUUID());
});

// ---------- поиск по телефону ----------

export type FoundUser = {
  uid: string;
  name: string | null;
  isMaster: boolean;
  verified: boolean;
  userBlocked: boolean;
  masterBlocked: boolean;
};

/**
 * Ищет человека по номеру: аккаунт в Auth, поле профиля и телефон из анкеты
 * мастера — канонический, в анкете он хранится одиннадцатью цифрами.
 *
 * В журнале — только хэш номера (тот же приём, что у входа по СМС): сам
 * номер в журнале пережил бы удаление аккаунта.
 */
export async function findUserByPhone(
  adminUid: string,
  phoneRaw: unknown,
  correlationId: string,
): Promise<FoundUser[]> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new HttpsError('invalid-argument', 'Введите номер из 11 цифр');
  const digits = phone.slice(1); // '7XXXXXXXXXX' — формат анкеты

  const db = getFirestore();
  const uids = new Set<string>();

  try {
    const account = await getAuth().getUserByPhoneNumber(phone);
    uids.add(account.uid);
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
  }

  const profiles = await db.collection('users').where('phone', '==', phone).limit(10).get();
  profiles.docs.forEach((d) => uids.add(d.id));

  const applications = await db
    .collectionGroup('verification')
    .where('phone', '==', digits)
    .limit(10)
    .get();
  applications.docs.forEach((d) => {
    const uid = d.ref.parent.parent?.id;
    if (uid) uids.add(uid);
  });

  const found: FoundUser[] = [];
  for (const uid of uids) {
    const [profile, master] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.doc(`masters/${uid}`).get(),
    ]);
    found.push({
      uid,
      name: (profile.get('name') ?? master.get('name') ?? null) as string | null,
      isMaster: master.exists,
      verified: master.get('verified') === true,
      userBlocked: profile.get('blocked') === true,
      masterBlocked: master.get('blocked') === true,
    });
  }

  await audit({
    action: 'admin.user_lookup',
    actor: { type: 'admin', uid: adminUid },
    subject: { type: 'system', id: 'search' },
    correlationId,
    details: {
      phoneHash: createHash('sha256').update(`phone:${phone}`).digest('hex').slice(0, 32),
      found: found.length,
    },
  });
  return found;
}

export const adminFindUserByPhone = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  return { found: await findUserByPhone(adminUid, data.phone, randomUUID()) };
});
