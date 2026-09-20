import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { BankId } from '../components/banks';
import type { PaymentMethod } from '../components/payment';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  interpolateColor,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { springs, STAGGER } from '../motion';
import { palettes, Palette, useTheme } from '../theme';
import { useBackClose } from '../components/backClose';
import { AreaId, HouseScene, ROOMS, Room, SceneObject, Stage } from '../components/HouseScene';
import { ActionSheet, OrderDraft } from '../components/ActionSheet';
import { ObjectListSheet } from '../components/ObjectListSheet';
import { OrderSheet, statusColor } from '../components/OrderSheet';
import { RepeatSheet } from '../components/RepeatSheet';
import { counted } from '../components/format';
import { PressableScale } from '../components/PressableScale';
import { Glyph, themedIconColors } from '../components/glyphIcons';
import { FONTS } from '../components/typography';
import { EmptyScene } from '../components/illustrations';

const AREAS: AreaId[] = ['Дом', 'Двор', 'Гараж'];

// Предложение мастера. Их может быть несколько на одну заявку — клиент
// выбирает, и только выбор делает цену согласованной.
export type Offer = {
  masterId: string;
  masterName: string;
  price: number;
  comment: string;
  status: 'pending' | 'accepted';
  // Рейтинг мастера на момент показа. null — отзывов ещё нет или агрегат
  // не посчитан (его ведёт Cloud Function).
  rating: number | null;
  reviewsCount: number;
  // Остальной профиль — из анкеты мастера, а не из предложения: в предложение
  // он написал бы что угодно, а анкету видит модератор при проверке
  lastName: string;
  experienceYears: number | null;
  education: string | null;
  // Считает сервер по завершённым заявкам — как rating
  completedOrders: number;
};

// Согласование цены у заявок, созданных до появления offers: предложение
// лежало в самой заявке. Новые заявки этим путём не ходят.
export type PriceStatus = 'none' | 'offered' | 'accepted' | 'declined';

export type Order = {
  id: string;
  title: string;
  date: string;
  status: string;
  comment?: string;
  photoUri?: string | null;
  address?: string;
  // Кто взялся за заявку
  masterId?: string | null;
  masterName?: string | null;
  // Телефон мастера. Появляется после выбора исполнителя — его кладёт сервер,
  // и только тогда у заявки есть кому звонить
  masterPhone?: string | null;
  // Как мастер принимает оплату — копия его настроек на момент выбора,
  // кладёт сервер вместе с телефоном. null — мастер их не задавал
  masterBanks?: BankId[] | null;
  masterAcceptsCash?: boolean | null;
  // Расчёт напрямую: способ выбирает клиент, отметки ставят стороны
  paymentMethod?: PaymentMethod | null;
  paidMs?: number | null;
  paymentReceivedMs?: number | null;
  // Объект дома и вид работы — по ним «Повторить» собирает новую заявку.
  // У заявок, созданных до появления этих полей, их нет — тогда кнопки нет.
  objectId?: string;
  serviceLabel?: string;
  // Предложения мастеров, дешёвые сверху
  offers?: Offer[];
  // Цена, на которую клиент согласился явно
  agreedPrice?: number | null;
  // Отзыв о работе уже оставлен — просить повторно не нужно
  reviewed?: boolean;
  // Только у старых заявок: предложение внутри самой заявки
  price?: number | null;
  priceStatus?: PriceStatus;
};

