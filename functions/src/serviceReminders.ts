import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { audit, SYSTEM } from './audit';
import { pushTo } from './push';

// Напоминания о повторяемых работах.
//
// У части бытовых услуг есть естественный цикл: газон отрастает за месяц,
// воротам раз в полгода нужна смазка. Клиент, который уже заказывал такую
// работу, — самый вероятный заказчик следующей, и напоминание в момент, когда
// потребность возникла снова, полезно обеим сторонам: клиент не ищет мастера
// заново, мастер получает заявку.
//
// Три правила, которые отделяют напоминание от спама:
//
//   сезонность    — стрижка газона в декабре не нужна; у каждой услуги свои
//                   месяцы, вне их прогон молчит;
//   ровно один раз — отметка reminderSentAt на самой заявке; повтор прогона
//                   не даёт второго пуша;
//   молчание по просьбе — remindersOff в профиле выключает всё; новая заявка
//                   того же вида тоже гасит напоминание — напоминать о том,
//                   что человек уже сделал, обиднее всего.

export type RecurringService = {
  // Объект дома и вид работы — те же значения, что пишет шторка заявки
  // (ActionSheet): по ним завершённая заявка узнаётся без разбора заголовка
  objectId: string;
  serviceLabel: string;
  // Окно напоминания в днях после завершения. Прогон ежедневный, поэтому
  // окно с запасом больше суток: пропущенный день не теряет напоминание
  minDays: number;
  maxDays: number;
  // Месяцы (1..12), когда напоминание уместно. Пусто — круглый год.
  months: number[];
  title: string;
  body: string;
};

// Интервалы — свойство услуги, а не код: следующая циклическая услуга
// добавляется строкой, без второй функции.
export const RECURRING_SERVICES: RecurringService[] = [
  {
    // Трава отрастает за 3–4 недели. Сезон — по югу России: тепло с апреля
    // по октябрь, дальше газон стоит до весны
    objectId: 'lawn',
    serviceLabel: 'Стрижка',
    minDays: 25,
    maxDays: 34,
    months: [4, 5, 6, 7, 8, 9, 10],
    title: 'Газон, похоже, снова подрос',
    body: 'После прошлой стрижки прошло около месяца — самое время подровнять.',
  },
  {
    // Обрезка — раз в год, в покое дерева: конец зимы — весна либо осень.
    // Окно ~350 дней само попадает в тот же сезон, что и прошлая обрезка;
    // месяцы отсекают случай, когда прошлая была не вовремя
    objectId: 'trees',
    serviceLabel: 'Обрезка',
    minDays: 350,
    maxDays: 364,
    months: [2, 3, 4, 10, 11],
    title: 'Деревьям снова пора обрезка',
    body: 'С прошлой обрезки прошёл почти год.',
  },
  {
    // Смазка и настройка автоматики — раз в полгода, сезона нет
    objectId: 'gate',
    serviceLabel: 'Обслуживание',
    minDays: 180,
    maxDays: 194,
    months: [],
    title: 'Воротам пора обслуживание',
    body: 'После прошлой смазки и настройки прошло полгода.',
  },
  {
    // Заточка живёт около четырёх месяцев обычного пользования
    objectId: 'tools',
    serviceLabel: 'Заточка',
    minDays: 120,
    maxDays: 134,
    months: [],
    title: 'Инструмент пора подточить',
    body: 'С прошлой заточки прошло четыре месяца.',
  },
  {
    // Котёл обслуживают раз в год перед отопительным сезоном. Окно ~350 дней
    // попадает в ту же пору, что и прошлая чистка; месяцы держат напоминание
    // в конце лета — осенью, когда до первых холодов ещё есть время
    objectId: 'boiler',
    serviceLabel: 'Обслуживание',
    minDays: 350,
    maxDays: 364,
    months: [8, 9, 10, 11],
    title: 'Котлу пора обслуживание',
    body: 'С прошлой чистки и настройки прошёл почти год — лучше успеть до холодов.',
  },
];

/** Сколько заявок берём на услугу за прогон: бюджет времени не резиновый. */
const BATCH = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

// Чечня живёт по московскому времени (UTC+3). Отдельная библиотека часовых
// поясов ради одного месяца не нужна
const monthInMoscow = (now: Date): number =>
  new Date(now.getTime() + 3 * 60 * 60 * 1000).getUTCMonth() + 1;

type Counters = {
  remindersSent: number;
  errors: number;
};

