// Статистика мастера, посчитанная на устройстве из его собственных заказов
// и предложений. Сервера здесь нет намеренно: мастер и так подписан на свои
// заявки, и все цифры — производные того же списка. Отдельный агрегат в базе
// понадобился бы только ради экономии трафика, которой на десятках заказов
// не существует.

export type MasterOrderStat = {
  /** Статус заявки, как он лежит в базе */
  status: string;
  /** Согласованная цена; у старых заявок — предложенная */
  price: number | null;
  /** Создание заявки, мс от эпохи */
  createdMs: number | null;
  /** Подтверждение клиентом, мс. У заказов до появления поля — null. */
  completedMs: number | null;
};

export type IncomeSummary = {
  /** Всего заработано по завершённым заказам */
  total: number;
  /** Заработано в месяце, на который указывает now */
  monthTotal: number;
  /** Средний чек по завершённым с ценой */
  avgCheck: number;
  /** Завершённых заказов с ценой */
  completedCount: number;
  /** Сумма работ, ждущих подтверждения клиента, — доход, но ещё не факт */
  awaitingSum: number;
  awaitingCount: number;
  cancelledCount: number;
};

const isCompleted = (o: MasterOrderStat) => o.status === 'Завершена';
const isAwaiting = (o: MasterOrderStat) => o.status === 'Ждёт подтверждения';
const priceOf = (o: MasterOrderStat) => (o.price != null && o.price > 0 ? o.price : 0);

// Месяц, к которому относится заработок: дата подтверждения клиентом, а у
// заказов, завершённых до появления поля, — дата создания. Заявки живут дни,
// так что промахнуться можно только на стыке месяцев — терпимо.
const earnedMs = (o: MasterOrderStat) => o.completedMs ?? o.createdMs;

/** Ключ месяца, монотонный по времени: год и месяц одним числом. */
const monthKey = (d: Date) => d.getFullYear() * 12 + d.getMonth();

export function incomeSummary(orders: MasterOrderStat[], now: Date = new Date()): IncomeSummary {
  const nowKey = monthKey(now);
  let total = 0;
  let monthTotal = 0;
  let completedCount = 0;
  let awaitingSum = 0;
  let awaitingCount = 0;
  let cancelledCount = 0;

  for (const o of orders) {
    if (isCompleted(o)) {
      const price = priceOf(o);
      if (!price) continue;
      total += price;
      completedCount += 1;
      const ms = earnedMs(o);
      if (ms != null && monthKey(new Date(ms)) === nowKey) monthTotal += price;
    } else if (isAwaiting(o)) {
      awaitingSum += priceOf(o);
      awaitingCount += 1;
    } else if (o.status === 'Отменена') {
      cancelledCount += 1;
    }
  }

  return {
    total,
    monthTotal,
    avgCheck: completedCount ? Math.round(total / completedCount) : 0,
    completedCount,
    awaitingSum,
    awaitingCount,
    cancelledCount,
  };
}

export type MonthIncome = { label: string; sum: number };

const MONTH_LABELS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

/**
 * Доход по месяцам за последние `months` месяцев, от старых к новым.
 * Месяцы без заказов присутствуют с нулём — иначе столбики графика
 * «слипались» бы и врали про равномерность.
 */
export function monthlyIncome(
  orders: MasterOrderStat[],
  months = 6,
  now: Date = new Date(),
): MonthIncome[] {
  const nowKey = monthKey(now);
  const firstKey = nowKey - months + 1;
  const sums = new Array<number>(months).fill(0);

  for (const o of orders) {
    if (!isCompleted(o)) continue;
    const price = priceOf(o);
    const ms = earnedMs(o);
    if (!price || ms == null) continue;
    const idx = monthKey(new Date(ms)) - firstKey;
    if (idx >= 0 && idx < months) sums[idx] += price;
  }

  return sums.map((sum, i) => ({ label: MONTH_LABELS[(firstKey + i) % 12], sum }));
}

/**
 * Доля предложений, после которых клиент выбрал мастера, в процентах.
 * null — предложений ещё не было, и показывать «0%» было бы обидной ложью.
 *
 * Выигранные считаются по заявкам с uid мастера, а туда попадают и заказы
 * старой схемы, шедшие без предложений, — поэтому доля может выйти за сотню
 * и зажимается.
 */
export function conversionPercent(offersSent: number, ordersWon: number): number | null {
  if (offersSent <= 0) return null;
  return Math.min(100, Math.round((ordersWon / offersSent) * 100));
}

export type Milestone = {
  /** Круглая отметка, к которой идёт мастер */
  target: number;
  /** Сколько заказов до неё осталось */
  left: number;
};

// Отметки нарочно круглые: «до 50 осталось 7» подталкивает, «до 47» — нет.
// Все значения кончаются на 0 или 5, поэтому «заказов» склоняется одинаково.
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

/**
 * Ближайшая отметка по выполненным заказам. null — после тысячи: мастеру
 * с тысячей заказов подбадривание счётчиком уже ни к чему.
 */
export function nextMilestone(completed: number): Milestone | null {
  const done = Number.isFinite(completed) && completed > 0 ? completed : 0;
  const target = MILESTONES.find((m) => m > done);
  return target ? { target, left: target - done } : null;
}

/** Миллисекунды к «21.08.2026» — так же, как пишет даты клиентская часть. */
export function dayLabel(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
