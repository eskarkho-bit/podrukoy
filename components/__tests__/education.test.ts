import { EDUCATION_LEVELS, educationFrom } from '../education';

// Уровень образования хранится строкой из закрытого списка. Чужое значение
// из базы не должно доехать до экрана: покажем «не указано», а не мусор.

describe('educationFrom', () => {
  test('значения из списка проходят как есть', () => {
    for (const level of EDUCATION_LEVELS) {
      expect(educationFrom(level)).toBe(level);
    }
  });

  test('всё остальное превращается в null', () => {
    expect(educationFrom('вуз')).toBeNull();
    expect(educationFrom('')).toBeNull();
    expect(educationFrom(undefined)).toBeNull();
    expect(educationFrom(null)).toBeNull();
    expect(educationFrom(42)).toBeNull();
  });
});
