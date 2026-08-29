import { ReactElement } from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

// Векторные иконки объектов дома.
//
// Эмодзи у каждого производителя свои: одна и та же розетка на Samsung,
// Xiaomi и iPhone выглядит тремя разными картинками, и сцена дома от этого
// разъезжается по стилю. Свои иконки везде одинаковы и нарисованы в палитре
// самой сцены. Эмодзи в данных объектов остаётся запасным вариантом: объект
// без иконки здесь покажет его, а не пустой кружок.

export type ObjectIconColors = {
  stroke: string; // контур
  fill: string; // корпус
  glass: string; // «стекло», вода, воздух
};

// Палитра сцены дома: зелёный контура — цвет подписей, голубой — стёкла окон
export const SCENE_COLORS: ObjectIconColors = {
  stroke: '#5E7A56',
  fill: '#EAF1E6',
  glass: '#C7D6E0',
};

// Зелень деревьев и газона — из самой сцены (Tree в HouseScene); она нарочно
// не зависит от темы: природа одного цвета и днём, и ночью
const TRUNK = '#B49B7D';
const LEAF = '#9CB88C';
const LEAF_DARK = '#8AA97A';
const LEAF_LIGHT = '#A9C29A';

// Каждая иконка рисуется в поле 34×34 — родном размере кружка на сцене.
// Экспорт нужен glyphIcons: эмодзи объектов отрисовываются теми же рисунками
export const OBJECT_ICONS: Record<string, (c: ObjectIconColors) => ReactElement> = {
  socket: (c) => (
    <>
      <Rect
        x={8}
        y={8}
        width={18}
        height={18}
        rx={5}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Circle cx={17} cy={17} r={6} fill="none" stroke={c.stroke} strokeWidth={2} />
      <Circle cx={14.2} cy={17} r={1.4} fill={c.stroke} />
      <Circle cx={19.8} cy={17} r={1.4} fill={c.stroke} />
    </>
  ),
  sink: (c) => (
    <>
      <Path
        d="M21 17 V11 Q21 8 17.5 8 H13"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={13}
        y1={8}
        x2={13}
        y2={10.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Circle cx={13} cy={14} r={1.5} fill={c.glass} />
      <Path
        d="M9 19 Q17 30 25 19 Z"
        fill={c.glass}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Line
        x1={6}
        y1={19}
        x2={28}
        y2={19}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  stove: (c) => (
    <>
      <Rect
        x={7}
        y={7}
        width={20}
        height={20}
        rx={4}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Circle cx={13} cy={13} r={2.9} fill="none" stroke={c.stroke} strokeWidth={2} />
      <Circle cx={21} cy={13} r={2.9} fill="none" stroke={c.stroke} strokeWidth={2} />
      <Circle cx={13} cy={21} r={2.9} fill="none" stroke={c.stroke} strokeWidth={2} />
      <Circle cx={21} cy={21} r={2.9} fill="none" stroke={c.stroke} strokeWidth={2} />
    </>
  ),
  fridge: (c) => (
    <>
      <Rect
        x={9}
        y={4}
        width={16}
        height={26}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Line x1={9} y1={14} x2={25} y2={14} stroke={c.stroke} strokeWidth={2} />
      <Line
        x1={12.5}
        y1={7.5}
        x2={12.5}
        y2={11}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={12.5}
        y1={17.5}
        x2={12.5}
        y2={23}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  washer: (c) => (
    <>
      <Rect
        x={6}
        y={5}
        width={22}
        height={24}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Circle cx={17} cy={19} r={6.5} fill={c.glass} stroke={c.stroke} strokeWidth={2} />
      <Path d="M11.5 19 q2.75 -2.2 5.5 0 t5.5 0" fill="none" stroke={c.fill} strokeWidth={1.8} />
      <Circle cx={11} cy={9} r={1.4} fill={c.stroke} />
      <Circle cx={15.5} cy={9} r={1.4} fill={c.stroke} />
    </>
  ),
  ac: (c) => (
    <>
      <Rect
        x={4}
        y={8}
        width={26}
        height={12}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Line x1={8} y1={16.5} x2={26} y2={16.5} stroke={c.stroke} strokeWidth={1.8} />
      <Path
        d="M10 23 q1.5 2.5 0 5"
        fill="none"
        stroke={c.glass}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M17 23 q1.5 2.5 0 5"
        fill="none"
        stroke={c.glass}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M24 23 q1.5 2.5 0 5"
        fill="none"
        stroke={c.glass}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  // Классическая лампочка: подвесной светильник в мелком кружке читался
  // как непонятная фигура
  light: (c) => (
    <>
      <Line
        x1={17}
        y1={2.5}
        x2={17}
        y2={5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={7.5}
        y1={6}
        x2={9.5}
        y2={8}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={26.5}
        y1={6}
        x2={24.5}
        y2={8}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Circle cx={17} cy={14.5} r={7.5} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
      <Line
        x1={13.8}
        y1={24.5}
        x2={20.2}
        y2={24.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={14.4}
        y1={28}
        x2={19.6}
        y2={28}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  shower: (c) => (
    <>
      <Line
        x1={17}
        y1={4.5}
        x2={17}
        y2={7}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M10.5 13 a6.5 6.5 0 0 1 13 0 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Line
        x1={12}
        y1={17}
        x2={11}
        y2={22}
        stroke={c.glass}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={17}
        y1={17}
        x2={17}
        y2={23}
        stroke={c.glass}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={22}
        y1={17}
        x2={23}
        y2={22}
        stroke={c.glass}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  pipe: (c) => (
    <>
      {/* Труба — два штриха по одному пути: широкий контур и светлая середина */}
      <Path d="M5 13 H16 A7 7 0 0 1 23 20 V29" fill="none" stroke={c.stroke} strokeWidth={6} />
      <Path d="M5 13 H16 A7 7 0 0 1 23 20 V29" fill="none" stroke={c.fill} strokeWidth={2.8} />
      <Circle cx={28.5} cy={15} r={1.6} fill={c.glass} />
    </>
  ),
  window: (c) => (
    <>
      <Rect
        x={7}
        y={7}
        width={20}
        height={20}
        rx={2}
        fill={c.glass}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Line x1={17} y1={7} x2={17} y2={27} stroke={c.stroke} strokeWidth={2} />
      <Line x1={7} y1={17} x2={27} y2={17} stroke={c.stroke} strokeWidth={2} />
    </>
  ),
  lawn: (c) => (
    <>
      <Path
        d="M9.5 27 Q9 20 12 15.5"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M14.5 27 Q15 19 13.5 13.5"
        fill="none"
        stroke={LEAF_DARK}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M19.5 27 Q19 20 22 16"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M24.5 27 Q25 21 23.5 17"
        fill="none"
        stroke={LEAF_DARK}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={6}
        y1={27.5}
        x2={28}
        y2={27.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  trees: () => (
    <>
      <Rect x={15.7} y={19} width={2.6} height={9} rx={1.3} fill={TRUNK} />
      <Circle cx={17} cy={13.5} r={7} fill={LEAF} />
      <Circle cx={10.8} cy={17.5} r={4.6} fill={LEAF_DARK} />
      <Circle cx={23.4} cy={17} r={5} fill={LEAF_LIGHT} />
    </>
  ),
  gate: (c) => (
    <>
      <Rect
        x={6}
        y={9}
        width={22}
        height={18}
        rx={2.5}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Line x1={6} y1={14.5} x2={28} y2={14.5} stroke={c.stroke} strokeWidth={2} />
      <Line x1={6} y1={19.5} x2={28} y2={19.5} stroke={c.stroke} strokeWidth={2} />
      <Circle cx={17} cy={23.5} r={1.4} fill={c.stroke} />
    </>
  ),
  tools: (c) => (
    <>
      <Path
        d="M13.5 15 V13 A3.5 3 0 0 1 20.5 13 V15"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Rect
        x={6}
        y={15}
        width={22}
        height={12}
        rx={2.5}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Line x1={6} y1={19.5} x2={28} y2={19.5} stroke={c.stroke} strokeWidth={2} />
      <Circle cx={17} cy={19.5} r={1.5} fill={c.stroke} />
    </>
  ),
  door: (c) => (
    <>
      <Rect
        x={10}
        y={4}
        width={14}
        height={25}
        rx={2.5}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Circle cx={20.2} cy={16.5} r={1.5} fill={c.stroke} />
      <Line
        x1={6}
        y1={30.5}
        x2={28}
        y2={30.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  roof: (c) => (
    <>
      {/* Двускатная крыша с трубой; капля под коньком — про самую частую беду */}
      <Path
        d="M4 19 L17 6 L30 19"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Rect x={21.5} y={7.5} width={3.6} height={6} rx={1} fill={c.stroke} />
      <Line x1={8} y1={19} x2={8} y2={24} stroke={c.stroke} strokeWidth={2} strokeLinecap="round" />
      <Line
        x1={26}
        y1={19}
        x2={26}
        y2={24}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path d="M17 22.5 q-3 4.2 0 6.6 q3 -2.4 0 -6.6" fill={c.glass} />
    </>
  ),
  boiler: (c) => (
    <>
      <Rect
        x={10}
        y={4}
        width={14}
        height={21.5}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Circle cx={17} cy={11} r={2.7} fill="none" stroke={c.stroke} strokeWidth={1.8} />
      <Line x1={13.5} y1={19.5} x2={20.5} y2={19.5} stroke={c.stroke} strokeWidth={1.8} />
      {/* Газовое пламя — голубое, как в жизни */}
      <Path d="M14 31 q-1.6 -2.6 1 -4.6 q1.4 2 -1 4.6" fill={c.glass} />
      <Path d="M18.6 31 q-1.6 -2.6 1 -4.6 q1.4 2 -1 4.6" fill={c.glass} />
    </>
  ),
  panel: (c) => (
    <>
      <Rect
        x={8}
        y={6}
        width={18}
        height={22}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      {/* Два автомата: один включён, второй выбило вниз */}
      <Rect x={11.5} y={10} width={4.4} height={7.5} rx={1.6} fill={c.stroke} />
      <Rect x={18.4} y={12.5} width={4.4} height={5} rx={1.6} fill={c.stroke} />
      <Line x1={8} y1={21.5} x2={26} y2={21.5} stroke={c.stroke} strokeWidth={1.8} />
      <Circle cx={17} cy={24.7} r={1.3} fill={c.stroke} />
    </>
  ),
  septic: (c) => (
    <>
      {/* Круглый люк с решёткой */}
      <Circle cx={17} cy={18.5} r={10} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
      <Circle cx={17} cy={18.5} r={6} fill="none" stroke={c.stroke} strokeWidth={1.6} />
      <Line x1={13.8} y1={16} x2={20.2} y2={16} stroke={c.stroke} strokeWidth={1.5} />
      <Line x1={13} y1={18.7} x2={21} y2={18.7} stroke={c.stroke} strokeWidth={1.5} />
      <Line x1={13.8} y1={21.4} x2={20.2} y2={21.4} stroke={c.stroke} strokeWidth={1.5} />
    </>
  ),
  fence: (c) => (
    <>
      <Rect
        x={7}
        y={11}
        width={4.6}
        height={16}
        rx={2}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.8}
      />
      <Rect
        x={14.7}
        y={11}
        width={4.6}
        height={16}
        rx={2}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.8}
      />
      <Rect
        x={22.4}
        y={11}
        width={4.6}
        height={16}
        rx={2}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.8}
      />
      <Line x1={4.5} y1={16.5} x2={29.5} y2={16.5} stroke={c.stroke} strokeWidth={2} />
      <Line x1={4.5} y1={22.5} x2={29.5} y2={22.5} stroke={c.stroke} strokeWidth={2} />
    </>
  ),
};

export const hasObjectIcon = (id: string): boolean => id in OBJECT_ICONS;

export function ObjectIcon({
  id,
  size,
  colors = SCENE_COLORS,
}: {
  id: string;
  size: number;
  colors?: ObjectIconColors;
}) {
  const draw = OBJECT_ICONS[id];
  if (!draw) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 34 34">
      {draw(colors)}
    </Svg>
  );
}
