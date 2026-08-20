import {
  DISTRICTS,
  isSettlementOpen,
  matchesSettlement,
  OPEN_SETTLEMENT_KEYS,
  OPEN_SETTLEMENTS,
  searchSettlements,
  SETTLEMENTS,
  settlementByKey,
  settlementKey,
  settlementLabel,
} from '../cities';
import { cityKey } from '../serviceOptions';

// Совпадение города — единственное, что связывает заявку с мастером. Если
// ключи у клиента и мастера разойдутся, заявка просто никому не покажется:
// ни ошибки, ни записи в логе.

describe('список населённых пунктов', () => {
  test('покрывает все районы республики', () => {
    // Пятнадцать районов плюс города республиканского значения
    expect(DISTRICTS.length).toBeGreaterThanOrEqual(15);
    expect(DISTRICTS).toContain('Грозный');
    expect(DISTRICTS).toContain('Шелковской');
    expect(DISTRICTS).toContain('Итум-Калинский');
  });

  test('в списке нет повторов', () => {
    const keys = SETTLEMENTS.map((s) => settlementKey(s.name));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('города республиканского значения на месте', () => {
    const cities = SETTLEMENTS.filter((s) => s.kind === 'город').map((s) => s.name);
    expect(cities).toEqual(
      expect.arrayContaining(['Грозный', 'Аргун', 'Гудермес', 'Урус-Мартан', 'Шали', 'Курчалой']),
    );
  });

  test('у каждого пункта есть название, район и вид', () => {
    SETTLEMENTS.forEach((s) => {
      expect(s.name.length).toBeGreaterThan(1);
      expect(s.district.length).toBeGreaterThan(1);
      expect(['город', 'село', 'станица', 'посёлок']).toContain(s.kind);
    });
  });
});

describe('settlementKey', () => {
  test('регистр и пробелы не разводят один пункт на два', () => {
    expect(settlementKey('  ГРОЗНЫЙ ')).toBe('грозный');
    expect(settlementKey('Старые Атаги')).toBe(settlementKey('старые   атаги'));
  });

  test('ё и е считаются одной буквой', () => {
    expect(settlementKey('Червлённая')).toBe(settlementKey('Червленная'));
  });

  // Ключ пишется в заявку клиентом, а сравнивается в запросе мастера —
  // обе стороны обязаны считать его одинаково
  test('совпадает с cityKey, которым нормализует заявку', () => {
    SETTLEMENTS.slice(0, 30).forEach((s) => {
      expect(settlementKey(s.name)).toBe(cityKey(s.name));
    });
  });
});

// Логику сопоставления проверяем на полном списке, а не на открытом. Дефисы
// и «ё» встречаются как раз в закрытых пока названиях, и, открывая их, мы
// должны знать, что поиск по ним работает, — а не выяснять это на людях.
describe('сопоставление с запросом', () => {
  const matching = (q: string) =>
    SETTLEMENTS.filter((s) => matchesSettlement(s, q)).map((s) => s.name);

  test('пустой запрос совпадает со всеми', () => {
    expect(matching('')).toHaveLength(SETTLEMENTS.length);
    expect(matching('   ')).toHaveLength(SETTLEMENTS.length);
  });

  test('находит по началу и по части названия', () => {
    expect(matching('гроз')).toContain('Грозный');
    expect(matching('мартан')).toContain('Урус-Мартан');
  });

  // Дефис на телефонной клавиатуре неудобен, и человек его пропустит
  test('находит без дефиса', () => {
    expect(matching('урусмартан')).toContain('Урус-Мартан');
    expect(matching('ачхоймартан')).toContain('Ачхой-Мартан');
  });

  test('находит по району', () => {
    const found = SETTLEMENTS.filter((s) => matchesSettlement(s, 'шелковской'));
    expect(found.length).toBeGreaterThan(3);
    found.forEach((s) => expect(s.district).toBe('Шелковской'));
  });

  test('регистр и ё не мешают', () => {
    expect(matching('ЧЕРВЛЕННАЯ')).toContain('Червлённая');
  });

  test('несуществующее не находится', () => {
    expect(matching('владивосток')).toHaveLength(0);
  });
});

// Список сознательно сужен до открытых городов, а полный оставлен: по нему
// разбираются подписи у мастеров и заявок, сохранённых до сужения.
describe('открытые пункты', () => {
  test('выбор идёт только по открытым', () => {
    expect(searchSettlements('')).toEqual(OPEN_SETTLEMENTS);
    expect(OPEN_SETTLEMENTS.length).toBeGreaterThan(0);
  });

  test('открыт Грозный', () => {
    expect(searchSettlements('').map((s) => s.name)).toContain('Грозный');
    expect(isSettlementOpen('грозный')).toBe(true);
  });

  test('закрытый город не предлагается, хотя в списке есть', () => {
    expect(searchSettlements('аргун')).toHaveLength(0);
    expect(isSettlementOpen('аргун')).toBe(false);
    // Но из запаса он никуда не делся — открыть можно одной строкой
    expect(SETTLEMENTS.map((s) => s.name)).toContain('Аргун');
  });

  test('каждый открытый ключ есть в полном списке', () => {
    OPEN_SETTLEMENT_KEYS.forEach((key) => {
      expect(settlementByKey(key)).not.toBeNull();
    });
  });

  // Мастер мог выбрать город до сужения. Показать ему сырой ключ вместо
  // названия — значит наказать за наше решение.
  test('подпись закрытого города всё равно человеческая', () => {
    expect(settlementLabel('аргун')).toBe('Аргун');
    expect(settlementLabel('урус-мартан')).toBe('Урус-Мартан');
  });
});

describe('обратный поиск по ключу', () => {
  test('ключ превращается обратно в название', () => {
    expect(settlementLabel('грозный')).toBe('Грозный');
    expect(settlementLabel('урус-мартан')).toBe('Урус-Мартан');
  });

  // В базе могут лежать города, введённые до появления списка. Показать их
  // как есть честнее, чем показать пустоту.
  test('незнакомый ключ возвращается как есть', () => {
    expect(settlementLabel('казань')).toBe('казань');
    expect(settlementByKey('казань')).toBeNull();
  });

  test('любой пункт списка находится по своему ключу', () => {
    SETTLEMENTS.forEach((s) => {
      expect(settlementByKey(settlementKey(s.name))?.name).toBe(s.name);
    });
  });
});
