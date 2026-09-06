import { useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { projectMomentum, rubberband, springs } from '../motion';
import { palettes, Palette, useTheme } from '../theme';

// Шторку тянут пальцем сверху вниз — рука тянется к этому раньше, чем глаз
// находит кнопку закрытия.
//
// Жест висит только на «ручке», а не на всей карточке: внутри шторки есть
// поле ввода и ряды выбора, и Pan поверх них отбирал бы у них касания.
//
// Отпущенный палец не обрывает движение, а передаёт его: пружина стартует
// с его скоростью, направление решает знак скорости, а порог сравнивается
// с проекцией импульса — куда жест долетел бы сам.

/** Дальше этой точки покоя спроецированный жест считается закрытием */
const CLOSE_DISTANCE = 90;
/** Вверх шторке некуда: палец встречает нарастающее сопротивление */
const UP_RANGE = 480;
const UP_RESIST = 0.16;

export function useSheetDrag(onClose: () => void, enabled = true) {
  const { height } = useWindowDimensions();
  // Смещение пальца без сопротивления. Резина — функция расстояния, а не
  // приращений: копить её по кусочкам значило бы исказить кривую.
  const raw = useSharedValue(0);
  const dragY = useSharedValue(0);
  // Карточка уехала за край сама — размонтирование не должно проигрывать
  // exiting-анимацию: та стартует от позиции вёрстки, и уже спрятанная
  // карточка мигнула бы обратно на экран
  const [dragDismissed, setDragDismissed] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const finishClose = () => {
    setDragDismissed(true);
    // Кадр между сменой exiting и размонтированием: в одном коммите
    // unmount увидел бы старые пропсы
    requestAnimationFrame(() => closeRef.current());
  };

  const gesture = Gesture.Pan()
    .enabled(enabled)
    // Полоска тонкая, а палец широкий — зона жеста выше видимой ручки
    .hitSlop({ top: 12, bottom: 8 })
    .onBegin(() => {
      // Схватили во время возврата — продолжаем от текущего места, без скачка
      raw.value = dragY.value;
      cancelAnimation(dragY);
    })
    .onChange((e) => {
      raw.value += e.changeY;
      dragY.value = raw.value >= 0 ? raw.value : rubberband(raw.value, UP_RANGE, UP_RESIST);
    })
    .onEnd((e) => {
      const projected = raw.value + projectMomentum(e.velocityY);
      raw.value = 0;
      if (e.velocityY < 0 || projected < CLOSE_DISTANCE) {
        // Передумали — назад с той же скоростью, что была у пальца
        dragY.value = withSpring(0, { ...springs.sheet, velocity: e.velocityY });
      } else {
        // Закрытие продолжает движение пальца, а не начинает своё; за краем
        // перелёт не нужен — гасим полностью
        dragY.value = withSpring(
          height,
          { ...springs.sheet, dampingRatio: 1, velocity: e.velocityY },
          (done) => {
            if (done) runOnJS(finishClose)();
          },
        );
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  return { gesture, cardStyle, dragDismissed };
}

/** Полоска вверху шторки. Она же — область захвата. */
export function SheetGrabber({ gesture }: { gesture: PanGesture }) {
  const { mode } = useTheme();
  const styles = themed[mode];

  return (
    <GestureDetector gesture={gesture}>
      {/* Полоска тонкая, а палец широкий: зона захвата больше того, что видно.
          Отрицательные отступы гасят её собственную высоту, чтобы вёрстка
          шторки осталась прежней. */}
      <View style={styles.zone}>
        <View style={styles.bar} />
      </View>
    </GestureDetector>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    zone: {
      alignItems: 'center',
      paddingVertical: 8,
      marginTop: -8,
      marginBottom: 8,
    },
    bar: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.toggleOff,
    },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
