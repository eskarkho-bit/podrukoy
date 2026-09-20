import { ReactNode } from 'react';
import {
  AccessibilityRole,
  AccessibilityState,
  Insets,
  Pressable,
  StyleProp,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { springs } from '../motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
  // Скринридеру нужны роль и подпись: без них кнопка с иконкой — просто
  // «группа». Задаются там, где содержимое кнопки не текст.
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  // Состояние переключателя для скринридера
  accessibilityState?: AccessibilityState;
  // Мелким кнопкам зона касания добивается до 44pt слопом, а не размером:
  // видимая часть остаётся компактной, промахнуться — сложнее
  hitSlop?: Insets | number;
};

// «Физическая» кнопка: при нажатии сжимается до 96%, при отпускании садится
// на место одной недодемпфированной пружиной — перелёт даёт сама физика,
// поэтому движение можно перехватить новым нажатием в любой точке.
export function PressableScale({
  children,
  style,
  onPress,
  disabled,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  hitSlop,
}: Props) {
  const scale = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      hitSlop={hitSlop}
      onPress={onPress}
      onPressIn={() => {
        scale.value = withTiming(0.96, { duration: 70, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, springs.pop);
      }}
      style={[animated, style]}
    >
      {children}
    </AnimatedPressable>
  );
}
