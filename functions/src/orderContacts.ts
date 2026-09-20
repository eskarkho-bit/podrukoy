import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { audit, SYSTEM } from './audit';
import { loadPaymentTerms } from './orderPayment';

// Телефоны сторон в заявке.
//
// До выбора мастера открытую заявку читают все проверенные мастера города —
// номер клиента там видел бы каждый. Поэтому телефоны появляются в заявке
// только после выбора исполнителя, когда читателей остаётся двое, и пишет их
// только сервер: клиент номера мастера не знает вовсе, а правила запрещают
// обеим сторонам трогать эти поля. Звонок — главный канал сделки на этом
// рынке: без кнопки «Позвонить» стороны просто обменялись бы номерами первым
// сообщением чата.
//
// Тем же путём в заявку попадает, как мастер принимает оплату: банки для
// перевода по СБП и наличные. Сам перевод идёт на тот же телефон, поэтому
// отдельных реквизитов у заявки нет.

/** Приводит номер к виду для звонилки: +7XXXXXXXXXX либо null. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith('9')) return `+7${digits}`;
  return null;
}

/**
 * Кладёт телефоны обеих сторон в заявку с выбранным мастером.
 *
 * Повторная доставка события перезапишет те же значения — вреда нет.
 * Запись идёт транзакцией с проверкой, что мастер всё ещё тот: если он успел
 * удалить аккаунт и заявка вернулась в поиск, номера в открытую заявку не
 * попадут — иначе их прочитали бы все мастера города.
 */
export async function shareOrderContacts(orderId: string, correlationId: string): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`orders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) return;

  const masterId = snap.get('masterId');
  const clientId = snap.get('clientId');
  if (typeof masterId !== 'string' || !masterId) return;

  // Номер мастера — из заявки на проверку: анкету читает любой авторизованный,
  // а телефон лежит в подколлекции, закрытой ото всех, кроме него и модератора
  const application = await db.doc(`masters/${masterId}/verification/application`).get();
  const masterPhone = normalizePhone(application.get('phone'));

  // Как мастер принимает оплату — снимок на момент выбора. Мастер может
  // поменять банки позже, но клиент видел именно это; для спора важен снимок
  const terms = await loadPaymentTerms(masterId);

  // Номер клиента живёт в Auth: при входе по телефону он и есть логин.
  // У почтового аккаунта номера может не быть — тогда мастеру кнопки
  // звонка просто не покажут.
  let clientPhone: string | null = null;
  if (typeof clientId === 'string' && clientId) {
    try {
      clientPhone = normalizePhone((await getAuth().getUser(clientId)).phoneNumber);
    } catch {
      // Аккаунт мог исчезнуть, пока событие ехало, — тогда и звонить некому
      clientPhone = null;
    }
  }

  if (masterPhone == null && clientPhone == null && terms == null) return;

  const written = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    // Пока событие ехало, клиент мог отменить заявку: в отменённую номера
    // не кладём — ветка «Отменена» их уже стёрла, и второй раз не придёт
    if (!fresh.exists || fresh.get('masterId') !== masterId) return false;
    if (fresh.get('status') !== 'В работе') return false;
    tx.set(
      ref,
      {
        masterPhone,
        clientPhone,
        masterBanks: terms?.banks ?? null,
        masterAcceptsCash: terms?.acceptsCash ?? null,
      },
      { merge: true },
    );
    return true;
  });
  if (!written) return;

  // В журнале — только факты наличия: сами номера туда не кладут
  await audit({
    action: 'order.contacts_shared',
    actor: SYSTEM,
    subject: { type: 'order', id: orderId },
    correlationId,
    details: {
      hasMasterPhone: masterPhone != null,
      hasClientPhone: clientPhone != null,
      hasPaymentTerms: terms != null,
    },
  });
}