type Props = {
  orders: Order[];
  addresses: string[];
  activeAddress: string;
  onSelectAddress: (addr: string) => void;
  onAddAddress: (addr: string) => void;
  onCreateOrder: (draft: OrderDraft) => void;
  onCancelOrder: (orderId: string) => void;
  onConfirmOrder: (orderId: string) => void;
  // «Ещё не готово»: работа возвращается мастеру вместо подтверждения
  onReturnOrder: (orderId: string) => void;
  // Жалоба на мастера заявки и его блокировка; список заблокированных —
  // чтобы у заблокированного показывать состояние, а не кнопку
  onReportMaster: (orderId: string, text: string) => Promise<boolean>;
  onBlockMaster: (masterId: string, name: string) => void;
  blockedMasterIds: string[];
  // Расчёт напрямую: клиент выбирает способ и отмечает, что оплатил
  onChoosePaymentMethod: (orderId: string, method: PaymentMethod) => void;
  onMarkPaid: (orderId: string) => void;
  // Клиент выбирает одно из предложений — этот выбор и назначает мастера
  onAcceptOffer: (orderId: string, masterId: string) => void;
  onSubmitReview: (orderId: string, stars: number, text: string) => void;
  // Старые заявки, где предложение лежит в самой заявке
  onAcceptPrice: (orderId: string) => void;
  onDeclinePrice: (orderId: string) => void;
  // Чат теперь принадлежит заявке, поэтому нужен её идентификатор
  onOpenOrderChat: (orderId: string) => void;
  // Сообщаем наверх, что открыта какая-то шторка — чтобы спрятать нижнюю панель
  onOverlayOpenChange?: (open: boolean) => void;
  // Экран целиком перекрыт другим оверлеем — режимом мастера или модерацией
  covered?: boolean;
  // Блокировка модерацией: создание заявок закрыто, баннер объясняет почему
  blocked?: boolean;
  // Короткое уведомление вместо экрана — для отказов до открытия шторки
  onNotice?: (text: string) => void;
  blockedReason?: string | null;
};

