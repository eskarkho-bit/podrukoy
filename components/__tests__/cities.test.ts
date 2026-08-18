import {
  DISTRICTS,
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

describe('поиск', () => {
  test('пустой запрос отдаёт весь список', () => {
    expect(searchSettlements('')).toHaveLength(SETTLEMENTS.length);
    expect(searchSettlements('   ')).toHaveLength(SETTLEMENTS.length);
  });

  test('находит по началу названия', () => {
    const found = searchSettlements('гроз').map((s) => s.name);
    expect(found).toContain('Грозный');
  });

  test('находит по части названия', () => {
    expect(searchSettlements('мартан').map((s) => s.name)).toContain('Урус-Мартан');
  });

  // Дефис на телефонной клавиатуре неудобен, и человек его пропустит
  test('находит без дефиса', () => {
    expect(searchSettlements('урусмартан').map((s) => s.name)).toContain('Урус-Мартан');
    expect(searchSettlements('ачхоймартан').map((s) => s.name)).toContain('Ачхой-Мартан');
  });

  test('находит по району', () => {
    const found = searchSettlements('шелковской');
    expect(found.length).toBeGreaterThan(3);
    found.forEach((s) => expect(s.district).toBe('Шелковской'));
  });

  test('регистр и ё не мешают', () => {
    expect(searchSettlements('ЧЕРВЛЕННАЯ').map((s) => s.name)).toContain('Червлённая');
  });

  test('несуществующее не находится', () => {
    expect(searchSettlements('владивосток')).toHaveLength(0);
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
