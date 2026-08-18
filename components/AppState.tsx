import { router } from 'expo-router';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { db } from '../firebaseConfig';
import { ChatMessage, Thread } from '../screens/MessagesScreen';
import { Offer, Order } from '../screens/OrdersScreen';
import { cityKey } from './serviceOptions';
import { palettes, ThemeContext, ThemeMode } from '../theme';
import { authErrorText, useAuth } from './AuthState';
import { firestoreErrorText } from './firestoreError';
import { currentConsents, takePendingConsent, type Consents } from './legal';
import { takeSignupDraft } from './signupDraft';
import { OrderDraft } from './ActionSheet';
import { getPushToken, notifyLocal } from './notifications';
import { deleteVerificationPhoto, uploadOrderPhoto } from './photoUpload';

// Общее состояние приложения. Раньше жило в App.tsx и раздавалось пропсами —
// с переходом на роутер экраны стали отдельными маршрутами, и общий стейт
// поднялся сюда. Данные теперь в Firestore: экраны об этом не знают, они
// по-прежнему получают готовые массивы и колбэки.

const DEFAULT_ADDRESS = 'ул. Ленина, 24';
export const SUPPORT_THREAD_ID = 'support';

// Незакрытые статусы заявки: их можно отменить, и они же считаются активными.
// Перечень должен совпадать с clientCancels() в firestore.rules.
const CANCELLABLE = ['Поиск мастера', 'Есть предложения', 'В работе'];
const CLOSED = ['Завершена', 'Отменена'];

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

type AppState = {
  orders: Order[];
  threads: Thread[];
  userName: string;
  userEmail: string;
  addresses: string[];
  activeAddress: string;
  city: string;
  // Принятые редакции документов. null — профиль ещё не загружен.
  consents: Consents | null;
  acceptConsents: () => Promise<void>;
  typingThreadId: string | null;
  openThreadRequest: string | null;
  chatOpen: boolean;
  overlayOpen: boolean;
  masterOpen: boolean;
  isAdmin: boolean;
  adminOpen: boolean;
  hasUnreadMessages: boolean;
  ordersActive: number;
  // Сообщение о сбое, которое обязан увидеть человек: молча потерянная
  // заявка выглядит как успешно созданная
  notice: string | null;
  showNotice: (text: string) => void;
  dismissNotice: () => void;
  setUserName: (name: string) => void;
  setActiveAddress: (addr: string) => void;
  setCity: (city: string) => void;
  setChatOpen: (open: boolean) => void;
  setOverlayOpen: (open: boolean) => void;
  setMasterOpen: (open: boolean) => void;
  setAdminOpen: (open: boolean) => void;
  clearOpenThreadRequest: () => void;
  createOrder: (draft: OrderDraft) => void;
  confirmOrderDone: (orderId: string) => void;
  cancelOrder: (orderId: string) => void;
  // Выбор предложения — он же назначение мастера
  acceptOffer: (orderId: string, masterId: string) => void;
  submitReview: (orderId: string, stars: number, text: string) => void;
  // Заявки, созданные до появления offers
  acceptPrice: (orderId: string) => void;
  declinePrice: (orderId: string) => void;
  addAddress: (addr: string) => void;
  markThreadRead: (threadId: string) => void;
  sendMessage: (threadId: string, text: string) => void;
  openChat: (threadId: string) => void;
  logout: () => Promise<void>;
  // Пароль — подтверждение, что удаляет владелец телефона, а не тот,
  // кому он попал в руки разблокированным
  deleteAccount: (password: string) => Promise<void>;
};

