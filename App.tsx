import { ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { BottomTabs, TabId } from './components/BottomTabs';
import { OrdersScreen, Order } from './screens/OrdersScreen';
import { MessagesScreen, Thread } from './screens/MessagesScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { MasterScreen } from './screens/MasterScreen';
import { OrderDraft } from './components/ActionSheet';
import { palettes, ThemeContext, ThemeMode } from './theme';

const USER_EMAIL = 'dmtr0v@icloud.com';
const DEFAULT_ADDRESS = 'ул. Ленина, 24';
const MASTER_THREAD_ID = 'master';
const SUPPORT_THREAD_ID = 'support';

// Ответы «живого» собеседника — подбираются по очереди, чтобы чат не молчал
const MASTER_REPLIES = [
  'Понял вас! Уточню детали и вернусь с ответом.',
  'Принято. Могу подъехать завтра после 14:00 — удобно?',
  'Хорошо, зафиксировал. Если появятся фото — присылайте прямо сюда.',
  'Спасибо, всё ясно. Возьму с собой нужный инструмент.',
];
const SUPPORT_REPLIES = [
  'Спасибо за обращение! Разберёмся и ответим в течение часа.',
  'Передали вопрос специалисту — он свяжется с вами здесь.',
  'Приняли в работу. Что-то ещё подсказать?',
];

function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function now() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let msgSeq = 0;
const msgId = () => `${Date.now()}-${msgSeq++}`;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('orders');
  // Заказы и переписка появляются только по факту действий пользователя — без «фейковых» затравок
  const [orders, setOrders] = useState<Order[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [userName, setUserName] = useState('Дмитрий');
  // Адреса пользователя: активный показывается в сцене, подписях и новых заявках
  const [addresses, setAddresses] = useState<string[]>([DEFAULT_ADDRESS]);
  const [activeAddress, setActiveAddress] = useState(DEFAULT_ADDRESS);
  // Тема оформления — переключается тумблером в настройках профиля
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  // Открытая переписка — это вложенный экран поверх вкладки «Сообщения»
  const [chatOpen, setChatOpen] = useState(false);
  // Шторки поверх «Заказов» (действия по объекту, детали заказа) тоже прячут нижнюю панель
  const [overlayOpen, setOverlayOpen] = useState(false);
  // Просьба открыть конкретный чат (из профиля или из деталей заказа)
  const [openThreadRequest, setOpenThreadRequest] = useState<string | null>(null);
  // Режим мастера — оверлей поверх всего приложения (экран остаётся смонтированным,
  // чтобы сессия мастера и его заявки не сбрасывались при выходе в профиль)
  const [masterOpen, setMasterOpen] = useState(false);
  // В каком чате сейчас «печатает» собеседник
  const [typingThreadId, setTypingThreadId] = useState<string | null>(null);

  // Все отложенные события (ответы мастера, смена статуса) — в одном месте,
  // чтобы аккуратно погасить их при размонтировании
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const replyIdx = useRef(0);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  // Сообщение от мастера/поддержки: дописывает в тред или создаёт его
  const incomingMessage = (threadId: string, name: string, icon: string, text: string) => {
    setThreads((prev) => {
      const msg = { id: msgId(), from: 'master' as const, text, time: now() };
      const existing = prev.find((t) => t.id === threadId);
      if (existing) {
        return prev.map((t) => (t.id === threadId
          ? { ...t, unread: true, messages: [...t.messages, msg] }
          : t));
      }
      return [{ id: threadId, name, icon, unread: true, messages: [msg] }, ...prev];
    });
  };

  const createOrder = ({ title, comment, photoUri }: OrderDraft) => {
    const orderId = String(Date.now());
    setOrders((prev) => [
      { id: orderId, title, date: today(), status: 'Поиск мастера', comment, photoUri, address: activeAddress },
      ...prev,
    ]);
    incomingMessage(MASTER_THREAD_ID, 'Мастер', '🧑‍🔧', `Заявка «${title}» принята. Подбираем мастера…`);

    // Через несколько секунд мастер «находится» и берёт заявку в работу
    later(6000, () => {
      setOrders((prev) => prev.map((o) => (o.id === orderId && o.status === 'Поиск мастера'
        ? { ...o, status: 'В работе' }
        : o)));
      incomingMessage(
        MASTER_THREAD_ID, 'Мастер', '🧑‍🔧',
        'Я взял вашу заявку в работу. Напишите сюда, если есть детали — или пришлите фото.',
      );
    });

    // Ещё чуть позже мастер заканчивает и просит подтвердить результат
    later(24000, () => {
      setOrders((prev) => prev.map((o) => (o.id === orderId && o.status === 'В работе'
        ? { ...o, status: 'Ждёт подтверждения' }
        : o)));
      incomingMessage(
        MASTER_THREAD_ID, 'Мастер', '🧑‍🔧',
        `Работа по заявке «${title}» выполнена. Проверьте результат и подтвердите завершение в карточке заказа.`,
      );
    });
  };

  // Пользователь подтверждает, что работа выполнена — заказ закрывается
  const confirmOrderDone = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    setOrders((prev) => prev.map((o) => (o.id === orderId && o.status === 'Ждёт подтверждения'
      ? { ...o, status: 'Завершена' }
      : o)));
    if (order) {
      incomingMessage(
        MASTER_THREAD_ID, 'Мастер', '🧑‍🔧',
        `Спасибо, что подтвердили заявку «${order.title}»! Обращайтесь, если понадобится помощь.`,
      );
    }
  };

  // Новый адрес: добавляем в список (без дублей) и сразу делаем активным
  const addAddress = (addr: string) => {
    const trimmed = addr.trim();
    if (!trimmed) return;
    setAddresses((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setActiveAddress(trimmed);
  };

  const cancelOrder = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: 'Отменена' } : o)));
    if (order) {
      incomingMessage(
        MASTER_THREAD_ID, 'Мастер', '🧑‍🔧',
        `Заявка «${order.title}» отменена. Если передумаете — создайте новую в любой момент.`,
      );
    }
  };

  const markThreadRead = (threadId: string) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread: false } : t)));
  };

  const sendMessage = (threadId: string, text: string) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId
      ? { ...t, messages: [...t.messages, { id: msgId(), from: 'user', text, time: now() }] }
      : t)));

    // Собеседник «читает», печатает и отвечает — с живыми паузами
    later(700, () => setTypingThreadId(threadId));
    later(2300, () => {
      setTypingThreadId((cur) => (cur === threadId ? null : cur));
      const pool = threadId === SUPPORT_THREAD_ID ? SUPPORT_REPLIES : MASTER_REPLIES;
      const reply = pool[replyIdx.current % pool.length];
      replyIdx.current += 1;
      if (threadId === SUPPORT_THREAD_ID) {
        incomingMessage(SUPPORT_THREAD_ID, 'Поддержка', '🛟', reply);
      } else {
        incomingMessage(threadId, 'Мастер', '🧑‍🔧', reply);
      }
    });
  };

  // Открыть чат из другого экрана: создаём тред с приветствием, если его ещё нет
  const openChat = (threadId: string) => {
    setThreads((prev) => {
      if (prev.find((t) => t.id === threadId)) return prev;
      const greeting = threadId === SUPPORT_THREAD_ID
        ? { name: 'Поддержка', icon: '🛟', text: 'Здравствуйте! Чем можем помочь?' }
        : { name: 'Мастер', icon: '🧑‍🔧', text: 'На связи! Опишите, что случилось.' };
      return [
        {
          id: threadId,
          name: greeting.name,
          icon: greeting.icon,
          unread: false,
          messages: [{ id: msgId(), from: 'master' as const, text: greeting.text, time: now() }],
        },
        ...prev,
      ];
    });
    setActiveTab('messages');
    setOpenThreadRequest(threadId);
  };

  const hasUnreadMessages = threads.some((t) => t.unread);
  const activeOrders = orders.filter(
    (o) => o.status !== 'Отменена' && o.status !== 'Завершена',
  ).length;

  return (
    <ThemeContext.Provider
      value={{ mode: themeMode, colors: palettes[themeMode], setMode: setThemeMode }}
    >
    <View style={[styles.root, { backgroundColor: palettes[themeMode].bg }]}>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />

      <ScreenLayer active={activeTab === 'orders'}>
        <OrdersScreen
          orders={orders}
          addresses={addresses}
          activeAddress={activeAddress}
          onSelectAddress={setActiveAddress}
          onAddAddress={addAddress}
          onCreateOrder={createOrder}
          onCancelOrder={cancelOrder}
          onConfirmOrder={confirmOrderDone}
          onOpenMasterChat={() => openChat(MASTER_THREAD_ID)}
          onOverlayOpenChange={setOverlayOpen}
        />
      </ScreenLayer>

      <ScreenLayer active={activeTab === 'messages'}>
        <MessagesScreen
          threads={threads}
          typingThreadId={typingThreadId}
          openRequestId={openThreadRequest}
          onOpenRequestHandled={() => setOpenThreadRequest(null)}
          onOpenThread={markThreadRead}
          onSendMessage={sendMessage}
          onThreadOpenChange={setChatOpen}
        />
      </ScreenLayer>

      <ScreenLayer active={activeTab === 'profile'}>
        <ProfileScreen
          name={userName}
          onChangeName={setUserName}
          email={USER_EMAIL}
          address={activeAddress}
          ordersTotal={orders.length}
          ordersActive={activeOrders}
          onContactSupport={() => openChat(SUPPORT_THREAD_ID)}
          onOpenMaster={() => setMasterOpen(true)}
        />
      </ScreenLayer>

      <BottomTabs
        active={activeTab}
        onSelect={setActiveTab}
        hasUnreadMessages={hasUnreadMessages}
        hidden={
          (activeTab === 'messages' && chatOpen)
          || (activeTab === 'orders' && overlayOpen)
          || masterOpen
        }
      />

      <MasterScreen open={masterOpen} onClose={() => setMasterOpen(false)} />
    </View>
    </ThemeContext.Provider>
  );
}

// Каждый экран остаётся смонтированным — переключение вкладок не сбрасывает его состояние,
// а лишь тихо перекрёстно затухает (без резких скачков)
function ScreenLayer({ active, children }: { active: boolean; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(active ? 1 : 0, { duration: 300 }),
    transform: [{ translateY: withTiming(active ? 0 : 8, { duration: 300 }) }],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents={active ? 'auto' : 'none'}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
