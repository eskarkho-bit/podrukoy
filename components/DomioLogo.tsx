import Svg, { Polygon, Rect } from 'react-native-svg';

// Знак domio — сторожевая башня. Векторная копия design/logo/domio-symbol.svg:
// PNG при масштабировании в сплэше размылся бы, а SVG остаётся резким на
// любом множителе. Меняется исходник — меняйте и эту копию.
//
// Геометрия вынесена в константы: сплэш рисует башню сам, потому что делает
// из окон сквозные дырки в маске, — и его окна обязаны совпадать с этими.

export const TOWER_VIEWBOX = { width: 80, height: 120 } as const;

/** Корпус башни, снизу вверх: ствол, три уступа, кровля. */
export const TOWER_POLYGONS = [
  '18,112 62,112 54,42 26,42',
  '23,42 57,42 57,33 23,33',
  '27,33 53,33 53,25 27,25',
  '31,25 49,25 49,18 31,18',
  '31,18 49,18 40,3',
] as const;

/** Окна-бойницы. Первое — верхнее, через него сплэш раскрывает приложение. */
export const TOWER_WINDOWS = [
  { x: 36, y: 58, width: 8, height: 18 },
  { x: 36, y: 86, width: 8, height: 14 },
] as const;

/** Нижняя кромка ствола в юнитах знака — от неё сплэш отмеряет подпись. */
export const TOWER_BASE_Y = 112;

type Props = {
  height?: number;
  /** Цвет башни. По умолчанию фирменный зелёный из светлой темы. */
  color?: string;
  /** Цвет окон-бойниц — обычно цвет фона, на котором стоит знак. */
  windowColor?: string;
};

export function DomioLogo({ height = 120, color = '#5E7A56', windowColor = '#FFFFFF' }: Props) {
  const { width: vw, height: vh } = TOWER_VIEWBOX;
  return (
    <Svg viewBox={`0 0 ${vw} ${vh}`} width={(height * vw) / vh} height={height}>
      {TOWER_POLYGONS.map((points) => (
        <Polygon key={points} points={points} fill={color} />
      ))}
      {TOWER_WINDOWS.map((w) => (
        <Rect key={w.y} {...w} fill={windowColor} />
      ))}
    </Svg>
  );
}
