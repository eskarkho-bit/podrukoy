import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { springs, STAGGER } from '../motion';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from '../components/PressableScale';
import { useAuth } from '../components/AuthState';
import { useAppState } from '../components/AppState';
import { counted } from '../components/format';
import { firestoreErrorText } from '../components/firestoreError';
import { settlementLabel } from '../components/cities';
import { loadAdminStats, MAIN_CITIES, type AdminStats } from '../components/adminStats';
import { db } from '../firebaseConfig';

// Модерация мастеров. Открыта только владельцам документа admins/{uid} —
// завести его можно лишь в консоли Firebase, из приложения нельзя.
//
// Смысл экрана: к клиенту домой едет живой человек, и приложение обязано
// знать, кто это. Пока заявка не одобрена, мастер не видит ни одной заявки.

type Pending = {
  uid: string;
  name: string;
  cities: string[];
  skills: string[];
  phone: string;
  about: string;
  photoUrl: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  /** Когда подана — чтобы видеть, что залежалось */
  appliedMs: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

// Сутки — граница, после которой заявка считается залежавшейся: человек
// ждёт допуска и не может работать
const STALE_MS = 24 * 60 * 60 * 1000;

export function AdminScreen({ open, onClose }: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const { user } = useAuth();
  const { isAdmin, showNotice } = useAppState();
  const [items, setItems] = useState<Pending[]>([]);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  // Сводка не подписка, а разовый запрос: агрегатные запросы Firestore
  // одноразовые, живого счётчика из них не выйдет. Обновляем при открытии
  // раздела и жестом «потянуть вниз».
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Сводка — пять агрегирующих запросов. Функцию закрепляем, иначе она
  // пересоздавалась бы каждую отрисовку и эффект считал бы всё заново.
  const refreshStats = useCallback(async () => {
    setRefreshing(true);
    try {
      setStats(await loadAdminStats());
    } catch (e) {
      console.warn('Сводка недоступна:', e);
      showNotice(firestoreErrorText(e, 'Не удалось посчитать сводку'));
    }
    setRefreshing(false);
  }, [showNotice]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    refreshStats();
  }, [open, isAdmin, refreshStats]);

  // Оверлей выезжает справа. Значения ведём из эффекта, а не изнутри стиля:
  // экран перерисовывается на каждом изменении очереди, и анимация в стиле
  // начиналась бы заново с текущего места.
  const shown = useSharedValue(open ? 1 : 0);
  const slide = useSharedValue(open ? 0 : 60);
  useEffect(() => {
    shown.value = withTiming(open ? 1 : 0, { duration: 260 });
    slide.value = withSpring(open ? 0 : 60, springs.nav);
  }, [open, shown, slide]);
  const layerStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateX: slide.value }],
  }));

  // Стаггер положен первой пачке — она представляет очередь целиком. Заявка,
  // приехавшая из подписки позже, должна появляться сразу: ей незачем ждать
  // очереди по своему номеру в списке.
  const listShown = useRef(false);
  const firstBatch = !listShown.current;
  if (items.length) listShown.current = true;

  // Очередь: заявки во всех анкетах сразу, поэтому запрос по группе коллекций
  useEffect(() => {
    if (!open || !isAdmin) return;
    return onSnapshot(
      query(collectionGroup(db, 'verification'), where('status', '==', 'pending')),
      async (snap) => {
        // Имя, город и специальности лежат в самой анкете, а не в заявке:
        // дублировать их незачем, а модератору они нужны
        const rows = await Promise.all(snap.docs.map(async (d) => {
          const uid = d.ref.parent.parent?.id;
          if (!uid) return null;
          const v = d.data();
          const profile = await getDoc(doc(db, 'masters', uid)).catch(() => null);
          return {
            uid,
            name: String(profile?.get('name') ?? 'Без имени'),
            cities: Array.isArray(profile?.get('cities'))
              ? profile.get('cities')
              : (profile?.get('city') ? [String(profile.get('city'))] : []),
            skills: Array.isArray(profile?.get('skills')) ? profile.get('skills') : [],
            phone: String(v.phone ?? ''),
            about: String(v.about ?? ''),
            photoUrl: typeof v.photoUrl === 'string' ? v.photoUrl : null,
            cardLast4: typeof v.cardLast4 === 'string' ? v.cardLast4 : null,
            cardBrand: typeof v.cardBrand === 'string' ? v.cardBrand : null,
            appliedMs: v.appliedAt?.toMillis?.() ?? null,
          } as Pending;
        }));
        setItems(rows.filter((r): r is Pending => r !== null));
      },
      (e) => console.warn('Очередь модерации недоступна:', e),
    );
  }, [open, isAdmin]);

  // Одобрение — два документа одним пакетом: флаг доступа и вердикт по заявке.
  // Порознь они могли бы разъехаться, и мастер остался бы «одобренным» без
  // доступа или наоборот.
  const decide = async (uid: string, approved: boolean, reason: string) => {
    if (!user) return;
    setBusyUid(uid);
    try {
      const batch = writeBatch(db);
      if (approved) {
        batch.update(doc(db, 'masters', uid), { verified: true });
      }
      batch.update(doc(db, 'masters', uid, 'verification', 'application'), {
        status: approved ? 'approved' : 'rejected',
        rejectionReason: approved ? null : reason.trim() || 'Причина не указана',
        reviewedAt: serverTimestamp(),
        reviewedBy: user.uid,
      });
      await batch.commit();
    } catch (e) {
      console.warn('Не удалось вынести решение:', e);
      showNotice(firestoreErrorText(e, 'Не удалось сохранить решение'));
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, layerStyle]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      <View style={styles.topBar}>
        <PressableScale style={styles.backChip} onPress={onClose}>
          <Text style={styles.backText}>‹  Профиль</Text>
        </PressableScale>
        <View style={styles.backChipGhost} />
      </View>

      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshStats} tintColor={t.accent} />
        }
      >
        <Animated.Text entering={FadeInDown.duration(420)} style={styles.header}>
          Модерация
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(40).duration(380)} style={styles.headerSub}>
          {items.length
            ? counted(items.length, 'заявка ждёт', 'заявки ждут', 'заявок ждут') + ' решения'
            : 'Новые заявки мастеров появятся здесь'}
        </Animated.Text>

        {stats && (
          <StatsBlock
            stats={stats}
            stale={items.filter(
              (i) => i.appliedMs != null && Date.now() - i.appliedMs > STALE_MS,
            ).length}
          />
        )}

        {items.map((item, i) => (
          <Animated.View
            key={item.uid}
            entering={FadeInDown.delay(firstBatch ? 80 + i * STAGGER : 0).duration(360)}
            exiting={FadeOut.duration(180)}
            layout={LinearTransition.springify().damping(20).stiffness(170)}
          >
            <PendingCard
              item={item}
              busy={busyUid === item.uid}
              onDecide={(approved, reason) => decide(item.uid, approved, reason)}
            />
          </Animated.View>
        ))}

        {items.length === 0 && (
          <Animated.View entering={FadeIn.delay(120).duration(400)} style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>Очередь пуста</Text>
          </Animated.View>
        )}
      </ScrollView>
    </Animated.View>
  );
}