/**
 * Есть ли у клиента более поздняя заявка того же вида.
 *
 * Если человек уже позвал мастера сам, напоминание не помогает, а раздражает.
 * Отменённая заявка не считается: работа так и не сделана, напомнить уместно.
 */
async function hasNewerSameOrder(
  clientId: string,
  entry: RecurringService,
  completedAtMs: number,
): Promise<boolean> {
  const later = await getFirestore()
    .collection('orders')
    .where('clientId', '==', clientId)
    .where('createdAt', '>', Timestamp.fromMillis(completedAtMs))
    .limit(100)
    .get();

  return later.docs.some(
    (d) =>
      d.get('objectId') === entry.objectId &&
      d.get('serviceLabel') === entry.serviceLabel &&
      d.get('status') !== 'Отменена',
  );
}

/**
 * Один прогон напоминаний. Время передаётся снаружи: сезонность зависит от
 * календаря, и тесты не должны зависеть от дня, в который их запустили.
 */
export async function runServiceReminders(now: Date, runId: string): Promise<Counters> {
  const db = getFirestore();
  const month = monthInMoscow(now);
  const counters: Counters = { remindersSent: 0, errors: 0 };

  for (const entry of RECURRING_SERVICES) {
    if (entry.months.length && !entry.months.includes(month)) continue;

    let due: FirebaseFirestore.QuerySnapshot;
    try {
      due = await db
        .collection('orders')
        .where('status', '==', 'Завершена')
        .where('objectId', '==', entry.objectId)
        .where('serviceLabel', '==', entry.serviceLabel)
        .where('completedAt', '>=', Timestamp.fromMillis(now.getTime() - entry.maxDays * DAY_MS))
        .where('completedAt', '<=', Timestamp.fromMillis(now.getTime() - entry.minDays * DAY_MS))
        .limit(BATCH)
        .get();
    } catch (e) {
      counters.errors += 1;
      logger.error('Выборка завершённых заявок не удалась', { entry: entry.objectId, e });
      continue;
    }

    for (const d of due.docs) {
      try {
        // В запрос отметку не включить: у нетронутых заявок поля нет вовсе,
        // а по отсутствию поля Firestore не фильтрует
        if (d.get('reminderSentAt')) continue;

        const clientId = d.get('clientId');
        if (typeof clientId !== 'string' || !clientId) continue;

        // Профиль удалён — напоминать некому; remindersOff — человек попросил
        // тишины, и это его право, а не наша настройка
        const user = await db.doc(`users/${clientId}`).get();
        if (!user.exists || user.get('remindersOff') === true) continue;

        const completedAtMs: number = d.get('completedAt')?.toMillis?.() ?? 0;
        if (await hasNewerSameOrder(clientId, entry, completedAtMs)) continue;

        // Отметка до отправки и транзакцией: наложившийся прогон не пошлёт
        // то же напоминание второй раз. Потерять одно напоминание дешевле,
        // чем прослыть спамером
        const first = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(d.ref);
          if (!fresh.exists || fresh.get('reminderSentAt')) return false;
          tx.update(d.ref, { reminderSentAt: FieldValue.serverTimestamp() });
          return true;
        });
        if (!first) continue;

        await pushTo([clientId], entry.title, entry.body, { href: '/' });

        await audit({
          action: 'order.reminder_sent',
          actor: SYSTEM,
          subject: { type: 'order', id: d.id },
          correlationId: runId,
          details: {
            objectId: entry.objectId,
            serviceLabel: entry.serviceLabel,
            daysSince: Math.round((now.getTime() - completedAtMs) / DAY_MS),
          },
        });
        counters.remindersSent += 1;
      } catch (e) {
        counters.errors += 1;
        logger.warn('Напоминание не удалось', { orderId: d.id, e });
      }
    }
  }

  return counters;
}

// Раз в день в десять утра: напоминание в три ночи будит, а не помогает.
// Блокировки, как у сверки, нет: суточные прогоны не накладываются, а от
// теоретического повтора защищает транзакция с отметкой на заявке.
export const serviceReminders = onSchedule(
  {
    schedule: 'every day 10:00',
    timeZone: 'Europe/Moscow',
    timeoutSeconds: 540,
    // Повторять прогон незачем: завтрашний подберёт то же окно
    retryCount: 0,
  },
  async () => {
    const runId = `reminders-${Date.now()}`;
    const counters = await runServiceReminders(new Date(), runId);

    await audit({
      action: 'reminders.finished',
      actor: SYSTEM,
      subject: { type: 'system', id: 'serviceReminders' },
      correlationId: runId,
      details: { ...counters },
    });

    logger.info('Напоминания разосланы', counters);
  },
);
