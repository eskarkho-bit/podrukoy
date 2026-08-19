import { CATEGORIES, categoryFor, cityKey, flowFor } from '../serviceOptions';

// Специальность и город — единственное, по чему заявка находит мастера.
// Ошибка здесь не падает и не логируется: заявка просто никому не видна.

describe('categoryFor', () => {
  test('объекты дома разложены по специальностям', () => {
    expect(categoryFor('socket')).toBe('электрика');
    expect(categoryFor('light')).toBe('электрика');
    expect(categoryFor('sink')).toBe('сантехника');
    expect(categoryFor('pipe')).toBe('сантехника');
    expect(categoryFor('stove')).toBe('бытовая техника');
    expect(categoryFor('window')).toBe('окна');
    expect(categoryFor('lawn')).toBe('участок');
    expect(categoryFor('gate')).toBe('ворота');
    expect(categoryFor('tools')).toBe('инструмент');
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
      'light',
      'shower',
      'pipe',
      'window',
      'lawn',
      'trees',
      'gate',
      'tools',
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
    flow.forEach((type) => expect(type.subs.length).toBeGreaterThan(0));
  });
});