// Сводка: что происходит с мастерами и где в республике пусто.
//
// Заявок клиентов здесь нет намеренно — модератор их не читает. Считать их
// он сможет, когда развернутся функции: они будут вести счётчики на сервере,
// и модератор увидит числа, не получив доступа к адресам.
function StatsBlock({ stats, stale }: { stats: AdminStats; stale: number }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const { coverage } = stats;
  const covered = new Set(coverage.coveredKeys);

  return (
    <Animated.View entering={FadeInDown.delay(60).duration(360)} style={styles.stats}>
      <View style={styles.statsRow}>
        <Stat value={stats.verified} label="проверено" tone="ok" />
        <Stat value={stats.pending} label="ждут решения" tone={stats.pending ? 'warn' : 'plain'} />
        <Stat value={stats.rejected} label="отклонено" tone="plain" />
        <Stat value={stats.masters} label="всего анкет" tone="plain" />
      </View>

      {stale > 0 && (
        <Text style={styles.statsAlert}>
          {counted(stale, 'заявка ждёт', 'заявки ждут', 'заявок ждут')} дольше суток
        </Text>
      )}

      <Text style={styles.statsTitle}>Покрытие</Text>

      {coverage.anyEverywhere ? (
        <Text style={styles.statsLine}>
          Есть мастера, готовые выезжать по всей республике
        </Text>
      ) : (
        <Text style={styles.statsLine}>
          Мастера есть в {coverage.coveredSettlements} из {coverage.totalSettlements}
          {' '}населённых пунктов
        </Text>
      )}

      <View style={styles.chipsWrap}>
        {MAIN_CITIES.map((c) => {
          const has = coverage.anyEverywhere || covered.has(c.key);
          return (
            <View key={c.key} style={[styles.cityChip, has && styles.cityChipOk]}>
              <Text style={[styles.cityChipText, has && styles.cityChipTextOk]}>
                {has ? '✓ ' : '— '}{c.name}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Пустая специальность — это заявки, на которые некому откликнуться */}
      {coverage.missingCategories.length > 0 && (
        <Text style={styles.statsAlert}>
          Нет мастеров: {coverage.missingCategories.join(', ')}
        </Text>
      )}
    </Animated.View>
  );
}

function Stat({
  value, label, tone,
}: {
  value: number;
  label: string;
  tone: 'ok' | 'warn' | 'plain';
}) {
  const { mode } = useTheme();
  const styles = themed[mode];
  return (
    <View style={styles.statCard}>
      <Text style={[
        styles.statValue,
        tone === 'ok' && styles.statValueOk,
        tone === 'warn' && styles.statValueWarn,
      ]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const waitedLong = (appliedMs: number) => Date.now() - appliedMs > STALE_MS;

/** Сколько заявка лежит без решения. Человек в это время работать не может. */
function waitedText(appliedMs: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - appliedMs) / 60000));
  if (minutes < 60) return counted(minutes, 'минуту', 'минуты', 'минут');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return counted(hours, 'час', 'часа', 'часов');
  return counted(Math.floor(hours / 24), 'день', 'дня', 'дней');
}

function PendingCard({
  item, busy, onDecide,
}: {
  item: Pending;
  busy: boolean;
  onDecide: (approved: boolean, reason: string) => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  // Отказ без причины бесполезен: мастер не поймёт, что исправлять
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  // Карта обязательна, но требовать её до отправки нельзя — иначе заявку не
  // подать, пока не настроен провайдер. Поэтому решение здесь, и допуск без
  // карты требует второго касания: случайно так не одобришь.
  const [confirmNoCard, setConfirmNoCard] = useState(false);
  const cardMissing = !item.cardLast4;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        {item.photoUrl ? (
          <Image source={{ uri: item.photoUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoEmpty]}>
            <Text style={styles.photoIcon}>🙂</Text>
          </View>
        )}
        <View style={styles.cardWho}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.meta}>
            {item.cities.length
              ? item.cities.map(settlementLabel).join(', ')
              : 'вся республика'}
          </Text>
          <Text style={styles.meta}>{item.phone || 'телефон не указан'}</Text>
          {item.appliedMs != null && (
            <Text style={[styles.meta, waitedLong(item.appliedMs) && styles.metaBad]}>
              ждёт {waitedText(item.appliedMs)}
            </Text>
          )}
          <Text style={[styles.meta, item.cardLast4 ? styles.metaOk : styles.metaBad]}>
            {item.cardLast4
              ? `карта ${item.cardBrand ?? ''} •••• ${item.cardLast4}`
              : 'карта не привязана'}
          </Text>
        </View>
      </View>

      {item.skills.length > 0 && (
        <Text style={styles.skills}>{item.skills.join(' · ')}</Text>
      )}

      {item.about ? <Text style={styles.about}>{item.about}</Text> : null}

      {rejecting ? (
        <View style={styles.rejectBox}>
          <TextInput
            style={styles.reasonInput}
            value={reason}
            onChangeText={setReason}
            placeholder="Что не так — мастер это увидит"
            placeholderTextColor={t.textMuted}
            multiline
            maxLength={300}
            autoFocus
          />
          <View style={styles.row}>
            <PressableScale
              style={[styles.btn, styles.btnReject, busy && styles.btnDim]}
              onPress={() => onDecide(false, reason)}
              disabled={busy}
            >
              <Text style={styles.btnRejectText}>Отказать</Text>
            </PressableScale>
            <PressableScale
              style={[styles.btn, styles.btnGhost]}
              onPress={() => setRejecting(false)}
              disabled={busy}
            >
              <Text style={styles.btnGhostText}>Отмена</Text>
            </PressableScale>
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <PressableScale
            style={[
              styles.btn,
              styles.btnApprove,
              confirmNoCard && styles.btnApproveWarn,
              busy && styles.btnDim,
            ]}
            onPress={() => {
              if (cardMissing && !confirmNoCard) {
                setConfirmNoCard(true);
                return;
              }
              onDecide(true, '');
            }}
            disabled={busy}
          >
            <Text style={styles.btnApproveText}>
              {busy
                ? 'Сохраняем…'
                : confirmNoCard
                  ? 'Допустить без карты?'
                  : '✓  Допустить'}
            </Text>
          </PressableScale>
          <PressableScale
            style={[styles.btn, styles.btnGhost]}
            onPress={() => (confirmNoCard ? setConfirmNoCard(false) : setRejecting(true))}
            disabled={busy}
          >
            <Text style={styles.btnGhostText}>
              {confirmNoCard ? 'Отмена' : 'Отказать'}
            </Text>
          </PressableScale>
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  root: { backgroundColor: t.bg },
  fill: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 54,
    paddingBottom: 6,
  },
  backChip: { paddingVertical: 8, paddingHorizontal: 10 },
  backChipGhost: { width: 60 },
  backText: { color: t.accent, fontWeight: '800', fontSize: 13 },
  content: { padding: 16, paddingBottom: 60 },
  header: { fontSize: 20, fontWeight: '800', color: t.text },
  headerSub: { color: t.textMuted, fontWeight: '600', fontSize: 12, marginTop: 2, marginBottom: 18 },
  stats: {
    backgroundColor: t.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.border,
    padding: 14,
    marginBottom: 18,
  },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: t.soft,
    borderRadius: 14,
    paddingVertical: 12,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: t.text },
  statValueOk: { color: t.accent },
  statValueWarn: { color: t.warn },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: t.textMuted,
    marginTop: 3,
    textAlign: 'center',
  },
  statsAlert: { fontSize: 12, fontWeight: '700', color: t.warn, marginTop: 12, lineHeight: 17 },
  statsTitle: { fontSize: 11, fontWeight: '800', color: t.textMuted, marginTop: 16 },
  statsLine: { fontSize: 12.5, fontWeight: '600', color: t.text, marginTop: 6, lineHeight: 17 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  cityChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.soft,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  cityChipOk: { borderColor: t.accentBorder, backgroundColor: t.accentSoft },
  cityChipText: { fontSize: 11.5, fontWeight: '700', color: t.textMuted },
  cityChipTextOk: { color: t.accent },
  card: {
    backgroundColor: t.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.border,
    padding: 14,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', gap: 12 },
  photo: { width: 82, height: 82, borderRadius: 14, backgroundColor: t.chip },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoIcon: { fontSize: 32 },
  cardWho: { flex: 1 },
  name: { fontSize: 15, fontWeight: '800', color: t.text },
  meta: { fontSize: 12, fontWeight: '600', color: t.textMuted, marginTop: 3 },
  metaOk: { color: t.accent, fontWeight: '700' },
  metaBad: { color: t.danger, fontWeight: '700' },
  skills: { fontSize: 12, fontWeight: '700', color: t.textSoft, marginTop: 10 },
  about: { fontSize: 12.5, fontWeight: '600', color: t.text, lineHeight: 17, marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  btnDim: { opacity: 0.6 },
  btnApprove: { backgroundColor: t.accent },
  btnApproveWarn: { backgroundColor: t.warn },
  btnApproveText: { color: t.onAccent, fontWeight: '800', fontSize: 13.5 },
  btnReject: { backgroundColor: t.danger },
  btnRejectText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13.5 },
  btnGhost: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
  btnGhostText: { color: t.textMuted, fontWeight: '800', fontSize: 13.5 },
  rejectBox: { marginTop: 12 },
  reasonInput: {
    borderWidth: 1,
    borderColor: t.inputBorder,
    borderRadius: 12,
    backgroundColor: t.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12.5,
    fontWeight: '600',
    color: t.text,
    minHeight: 58,
    textAlignVertical: 'top',
  },
  emptyWrap: { alignItems: 'center', paddingVertical: 50 },
  emptyIcon: { fontSize: 36, marginBottom: 10 },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: t.textMuted },
});

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
