import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

// Галочка, которая рисуется штрихом, а не просто появляется.
//
// Классический приём с strokeDashoffset: штрих длиной с весь путь сдвигается
// до нуля, и линия «прорисовывается» слева направо. При системном «уменьшении
// движения» галочка показывается сразу целиком.

const APath = Animated.createAnimatedComponent(Path);

// Длина пути галочки в её собственных координатах (замерена по отрезкам)
const DASH = 25;

export function AnimatedCheck({
  size,
  color,
  strokeWidth = 3.2,
}: {
  size: number;
  color: string;
  strokeWidth?: number;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    // Небольшая пауза даёт кружку появиться первым — штрих ложится на готовую сцену
    progress.value = withDelay(
      200,
      withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) }),
    );
  }, [progress, reduceMotion]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: DASH * (1 - progress.value),
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 34 34">
      <APath
        d="M10 18.5 L15.5 24 L26 11.5"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={DASH}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
