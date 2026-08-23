import {
  conversionPercent,
  dayLabel,
  incomeSummary,
  monthlyIncome,
  nextMilestone,
  type MasterOrderStat,
} from '../masterStats';

// Эти числа мастер видит как свой заработок. Ошибка здесь не роняет
// приложение — она просто показывает человеку не те деньги.

const NOW = new Date(2026, 7, 23); // 23 августа 2026

const completed = (patch: Partial<MasterOrderStat> = {}): MasterOrderStat => ({
  status: 'Завершена',
  price: 3000,
  createdMs: new Date(2026, 7, 10).getTime(),
  completedMs: new Date(2026, 7, 12).getTime(),
  ...patch,
});

describe('incomeSummary', () => {
  test('считает только завершённые заказы с ценой', () => {
    const s = incomeSummary(
      [
        completed(),
        completed({ price: 5000 }),
        completed({ price: null }), // старый заказ без цены — не в счёт
        completed({ status: 'В работе' }),
        completed({ status: 'Отменена' }),
      ],
      NOW,
    );
    expect(s.total).toBe(8000);
    expect(s.completedCount).toBe(2);
    expect(s.avgCheck).toBe(4000);
    expect(s.cancelledCount).toBe(1);
  });

  test('месяц определяется по дате подтверждения', () => {
    const july = new Date(2026, 6, 30).getTime();
    const s = incomeSummary(
      [completed(), completed({ price: 7000, completedMs: july, createdMs: july })],
      NOW,
    );
    expect(s.total).toBe(10000);
    expect(s.monthTotal).toBe(3000);
  });

  test('заказ до появления даты завершения относится к месяцу создания', () => {
    const s = incomeSummary([completed({ completedMs: null })], NOW);
    expect(s.monthTotal).toBe(3000);
  });

  test('ждущие подтверждения лежат отдельно — это ещё не доход', () => {
    const s = incomeSummary(
      [completed(), completed({ status: 'Ждёт подтверждения', price: 4500 })],
      NOW,
    );
    expect(s.total).toBe(3000);
    expect(s.awaitingSum).toBe(4500);
    expect(s.awaitingCount).toBe(1);
  });

  test('пустой список даёт нули, а не NaN', () => {
    const s = incomeSummary([], NOW);
    expect(s.total).toBe(0);
    expect(s.avgCheck).toBe(0);
    expect(s.monthTotal).toBe(0);
  });
});

describe('monthlyIncome', () => {
  test('раскладывает доход по месяцам от старых к новым', () => {
    const bars = monthlyIncome(
      [
        completed(), // август
        completed({ price: 2000, completedMs: new Date(2026, 6, 5).getTime() }), // июль
        completed({ price: 1000, completedMs: new Date(2026, 6, 20).getTime() }), // июль
      ],
      3,
      NOW,
    );
    expect(bars.map((b) => b.label)).toEqual(['июн', 'июл', 'авг']);
    expect(bars.map((b) => b.sum)).toEqual([0, 3000, 3000]);
  });

  test('заказы за пределами окна не попадают', () => {
    const bars = monthlyIncome(
      [completed({ completedMs: new Date(2025, 7, 1).getTime() })],
      6,
      NOW,
    );
    expect(bars.every((b) => b.sum === 0)).toBe(true);
    expect(bars).toHaveLength(6);
  });

  test('окно через границу года подписывает месяцы правильно', () => {
    const bars = monthlyIncome([], 4, new Date(2026, 1, 10)); // февраль 2026
    expect(bars.map((b) => b.label)).toEqual(['ноя', 'дек', 'янв', 'фев']);
  });
});

describe('conversionPercent', () => {
  test('обычная доля выигранных предложений', () => {
    expect(conversionPercent(10, 3)).toBe(30);
  });

  test('без предложений — null, а не 0%', () => {
    expect(conversionPercent(0, 0)).toBeNull();
  });

  // Заказы старой схемы приходили без предложений, и выигранных может
  // оказаться больше, чем отправленных
  test('больше сотни не бывает', () => {
    expect(conversionPercent(2, 5)).toBe(100);
  });
});

describe('nextMilestone', () => {
  test('«до 50 заказов осталось 7»', () => {
    expect(nextMilestone(43)).toEqual({ target: 50, left: 7 });
  });

  test('новичку показывается первая отметка целиком', () => {
    expect(nextMilestone(0)).toEqual({ target: 10, left: 10 });
  });

  // Достигнутая отметка — уже не цель: ровно на 50 ведём к сотне
  test('на самой отметке цель — следующая', () => {
    expect(nextMilestone(50)).toEqual({ target: 100, left: 50 });
  });

  test('после тысячи подбадривать нечем', () => {
    expect(nextMilestone(1000)).toBeNull();
    expect(nextMilestone(1500)).toBeNull();
  });

  test('мусор на входе считается нулём', () => {
    expect(nextMilestone(-3)).toEqual({ target: 10, left: 10 });
    expect(nextMilestone(NaN)).toEqual({ target: 10, left: 10 });
  });
});

describe('dayLabel', () => {
  test('формат совпадает с датами клиентской части', () => {
    expect(dayLabel(new Date(2026, 7, 5).getTime())).toBe('05.08.2026');
  });
});
