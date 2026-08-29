import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { palettes, Palette, useTheme } from '../../theme';
import { PressableScale } from '../../components/PressableScale';
import { FONTS } from '../../components/typography';
import { useAdminState, type AuditEntry, type AuditFilter } from '../../components/AdminState';

// Журнал действий. Инструмент разбора инцидента, а не ежедневная вкладка,
// поэтому открывается слоем из сводки (и из карточки заявки — уже с
// фильтром по ней). Записи в нём без персональных данных по построению —
// показывать можно всё как есть.

/** Человеческие подписи частых действий; остальное показывается кодом. */
const ACTION_LABELS: Record<string, string> = {
  'order.created': 'Заявка создана',
  'order.master_selected': 'Клиент выбрал мастера',
  'order.finished': 'Мастер сдал работу',
  'order.confirmed': 'Клиент подтвердил',
  'order.cancelled': 'Заявка отменена',
  'order.reopened': 'Заявка вернулась в поиск',
  'order.force_closed': 'Закрыта модерацией',
  'order.force_cancelled': 'Отменена модерацией',
  'order.contacts_shared': 'Телефоны открыты сторонам',
  'master.applied': 'Анкета подана',
  'master.approved': 'Анкета одобрена',
  'master.rejected': 'Анкета отклонена',
  'master.blocked': 'Мастер отстранён',
  'master.unblocked': 'Мастер восстановлен',
  'user.blocked': 'Клиент заблокирован',
  'user.unblocked': 'Клиент разблокирован',
  'review.created': 'Оставлен отзыв',
  'review.hidden': 'Отзыв скрыт',
  'review.unhidden': 'Отзыв возвращён',
  'complaint.created': 'Подана жалоба',
  'complaint.resolved': 'Жалоба закрыта',
  'admin.user_lookup': 'Поиск по телефону',
  'dashboard.updated': 'Дашборд пересчитан',
};

const ACTION_FILTERS: { action: string | null; label: string }[] = [
  { action: null, label: 'все' },
  { action: 'master.approved', label: 'одобрения' },
  { action: 'master.rejected', label: 'отказы' },
  { action: 'order.force_cancelled', label: 'отмены модерацией' },
  { action: 'user.blocked', label: 'блокировки' },
  { action: 'review.hidden', label: 'скрытия отзывов' },
  { action: 'complaint.resolved', label: 'жалобы' },
];

const timeLabel = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function AuditList({ entries }: { entries: AuditEntry[] }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  return (
    <View>
      {entries.map((e) => (
        <View key={e.id} style={styles.entryRow}>
          <View style={styles.entryTop}>
            <Text style={styles.entryAction}>{ACTION_LABELS[e.action] ?? e.action}</Text>
            {e.atMs != null && <Text style={styles.entryTime}>{timeLabel(e.atMs)}</Text>}
          </View>
          <Text style={styles.entryMeta}>
            {[
              e.actorType === 'admin'
                ? 'модератор'
                : e.actorType === 'system'
                  ? 'система'
                  : `пользователь ${e.actorUid?.slice(0, 6) ?? ''}…`,
              `${e.subjectType} ${e.subjectId.slice(0, 8)}…`,
            ].join(' · ')}
          </Text>
          {Object.keys(e.details).length > 0 && (
            <Text style={styles.entryDetails} numberOfLines={2}>
              {Object.entries(e.details)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(' · ')}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

export function AuditLayer({
  subject,
  onBack,
}: {
  /** Фильтр по субъекту — из карточки заявки или мастера */
  subject?: { type: string; id: string };
  onBack: () => void;
}) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const { loadAudit } = useAdminState();
  const [action, setAction] = useState<string | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(false);

  const filter: AuditFilter = subject ? { subject } : action ? { action } : {};

  const load = useCallback(
    async (reset: boolean, after?: unknown) => {
      setLoading(true);
      const page = await loadAudit(filter, after);
      setEntries((prev) => (reset ? page.entries : prev.concat(page.entries)));
      setCursor(page.cursor);
      setLoading(false);
    },
    // filter собирается на месте — зависимость по его составляющим
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadAudit, action, subject?.type, subject?.id],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  return (
    <View style={styles.fill}>
      <View style={styles.layerBar}>
        <PressableScale style={styles.backChip} onPress={onBack}>
          <Text style={styles.backText}>‹ Назад</Text>
        </PressableScale>
      </View>
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <Text style={styles.header}>Журнал действий</Text>

        {!subject && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
            {ACTION_FILTERS.map((f) => {
              const active = action === f.action;
              return (
                <PressableScale
                  key={f.label}
                  style={[styles.chip, active && styles.chipOn]}
                  onPress={() => setAction(f.action)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextOn]}>{f.label}</Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        )}

        {entries.length === 0 && !loading && (
          <Animated.Text entering={FadeIn.duration(300)} style={styles.empty}>
            Записей нет
          </Animated.Text>
        )}

        <AuditList entries={entries} />

        {cursor !== null && (
          <PressableScale
            style={[styles.moreBtn, loading && styles.btnDim]}
            onPress={() => load(false, cursor)}
            disabled={loading}
          >
            <Text style={styles.moreBtnText}>{loading ? 'Загружаем…' : 'Показать ещё'}</Text>
          </PressableScale>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    fill: { flex: 1, backgroundColor: t.bg },
    layerBar: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 54, paddingBottom: 6 },
    backChip: { paddingVertical: 8, paddingHorizontal: 10 },
    backText: { color: t.accent, fontWeight: '800', fontSize: 13 },
    content: { padding: 16, paddingBottom: 60 },
    header: { fontSize: 20, fontFamily: FONTS.display, color: t.text, marginBottom: 12 },
    chipsScroll: { marginBottom: 12, flexGrow: 0 },
    chip: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.soft,
      paddingHorizontal: 10,
      paddingVertical: 7,
      marginRight: 6,
    },
    chipOn: { borderColor: t.accentBorder, backgroundColor: t.accentSoft },
    chipText: { fontSize: 11.5, fontWeight: '700', color: t.textMuted },
    chipTextOn: { color: t.accent },
    empty: { fontSize: 12.5, fontWeight: '600', color: t.textMuted },
    entryRow: {
      backgroundColor: t.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      padding: 12,
      marginBottom: 8,
    },
    entryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    entryAction: { fontSize: 12.5, fontWeight: '800', color: t.text, flex: 1 },
    entryTime: { fontSize: 11, fontWeight: '600', color: t.textMuted },
    entryMeta: { fontSize: 11, fontWeight: '600', color: t.textMuted, marginTop: 3 },
    entryDetails: { fontSize: 10.5, fontWeight: '600', color: t.textSoft, marginTop: 5 },
    moreBtn: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 4,
    },
    moreBtnText: { color: t.accent, fontWeight: '800', fontSize: 13 },
    btnDim: { opacity: 0.6 },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
