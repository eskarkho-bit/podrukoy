import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
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
import type { Order } from '../screens/OrdersScreen';

type Props = {
  order: Order;
  onClose: () => void;
  onCancel: () => void;
  // Пользователь подтверждает, что мастер закончил работу
  onConfirmDone: () => void;
  onChat: () => void;
  // Согласование цены: принять или отклонить предложение мастера.
  // «Обговорить» отдельного обработчика не требует — это переход в чат.
  onAcceptPrice: () => void;
  onDeclinePrice: () => void;
};

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

export function statusColor(status: string, t: Palette) {
  if (status === 'В работе') return t.blue;
  if (status === 'Завершена') return t.accent;
  if (status === 'Отменена') return t.textMuted;
  return t.warn; // Поиск мастера, ждёт подтверждения и прочие «ожидающие»
}

// Детали заказа: фото крупно, комментарий, статус и действия.
// Отмена — в два касания, чтобы не отменить случайно.
export function OrderSheet({
  order, onClose, onCancel, onConfirmDone, onChat, onAcceptPrice, onDeclinePrice,
}: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [confirming, setConfirming] = useState(false);
  const cancellable = order.status === 'Поиск мастера' || order.status === 'В работе';
  const awaitingConfirm = order.status === 'Ждёт подтверждения';

  // Предложение ждёт ответа, только пока оно именно предложение:
  // принятая или отклонённая цена показывается, но не переспрашивается
  const pendingOffer = order.priceStatus === 'offered' && order.price != null;
  const agreed = order.priceStatus === 'accepted' && order.agreedPrice != null;
  const declined = order.priceStatus === 'declined' && order.price != null;

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
        style={styles.card}
      >
        <View style={styles.handle} />

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

        {/* Мастер предложил цену — три исхода: принять, отклонить, обсудить */}
        {pendingOffer && (
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
              Цена согласована · {rub(order.agreedPrice as number)}
            </Text>
          </Animated.View>
        )}

        {declined && (
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

        <Animated.View entering={FadeInDown.delay(200).duration(300)}>
          <PressableScale
            style={[styles.chatBtn, awaitingConfirm && styles.chatBtnSecondary]}
            onPress={onChat}
          >
            <Text style={[styles.chatBtnText, awaitingConfirm && styles.chatBtnTextSecondary]}>
              💬  Написать мастеру
            </Text>
          </PressableScale>
        </Animated.View>

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
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.toggleOff,
    marginBottom: 16,
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
  offerCard: {
    backgroundColor: t.soft,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.accentBorder,
    padding: 14,
    marginBottom: 10,
  },
  offerLabel: { fontSize: 11, fontWeight: '800', color: t.textMuted },
  offerPrice: { fontSize: 26, fontWeight: '800', color: t.text, marginTop: 4, marginBottom: 12 },
  offerRow: { flexDirection: 'row', gap: 8 },
  offerBtn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  offerAccept: { backgroundColor: t.accent },
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
  agreedText: { color: t.accent, fontWeight: '800', fontSize: 13 },
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
