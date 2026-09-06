import { ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { projectMomentum, springs } from '../motion';

// Свайп от левого края возвращает назад — как у системного push-перехода.
// Экран, въехавший справа, обязан выезжать пальцем, а не только кнопкой.
//
// Жест повешен на весь экран, но берёт только касания, начавшиеся у самой
// кромки: тапы и вертикальный скролл проходят сквозь него нетронутыми.

/** Насколько близко к кромке должно начаться касание */
const EDGE_WIDTH = 32;

export function useEdgeBack(active: boolean, onBack: () => void) {
  const { width } = useWindowDimensions();
  const raw = useSharedValue(0);
  const x = useSharedValue(0);
  // Экран уехал пальцем — exiting-анимацию при размонтировании не играем:
  // она стартует от позиции вёрстки и мигнула бы экраном обратно
  const [dragDismissed, setDragDismissed] = useState(false);
  const backRef = useRef(onBack);
  backRef.current = onBack;

  // Новое открытие — с чистого листа: прошлый уход не должен оставить экран
  // сдвинутым за кадр
  useEffect(() => {
    if (!active) return;
    setDragDismissed(false);
    raw.value = 0;
    x.value = 0;
  }, [active, raw, x]);

  const finish = () => {
    setDragDismissed(true);
    requestAnimationFrame(() => backRef.current());
  };

  const gesture = Gesture.Pan()
    .enabled(active)
    .onTouchesDown((e, mgr) => {
      const t = e.allTouches[0];
      if (!t || t.absoluteX > EDGE_WIDTH) mgr.fail();
    })
    .activeOffsetX(10)
    .failOffsetY([-14, 14])
    .onBegin(() => {
      raw.value = x.value;
      cancelAnimation(x);
    })
    .onChange((e) => {
      raw.value += e.changeX;
      x.value = Math.max(0, raw.value);
    })
    .onEnd((e) => {
      // Направление решает знак скорости, порог — проекция импульса
      const projected = raw.value + projectMomentum(e.velocityX);
      raw.value = 0;
      if (e.velocityX < 0 || projected < width * 0.4) {
        x.value = withSpring(0, { ...springs.nav, velocity: e.velocityX });
      } else {
        x.value = withSpring(
          width,
          { ...springs.nav, dampingRatio: 1, velocity: e.velocityX },
          (done) => {
            if (done) runOnJS(finish)();
          },
        );
      }
    });

  const screenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return { gesture, screenStyle, dragDismissed };
}

/** Слой-обёртка вложенного экрана: и контент, и зона свайпа разом. */
export function EdgeBackLayer({ gesture, children }: { gesture: PanGesture; children: ReactNode }) {
  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
