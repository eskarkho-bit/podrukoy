import { logger } from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import { pushTo } from './push';

// Кому рассказывать о заявке. Один код на два пути: триггер создания и
// повторный зов из сверки. Две выборки «подходящих мастеров» неминуемо
// разошлись бы — и о повторе узнавали бы не те, кто слышал о заявке впервые.

// Пока мастеров сотни, выборка делается в памяти: у Firestore нет запроса
// «город совпал ИЛИ город не указан». Когда мастеров станет тысячи, это
// место надо будет переделать на запрос с индексом.
export const MASTERS_SCAN_LIMIT = 1000;

/**
 * Шлёт пуш о заявке всем подходящим проверенным мастерам.
 * Возвращает, скольким мастерам ушло уведомление.
 */
export async function notifyMastersAbout(
  order: FirebaseFirestore.DocumentData,
  title: string,
): Promise<number> {
  const db = getFirestore();
  const snap = await db.collection('masters').limit(MASTERS_SCAN_LIMIT).get();
  if (snap.size === MASTERS_SCAN_LIMIT) {
    logger.warn('Мастеров больше лимита выборки — часть не получит уведомление');
  }

  const city = String(order.city ?? '');
  const category = String(order.category ?? '');

  const uids = snap.docs
    .filter((d) => {
      // Непроверенный мастер заявку всё равно не откроет — правила не дадут.
      // Слать ему уведомление значит звать туда, куда не пустят.
      if (d.get('verified') !== true) return false;
      // Клиент не должен получать уведомление о собственной заявке, даже
      // если он же зарегистрирован мастером
      if (d.id === order.clientId) return false;
      // Мастер отмечает несколько населённых пунктов; у анкет, заведённых до
      // множественного выбора, остаётся прежнее поле city строкой
      const cities: string[] = Array.isArray(d.get('cities'))
        ? d.get('cities')
        : d.get('city')
          ? [String(d.get('city'))]
          : [];
      const skills: string[] = Array.isArray(d.get('skills')) ? d.get('skills') : [];
      // Пустой список значит «без ограничения» — так же, как в ленте
      const cityOk = !cities.length || !city || cities.includes(city);
      const skillOk = !skills.length || !category || skills.includes(category);
      return cityOk && skillOk;
    })
    .map((d) => d.id);

  if (!uids.length) return 0;

  await pushTo(uids, title, String(order.title ?? 'Заявка'), { href: '/profile' });
  return uids.length;
}
