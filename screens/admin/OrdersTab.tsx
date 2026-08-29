import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
  SlideInRight,
  SlideOutRight,
} from 'react-native-reanimated';
import { palettes, Palette, useTheme } from '../../theme';
import { PressableScale } from '../../components/PressableScale';
import { FONTS, TABULAR } from '../../components/typography';
import { Glyph, themedIconColors } from '../../components/glyphIcons';
import { counted, rub } from '../../components/format';
import { dayLabel } from '../../components/masterStats';
import { settlementLabel } from '../../components/cities';
import { CATEGORIES } from '../../components/serviceOptions';
import {
  useAdminState,
  type AdminOrder,
  type AdminOrderCard as OrderCardData,
  type OrdersFilter,
} from '../../components/AdminState';

// Заявки в модерации: список с фильтрами и карточка для разбора спора.
//
// Модератор здесь только читает; единственные записи — принудительное
// закрытие и отмена, и обе идут через сервер с обязательной причиной.
// «Поиск» — точный переход по id заявки: полнотекстового поиска у Firestore
// нет, а id модератору приносит журнал или скриншот клиента.

const ORDER_STATUSES = [
  'Поиск мастера',
  'В работе',
  'Ждёт подтверждения',
  'Завершена',
  'Отменена',
] as const;

const PERIODS: { days: number | null; label: string }[] = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: null, label: 'всё время' },
];

