// Разброс цен по завершённым заявкам.
//
// Модератору нужна медиана, чтобы понимать, с чего вообще брать процент. Но
// заявок он не видит и видеть не должен: в них адрес, комментарий и фото —
// ровно то, ради сокрытия чего строилась вся проверка мастеров. Поэтому
// считает сервер, а сюда приезжают только числа.
//
// Считает он не список цен, а гистограмму: корзины по 500 ₽. Хранить каждую
// цену значило бы копить документ без предела, а пересчитывать медиану полным
// перебором заявок — платить за чтение всей базы каждые пятнадцать минут.
// Гистограмма занимает сорок чисел независимо от того, сколько было заказов.

/** Ширина корзины. Медиана получается с точностью до половины этой суммы. */
export const BUCKET_WIDTH = 500;

/** Всё, что дороже, попадает в одну корзину: там уже единичные случаи. */
export const BUCKET_CAP = 20000;

/** Что лежит в stats/orders. Пишет только сервер. */
export type OrderStats = {
  /** Сколько завершённых заявок с ценой учтено */
  completed: number;
  /** Сумма цен — для среднего */
  sum: number;
  /** Ключ корзины (нижняя граница) → сколько заявок в неё попало */
  buckets: Record<string, number>;
};

export type PriceSummary = {
  count: number;
  median: number;
  p25: number;
  p75: number;
  average: number;
  /**
   * Медиана упёрлась в корзину «дороже 20 000». Точное значение по
   * гистограмме не восстановить, и показывать его как точное нельзя.
   */
  medianAtCap: boolean;
};

/** Нижняя граница корзины, в которую попадает цена. */
export function bucketOf(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (price >= BUCKET_CAP) return BUCKET_CAP;
  return Math.floor(price / BUCKET_WIDTH) * BUCKET_WIDTH;
}

/**
 * Квантиль по гистограмме.
 *
 * Внутри корзины считаем цены распределёнными равномерно — обычное допущение
 * для сгруппированных данных. Ошибка не превышает ширины корзины, а решение
 * «пять процентов или пятнадцать» на такой точности принимается спокойно.
 */
function quantile(sorted: [number, number][], count: number, p: number) {
  const target = count * p;
  let seen = 0;
  for (const [low, n] of sorted) {
    if (seen + n >= target) {
      // Переполненная корзина не имеет верхней границы — интерполировать не в чем
      if (low >= BUCKET_CAP) return { value: BUCKET_CAP, atCap: true };
      const within = n > 0 ? (target - seen) / n : 0;
      return { value: Math.round(low + within * BUCKET_WIDTH), atCap: false };
    }
    seen += n;
  }
  const last = sorted[sorted.length - 1];
  return { value: last ? last[0] : 0, atCap: false };
}

/**
 * Сводка по гистограмме. null — если считать пока нечего: сервер ещё не
 * присылал данных или ни одна заявка не завершилась с ценой.
 */
export function priceSummary(stats: OrderStats | null | undefined): PriceSummary | null {
  if (!stats || !stats.completed) return null;

  const sorted = Object.entries(stats.buckets ?? {})
    .map(([low, n]) => [Number(low), Number(n)] as [number, number])
    .filter(([low, n]) => Number.isFinite(low) && n > 0)
    .sort((a, b) => a[0] - b[0]);

  if (!sorted.length) return null;

  // Считаем по сумме корзин, а не по completed: если счётчики разойдутся,
  // доверять надо тому, из чего собственно берутся квантили
  const count = sorted.reduce((acc, [, n]) => acc + n, 0);
  const median = quantile(sorted, count, 0.5);

  return {
    count,
    median: median.value,
    medianAtCap: median.atCap,
    p25: quantile(sorted, count, 0.25).value,
    p75: quantile(sorted, count, 0.75).value,
    average: Math.round(stats.sum / count),
  };
}
