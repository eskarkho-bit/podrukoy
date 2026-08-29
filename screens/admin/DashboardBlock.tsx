import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { palettes, Palette, useTheme } from '../../theme';
import { TABULAR } from '../../components/typography';
import { counted } from '../../components/format';
import type { DashboardData } from '../../components/AdminState';

// Витрина дашборда. Все числа считает сервер раз в сутки и кладёт в
// stats/dashboard — здесь только отображение готового документа, никаких
// собственных запросов. Пока документа нет (функции не развёрнуты или ещё
// не было ночного прогона), об этом говорится честно, а не нулями.

const BAR_DAYS = 14;

/** «≈ 45 мин» либо «≈ 3 ч» — точнее для решений модератора и не нужно. */
export function minutesText(min: number): string {
  if (min < 90) return `≈ ${min} мин`;
  return `≈ ${Math.round(min / 60)} ч`;
}

export function DashboardBlock({ dashboard }: { dashboard: DashboardData | null }) {
  const { mode } = useTheme();
  const styles = themed[mode];

  if (!dashboard) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Дашборд</Text>
        <Text style={styles.hint}>
          Появится после первого ночного пересчёта на сервере — для него нужны развёрнутые функции
        </Text>
      </View>
    );
  }

  const days = dashboard.days.slice(-BAR_DAYS);
  const maxCreated = Math.max(1, ...days.map((d) => d.created));
  const createdTotal = days.reduce((acc, d) => acc + d.created, 0);
  const { total, picked } = dashboard.conversion30d;
  const conversion = total > 0 ? Math.round((picked / total) * 100) : null;
  const t7 = dashboard.timeToFirstOffer7d;
  const week = dashboard.weeks[dashboard.weeks.length - 1];

  return (
    <Animated.View entering={FadeInDown.delay(80).duration(360)} style={styles.wrap}>
      <Text style={styles.title}>Дашборд</Text>

      <View style={styles.tilesRow}>
        <Tile value={String(dashboard.activeMasters)} label="активных мастеров" />
        <Tile value={conversion === null ? '—' : `${conversion}%`} label="выбирают мастера" />
        <Tile
          value={t7.avgMinutes === null ? '—' : minutesText(t7.avgMinutes)}
          label="до первого отклика"
        />
        <Tile
          value={String(t7.withoutOffers)}
          label="без откликов, 7 дней"
          warn={t7.withoutOffers > 0}
        />
      </View>

      <Text style={styles.subTitle}>
        {counted(createdTotal, 'заявка', 'заявки', 'заявок')} за {BAR_DAYS} дней
      </Text>
      <View style={styles.bars}>
        {days.map((d) => (
          <View key={d.date} style={styles.barSlot}>
            <View
              style={[
                styles.bar,
                { height: 5 + (40 * d.created) / maxCreated },
                d.created === 0 && styles.barEmpty,
              ]}
            />
          </View>
        ))}
      </View>

      {week && (
        <Text style={styles.hint}>
          Текущая неделя: {counted(week.created, 'заявка', 'заявки', 'заявок')}, завершено{' '}
          {week.completed}
        </Text>
      )}
    </Animated.View>
  );
}

function Tile({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, TABULAR, warn && styles.tileValueWarn]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      marginBottom: 18,
    },
    title: { fontSize: 11, fontWeight: '800', color: t.textMuted },
    subTitle: { fontSize: 11, fontWeight: '800', color: t.textMuted, marginTop: 16 },
    hint: { fontSize: 11.5, fontWeight: '600', color: t.textMuted, marginTop: 8, lineHeight: 16 },
    tilesRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    tile: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: t.soft,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
    tileValue: { fontSize: 16, fontWeight: '800', color: t.text },
    tileValueWarn: { color: t.warn },
    tileLabel: {
      fontSize: 9.5,
      fontWeight: '700',
      color: t.textMuted,
      marginTop: 3,
      textAlign: 'center',
    },
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: 10, height: 48 },
    barSlot: { flex: 1, alignItems: 'stretch', justifyContent: 'flex-end' },
    bar: { borderRadius: 3, backgroundColor: t.accent },
    barEmpty: { backgroundColor: t.border },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
