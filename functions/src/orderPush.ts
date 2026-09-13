import { logger } from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import { pushTo } from './push';
import { meterExceeded } from './meters';

// Кому рассказывать о заявке. Один код на два пути: триггер создания и
// повторный зов из сверки. Две выборки «подходящих мастеров» неминуемо
// разошлись бы — и о повторе узнавали бы не те, кто слышал о заявке впервые.

// Пока мастеров сотни, выборка делается в памяти: у Firestore нет запроса
// «город совпал ИЛИ город не указан». Когда мастеров станет тысячи, это
// место надо будет переделать на запрос с индексом.
export const MASTERS_SCAN_LIMIT = 1000;

// Сколько заявок одного клиента за час рассылаются мастерам. Заявка сверх
// этого создаётся и видна в ленте, но пуш всем мастерам города по ней не
// уходит: иначе один аккаунт мог бы будить всех мастеров каждую минуту.
export const ORDER_BURST_LIMIT = 5;
const ORDER_BURST_WINDOW_MS = 60 * 60_000;

/** true — клиент за последний час уже разослал больше заявок, чем положено. */
export function orderBurstExceeded(clientId: string): Promise<boolean> {
  return meterExceeded(`orderBurst-${clientId}`, ORDER_BURST_LIMIT, ORDER_BURST_WINDOW_MS);
}

/**
 * Шлёт пуш о заявке всем подходящим проверенным мастерам.
 * Возвращает, скольким мастерам ушло уведомление.
 *
 * excludeUid — мастер, которому уже ушёл именной пуш (повторная заявка зовёт
 * прошлого исполнителя лично): второй, общий, был бы дублем.
 */
export async function notifyMastersAbout(
  order: FirebaseFirestore.DocumentData,
  title: string,
  options?: { excludeUid?: string },
): Promise<number> {
  const db = getFirestore();
  // Только проверенные и только нужные поля: непроверенный мастер заявку всё
  // равно не откроет — правила не дадут, — а анкета целиком (имя, стаж,
  // рейтинг) рассылке не нужна, и тянуть её по всем мастерам на каждую
  // заявку значит платить за чтение того, что не читается
  const snap = await db
    .collection('masters')
    .where('verified', '==', true)
    .select('blocked', 'cities', 'city', 'skills')
    .limit(MASTERS_SCAN_LIMIT)
    .get();
  if (snap.size === MASTERS_SCAN_LIMIT) {
    logger.warn('Мастеров больше лимита выборки — часть не получит уведомление');
  }

  const city = String(order.city ?? '');
  const category = String(order.category ?? '');

  // Кого клиент заблокировал: такому мастеру правила не дадут прислать
  // предложение, и звать его к заявке значило бы звать в закрытую дверь
  const blocked = new Set<string>();
  const clientId = typeof order.clientId === 'string' ? order.clientId : null;
  if (clientId) {
    const list = (await db.doc(`users/${clientId}`).get()).get('blockedMasters');
    if (Array.isArray(list)) list.forEach((id) => blocked.add(String(id)));
  }

  const uids = snap.docs
    .filter((d) => {
      // Отстранённого правила к предложению не пустят — как и того, кого
      // заблокировал этот клиент. Звать их значит звать в закрытую дверь.
      if (d.get('blocked') === true) return false;
      if (blocked.has(d.id)) return false;
      // Клиент не должен получать уведомление о собственной заявке, даже
      // если он же зарегистрирован мастером
      if (d.id === order.clientId) return false;
      if (options?.excludeUid && d.id === options.excludeUid) return false;
      // Мастер отмечает несколько населённых пунктов; у анкет, заведённых до
      // множественного выбора, остаётся прежнее поле city строкой
      const cities: string[] = Array.isArray(d.get('cities'))
        ? d.get('cities')
        : d.get('city')
          ? [String(d.get('city'))]
          : [];
      const skills: string[] = Array.isArray(d.get('skills')) ? d.get('skills') : [];
      // Пустой список значит «без ограничения» — так же, как в ленте. Заявка
      // без города видна в ленте только таким мастерам, и звать по ней
      // остальных значило бы звать к заявке, которой они не найдут
      const cityOk = !cities.length || cities.includes(city);
      const skillOk = !skills.length || !category || skills.includes(category);
      return cityOk && skillOk;
    })
    .map((d) => d.id);

  if (!uids.length) return 0;

  await pushTo(uids, title, String(order.title ?? 'Заявка'), { href: '/profile' });
  return uids.length;
}