const AppStateContext = createContext<AppState | null>(null);

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState вызван вне AppStateProvider');
  return ctx;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const {
    user, logout: signOutUser, reauthenticate, deleteAccount: deleteAuthUser,
  } = useAuth();
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
  // Город — то единственное, по чему заявка находит мастеров рядом.
  // Геокодирования нет, поэтому это отдельное поле, а не часть адреса.
  const [city, setCityLocal] = useState('');
  // Какие редакции документов человек принял. Пусто — значит, пользоваться
  // сервисом ещё нельзя: обработка данных без согласия недопустима.
  const [consents, setConsentsLocal] = useState<Consents | null>(null);
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
  // Раздел модерации. Открыт только владельцам документа admins/{uid} —
  // завести его можно лишь в консоли Firebase, правила запись запрещают.
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  // В каком чате сейчас «печатает» собеседник
  const [typingThreadId, setTypingThreadId] = useState<string | null>(null);
  // Видимое сообщение о сбое
  const [notice, setNotice] = useState<string | null>(null);

  // Ошибку записи нельзя проглатывать: человек должен понять, что действие
  // не прошло, и повторить его
  const failed = (text: string) => (e: unknown) => {
    console.warn(text, e);
    // Код ошибки точнее общей фразы: отказ по правам — это не «нет связи»,
    // и предлагать проверить интернет в таком случае бесполезно
    setNotice(firestoreErrorText(e, text));
  };

  // Все отложенные события (ответы мастера, смена статуса) — в одном месте,
  // чтобы аккуратно погасить их при размонтировании
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const replyIdx = useRef(0);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const userDoc = () => (uid ? doc(db, 'users', uid) : null);

  // Идёт удаление аккаунта. Без этого флага подписка на профиль увидела бы
  // только что удалённый документ и тут же создала его заново.
  const deleting = useRef(false);

  // ---------- профиль ----------
  // Документ создаётся при первом входе: раньше уйти в базу он не мог,
  // потому что правила разрешают запись только владельцу, а uid ещё не было.
  useEffect(() => {
    if (!uid) {
      setUserNameLocal('');
      setAddresses([DEFAULT_ADDRESS]);
      setActiveAddressLocal(DEFAULT_ADDRESS);
      setCityLocal('');
      setConsentsLocal(null);
      deleting.current = false;
      return;
    }
    const ref = doc(db, 'users', uid);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        if (deleting.current) return;
        // Город, адрес и согласие человек указал на экране регистрации —
        // записываем их тем же действием, что создаёт профиль. Запасные
        // значения нужны тем, кто регистрировался до появления этих полей.
        const signup = takeSignupDraft();
        const address = signup?.address || DEFAULT_ADDRESS;
        setDoc(ref, {
          name: user?.displayName ?? 'Гость',
          email: user?.email ?? '',
          addresses: [address],
          activeAddress: address,
          city: signup?.city ?? '',
          themeMode: 'light',
          consents: takePendingConsent() ?? {},
          createdAt: serverTimestamp(),
        }).catch((e) => console.warn('Не удалось создать профиль:', e));
        return;
      }
      const d = snap.data();
      setUserNameLocal(d.name ?? '');
      setAddresses(Array.isArray(d.addresses) && d.addresses.length ? d.addresses : [DEFAULT_ADDRESS]);
      setActiveAddressLocal(d.activeAddress ?? DEFAULT_ADDRESS);
      setCityLocal(d.city ?? '');
      setConsentsLocal((d.consents ?? {}) as Consents);
      setThemeModeLocal(d.themeMode === 'dark' ? 'dark' : 'light');
    }, (e) => console.warn('Профиль недоступен:', e));
  }, [uid, user?.displayName, user?.email]);

  // ---------- права модератора ----------
  useEffect(() => {
    if (!uid) {
      setIsAdmin(false);
      setAdminOpen(false);
      return;
    }
    // Подписка, а не разовое чтение: документ модератора заводят вручную в
    // консоли, обычно при открытом приложении. С разовым чтением раздел не
    // появлялся до перезапуска, и это выглядело как поломка, хотя всё было
    // сделано правильно.
    return onSnapshot(
      doc(db, 'admins', uid),
      (snap) => setIsAdmin(snap.exists()),
      // Правила разрешают читать только свой документ, поэтому отказ здесь —
      // нормальный ответ «вы не модератор», а не сбой
      () => setIsAdmin(false),
    );
  }, [uid]);

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
          masterId: v.masterId ?? null,
          masterName: v.masterName ?? null,
          agreedPrice: v.agreedPrice ?? null,
          reviewed: !!v.reviewed,
          price: v.price ?? null,
          priceStatus: v.priceStatus ?? 'none',
          // для сортировки: у только что созданной заявки serverTimestamp
          // ещё null, поэтому такие показываем сверху
          createdMs: v.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER,
        };
      }).sort((a, b) => b.createdMs - a.createdMs)
        .map(({ createdMs, ...o }) => { void createdMs; return o; }));
    }, (e) => console.warn('Заказы недоступны:', e));
  }, [uid]);

  // ---------- предложения мастеров ----------
  // Каждый мастер пишет свой документ в orders/{id}/offers, поэтому чужое
  // предложение перебить нельзя, а заявка остаётся открытой, пока клиент
  // не выбрал, — в этом и смысл: цены конкурируют.
  const [offersByOrder, setOffersByOrder] = useState<Record<string, Offer[]>>({});
  // Рейтинг мастера лежит в его анкете, а не в предложении: иначе мастер мог
  // бы прислать любые звёзды вместе с ценой
  const [masterCards, setMasterCards] = useState<
    Record<string, { rating: number | null; reviewsCount: number }>
  >({});
  const masterCardsAsked = useRef(new Set<string>());

  const ensureMasterCard = (masterId: string) => {
    if (masterCardsAsked.current.has(masterId)) return;
    masterCardsAsked.current.add(masterId);
    getDoc(doc(db, 'masters', masterId))
      .then((snap) => {
        const v = snap.data();
        setMasterCards((prev) => ({
          ...prev,
          [masterId]: {
            // Агрегат считает Cloud Function: пока её нет, рейтинга просто
            // не будет — врать про «5.0» хуже, чем молчать
            rating: typeof v?.rating === 'number' ? v.rating : null,
            reviewsCount: typeof v?.reviewsCount === 'number' ? v.reviewsCount : 0,
          },
        }));
      })
      .catch((e) => console.warn('Анкета мастера недоступна:', e));
  };

  // Подписываемся только на заявки в поиске: после выбора мастера предложения
  // уже ничего не решают
  const openOrderIdsKey = orders
    .filter((o) => o.status === 'Поиск мастера')
    .map((o) => o.id)
    .join(',');

  useEffect(() => {
    if (!uid) {
      setOffersByOrder({});
      return;
    }
    const ids = openOrderIdsKey ? openOrderIdsKey.split(',') : [];
    if (!ids.length) {
      setOffersByOrder({});
      return;
    }

    const unsubs = ids.map((orderId) => onSnapshot(
      query(collection(db, 'orders', orderId, 'offers'), orderBy('price', 'asc')),
      (snap) => {
        const list: Offer[] = snap.docs.map((d) => {
          const v = d.data();
          ensureMasterCard(v.masterId);
          return {
            masterId: v.masterId,
            masterName: v.masterName ?? 'Мастер',
            price: v.price,
            comment: v.comment ?? '',
            status: v.status === 'accepted' ? 'accepted' : 'pending',
            rating: null,
            reviewsCount: 0,
          };
        });
        setOffersByOrder((prev) => ({ ...prev, [orderId]: list }));
      },
      (e) => console.warn('Предложения недоступны:', e),
    ));

    return () => unsubs.forEach((u) => u());
  }, [uid, openOrderIdsKey]);

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
      // Поддержку изображает само приложение, поэтому и уведомление о её
      // ответе локальное. Всё остальное — заявки, предложения, сообщения
      // мастера — присылает сервер: Cloud Functions в functions/.
      notifyLocal(name, text, { href: '/messages' });
    } catch (e) {
      console.warn('Не удалось доставить сообщение:', e);
    }
  };

  // Заявка пишется по идентификатору, выданному шторкой заранее: setDoc по
  // известному id идемпотентен, а addDoc на каждый вызов создавал новую
  // заявку — двойное нажатие давало два заказа.
  const createOrder = async ({ id, title, comment, photoUri, category }: OrderDraft) => {
    if (!uid) return;

    try {
      await setDoc(doc(db, 'orders', id), {
        clientId: uid,
        clientName: userName || 'Клиент',
        masterId: null,
        masterName: null,
        title,
        date: today(),
        status: 'Поиск мастера',
        comment: comment ?? '',
        // Фото прикладывается следующим шагом: правила Storage разрешают
        // писать в orders/{id}/ только владельцу заявки, а чтобы это
        // проверить, заявка уже должна существовать
        photoUrl: null,
        address: activeAddress,
        // По городу и специальности заявку находят мастера нужного профиля.
        // Город пустой — заявку увидят только те, кто не ограничил себя
        // городом; об этом предупреждает профиль.
        city: cityKey(city),
        category,
        // Цена появится, когда мастер пришлёт предложение в orders/{id}/offers
        agreedPrice: null,
        agreedAt: null,
        reviewed: false,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      failed('Не удалось создать заявку. Проверьте связь и попробуйте ещё раз')(e);
      return;
    }

    // Заявка уже работает, поэтому неудача с фото её не отменяет — но и
    // молчать нельзя: человек прикладывал снимок не просто так
    if (!photoUri) return;
    try {
      const photoUrl = await uploadOrderPhoto(id, photoUri);
      await updateDoc(doc(db, 'orders', id), { photoUrl });
    } catch (e) {
      console.warn('Фото к заявке не загрузилось:', e);
      setNotice(firestoreErrorText(e, 'Заявка создана, но фото не загрузилось'));
    }
  };

  // ---------- выбор мастера ----------

  // Клиент выбирает одно из предложений. Это единственный момент, когда у
  // заявки появляется мастер: до него masterId пуст, и никакой мастер не может
  // назначить себя сам. Обе записи идут одним пакетом — заявка без отметки в
  // предложении (или наоборот) означала бы разъехавшуюся картину у двух сторон.
  const acceptOffer = async (orderId: string, masterId: string) => {
    const order = orders.find((o) => o.id === orderId);
    const offer = (offersByOrder[orderId] ?? []).find((o) => o.masterId === masterId);
    if (!order || !offer || order.status !== 'Поиск мастера') return;

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'orders', orderId), {
        masterId: offer.masterId,
        masterName: offer.masterName,
        agreedPrice: offer.price,
        agreedAt: serverTimestamp(),
        status: 'В работе',
      });
      batch.update(doc(db, 'orders', orderId, 'offers', masterId), { status: 'accepted' });
      await batch.commit();
    } catch (e) {
      failed('Не удалось выбрать мастера. Проверьте связь')(e);
    }
  };

  // ---------- отзыв о работе ----------

  // Отзыв и отметка о нём — тоже одним пакетом: иначе можно было бы попросить
  // оценку второй раз или, наоборот, потерять её.
  const submitReview = async (orderId: string, stars: number, text: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!uid || !order || !order.masterId) return;
    if (order.status !== 'Завершена' || order.reviewed) return;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'masters', order.masterId, 'reviews', orderId), {
        orderId,
        clientId: uid,
        clientName: userName || 'Клиент',
        stars,
        text: text.slice(0, 1000),
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, 'orders', orderId), { reviewed: true });
      await batch.commit();
    } catch (e) {
      failed('Не удалось отправить отзыв. Проверьте связь')(e);
    }
  };

  // ---------- согласование цены у заявок до появления offers ----------

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
    }).catch(failed('Не удалось принять цену. Проверьте связь'));
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
    }).catch(failed('Не удалось отклонить цену. Проверьте связь'));
  };

  // Пользователь подтверждает, что работа выполнена — заказ закрывается
  const confirmOrderDone = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'Ждёт подтверждения') return;
    updateDoc(doc(db, 'orders', orderId), { status: 'Завершена' })
      .catch(failed('Не удалось подтвердить выполнение. Проверьте связь'));
  };

  const cancelOrder = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || !CANCELLABLE.includes(order.status)) return;
    updateDoc(doc(db, 'orders', orderId), { status: 'Отменена' })
      .catch(failed('Не удалось отменить заявку. Проверьте связь'));
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

  // Принятие новой редакции документов. Нужно и тем, кто регистрировался до
  // их появления, и всем остальным, когда редакция изменится.
  const acceptConsents = async () => {
    const ref = userDoc();
    if (!ref) return;
    const next = currentConsents();
    try {
      await setDoc(ref, { consents: next, consentsAt: serverTimestamp() }, { merge: true });
      setConsentsLocal(next);
    } catch (e) {
      failed('Не удалось сохранить согласие. Проверьте связь')(e);
      throw e;
    }
  };

  // Город меняется только для будущих заявок: у созданных он уже записан,
  // и переезд не должен переносить старые заявки в другой город
  const setCity = (next: string) => {
    const trimmed = next.trim();
    setCityLocal(trimmed);
    const ref = userDoc();
    if (ref) updateDoc(ref, { city: trimmed }).catch(() => {});
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
        failed('Сообщение не отправлено. Проверьте связь')(e);
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
      failed('Сообщение не отправлено. Проверьте связь')(e);
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

  // ---------- аккаунт ----------

  // Оверлеи закрываем до выхода: иначе следующий вошедший увидит раздел
  // мастера или чужой чат, открытые не им
  const logout = async () => {
    setMasterOpen(false);
    setChatOpen(false);
    setOverlayOpen(false);
    await signOutUser();
  };

  // Удаление аккаунта — требование магазинов приложений и просто честность.
  // Уходит всё личное: профиль с адресами, переписка, анкета мастера.
  // Заявки остаются: они общие с мастером и служат историей расчётов, —
  // но незакрытые отменяются, чтобы никто не ехал к исчезнувшему клиенту.
  const deleteAccount = async (password: string) => {
    if (!uid) return;

    // Пароль проверяем до того, как удалено хоть что-то
    try {
      await reauthenticate(password);
    } catch (e) {
      throw new Error(authErrorText(e));
    }

    deleting.current = true;

    // Просьба об удалении — единственное, что обязано записаться. Дальше
    // работает функция: она обходит данные этапами и переживает обрыв на
    // любом шаге. Раньше весь обход шёл отсюда, и сбой посередине оставлял
    // наполовину удалённый аккаунт.
    try {
      // status нужен сверке: если триггер не запустится, она найдёт заявку
      // запросом по нему и доведёт удаление до конца
      await setDoc(doc(db, 'deletions', uid), {
        requestedAt: serverTimestamp(),
        status: 'pending',
      });
    } catch (e) {
      deleting.current = false;
      console.warn('Не удалось создать заявку на удаление:', e);
      throw new Error(firestoreErrorText(e, 'Не удалось удалить аккаунт. Попробуйте ещё раз'));
    }

    // Дальше — то же самое, но своими силами и без права на ошибку каждого
    // шага: функции могут быть не развёрнуты (для них нужен тариф Blaze), а
    // удаление аккаунта обязано работать всегда. Обе стороны идемпотентны,
    // поэтому двойная работа безвредна: что успел клиент, функция пропустит.
    const quietly = (p: Promise<unknown>) => p.catch(() => {});

    await Promise.all(orders
      .filter((o) => CANCELLABLE.includes(o.status))
      .map((o) => quietly(updateDoc(doc(db, 'orders', o.id), { status: 'Отменена' }))));

    try {
      const threadsSnap = await getDocs(collection(db, 'users', uid, 'threads'));
      for (const thread of threadsSnap.docs) {
        const messages = await getDocs(collection(thread.ref, 'messages'));
        await Promise.all(messages.docs.map((m) => quietly(deleteDoc(m.ref))));
        await quietly(deleteDoc(thread.ref));
      }
    } catch (e) {
      console.warn('Переписка не удалена с устройства, доделает функция:', e);
    }

    await quietly(deleteDoc(doc(db, 'masters', uid, 'verification', 'application')));
    await quietly(deleteVerificationPhoto(uid));
    await quietly(deleteDoc(doc(db, 'masters', uid)));
    await quietly(deleteDoc(doc(db, 'users', uid)));

    // Аккаунт — последним: после него правила уже ничего не разрешат.
    // Если не выйдет, его удалит функция.
    await quietly(deleteAuthUser());
    await quietly(signOutUser());
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
  const ordersActive = orders.filter((o) => !CLOSED.includes(o.status)).length;

  // Предложения и рейтинги живут отдельными подписками — экрану они нужны
  // внутри заявки, поэтому сшиваем их здесь, а не в UI
  const ordersWithOffers: Order[] = orders.map((o) => {
    const list = offersByOrder[o.id];
    if (!list?.length) return o;
    return {
      ...o,
      offers: list.map((offer) => ({
        ...offer,
        rating: masterCards[offer.masterId]?.rating ?? null,
        reviewsCount: masterCards[offer.masterId]?.reviewsCount ?? 0,
      })),
    };
  });

  const value: AppState = {
    orders: ordersWithOffers,
    threads,
    userName,
    userEmail: user?.email ?? '',
    addresses,
    activeAddress,
    city,
    consents,
    acceptConsents,
    typingThreadId,
    openThreadRequest,
    chatOpen,
    overlayOpen,
    masterOpen,
    isAdmin,
    adminOpen,
    hasUnreadMessages,
    ordersActive,
    notice,
    showNotice: setNotice,
    dismissNotice: () => setNotice(null),
    setUserName,
    setActiveAddress,
    setCity,
    setChatOpen,
    setOverlayOpen,
    setMasterOpen,
    setAdminOpen,
    clearOpenThreadRequest: () => setOpenThreadRequest(null),
    createOrder,
    confirmOrderDone,
    cancelOrder,
    acceptOffer,
    submitReview,
    acceptPrice,
    declinePrice,
    addAddress,
    markThreadRead,
    sendMessage,
    openChat,
    logout,
    deleteAccount,
  };

  return (
    <ThemeContext.Provider
      value={{ mode: themeMode, colors: palettes[themeMode], setMode: setThemeMode }}
    >
      <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
    </ThemeContext.Provider>
  );
}
