import { useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
import { useArmedConfirm } from './armedConfirm';
import { useBackClose } from './backClose';
import { Glyph, themedIconColors } from './glyphIcons';
import { FONTS, TABULAR } from './typography';
import { hapticImpact, hapticSuccess } from './haptics';
import { PressableScale } from './PressableScale';
import { SheetGrabber, useSheetDrag } from './sheetDrag';
import { counted, ratingText, rub } from './format';
import { dayLabel } from './masterStats';
import {
  availableMethods,
  banksLine,
  formatPhone,
  PAYMENT_METHOD_LABELS,
  PAYMENT_NOTICE,
  type PaymentMethod,
} from './payment';
import { VerificationExplainer } from './VerificationExplainer';
import type { Offer, Order } from '../screens/OrdersScreen';

type Props = {
  order: Order;
  onClose: () => void;
  onCancel: () => void;
  // Пользователь подтверждает, что мастер закончил работу
  onConfirmDone: () => void;
  // Расчёт напрямую: способ выбирает клиент, «оплатил» ставится один раз
  onChoosePaymentMethod: (method: PaymentMethod) => void;
  onMarkPaid: () => void;
  onChat: () => void;
  // Выбор предложения — именно он назначает мастера и делает цену согласованной
  onAcceptOffer: (masterId: string) => void;
  onSubmitReview: (stars: number, text: string) => void;
  // Старые заявки, где предложение лежало в самой заявке
  onAcceptPrice: () => void;
  onDeclinePrice: () => void;
  // Повторить завершённую заявку: передаётся, только когда повторять есть что
  onRepeat?: () => void;
};

const CANCELLABLE = ['Поиск мастера', 'Есть предложения', 'В работе'];
// Статусы, в которых стороны рассчитываются: мастер выбран, заявка живая
const SETTLING = ['В работе', 'Ждёт подтверждения', 'Завершена'];

// Правило цвета: жёлтый — ждём других, зелёный — дело за вами. «Ждёт
// подтверждения» — единственный статус, где от клиента требуется поступок
// (принять работу), и жёлтая пауза маскировала бы призыв к действию.
export function statusColor(status: string, t: Palette) {
  if (status === 'В работе') return t.blue;
  if (status === 'Ждёт подтверждения') return t.accent;
  if (status === 'Завершена') return t.accent;
  if (status === 'Отменена') return t.textMuted;
  return t.warn; // Поиск мастера и прочие «ждём ответа»
}

// ---------- Лента статуса ----------

// Путь заявки как четыре шага. Точный статус написан в чипе — лента отвечает
// на другой вопрос: «сколько уже пройдено». Подписи короткие: полные названия
// статусов вчетвером не помещаются.
const STEPPER_STEPS: { statuses: string[]; label: string }[] = [
  // «Есть предложения» — только у заявок, созданных до подколлекции offers
  { statuses: ['Поиск мастера', 'Есть предложения'], label: 'Поиск' },
  { statuses: ['В работе'], label: 'В работе' },
  { statuses: ['Ждёт подтверждения'], label: 'Приёмка' },
  { statuses: ['Завершена'], label: 'Готово' },
];

function StatusStepper({ status }: { status: string }) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const idx = STEPPER_STEPS.findIndex((s) => s.statuses.includes(status));
  // Отменённой заявке лента прогресса не положена: пути больше нет
  if (idx < 0) return null;

  return (
    <View style={styles.stepperRow}>
      {STEPPER_STEPS.map((step, i) => (
        <View key={step.label} style={[styles.stepperItemWrap, i === 0 && styles.stepperItemFirst]}>
          {i > 0 && (
            <View style={[styles.stepperLine, i <= idx && { backgroundColor: t.accent }]} />
          )}
          <View style={styles.stepperItem}>
            <View
              style={[
                styles.stepperDot,
                i <= idx && { backgroundColor: t.accent, borderColor: t.accent },
              ]}
            />
            <Text style={[styles.stepperLabel, i === idx && styles.stepperLabelOn]}>
              {step.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// Детали заказа: фото крупно, комментарий, предложения мастеров и действия.
// Отмена — в два касания, чтобы не отменить случайно.
export function OrderSheet({
  order,
  onClose,
  onCancel,
  onConfirmDone,
  onChoosePaymentMethod,
  onMarkPaid,
  onChat,
  onAcceptOffer,
  onSubmitReview,
  onAcceptPrice,
  onDeclinePrice,
  onRepeat,
}: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  // Отмена необратима — подтверждение взводится отдельно и не ловит
  // случайный двойной тап
  const { confirming, press: pressCancel } = useArmedConfirm(onCancel);
  // «Как мы проверяем мастеров» — открывается с бейджа на предложении
  const [verifOpen, setVerifOpen] = useState(false);
  const { gesture, cardStyle, dragDismissed } = useSheetDrag(onClose);
  useBackClose(true, onClose);

  const offers = (order.offers ?? []).filter((o) => o.status === 'pending');
  // Пока мастер не выбран, заявка собирает предложения
  const collecting = order.status === 'Поиск мастера';
  const agreed = order.agreedPrice != null;
  const awaitingConfirm = order.status === 'Ждёт подтверждения';
  const canReview = order.status === 'Завершена' && !order.reviewed && !!order.masterId;
  const cancellable = CANCELLABLE.includes(order.status);
  // Расчёт показываем, как только есть с кем рассчитываться
  const settling = !!order.masterId && SETTLING.includes(order.status);

  // Телефон мастера сервер кладёт в заявку после выбора исполнителя — сделка
  // на этом рынке живёт в звонке, и прятать его за чатом значило бы, что
  // номерами обменяются первым же сообщением
  const canCall = !!order.masterId && !!order.masterPhone;
  const dial = () => {
    if (order.masterPhone) Linking.openURL(`tel:${order.masterPhone}`).catch(() => {});
  };

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
        // Уехавшую пальцем карточку не провожаем второй анимацией
        exiting={dragDismissed ? undefined : SlideOutDown.duration(280)}
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

        {/* Фото, предложения и форма отзыва вместе выше экрана: заголовок
            остаётся на месте, остальное прокручивается внутри карточки */}
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <StatusStepper status={order.status} />

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
                    Мастера рядом видят вашу заявку. Как только кто-то назовёт цену, она появится
                    здесь.
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
                      onPick={() => {
                        hapticSuccess();
                        onAcceptOffer(offer.masterId);
                      }}
                      onVerifiedInfo={() => setVerifOpen(true)}
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
                <PressableScale
                  style={[styles.offerBtn, styles.offerAccept]}
                  onPress={onAcceptPrice}
                >
                  <Text style={styles.offerAcceptText}>✓ Принять</Text>
                </PressableScale>
                <PressableScale
                  style={[styles.offerBtn, styles.offerDecline]}
                  onPress={onDeclinePrice}
                >
                  <Text style={styles.offerDeclineText}>✕ Отклонить</Text>
                </PressableScale>
              </View>

              <PressableScale style={[styles.offerDiscuss, styles.iconLabelRow]} onPress={onChat}>
                <Glyph glyph="💬" size={16} colors={themedIconColors(t)} />
                <Text style={styles.offerDiscussText}>Обговорить цену</Text>
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
            <Animated.View
              entering={FadeInDown.delay(170).duration(300)}
              style={styles.declinedCard}
            >
              <Text style={styles.declinedText}>
                Вы отклонили {rub(order.price as number)} — мастер может предложить другую цену
              </Text>
            </Animated.View>
          )}

          {/* Мастер сообщил, что закончил — просим подтвердить результат */}
          {awaitingConfirm && (
            <Animated.View entering={FadeInDown.delay(180).duration(300)}>
              <PressableScale
                style={styles.confirmBtn}
                onPress={() => {
                  hapticSuccess();
                  onConfirmDone();
                }}
              >
                <Text style={styles.confirmBtnText}>✓ Работа выполнена — подтвердить</Text>
              </PressableScale>
            </Animated.View>
          )}

          {/* Расчёт напрямую: сервис денег не касается — только показывает,
            как платить, и даёт отметить, что оплата состоялась */}
          {settling && (
            <PaymentBlock order={order} onChoose={onChoosePaymentMethod} onMarkPaid={onMarkPaid} />
          )}

          {/* Отзыв просим один раз и только после завершения: раньше оценивать
            нечего, позже — уже неинтересно */}
          {canReview && <ReviewForm onSubmit={onSubmitReview} />}

          {/* Писать некому, пока мастер не выбран: до этого у заявки нет
            собеседника, и сообщение осталось бы без ответа. Как только сервер
            положил в заявку телефон, рядом с чатом встаёт звонок. */}
          {(order.masterId || legacyOffer) &&
            (canCall ? (
              <Animated.View
                entering={FadeInDown.delay(200).duration(300)}
                style={styles.contactRow}
              >
                <PressableScale
                  style={[
                    styles.chatBtn,
                    styles.contactBtn,
                    styles.iconLabelRow,
                    (awaitingConfirm || canReview) && styles.chatBtnSecondary,
                  ]}
                  onPress={dial}
                >
                  {/* На акцентной кнопке зелёная иконка слилась бы с фоном —
                    контур берёт цвет текста кнопки */}
                  <Glyph
                    glyph="📞"
                    size={17}
                    colors={
                      awaitingConfirm || canReview
                        ? themedIconColors(t)
                        : { stroke: t.onAccent, fill: t.accent, glass: t.accentSoft }
                    }
                  />
                  <Text
                    style={[
                      styles.chatBtnText,
                      (awaitingConfirm || canReview) && styles.chatBtnTextSecondary,
                    ]}
                  >
                    Позвонить
                  </Text>
                </PressableScale>
                <PressableScale
                  style={[
                    styles.chatBtn,
                    styles.contactBtn,
                    styles.iconLabelRow,
                    styles.chatBtnSecondary,
                  ]}
                  onPress={onChat}
                >
                  <Glyph glyph="💬" size={17} colors={themedIconColors(t)} />
                  <Text style={[styles.chatBtnText, styles.chatBtnTextSecondary]}>Написать</Text>
                </PressableScale>
              </Animated.View>
            ) : (
              <Animated.View entering={FadeInDown.delay(200).duration(300)}>
                <PressableScale
                  style={[
                    styles.chatBtn,
                    styles.iconLabelRow,
                    (awaitingConfirm || canReview) && styles.chatBtnSecondary,
                  ]}
                  onPress={onChat}
                >
                  <Glyph
                    glyph="💬"
                    size={17}
                    colors={
                      awaitingConfirm || canReview
                        ? themedIconColors(t)
                        : { stroke: t.onAccent, fill: t.accent, glass: t.accentSoft }
                    }
                  />
                  <Text
                    style={[
                      styles.chatBtnText,
                      (awaitingConfirm || canReview) && styles.chatBtnTextSecondary,
                    ]}
                  >
                    Написать мастеру
                  </Text>
                </PressableScale>
              </Animated.View>
            ))}

          {/* Повторить завершённую работу — та же услуга и адрес без похода по
            дому; прошлого мастера можно позвать первым */}
          {order.status === 'Завершена' && onRepeat && (
            <Animated.View entering={FadeInDown.delay(230).duration(300)}>
              <PressableScale
                style={[styles.chatBtn, styles.chatBtnSecondary, styles.iconLabelRow]}
                onPress={onRepeat}
              >
                <Glyph glyph="🔄" size={16} colors={themedIconColors(t)} />
                <Text style={[styles.chatBtnText, styles.chatBtnTextSecondary]}>
                  Повторить заявку
                </Text>
              </PressableScale>
            </Animated.View>
          )}

          {cancellable && (
            <Animated.View entering={FadeInDown.delay(250).duration(300)}>
              <PressableScale
                style={[styles.cancelBtn, confirming && styles.cancelBtnConfirm]}
                onPress={pressCancel}
              >
                <Text style={[styles.cancelText, confirming && styles.cancelTextConfirm]}>
                  {confirming ? 'Точно отменить заявку?' : 'Отменить заявку'}
                </Text>
              </PressableScale>
            </Animated.View>
          )}
        </ScrollView>
      </Animated.View>

      <VerificationExplainer open={verifOpen} onClose={() => setVerifOpen(false)} />
    </View>
  );
}

// ---------- Предложение одного мастера ----------

function OfferCard({
  offer,
  onPick,
  onVerifiedInfo,
}: {
  offer: Offer;
  onPick: () => void;
  onVerifiedInfo: () => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  // Выбор назначает исполнителя — то же защищённое подтверждение, что у отмены
  const { confirming, press: pressPick } = useArmedConfirm(onPick);
  // Профиль мастера раскрывается на месте, а не отдельным экраном: шторка
  // поверх шторки перекрыла бы кнопку выбора — то, ради чего всё открыто
  const [profileOpen, setProfileOpen] = useState(false);

  // Имя из предложения, фамилия из анкеты: у старых анкет фамилии нет,
  // и имя не должно превращаться в «Иван undefined»
  const fullName = [offer.masterName, offer.lastName].filter(Boolean).join(' ');

  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      layout={LinearTransition.springify().damping(20).stiffness(170)}
      style={styles.offerCard}
    >
      <View style={styles.offerHead}>
        <PressableScale style={styles.offerWho} onPress={() => setProfileOpen((v) => !v)}>
          <View style={styles.offerNameRow}>
            <Text style={styles.offerName}>{fullName}</Text>
            {/* Предложение может прислать только проверенный мастер — правила
                не пускают остальных. Бейдж делает это видимым и объясняет,
                что стоит за словом «проверен». */}
            <PressableScale
              style={styles.verifiedChip}
              onPress={onVerifiedInfo}
              // Бейдж ниже 44pt — слоп добивает зону касания
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Glyph glyph="🛡️" size={11} colors={themedIconColors(t)} />
              <Text style={styles.verifiedText}>Проверен</Text>
            </PressableScale>
          </View>
          <Text style={styles.offerRating}>
            {offer.rating != null
              ? `★ ${ratingText(offer.rating)} · ${counted(offer.reviewsCount, 'отзыв', 'отзыва', 'отзывов')}`
              : 'Пока без отзывов'}
          </Text>
          <Text style={styles.offerProfileToggle}>
            {profileOpen ? 'Свернуть профиль' : 'Профиль мастера ›'}
          </Text>
        </PressableScale>
        {/* Цена — то, что клиент сравнивает между предложениями: ей самый
            крупный кегль в карточке и цифры одной ширины */}
        <Text style={styles.offerPriceSmall}>{rub(offer.price)}</Text>
      </View>

      {profileOpen && (
        <Animated.View entering={FadeIn.duration(220)} style={styles.profileBox}>
          <ProfileRow
            label="Выполнено заказов"
            value={
              offer.completedOrders > 0
                ? counted(offer.completedOrders, 'заказ', 'заказа', 'заказов')
                : 'пока нет'
            }
          />
          <ProfileRow
            label="Стаж"
            value={
              offer.experienceYears == null
                ? 'не указан'
                : offer.experienceYears === 0
                  ? 'меньше года'
                  : counted(offer.experienceYears, 'год', 'года', 'лет')
            }
          />
          <ProfileRow label="Образование" value={offer.education ?? 'не указано'} />
        </Animated.View>
      )}

      {offer.comment ? <Text style={styles.offerComment}>{offer.comment}</Text> : null}

      {/* Выбор мастера необратим — он назначает исполнителя, поэтому в два
          касания. Спросить до выбора негде: чат откроется вместе с выбором,
          а всё, что мастер хотел сказать, он написал в комментарии. */}
      <View style={styles.offerRow}>
        <PressableScale
          style={[styles.offerBtn, styles.offerAccept, confirming && styles.offerAcceptConfirm]}
          onPress={pressPick}
        >
          <Text style={styles.offerAcceptText}>
            {confirming ? 'Точно выбрать этого мастера?' : '✓  Выбрать'}
          </Text>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileLabel}>{label}</Text>
      <Text style={styles.profileValue}>{value}</Text>
    </View>
  );
}

// ---------- Оплата напрямую ----------

// Способ выбирает клиент; перевод идёт по СБП на телефон мастера — тот же,
// что у кнопки «Позвонить», его видел модератор. Сервис в расчётах не
// участвует, и карточка говорит это прямо: она не должна выглядеть
// гарантией сделки.
function PaymentBlock({
  order,
  onChoose,
  onMarkPaid,
}: {
  order: Order;
  onChoose: (method: PaymentMethod) => void;
  onMarkPaid: () => void;
}) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const methods = availableMethods(order);
  const chosen = order.paymentMethod ?? null;
  const paid = order.paidMs != null;
  const received = order.paymentReceivedMs != null;
  // Способ заперт, как только кто-то из сторон отметил расчёт
  const locked = paid || received;
  // Отметка необратима — то же подтверждение в два касания, что у выбора
  const { confirming, press: pressPaid } = useArmedConfirm(onMarkPaid);
  const price = order.agreedPrice ?? order.price ?? null;
  // До приёмки кнопка не зовёт платить: сначала работа, потом деньги
  const emphasis = order.status === 'Завершена';
  const banks = order.masterBanks ?? [];

  return (
    <Animated.View entering={FadeInDown.delay(190).duration(300)} style={styles.payCard}>
      <Text style={styles.payTitle}>Оплата{price != null ? ` · ${rub(price)}` : ''}</Text>

      <View style={styles.payMethods}>
        {methods.map((m) => {
          const on = chosen === m;
          return (
            <PressableScale
              key={m}
              style={[styles.payMethod, on && styles.payMethodOn, locked && !on && styles.payDim]}
              onPress={() => {
                if (!locked && !on) onChoose(m);
              }}
              disabled={locked}
            >
              <Text style={[styles.payMethodText, on && styles.payMethodTextOn]}>
                {PAYMENT_METHOD_LABELS[m]}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      {chosen === 'transfer' && (
        <View style={styles.payDetails}>
          <Text style={styles.payLabel}>Перевод по СБП на номер</Text>
          {order.masterPhone ? (
            // Выделяемый текст: скопировать номер в приложение банка
            <Text style={styles.payPhone} selectable>
              {formatPhone(order.masterPhone)}
            </Text>
          ) : (
            <Text style={styles.payText}>
              Номер появится в заявке через минуту — его кладёт сервер
            </Text>
          )}
          <Text style={styles.payText}>
            {banks.length > 0
              ? `Банк получателя: ${banksLine(banks)}`
              : 'Какой банк — уточните у мастера'}
          </Text>
          {!!order.masterName && (
            <Text style={styles.payText}>
              Перед отправкой сверьте имя получателя в приложении банка: {order.masterName}
            </Text>
          )}
        </View>
      )}
      {chosen === 'cash' && (
        <View style={styles.payDetails}>
          <Text style={styles.payText}>
            Наличными мастеру при встрече{price != null ? `, ${rub(price)}` : ''}.
          </Text>
        </View>
      )}
      {!chosen && (
        <Text style={styles.payText}>
          Выберите, как будете платить, — мастер увидит это в заявке.
        </Text>
      )}

      {paid ? (
        <Text style={styles.payState}>
          ✓ Вы отметили оплату{order.paidMs != null ? ` ${dayLabel(order.paidMs)}` : ''}
        </Text>
      ) : chosen ? (
        <PressableScale
          style={[
            styles.payBtn,
            emphasis ? styles.payBtnPrimary : styles.payBtnSecondary,
            confirming && styles.payBtnConfirm,
          ]}
          onPress={() => {
            hapticImpact();
            pressPaid();
          }}
        >
          <Text
            style={[
              styles.payBtnText,
              emphasis || confirming ? styles.payBtnTextOnAccent : styles.payBtnTextAccent,
            ]}
          >
            {confirming ? 'Точно? Отметить оплату' : 'Я оплатил'}
          </Text>
        </PressableScale>
      ) : null}
      {received && <Text style={styles.payState}>✓ Мастер подтвердил получение</Text>}

      <Text style={styles.payNotice}>{PAYMENT_NOTICE}</Text>
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
          <PressableScale
            key={n}
            style={styles.starHit}
            onPress={() => setStars(n)}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            accessibilityRole="button"
            accessibilityLabel={`Оценка ${n}`}
          >
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
        onPress={() => {
          if (stars === 0) return;
          hapticImpact();
          onSubmit(stars, text.trim());
        }}
        disabled={stars === 0}
      >
        <Text style={styles.reviewBtnText}>
          {stars === 0 ? 'Поставьте оценку' : 'Отправить отзыв'}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: { justifyContent: 'flex-end' },
    dim: { backgroundColor: t.dim },
    card: {
      margin: 12,
      // Контент бывает длиннее экрана — карточка держит рост,
      // остальное прокручивается внутри (см. scroll)
      maxHeight: '82%',
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
    scroll: { flexGrow: 0 },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
    stepperRow: { flexDirection: 'row', marginBottom: 14, marginTop: 2 },
    // Первая ячейка без соединителя не растягивается — иначе линия к второй
    // точке начиналась бы с разрывом
    stepperItemWrap: { flexDirection: 'row', alignItems: 'flex-start', flex: 1 },
    stepperItemFirst: { flex: 0 },
    stepperItem: { alignItems: 'center', gap: 3 },
    stepperDot: {
      width: 9,
      height: 9,
      borderRadius: 4.5,
      borderWidth: 2,
      borderColor: t.toggleOff,
      backgroundColor: t.card,
    },
    stepperLine: {
      flex: 1,
      height: 2,
      backgroundColor: t.toggleOff,
      marginTop: 3.5,
      marginHorizontal: 3,
    },
    stepperLabel: { fontSize: 9.5, fontWeight: '700', color: t.textMuted },
    stepperLabelOn: { color: t.accent },
    headerText: { flex: 1 },
    title: { fontSize: 16, fontFamily: FONTS.heading, color: t.text, lineHeight: 21 },
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
    commentText: { fontSize: 13, fontWeight: '400', color: t.text, lineHeight: 18 },
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
      fontWeight: '400',
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
    offerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    offerName: { fontSize: 14, fontFamily: FONTS.heading, color: t.text },
    verifiedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: t.accentSoft,
      borderRadius: 9,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    verifiedText: { fontSize: 10, fontWeight: '800', color: t.accentStrong },
    offerRating: { fontSize: 11.5, fontWeight: '700', color: t.textMuted, marginTop: 2 },
    offerProfileToggle: { fontSize: 11.5, fontWeight: '800', color: t.accent, marginTop: 4 },
    offerPriceSmall: { fontSize: 23, fontFamily: FONTS.heading, color: t.text, ...TABULAR },
    profileBox: {
      backgroundColor: t.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 12,
      paddingVertical: 6,
      marginTop: 10,
    },
    profileRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
    },
    profileLabel: { fontSize: 12, fontWeight: '700', color: t.textMuted },
    profileValue: { fontSize: 12.5, fontWeight: '800', color: t.text, flexShrink: 1 },
    offerComment: {
      fontSize: 12.5,
      fontWeight: '400',
      color: t.textSoft,
      lineHeight: 17,
      marginTop: 8,
    },
    offerLabel: { fontSize: 11, fontWeight: '800', color: t.textMuted },
    offerPrice: {
      fontSize: 26,
      fontFamily: FONTS.heading,
      color: t.text,
      marginTop: 4,
      marginBottom: 12,
      ...TABULAR,
    },
    offerRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
    offerBtn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
    offerAccept: { backgroundColor: t.accent },
    offerAcceptConfirm: { backgroundColor: t.blue },
    offerAcceptText: { color: t.onAccent, fontWeight: '800', fontSize: 13.5 },
    offerDecline: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
    offerDeclineText: { color: t.danger, fontWeight: '800', fontSize: 13.5 },
    offerDiscuss: { alignItems: 'center', paddingVertical: 11, marginTop: 4 },
    // Ряд «иконка + подпись» для кнопок, где раньше эмодзи жил в строке текста
    iconLabelRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
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
    declinedText: { color: t.textSoft, fontWeight: '500', fontSize: 12, textAlign: 'center' },
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
    starHit: { padding: 6 },
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
    // Звонок и чат в один ряд: после выбора мастера оба действия равноправны
    contactRow: { flexDirection: 'row', gap: 8 },
    contactBtn: { flex: 1 },
    chatBtnSecondary: {
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.accentBorder,
      paddingVertical: 13,
    },
    chatBtnText: { fontWeight: '700', fontSize: 14.5, color: t.onAccent },
    chatBtnTextSecondary: { color: t.accent },
    // ---------- оплата напрямую ----------
    payCard: {
      backgroundColor: t.soft,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      marginBottom: 10,
    },
    payTitle: { fontSize: 13.5, fontWeight: '800', color: t.text },
    payMethods: { flexDirection: 'row', gap: 8, marginTop: 10 },
    payMethod: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
      paddingVertical: 10,
      alignItems: 'center',
    },
    payMethodOn: { backgroundColor: t.accentSoft, borderColor: t.accentBorder },
    payDim: { opacity: 0.5 },
    payMethodText: { fontSize: 12.5, fontWeight: '700', color: t.textSoft },
    payMethodTextOn: { color: t.accent },
    payDetails: { marginTop: 10 },
    payLabel: { fontSize: 10.5, fontWeight: '800', color: t.textMuted },
    payPhone: { fontSize: 20, fontFamily: FONTS.heading, color: t.text, marginTop: 2, ...TABULAR },
    payText: { fontSize: 12, fontWeight: '400', color: t.textSoft, lineHeight: 17, marginTop: 6 },
    payState: { fontSize: 12.5, fontWeight: '800', color: t.accent, marginTop: 10 },
    payBtn: { borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
    payBtnPrimary: { backgroundColor: t.accent },
    payBtnSecondary: { backgroundColor: t.card, borderWidth: 1, borderColor: t.accentBorder },
    payBtnConfirm: { backgroundColor: t.blue, borderColor: t.blue },
    payBtnText: { fontWeight: '800', fontSize: 13.5 },
    payBtnTextOnAccent: { color: t.onAccent },
    payBtnTextAccent: { color: t.accent },
    payNotice: {
      fontSize: 11,
      fontWeight: '400',
      color: t.textMuted,
      lineHeight: 15,
      marginTop: 10,
    },
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
