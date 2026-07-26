import { ReactNode } from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
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
};

// «Физическая» кнопка: при нажатии сжимается до 96%,
// при отпускании чуть «перелетает» до 101% и пружиной садится на 100%.
export function PressableScale({ children, style, onPress, disabled }: Props) {
  const scale = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        scale.value = withTiming(0.96, { duration: 70, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => {
        scale.value = withSequence(
          withTiming(1.01, { duration: 80, easing: Easing.inOut(Easing.quad) }),
          withSpring(1, springs.micro),
        );
      }}
      style={[animated, style]}
    >
      {children}
    </AnimatedPressable>
  );
}
