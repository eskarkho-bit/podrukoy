import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import { SheetGrabber, useSheetDrag } from './sheetDrag';
import { counted, ratingText, rub } from './format';
import type { Offer, Order } from '../screens/OrdersScreen';

type Props = {
  order: Order;
  onClose: () => void;
  onCancel: () => void;
  // Пользователь подтверждает, что мастер закончил работу
  onConfirmDone: () => void;
  onChat: () => void;
  // Выбор предложения — именно он назначает мастера и делает цену согласованной
  onAcceptOffer: (masterId: string) => void;
  onSubmitReview: (stars: number, text: string) => void;
  // Старые заявки, где предложение лежало в самой заявке
  onAcceptPrice: () => void;
  onDeclinePrice: () => void;
};

const CANCELLABLE = ['Поиск мастера', 'Есть предложения', 'В работе'];

export function statusColor(status: string, t: Palette) {
  if (status === 'В работе') return t.blue;
  if (status === 'Завершена') return t.accent;
  if (status === 'Отменена') return t.textMuted;
  return t.warn; // Поиск мастера, ждёт подтверждения и прочие «ожидающие»
}

// Детали заказа: фото крупно, комментарий, предложения мастеров и действия.
// Отмена — в два касания, чтобы не отменить случайно.
export function OrderSheet({
  order, onClose, onCancel, onConfirmDone, onChat,
  onAcceptOffer, onSubmitReview, onAcceptPrice, onDeclinePrice,
}: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [confirming, setConfirming] = useState(false);
  const { gesture, cardStyle } = useSheetDrag(onClose);

  const offers = (order.offers ?? []).filter((o) => o.status === 'pending');
  // Пока мастер не выбран, заявка собирает предложения
  const collecting = order.status === 'Поиск мастера';
  const agreed = order.agreedPrice != null;
  const awaitingConfirm = order.status === 'Ждёт подтверждения';
  const canReview = order.status === 'Завершена' && !order.reviewed && !!order.masterId;
  const cancellable = CANCELLABLE.includes(order.status);

  // Заявки до появления offers: предложение лежит в самой заявке и
  // показывается по-старому
  const legacyOffer = order.priceStatus === 'offered' && order.price != null;
  const legacyDeclined = order.priceStatus === 'declined' && order.price != null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      <Animated.View
        entering={FadeIn.duration(260)}
        exiting={FadeOut.duration(220)}
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

      <Animated.View
        entering={SlideInDown.springify().damping(19).stiffness(150).mass(1)}
        exiting={SlideOutDown.duration(280)}
        layout={LinearTransition.springify().damping(20).stiffness(170)}
        style={[styles.card, cardStyle]}
      >
        <SheetGrabber gesture={gesture} />

        <Animated.View entering={FadeIn.delay(80).duration(260)} style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{order.title}</Text>
            <Text style={styles.date}>
              Создана {order.date}
              {order.address ? ` · ${order.address}` : ''}
            </Text>
          </View>
          <View style={[styles.statusChip, { borderColor: statusColor(order.status, t) }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor(order.status, t) }]} />
            <Text style={[styles.statusText, { color: statusColor(order.status, t) }]}>
              {order.status}
            </Text>
          </View>
        </Animated.View>

        {order.photoUri ? (
          <Animated.View entering={FadeInDown.delay(120).duration(300)}>
            <Image source={{ uri: order.photoUri }} style={styles.photo} />
          </Animated.View>
        ) : null}

        {order.comment ? (
          <Animated.View entering={FadeInDown.delay(160).duration(300)} style={styles.commentBox}>
            <Text style={styles.commentLabel}>Комментарий</Text>
            <Text style={styles.commentText}>{order.comment}</Text>
          </Animated.View>
        ) : null}

        {/* Предложения мастеров. Выбирает клиент — и этот выбор назначает
            исполнителя, поэтому цена и рейтинг стоят рядом. */}
        {collecting && !legacyOffer && (
          <Animated.View entering={FadeInDown.delay(170).duration(300)}>
            {offers.length === 0 ? (
              <View style={styles.waitingBox}>
                <Text style={styles.waitingTitle}>Ждём предложений</Text>
                <Text style={styles.waitingText}>
                  Мастера рядом видят вашу заявку. Как только кто-то назовёт цену,
                  она появится здесь.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.offersTitle}>
                  {counted(offers.length, 'предложение', 'предложения', 'предложений')}
                </Text>
                {offers.map((offer) => (
                  <OfferCard
                    key={offer.masterId}
                    offer={offer}
                    onPick={() => onAcceptOffer(offer.masterId)}
                  />
                ))}
              </>
            )}
          </Animated.View>
        )}

        {/* Старая схема: одно предложение внутри самой заявки */}
        {legacyOffer && (
          <Animated.View entering={FadeInDown.delay(170).duration(300)} style={styles.offerCard}>
            <Text style={styles.offerLabel}>
              {order.masterName ? `Мастер ${order.masterName} предлагает` : 'Мастер предлагает'}
            </Text>
            <Text style={styles.offerPrice}>{rub(order.price as number)}</Text>

            <View style={styles.offerRow}>
              <PressableScale style={[styles.offerBtn, styles.offerAccept]} onPress={onAcceptPrice}>
                <Text style={styles.offerAcceptText}>✓  Принять</Text>
              </PressableScale>
              <PressableScale style={[styles.offerBtn, styles.offerDecline]} onPress={onDeclinePrice}>
                <Text style={styles.offerDeclineText}>✕  Отклонить</Text>
              </PressableScale>
            </View>

            <PressableScale style={styles.offerDiscuss} onPress={onChat}>
              <Text style={styles.offerDiscussText}>💬  Обговорить цену</Text>
            </PressableScale>
          </Animated.View>
        )}

        {/* Цена согласована — показываем именно ту, на которую человек согласился */}
        {agreed && (
          <Animated.View entering={FadeInDown.delay(170).duration(300)} style={styles.agreedCard}>
            <Text style={styles.agreedText}>
              {order.masterName ? `${order.masterName} · ` : ''}
              {rub(order.agreedPrice as number)}
            </Text>
            <Text style={styles.agreedSub}>Цена согласована</Text>
          </Animated.View>
        )}

        {legacyDeclined && (
          <Animated.View entering={FadeInDown.delay(170).duration(300)} style={styles.declinedCard}>
            <Text style={styles.declinedText}>
              Вы отклонили {rub(order.price as number)} — мастер может предложить другую цену
            </Text>
          </Animated.View>
        )}

        {/* Мастер сообщил, что закончил — просим подтвердить результат */}
        {awaitingConfirm && (
          <Animated.View entering={FadeInDown.delay(180).duration(300)}>
            <PressableScale style={styles.confirmBtn} onPress={onConfirmDone}>
              <Text style={styles.confirmBtnText}>✓  Работа выполнена — подтвердить</Text>
            </PressableScale>
          </Animated.View>
        )}

        {/* Отзыв просим один раз и только после завершения: раньше оценивать
            нечего, позже — уже неинтересно */}
        {canReview && <ReviewForm onSubmit={onSubmitReview} />}

        {/* Писать некому, пока мастер не выбран: до этого у заявки нет
            собеседника, и сообщение осталось бы без ответа */}
        {(order.masterId || legacyOffer) && (
          <Animated.View entering={FadeInDown.delay(200).duration(300)}>
            <PressableScale
              style={[styles.chatBtn, (awaitingConfirm || canReview) && styles.chatBtnSecondary]}
              onPress={onChat}
            >
              <Text
                style={[
                  styles.chatBtnText,
                  (awaitingConfirm || canReview) && styles.chatBtnTextSecondary,
                ]}
              >
                💬  Написать мастеру
              </Text>
            </PressableScale>
          </Animated.View>
        )}

        {cancellable && (
          <Animated.View entering={FadeInDown.delay(250).duration(300)}>
            <PressableScale
              style={[styles.cancelBtn, confirming && styles.cancelBtnConfirm]}
              onPress={() => (confirming ? onCancel() : setConfirming(true))}
            >
              <Text style={[styles.cancelText, confirming && styles.cancelTextConfirm]}>
                {confirming ? 'Точно отменить заявку?' : 'Отменить заявку'}
              </Text>
            </PressableScale>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

// ---------- Предложение одного мастера ----------

function OfferCard({ offer, onPick }: { offer: Offer; onPick: () => void }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const [confirming, setConfirming] = useState(false);

  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      layout={LinearTransition.springify().damping(20).stiffness(170)}
      style={styles.offerCard}
    >
      <View style={styles.offerHead}>
        <View style={styles.offerWho}>
          <Text style={styles.offerName}>{offer.masterName}</Text>
          <Text style={styles.offerRating}>
            {offer.rating != null
              ? `★ ${ratingText(offer.rating)} · ${counted(offer.reviewsCount, 'отзыв', 'отзыва', 'отзывов')}`
              : 'Пока без отзывов'}
          </Text>
        </View>
        <Text style={styles.offerPriceSmall}>{rub(offer.price)}</Text>
      </View>

      {offer.comment ? <Text style={styles.offerComment}>{offer.comment}</Text> : null}

      {/* Выбор мастера необратим — он назначает исполнителя, поэтому в два
          касания. Спросить до выбора негде: чат откроется вместе с выбором,
          а всё, что мастер хотел сказать, он написал в комментарии. */}
      <View style={styles.offerRow}>
        <PressableScale
          style={[styles.offerBtn, styles.offerAccept, confirming && styles.offerAcceptConfirm]}
          onPress={() => (confirming ? onPick() : setConfirming(true))}
        >
          <Text style={styles.offerAcceptText}>
            {confirming ? 'Точно выбрать этого мастера?' : '✓  Выбрать'}
          </Text>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

// ---------- Отзыв о работе ----------

function ReviewForm({ onSubmit }: { onSubmit: (stars: number, text: string) => void }) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');

  return (
    <Animated.View entering={FadeInDown.delay(180).duration(300)} style={styles.reviewCard}>
      <Text style={styles.reviewTitle}>Как всё прошло?</Text>

      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <PressableScale key={n} style={styles.starHit} onPress={() => setStars(n)}>
            <Text style={[styles.star, n <= stars && styles.starOn]}>★</Text>
          </PressableScale>
        ))}
      </View>

      <TextInput
        style={styles.reviewInput}
        value={text}
        onChangeText={setText}
        placeholder="Пара слов о работе — по желанию"
        placeholderTextColor={t.textMuted}
        multiline
        maxLength={1000}
      />

      <PressableScale
        style={[styles.reviewBtn, stars === 0 && styles.reviewBtnDim]}
        onPress={() => stars > 0 && onSubmit(stars, text.trim())}
        disabled={stars === 0}
      >
        <Text style={styles.reviewBtnText}>
          {stars === 0 ? 'Поставьте оценку' : 'Отправить отзыв'}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  wrap: { justifyContent: 'flex-end' },
  dim: { backgroundColor: t.dim },
  card: {
    margin: 12,
    borderRadius: 28,
    backgroundColor: t.card,
    padding: 20,
    paddingBottom: 26,
    shadowColor: t.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  headerText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '800', color: t.text, lineHeight: 21 },
  date: { fontSize: 11.5, color: t.textMuted, fontWeight: '600', marginTop: 3 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  photo: {
    width: '100%',
    height: 170,
    borderRadius: 16,
    backgroundColor: t.chip,
    marginBottom: 10,
  },
  commentBox: {
    backgroundColor: t.soft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
    padding: 13,
    marginBottom: 10,
  },
  commentLabel: { fontSize: 10.5, fontWeight: '800', color: t.textMuted, marginBottom: 4 },
  commentText: { fontSize: 13, fontWeight: '600', color: t.text, lineHeight: 18 },
  waitingBox: {
    backgroundColor: t.soft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
    padding: 14,
    marginBottom: 10,
  },
  waitingTitle: { fontSize: 13, fontWeight: '800', color: t.text },
  waitingText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.textMuted,
    lineHeight: 17,
    marginTop: 4,
  },
  offersTitle: { fontSize: 11, fontWeight: '800', color: t.textMuted, marginBottom: 8 },
  offerCard: {
    backgroundColor: t.soft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.accentBorder,
    padding: 14,
    marginBottom: 10,
  },
  offerHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  offerWho: { flex: 1 },
  offerName: { fontSize: 14, fontWeight: '800', color: t.text },
  offerRating: { fontSize: 11.5, fontWeight: '700', color: t.textMuted, marginTop: 2 },
  offerPriceSmall: { fontSize: 19, fontWeight: '800', color: t.text },
  offerComment: {
    fontSize: 12.5,
    fontWeight: '600',
    color: t.textSoft,
    lineHeight: 17,
    marginTop: 8,
  },
  offerLabel: { fontSize: 11, fontWeight: '800', color: t.textMuted },
  offerPrice: { fontSize: 26, fontWeight: '800', color: t.text, marginTop: 4, marginBottom: 12 },
  offerRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  offerBtn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  offerAccept: { backgroundColor: t.accent },
  offerAcceptConfirm: { backgroundColor: t.blue },
  offerAcceptText: { color: t.onAccent, fontWeight: '800', fontSize: 13.5 },
  offerDecline: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
  offerDeclineText: { color: t.danger, fontWeight: '800', fontSize: 13.5 },
  offerDiscuss: { alignItems: 'center', paddingVertical: 11, marginTop: 4 },
  offerDiscussText: { color: t.accent, fontWeight: '800', fontSize: 13 },
  agreedCard: {
    backgroundColor: t.accentFaint,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.accentBorder,
    padding: 13,
    marginBottom: 10,
    alignItems: 'center',
  },
  agreedText: { color: t.accent, fontWeight: '800', fontSize: 15 },
  agreedSub: { color: t.textMuted, fontWeight: '700', fontSize: 11, marginTop: 2 },
  declinedCard: {
    backgroundColor: t.soft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
    padding: 13,
    marginBottom: 10,
    alignItems: 'center',
  },
  declinedText: { color: t.textSoft, fontWeight: '700', fontSize: 12, textAlign: 'center' },
  reviewCard: {
    backgroundColor: t.soft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.border,
    padding: 14,
    marginBottom: 10,
  },
  reviewTitle: { fontSize: 13.5, fontWeight: '800', color: t.text },
  starsRow: { flexDirection: 'row', gap: 2, marginTop: 8, marginBottom: 10 },
  starHit: { padding: 3 },
  star: { fontSize: 26, color: t.toggleOff },
  starOn: { color: t.warn },
  reviewInput: {
    borderWidth: 1,
    borderColor: t.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontWeight: '600',
    color: t.text,
    backgroundColor: t.inputBg,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  reviewBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: t.accent,
    marginTop: 10,
  },
  reviewBtnDim: { opacity: 0.5 },
  reviewBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 13.5 },
  confirmBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: t.accent,
    marginBottom: 9,
  },
  confirmBtnText: { fontWeight: '700', fontSize: 14.5, color: t.onAccent },
  chatBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: t.accent,
    marginBottom: 9,
  },
  chatBtnSecondary: {
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.accentBorder,
    paddingVertical: 13,
  },
  chatBtnText: { fontWeight: '700', fontSize: 14.5, color: t.onAccent },
  chatBtnTextSecondary: { color: t.accent },
  cancelBtn: {
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
  },
  cancelBtnConfirm: { backgroundColor: t.danger, borderColor: t.danger },
  cancelText: { fontWeight: '700', fontSize: 13.5, color: t.danger },
  cancelTextConfirm: { color: '#FFFFFF' },
});

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