export function OrdersScreen({
  orders,
  addresses,
  activeAddress,
  onSelectAddress,
  onAddAddress,
  onCreateOrder,
  onCancelOrder,
  onConfirmOrder,
  onReturnOrder,
  onReportMaster,
  onBlockMaster,
  blockedMasterIds,
  onChoosePaymentMethod,
  onMarkPaid,
  onAcceptOffer,
  onSubmitReview,
  onAcceptPrice,
  onDeclinePrice,
  onOpenOrderChat,
  onOverlayOpenChange,
  covered,
  blocked,
  onNotice,
  blockedReason,
}: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState<AreaId>('Дом');
  // Стадия сцены: снаружи → дом открыт (виден план) → выбрана комната
  const [stage, setStage] = useState<Stage>('exterior');
  const [roomId, setRoomId] = useState<string | null>(null);
  // Объект, для которого открыта шторка действий
  const [activeObject, setActiveObject] = useState<SceneObject | null>(null);
  // Заказ, открытый в шторке деталей
  const [openedOrderId, setOpenedOrderId] = useState<string | null>(null);
  // Заказ, который повторяют: открывает шторку повтора вместо шторки деталей
  const [repeatOrder, setRepeatOrder] = useState<Order | null>(null);
  // Дом списком: тот же выбор объекта, но перечнем — для тех, кому так
  // привычнее, и для скринридера
  const [listOpen, setListOpen] = useState(false);
  // Дропдаун выбора адреса под заголовком
  const [addrOpen, setAddrOpen] = useState(false);
  // Режим ввода нового адреса внутри дропдауна
  const [addrAdding, setAddrAdding] = useState(false);
  const [addrDraft, setAddrDraft] = useState('');
  // Стаггер списка нужен только при первом появлении экрана
  const firstMount = useRef(true);
  const mountedWithStagger = firstMount.current;
  firstMount.current = false;

  // Открытый заказ берём по id из свежего списка — чтобы смена статуса отражалась в шторке
  const openedOrder = orders.find((o) => o.id === openedOrderId) ?? null;

  // Вкладки остаются смонтированными после первого захода, поэтому сцена сама
  // не узнает, что её больше не видно. Считаем это здесь и говорим ей прямо.
  const isFocused = useIsFocused();
  const sceneHidden =
    !isFocused || !!covered || !!activeObject || !!openedOrder || !!repeatOrder || listOpen;

  useEffect(() => {
    onOverlayOpenChange?.(!!activeObject || !!openedOrder || !!repeatOrder || listOpen);
  }, [activeObject, openedOrder, repeatOrder, listOpen, onOverlayOpenChange]);

  const selectArea = (next: AreaId) => {
    setArea(next);
    setStage('exterior');
    setRoomId(null);
    setActiveObject(null);
  };

  // Шаг «наружу»: комната → план дома → внешний вид
  const goBack = () => {
    setActiveObject(null);
    if (stage === 'room') {
      setStage('open');
      setRoomId(null);
    } else {
      setStage('exterior');
    }
  };

  const completeOrder = (draft: OrderDraft) => {
    onCreateOrder(draft);
    setActiveObject(null);
  };

  // Заблокированному шторку не открываем: правила заявку не примут, и
  // «Заявка создана» на экране успеха было бы ложью. Баннер с причиной уже на
  // главной — сюда только подсказка, куда идти
  const pickObject = (obj: SceneObject) => {
    if (blocked) {
      onNotice?.('Создание заявок ограничено модерацией. Напишите в поддержку, если не согласны');
      return;
    }
    setActiveObject(obj);
  };

  const focusedRoom = ROOMS.find((r) => r.id === roomId) ?? null;
  const caption = focusedRoom ? focusedRoom.title : area;

  const closeAddrDropdown = () => {
    setAddrOpen(false);
    setAddrAdding(false);
    setAddrDraft('');
  };

  // Системный «назад» закрывает дропдаун, а не уводит с экрана
  useBackClose(addrOpen, closeAddrDropdown);

  const submitNewAddress = () => {
    const trimmed = addrDraft.trim();
    if (!trimmed) return;
    onAddAddress(trimmed);
    closeAddrDropdown();
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
      >
        <Animated.View entering={FadeInDown.duration(420)}>
          <PressableScale
            style={styles.headerRow}
            onPress={() => (addrOpen ? closeAddrDropdown() : setAddrOpen(true))}
            accessibilityRole="button"
            accessibilityLabel="Выбрать адрес"
          >
            <Text style={styles.header}>Мой дом</Text>
            <HeaderChevron open={addrOpen} />
          </PressableScale>
        </Animated.View>

        {/* Дом остаётся живым и осмотримым — закрыто только создание заявок */}
        {blocked && (
          <Animated.View entering={FadeInDown.duration(320)} style={styles.blockedBanner}>
            <Text style={styles.blockedBannerTitle}>Создание заявок ограничено</Text>
            <Text style={styles.blockedBannerText}>
              {blockedReason || 'Решение модерации. Напишите в поддержку, если не согласны.'}
            </Text>
          </Animated.View>
        )}

        <Tabs area={area} onSelect={selectArea} />

        <Animated.View entering={FadeIn.delay(120).duration(500)}>
          <HouseScene
            area={area}
            stage={stage}
            roomId={roomId}
            focusedObjectId={activeObject?.id ?? null}
            onOpenHouse={() => setStage('open')}
            onSelectRoom={(room: Room) => {
              setRoomId(room.id);
              setStage('room');
            }}
            onSelectObject={pickObject}
            onBack={goBack}
            paused={sceneHidden}
          />
        </Animated.View>

        {/* Подпись адреса: перекрёстное затухание при смене места */}
        <View style={styles.captionWrap}>
          <Animated.Text
            key={`${activeAddress}-${caption}`}
            entering={FadeInDown.duration(280)}
            exiting={FadeOutUp.duration(220)}
            style={styles.houseCaption}
          >
            {activeAddress} · {caption}
          </Animated.Text>
        </View>

        {/* Дом списком — второй вход в тот же выбор объекта. Изометрия
            остаётся главной, но не единственной: кому-то перечень привычнее,
            а скринридеру доступен только он */}
        <Animated.View entering={FadeIn.delay(200).duration(400)} style={styles.listLinkWrap}>
          <PressableScale
            style={styles.listLink}
            onPress={() => setListOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Выбрать объект из списка"
          >
            <Glyph glyph="🗂️" size={15} colors={themedIconColors(t)} />
            <Text style={styles.listLinkText}>Выбрать из списка</Text>
          </PressableScale>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={styles.sectionTitle}>
          Недавние заказы
        </Animated.Text>

        {orders.length === 0 ? (
          <Animated.View entering={FadeIn.delay(260).duration(400)} style={styles.emptyWrap}>
            <EmptyScene kind="orders" />
            <Text style={styles.emptyTitle}>Пока нет заказов</Text>
            <Text style={styles.emptySub}>
              Коснитесь объекта в доме, чтобы создать первую заявку
            </Text>
          </Animated.View>
        ) : (
          orders.map((order, i) => {
            // Пока заявка в поиске, полезнее числа откликов, чем слово «Поиск
            // мастера»: именно оно говорит, есть ли что решать
            const pending = (order.offers ?? []).filter((o) => o.status === 'pending').length;
            const waitingReview = order.status === 'Завершена' && !order.reviewed;
            // Статусы, где дело за клиентом, зовут действием, а не названием
            // состояния — и зелёным, как всё, что ждёт его решения
            const waitingConfirm = order.status === 'Ждёт подтверждения';
            return (
              <Animated.View
                key={order.id}
                entering={FadeInDown.delay(
                  mountedWithStagger ? 240 + Math.min(i, 8) * STAGGER : 0,
                ).duration(360)}
                exiting={FadeOut.duration(180)}
                layout={LinearTransition.springify().damping(20).stiffness(170)}
              >
                <PressableScale style={styles.orderItem} onPress={() => setOpenedOrderId(order.id)}>
                  {order.photoUri ? (
                    <Image source={{ uri: order.photoUri }} style={styles.orderPhoto} />
                  ) : null}
                  <View style={styles.orderBody}>
                    <Text style={styles.orderTitle}>{order.title}</Text>
                    {order.comment ? (
                      <Text style={styles.orderComment} numberOfLines={1}>
                        {order.comment}
                      </Text>
                    ) : null}
                    <Text style={styles.orderDate}>{order.date}</Text>
                  </View>
                  {pending > 0 ? (
                    <Text style={[styles.orderStatus, { color: t.accent }]}>
                      {counted(pending, 'предложение', 'предложения', 'предложений')}
                    </Text>
                  ) : waitingConfirm ? (
                    <Text style={[styles.orderStatus, { color: t.accent }]}>
                      Подтвердите работу
                    </Text>
                  ) : waitingReview ? (
                    <Text style={[styles.orderStatus, { color: t.accent }]}>Оцените работу</Text>
                  ) : (
                    <Text style={[styles.orderStatus, { color: statusColor(order.status, t) }]}>
                      {order.status}
                    </Text>
                  )}
                </PressableScale>
              </Animated.View>
            );
          })
        )}
      </ScrollView>

      {/* Дропдаун адреса — поверх экрана, с прозрачным скримом: любое
          касание мимо закрывает его, как принято у всплывающих меню */}
      {addrOpen && (
        <>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeAddrDropdown}
            accessibilityLabel="Закрыть список адресов"
          />
          <Animated.View
            entering={FadeInDown.duration(240)}
            exiting={FadeOutUp.duration(180)}
            style={[styles.addrCard, { top: insets.top + 46 }]}
          >
            {addresses.map((addr) => (
              <PressableScale
                key={addr}
                style={styles.addrRow}
                onPress={() => {
                  onSelectAddress(addr);
                  closeAddrDropdown();
                }}
              >
                <Glyph glyph="🏡" size={18} colors={themedIconColors(t)} />
                <Text style={styles.addrText}>{addr}</Text>
                {addr === activeAddress && <Text style={styles.addrCheck}>✓</Text>}
              </PressableScale>
            ))}
            <View style={styles.addrDivider} />
            {addrAdding ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.addrRow}>
                <Glyph glyph="🏡" size={18} colors={themedIconColors(t)} />
                <TextInput
                  style={styles.addrInput}
                  value={addrDraft}
                  onChangeText={setAddrDraft}
                  placeholder="ул. Пушкина, 10"
                  placeholderTextColor={t.textMuted}
                  maxLength={200}
                  autoFocus
                  onSubmitEditing={submitNewAddress}
                  returnKeyType="done"
                />
                <PressableScale
                  onPress={submitNewAddress}
                  disabled={!addrDraft.trim()}
                  style={[styles.addrSaveBtn, !addrDraft.trim() && styles.addrSaveBtnDim]}
                  hitSlop={5}
                  accessibilityRole="button"
                  accessibilityLabel="Сохранить адрес"
                >
                  <Text style={styles.addrSaveText}>✓</Text>
                </PressableScale>
              </Animated.View>
            ) : (
              <PressableScale style={styles.addrRow} onPress={() => setAddrAdding(true)}>
                <Text style={styles.addrIcon}>＋</Text>
                <Text style={[styles.addrText, styles.addrTextAdd]}>Добавить адрес</Text>
              </PressableScale>
            )}
          </Animated.View>
        </>
      )}

      {listOpen && (
        <ObjectListSheet
          onClose={() => setListOpen(false)}
          onPick={(obj) => {
            setListOpen(false);
            pickObject(obj);
          }}
        />
      )}

      {activeObject && (
        <ActionSheet
          object={activeObject}
          address={activeAddress}
          onClose={() => setActiveObject(null)}
          onComplete={completeOrder}
        />
      )}

      {openedOrder && (
        <OrderSheet
          order={openedOrder}
          onClose={() => setOpenedOrderId(null)}
          onCancel={() => {
            onCancelOrder(openedOrder.id);
            setOpenedOrderId(null);
          }}
          onConfirmDone={() => onConfirmOrder(openedOrder.id)}
          onReturnToWork={() => onReturnOrder(openedOrder.id)}
          onReportMaster={(text) => onReportMaster(openedOrder.id, text)}
          onBlockMaster={() => {
            if (openedOrder.masterId) {
              onBlockMaster(openedOrder.masterId, openedOrder.masterName ?? 'Мастер');
            }
          }}
          masterBlocked={!!openedOrder.masterId && blockedMasterIds.includes(openedOrder.masterId)}
          onChoosePaymentMethod={(method) => onChoosePaymentMethod(openedOrder.id, method)}
          onMarkPaid={() => onMarkPaid(openedOrder.id)}
          onAcceptOffer={(masterId) => onAcceptOffer(openedOrder.id, masterId)}
          onSubmitReview={(stars, text) => onSubmitReview(openedOrder.id, stars, text)}
          onAcceptPrice={() => onAcceptPrice(openedOrder.id)}
          onDeclinePrice={() => onDeclinePrice(openedOrder.id)}
          onChat={() => {
            setOpenedOrderId(null);
            onOpenOrderChat(openedOrder.id);
          }}
          // У заявок до появления objectId повторять нечего — кнопки не будет
          onRepeat={
            openedOrder.objectId && openedOrder.serviceLabel
              ? () => {
                  setOpenedOrderId(null);
                  setRepeatOrder(openedOrder);
                }
              : undefined
          }
        />
      )}

      {repeatOrder && (
        <RepeatSheet
          order={repeatOrder}
          masterBlocked={!!repeatOrder.masterId && blockedMasterIds.includes(repeatOrder.masterId)}
          onClose={() => setRepeatOrder(null)}
          onSubmit={(draft) => {
            onCreateOrder(draft);
            setRepeatOrder(null);
          }}
        />
      )}
    </View>
  );
}

