import { useEffect } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { Palette, palettes, useTheme } from '../theme';
import { PressableScale } from './PressableScale';

// Плашка о сбое. Появляется сверху, гаснет сама через несколько секунд или
// по нажатию. Нужна затем, что молча не сохранённая заявка выглядит для
// человека точно так же, как сохранённая.
export function NoticeBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { mode } = useTheme();
  const styles = themed[mode];

  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [text, onDismiss]);

  return (
    <Animated.View
      entering={FadeInUp.duration(260)}
      exiting={FadeOutUp.duration(220)}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <PressableScale style={styles.banner} onPress={onDismiss}>
        <Text style={styles.text}>{text}</Text>
        <Text style={styles.hint}>Нажмите, чтобы скрыть</Text>
      </PressableScale>
    </Animated.View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      top: Platform.OS === 'ios' ? 56 : 36,
      left: 16,
      right: 16,
      // Выше сплэша (zIndex 10): сбой при холодном старте важнее заставки,
      // иначе баннер успел бы погаснуть под ней непрочитанным
      zIndex: 20,
    },
    banner: {
      backgroundColor: t.danger,
      borderRadius: 18,
      paddingHorizontal: 16,
      paddingVertical: 13,
      shadowColor: t.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 },
      elevation: 10,
    },
    text: { color: '#FFFFFF', fontWeight: '800', fontSize: 13, lineHeight: 18 },
    hint: { color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 10.5, marginTop: 4 },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
