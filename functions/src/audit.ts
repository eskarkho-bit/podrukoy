import { logger } from 'firebase-functions';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// Журнал действий.
//
// Нужен ровно для двух вопросов, на которые иначе ответить нечем: «кто это
// сделал» и «почему у нас такое состояние». Особенно для фоновых операций —
// сверки, возвратов, удаления аккаунта, — где никто не смотрит на экран в
// момент выполнения.
//
// Три свойства, которые делают журнал журналом:
//
//   append-only  — правила запрещают запись всем, включая модераторов;
//                  пишет только Admin SDK, править и удалять нельзя никому;
//   без ПД       — только идентификаторы и перечисления. Журнал переживает
//                  удаление аккаунта, и складывать в него имя или адрес
//                  значило бы обойти собственное же удаление данных;
//   корреляция   — correlationId связывает цепочку: одно событие триггера или
//                  один прогон сверки видно целиком.

export type AuditAction =
  // заявки
  | 'order.created'
  | 'order.master_selected'
  | 'order.finished'
  | 'order.confirmed'
  | 'order.cancelled'
  | 'order.reopened'
  | 'order.anonymized'
  // мастера
  | 'master.applied'
  | 'master.approved'
  | 'master.rejected'
  | 'master.deleted'
  | 'master.unverified'
  | 'master.offers_dropped'
  // отзывы
  | 'review.created'
  // привязка карты
  | 'binding.started'
  | 'binding.settled'
  | 'binding.refunded'
  | 'binding.refund_failed'
  | 'binding.canceled'
  | 'binding.failed'
  // аккаунт
  | 'account.deletion_requested'
  | 'account.deletion_stage'
  | 'account.deleted'
  // фоновые прогоны
  | 'reconcile.started'
  | 'reconcile.finished'
  | 'reconcile.skipped';

export type AuditActor =
  /** Действие инициировал человек из приложения */
  | { type: 'user'; uid: string }
  /** Модератор — отдельно от обычного пользователя: полномочия другие */
  | { type: 'admin'; uid: string }
  /** Триггер, расписание, вебхук — за этим человека нет */
  | { type: 'system'; uid: null };

export type AuditSubject = {
  type: 'order' | 'master' | 'user' | 'payment' | 'system';
  id: string;
};

/** Только идентификаторы, числа и перечисления. Никаких имён и адресов. */
export type AuditDetails = Record<string, string | number | boolean | null>;

// Записи не хранятся вечно: год с запасом покрывает и разбор спора, и
// проверку.
//
// Поле expiresAt проставляется всегда, но само удаление делает Firestore по
// TTL-политике, а она требует включённого биллинга. Пока его нет, политику не
// выкатить (деплой падает с 403), и записи копятся. Как подключите Blaze —
// вернуть в firestore.indexes.json:
//
//   { "collectionGroup": "audit", "fieldPath": "expiresAt",
//     "ttl": true, "indexes": [] }
//
// До тех пор поле лежит без дела и ничего не ломает.
const RETENTION_DAYS = 400;

// Даже идентификаторы бывают длинными, а причина отказа модератора —
// свободный текст, которому в журнале не место
const MAX_VALUE_LENGTH = 200;

const LOOKS_LIKE_PII = [
  /[\w.+-]+@[\w-]+\.[\w.]+/, // email
  /(?:\+?\d[ ()-]?){10,}/, // телефон
];

/**
 * Вычищает из деталей то, что похоже на персональные данные.
 *
 * Это не замена дисциплине — вызывающий обязан класть сюда только идентификаторы,
 * — а последний рубеж на случай, если кто-то однажды передаст сюда `clientName`.
 */
function sanitize(details: AuditDetails): AuditDetails {
  const out: AuditDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value !== 'string') {
      out[key] = value;
      continue;
    }
    if (LOOKS_LIKE_PII.some((re) => re.test(value))) {
      out[key] = '[вырезано]';
      continue;
    }
    out[key] = value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
  }
  return out;
}

/**
 * Пишет запись в журнал.
 *
 * Никогда не бросает: сбой журналирования не должен ронять то действие,
 * которое журналируется. Потеря записи — плохо, потеря заявки — хуже.
 */
export async function audit(entry: {
  action: AuditAction;
  actor: AuditActor;
  subject: AuditSubject;
  correlationId: string;
  details?: AuditDetails;
}): Promise<void> {
  try {
    const expires = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await getFirestore()
      .collection('audit')
      .add({
        action: entry.action,
        actorType: entry.actor.type,
        actorUid: entry.actor.uid,
        subjectType: entry.subject.type,
        subjectId: entry.subject.id,
        correlationId: entry.correlationId,
        details: sanitize(entry.details ?? {}),
        at: FieldValue.serverTimestamp(),
        expiresAt: expires,
      });
  } catch (e) {
    logger.error('Не удалось записать в журнал', { action: entry.action, e });
  }
}

/** Системный источник — для триггеров и расписания. */
export const SYSTEM: AuditActor = { type: 'system', uid: null };
