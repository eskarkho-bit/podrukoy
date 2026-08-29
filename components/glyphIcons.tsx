import { ReactElement } from 'react';
import { StyleProp, Text, TextStyle, ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Rect } from 'react-native-svg';
import type { Palette } from '../theme';
import { OBJECT_ICONS, ObjectIconColors, SCENE_COLORS } from './objectIcons';

// Векторные иконки на месте эмодзи.
//
// Ключ карты — сам эмодзи: данные (деревья услуг, треды, вкладки) продолжают
// хранить строку, а отрисовка подменяет её рисунком в стиле сцены дома.
// Незнакомый эмодзи честно показывается текстом — новый пункт в данных не
// оставит пустой кружок, а лишь вернётся к системному виду до тех пор, пока
// сюда не добавят рисунок.

// Природные цвета — те же, что у деревьев сцены: не зависят от темы
const TRUNK = '#B49B7D';
const LEAF = '#8AA97A';

const GLYPHS: Record<string, (c: ObjectIconColors) => ReactElement> = {
  // ---------- типы работ в дереве услуг ----------
  '⚡': (c) => (
    <Path
      d="M18.5 5 L10 19 H16 L14.5 29 L24 15 H17.5 Z"
      fill={c.fill}
      stroke={c.stroke}
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
  ),
  '💧': (c) => (
    <Path
      d="M17 5.5 C13 11 9.5 15.5 9.5 20 a7.5 7.5 0 0 0 15 0 C24.5 15.5 21 11 17 5.5 Z"
      fill={c.glass}
      stroke={c.stroke}
      strokeWidth={2}
      strokeLinejoin="round"
    />
  ),
  '🛠️': (c) => (
    <>
      <Rect
        x={7}
        y={8}
        width={12}
        height={6.5}
        rx={2}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Line
        x1={16}
        y1={14.5}
        x2={24}
        y2={27}
        stroke={c.stroke}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
    </>
  ),
  '🔄': (c) => (
    <>
      <Path d="M8.5 15 A9 9 0 0 1 24 10" fill="none" stroke={c.stroke} strokeWidth={2} />
      <Path
        d="M24 4.5 V10 H18.5"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path d="M25.5 19 A9 9 0 0 1 10 24" fill="none" stroke={c.stroke} strokeWidth={2} />
      <Path
        d="M10 29.5 V24 H15.5"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </>
  ),
  '🌀': (c) => (
    <Path
      d="M17 15.5 a1.5 1.5 0 0 1 1.5 1.5 a3.5 3.5 0 0 1 -7 0 a5.5 5.5 0 0 1 11 0 a7.5 7.5 0 0 1 -15 0 a9.5 9.5 0 0 1 19 0"
      fill="none"
      stroke={c.stroke}
      strokeWidth={2}
      strokeLinecap="round"
    />
  ),
  '🔒': (c) => (
    <>
      <Path
        d="M12.5 15 V11.5 a4.5 4.5 0 0 1 9 0 V15"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Rect
        x={9}
        y={15}
        width={16}
        height={13}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Circle cx={17} cy={21.5} r={1.7} fill={c.stroke} />
    </>
  ),
  '🌬️': (c) => (
    <>
      <Path
        d="M5 12 H19 A3.2 3.2 0 1 0 15.8 8.5"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M5 17 H24 A3.4 3.4 0 1 1 20.5 21"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path d="M5 22 H15" fill="none" stroke={c.glass} strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  '✂️': (c) => (
    <>
      <Circle cx={9.5} cy={11} r={3} fill="none" stroke={c.stroke} strokeWidth={2} />
      <Circle cx={9.5} cy={23} r={3} fill="none" stroke={c.stroke} strokeWidth={2} />
      <Line
        x1={12}
        y1={13}
        x2={26}
        y2={22.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={12}
        y1={21}
        x2={26}
        y2={11.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  '🌱': (c) => (
    <>
      <Line
        x1={17}
        y1={28}
        x2={17}
        y2={16}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path d="M17 17 C17 11 21 8 26 8 C26 13.5 22.5 17 17 17 Z" fill={LEAF} />
      <Path d="M17 20 C17 16 14 13.5 9.5 13.5 C9.5 17.5 12.5 20 17 20 Z" fill={TRUNK} />
    </>
  ),
  '🪓': (c) => (
    <>
      <Line x1={11} y1={27} x2={22} y2={11} stroke={TRUNK} strokeWidth={3} strokeLinecap="round" />
      <Path
        d="M20 6 L27 13 C24 15 22.5 17.5 22 20 L15.5 13.5 C18 12 19.5 9.5 20 6 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </>
  ),
  '🔧': (c) => (
    <>
      <Line
        x1={9.5}
        y1={24.5}
        x2={17.5}
        y2={16.5}
        stroke={c.stroke}
        strokeWidth={3.4}
        strokeLinecap="round"
      />
      <Circle cx={21.5} cy={12.5} r={5} fill={c.fill} stroke={c.stroke} strokeWidth={2.4} />
      <Line
        x1={24.5}
        y1={8.5}
        x2={28}
        y2={5}
        stroke={c.fill}
        strokeWidth={3.6}
        strokeLinecap="round"
      />
    </>
  ),
  '🔪': (c) => (
    <>
      <Path
        d="M6 20 C10 15.5 16 12.5 24 12 L24 17 C17 18 12 19.5 8.5 22 Z"
        fill={c.glass}
        stroke={c.stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Rect x={24} y={11.6} width={5.4} height={5.6} rx={1.6} fill={c.stroke} />
    </>
  ),
  '📦': (c) => (
    <>
      <Polygon
        points="17,6 27,11 17,16 7,11"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Polygon
        points="7,11 17,16 17,27 7,22"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Polygon
        points="27,11 17,16 17,27 27,22"
        fill={c.glass}
        stroke={c.stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </>
  ),
  '🌡️': (c) => (
    <>
      <Rect
        x={14.8}
        y={5}
        width={4.4}
        height={16}
        rx={2.2}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Circle cx={17} cy={25} r={4.4} fill={c.glass} stroke={c.stroke} strokeWidth={2} />
      <Line
        x1={17}
        y1={13}
        x2={17}
        y2={24}
        stroke={c.glass}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </>
  ),
  '🔊': (c) => (
    <>
      <Polygon
        points="7,14 12,14 17.5,9 17.5,25 12,20 7,20"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M21 13.5 a5 5 0 0 1 0 7"
        fill="none"
        stroke={c.glass}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M24 11 a9 9 0 0 1 0 12"
        fill="none"
        stroke={c.glass}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  '💬': (c) => (
    <>
      <Path
        d="M11 7 H23 A5 5 0 0 1 28 12 V17 A5 5 0 0 1 23 22 H17.5 L12 27 V22 H11 A5 5 0 0 1 6 17 V12 A5 5 0 0 1 11 7 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={12.5} cy={14.5} r={1.3} fill={c.stroke} />
      <Circle cx={17} cy={14.5} r={1.3} fill={c.stroke} />
      <Circle cx={21.5} cy={14.5} r={1.3} fill={c.stroke} />
    </>
  ),
  // ---------- комнаты дома ----------
  '🍳': (c) => (
    <>
      <Circle cx={15} cy={17} r={8} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
      <Circle cx={15} cy={17} r={3} fill={c.glass} />
      <Line
        x1={23}
        y1={17}
        x2={30}
        y2={17}
        stroke={c.stroke}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </>
  ),
  '🛋️': (c) => (
    <>
      <Rect
        x={7}
        y={10}
        width={20}
        height={8}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Rect
        x={5}
        y={17}
        width={24}
        height={7}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Line x1={17} y1={17} x2={17} y2={24} stroke={c.stroke} strokeWidth={1.6} />
      <Line
        x1={8}
        y1={24}
        x2={8}
        y2={27.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={26}
        y1={24}
        x2={26}
        y2={27.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  '🛁': (c) => (
    <>
      <Path
        d="M5 17 H29 V19 a7.5 7.5 0 0 1 -7.5 7.5 h-9 A7.5 7.5 0 0 1 5 19 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path
        d="M23 17 V11 Q23 8.5 19.5 8.5"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Circle cx={19.5} cy={12.5} r={1.3} fill={c.glass} />
    </>
  ),
  '🛏️': (c) => (
    <>
      <Rect
        x={5}
        y={15}
        width={24}
        height={9}
        rx={2.5}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Rect
        x={7.5}
        y={11.5}
        width={7}
        height={5}
        rx={2}
        fill={c.glass}
        stroke={c.stroke}
        strokeWidth={1.8}
      />
      <Line
        x1={7}
        y1={24}
        x2={7}
        y2={27.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={27}
        y1={24}
        x2={27}
        y2={27.5}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  // ---------- вкладки и статусы ----------
  '🧾': (c) => (
    <>
      <Path
        d="M9 5 H25 V26 L22.3 24 L19.6 26 L17 24 L14.4 26 L11.7 24 L9 26 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Line
        x1={12}
        y1={11}
        x2={22}
        y2={11}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Line
        x1={12}
        y1={15}
        x2={22}
        y2={15}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Line
        x1={12}
        y1={19}
        x2={18}
        y2={19}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </>
  ),
  '📊': (c) => (
    <>
      <Rect x={8} y={18} width={4.5} height={8} rx={1} fill={c.glass} />
      <Rect x={14.75} y={12} width={4.5} height={14} rx={1} fill={c.stroke} />
      <Rect x={21.5} y={8} width={4.5} height={18} rx={1} fill={c.glass} />
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
  '🗂️': (c) => (
    <Path
      d="M6 10 a2.5 2.5 0 0 1 2.5 -2.5 H13 l2.5 3 H25.5 A2.5 2.5 0 0 1 28 13 V24 a2.5 2.5 0 0 1 -2.5 2.5 h-17 A2.5 2.5 0 0 1 6 24 Z"
      fill={c.fill}
      stroke={c.stroke}
      strokeWidth={2}
      strokeLinejoin="round"
    />
  ),
  '👤': (c) => (
    <>
      <Circle cx={17} cy={12} r={5} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
      <Path
        d="M7.5 27 a9.5 7.5 0 0 1 19 0 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </>
  ),
  '📨': (c) => (
    <>
      <Rect
        x={6}
        y={9}
        width={22}
        height={16}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Path
        d="M6 11 L17 19 L28 11"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </>
  ),
  '🎉': (c) => (
    <>
      <Path
        d="M8 27 L13.5 13 L21 20.5 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Circle cx={22} cy={9} r={1.5} fill={c.glass} />
      <Circle cx={26.5} cy={14.5} r={1.5} fill={c.glass} />
      <Circle cx={18} cy={7} r={1.3} fill={c.glass} />
      <Path
        d="M22.5 17 q3 -1 5 1"
        fill="none"
        stroke={c.stroke}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Path
        d="M20 12 q0.5 -3 3.5 -4.5"
        fill="none"
        stroke={c.stroke}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </>
  ),
  '⏳': (c) => (
    <>
      <Path
        d="M10 5.5 H24 V9 C24 12.5 20 14.5 18.5 17 C20 19.5 24 21.5 24 25 V28.5 H10 V25 C10 21.5 14 19.5 15.5 17 C14 14.5 10 12.5 10 9 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M13 25.5 h8 l-4 -4.5 Z" fill={c.glass} />
    </>
  ),
  '🚫': (c) => (
    <>
      <Circle cx={17} cy={17} r={10.5} fill="none" stroke={c.stroke} strokeWidth={2.6} />
      <Line
        x1={9.9}
        y1={9.9}
        x2={24.1}
        y2={24.1}
        stroke={c.stroke}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    </>
  ),
  '✅': (c) => (
    <>
      <Circle cx={17} cy={17} r={10.5} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
      <Path
        d="M11.5 17.5 L15.5 21.5 L23 12.5"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  '💰': (c) => (
    <>
      <Circle cx={17} cy={17} r={10.5} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
      <Path
        d="M15 23.5 V10.5 H19 a4 4 0 0 1 0 8 H15"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1={12.5}
        y1={20.5}
        x2={19}
        y2={20.5}
        stroke={c.stroke}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </>
  ),
  '📭': (c) => (
    <>
      <Path
        d="M6 16 H13 a4 4 0 0 0 8 0 H28 V24.5 a3 3 0 0 1 -3 3 H9 a3 3 0 0 1 -3 -3 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path
        d="M6 16 L9.5 8.5 H24.5 L28 16"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </>
  ),
  '🙂': (c) => (
    <>
      <Circle cx={17} cy={17} r={10.5} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
      <Circle cx={13.4} cy={14} r={1.5} fill={c.stroke} />
      <Circle cx={20.6} cy={14} r={1.5} fill={c.stroke} />
      <Path
        d="M12.5 20 a5.5 4.5 0 0 0 9 0"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </>
  ),
  '🛡️': (c) => (
    <>
      <Path
        d="M17 5 C20 7 23.5 8 27 8.3 V17 c0 6.5 -4.5 10.5 -10 12 C11.5 27.5 7 23.5 7 17 V8.3 C10.5 8 14 7 17 5 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path
        d="M12.8 16.5 l3 3 5.5 -6"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  '🏡': (c) => (
    <>
      <Rect
        x={9.5}
        y={14.5}
        width={15}
        height={13}
        rx={1.5}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Path
        d="M6 16 L17 6.5 L28 16"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Rect x={14.8} y={20} width={4.4} height={7.5} rx={1} fill={c.glass} />
    </>
  ),
  '📄': (c) => (
    <>
      <Path
        d="M9 5.5 H20 L25 10.5 V28.5 H9 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path
        d="M20 5.5 V10.5 H25"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Line
        x1={12}
        y1={15}
        x2={22}
        y2={15}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Line
        x1={12}
        y1={19}
        x2={22}
        y2={19}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Line
        x1={12}
        y1={23}
        x2={18}
        y2={23}
        stroke={c.stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </>
  ),
  '📷': (c) => (
    <>
      <Rect
        x={5.5}
        y={10}
        width={23}
        height={16}
        rx={3.5}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Path
        d="M12 10 L13.5 6.5 h7 L22 10"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={17} cy={18} r={5} fill={c.glass} stroke={c.stroke} strokeWidth={2} />
      <Circle cx={25} cy={13.5} r={1.2} fill={c.stroke} />
    </>
  ),
  '🖼️': (c) => (
    <>
      <Rect
        x={6}
        y={7.5}
        width={22}
        height={19}
        rx={2.5}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Circle cx={12.5} cy={13.5} r={2} fill={c.glass} />
      <Path
        d="M8.5 24 L14.5 17 L18.5 21 L22.5 16 L25.5 24"
        fill="none"
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </>
  ),
  '🛟': (c) => (
    <>
      <Circle cx={17} cy={17} r={10.5} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
      <Circle cx={17} cy={17} r={4.5} fill={c.glass} stroke={c.stroke} strokeWidth={2} />
      <Line x1={17} y1={6.5} x2={17} y2={12.5} stroke={c.stroke} strokeWidth={2} />
      <Line x1={17} y1={21.5} x2={17} y2={27.5} stroke={c.stroke} strokeWidth={2} />
      <Line x1={6.5} y1={17} x2={12.5} y2={17} stroke={c.stroke} strokeWidth={2} />
      <Line x1={21.5} y1={17} x2={27.5} y2={17} stroke={c.stroke} strokeWidth={2} />
    </>
  ),
  '🧑‍🔧': (c) => (
    <>
      <Circle cx={17} cy={13} r={5} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
      <Path
        d="M11.8 12 a5.2 4.6 0 0 1 10.4 0 Z"
        fill={c.glass}
        stroke={c.stroke}
        strokeWidth={1.6}
      />
      <Line
        x1={10.5}
        y1={12}
        x2={23.5}
        y2={12}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M7.5 27.5 a9.5 7.5 0 0 1 19 0 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </>
  ),
  '📞': (c) => (
    <Path
      d="M9.5 5.5 C11 5.5 12.5 7 13.5 9.5 C14.3 11.5 14 13 12.8 14.2 L11.8 15.2 C12.6 17.4 16.6 21.4 18.8 22.2 L19.8 21.2 C21 20 22.5 19.7 24.5 20.5 C27 21.5 28.5 23 28.5 24.5 C28.5 26.5 25.5 29 23.5 29 C16 29 5 18 5 10.5 C5 8.5 7.5 5.5 9.5 5.5 Z"
      fill={c.fill}
      stroke={c.stroke}
      strokeWidth={2}
      strokeLinejoin="round"
    />
  ),
  '💳': (c) => (
    <>
      <Rect
        x={4.5}
        y={8.5}
        width={25}
        height={17}
        rx={3}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      <Rect x={4.5} y={12.5} width={25} height={4} fill={c.stroke} />
      <Line
        x1={8.5}
        y1={21}
        x2={15.5}
        y2={21}
        stroke={c.glass}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </>
  ),
  // ---------- эмодзи объектов дома: те же рисунки, что и на сцене ----------
  '💡': OBJECT_ICONS.light,
  '🔌': OBJECT_ICONS.socket,
  '🚰': OBJECT_ICONS.sink,
  '🔥': OBJECT_ICONS.stove,
  '🚿': OBJECT_ICONS.shower,
  '🪟': OBJECT_ICONS.window,
  '🌿': OBJECT_ICONS.lawn,
  '🌳': OBJECT_ICONS.trees,
  '🚪': OBJECT_ICONS.gate,
  '🧰': OBJECT_ICONS.tools,
  '❄️': OBJECT_ICONS.fridge,
  '👕': OBJECT_ICONS.washer,
};

/** Цвета иконок под тему: в тёмной теме зелень сцены на тёмном кружке слепнет. */
export const themedIconColors = (t: Palette): ObjectIconColors => ({
  stroke: t.accent,
  fill: t.accentSoft,
  glass: t.blue,
});

/**
 * Рисунок на месте эмодзи. Неизвестный эмодзи показывается текстом с
 * переданным стилем — как выглядело до векторных иконок.
 */
export function Glyph({
  glyph,
  size,
  colors = SCENE_COLORS,
  style,
  textStyle,
}: {
  glyph: string;
  size: number;
  colors?: ObjectIconColors;
  // Отступы вокруг рисунка: у эмодзи они жили в текстовом стиле
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const draw = GLYPHS[glyph];
  if (!draw) return <Text style={textStyle}>{glyph}</Text>;
  return (
    <Svg width={size} height={size} viewBox="0 0 34 34" style={style}>
      {draw(colors)}
    </Svg>
  );
}