// Стрелка заголовка: мягко переворачивается при открытии дропдауна
function HeaderChevron({ open }: { open: boolean }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = withSpring(open ? 1 : 0, springs.card);
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));
  return <Animated.Text style={[styles.headerChevron, style]}>▾</Animated.Text>;
}

// Вкладки: подсветка не перепрыгивает, а скользит пружиной к выбранной
function Tabs({ area, onSelect }: { area: AreaId; onSelect: (a: AreaId) => void }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const [rowW, setRowW] = useState(0);
  const pillW = rowW > 0 ? (rowW - 8) / 3 : 0;
  const idx = AREAS.indexOf(area);

  // Подсветка едет к выбранной вкладке, но первое появление — уже на месте:
  // ширина известна только после замера, и пружина от нуля читалась бы как рывок
  const x = useSharedValue(0);
  const measured = useRef(false);
  useEffect(() => {
    if (pillW <= 0) return;
    if (measured.current) x.value = withSpring(idx * pillW, springs.card);
    else x.value = idx * pillW;
    measured.current = true;
  }, [idx, pillW, x]);
  const pillStyle = useAnimatedStyle(() => ({
    width: pillW,
    transform: [{ translateX: x.value }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.delay(60).duration(420)}
      style={styles.tabsRow}
      onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
    >
      {rowW > 0 && <Animated.View style={[styles.tabPill, pillStyle]} />}
      {AREAS.map((item) => (
        <TabLabel key={item} label={item} selected={area === item} onPress={() => onSelect(item)} />
      ))}
    </Animated.View>
  );
}

function TabLabel({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(selected ? 1 : 0, { duration: 220 });
  }, [selected, on]);
  const style = useAnimatedStyle(() => ({
    color: interpolateColor(on.value, [0, 1], [t.textSoft, t.accentStrong]),
  }));
  return (
    <PressableScale style={styles.tab} onPress={onPress}>
      <Animated.Text style={[styles.tabText, style]}>{label}</Animated.Text>
    </PressableScale>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    container: { flex: 1 },
    // Верхний отступ добавляется на месте — от системной зоны прибора
    content: { padding: 16, paddingBottom: 120 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
    header: { fontSize: 20, fontFamily: FONTS.display, color: t.text },
    headerChevron: { fontSize: 15, color: t.accent, fontWeight: '800', marginTop: 2 },
    blockedBanner: {
      backgroundColor: t.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.danger,
      padding: 14,
      marginBottom: 12,
    },
    blockedBannerTitle: { fontSize: 13, fontWeight: '800', color: t.danger },
    blockedBannerText: {
      fontSize: 12,
      fontWeight: '400',
      color: t.text,
      marginTop: 5,
      lineHeight: 17,
    },
    addrCard: {
      position: 'absolute',
      left: 16,
      right: 16,
      zIndex: 20,
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      paddingVertical: 4,
      shadowColor: t.shadow,
      shadowOpacity: 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    addrRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    addrIcon: { fontSize: 15 },
    addrText: { flex: 1, fontWeight: '700', fontSize: 13.5, color: t.text },
    addrTextAdd: { color: t.accent },
    addrCheck: { color: t.accent, fontWeight: '800', fontSize: 14 },
    addrInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 6,
      fontSize: 13,
      fontWeight: '700',
      color: t.text,
      backgroundColor: t.inputBg,
    },
    addrSaveBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addrSaveBtnDim: { backgroundColor: t.disabled },
    addrSaveText: { color: t.onAccent, fontWeight: '800', fontSize: 14 },
    addrDivider: { height: 1, backgroundColor: t.divider, marginHorizontal: 14 },
    tabsRow: {
      flexDirection: 'row',
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 16,
      padding: 4,
      marginBottom: 16,
    },
    tabPill: {
      position: 'absolute',
      top: 4,
      bottom: 4,
      left: 4,
      borderRadius: 12,
      backgroundColor: t.accentSoft,
    },
    tab: { flex: 1, paddingVertical: 11, alignItems: 'center' },
    tabText: { fontWeight: '700', fontSize: 13.5 },
    captionWrap: {
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
      marginBottom: 20,
    },
    houseCaption: { position: 'absolute', color: t.textMuted, fontWeight: '500', fontSize: 12.5 },
    listLinkWrap: { alignItems: 'center', marginTop: -8, marginBottom: 16 },
    listLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
    },
    listLinkText: { fontWeight: '700', fontSize: 12.5, color: t.accent },
    sectionTitle: { fontSize: 15, fontFamily: FONTS.heading, marginBottom: 10, color: t.text },
    orderItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: t.card,
      borderRadius: 14,
      padding: 12,
      marginBottom: 9,
      borderWidth: 1,
      borderColor: t.border,
    },
    orderBody: { flex: 1, marginRight: 8 },
    orderPhoto: {
      width: 40,
      height: 40,
      borderRadius: 10,
      marginRight: 10,
      backgroundColor: t.chip,
    },
    orderTitle: { fontWeight: '700', fontSize: 13.5, color: t.text },
    orderComment: { color: t.textSoft, fontSize: 11.5, marginTop: 2, fontWeight: '600' },
    orderDate: { color: t.textMuted, fontSize: 11.5, marginTop: 2 },
    orderStatus: { fontWeight: '700', fontSize: 11.5 },
    emptyWrap: {
      alignItems: 'center',
      paddingVertical: 28,
      backgroundColor: t.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
    },
    emptyIcon: { fontSize: 30, marginBottom: 8 },
    emptyTitle: { fontWeight: '800', fontSize: 14, color: t.text },
    emptySub: {
      color: t.textMuted,
      fontWeight: '400',
      fontSize: 11.5,
      marginTop: 4,
      textAlign: 'center',
      paddingHorizontal: 30,
    },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
