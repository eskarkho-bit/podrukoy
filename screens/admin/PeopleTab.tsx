import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { palettes, Palette, useTheme } from '../../theme';
import { PressableScale } from '../../components/PressableScale';
import { FONTS } from '../../components/typography';
import { Glyph, themedIconColors } from '../../components/glyphIcons';
import { counted, ratingText, rub } from '../../components/format';
import { dayLabel } from '../../components/masterStats';
import {
  useAdminState,
  type AdminUserCard as UserCardData,
  type FoundUser,
} from '../../components/AdminState';

// Люди: поиск по телефону и карточка с блокировкой.
//
// Поиск идёт через сервер — там телефон ищется и в Auth, и в профилях, и в
// анкетах мастеров, а в журнале остаётся только хэш номера. Блокировка тоже
// серверная: у неё есть побочные шаги (снять предложения, уведомить), и её
// след обязан попасть в журнал.

/** Строка результата поиска. */
export function FoundRow({ found, onPress }: { found: FoundUser; onPress: () => void }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const blocked = found.userBlocked || found.masterBlocked;
  return (
    <PressableScale style={styles.foundRow} onPress={onPress}>
      <View style={styles.foundBody}>
        <Text style={styles.foundName}>
          {found.name || `Без имени · ${found.uid.slice(0, 6)}…`}
        </Text>
        <Text style={styles.foundMeta}>
          {[
            found.isMaster ? (found.verified ? 'мастер, проверен' : 'мастер') : 'клиент',
            blocked ? 'заблокирован' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {blocked && <Text style={styles.blockedBadge}>блок</Text>}
    </PressableScale>
  );
}

/**
 * Карточка человека. Блокировка требует причину: кнопка не активна, пока
 * поле пустое. Скрытие отзыва — так же.
 */
export function UserCard({
  uid,
  card,
  busy,
  onBlockUser,
  onBlockMaster,
  onHideReview,
}: {
  uid: string;
  card: UserCardData;
  busy: boolean;
  onBlockUser: (blocked: boolean, reason: string) => void;
  onBlockMaster: (blocked: boolean, reason: string) => void;
  onHideReview: (masterId: string, orderId: string, hidden: boolean, reason: string) => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  // Какая форма причины раскрыта: блокировка клиента, мастера или отзыв
  const [reasonFor, setReasonFor] = useState<null | 'user' | 'master' | `review:${string}`>(null);
  const [reason, setReason] = useState('');

  const openReason = (target: typeof reasonFor) => {
    setReasonFor(target);
    setReason('');
  };

  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {card.profile.name || card.master.name || `Без имени · ${uid.slice(0, 6)}…`}
        </Text>
        <Text style={styles.cardMeta}>
          {[card.profile.phone || null, card.profile.city || null].filter(Boolean).join(' · ') ||
            'профиль пуст'}
        </Text>

        {card.profile.blocked && (
          <Text style={styles.blockedLine}>
            Клиент заблокирован{card.profile.blockedReason ? `: ${card.profile.blockedReason}` : ''}
          </Text>
        )}

        {card.profile.exists && (
          <View style={styles.row}>
            {card.profile.blocked ? (
              <PressableScale
                style={[styles.btn, styles.btnGhost, busy && styles.btnDim]}
                onPress={() => onBlockUser(false, '')}
                disabled={busy}
              >
                <Text style={styles.btnGhostText}>Разблокировать клиента</Text>
              </PressableScale>
            ) : (
              <PressableScale
                style={[styles.btn, styles.btnDanger, busy && styles.btnDim]}
                onPress={() => openReason('user')}
                disabled={busy}
              >
                <Text style={styles.btnDangerText}>Заблокировать клиента</Text>
              </PressableScale>
            )}
          </View>
        )}

        {card.master.exists && (
          <>
            <Text style={styles.sectionTitle}>Мастер</Text>
            <Text style={styles.cardLine}>
              {[
                card.master.verified ? 'проверен' : 'не проверен',
                card.master.rating != null
                  ? `★ ${ratingText(card.master.rating)} · ${counted(
                      card.master.reviewsCount,
                      'отзыв',
                      'отзыва',
                      'отзывов',
                    )}`
                  : 'без отзывов',
                counted(card.master.completedOrders, 'заказ', 'заказа', 'заказов'),
              ].join(' · ')}
            </Text>
            {card.master.blocked && <Text style={styles.blockedLine}>Мастер отстранён</Text>}
            <View style={styles.row}>
              {card.master.blocked ? (
                <PressableScale
                  style={[styles.btn, styles.btnGhost, busy && styles.btnDim]}
                  onPress={() => onBlockMaster(false, '')}
                  disabled={busy}
                >
                  <Text style={styles.btnGhostText}>Вернуть доступ мастеру</Text>
                </PressableScale>
              ) : (
                <PressableScale
                  style={[styles.btn, styles.btnDanger, busy && styles.btnDim]}
                  onPress={() => openReason('master')}
                  disabled={busy}
                >
                  <Text style={styles.btnDangerText}>Отстранить мастера</Text>
                </PressableScale>
              )}
            </View>
          </>
        )}

        {(reasonFor === 'user' || reasonFor === 'master') && (
          <View style={styles.reasonBox}>
            <TextInput
              style={styles.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder="Причина — её увидит заблокированный"
              placeholderTextColor={t.textMuted}
              multiline
              maxLength={300}
              autoFocus
            />
            <View style={styles.row}>
              <PressableScale
                style={[styles.btn, styles.btnDanger, (!reason.trim() || busy) && styles.btnDim]}
                onPress={() => {
                  (reasonFor === 'user' ? onBlockUser : onBlockMaster)(true, reason.trim());
                  setReasonFor(null);
                }}
                disabled={!reason.trim() || busy}
              >
                <Text style={styles.btnDangerText}>Заблокировать</Text>
              </PressableScale>
              <PressableScale
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setReasonFor(null)}
                disabled={busy}
              >
                <Text style={styles.btnGhostText}>Отмена</Text>
              </PressableScale>
            </View>
          </View>
        )}
      </View>

      {card.clientOrders.length > 0 && (
        <>
          <Text style={styles.listTitle}>
            {counted(card.clientOrders.length, 'заявка', 'заявки', 'заявок')} клиента
          </Text>
          {card.clientOrders.map((o) => (
            <View key={o.id} style={styles.miniRow}>
              <Text style={styles.miniTitle} numberOfLines={1}>
                {o.title}
              </Text>
              <Text style={styles.miniMeta}>
                {[o.status, o.createdMs != null ? dayLabel(o.createdMs) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))}
        </>
      )}

      {card.masterOrders.length > 0 && (
        <>
          <Text style={styles.listTitle}>
            {counted(card.masterOrders.length, 'заказ', 'заказа', 'заказов')} мастера
          </Text>
          {card.masterOrders.map((o) => (
            <View key={o.id} style={styles.miniRow}>
              <Text style={styles.miniTitle} numberOfLines={1}>
                {o.title}
              </Text>
              <Text style={styles.miniMeta}>
                {[o.status, o.agreedPrice != null ? rub(o.agreedPrice) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))}
        </>
      )}

      {card.reviews.length > 0 && (
        <>
          <Text style={styles.listTitle}>Отзывы этого человека</Text>
          {card.reviews.map((r) => {
            const key = `review:${r.masterId}:${r.orderId}` as const;
            return (
              <View key={`${r.masterId}-${r.orderId}`} style={styles.miniCard}>
                <Text style={styles.reviewStars}>
                  {'★'.repeat(Math.max(1, Math.min(5, Math.round(r.stars))))}
                  {r.hidden ? '  · скрыт' : ''}
                </Text>
                {!!r.text && <Text style={styles.reviewText}>{r.text}</Text>}
                {reasonFor === key ? (
                  <View style={styles.reasonBox}>
                    <TextInput
                      style={styles.reasonInput}
                      value={reason}
                      onChangeText={setReason}
                      placeholder="Причина скрытия — уйдёт мастеру"
                      placeholderTextColor={t.textMuted}
                      multiline
                      maxLength={300}
                      autoFocus
                    />
                    <View style={styles.row}>
                      <PressableScale
                        style={[
                          styles.btn,
                          styles.btnDanger,
                          (!reason.trim() || busy) && styles.btnDim,
                        ]}
                        onPress={() => {
                          onHideReview(r.masterId, r.orderId, true, reason.trim());
                          setReasonFor(null);
                        }}
                        disabled={!reason.trim() || busy}
                      >
                        <Text style={styles.btnDangerText}>Скрыть отзыв</Text>
                      </PressableScale>
                      <PressableScale
                        style={[styles.btn, styles.btnGhost]}
                        onPress={() => setReasonFor(null)}
                      >
                        <Text style={styles.btnGhostText}>Отмена</Text>
                      </PressableScale>
                    </View>
                  </View>
                ) : (
                  <PressableScale
                    style={styles.reviewAction}
                    onPress={() =>
                      r.hidden ? onHideReview(r.masterId, r.orderId, false, '') : openReason(key)
                    }
                    disabled={busy}
                  >
                    <Text style={styles.reviewActionText}>
                      {r.hidden ? 'Вернуть отзыв' : 'Скрыть отзыв'}
                    </Text>
                  </PressableScale>
                )}
              </View>
            );
          })}
        </>
      )}

      {card.complaints.length > 0 && (
        <>
          <Text style={styles.listTitle}>Жалобы этого человека</Text>
          {card.complaints.map((c) => (
            <View key={c.id} style={styles.miniCard}>
              <Text style={styles.miniMeta}>{c.status}</Text>
              <Text style={styles.reviewText}>{c.text}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

export function PeopleTab() {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const { findByPhone, watchUserCard, setUserBlocked, setMasterBlocked, setReviewHidden } =
    useAdminState();

  const [phone, setPhone] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<FoundUser[] | null>(null);
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [card, setCard] = useState<UserCardData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!openUid) {
      setCard(null);
      return;
    }
    return watchUserCard(openUid, setCard);
  }, [openUid, watchUserCard]);

  const search = async () => {
    if (!phone.trim() || searching) return;
    setSearching(true);
    setResults(await findByPhone(phone.trim()));
    setSearching(false);
  };

  const run = async (action: Promise<boolean>) => {
    setBusy(true);
    await action;
    setBusy(false);
  };

  return (
    <View style={styles.fill}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <Animated.Text entering={FadeInDown.duration(420)} style={styles.header}>
          Люди
        </Animated.Text>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={phone}
            onChangeText={setPhone}
            placeholder="Телефон: +7 928 000-11-22"
            placeholderTextColor={t.textMuted}
            keyboardType="phone-pad"
            onSubmitEditing={search}
          />
          <PressableScale
            style={[styles.searchBtn, searching && styles.btnDim]}
            onPress={search}
            disabled={searching}
          >
            <Text style={styles.searchBtnText}>{searching ? '…' : 'Найти'}</Text>
          </PressableScale>
        </View>

        {results !== null && results.length === 0 && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.emptyWrap}>
            <Glyph glyph="📭" size={42} colors={themedIconColors(t)} />
            <Text style={styles.emptyTitle}>По этому номеру никого нет</Text>
          </Animated.View>
        )}

        {(results ?? []).map((f) => (
          <Animated.View key={f.uid} entering={FadeIn.duration(240)}>
            <FoundRow found={f} onPress={() => setOpenUid(f.uid)} />
          </Animated.View>
        ))}

        {results === null && (
          <Text style={styles.hint}>
            Поиск идёт по номеру из Auth, профиля и анкеты мастера. В журнале остаётся только хэш
            номера.
          </Text>
        )}
      </ScrollView>

      {openUid && card && (
        <Animated.View
          entering={SlideInRight.springify().damping(20).stiffness(160)}
          exiting={SlideOutRight.duration(280)}
          style={[StyleSheet.absoluteFill, styles.layer]}
        >
          <View style={styles.layerBar}>
            <PressableScale style={styles.backChip} onPress={() => setOpenUid(null)}>
              <Text style={styles.backText}>‹ Поиск</Text>
            </PressableScale>
          </View>
          <ScrollView contentContainerStyle={styles.layerContent}>
            <UserCard
              uid={openUid}
              card={card}
              busy={busy}
              onBlockUser={(blocked, reason) => run(setUserBlocked(openUid, blocked, reason))}
              onBlockMaster={(blocked, reason) => run(setMasterBlocked(openUid, blocked, reason))}
              onHideReview={(masterId, orderId, hidden, reason) =>
                run(setReviewHidden(masterId, orderId, hidden, reason))
              }
            />
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    content: { padding: 16, paddingBottom: 130 },
    header: { fontSize: 20, fontFamily: FONTS.display, color: t.text, marginBottom: 12 },
    hint: { fontSize: 11.5, fontWeight: '600', color: t.textMuted, lineHeight: 16, marginTop: 8 },
    searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    searchInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      backgroundColor: t.inputBg,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 13,
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
    foundRow: {
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
    foundBody: { flex: 1 },
    foundName: { fontSize: 13.5, fontWeight: '800', color: t.text },
    foundMeta: { fontSize: 11.5, fontWeight: '600', color: t.textMuted, marginTop: 3 },
    blockedBadge: { fontSize: 11, fontWeight: '800', color: t.danger },
    emptyWrap: { alignItems: 'center', paddingVertical: 40, gap: 10 },
    emptyTitle: { fontSize: 14, fontWeight: '800', color: t.textMuted },
    layer: { backgroundColor: t.bg },
    layerBar: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 54, paddingBottom: 6 },
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
    blockedLine: {
      fontSize: 12,
      fontWeight: '700',
      color: t.danger,
      marginTop: 10,
      lineHeight: 17,
    },
    sectionTitle: { fontSize: 11, fontWeight: '800', color: t.textMuted, marginTop: 14 },
    listTitle: {
      fontSize: 11,
      fontWeight: '800',
      color: t.textMuted,
      marginTop: 18,
      marginBottom: 8,
    },
    miniRow: {
      backgroundColor: t.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      padding: 11,
      marginBottom: 6,
    },
    miniCard: {
      backgroundColor: t.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      padding: 12,
      marginBottom: 8,
    },
    miniTitle: { fontSize: 12.5, fontWeight: '800', color: t.text },
    miniMeta: { fontSize: 11, fontWeight: '600', color: t.textMuted, marginTop: 3 },
    reviewStars: { fontSize: 12, fontWeight: '800', color: t.warn },
    reviewText: { fontSize: 12.5, fontWeight: '600', color: t.text, marginTop: 6, lineHeight: 17 },
    reviewAction: { marginTop: 8 },
    reviewActionText: { fontSize: 12, fontWeight: '800', color: t.accent },
    row: { flexDirection: 'row', gap: 8, marginTop: 12 },
    btn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
    btnDim: { opacity: 0.6 },
    btnDanger: { backgroundColor: t.danger },
    btnDangerText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12.5, textAlign: 'center' },
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
