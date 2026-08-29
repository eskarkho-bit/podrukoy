import { CATEGORIES, categoryFor, cityKey, flowFor, OTHER_LABEL } from '../serviceOptions';

// Специальность и город — единственное, по чему заявка находит мастера.
// Ошибка здесь не падает и не логируется: заявка просто никому не видна.

describe('categoryFor', () => {
  test('объекты дома разложены по специальностям', () => {
    expect(categoryFor('socket')).toBe('электрика');
    expect(categoryFor('light')).toBe('электрика');
    expect(categoryFor('sink')).toBe('сантехника');
    expect(categoryFor('pipe')).toBe('сантехника');
    expect(categoryFor('stove')).toBe('бытовая техника');
    expect(categoryFor('fridge')).toBe('бытовая техника');
    expect(categoryFor('washer')).toBe('бытовая техника');
    expect(categoryFor('ac')).toBe('бытовая техника');
    expect(categoryFor('window')).toBe('окна');
    expect(categoryFor('lawn')).toBe('участок');
    expect(categoryFor('gate')).toBe('ворота');
    expect(categoryFor('tools')).toBe('инструмент');
    expect(categoryFor('door')).toBe('двери и замки');
    expect(categoryFor('boiler')).toBe('отопление');
    expect(categoryFor('panel')).toBe('электрика');
    expect(categoryFor('septic')).toBe('сантехника');
    expect(categoryFor('roof')).toBe('кровля');
    expect(categoryFor('fence')).toBe('сварка');
  });

  // Неизвестный объект обязан давать существующую специальность: правила
  // Firestore проверяют её по закрытому списку и отклонят заявку с чем-то
  // посторонним
  test('незнакомый объект попадает в «разное», а не в пустоту', () => {
    expect(categoryFor('нет-такого')).toBe('разное');
    expect(categoryFor('')).toBe('разное');
  });

  test('любая выданная специальность есть в списке, известном правилам', () => {
    const objects = [
      'socket',
      'sink',
      'stove',
      'fridge',
      'washer',
      'ac',
      'light',
      'shower',
      'pipe',
      'window',
      'lawn',
      'trees',
      'gate',
      'tools',
      'door',
      'boiler',
      'panel',
      'septic',
      'roof',
      'fence',
      'чужое',
    ];
    objects.forEach((id) => {
      expect(CATEGORIES).toContain(categoryFor(id));
    });
  });
});

describe('cityKey', () => {
  test('регистр не разделяет один город на два', () => {
    expect(cityKey('Москва')).toBe(cityKey('москва'));
    expect(cityKey('МОСКВА')).toBe('москва');
  });

  test('лишние пробелы срезаются', () => {
    expect(cityKey('  Казань  ')).toBe('казань');
    expect(cityKey('Нижний   Новгород')).toBe('нижний новгород');
  });

  test('ё и е считаются одной буквой', () => {
    expect(cityKey('Королёв')).toBe(cityKey('Королев'));
  });

  test('пустая строка остаётся пустой', () => {
    expect(cityKey('')).toBe('');
    expect(cityKey('   ')).toBe('');
  });

  // Известное ограничение, а не недосмотр: геокодирования нет, сравниваются
  // строки. Тест фиксирует это, чтобы никто не считал иначе.
  test('разные названия одного города не сходятся — так и задумано', () => {
    expect(cityKey('Питер')).not.toBe(cityKey('Санкт-Петербург'));
  });
});

describe('flowFor', () => {
  test('у известного объекта своё дерево услуг', () => {
    const flow = flowFor('socket');
    expect(flow.length).toBeGreaterThan(0);
    expect(flow[0]).toHaveProperty('label');
    expect(flow[0].subs.length).toBeGreaterThan(0);
  });

  test('у незнакомого объекта — запасное дерево, а не пустой экран', () => {
    const flow = flowFor('нет-такого');
    expect(flow.length).toBeGreaterThan(0);
    // Пустые уточнения допустимы только у «Другого» — оно ведёт сразу к форме
    flow
      .filter((type) => type.label !== OTHER_LABEL)
      .forEach((type) => expect(type.subs.length).toBeGreaterThan(0));
  });

  // Готовый список никогда не покроет все случаи: без запасного выхода человек
  // с нестандартной проблемой просто закроет шторку и уйдёт
  test('на каждом шаге любого дерева есть «Другое»', () => {
    ['socket', 'light', 'washer', 'нет-такого'].forEach((id) => {
      const flow = flowFor(id);
      // Последний тип — «Другое» без уточнений: шторка поведёт сразу к описанию
      const last = flow[flow.length - 1];
      expect(last.label).toBe(OTHER_LABEL);
      expect(last.subs).toHaveLength(0);
      // И внутри каждой категории «Другое» замыкает список уточнений
      flow.slice(0, -1).forEach((type) => {
        expect(type.subs[type.subs.length - 1]).toBe(OTHER_LABEL);
      });
    });
  });

  test('в «Свете» есть установка люстры', () => {
    const install = flowFor('light').find((type) => type.label === 'Установка');
    expect(install?.subs).toContain('Люстра');
  });

  // Самая срочная услуга каталога: человек стоит перед запертой дверью.
  // Пропасть она может только молча, поэтому её держит тест.
  test('у входной двери есть вскрытие замка', () => {
    const stuck = flowFor('door').find((type) => type.label === 'Не открывается');
    expect(stuck?.subs).toContain('Вскрытие замка');
  });

  test('«Другое» замыкает и новые деревья каталога', () => {
    ['door', 'boiler', 'panel', 'septic', 'roof', 'fence'].forEach((id) => {
      const flow = flowFor(id);
      const last = flow[flow.length - 1];
      expect(last.label).toBe(OTHER_LABEL);
      flow.slice(0, -1).forEach((type) => {
        expect(type.subs[type.subs.length - 1]).toBe(OTHER_LABEL);
      });
    });
  });
});
