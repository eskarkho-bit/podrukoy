import { router } from 'expo-router';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { db } from '../firebaseConfig';
import { ChatMessage, Thread } from '../screens/MessagesScreen';
import { Order } from '../screens/OrdersScreen';
import { palettes, ThemeContext, ThemeMode } from '../theme';
import { useAuth } from './AuthState';
import { OrderDraft } from './ActionSheet';
import { getPushToken, notifyLocal } from './notifications';
import { uploadOrderPhoto } from './photoUpload';

// Общее состояние приложения. Раньше жило в App.tsx и раздавалось пропсами —
// с переходом на роутер экраны стали отдельными маршрутами, и общий стейт
// поднялся сюда. Данные теперь в Firestore: экраны об этом не знают, они
// по-прежнему получают готовые массивы и колбэки.

const DEFAULT_ADDRESS = 'ул. Ленина, 24';
export const MASTER_THREAD_ID = 'master';
export const SUPPORT_THREAD_ID = 'support';

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

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

type AppState = {
  orders: Order[];
  threads: Thread[];
  userName: string;
  userEmail: string;
  addresses: string[];
  activeAddress: string;
  typingThreadId: string | null;
  openThreadRequest: string | null;
  chatOpen: boolean;
  overlayOpen: boolean;
  masterOpen: boolean;
  hasUnreadMessages: boolean;
  ordersActive: number;
  setUserName: (name: string) => void;
  setActiveAddress: (addr: string) => void;
  setChatOpen: (open: boolean) => void;
  setOverlayOpen: (open: boolean) => void;
  setMasterOpen: (open: boolean) => void;
  clearOpenThreadRequest: () => void;
  createOrder: (draft: OrderDraft) => void;
  confirmOrderDone: (orderId: string) => void;
  cancelOrder: (orderId: string) => void;
  acceptPrice: (orderId: string) => void;
  declinePrice: (orderId: string) => void;
  addAddress: (addr: string) => void;
  markThreadRead: (threadId: string) => void;
  sendMessage: (threadId: string, text: string) => void;
  openChat: (threadId: string) => void;
};

