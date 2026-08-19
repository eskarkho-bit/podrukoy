import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { springs } from '../motion';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from './PressableScale';

export type TabId = 'orders' | 'messages' | 'profile';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'orders', label: 'Заказы', icon: '🧾' },
  { id: 'messages', label: 'Сообщения', icon: '💬' },
  { id: 'profile', label: 'Профиль', icon: '👤' },
];

type Props = {
  active: TabId;
  onSelect: (tab: TabId) => void;
  // Тихая точка-индикатор непрочитанного — не отвлекает, просто присутствует
  hasUnreadMessages: boolean;
  // Прячется, когда открыт вложенный экран (например, переписка) — как в iOS Messages
  hidden?: boolean;
};

export function BottomTabs({ active, onSelect, hasUnreadMessages, hidden }: Props) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const [barW, setBarW] = useState(0);
  const pillW = barW > 0 ? (barW - 12) / 3 : 0;
  const idx = TABS.findIndex((t) => t.id === active);

  // Анимации запускаются из эффектов, а не изнутри useAnimatedStyle: панель
  // перерисовывается на каждой смене вкладки и на каждом непрочитанном
  // сообщении, и анимация, созданная в стиле, перезапускалась бы на полпути.
  const x = useSharedValue(0);
  const measured = useRef(false);
  useEffect(() => {
    if (pillW <= 0) return;
    // Первое появление — сразу на месте: ширина известна только после замера
    if (measured.current) x.value = withSpring(idx * pillW, springs.card);
    else x.value = idx * pillW;
    measured.current = true;
  }, [idx, pillW, x]);

  const away = useSharedValue(hidden ? 1 : 0);
  useEffect(() => {
    away.value = withTiming(hidden ? 1 : 0, { duration: 220 });
  }, [hidden, away]);
  const shift = useSharedValue(hidden ? 24 : 0);
  useEffect(() => {
    shift.value = withSpring(hidden ? 24 : 0, springs.sheet);
  }, [hidden, shift]);

  const pillStyle = useAnimatedStyle(() => ({
    width: pillW,
    transform: [{ translateX: x.value }],
  }));

  const wrapStyle = useAnimatedStyle(() => ({
    opacity: 1 - away.value,
    transform: [{ translateY: shift.value }],
  }));

  return (
    <Animated.View style={[styles.wrap, wrapStyle]} pointerEvents={hidden ? 'none' : 'auto'}>
      <View style={styles.bar} onLayout={(e) => setBarW(e.nativeEvent.layout.width)}>
        {barW > 0 && <Animated.View style={[styles.pill, pillStyle]} pointerEvents="none" />}
        {TABS.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            selected={tab.id === active}
            showDot={tab.id === 'messages' && hasUnreadMessages && tab.id !== active}
            onPress={() => onSelect(tab.id)}
          />
        ))}
      </View>
    </Animated.View>
  );
}

function TabButton({
  tab, selected, showDot, onPress,
}: {
  tab: { id: TabId; label: string; icon: string };
  selected: boolean;
  showDot: boolean;
  onPress: () => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, { duration: 220 });
  }, [selected, on]);
  const scale = useSharedValue(selected ? 1.08 : 1);
  useEffect(() => {
    scale.value = withSpring(selected ? 1.08 : 1, springs.micro);
  }, [selected, scale]);

  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(on.value, [0, 1], [t.textMuted, t.accentStrong]),
    opacity: 0.85 + 0.15 * on.value,
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <PressableScale style={styles.tab} onPress={onPress}>
      <Animated.View style={iconStyle}>
        <Text style={styles.icon}>{tab.icon}</Text>
        {showDot && <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.dot} />}
      </Animated.View>
      <Animated.Text style={[styles.label, textStyle]}>{tab.label}</Animated.Text>
    </PressableScale>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: Platform.OS === 'ios' ? 28 : 16,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: t.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: 6,
    paddingHorizontal: 6,
    shadowColor: t.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  pill: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    left: 6,
    borderRadius: 16,
    backgroundColor: t.accentSoft,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 16 },
  icon: { fontSize: 19 },
  dot: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: t.warn,
  },
  label: { marginTop: 3, fontSize: 10.5, fontWeight: '700' },
});

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
