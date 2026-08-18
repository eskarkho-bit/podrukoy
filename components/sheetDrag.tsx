import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { springs } from '../motion';
import { palettes, Palette, useTheme } from '../theme';

// Шторку тянут пальцем сверху вниз — рука тянется к этому раньше, чем глаз
// находит кнопку закрытия.
//
// Жест висит только на «ручке», а не на всей карточке: внутри шторки есть
// поле ввода и ряды выбора, и Pan поверх них отбирал бы у них касания.

/** Протянули дальше — отпускаем шторку */
const CLOSE_DISTANCE = 90;
/** Или протянули мало, но резко смахнули */
const CLOSE_VELOCITY = 900;

export function useSheetDrag(onClose: () => void, enabled = true) {
  const dragY = useSharedValue(0);

  const gesture = Gesture.Pan()
    .enabled(enabled)
    // Вверх не пускаем: шторка не растягивается, тянуть её туда некуда
    .onChange((e) => {
      dragY.value = Math.max(0, dragY.value + e.changeY);
    })
    .onEnd((e) => {
      if (dragY.value > CLOSE_DISTANCE || e.velocityY > CLOSE_VELOCITY) {
        runOnJS(onClose)();
      } else {
        // Передумали — карточка возвращается на место той же пружиной,
        // которой приехала
        dragY.value = withSpring(0, springs.sheet);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  return { gesture, cardStyle };
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

const makeStyles = (t: Palette) => StyleSheet.create({
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
