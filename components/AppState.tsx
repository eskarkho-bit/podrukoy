import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  deleteField,
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
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { db } from '../firebaseConfig';
import { ChatMessage, Thread } from '../screens/MessagesScreen';
import { Offer, Order } from '../screens/OrdersScreen';
import { banksFrom } from './banks';
import { paymentMethodFrom, type PaymentMethod } from './payment';
import { cityKey } from './serviceOptions';
import { educationFrom } from './education';
import { palettes, ThemeContext, ThemeMode } from '../theme';
import { authErrorText, useAuth } from './AuthState';
import { phoneAuthErrorText } from './phoneAuth';
import { firestoreErrorCode, firestoreErrorText } from './firestoreError';
import { currentConsents, takePendingConsent, type Consents } from './legal';
import { takeSignupDraft } from './signupDraft';
import { OrderDraft } from './ActionSheet';
import { getPushToken } from './notifications';
import { fileComplaint } from './complaints';
import { exportUserData } from './dataExport';
import { deleteVerificationPhoto, uploadChatPhoto, uploadOrderPhoto } from './photoUpload';

// Общее состояние приложения. Раньше жило в App.tsx и раздавалось пропсами —
// с переходом на роутер экраны стали отдельными маршрутами, и общий стейт
// поднялся сюда. Данные теперь в Firestore: экраны об этом не знают, они
// по-прежнему получают готовые массивы и колбэки.

const DEFAULT_ADDRESS = 'ул. Ленина, 24';
export const SUPPORT_THREAD_ID = 'support';

// Незакрытые статусы заявки: их можно отменить, и они же считаются активными.
// Перечень должен совпадать с clientCancels() в firestore.rules.
const CANCELLABLE = ['Поиск мастера', 'Есть предложения', 'В работе'];
// Статусы, в которых стороны рассчитываются: мастер уже есть, заявка живая
const SETTLING = ['В работе', 'Ждёт подтверждения', 'Завершена'];
const CLOSED = ['Завершена', 'Отменена'];

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
  userPhone: string;
  // Чем аккаунт подтверждает владельца: паролем или кодом из СМС. От этого
  // зависят и смена пароля (телефонному аккаунту нечего менять), и удаление.
  authMethod: 'password' | 'phone';
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
  // Напоминания о повторяемых работах (стрижка газона и т.п.) шлёт сервер;
  // отметка в профиле — способ попросить его молчать
  remindersOff: boolean;
  setRemindersOff: (off: boolean) => void;
  // Выключатель пушей. Слушает его сервер на единственном пути отправки —
  // токены остаются в профиле, поэтому «включить обратно» не требует
  // перерегистрации устройства
  pushOff: boolean;
  setPushOff: (off: boolean) => void;
  // Блокировка модерацией: создание заявок закрыто правилами, а флаг из
  // профиля позволяет сказать об этом до попытки, вместе с причиной
  blocked: boolean;
  blockedReason: string | null;
  setActiveAddress: (addr: string) => void;
  setCity: (city: string) => void;
  setChatOpen: (open: boolean) => void;
  setOverlayOpen: (open: boolean) => void;
  setMasterOpen: (open: boolean) => void;
  setAdminOpen: (open: boolean) => void;
  clearOpenThreadRequest: () => void;
  createOrder: (draft: OrderDraft) => void;
  confirmOrderDone: (orderId: string) => void;
  // Мастер отметил «сделано», а клиент не согласен — работа возвращается
  // мастеру, а не закрывается
  returnOrderToWork: (orderId: string) => void;
  // Расчёт напрямую между сторонами: способ и отметка «оплатил»
  choosePaymentMethod: (orderId: string, method: PaymentMethod) => void;
  markOrderPaid: (orderId: string) => void;
  cancelOrder: (orderId: string) => void;
  // Выбор предложения — он же назначение мастера
  acceptOffer: (orderId: string, masterId: string) => void;
  // Жалобы клиента: на мастера своей заявки и на его сообщение в чате.
  // true — жалоба принята, модерация её увидит
  reportMaster: (orderId: string, text: string) => Promise<boolean>;
  reportMessage: (orderId: string, messageId: string, text: string) => Promise<boolean>;
  // Блокировка мастера клиентом: его предложения не показываются и правила
  // их не пропускают, сервер не зовёт его к новым заявкам этого клиента
  blockedMasters: { id: string; name: string }[];
  blockMaster: (masterId: string, name: string) => void;
  unblockMaster: (masterId: string) => void;
  // true — отзыв записан; форма по false остаётся открытой
  submitReview: (orderId: string, stars: number, text: string) => Promise<boolean>;
  // Заявки, созданные до появления offers
  acceptPrice: (orderId: string) => void;
  declinePrice: (orderId: string) => void;
  addAddress: (addr: string) => void;
  markThreadRead: (threadId: string) => void;
  sendMessage: (threadId: string, text: string) => void;
  // Фото в чат заявки; поддержке не предлагается — её правила ждут текст
  // true — сообщение ушло; экран по false оставляет предпросмотр и подпись
  sendImageMessage: (threadId: string, localUri: string, caption: string) => Promise<boolean>;
  openChat: (threadId: string) => void;
  logout: () => Promise<void>;
  // Смена пароля. Ошибка возвращается текстом, готовым к показу.
  changePassword: (current: string, next: string) => Promise<void>;
  // Экспорт данных: право на переносимость из политики конфиденциальности
  exportMyData: () => Promise<void>;
  // Код для подтверждения удаления — телефонным аккаунтам вместо пароля.
  // Возвращает канал: звонок или СМС — экрану нужен правильный текст
  requestDeleteCode: () => Promise<'sms' | 'call'>;
  // Секрет — подтверждение, что удаляет владелец, а не тот, кому телефон
  // попал в руки разблокированным: пароль либо код из СМС — по authMethod
  deleteAccount: (secret: string) => Promise<void>;
};

