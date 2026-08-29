// Геометрия башни — векторная копия components/DomioLogo.tsx из приложения.
// Ролик рисует тот же знак, что и сплэш: матч-кат честный, а не «похожий».

export const TOWER_VIEWBOX = { width: 80, height: 120 } as const;

/** Корпус башни, снизу вверх: ствол, три уступа, кровля. */
export const TOWER_POLYGONS = [
  '18,112 62,112 54,42 26,42',
  '23,42 57,42 57,33 23,33',
  '27,33 53,33 53,25 27,25',
  '31,25 49,25 49,18 31,18',
  '31,18 49,18 40,3',
] as const;

/** Окна-бойницы; первое — верхнее. */
export const TOWER_WINDOWS = [
  { x: 36, y: 58, width: 8, height: 18 },
  { x: 36, y: 86, width: 8, height: 14 },
] as const;

/**
 * Ствол, нарезанный на «каменные ряды» для сцены строительства.
 * Кромки ствола линейны, поэтому ряд — трапеция между двумя высотами.
 */
export function trunkCourses(rows: number) {
  const yTop = 42;
  const yBottom = 112;
  const left = (y: number) => 18 + 8 * ((112 - y) / 70);
  const right = (y: number) => 62 - 8 * ((112 - y) / 70);
  const step = (yBottom - yTop) / rows;
  const courses: string[] = [];
  for (let i = 0; i < rows; i++) {
    const y1 = yBottom - i * step; // низ ряда
    const y0 = y1 - step + 0.6; // верх ряда, 0.6 юнита — «шов» кладки
    courses.push(`${left(y1)},${y1} ${right(y1)},${y1} ${right(y0)},${y0} ${left(y0)},${y0}`);
  }
  return courses;
}
