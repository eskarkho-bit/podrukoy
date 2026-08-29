import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { audit, SYSTEM } from './audit';

// Дашборд модератора: ключевые числа маркетплейса одним документом.
//
// Считает сервер по расписанию и пишет в stats/dashboard — модератор читает
// готовые цифры, не выкачивая заявки на телефон (правило чтения stats/* уже
// админское). Живой подписки на агрегаты у Firestore нет, поэтому пересчёт
// раз в сутки — для оператора одного города этого достаточно.
//
// Идемпотентность по построению: полный пересчёт одного документа. Наложение
// двух прогонов даёт одинаковый результат, поэтому замок, как у сверки, не
// нужен — здесь нечего сделать дважды.
//
// Определения метрик:
//   дни и недели   — созданные по createdAt, завершённые по completedAt;
//                    сутки и недели считаются по московскому времени;
//   конверсия      — доля заявок с agreedAt (момент выбора мастера) среди
//                    созданных за 30 дней и старше 48 часов: свежим рано
//                    записываться в провал. masterId не годится — его
//                    снимает уход мастера;
//   активные       — verified и не blocked, двумя count()-агрегатами;
//   первый отклик  — среднее firstOfferAt − createdAt за 7 дней; отдельно
//                    счётчик заявок вовсе без предложений — это сигнал
//                    хуже медленного.

export type DashboardDay = { date: string; created: number; completed: number };
export type DashboardWeek = { start: string; created: number; completed: number };

export type DashboardDoc = {
  days: DashboardDay[]; // последние 30 дней, свежие в конце
  weeks: DashboardWeek[]; // последние 12 недель по понедельникам
  conversion30d: { total: number; picked: number };
  activeMasters: number;
  timeToFirstOffer7d: {
    avgMinutes: number | null;
    withOffers: number;
    withoutOffers: number;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 30;
const WEEKS = 12;
const CONVERSION_AGE_MS = 48 * 60 * 60 * 1000;
const OFFER_WINDOW_MS = 7 * DAY_MS;
const PAGE = 300;

// Москва — UTC+3 без переходов; тот же приём, что в serviceReminders
const MSK_MS = 3 * 60 * 60 * 1000;

/** Календарная дата в Москве: '2026-08-29'. */
const mskDay = (d: Date) => new Date(d.getTime() + MSK_MS).toISOString().slice(0, 10);

/** Понедельник московской недели той же датой. */
const mskWeekStart = (d: Date) => {
  const shifted = new Date(d.getTime() + MSK_MS);
  const dayOfWeek = (shifted.getUTCDay() + 6) % 7; // 0 = понедельник
  return new Date(shifted.getTime() - dayOfWeek * DAY_MS - MSK_MS);
};

const asDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

/** Постраничный обход заявок по диапазону поля-даты. */
async function scanOrders(
  field: 'createdAt' | 'completedAt',
  since: Date,
  onDoc: (d: FirebaseFirestore.QueryDocumentSnapshot) => void,
): Promise<number> {
  const db = getFirestore();
  let scanned = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection('orders').where(field, '>=', since).orderBy(field, 'asc').limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    page.docs.forEach((d) => {
      onDoc(d);
      scanned += 1;
    });
    if (page.size < PAGE) return scanned;
    cursor = page.docs[page.size - 1];
  }
}

/** Пересчитывает дашборд. Вынесен из расписания ради тестов. */
export async function runDashboard(now: Date, runId: string): Promise<DashboardDoc> {
  const db = getFirestore();

  // Каркас периодов заранее: день без заявок — это ноль, а не дырка в графике
  const days = new Map<string, DashboardDay>();
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = mskDay(new Date(now.getTime() - i * DAY_MS));
    days.set(date, { date, created: 0, completed: 0 });
  }
  const weeks = new Map<string, DashboardWeek>();
  const thisMonday = mskWeekStart(now);
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = mskDay(new Date(thisMonday.getTime() - i * 7 * DAY_MS));
    weeks.set(start, { start, created: 0, completed: 0 });
  }

  const since = new Date(thisMonday.getTime() - (WEEKS - 1) * 7 * DAY_MS);
  const conversion = { total: 0, picked: 0 };
  const offerGaps: number[] = [];
  let withoutOffers = 0;

  const createdScanned = await scanOrders('createdAt', since, (d) => {
    const createdAt = asDate(d.get('createdAt'));
    if (!createdAt) return;

    const day = days.get(mskDay(createdAt));
    if (day) day.created += 1;
    const week = weeks.get(mskDay(mskWeekStart(createdAt)));
    if (week) week.created += 1;

    const ageMs = now.getTime() - createdAt.getTime();
    if (ageMs >= CONVERSION_AGE_MS && ageMs <= DAYS * DAY_MS) {
      conversion.total += 1;
      if (asDate(d.get('agreedAt'))) conversion.picked += 1;
    }

    if (ageMs <= OFFER_WINDOW_MS) {
      const firstOfferAt = asDate(d.get('firstOfferAt'));
      if (firstOfferAt) offerGaps.push(firstOfferAt.getTime() - createdAt.getTime());
      else withoutOffers += 1;
    }
  });

  const completedScanned = await scanOrders('completedAt', since, (d) => {
    const completedAt = asDate(d.get('completedAt'));
    if (!completedAt) return;
    const day = days.get(mskDay(completedAt));
    if (day) day.completed += 1;
    const week = weeks.get(mskDay(mskWeekStart(completedAt)));
    if (week) week.completed += 1;
  });

  const [verified, verifiedBlocked] = await Promise.all([
    db.collection('masters').where('verified', '==', true).count().get(),
    db
      .collection('masters')
      .where('verified', '==', true)
      .where('blocked', '==', true)
      .count()
      .get(),
  ]);

  const doc: DashboardDoc = {
    days: [...days.values()],
    weeks: [...weeks.values()],
    conversion30d: conversion,
    activeMasters: verified.data().count - verifiedBlocked.data().count,
    timeToFirstOffer7d: {
      avgMinutes: offerGaps.length
        ? Math.round(offerGaps.reduce((acc, n) => acc + n, 0) / offerGaps.length / 60000)
        : null,
      withOffers: offerGaps.length,
      withoutOffers,
    },
  };

  await db.doc('stats/dashboard').set({ ...doc, runId, updatedAt: FieldValue.serverTimestamp() });

  await audit({
    action: 'dashboard.updated',
    actor: SYSTEM,
    subject: { type: 'system', id: 'dashboard' },
    correlationId: runId,
    details: { ordersScanned: createdScanned + completedScanned },
  });
  logger.info('Дашборд пересчитан', { runId, createdScanned, completedScanned });
  return doc;
}

// Ночью по Москве: числа за «вчера» готовы к утреннему кофе модератора
export const dashboardDaily = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'Europe/Moscow',
    timeoutSeconds: 540,
    retryCount: 0,
  },
  async () => {
    await runDashboard(new Date(), `dashboard-${Date.now()}`);
  },
);
