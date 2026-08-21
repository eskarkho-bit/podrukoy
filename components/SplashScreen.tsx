import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, G, Mask, Polygon, Rect } from 'react-native-svg';
import { springs } from '../motion';
import { palettes, Palette, useTheme } from '../theme';
import { TOWER_BASE_Y, TOWER_POLYGONS, TOWER_VIEWBOX, TOWER_WINDOWS } from './DomioLogo';

// Анимация запуска. Живёт оверлеем поверх роутера, а не отдельным маршрутом:
// под ней приложение уже смонтировано, и оно видно с первого кадра — сквозь
// окна башни. Окна не нарисованы цветом, а вырезаны маской из фона и корпуса
// разом, поэтому в них с самого начала живёт настоящий экран.
//
// Раскрытие в конце — через верхнее окно: башня раздувается, окно растёт
// вместе с ней и «проглатывает» экран. Никакого второго слоя и стыка экранов.
//
// Хронометраж (мс от запуска):
//   0–800     башня проявляется и вырастает с лёгким перелётом,
//             в окнах уже просвечивает приложение
//   800–1400  название выезжает снизу, с отставанием от знака
//   1400–1800 пауза — бренд можно прочитать
//   1800–2400 башня раздувается, приложение открывается через окно
//
// Все числа — в константах ниже; правится хронометраж только здесь.

const LOGO_IN_MS = 800; // фаза 1: появление знака
const LOGO_FROM_SCALE = 0.7;
const TITLE_DELAY_MS = 800; // фаза 2 стартует, когда знак уже виден
const TITLE_IN_MS = 600;
const TITLE_FROM_SHIFT = 40; // выезд названия снизу, пикселей
const HOLD_MS = 400; // фаза 3: пауза на прочтение
const REVEAL_AT_MS = TITLE_DELAY_MS + TITLE_IN_MS + HOLD_MS; // 1800
const REVEAL_MS = 700; // фаза 4: раскрытие через окно
const LOGO_HEIGHT = 116; // высота башни на экране в покое
// Системное «уменьшение движения»: анимации Reanimated и так схлопнутся в
// прыжок (ReducedMotionConfig в корне), но паузу хронометража держит таймер —
// его тоже сжимаем, чтобы не показывать статичный экран две секунды
const REDUCED_REVEAL_AT_MS = 300;

const AnimatedG = Animated.createAnimatedComponent(G);

type Props = {
  /** Приложение под сплэшем готово к показу — можно открывать «дверь». */
  ready: boolean;
  /** Анимация отыграла — родитель размонтирует оверлей. */
  onDone: () => void;
  title?: string;
  subtitle?: string;
};

