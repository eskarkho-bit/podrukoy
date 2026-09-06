import { logger } from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import { audit, SYSTEM } from './audit';
import { pushTo } from './push';

// Расчёт между сторонами.
//
// Деньги идут мимо сервиса: наличными при встрече или переводом по СБП на
// телефон мастера. Сервер здесь делает две вещи. Во-первых, вместе с
// телефоном кладёт в выбранную заявку, как мастер принимает оплату, — банки
// и наличные лежат в закрытой подколлекции, и клиенту их иначе не прочитать.
// Во-вторых, замечает отметки «оплатил» и «получил», которые стороны ставят
// сами, и переводит их в пуш второй стороне и след в журнале — без
// телефонов и сумм, только способ.

// Тот же перечень, что в components/banks.ts и в правилах (validBanks).
// Правила уже отсекли чужое при записи; здесь фильтр на случай, если
// документ правили в консоли.
const BANK_IDS = new Set([
  'sber',
  'tbank',
  'vtb',
  'alfa',
  'akbars',
  'gazprom',
  'raiffeisen',
  'sovcom',
  'ozon',
  'yandex',
  'psb',
  'mts',
  'pochta',
  'rshb',
  'otp',
  'uralsib',
]);

export type PaymentTerms = { banks: string[]; acceptsCash: boolean };

/** Условия из masters/{uid}/payment/details; null — мастер их не задавал. */
export function paymentTermsOf(data: Record<string, unknown> | undefined): PaymentTerms | null {
  if (!data) return null;
  const raw = Array.isArray(data.banks) ? data.banks : [];
  return {
    banks: raw.filter((b): b is string => typeof b === 'string' && BANK_IDS.has(b)),
    acceptsCash: data.acceptsCash !== false,
  };
}

/** Читает условия мастера. Отсутствие документа — штатный случай. */
export async function loadPaymentTerms(masterId: string): Promise<PaymentTerms | null> {
  const snap = await getFirestore().doc(`masters/${masterId}/payment/details`).get();
  return paymentTermsOf(snap.data());
}

const METHOD_LABEL: Record<string, string> = { cash: 'наличными', transfer: 'переводом' };

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

/**
 * Отметки о расчёте в обновлении заявки.
 *
 * Зовётся на каждое обновление документа, статус при этом может и не
 * меняться. Обе отметки ставятся один раз (правила не дают ни снять, ни
 * переставить), поэтому «появилось поле» — это и есть событие. Повтор
 * доставки увидит одинаковые before и after и ничего не сделает.
 */
export async function notePaymentMarks(
  orderId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  correlationId: string,
): Promise<void> {
  const method = typeof after.paymentMethod === 'string' ? after.paymentMethod : null;
  const title = String(after.title ?? 'Заявка');
  const price = typeof after.agreedPrice === 'number' ? after.agreedPrice : null;
  const clientId = typeof after.clientId === 'string' ? after.clientId : null;
  const masterId = typeof after.masterId === 'string' ? after.masterId : null;

  if (before.paidAt == null && after.paidAt != null) {
    await audit({
      action: 'order.paid_marked',
      actor: clientId ? { type: 'user', uid: clientId } : SYSTEM,
      subject: { type: 'order', id: orderId },
      correlationId,
      details: { method, masterId },
    });
    if (masterId) {
      const how = method && METHOD_LABEL[method] ? ` ${METHOD_LABEL[method]}` : '';
      await pushTo(
        [masterId],
        'Клиент отметил оплату',
        `${title}${price != null ? ` · ${rub(price)}` : ''}${how}`,
        { href: '/profile' },
      );
    }
    logger.info('Клиент отметил оплату', { orderId, method });
  }

  if (before.paymentReceivedAt == null && after.paymentReceivedAt != null) {
    await audit({
      action: 'order.payment_received',
      actor: masterId ? { type: 'user', uid: masterId } : SYSTEM,
      subject: { type: 'order', id: orderId },
      correlationId,
      details: { method, masterId },
    });
    if (clientId) {
      await pushTo([clientId], 'Мастер подтвердил оплату', title, { href: '/' });
    }
    logger.info('Мастер подтвердил получение оплаты', { orderId, method });
  }
}
