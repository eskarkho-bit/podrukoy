import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { springs, STAGGER } from '../motion';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from '../components/PressableScale';

type Props = {
  name: string;
  onChangeName: (name: string) => void;
  email: string;
  address: string;
  ordersTotal: number;
  ordersActive: number;
  onContactSupport: () => void;
  // Вход в режим мастера (перед ним — обязательная авторизация)
  onOpenMaster: () => void;
};

export function ProfileScreen({
  name, onChangeName, email, address, ordersTotal, ordersActive, onContactSupport, onOpenMaster,
}: Props) {
  const { mode, setMode } = useTheme();
  const styles = themed[mode];
  const [pushOn, setPushOn] = useState(true);
  const [emailOn, setEmailOn] = useState(false);
  // Редактирование имени прямо в карточке — без отдельного экрана
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const startEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  const saveName = () => {
    const trimmed = draft.trim();
    if (trimmed) onChangeName(trimmed);
    setEditing(false);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Animated.Text entering={FadeInDown.duration(420)} style={styles.header}>
        Профиль
      </Animated.Text>

      <Animated.View entering={FadeInDown.delay(80).duration(360)} style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarIcon}>👤</Text>
        </View>

        {editing ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.nameEditRow}>
            <TextInput
              style={styles.nameInput}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              onSubmitEditing={saveName}
              onBlur={saveName}
              returnKeyType="done"
            />
          </Animated.View>
        ) : (
          <PressableScale style={styles.nameRow} onPress={startEdit}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.namePencil}>✎</Text>
          </PressableScale>
        )}

        <Text style={styles.email}>{email}</Text>
        <Text style={styles.address}>{address}</Text>
      </Animated.View>

      {/* Живая статистика: считается по реальным заказам */}
      <Animated.View entering={FadeInDown.delay(120).duration(360)} style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{ordersTotal}</Text>
          <Text style={styles.statLabel}>всего заказов</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, ordersActive > 0 && styles.statValueActive]}>
            {ordersActive}
          </Text>
          <Text style={styles.statLabel}>активных</Text>
        </View>
      </Animated.View>

      {/* Вход в раздел для мастеров — за ним экран авторизации */}
      <Animated.View entering={FadeInDown.delay(140).duration(360)}>
        <PressableScale style={styles.masterCard} onPress={onOpenMaster}>
          <View style={styles.masterIconWrap}>
            <Text style={styles.masterIcon}>🛠️</Text>
          </View>
          <View style={styles.masterBody}>
            <Text style={styles.masterTitle}>Я мастер</Text>
            <Text style={styles.masterSub}>Заказы рядом, отклики и чат с клиентами</Text>
          </View>
          <Text style={styles.masterChevron}>›</Text>
        </PressableScale>
      </Animated.View>

      <Animated.Text
        entering={FadeInDown.delay(160).duration(360)}
        style={styles.sectionTitle}
      >
        Настройки
      </Animated.Text>

      <Animated.View
        entering={FadeInDown.delay(160 + STAGGER).duration(340)}
        style={styles.row}
      >
        <Text style={styles.rowLabel}>Тёмная тема</Text>
        <Toggle
          value={mode === 'dark'}
          onChange={(v) => setMode(v ? 'dark' : 'light')}
        />
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160 + STAGGER * 2).duration(340)}
        style={styles.row}
      >
        <Text style={styles.rowLabel}>Push-уведомления</Text>
        <Toggle value={pushOn} onChange={setPushOn} />
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160 + STAGGER * 3).duration(340)}
        style={styles.row}
      >
        <Text style={styles.rowLabel}>Email-уведомления</Text>
        <Toggle value={emailOn} onChange={setEmailOn} />
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160 + STAGGER * 4).duration(340)}
        style={styles.row}
      >
        <Text style={styles.rowLabel}>Мой адрес</Text>
        <Text style={styles.rowValue}>{address}</Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(160 + STAGGER * 5).duration(340)}>
        <PressableScale style={styles.row} onPress={onContactSupport}>
          <Text style={styles.rowLabel}>Написать в поддержку</Text>
          <Text style={styles.rowChevron}>›</Text>
        </PressableScale>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160 + STAGGER * 6).duration(340)}
        style={styles.row}
      >
        <Text style={styles.rowLabel}>О приложении</Text>
        <Text style={styles.rowValue}>Подрукой · v1.0.0</Text>
      </Animated.View>
    </ScrollView>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(value ? t.accent : t.toggleOff, { duration: 200 }),
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withSpring(value ? 18 : 2, springs.micro) }],
  }));

  return (
    <PressableScale style={styles.toggleHit} onPress={() => onChange(!value)}>
      <Animated.View style={[styles.toggleTrack, trackStyle]}>
        <Animated.View style={[styles.toggleKnob, knobStyle]} />
      </Animated.View>
    </PressableScale>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, paddingTop: 60, paddingBottom: 120 },
  header: { fontSize: 20, fontWeight: '800', marginBottom: 16, color: t.text },
  card: {
    backgroundColor: t.card,
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.border,
    marginBottom: 12,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarIcon: { fontSize: 28 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontWeight: '800', fontSize: 16.5, color: t.text },
  namePencil: { fontSize: 13, color: t.textMuted },
  nameEditRow: { alignSelf: 'stretch', alignItems: 'center' },
  nameInput: {
    borderWidth: 1,
    borderColor: t.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    fontSize: 15,
    fontWeight: '800',
    color: t.text,
    textAlign: 'center',
    minWidth: 160,
    backgroundColor: t.inputBg,
  },
  email: { fontWeight: '600', fontSize: 12.5, color: t.textSoft, marginTop: 5 },
  address: { color: t.textMuted, fontWeight: '600', fontSize: 12, marginTop: 3 },
  statsRow: { flexDirection: 'row', gap: 9, marginBottom: 22 },
  statCard: {
    flex: 1,
    backgroundColor: t.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    paddingVertical: 14,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: t.text },
  statValueActive: { color: t.warn },
  statLabel: { fontSize: 11, fontWeight: '700', color: t.textMuted, marginTop: 2 },
  masterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.accentSoft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.accentBorder,
    padding: 14,
    marginBottom: 22,
  },
  masterIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  masterIcon: { fontSize: 20 },
  masterBody: { flex: 1 },
  masterTitle: { fontWeight: '800', fontSize: 14, color: t.text },
  masterSub: { color: t.accent, fontWeight: '600', fontSize: 11.5, marginTop: 2 },
  masterChevron: { fontSize: 18, color: t.accent, fontWeight: '700', marginLeft: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10, color: t.text },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: t.card,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: t.border,
  },
  rowLabel: { fontWeight: '700', fontSize: 13.5, color: t.text },
  rowValue: { fontWeight: '600', fontSize: 12, color: t.textMuted },
  rowChevron: { fontSize: 18, color: t.textMuted, fontWeight: '700' },
  toggleHit: { padding: 2 },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 2,
    justifyContent: 'center',
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    shadowColor: t.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