/**
 * Название чата по заявке.
 *
 * Живёт вне компонента намеренно: внутри оно попало бы в зависимости
 * эффекта и пересоздавалось бы каждую отрисовку, перезапуская подписки.
 */
const masterThreadName = (order?: { masterName?: string | null }) =>
  order?.masterName ? `Мастер ${order.masterName}` : 'Мастер';

// Столько токенов устройств держит профиль — столько же пускают правила.
// Переустановка выдаёт новый токен, и без обрезки старые копились бы вечно
const MAX_PUSH_TOKENS = 10;

// Пока сделка жива, в чате по заявке можно писать; в поиске собеседника ещё
// нет, в отменённой — уже не о чем. Тот же список, что в firestore.rules.
const TALKABLE = ['В работе', 'Ждёт подтверждения', 'Завершена'];

const AppStateContext = createContext<AppState | null>(null);

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState вызван вне AppStateProvider');
  return ctx;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const {
    user,
    hasPassword,
    phone: authPhone,
    logout: signOutUser,
    reauthenticate,
    changePassword: changeAuthPassword,
    requestPhoneCode,
    signInWithPhone,
    deleteAccount: deleteAuthUser,
  } = useAuth();
  const uid = user?.uid ?? null;

  const [orders, setOrders] = useState<Order[]>([]);
  // Переписка складывается из двух источников: чаты по заявкам (общие с
  // мастером, лежат в самой заявке) и обращение в поддержку (личное)
  const [orderThreads, setOrderThreads] = useState<Thread[]>([]);
  const [supportThreads, setSupportThreads] = useState<Thread[]>([]);
  // Прочитанность считаем на устройстве: писать её в базу на каждое открытие
  // чата — лишние запросы ради бейджа. Запоминается последнее увиденное
  // сообщение, а не сам факт открытия: иначе чат, открытый однажды, больше
  // никогда не становился бы непрочитанным
  const [readThreads, setReadThreads] = useState<Map<string, string>>(new Map());
  // Прочитанность — на устройстве, по аккаунту: без этого после перезапуска
  // каждый чат с последним сообщением мастера снова горел бы непрочитанным
  const readKey = uid ? `read-threads-${uid}` : null;
  useEffect(() => {
    if (!readKey) return;
    let alive = true;
    AsyncStorage.getItem(readKey)
      .then((raw) => {
        if (alive && raw) setReadThreads(new Map(Object.entries(JSON.parse(raw))));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [readKey]);
  // Профиль прочитан хотя бы раз — только тогда есть куда писать токен
  const [profileReady, setProfileReady] = useState(false);
  const profileTokensRef = useRef<string[]>([]);
  const [pushToken, setPushToken] = useState<string | null>(null);
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
  // Отказ от напоминаний о повторяемых работах. Отсутствие поля — согласие:
  // так напоминания работают и у тех, кто регистрировался до их появления
  const [remindersOff, setRemindersOffLocal] = useState(false);
  // Выключатель пушей: тоже «отсутствие поля — согласие»
  const [pushOff, setPushOffLocal] = useState(false);
  // Кого клиент заблокировал: идентификаторы для правил и сервера, имена —
  // для списка в профиле
  const [blockedMasterIds, setBlockedMasterIds] = useState<string[]>([]);
  const [blockedMasterNames, setBlockedMasterNames] = useState<Record<string, string>>({});
  const [blocked, setBlockedLocal] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
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
  // В каком чате сейчас «печатает» собеседник.
  //
  // ДОЛГ: разводка по интерфейсу есть, а источника нет — setTypingThreadId
  // не вызывается нигде с тех пор, как поддержка стала настоящей. Признак
  // «печатает» требует записи в Firestore на каждое нажатие клавиши, и это
  // отдельное решение по стоимости, а не забытая строчка.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  const userDoc = () => (uid ? doc(db, 'users', uid) : null);
  // Для колбэков с постоянной ссылкой: uid читается в момент вызова, а не
  // запекается в замыкание при первом рендере
  const uidRef = useRef(uid);
  uidRef.current = uid;

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
      setRemindersOffLocal(false);
      setPushOffLocal(false);
      setBlockedMasterIds([]);
      setBlockedMasterNames({});
      setProfileReady(false);
      // Следующий вошедший не должен унаследовать блокировку, тему и
      // прочитанность чатов прошлого аккаунта
      setBlockedLocal(false);
      setBlockedReason(null);
      setThemeModeLocal('light');
      setReadThreads(new Map());
      deleting.current = false;
      return;
    }
    const ref = doc(db, 'users', uid);
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          if (deleting.current) return;
          // Город, адрес и согласие человек указал на экране регистрации —
          // записываем их тем же действием, что создаёт профиль. Запасные
          // значения нужны тем, кто регистрировался до появления этих полей.
          const signup = takeSignupDraft();
          const address = signup?.address || DEFAULT_ADDRESS;
          const createProfile = () =>
            setDoc(ref, {
              // Имя из черновика — для регистрации по телефону: у такого
              // аккаунта displayName пуст, а имя человек уже написал
              name: user?.displayName ?? signup?.name ?? 'Гость',
              email: user?.email ?? '',
              phone: user?.phoneNumber ?? '',
              addresses: [address],
              activeAddress: address,
              city: signup?.city ?? '',
              themeMode: 'light',
              consents: takePendingConsent() ?? {},
              createdAt: serverTimestamp(),
            }).catch((e) => console.warn('Не удалось создать профиль:', e));
          // Профиль исчез, потому что аккаунт удаляют с другого устройства:
          // воссоздавать его — значит вернуть персональные данные после
          // удаления. Просьба об удалении лежит в deletions/{uid}.
          getDoc(doc(db, 'deletions', uid))
            .then((req) => {
              if (req.exists() && req.get('status') !== 'done') return;
              return createProfile();
            })
            .catch(() => createProfile());
          return;
        }
        const d = snap.data();
        profileTokensRef.current = Array.isArray(d.pushTokens) ? d.pushTokens.map(String) : [];
        setProfileReady(true);
        setUserNameLocal(d.name ?? '');
        setAddresses(
          Array.isArray(d.addresses) && d.addresses.length ? d.addresses : [DEFAULT_ADDRESS],
        );
        setActiveAddressLocal(d.activeAddress ?? DEFAULT_ADDRESS);
        setCityLocal(d.city ?? '');
        setConsentsLocal((d.consents ?? {}) as Consents);
        setThemeModeLocal(d.themeMode === 'dark' ? 'dark' : 'light');
        setRemindersOffLocal(d.remindersOff === true);
        setPushOffLocal(d.pushOff === true);
        setBlockedMasterIds(
          Array.isArray(d.blockedMasters) ? d.blockedMasters.map((id: unknown) => String(id)) : [],
        );
        setBlockedMasterNames(
          d.blockedMasterNames && typeof d.blockedMasterNames === 'object'
            ? (d.blockedMasterNames as Record<string, string>)
            : {},
        );
        setBlockedLocal(d.blocked === true);
        setBlockedReason(typeof d.blockedReason === 'string' ? d.blockedReason : null);
      },
      (e) => console.warn('Профиль недоступен:', e),
    );
  }, [uid, user?.displayName, user?.email, user?.phoneNumber]);

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
  // Токен устройства — один на запуск, но спрашивать разрешение на
  // уведомления имеет смысл только у вошедшего: на экране входа системный
  // вопрос ни к чему не привязан и его отклоняют
  const tokenAsked = useRef(false);
  useEffect(() => {
    if (!uid || tokenAsked.current) return;
    tokenAsked.current = true;
    let alive = true;
    getPushToken().then((token) => {
      if (alive) setPushToken(token);
    });
    return () => {
      alive = false;
    };
  }, [uid]);

  // Складываем в профиль список токенов: у одного человека может быть
  // несколько устройств, и серверу потом нужно знать их все. Пишем, когда
  // профиль уже прочитан: раньше писать некуда, а arrayUnion без обрезки
  // копил бы токены переустановок, пока правила не отказали бы в записи
  useEffect(() => {
    if (!uid || !pushToken || !profileReady) return;
    const list = profileTokensRef.current;
    if (list.includes(pushToken)) return;
    updateDoc(doc(db, 'users', uid), {
      pushTokens: [...list.filter((t) => t !== pushToken).slice(1 - MAX_PUSH_TOKENS), pushToken],
    }).catch((e) => console.warn('Не удалось сохранить push-токен:', e));
  }, [uid, pushToken, profileReady]);

  // ---------- заказы ----------
  useEffect(() => {
    if (!uid) {
      setOrders([]);
      return;
    }
    // Без orderBy: связка where + orderBy по разным полям потребовала бы
    // составного индекса, а без него запрос падает. Сортируем на месте.
    const q = query(collection(db, 'orders'), where('clientId', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        setOrders(
          snap.docs
            .map((d) => {
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
                masterPhone: v.masterPhone ?? null,
                masterBanks: Array.isArray(v.masterBanks) ? banksFrom(v.masterBanks) : null,
                masterAcceptsCash:
                  typeof v.masterAcceptsCash === 'boolean' ? v.masterAcceptsCash : null,
                paymentMethod: paymentMethodFrom(v.paymentMethod),
                paidMs: v.paidAt?.toMillis?.() ?? null,
                paymentReceivedMs: v.paymentReceivedAt?.toMillis?.() ?? null,
                objectId: v.objectId ?? undefined,
                serviceLabel: v.serviceLabel ?? undefined,
                agreedPrice: v.agreedPrice ?? null,
                reviewed: !!v.reviewed,
                price: v.price ?? null,
                priceStatus: v.priceStatus ?? 'none',
                agreedAtMs: v.agreedAt?.toMillis?.() ?? null,
                closedByAdmin: v.closedByAdmin === true,
                adminCloseReason:
                  typeof v.adminCloseReason === 'string' ? v.adminCloseReason : null,
                lastMessageAtMs: v.lastMessageAt?.toMillis?.() ?? null,
                lastMessageBy: typeof v.lastMessageBy === 'string' ? v.lastMessageBy : null,
                // для сортировки: у только что созданной заявки serverTimestamp
                // ещё null, поэтому такие показываем сверху
                createdMs: v.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER,
              };
            })
            .sort((a, b) => b.createdMs - a.createdMs)
            .map(({ createdMs, ...o }) => {
              void createdMs;
              return o;
            }),
        );
      },
      (e) => console.warn('Заказы недоступны:', e),
    );
  }, [uid]);

  // ---------- предложения мастеров ----------
  // Каждый мастер пишет свой документ в orders/{id}/offers, поэтому чужое
  // предложение перебить нельзя, а заявка остаётся открытой, пока клиент
  // не выбрал, — в этом и смысл: цены конкурируют.
  const [offersByOrder, setOffersByOrder] = useState<Record<string, Offer[]>>({});
  // Профиль мастера лежит в его анкете, а не в предложении: иначе мастер мог
  // бы прислать любые звёзды и стаж вместе с ценой
  const [masterCards, setMasterCards] = useState<
    Record<
      string,
      {
        rating: number | null;
        reviewsCount: number;
        lastName: string;
        experienceYears: number | null;
        education: string | null;
        completedOrders: number;
      }
    >
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
            // Агрегаты считает Cloud Function: пока её нет, рейтинга просто
            // не будет — врать про «5.0» хуже, чем молчать
            rating: typeof v?.rating === 'number' ? v.rating : null,
            reviewsCount: typeof v?.reviewsCount === 'number' ? v.reviewsCount : 0,
            lastName: typeof v?.lastName === 'string' ? v.lastName : '',
            experienceYears: typeof v?.experienceYears === 'number' ? v.experienceYears : null,
            education: educationFrom(v?.education),
            completedOrders: typeof v?.completedOrders === 'number' ? v.completedOrders : 0,
          },
        }));
      })
      .catch((e) => {
        // Сбой сети — не приговор: следующий снимок предложений попробует снова
        masterCardsAsked.current.delete(masterId);
        console.warn('Анкета мастера недоступна:', e);
      });
  };

  // Подписываемся только на заявки в поиске: после выбора мастера предложения
  // уже ничего не решают
  // Ключ — отсортированный список: заявки приходят отсортированными по
  // времени, а у только что созданной время появляется с задержкой, и без
  // сортировки перестановка пересоздавала бы все подписки дважды на заявку
  const openOrderIdsKey = orders
    .filter((o) => o.status === 'Поиск мастера')
    .map((o) => o.id)
    .sort()
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
    // Заявка ушла из поиска — её предложения больше не нужны: подписка
    // снята, а список без этого оставался бы в памяти
    setOffersByOrder((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([id]) => ids.includes(id))),
    );

    const unsubs = ids.map((orderId) =>
      onSnapshot(
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
              // Профиль подошьётся из masterCards, когда анкета догрузится
              rating: null,
              reviewsCount: 0,
              lastName: '',
              experienceYears: null,
              education: null,
              completedOrders: 0,
            };
          });
          setOffersByOrder((prev) => ({ ...prev, [orderId]: list }));
        },
        (e) => console.warn('Предложения недоступны:', e),
      ),
    );

    return () => unsubs.forEach((u) => u());
  }, [uid, openOrderIdsKey]);

  // ---------- переписка по заявкам ----------
  // Общий чат клиента и мастера лежит внутри самой заявки: права доступа
  // выводятся из неё, и обе стороны видят одни и те же сообщения.
  const orderIdsKey = orders
    .map((o) => o.id)
    .sort()
    .join(',');

  // Подписка перезапускается только при смене набора заявок, а имя мастера
  // появляется в уже существующей. Замыкание держало бы `orders` на момент
  // подписки, и чат остался бы «Мастер» без имени.
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

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

    const unsubs = ids.map((orderId) =>
      onSnapshot(
        query(collection(db, 'orders', orderId, 'messages'), orderBy('createdAt', 'asc')),
        (snap) => {
          const messages: ChatMessage[] = snap.docs.map((m) => {
            const v = m.data();
            return {
              id: m.id,
              // «свой» — тот, кто отправил; для клиента это он сам
              from: v.senderId === uid ? 'user' : 'master',
              // Стёртое при удалении аккаунта сообщение: место остаётся, слов нет
              text: v.redactedAt ? 'Сообщение удалено' : v.text,
              time: v.time,
              ...(typeof v.imageUrl === 'string' ? { imageUrl: v.imageUrl } : {}),
            };
          });
          const order = ordersRef.current.find((o) => o.id === orderId);
          setOrderThreads((prev) => {
            const next: Thread = {
              id: orderId,
              name: masterThreadName(order),
              icon: '🧑‍🔧',
              unread: false,
              canAttach: true,
              messages,
            };
            const rest = prev.filter((t) => t.id !== orderId);
            // Пустой тред тоже держим: кнопка «Сообщение» открывает чат сразу
            // после выбора мастера, когда сообщений ещё нет, — без треда
            // просьба открыть уходила бы в пустоту. Прятать пустые чаты —
            // забота списка на экране, а не данных.
            return [next, ...rest];
          });
        },
        (e) => console.warn('Переписка по заявке недоступна:', e),
      ),
    );

    return () => unsubs.forEach((u) => u());
  }, [uid, orderIdsKey]);

  // Мастера назначили на существующую заявку: набор идентификаторов прежний,
  // подписка не перезапустилась, а название чата уже другое. Без этого имя
  // появлялось бы только со следующим сообщением.
  useEffect(() => {
    setOrderThreads((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const name = masterThreadName(orders.find((o) => o.id === t.id));
        if (t.name === name) return t;
        changed = true;
        return { ...t, name };
      });
      // Возвращаем прежний массив, если менять нечего: иначе каждая правка
      // заявки перерисовывала бы список чатов
      return changed ? next : prev;
    });
  }, [orders]);

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

        setSupportThreads((prev) =>
          snap.docs.map((d) => {
            const v = d.data();
            const old = prev.find((t) => t.id === d.id);
            return {
              id: d.id,
              name: v.name,
              icon: v.icon,
              unread: !!v.unread,
              canAttach: false,
              lastAtMs: v.updatedAt?.toMillis?.() ?? null,
              messages: old?.messages ?? [],
            };
          }),
        );

        // подписываемся на сообщения новых тредов
        snap.docs.forEach((d) => {
          if (msgUnsubs.has(d.id)) return;
          const unsub = onSnapshot(
            query(
              collection(db, 'users', uid, 'threads', d.id, 'messages'),
              orderBy('createdAt', 'asc'),
            ),
            (msgSnap) => {
              const messages: ChatMessage[] = msgSnap.docs.map((m) => {
                const v = m.data();
                return { id: m.id, from: v.from, text: v.text, time: v.time };
              });
              setSupportThreads((prev) =>
                prev.map((t) => (t.id === d.id ? { ...t, messages } : t)),
              );
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

  // Заявка пишется по идентификатору, выданному шторкой заранее: setDoc по
  // известному id идемпотентен, а addDoc на каждый вызов создавал новую
  // заявку — двойное нажатие давало два заказа.
  const createOrder = async ({
    id,
    title,
    comment,
    photoUri,
    category,
    objectId,
    serviceLabel,
    address,
    preferredMasterId,
  }: OrderDraft) => {
    if (!uid) return;

    // Правила всё равно отклонят запись — но человеку нужен ответ словами,
    // а не «недостаточно прав»
    if (blocked) {
      setNotice(
        blockedReason
          ? `Создание заявок ограничено: ${blockedReason}`
          : 'Создание заявок ограничено модерацией. Напишите в поддержку',
      );
      return;
    }

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
        address: address || activeAddress,
        // Повторная заявка просит показать её прошлому мастеру первым.
        // Поле пишется только при создании; дальше правила его не пускают.
        ...(preferredMasterId ? { preferredMasterId } : {}),
        // По городу и специальности заявку находят мастера нужного профиля.
        // Город пустой — заявку увидят только те, кто не ограничил себя
        // городом; об этом предупреждает профиль.
        city: cityKey(city),
        category,
        // Объект и вид работы — для серверных напоминаний о повторяемых
        // услугах: по заголовку их надёжно не распознать
        objectId,
        serviceLabel,
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
    if (!uid || !order || !order.masterId) return false;
    if (order.status !== 'Завершена' || order.reviewed) return false;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return false;

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
      return true;
    } catch (e) {
      failed('Не удалось отправить отзыв. Проверьте связь')(e);
      return false;
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
    // Дата завершения — только серверным временем: правила не пропустят
    // другую, по ней мастер видит доход по месяцам
    updateDoc(doc(db, 'orders', orderId), {
      status: 'Завершена',
      completedAt: serverTimestamp(),
    }).catch(failed('Не удалось подтвердить выполнение. Проверьте связь'));
  };

  // Клиент не согласен с «выполнено»: работа возвращается тому же мастеру.
  // Иначе ложное «сделано» запирало бы клиента — подтвердить или ничего.
  // Сообщение в чат — после записи: рассказывать мастеру о возврате,
  // который не прошёл, нельзя.
  const returnOrderToWork = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.status !== 'Ждёт подтверждения') return;
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: 'В работе' });
    } catch (e) {
      failed('Не удалось вернуть заявку в работу. Проверьте связь')(e);
      return;
    }
    await sendMessage(orderId, 'Работа ещё не закончена — прошу доделать.');
  };

  // ---------- расчёт напрямую ----------

  // Способ выбирает клиент после выбора мастера и может передумать, пока
  // никто не отметил расчёт; правила держат то же самое
  const choosePaymentMethod = (orderId: string, method: PaymentMethod) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || !order.masterId || !SETTLING.includes(order.status)) return;
    if (order.paidMs != null || order.paymentReceivedMs != null) return;
    updateDoc(doc(db, 'orders', orderId), { paymentMethod: method }).catch(
      failed('Не удалось сохранить способ оплаты. Проверьте связь'),
    );
  };

  // «Оплатил» — один раз, серверным временем: отметка не снимается, это
  // след расчёта для спора. Сами деньги через сервис не проходят
  const markOrderPaid = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || !order.masterId || !order.paymentMethod || order.paidMs != null) return;
    if (!SETTLING.includes(order.status)) return;
    updateDoc(doc(db, 'orders', orderId), { paidAt: serverTimestamp() }).catch(
      failed('Не удалось отметить оплату. Проверьте связь'),
    );
  };

  const cancelOrder = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || !CANCELLABLE.includes(order.status)) return;
    updateDoc(doc(db, 'orders', orderId), { status: 'Отменена' }).catch(
      failed('Не удалось отменить заявку. Проверьте связь'),
    );
  };

  // Новый адрес: добавляем в список (без дублей) и сразу делаем активным
  // Отказ правил или сети здесь не проглатывается: экран уже показывает
  // новое значение, и без уведомления оно молча пропало бы после перезапуска
  const saveFailed = failed('Не удалось сохранить изменения. Проверьте связь');

  const addAddress = (addr: string) => {
    // Тот же потолок, что у адреса в заявке (правила: 200 символов)
    const trimmed = addr.trim().slice(0, 200);
    if (!trimmed) return;
    const next = addresses.includes(trimmed) ? addresses : [...addresses, trimmed];
    setAddresses(next);
    setActiveAddressLocal(trimmed);
    const ref = userDoc();
    if (ref) updateDoc(ref, { addresses: next, activeAddress: trimmed }).catch(saveFailed);
  };

  const setActiveAddress = (addr: string) => {
    setActiveAddressLocal(addr);
    const ref = userDoc();
    if (ref) updateDoc(ref, { activeAddress: addr }).catch(saveFailed);
  };

  const setUserName = (name: string) => {
    setUserNameLocal(name);
    const ref = userDoc();
    if (ref) updateDoc(ref, { name }).catch(saveFailed);
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
    if (ref) updateDoc(ref, { city: trimmed }).catch(saveFailed);
  };

  const setThemeMode = useCallback((next: ThemeMode) => {
    setThemeModeLocal(next);
    const u = uidRef.current;
    if (u) updateDoc(doc(db, 'users', u), { themeMode: next }).catch(() => {});
  }, []);

  // Значение темы держится одно, пока не сменилась сама тема: объект,
  // пересоздаваемый на каждый рендер провайдера, заставлял перерисовываться
  // каждый компонент с useTheme() при каждом событии Firestore — а их у
  // клиента с десятком заявок несколько десятков на старте
  const themeValue = useMemo(
    () => ({ mode: themeMode, colors: palettes[themeMode], setMode: setThemeMode }),
    [themeMode, setThemeMode],
  );

  const setRemindersOff = (off: boolean) => {
    setRemindersOffLocal(off);
    const ref = userDoc();
    if (ref) updateDoc(ref, { remindersOff: off }).catch(saveFailed);
  };

  // Ошибку не глотаем: тумблер, который «выключил», а пуши идут дальше, —
  // хуже, чем тумблер, который честно не сработал
  const setPushOff = (off: boolean) => {
    setPushOffLocal(off);
    const ref = userDoc();
    if (ref) {
      updateDoc(ref, { pushOff: off }).catch((e) => {
        setPushOffLocal(!off);
        failed('Не удалось сохранить настройку уведомлений. Проверьте связь')(e);
      });
    }
  };

  // ---------- жалобы и блокировка ----------

  // Жалоба клиента — на мастера заявки или на его сообщение. Правила сверяют
  // заявку: жаловаться можно только на того, с кем имел дело
  const reportMaster = async (orderId: string, text: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order?.masterId || !text.trim()) return false;
    try {
      await fileComplaint({ subjectType: 'master', orderId, masterId: order.masterId, text });
      return true;
    } catch (e) {
      failed('Жалоба не отправлена. Проверьте связь')(e);
      return false;
    }
  };

  const reportMessage = async (orderId: string, messageId: string, text: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order?.masterId || !text.trim()) return false;
    try {
      await fileComplaint({
        subjectType: 'message',
        orderId,
        masterId: order.masterId,
        messageId,
        text,
      });
      return true;
    } catch (e) {
      failed('Жалоба не отправлена. Проверьте связь')(e);
      return false;
    }
  };

  // Блокировка живёт в профиле клиента: массив идентификаторов читают
  // правила предложений и сервер при рассылке, имена — только этот экран.
  // Уже идущая заявка не отменяется: блокировка — про будущее
  const blockMaster = (masterId: string, name: string) => {
    const ref = userDoc();
    if (!ref || blockedMasterIds.includes(masterId)) return;
    setBlockedMasterIds((prev) => [...prev, masterId]);
    setBlockedMasterNames((prev) => ({ ...prev, [masterId]: name }));
    updateDoc(ref, {
      blockedMasters: arrayUnion(masterId),
      [`blockedMasterNames.${masterId}`]: name,
    }).catch((e) => {
      setBlockedMasterIds((prev) => prev.filter((id) => id !== masterId));
      setBlockedMasterNames((prev) => {
        const next = { ...prev };
        delete next[masterId];
        return next;
      });
      failed('Не удалось заблокировать мастера. Проверьте связь')(e);
    });
  };

  const unblockMaster = (masterId: string) => {
    const ref = userDoc();
    if (!ref) return;
    setBlockedMasterIds((prev) => prev.filter((id) => id !== masterId));
    updateDoc(ref, {
      blockedMasters: arrayRemove(masterId),
      [`blockedMasterNames.${masterId}`]: deleteField(),
    }).catch((e) => {
      setBlockedMasterIds((prev) => (prev.includes(masterId) ? prev : [...prev, masterId]));
      failed('Не удалось снять блокировку. Проверьте связь')(e);
    });
  };

  const blockedMasters = blockedMasterIds.map((id) => ({
    id,
    name: blockedMasterNames[id] ?? 'Мастер',
  }));

  const markThreadRead = (threadId: string) => {
    if (!uid) return;
    const thread = [...orderThreads, ...supportThreads].find((t) => t.id === threadId);
    const lastId = thread?.messages[thread.messages.length - 1]?.id ?? '';
    setReadThreads((prev) => {
      const next = new Map(prev).set(threadId, lastId);
      if (readKey) {
        AsyncStorage.setItem(readKey, JSON.stringify(Object.fromEntries(next))).catch(() => {});
      }
      return next;
    });
    if (threadId === SUPPORT_THREAD_ID) {
      updateDoc(doc(db, 'users', uid, 'threads', threadId), { unread: false }).catch(() => {});
    }
  };

  const sendMessage = async (threadId: string, text: string) => {
    if (!uid) return;

    // Заявка — общий чат с мастером внутри самой заявки. Поддержка — личный
    // тред: его читает модератор и отвечает из раздела модерации, ничего
    // не подставляется.
    if (threadId !== SUPPORT_THREAD_ID) {
      try {
        await addDoc(collection(db, 'orders', threadId, 'messages'), {
          senderId: uid,
          text,
          time: now(),
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        failed('Сообщение не отправлено. Проверьте связь')(e);
      }
      return;
    }

    const threadRef = doc(db, 'users', uid, 'threads', threadId);
    try {
      // kind — по нему модератор собирает обращения запросом по группе
      // коллекций; lastText и lastFrom — превью и отметка «ждёт ответа»
      // в его списке, чтобы не читать сообщения каждого треда
      await setDoc(
        threadRef,
        {
          kind: 'support',
          lastText: text,
          lastFrom: 'user',
          // Закрытое модератором обращение с новым сообщением снова «новое»:
          // иначе оно пряталось бы под фильтром, и ответа не дождаться
          supportStatus: 'новое',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await addDoc(collection(threadRef, 'messages'), {
        from: 'user',
        text,
        time: now(),
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      failed('Сообщение не отправлено. Проверьте связь')(e);
    }
  };

  // Фото в чат заявки: файл уезжает в chat/ под заявкой, в сообщении остаётся
  // ссылка; подпись из поля ввода едет тем же сообщением.
  const sendImageMessage = async (threadId: string, localUri: string, caption: string) => {
    if (!uid || threadId === SUPPORT_THREAD_ID) return false;
    try {
      const imageUrl = await uploadChatPhoto(threadId, uid, localUri);
      await addDoc(collection(db, 'orders', threadId, 'messages'), {
        senderId: uid,
        text: caption,
        imageUrl,
        time: now(),
        createdAt: serverTimestamp(),
      });
      return true;
    } catch (e) {
      failed('Фото не отправлено. Проверьте связь')(e);
      return false;
    }
  };

  // Экспорт данных: файл собирается из того, что владелец и так читает
  // своими правами, — серверу здесь делать нечего
  const exportMyData = async () => {
    if (!uid) return;
    try {
      await exportUserData(uid, user?.email ?? '', authPhone ?? '');
    } catch (e) {
      failed('Не удалось собрать файл с данными. Проверьте связь')(e);
    }
  };

  // Открыть чат из другого экрана и перевести на вкладку «Сообщения».
  // Для поддержки создаём тред с приветствием, для заявки он появится сам,
  // как только кто-то напишет первое сообщение.
  const openChat = (threadId: string) => {
    // Экран — сразу, запись — следом: без сети кнопка иначе выглядела бы
    // мёртвой, а переписка появится на экране, как только тред запишется
    setOpenThreadRequest(threadId);
    router.navigate('/messages');
    if (uid && threadId === SUPPORT_THREAD_ID && !supportThreads.find((t) => t.id === threadId)) {
      const threadRef = doc(db, 'users', uid, 'threads', threadId);
      setDoc(
        threadRef,
        {
          name: 'Поддержка',
          icon: '🛟',
          kind: 'support',
          unread: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
        .then(() =>
          // Приветствие автоматическое и не притворяется живым человеком:
          // отвечает модератор, когда прочитает. Отметка auto говорит серверу
          // не слать об этом сообщении пуш — человек и так смотрит на экран.
          // Идентификатор фиксированный: второе открытие до прихода списка
          // не должно рождать второе приветствие; правила не дают переписать
          // сообщение, поэтому повтор просто отклоняется
          setDoc(doc(threadRef, 'messages', 'welcome'), {
            from: 'master',
            text: 'Здравствуйте! Опишите вопрос — мы читаем все обращения и ответим здесь же.',
            auto: true,
            time: now(),
            createdAt: serverTimestamp(),
          }),
        )
        .catch((e) => {
          if (firestoreErrorCode(e) !== 'permission-denied') {
            console.warn('Не удалось открыть переписку:', e);
          }
        });
    }
  };

  // ---------- аккаунт ----------

  // Оверлеи закрываем до выхода: иначе следующий вошедший увидит раздел
  // мастера или чужой чат, открытые не им
  const logout = async () => {
    setMasterOpen(false);
    setChatOpen(false);
    setOverlayOpen(false);
    // Токен этого устройства уходит из профиля: после выхода сюда не должны
    // приходить уведомления ушедшего аккаунта — телефон могли передать
    // Без сети запись не подтвердится никогда — ждём её не дольше полутора
    // секунд: выход важнее чистоты списка токенов
    if (uid && pushToken) {
      await Promise.race([
        updateDoc(doc(db, 'users', uid), { pushTokens: arrayRemove(pushToken) }).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    await signOutUser();
  };

  // Смена пароля. Экран про Firebase не знает — ошибки переводятся здесь.
  const changePassword = async (current: string, next: string) => {
    try {
      await changeAuthPassword(current, next);
    } catch (e) {
      throw new Error(authErrorText(e));
    }
  };

  // Код на собственный номер — подтверждение удаления для телефонного
  // аккаунта: пароля у него нет, а удалять без подтверждения нельзя
  const requestDeleteCode = async (): Promise<'sms' | 'call'> => {
    if (!authPhone) throw new Error('У аккаунта нет номера телефона');
    try {
      const result = await requestPhoneCode(authPhone);
      if (result === 'not-configured') {
        throw new Error('Отправка кода сейчас недоступна. Напишите в поддержку');
      }
      return result.channel;
    } catch (e) {
      throw new Error(phoneAuthErrorText(e, 'Не удалось отправить код. Попробуйте ещё раз'));
    }
  };

  // Удаление аккаунта — требование магазинов приложений и просто честность.
  // Уходит всё личное: профиль с адресами, переписка, анкета мастера.
  // Заявки остаются: они общие с мастером и служат историей расчётов, —
  // но незакрытые отменяются, чтобы никто не ехал к исчезнувшему клиенту.
  const deleteAccount = async (secret: string) => {
    if (!uid) return;

    // Владельца проверяем до того, как удалено хоть что-то: пароль — у
    // парольного аккаунта, код из СМС — у телефонного. Вход по коду заодно
    // освежает сессию, без чего Firebase не отдаст удаление.
    try {
      if (hasPassword) await reauthenticate(secret);
      else if (authPhone) await signInWithPhone(authPhone, secret, false);
      else throw new Error('Сессия не найдена — войдите заново');
    } catch (e) {
      throw new Error(hasPassword ? authErrorText(e) : phoneAuthErrorText(e));
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
      // Просьба уже лежит с прошлой, оборванной попытки: правила не дают её
      // переписать, но и повторять не нужно — сервер и сверка доведут её до
      // конца, а здесь продолжаем свою часть
      if (firestoreErrorCode(e) !== 'permission-denied') {
        deleting.current = false;
        console.warn('Не удалось создать заявку на удаление:', e);
        throw new Error(firestoreErrorText(e, 'Не удалось удалить аккаунт. Попробуйте ещё раз'));
      }
    }

    // Дальше — то же самое, но своими силами и без права на ошибку каждого
    // шага: функции могут быть не развёрнуты (для них нужен тариф Blaze), а
    // удаление аккаунта обязано работать всегда. Обе стороны идемпотентны,
    // поэтому двойная работа безвредна: что успел клиент, функция пропустит.
    const quietly = (p: Promise<unknown>) => p.catch(() => {});

    await Promise.all(
      orders
        .filter((o) => CANCELLABLE.includes(o.status))
        .map((o) => quietly(updateDoc(doc(db, 'orders', o.id), { status: 'Отменена' }))),
    );

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
    await quietly(deleteDoc(doc(db, 'masters', uid, 'payment', 'details')));
    await quietly(deleteVerificationPhoto(uid));
    await quietly(deleteDoc(doc(db, 'masters', uid)));
    await quietly(deleteDoc(doc(db, 'users', uid)));

    // Аккаунт — последним: после него правила уже ничего не разрешат.
    // Если не выйдет, его удалит функция.
    await quietly(deleteAuthUser());
    await quietly(signOutUser());
  };

  // Непрочитанным считаем чат, где последнее сообщение не наше и его ещё
  // не видели: у поддержки флаг ставит сервер, у заявок — сам список.
  // Закрытым — чат заявки, по которой сделки больше нет: правила туда не
  // пустят, и поле ввода не должно обещать обратного
  const threads: Thread[] = [...orderThreads, ...supportThreads].map((t) => {
    const last = t.messages[t.messages.length - 1];
    const seen = readThreads.get(t.id);
    const unread =
      t.id === SUPPORT_THREAD_ID
        ? t.unread && seen !== last?.id
        : !!last && last.from === 'master' && seen !== last.id;
    const order = t.id === SUPPORT_THREAD_ID ? undefined : orders.find((o) => o.id === t.id);
    // Закрыт и чат с мастером, удалившим аккаунт: писать ему некуда
    const closed =
      !!order && (!TALKABLE.includes(order.status) || order.masterName === 'Удалённый аккаунт');
    const lastAtMs = order ? (order.lastMessageAtMs ?? null) : (t.lastAtMs ?? null);
    return unread === t.unread && closed === !!t.closed && lastAtMs === (t.lastAtMs ?? null)
      ? t
      : { ...t, unread, closed, lastAtMs };
  });
  // Свежие сверху — по последнему сообщению, а не по порядку прихода подписок
  threads.sort((a, b) => (b.lastAtMs ?? 0) - (a.lastAtMs ?? 0));

  const hasUnreadMessages = threads.some((t) => t.unread);
  const ordersActive = orders.filter((o) => !CLOSED.includes(o.status)).length;

  // Предложения и профили мастеров живут отдельными подписками — экрану они
  // нужны внутри заявки, поэтому сшиваем их здесь, а не в UI
  const ordersWithOffers: Order[] = orders.map((o) => {
    // Предложения заблокированных мастеров правила уже не пропускают; те,
    // что успели прийти до блокировки, прячем здесь
    // Только у открытой заявки: после выбора мастера или отмены в списке
    // вместо статуса иначе читалось бы «N предложений»
    const list =
      o.status === 'Поиск мастера'
        ? offersByOrder[o.id]?.filter((offer) => !blockedMasterIds.includes(offer.masterId))
        : undefined;
    if (!list?.length) return o;
    return {
      ...o,
      offers: list.map((offer) => {
        const card = masterCards[offer.masterId];
        return {
          ...offer,
          rating: card?.rating ?? null,
          reviewsCount: card?.reviewsCount ?? 0,
          lastName: card?.lastName ?? '',
          experienceYears: card?.experienceYears ?? null,
          education: card?.education ?? null,
          completedOrders: card?.completedOrders ?? 0,
        };
      }),
    };
  });

  const value: AppState = {
    orders: ordersWithOffers,
    threads,
    userName,
    userEmail: user?.email ?? '',
    userPhone: authPhone ?? '',
    authMethod: hasPassword ? 'password' : 'phone',
    addresses,
    activeAddress,
    city,
    consents,
    acceptConsents,
    typingThreadId,
    openThreadRequest,
    clearOpenThreadRequest: () => setOpenThreadRequest(null),
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
    remindersOff,
    pushOff,
    blocked,
    blockedReason,
    setRemindersOff,
    setPushOff,
    setActiveAddress,
    setCity,
    setChatOpen,
    setOverlayOpen,
    setMasterOpen,
    setAdminOpen,
    createOrder,
    confirmOrderDone,
    returnOrderToWork,
    choosePaymentMethod,
    markOrderPaid,
    cancelOrder,
    acceptOffer,
    reportMaster,
    reportMessage,
    blockedMasters,
    blockMaster,
    unblockMaster,
    submitReview,
    acceptPrice,
    declinePrice,
    addAddress,
    markThreadRead,
    sendMessage,
    sendImageMessage,
    exportMyData,
    openChat,
    logout,
    changePassword,
    requestDeleteCode,
    deleteAccount,
  };

  return (
    <ThemeContext.Provider value={themeValue}>
      <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
    </ThemeContext.Provider>
  );
}
