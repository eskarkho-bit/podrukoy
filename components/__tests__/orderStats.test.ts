import { bucketOf, BUCKET_CAP, priceSummary, type OrderStats } from '../orderStats';

// Медиана чека — основание для ставки комиссии. Ошибка здесь не падает
// и ничего не ломает: она просто показывает не то число, а решение по нему
// принимают всерьёз.

const stats = (buckets: Record<string, number>, sum?: number): OrderStats => {
  const completed = Object.values(buckets).reduce((a, b) => a + b, 0);
  return {
    completed,
    // Если сумму не задали, считаем по серединам корзин — для среднего сойдёт
    sum: sum ?? Object.entries(buckets).reduce((acc, [low, n]) => acc + (Number(low) + 250) * n, 0),
    buckets,
  };
};

describe('корзины', () => {
  test('цена попадает в корзину по нижней границе', () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(1)).toBe(0);
    expect(bucketOf(499)).toBe(0);
    expect(bucketOf(500)).toBe(500);
    expect(bucketOf(2999)).toBe(2500);
    expect(bucketOf(3000)).toBe(3000);
  });

  test('дорогие сваливаются в одну корзину — там единичные случаи', () => {
    expect(bucketOf(BUCKET_CAP)).toBe(BUCKET_CAP);
    expect(bucketOf(BUCKET_CAP + 100000)).toBe(BUCKET_CAP);
  });

  // Настоящая защита стоит на сервере: recordCompletedOrder не пропускает
  // нечисловую и неположительную цену. Здесь фиксируем, что и без неё
  // расчёт не падает, а мусор не притворяется ценой.
  test('мусор не роняет расчёт', () => {
    expect(bucketOf(-500)).toBe(0);
    expect(bucketOf(Number.NaN)).toBe(0);
    expect(bucketOf(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('сводка', () => {
  test('пока нечего считать — null, а не нули', () => {
    // Ноль рублей медианы выглядел бы как настоящее число, а это не так:
    // до развёртывания функций сводки просто нет
    expect(priceSummary(null)).toBeNull();
    expect(priceSummary(undefined)).toBeNull();
    expect(priceSummary({ completed: 0, sum: 0, buckets: {} })).toBeNull();
    expect(priceSummary({ completed: 5, sum: 100, buckets: {} })).toBeNull();
  });

  test('одна заявка: медиана внутри её корзины', () => {
    const s = priceSummary(stats({ 3000: 1 }))!;
    expect(s.count).toBe(1);
    expect(s.median).toBeGreaterThanOrEqual(3000);
    expect(s.median).toBeLessThanOrEqual(3500);
  });

  // Ровный случай: половина заявок дешевле 3000, половина дороже
  test('медиана делит выборку пополам', () => {
    const s = priceSummary(stats({ 1000: 10, 2000: 10, 3000: 10, 4000: 10 }))!;
    expect(s.count).toBe(40);
    // Сорок заявок, двадцатая приходится на границу второй и третьей корзины
    expect(s.median).toBeGreaterThanOrEqual(2500);
    expect(s.median).toBeLessThanOrEqual(3000);
  });

  test('квартили расходятся вокруг медианы', () => {
    const s = priceSummary(stats({ 1000: 10, 2000: 10, 3000: 10, 4000: 10 }))!;
    expect(s.p25).toBeLessThan(s.median);
    expect(s.p75).toBeGreaterThan(s.median);
  });

  test('перекос вправо тянет медиану вверх', () => {
    const cheap = priceSummary(stats({ 1000: 90, 9000: 10 }))!;
    const rich = priceSummary(stats({ 1000: 10, 9000: 90 }))!;
    expect(cheap.median).toBeLessThan(rich.median);
  });

  // Именно ради этого медиана и берётся вместо среднего: один заказ на
  // двести тысяч не должен решать, какой процент брать со всех остальных.
  // Совсем неподвижной медиана не будет — выборка стала на одну заявку
  // больше, — но сдвиг должен быть незаметным против скачка среднего.
  test('единичный дорогой заказ почти не двигает медиану, но двигает среднее', () => {
    const without = priceSummary(stats({ 3000: 99 }))!;
    const with_ = priceSummary(stats({ 3000: 99, [BUCKET_CAP]: 1 }))!;

    expect(Math.abs(with_.median - without.median)).toBeLessThan(50);
    expect(with_.average - without.average).toBeGreaterThan(100);
  });

  test('среднее считается по сумме, а не по корзинам', () => {
    const s = priceSummary(stats({ 3000: 2 }, 8000))!;
    expect(s.average).toBe(4000);
  });

  test('медиана в переполненной корзине помечается', () => {
    const s = priceSummary(stats({ [BUCKET_CAP]: 5 }))!;
    expect(s.medianAtCap).toBe(true);
    expect(s.median).toBe(BUCKET_CAP);
  });

  test('обычная медиана не помечается', () => {
    expect(priceSummary(stats({ 3000: 5 }))!.medianAtCap).toBe(false);
  });

  // Счётчик completed и корзины пишутся одной транзакцией, но если они
  // всё же разойдутся, квантили надо считать по тому, из чего они берутся
  test('считаем по корзинам, а не по счётчику', () => {
    const s = priceSummary({ completed: 999, sum: 6000, buckets: { 3000: 2 } })!;
    expect(s.count).toBe(2);
    expect(s.average).toBe(3000);
  });

  test('пустые и порченые корзины пропускаются', () => {
    const s = priceSummary({
      completed: 3,
      sum: 9000,
      buckets: { 3000: 3, 3500: 0, что: 5 } as unknown as Record<string, number>,
    })!;
    expect(s.count).toBe(3);
  });
});
