import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../theme';

// Одноразовый залп конфетти для «Клиент выбрал вас».
//
// Десять частиц с заранее заданными траекториями — без Math.random, чтобы
// повторный рендер не перерисовывал залп по-новому. Играет один раз при
// появлении карточки; при «уменьшении движения» не показывается вовсе.

// x — горизонтальный снос, r — вращение, d — задержка, s — размер
const PARTICLES = [
  { x: -72, r: 200, d: 0, s: 6 },
  { x: -48, r: -160, d: 40, s: 5 },
  { x: -26, r: 240, d: 10, s: 7 },
  { x: -8, r: -120, d: 70, s: 5 },
  { x: 10, r: 180, d: 30, s: 6 },
  { x: 30, r: -220, d: 0, s: 5 },
  { x: 52, r: 140, d: 60, s: 7 },
  { x: 70, r: -180, d: 20, s: 5 },
  { x: -60, r: 120, d: 90, s: 4 },
  { x: 62, r: -140, d: 90, s: 4 },
];

export function ConfettiBurst() {
  const reduceMotion = useReducedMotion();
  const { colors: t } = useTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) });
  }, [progress, reduceMotion]);

  if (reduceMotion) return null;
  const palette = [t.accent, t.warn, t.blue, t.accentStrong];

  return (
    <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {PARTICLES.map((p, i) => (
        <Particle key={i} {...p} color={palette[i % palette.length]} progress={progress} />
      ))}
    </Animated.View>
  );
}

function Particle({
  x,
  r,
  d,
  s,
  color,
  progress,
}: (typeof PARTICLES)[number] & {
  color: string;
  progress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const pRaw = progress.value - d / 1100;
    const p = pRaw < 0 ? 0 : pRaw;
    return {
      opacity: p === 0 ? 0 : 1 - p,
      transform: [
        { translateX: x * p },
        // Вверх и в стороны, затем вниз — простая парабола
        { translateY: -70 * p + 120 * p * p },
        { rotate: `${r * p}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        { width: s, height: s * 1.7, backgroundColor: color, borderRadius: s / 2 },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  particle: { position: 'absolute', top: 16, left: '50%' },
});
