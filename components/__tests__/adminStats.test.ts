import { MAIN_CITIES } from '../adminStats';
import { CATEGORIES } from '../serviceOptions';
import { settlementByKey } from '../cities';

// Сводка модератора. Сами запросы к базе здесь не проверяются — они уходят в
// Firestore, а он подменён. Проверяется то, что можно сломать молча: список
// городов, по которым считается покрытие.

describe('города для сводки покрытия', () => {
  test('это города республиканского значения, все шесть', () => {
    expect(MAIN_CITIES).toHaveLength(6);
    expect(MAIN_CITIES.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Грозный', 'Аргун', 'Гудермес', 'Урус-Мартан', 'Шали', 'Курчалой']),
    );
  });

  // Ключ сводки сравнивается с ключами из анкет мастеров. Разойдутся — и
  // покрытый город покажется пустым, а это повод искать несуществующую дыру
  test('ключи совпадают с ключами списка населённых пунктов', () => {
    MAIN_CITIES.forEach((c) => {
      expect(settlementByKey(c.key)?.name).toBe(c.name);
    });
  });
});

describe('специальности', () => {
  // Пустая специальность в сводке означает «заявки, на которые некому
  // откликнуться». Перечень обязан совпадать с тем, что выбирает мастер.
  test('перечень закрытый и непустой', () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
  });
});
