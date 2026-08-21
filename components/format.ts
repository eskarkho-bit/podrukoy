// Форматирование, общее для обеих сторон приложения. Раньше `rub` жил тремя
// копиями в разных экранах — с появлением предложений и отзывов копий стало бы
// пять.

export const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

/**
 * Русское склонение по числу: plural(2, 'отзыв', 'отзыва', 'отзывов').
 * Без него счётчики предложений и отзывов читаются как машинный перевод.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «3 предложения», «5 предложений» — число вместе со склонённым словом. */
export const counted = (n: number, one: string, few: string, many: string) =>
  `${n} ${plural(n, one, few, many)}`;

/** Рейтинг к виду «4,8» — одна цифра после запятой, как принято в русских ценниках. */
export const ratingText = (rating: number) => rating.toFixed(1).replace('.', ',');