/** Чипы фильтров. Выбор повторный снимает фильтр. */
export function OrderFilters({
  filter,
  onChange,
}: {
  filter: OrdersFilter;
  onChange: (f: OrdersFilter) => void;
}) {
  const { mode } = useTheme();
  const styles = themed[mode];
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
        {ORDER_STATUSES.map((s) => {
          const active = filter.status === s;
          return (
            <PressableScale
              key={s}
              style={[styles.chip, active && styles.chipOn]}
              onPress={() => onChange({ ...filter, status: active ? null : s })}
            >
              <Text style={[styles.chipText, active && styles.chipTextOn]}>{s}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
        {CATEGORIES.map((c) => {
          const active = filter.category === c;
          return (
            <PressableScale
              key={c}
              style={[styles.chip, active && styles.chipOn]}
              onPress={() => onChange({ ...filter, category: active ? null : c })}
            >
              <Text style={[styles.chipText, active && styles.chipTextOn]}>{c}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
      <View style={styles.periodRow}>
        {PERIODS.map((p) => {
          const active = filter.days === p.days;
          return (
            <PressableScale
              key={p.label}
              style={[styles.chip, active && styles.chipOn]}
              onPress={() => onChange({ ...filter, days: p.days })}
            >
              <Text style={[styles.chipText, active && styles.chipTextOn]}>{p.label}</Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Карточка заявки: полный контекст спора и принудительное закрытие.
 * Причина обязательна — кнопка не активна, пока поле пустое.
 */
export function OrderAdminCard({
  card,
  busy,
  onClose,
  onShowHistory,
}: {
  card: OrderCardData;
  busy: boolean;
  onClose: (outcome: 'Отменена' | 'Завершена', reason: string) => void;
  onShowHistory: () => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const { order } = card;
  // Какой исход готовится: раскрытое поле причины — и есть второй шаг
  const [closing, setClosing] = useState<'Отменена' | 'Завершена' | null>(null);
  const [reason, setReason] = useState('');
  const closed = order.status === 'Завершена' || order.status === 'Отменена';

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{order.title}</Text>
      <Text style={styles.cardMeta}>
        {[
          order.status,
          settlementLabel(order.city),
          order.category,
          order.createdMs != null ? dayLabel(order.createdMs) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text style={styles.cardLine}>
        Клиент: {order.clientName || '—'} · Мастер: {order.masterName ?? 'не выбран'}
        {order.agreedPrice != null ? ` · ${rub(order.agreedPrice)}` : ''}
      </Text>
      {!!order.address && <Text style={styles.cardLine}>Адрес: {order.address}</Text>}
      {!!order.comment && <Text style={styles.cardComment}>{order.comment}</Text>}
      {order.photoUrl && <Image source={{ uri: order.photoUrl }} style={styles.cardPhoto} />}

      {order.closedByAdmin && (
        <Text style={styles.closedByAdmin}>
          Закрыта модерацией{order.adminCloseReason ? `: ${order.adminCloseReason}` : ''}
        </Text>
      )}

      {card.offers.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>
            {counted(card.offers.length, 'предложение', 'предложения', 'предложений')}
          </Text>
          {card.offers.map((o) => (
            <View key={o.masterId} style={styles.offerRow}>
              <Text style={styles.offerName}>
                {o.masterName}
                {o.status === 'accepted' ? ' · выбран' : ''}
              </Text>
              <Text style={[styles.offerPrice, TABULAR]}>{rub(o.price)}</Text>
            </View>
          ))}
        </>
      )}

      {card.messages.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Переписка</Text>
          {card.messages.map((m) => (
            <Text key={m.id} style={styles.messageLine}>
              <Text style={styles.messageWho}>
                {m.senderId === order.clientId ? 'Клиент: ' : 'Мастер: '}
              </Text>
              {m.text}
            </Text>
          ))}
        </>
      )}

      <PressableScale style={styles.historyRow} onPress={onShowHistory}>
        <Text style={styles.historyText}>Журнал заявки ›</Text>
      </PressableScale>

      {!closed && closing === null && (
        <View style={styles.row}>
          <PressableScale
            style={[styles.btn, styles.btnDanger, busy && styles.btnDim]}
            onPress={() => setClosing('Отменена')}
            disabled={busy}
          >
            <Text style={styles.btnDangerText}>Отменить принудительно</Text>
          </PressableScale>
          <PressableScale
            style={[styles.btn, styles.btnGhost, busy && styles.btnDim]}
            onPress={() => setClosing('Завершена')}
            disabled={busy}
          >
            <Text style={styles.btnGhostText}>Закрыть как выполненную</Text>
          </PressableScale>
        </View>
      )}

      {!closed && closing !== null && (
        <View style={styles.reasonBox}>
          <TextInput
            style={styles.reasonInput}
            value={reason}
            onChangeText={setReason}
            placeholder="Причина — её увидят обе стороны"
            placeholderTextColor={t.textMuted}
            multiline
            maxLength={300}
            autoFocus
          />
          <View style={styles.row}>
            <PressableScale
              style={[styles.btn, styles.btnDanger, (!reason.trim() || busy) && styles.btnDim]}
              onPress={() => onClose(closing, reason.trim())}
              disabled={!reason.trim() || busy}
            >
              <Text style={styles.btnDangerText}>
                {busy
                  ? 'Сохраняем…'
                  : closing === 'Отменена'
                    ? 'Отменить заявку'
                    : 'Закрыть заявку'}
              </Text>
            </PressableScale>
            <PressableScale
              style={[styles.btn, styles.btnGhost]}
              onPress={() => setClosing(null)}
              disabled={busy}
            >
              <Text style={styles.btnGhostText}>Передумал</Text>
            </PressableScale>
          </View>
        </View>
      )}
    </View>
  );
}

export function OrdersTab({ onShowHistory }: { onShowHistory: (orderId: string) => void }) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const {
    orders,
    ordersFilter,
    ordersExhausted,
    ordersLoading,
    setOrdersFilter,
    loadMoreOrders,
    openOrderById,
    watchOrder,
    closeOrder,
  } = useAdminState();

  const [searchId, setSearchId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [card, setCard] = useState<OrderCardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Карточка живая: спор разбирают, пока стороны продолжают действовать
  useEffect(() => {
    if (!openId) {
      setCard(null);
      return;
    }
    return watchOrder(openId, setCard);
  }, [openId, watchOrder]);

  const search = async () => {
    const id = searchId.trim();
    if (!id) return;
    const found = await openOrderById(id);
    setNotFound(!found);
    if (found) setOpenId(found.id);
  };

  const close = async (outcome: 'Отменена' | 'Завершена', reason: string) => {
    setBusy(true);
    await closeOrder(openId ?? '', outcome, reason);
    setBusy(false);
  };

  return (
    <View style={styles.fill}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <Animated.Text entering={FadeInDown.duration(420)} style={styles.header}>
          Заявки
        </Animated.Text>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={searchId}
            onChangeText={(v) => {
              setSearchId(v);
              setNotFound(false);
            }}
            placeholder="ID заявки — точный переход"
            placeholderTextColor={t.textMuted}
            autoCapitalize="none"
            onSubmitEditing={search}
          />
          <PressableScale style={styles.searchBtn} onPress={search}>
            <Text style={styles.searchBtnText}>Найти</Text>
          </PressableScale>
        </View>
        {notFound && <Text style={styles.notFound}>Заявка с таким id не найдена</Text>}

        <OrderFilters filter={ordersFilter} onChange={setOrdersFilter} />

        {orders.map((o) => (
          <Animated.View key={o.id} entering={FadeIn.duration(240)} layout={LinearTransition}>
            <OrderRow order={o} onPress={() => setOpenId(o.id)} />
          </Animated.View>
        ))}

        {orders.length === 0 && !ordersLoading && (
          <Animated.View entering={FadeIn.delay(120).duration(400)} style={styles.emptyWrap}>
            <Glyph glyph="🧾" size={42} colors={themedIconColors(t)} />
            <Text style={styles.emptyTitle}>По этим фильтрам заявок нет</Text>
          </Animated.View>
        )}

        {!ordersExhausted && orders.length > 0 && (
          <PressableScale
            style={[styles.moreBtn, ordersLoading && styles.btnDim]}
            onPress={loadMoreOrders}
            disabled={ordersLoading}
          >
            <Text style={styles.moreBtnText}>{ordersLoading ? 'Загружаем…' : 'Показать ещё'}</Text>
          </PressableScale>
        )}
      </ScrollView>

      {openId && card && (
        <Animated.View
          entering={SlideInRight.springify().damping(20).stiffness(160)}
          exiting={SlideOutRight.duration(280)}
          style={[StyleSheet.absoluteFill, styles.layer]}
        >
          <View style={styles.layerBar}>
            <PressableScale style={styles.backChip} onPress={() => setOpenId(null)}>
              <Text style={styles.backText}>‹ Заявки</Text>
            </PressableScale>
          </View>
          <ScrollView contentContainerStyle={styles.layerContent}>
            <OrderAdminCard
              card={card}
              busy={busy}
              onClose={close}
              onShowHistory={() => onShowHistory(card.order.id)}
            />
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

function OrderRow({ order, onPress }: { order: AdminOrder; onPress: () => void }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  return (
    <PressableScale style={styles.orderRow} onPress={onPress}>
      <View style={styles.orderBody}>
        <Text style={styles.orderTitle} numberOfLines={1}>
          {order.title}
        </Text>
        <Text style={styles.orderMeta} numberOfLines={1}>
          {[
            order.status,
            order.category,
            order.createdMs != null ? dayLabel(order.createdMs) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {order.agreedPrice != null && (
        <Text style={[styles.orderPrice, TABULAR]}>{rub(order.agreedPrice)}</Text>
      )}
    </PressableScale>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    content: { padding: 16, paddingBottom: 130 },
    header: { fontSize: 20, fontFamily: FONTS.display, color: t.text, marginBottom: 12 },
    searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    searchInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      backgroundColor: t.inputBg,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 12.5,
      fontWeight: '600',
      color: t.text,
    },
    searchBtn: {
      borderRadius: 12,
      backgroundColor: t.accent,
      paddingHorizontal: 14,
      justifyContent: 'center',
    },
    searchBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 12.5 },
    notFound: { fontSize: 12, fontWeight: '700', color: t.warn, marginBottom: 8 },
    chipsScroll: { marginBottom: 8, flexGrow: 0 },
    periodRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
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
    orderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: t.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 13,
      marginBottom: 8,
    },
    orderBody: { flex: 1 },
    orderTitle: { fontSize: 13.5, fontWeight: '800', color: t.text },
    orderMeta: { fontSize: 11.5, fontWeight: '600', color: t.textMuted, marginTop: 3 },
    orderPrice: { fontSize: 13, fontWeight: '800', color: t.text },
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
    emptyWrap: { alignItems: 'center', paddingVertical: 50, gap: 10 },
    emptyTitle: { fontSize: 14, fontWeight: '800', color: t.textMuted },
    layer: { backgroundColor: t.bg },
    layerBar: {
      flexDirection: 'row',
      paddingHorizontal: 14,
      paddingTop: 54,
      paddingBottom: 6,
    },
    backChip: { paddingVertical: 8, paddingHorizontal: 10 },
    backText: { color: t.accent, fontWeight: '800', fontSize: 13 },
    layerContent: { padding: 16, paddingBottom: 60 },
    card: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
    },
    cardTitle: { fontSize: 16, fontFamily: FONTS.heading, color: t.text },
    cardMeta: { fontSize: 11.5, fontWeight: '700', color: t.textMuted, marginTop: 4 },
    cardLine: { fontSize: 12.5, fontWeight: '600', color: t.text, marginTop: 8, lineHeight: 17 },
    cardComment: {
      fontSize: 12.5,
      fontWeight: '600',
      color: t.textSoft,
      marginTop: 8,
      lineHeight: 17,
    },
    cardPhoto: { width: '100%', height: 180, borderRadius: 12, marginTop: 10 },
    closedByAdmin: {
      fontSize: 12,
      fontWeight: '700',
      color: t.warn,
      marginTop: 10,
      lineHeight: 17,
    },
    sectionTitle: { fontSize: 11, fontWeight: '800', color: t.textMuted, marginTop: 14 },
    offerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 8,
    },
    offerName: { fontSize: 12.5, fontWeight: '700', color: t.text },
    offerPrice: { fontSize: 12.5, fontWeight: '800', color: t.text },
    messageLine: { fontSize: 12, fontWeight: '600', color: t.text, marginTop: 6, lineHeight: 17 },
    messageWho: { color: t.textMuted, fontWeight: '800' },
    historyRow: { marginTop: 14, paddingVertical: 6 },
    historyText: { fontSize: 12.5, fontWeight: '800', color: t.accent },
    row: { flexDirection: 'row', gap: 8, marginTop: 12 },
    btn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
    btnDim: { opacity: 0.6 },
    btnDanger: { backgroundColor: t.danger },
    btnDangerText: {
      color: '#FFFFFF',
      fontWeight: '800',
      fontSize: 12.5,
      textAlign: 'center',
    },
    btnGhost: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
    btnGhostText: { color: t.textMuted, fontWeight: '800', fontSize: 12.5, textAlign: 'center' },
    reasonBox: { marginTop: 12 },
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
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
