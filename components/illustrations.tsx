import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme';

// Мини-иллюстрации пустых состояний.
//
// Пустой экран — не ошибка, а начало пути, и встречать его должна сценка в
// стиле дома, а не одинокая иконка. Рисунки собраны из той же геометрии и
// цветов темы, поэтому одинаково живут в светлой и тёмной теме.

export type EmptySceneKind = 'orders' | 'messages' | 'history' | 'jobs';

export function EmptyScene({ kind, width = 150 }: { kind: EmptySceneKind; width?: number }) {
  const { colors: t } = useTheme();
  const c = {
    stroke: t.accent,
    fill: t.accentSoft,
    glass: t.blue,
    ground: t.chip,
    warm: t.warn,
  };
  const height = (width / 150) * 100;

  return (
    <Svg width={width} height={height} viewBox="0 0 150 100">
      <Ellipse cx={75} cy={88} rx={52} ry={8} fill={c.ground} />
      {kind === 'orders' && (
        <>
          {/* Домик ждёт первую заявку: свет в окне уже горит */}
          <Rect
            x={48}
            y={44}
            width={54}
            height={44}
            rx={4}
            fill={c.fill}
            stroke={c.stroke}
            strokeWidth={3}
          />
          <Path
            d="M40 47 L75 20 L110 47"
            fill="none"
            stroke={c.stroke}
            strokeWidth={3.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect x={67} y={62} width={16} height={26} rx={2.5} fill={c.glass} />
          <Rect x={54} y={52} width={10} height={10} rx={2} fill={c.warm} />
          <Line
            x1={113}
            y1={87}
            x2={128}
            y2={58}
            stroke={c.stroke}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <Circle cx={131} cy={52} r={7.5} fill={c.fill} stroke={c.stroke} strokeWidth={3.4} />
        </>
      )}
      {kind === 'messages' && (
        <>
          {/* Конверт, из которого вот-вот появится первый ответ */}
          <Rect
            x={42}
            y={38}
            width={66}
            height={46}
            rx={6}
            fill={c.fill}
            stroke={c.stroke}
            strokeWidth={3}
          />
          <Path
            d="M42 44 L75 68 L108 44"
            fill="none"
            stroke={c.stroke}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <Circle cx={116} cy={30} r={10} fill={c.glass} />
          <Circle cx={112.5} cy={30} r={1.6} fill={c.stroke} />
          <Circle cx={119.5} cy={30} r={1.6} fill={c.stroke} />
          <Path d="M124 38 L127 44 L119 41 Z" fill={c.glass} />
        </>
      )}
      {kind === 'history' && (
        <>
          {/* Папка с местом под будущие заказы */}
          <Path
            d="M42 40 a5 5 0 0 1 5 -5 H63 l6 7 H103 a5 5 0 0 1 5 5 V78 a5 5 0 0 1 -5 5 h-56 a5 5 0 0 1 -5 -5 Z"
            fill={c.fill}
            stroke={c.stroke}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <Rect x={52} y={26} width={34} height={9} rx={2} fill={c.glass} />
          <Rect x={92} y={22} width={26} height={9} rx={2} fill={c.glass} opacity={0.7} />
        </>
      )}
      {kind === 'jobs' && (
        <>
          {/* Пустой лоток: заявки появятся здесь сами */}
          <Path
            d="M40 56 H62 a13 13 0 0 0 26 0 H110 V76 a7 7 0 0 1 -7 7 H47 a7 7 0 0 1 -7 -7 Z"
            fill={c.fill}
            stroke={c.stroke}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <Path
            d="M40 56 L49 34 H101 L110 56"
            fill="none"
            stroke={c.stroke}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <Circle cx={122} cy={28} r={2.2} fill={c.glass} />
          <Circle cx={130} cy={40} r={1.8} fill={c.glass} opacity={0.7} />
          <Circle cx={28} cy={34} r={1.8} fill={c.glass} opacity={0.7} />
        </>
      )}
    </Svg>
  );
}