export function SplashScreen({
  ready,
  onDone,
  title = 'DOMIO',
  subtitle = 'МАСТЕР ПО ДОМУ',
}: Props) {
  const { mode, colors } = useTheme();
  const styles = themed[mode];
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // Расстановка башни. Точка покоя масштаба — центр верхнего окна: раздуваясь
  // вокруг него, башня держит окно на месте, и экран открывается ровно из
  // середины. Поэтому башня стоит так, чтобы центр окна попал в центр экрана
  // (сама она от этого на пару пикселей выше геометрического центра —
  // на глаз это неразличимо).
  const k = LOGO_HEIGHT / TOWER_VIEWBOX.height; // юниты знака → пиксели
  const door = TOWER_WINDOWS[0];
  const doorCx = (door.x + door.width / 2) * k;
  const doorCy = (door.y + door.height / 2) * k;
  const place = `translate(${width / 2 - doorCx}, ${height / 2 - doorCy}) scale(${k})`;
  // До какого множителя раздуваться, чтобы окно накрыло экран целиком
  const revealScale = Math.max(width / (door.width * k), height / (door.height * k)) * 1.15;

  const towerScale = useSharedValue(LOGO_FROM_SCALE);
  const towerOpacity = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const titleShift = useSharedValue(TITLE_FROM_SHIFT);

  // Фазы 1–2 — сразу при монтировании
  useEffect(() => {
    towerOpacity.value = withTiming(1, {
      duration: LOGO_IN_MS * 0.6,
      easing: Easing.out(Easing.quad),
    });
    // Пружина с небольшим перелётом — тот самый «bounce» в конце
    towerScale.value = withSpring(1, { duration: LOGO_IN_MS, dampingRatio: 0.7 });

    titleOpacity.value = withDelay(
      TITLE_DELAY_MS,
      withTiming(1, { duration: TITLE_IN_MS, easing: Easing.out(Easing.quad) }),
    );
    titleShift.value = withDelay(TITLE_DELAY_MS, withSpring(0, springs.nav));
  }, [towerOpacity, towerScale, titleOpacity, titleShift]);

  // Фаза 4 не привязана к таймеру напрямую: она ждёт и хронометраж, и
  // готовность приложения. Иначе окно открылось бы в экран, который ещё
  // решает, показать вход или главную.
  const [introOver, setIntroOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(
      () => setIntroOver(true),
      reduceMotion ? REDUCED_REVEAL_AT_MS : REVEAL_AT_MS,
    );
    return () => clearTimeout(t);
  }, [reduceMotion]);

  // Раскрытие запускается один раз — хоть по расписанию, хоть пропуском
  const leaving = useRef(false);
  const startReveal = () => {
    // !ready — тем же правилом, что и плановый путь: тап не должен открывать
    // окно в экран, который ещё решает, показать вход или главную
    if (leaving.current || !ready) return;
    leaving.current = true;

    towerScale.value = withTiming(
      revealScale,
      { duration: REVEAL_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
    titleOpacity.value = withTiming(0, { duration: REVEAL_MS * 0.4 });
  };

  useEffect(() => {
    if (introOver && ready) startReveal();
    // startReveal стабилен по смыслу (guard в leaving), в зависимостях не нужен
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introOver, ready]);

  // Один множитель ведёт и башню, и дырки в маске: окна вырезаны из того же
  // трансформа, поэтому разъехаться им не из чего.
  //
  // Центр масштабирования запечён в строку трансформа, а не задан пропом
  // origin: на вебе animatedProps перетирают трансформ целиком, и origin
  // молча пропадает — башня раздувалась бы от левого верхнего угла.
  const cx = width / 2;
  const cy = height / 2;
  const towerProps = useAnimatedProps(() => ({
    transform: `translate(${cx}, ${cy}) scale(${towerScale.value}) translate(${-cx}, ${-cy})`,
    opacity: towerOpacity.value,
  }));
  const holesProps = useAnimatedProps(() => ({
    transform: `translate(${cx}, ${cy}) scale(${towerScale.value}) translate(${-cx}, ${-cy})`,
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleShift.value }],
  }));

  return (
    // Тап в любом месте пропускает ожидание и сразу открывает приложение
    <Pressable style={styles.root} onPress={startReveal} accessibilityLabel="Пропустить заставку">
      {/* Фон и башня — одна группа под одной маской: белое в маске видно,
          чёрные окна — сквозные дырки сразу и в фоне, и в корпусе. Сквозь них
          с первого кадра просвечивает приложение, уже живущее под оверлеем. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <Mask id="splash-windows">
            <Rect x="0" y="0" width={width} height={height} fill="#FFFFFF" />
            <AnimatedG animatedProps={holesProps}>
              <G transform={place}>
                {TOWER_WINDOWS.map((w) => (
                  <Rect key={w.y} {...w} fill="#000000" />
                ))}
              </G>
            </AnimatedG>
          </Mask>
        </Defs>

        <G mask="url(#splash-windows)">
          <Rect x="0" y="0" width={width} height={height} fill={colors.bg} />
          <AnimatedG animatedProps={towerProps}>
            <G transform={place}>
              {TOWER_POLYGONS.map((points) => (
                <Polygon key={points} points={points} fill={colors.accent} />
              ))}
            </G>
          </AnimatedG>
        </G>
      </Svg>

      <View style={styles.content} pointerEvents="none">
        {/* Подпись отмеряется от нижней кромки башни: сама башня стоит не по
            геометрическому центру, а окном в центр экрана */}
        <Animated.View
          style={[
            styles.titleBlock,
            { top: height / 2 + (TOWER_BASE_Y * k - doorCy) + 24 },
            titleStyle,
          ]}
        >
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </Animated.View>
      </View>
    </Pressable>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    // Поверх роутера, но под баннером сбоя — см. порядок в app/_layout.tsx
    root: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
    content: StyleSheet.absoluteFillObject,
    titleBlock: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    title: {
      fontSize: 34,
      fontWeight: '700',
      letterSpacing: 8,
      color: t.text,
      // Разрядка добавляет хвост после последней буквы — сдвигаем к центру
      marginRight: -8,
    },
    subtitle: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 4,
      color: t.textSoft,
      marginTop: 8,
      marginRight: -4,
    },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
