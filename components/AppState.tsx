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
export const SUPPORT_THREAD_ID = 'support';

// Поддержка отвечает заготовками — живой службы поддержки пока нет.
// С мастером переписка настоящая, там ничего не подставляется.
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
  // Переписка складывается из двух источников: чаты по заявкам (общие с
  // мастером, лежат в самой заявке) и обращение в поддержку (личное)
  const [orderThreads, setOrderThreads] = useState<Thread[]>([]);
  const [supportThreads, setSupportThreads] = useState<Thread[]>([]);
  // Прочитанность считаем на устройстве: писать её в базу на каждое открытие
  // чата — лишние запросы ради бейджа
  const [readThreads, setReadThreads] = useState<Set<string>>(new Set());
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

      // Только уведомление: писать сообщение «от мастера» нельзя — чат теперь
      // общий, и такое сообщение ушло бы от имени клиента. Само предложение
      // видно в карточке заказа.
      if (offered && prevOffer !== o.price) {
        notifyLocal(
          prevOffer != null ? 'Мастер изменил цену' : 'Мастер предложил цену',
          `${o.title} — ${rub(o.price as number)}`,
          { href: '/' },
        );
      }

      if (prevStatus && prevStatus !== o.status && o.status === 'Ждёт подтверждения') {
        notifyLocal('Работа выполнена', `Подтвердите завершение заявки «${o.title}»`, { href: '/' });
      }
    });

    primed.current = true;
  }, [orders, uid]);

  // ---------- переписка по заявкам ----------
  // Общий чат клиента и мастера лежит внутри самой заявки: права доступа
  // выводятся из неё, и обе стороны видят одни и те же сообщения.
  const orderIdsKey = orders.map((o) => o.id).join(',');

  useEffect(() => {
    if (!uid) {
      setOrderThreads([]);
      return;
    }
    const ids = orderIdsKey ? orderIdsKey.split(',') : [];
    if (!ids.length) {
      setOrderThreads([]);
      return;
    }

    const unsubs = ids.map((orderId) => onSnapshot(
      query(collection(db, 'orders', orderId, 'messages'), orderBy('createdAt', 'asc')),
      (snap) => {
        const messages: ChatMessage[] = snap.docs.map((m) => {
          const v = m.data();
          return {
            id: m.id,
            // «свой» — тот, кто отправил; для клиента это он сам
            from: v.senderId === uid ? 'user' : 'master',
            text: v.text,
            time: v.time,
          };
        });
        const order = orders.find((o) => o.id === orderId);
        setOrderThreads((prev) => {
          const next: Thread = {
            id: orderId,
            name: order?.masterName ? `Мастер ${order.masterName}` : 'Мастер',
            icon: '🧑‍🔧',
            unread: false,
            messages,
          };
          const rest = prev.filter((t) => t.id !== orderId);
          // чаты без сообщений не показываем — пустой список выглядел бы мусором
          return messages.length ? [next, ...rest] : rest;
        });
      },
      (e) => console.warn('Переписка по заявке недоступна:', e),
    ));

    return () => unsubs.forEach((u) => u());
  }, [uid, orderIdsKey]);

  // ---------- обращение в поддержку ----------
  // Оно личное, поэтому остаётся в поддереве пользователя
  useEffect(() => {
    if (!uid) {
      setSupportThreads([]);
      return;
    }
    const msgUnsubs = new Map<string, () => void>();

    const unsubThreads = onSnapshot(
      query(collection(db, 'users', uid, 'threads'), orderBy('updatedAt', 'desc')),
      (snap) => {
        const ids = new Set(snap.docs.map((d) => d.id));

        setSupportThreads((prev) => snap.docs.map((d) => {
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
              setSupportThreads((prev) => prev.map((t) => (t.id === d.id ? { ...t, messages } : t)));
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
  };

  const cancelOrder = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    updateDoc(doc(db, 'orders', orderId), { status: 'Отменена' }).catch(() => {});
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
    setReadThreads((prev) => new Set(prev).add(threadId));
    if (threadId === SUPPORT_THREAD_ID) {
      updateDoc(doc(db, 'users', uid, 'threads', threadId), { unread: false }).catch(() => {});
    }
  };

  const sendMessage = async (threadId: string, text: string) => {
    if (!uid) return;

    // Поддержка — личный тред с заготовленными ответами. Заявка — общий чат
    // с мастером внутри самой заявки: там отвечает живой человек, и подделывать
    // ответ за него нельзя.
    if (threadId !== SUPPORT_THREAD_ID) {
      try {
        await addDoc(collection(db, 'orders', threadId, 'messages'), {
          senderId: uid, text, time: now(), createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('Сообщение не отправлено:', e);
      }
      return;
    }

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

    later(700, () => setTypingThreadId(threadId));
    later(2300, () => {
      setTypingThreadId((cur) => (cur === threadId ? null : cur));
      const reply = SUPPORT_REPLIES[replyIdx.current % SUPPORT_REPLIES.length];
      replyIdx.current += 1;
      incomingMessage(SUPPORT_THREAD_ID, 'Поддержка', '🛟', reply);
    });
  };

  // Открыть чат из другого экрана и перевести на вкладку «Сообщения».
  // Для поддержки создаём тред с приветствием, для заявки он появится сам,
  // как только кто-то напишет первое сообщение.
  const openChat = async (threadId: string) => {
    if (uid && threadId === SUPPORT_THREAD_ID && !supportThreads.find((t) => t.id === threadId)) {
      const threadRef = doc(db, 'users', uid, 'threads', threadId);
      try {
        await setDoc(threadRef, {
          name: 'Поддержка', icon: '🛟', unread: false, updatedAt: serverTimestamp(),
        }, { merge: true });
        await addDoc(collection(threadRef, 'messages'), {
          from: 'master', text: 'Здравствуйте! Чем можем помочь?', time: now(), createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('Не удалось открыть переписку:', e);
      }
    }
    setOpenThreadRequest(threadId);
    router.navigate('/messages');
  };

  // Непрочитанным считаем чат, где последнее сообщение не наше и который
  // не открывали в этой сессии
  const threads: Thread[] = [...orderThreads, ...supportThreads].map((t) => {
    const last = t.messages[t.messages.length - 1];
    const unread = t.id === SUPPORT_THREAD_ID
      ? t.unread && !readThreads.has(t.id)
      : !!last && last.from === 'master' && !readThreads.has(t.id);
    return unread === t.unread ? t : { ...t, unread };
  });

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
