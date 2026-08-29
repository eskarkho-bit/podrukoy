import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { palettes, Palette, space, useTheme } from '../theme';
import { FONTS } from './typography';
import { Glyph, themedIconColors } from './glyphIcons';
import { PressableScale } from './PressableScale';

// «Как мы проверяем мастеров» — главное отличие сервиса, показанное клиенту.
//
// Сама проверка построена в архитектуре давно, но жила невидимой: клиент
// узнавал о ней разве что из слова «проверенный». Этот оверлей открывается с
// бейджа на предложении мастера и из профиля — ровно в те моменты, когда
// человек решает, пускать ли незнакомца в дом.

const STEPS: { glyph: string; title: string; text: string }[] = [
  {
    glyph: '📷',
    title: 'Фото вживую',
    text: 'Снимок лица делается камерой прямо при заполнении анкеты — выбрать чужое фото из галереи нельзя. Смотрит его живой человек, а не алгоритм.',
  },
  {
    glyph: '📞',
    title: 'Телефон',
    text: 'Настоящий номер мастера: по нему мы связываемся, если что-то не сходится.',
  },
  {
    glyph: '💳',
    title: 'Банковская карта',
    text: 'Банк уже проверил личность владельца карты — привязка подтверждает, что за анкетой стоит реальный человек.',
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function VerificationExplainer({ open, onClose }: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  if (!open) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(180)}
        style={StyleSheet.absoluteFill}
      >
        <BlurView
          intensity={26}
          tint={mode === 'dark' ? 'dark' : 'light'}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onClose} />
      </Animated.View>

      <Animated.View entering={ZoomIn.springify().damping(18).stiffness(180)} style={styles.card}>
        <View style={styles.badge}>
          <Glyph glyph="🛡️" size={30} colors={themedIconColors(t)} />
        </View>
        <Text style={styles.title}>Мы знаем каждого мастера в лицо</Text>
        <Text style={styles.sub}>
          Доступ к заявкам получают только мастера, прошедшие проверку вручную
        </Text>

        {STEPS.map((s) => (
          <View key={s.glyph} style={styles.step}>
            <View style={styles.stepIcon}>
              <Glyph glyph={s.glyph} size={22} colors={themedIconColors(t)} />
            </View>
            <View style={styles.stepBody}>
              <Text style={styles.stepTitle}>{s.title}</Text>
              <Text style={styles.stepText}>{s.text}</Text>
            </View>
          </View>
        ))}

        <PressableScale style={styles.okBtn} onPress={onClose}>
          <Text style={styles.okText}>Понятно</Text>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: { justifyContent: 'center', padding: space.lg, zIndex: 30 },
    dim: { backgroundColor: t.dim },
    card: {
      backgroundColor: t.card,
      borderRadius: 24,
      padding: space.xl,
      shadowColor: t.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    badge: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginBottom: space.md,
    },
    title: {
      fontSize: 17,
      fontFamily: FONTS.display,
      color: t.text,
      textAlign: 'center',
    },
    sub: {
      fontSize: 12.5,
      fontWeight: '600',
      color: t.textSoft,
      textAlign: 'center',
      lineHeight: 17,
      marginTop: space.xs,
      marginBottom: space.lg,
    },
    step: { flexDirection: 'row', gap: space.md, marginBottom: space.lg },
    stepIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepBody: { flex: 1 },
    stepTitle: { fontSize: 13.5, fontFamily: FONTS.heading, color: t.text },
    stepText: {
      fontSize: 12,
      fontWeight: '600',
      color: t.textSoft,
      lineHeight: 16.5,
      marginTop: 2,
    },
    okBtn: {
      borderRadius: 14,
      paddingVertical: space.md,
      alignItems: 'center',
      backgroundColor: t.accent,
      marginTop: space.xs,
    },
    okText: { color: t.onAccent, fontWeight: '800', fontSize: 13.5 },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