const AppStateContext = createContext<AppState | null>(null);

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState вызван вне AppStateProvider');
  return ctx;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [orders, setOrders] = useState<Order[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [userName, setUserNameLocal] = useState('');
  const [addresses, setAddresses] = useState<string[]>([DEFAULT_ADDRESS]);
  const [activeAddress, setActiveAddressLocal] = useState(DEFAULT_ADDRESS);
  // Тема оформления — переключается тумблером в настройках профиля
  const [themeMode, setThemeModeLocal] = useState<ThemeMode>('light');
  // Открытая переписка — это вложенный экран поверх вкладки «Сообщения»
  const [chatOpen, setChatOpen] = useState(false);
  // Шторки поверх «Заказов» (действия по объекту, детали заказа) тоже прячут нижнюю панель
  const [overlayOpen, setOverlayOpen] = useState(false);
  // Просьба открыть конкретный чат (из профиля или из деталей заказа)
  const [openThreadRequest, setOpenThreadRequest] = useState<string | null>(null);
  // Режим мастера — оверлей поверх всего приложения
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

  const userDoc = () => (uid ? doc(db, 'users', uid) : null);

  // ---------- профиль ----------
  // Документ создаётся при первом входе: раньше уйти в базу он не мог,
  // потому что правила разрешают запись только владельцу, а uid ещё не было.
  useEffect(() => {
    if (!uid) {
      setUserNameLocal('');
      setAddresses([DEFAULT_ADDRESS]);
      setActiveAddressLocal(DEFAULT_ADDRESS);
      return;
    }
    const ref = doc(db, 'users', uid);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setDoc(ref, {
          name: user?.displayName ?? 'Гость',
          email: user?.email ?? '',
          addresses: [DEFAULT_ADDRESS],
          activeAddress: DEFAULT_ADDRESS,
          themeMode: 'light',
          createdAt: serverTimestamp(),
        }).catch((e) => console.warn('Не удалось создать профиль:', e));
        return;
      }
      const d = snap.data();
      setUserNameLocal(d.name ?? '');
      setAddresses(Array.isArray(d.addresses) && d.addresses.length ? d.addresses : [DEFAULT_ADDRESS]);
      setActiveAddressLocal(d.activeAddress ?? DEFAULT_ADDRESS);
      setThemeModeLocal(d.themeMode === 'dark' ? 'dark' : 'light');
    }, (e) => console.warn('Профиль недоступен:', e));
  }, [uid, user?.displayName, user?.email]);

  // ---------- push-токен ----------
  // Складываем в профиль список токенов: у одного человека может быть
  // несколько устройств, и серверу потом нужно знать их все
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    getPushToken().then((token) => {
      if (!alive || !token) return;
      updateDoc(doc(db, 'users', uid), { pushTokens: arrayUnion(token) })
        .catch((e) => console.warn('Не удалось сохранить push-токен:', e));
    });
    return () => { alive = false; };
  }, [uid]);

  // ---------- заказы ----------
  useEffect(() => {
    if (!uid) {
      setOrders([]);
      return;
    }
    // Без orderBy: связка where + orderBy по разным полям потребовала бы
    // составного индекса, а без него запрос падает. Сортируем на месте.
    const q = query(collection(db, 'orders'), where('clientId', '==', uid));
    return onSnapshot(q, (snap) => {
      setOrders(snap.docs.map((d) => {
        const v = d.data();
        return {
          id: d.id,
          title: v.title,
          date: v.date,
          status: v.status,
          comment: v.comment ?? undefined,
          photoUri: v.photoUrl ?? null,
          address: v.address ?? undefined,
          masterName: v.masterName ?? null,
          price: v.price ?? null,
          priceStatus: v.priceStatus ?? 'none',
          agreedPrice: v.agreedPrice ?? null,
          // для сортировки: у только что созданной заявки serverTimestamp
          // ещё null, поэтому такие показываем сверху
          createdMs: v.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER,
        };
      }).sort((a, b) => b.createdMs - a.createdMs)
        .map(({ createdMs, ...o }) => { void createdMs; return o; }));
    }, (e) => console.warn('Заказы недоступны:', e));
  }, [uid]);

  // ---------- реакция на действия мастера ----------
  // Заявку теперь меняет другой человек со своего устройства. Подписка приносит
  // изменения, а здесь они превращаются в уведомление и сообщение в чате.
  const seenOffers = useRef(new Map<string, number>());
  const seenStatus = useRef(new Map<string, string>());
  const primed = useRef(false);

  useEffect(() => {
    if (!uid) {
      seenOffers.current.clear();
      seenStatus.current.clear();
      primed.current = false;
      return;
    }

    orders.forEach((o) => {
      const prevStatus = seenStatus.current.get(o.id);
      seenStatus.current.set(o.id, o.status);

      const offered = o.priceStatus === 'offered' && o.price != null;
      const prevOffer = seenOffers.current.get(o.id);
      if (offered) seenOffers.current.set(o.id, o.price as number);
      else seenOffers.current.delete(o.id);

      // Первый проход только запоминает состояние: иначе при каждом запуске
      // приложения сыпались бы уведомления о старых событиях
      if (!primed.current) return;

      if (offered && prevOffer !== o.price) {
        const who = o.masterName ? `Мастер ${o.masterName}` : 'Мастер';
        const isChange = prevOffer != null;
        notifyLocal(
          isChange ? 'Мастер изменил цену' : 'Мастер предложил цену',
          `${o.title} — ${rub(o.price as number)}`,
          { href: '/' },
        );
        incomingMessage(
          MASTER_THREAD_ID, 'Мастер', '🧑‍🔧',
          isChange
            ? `${who} изменил цену по заявке «${o.title}» — теперь ${rub(o.price as number)}. Примите или отклоните в карточке заказа.`
            : `${who} готов взяться за «${o.title}» за ${rub(o.price as number)}. Примите или отклоните в карточке заказа.`,
        );
      }

      if (prevStatus && prevStatus !== o.status && o.status === 'Ждёт подтверждения') {
        notifyLocal('Работа выполнена', `Подтвердите завершение заявки «${o.title}»`, { href: '/' });
        incomingMessage(
          MASTER_THREAD_ID, 'Мастер', '🧑‍🔧',
          `Работа по заявке «${o.title}» выполнена. Проверьте результат и подтвердите завершение в карточке заказа.`,
        );
      }
    });

    primed.current = true;
  }, [orders, uid]);

  // ---------- переписка ----------
  // Треды лежат в поддереве пользователя, поэтому доступны только ему.
  // На каждый тред — своя подписка на сообщения; их всего два (мастер, поддержка).
  useEffect(() => {
    if (!uid) {
      setThreads([]);
      return;
    }
    const msgUnsubs = new Map<string, () => void>();

    const unsubThreads = onSnapshot(
      query(collection(db, 'users', uid, 'threads'), orderBy('updatedAt', 'desc')),
      (snap) => {
        const ids = new Set(snap.docs.map((d) => d.id));

        setThreads((prev) => snap.docs.map((d) => {
          const v = d.data();
          const old = prev.find((t) => t.id === d.id);
          return {
            id: d.id,
            name: v.name,
            icon: v.icon,
            unread: !!v.unread,
            messages: old?.messages ?? [],
          };
        }));

        // подписываемся на сообщения новых тредов
        snap.docs.forEach((d) => {
          if (msgUnsubs.has(d.id)) return;
          const unsub = onSnapshot(
            query(collection(db, 'users', uid, 'threads', d.id, 'messages'), orderBy('createdAt', 'asc')),
            (msgSnap) => {
              const messages: ChatMessage[] = msgSnap.docs.map((m) => {
                const v = m.data();
                return { id: m.id, from: v.from, text: v.text, time: v.time };
              });
              setThreads((prev) => prev.map((t) => (t.id === d.id ? { ...t, messages } : t)));
            },
            (e) => console.warn('Сообщения недоступны:', e),
          );
          msgUnsubs.set(d.id, unsub);
        });

        // отписываемся от исчезнувших
        msgUnsubs.forEach((unsub, id) => {
          if (!ids.has(id)) {
            unsub();
            msgUnsubs.delete(id);
          }
        });
      },
      (e) => console.warn('Переписка недоступна:', e),
    );

    return () => {
      unsubThreads();
      msgUnsubs.forEach((unsub) => unsub());
      msgUnsubs.clear();
    };
  }, [uid]);

  // ---------- действия ----------

  // Сообщение от мастера/поддержки: дописывает в тред или создаёт его
  const incomingMessage = async (threadId: string, name: string, icon: string, text: string) => {
    if (!uid) return;
    const threadRef = doc(db, 'users', uid, 'threads', threadId);
    try {
      await setDoc(threadRef, { name, icon, unread: true, updatedAt: serverTimestamp() }, { merge: true });
      await addDoc(collection(threadRef, 'messages'), {
        from: 'master', text, time: now(), createdAt: serverTimestamp(),
      });
      // Сообщение от мастера — ровно тот случай, ради которого нужны уведомления
      notifyLocal(name, text, { href: '/messages' });
    } catch (e) {
      console.warn('Не удалось доставить сообщение:', e);
    }
  };

  const createOrder = async ({ title, comment, photoUri }: OrderDraft) => {
    if (!uid) return;
    // Фото уезжает в Storage: локальный URI с телефона другому устройству
    // ничего не скажет. Но Storage требует платного тарифа Blaze и может быть
    // не подключён — тогда заявку всё равно создаём, оставив локальную ссылку.
    // Она видна на своём устройстве и не мешает остальному.
    let photoUrl: string | null = photoUri ?? null;
    if (photoUri) {
      try {
        photoUrl = await uploadOrderPhoto(uid, photoUri);
      } catch (e) {
        console.warn('Фото не загрузилось — заявка создаётся с локальной ссылкой:', e);
      }
    }

    try {
      const ref = await addDoc(collection(db, 'orders'), {
        clientId: uid,
        clientName: userName || 'Клиент',
        masterId: null,
        masterName: null,
        title,
        date: today(),
        status: 'Поиск мастера',
        comment: comment ?? '',
        photoUrl,
        address: activeAddress,
        // Цена появится, когда мастер её предложит
        price: null,
        priceStatus: 'none',
        agreedPrice: null,
        agreedAt: null,
        priceHistory: [],
        createdAt: serverTimestamp(),
      });
      void ref;
      // Дальше заявку двигает живой мастер: он видит её в своём разделе,
      // предлагает цену и меняет статус. Имитации здесь больше нет.
      incomingMessage(MASTER_THREAD_ID, 'Мастер', '🧑‍🔧', `Заявка «${title}» принята. Подбираем мастера…`);
    } catch (e) {
      console.warn('Не удалось создать заявку:', e);
    }
  };

  // ---------- согласование цены ----------

  // Клиент соглашается с предложенной ценой. Именно этот момент делает цену
  // согласованной: agreedPrice заполняется только здесь и только по явному
  // действию человека.
  const acceptPrice = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.priceStatus !== 'offered' || order.price == null) return;
    updateDoc(doc(db, 'orders', orderId), {
      priceStatus: 'accepted',
      agreedPrice: order.price,
      agreedAt: serverTimestamp(),
      status: 'В работе',
      priceHistory: arrayUnion({
        amount: order.price,
        by: 'client',
        action: 'accepted',
        at: new Date().toISOString(),
      }),
    }).catch((e) => console.warn('Не удалось принять цену:', e));

    incomingMessage(
      MASTER_THREAD_ID, 'Мастер', '🧑‍🔧',
      `Спасибо, цена ${rub(order.price)} согласована. Приступаю к работе.`,
    );
  };

  // Отклонение не закрывает заявку: мастер может предложить другую цену
  const declinePrice = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.priceStatus !== 'offered' || order.price == null) return;
    updateDoc(doc(db, 'orders', orderId), {
      priceStatus: 'declined',
      priceHistory: arrayUnion({
        amount: order.price,
        by: 'client',
        action: 'declined',
        at: new Date().toISOString(),
      }),
    }).catch((e) => console.warn('Не удалось отклонить цену:', e));
  };

  // Пользователь подтверждает, что работа выполнена — заказ закрывается
  const confirmOrderDone = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'Ждёт подтверждения') return;
    updateDoc(doc(db, 'orders', orderId), { status: 'Завершена' }).catch(() => {});
    incomingMessage(
      MASTER_THREAD_ID, 'Мастер', '🧑‍🔧',
      `Спасибо, что подтвердили заявку «${order.title}»! Обращайтесь, если понадобится помощь.`,
    );
  };

  const cancelOrder = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    updateDoc(doc(db, 'orders', orderId), { status: 'Отменена' }).catch(() => {});
    incomingMessage(
      MASTER_THREAD_ID, 'Мастер', '🧑‍🔧',
      `Заявка «${order.title}» отменена. Если передумаете — создайте новую в любой момент.`,
    );
  };

  // Новый адрес: добавляем в список (без дублей) и сразу делаем активным
  const addAddress = (addr: string) => {
    const trimmed = addr.trim();
    if (!trimmed) return;
    const next = addresses.includes(trimmed) ? addresses : [...addresses, trimmed];
    setAddresses(next);
    setActiveAddressLocal(trimmed);
    const ref = userDoc();
    if (ref) updateDoc(ref, { addresses: next, activeAddress: trimmed }).catch(() => {});
  };

  const setActiveAddress = (addr: string) => {
    setActiveAddressLocal(addr);
    const ref = userDoc();
    if (ref) updateDoc(ref, { activeAddress: addr }).catch(() => {});
  };

  const setUserName = (name: string) => {
    setUserNameLocal(name);
    const ref = userDoc();
    if (ref) updateDoc(ref, { name }).catch(() => {});
  };

  const setThemeMode = (next: ThemeMode) => {
    setThemeModeLocal(next);
    const ref = userDoc();
    if (ref) updateDoc(ref, { themeMode: next }).catch(() => {});
  };

  const markThreadRead = (threadId: string) => {
    if (!uid) return;
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread: false } : t)));
    updateDoc(doc(db, 'users', uid, 'threads', threadId), { unread: false }).catch(() => {});
  };

  const sendMessage = async (threadId: string, text: string) => {
    if (!uid) return;
    const threadRef = doc(db, 'users', uid, 'threads', threadId);
    try {
      await setDoc(threadRef, { updatedAt: serverTimestamp() }, { merge: true });
      await addDoc(collection(threadRef, 'messages'), {
        from: 'user', text, time: now(), createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('Сообщение не отправлено:', e);
      return;
    }

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

  // Открыть чат из другого экрана: создаём тред с приветствием, если его ещё нет,
  // и переводим пользователя на вкладку «Сообщения»
  const openChat = async (threadId: string) => {
    if (uid && !threads.find((t) => t.id === threadId)) {
      const greeting = threadId === SUPPORT_THREAD_ID
        ? { name: 'Поддержка', icon: '🛟', text: 'Здравствуйте! Чем можем помочь?' }
        : { name: 'Мастер', icon: '🧑‍🔧', text: 'На связи! Опишите, что случилось.' };
      const threadRef = doc(db, 'users', uid, 'threads', threadId);
      try {
        await setDoc(threadRef, {
          name: greeting.name, icon: greeting.icon, unread: false, updatedAt: serverTimestamp(),
        }, { merge: true });
        await addDoc(collection(threadRef, 'messages'), {
          from: 'master', text: greeting.text, time: now(), createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('Не удалось открыть переписку:', e);
      }
    }
    setOpenThreadRequest(threadId);
    router.navigate('/messages');
  };

  const hasUnreadMessages = threads.some((t) => t.unread);
  const ordersActive = orders.filter(
    (o) => o.status !== 'Отменена' && o.status !== 'Завершена',
  ).length;

  const value: AppState = {
    orders,
    threads,
    userName,
    userEmail: user?.email ?? '',
    addresses,
    activeAddress,
    typingThreadId,
    openThreadRequest,
    chatOpen,
    overlayOpen,
    masterOpen,
    hasUnreadMessages,
    ordersActive,
    setUserName,
    setActiveAddress,
    setChatOpen,
    setOverlayOpen,
    setMasterOpen,
    clearOpenThreadRequest: () => setOpenThreadRequest(null),
    createOrder,
    confirmOrderDone,
    cancelOrder,
    acceptPrice,
    declinePrice,
    addAddress,
    markThreadRead,
    sendMessage,
    openChat,
  };

  return (
    <ThemeContext.Provider
      value={{ mode: themeMode, colors: palettes[themeMode], setMode: setThemeMode }}
    >
      <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
    </ThemeContext.Provider>
  );
}
