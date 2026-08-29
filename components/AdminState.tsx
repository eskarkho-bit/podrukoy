import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebaseConfig';
import { useAuth } from './AuthState';
import { useAppState } from './AppState';
import { callableErrorText, firestoreErrorText } from './firestoreError';
import { loadAdminStats, type AdminStats } from './adminStats';

// Слой данных раздела модерации.
//
// Правило «экраны не знают о Firestore» распространяется и на админку, но
// класть её подписки в AppState значило бы возить код модерации у каждого
// пользователя. Поэтому у админки свой провайдер: он монтируется только у
// модератора, вокруг оверлея AdminScreen, и живёт только пока тот существует.
//
// Живых подписок ровно четыре — очередь проверки, треды поддержки, свежие
// жалобы и дашборд — и только при открытом разделе. Списки заявок и журнал
// ходят страницами через getDocs: держать live-канал на всю коллекцию заявок
// админский экран не должен.
//
// Мутации — по гибридной схеме: вердикт по анкете и ответ поддержки пишутся
// напрямую под правилами (работают и без развёрнутых функций), всё новое —
// блокировки, закрытия, скрытия, вердикты по жалобам — только через callable
// с серверной проверкой admins/{uid}.

const PAGE = 30;

// Сколько обращений держим в списке. Старее полусотни — уже архив,
// а не очередь на ответ.
const SUPPORT_LIMIT = 50;

export type Pending = {
  uid: string;
  name: string;
  cities: string[];
  skills: string[];
  phone: string;
  about: string;
  photoUrl: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  /** Когда подана — чтобы видеть, что залежалось */
  appliedMs: number | null;
};

export type SupportStatus = 'новое' | 'в работе' | 'закрыто';

export type SupportThread = {
  uid: string;
  lastText: string;
  /** 'user' — клиент ждёт ответа, 'master' — последним отвечала поддержка */
  lastFrom: 'user' | 'master';
  updatedMs: number | null;
  supportStatus: SupportStatus;
};

export type SupportMessage = { id: string; from: 'user' | 'master'; text: string; time: string };

export type AdminOrder = {
  id: string;
  title: string;
  status: string;
  clientId: string;
  clientName: string;
  masterId: string | null;
  masterName: string | null;
  city: string;
  category: string;
  address: string;
  comment: string;
  photoUrl: string | null;
  agreedPrice: number | null;
  createdMs: number | null;
  completedMs: number | null;
  closedByAdmin: boolean;
  adminCloseReason: string | null;
};

export type AdminOffer = {
  masterId: string;
  masterName: string;
  price: number;
  comment: string;
  status: 'pending' | 'accepted';
};

export type OrderMessage = { id: string; senderId: string; text: string; time: string };

export type AdminOrderCard = {
  order: AdminOrder;
  offers: AdminOffer[];
  messages: OrderMessage[];
};

export type OrdersFilter = {
  status: string | null;
  category: string | null;
  /** Не старше стольких дней; null — за всё время */
  days: number | null;
};

export type Complaint = {
  id: string;
  byUid: string;
  masterId: string;
  orderId: string;
  reviewClientId: string;
  text: string;
  status: string;
  createdMs: number | null;
};

export type AdminReview = {
  masterId: string;
  orderId: string;
  stars: number;
  text: string;
  clientId: string;
  clientName: string;
  hidden: boolean;
};

export type AuditEntry = {
  id: string;
  action: string;
  actorType: string;
  actorUid: string | null;
  subjectType: string;
  subjectId: string;
  atMs: number | null;
  details: Record<string, unknown>;
};

export type AuditFilter = {
  action?: string;
  subject?: { type: string; id: string };
};

export type AuditPage = { entries: AuditEntry[]; cursor: unknown | null };

export type FoundUser = {
  uid: string;
  name: string | null;
  isMaster: boolean;
  verified: boolean;
  userBlocked: boolean;
  masterBlocked: boolean;
};

export type AdminUserCard = {
  /** Профиль клиента; may not exist — аккаунт мог быть только мастерским */
  profile: {
    exists: boolean;
    name: string;
    phone: string;
    city: string;
    blocked: boolean;
    blockedReason: string | null;
  };
  master: {
    exists: boolean;
    name: string;
    verified: boolean;
    blocked: boolean;
    rating: number | null;
    reviewsCount: number;
    completedOrders: number;
  };
  clientOrders: AdminOrder[];
  masterOrders: AdminOrder[];
  /** Отзывы, написанные этим человеком о мастерах */
  reviews: AdminReview[];
  /** Жалобы, поданные этим человеком */
  complaints: Complaint[];
};

export type DashboardData = {
  days: { date: string; created: number; completed: number }[];
  weeks: { start: string; created: number; completed: number }[];
  conversion30d: { total: number; picked: number };
  activeMasters: number;
  timeToFirstOffer7d: { avgMinutes: number | null; withOffers: number; withoutOffers: number };
  updatedMs: number | null;
};

type AdminStateValue = {
  // Модерация мастеров
  pending: Pending[];
  decide: (uid: string, approved: boolean, reason: string) => Promise<void>;

  // Сводка и дашборд
  stats: AdminStats | null;
  refreshing: boolean;
  refreshStats: () => Promise<void>;
  dashboard: DashboardData | null;

  // Заявки: страницы, фильтр, карточка
  orders: AdminOrder[];
  ordersFilter: OrdersFilter;
  ordersExhausted: boolean;
  ordersLoading: boolean;
  setOrdersFilter: (f: OrdersFilter) => void;
  loadMoreOrders: () => Promise<void>;
  openOrderById: (orderId: string) => Promise<AdminOrder | null>;
  watchOrder: (orderId: string, cb: (card: AdminOrderCard | null) => void) => () => void;
  closeOrder: (
    orderId: string,
    outcome: 'Отменена' | 'Завершена',
    reason: string,
  ) => Promise<boolean>;

  // Люди
  findByPhone: (phone: string) => Promise<FoundUser[] | null>;
  watchUserCard: (uid: string, cb: (card: AdminUserCard) => void) => () => void;
  setUserBlocked: (uid: string, blocked: boolean, reason: string) => Promise<boolean>;
  setMasterBlocked: (uid: string, blocked: boolean, reason: string) => Promise<boolean>;

  // Поддержка
  supportThreads: SupportThread[];
  watchSupportChat: (uid: string, cb: (messages: SupportMessage[]) => void) => () => void;
  sendSupportReply: (uid: string, text: string) => Promise<boolean>;
  setSupportStatus: (uid: string, status: SupportStatus) => Promise<void>;

  // Отзывы и жалобы
  complaints: Complaint[];
  loadComplaintsArchive: () => Promise<Complaint[]>;
  resolveComplaint: (
    id: string,
    outcome: 'решена' | 'отклонена',
    note?: string,
  ) => Promise<boolean>;
  setReviewHidden: (
    masterId: string,
    orderId: string,
    hidden: boolean,
    reason: string,
  ) => Promise<boolean>;

  // Журнал
  loadAudit: (filter: AuditFilter, cursor?: unknown) => Promise<AuditPage>;
};

const AdminStateContext = createContext<AdminStateValue | null>(null);

export function useAdminState() {
  const ctx = useContext(AdminStateContext);
  if (!ctx) throw new Error('useAdminState вызван вне AdminStateProvider');
  return ctx;
}

const ms = (v: unknown): number | null =>
  (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null;

function toAdminOrder(d: QueryDocumentSnapshot | DocumentSnapshot): AdminOrder {
  const v = d.data() ?? {};
  return {
    id: d.id,
    title: String(v.title ?? 'Заявка'),
    status: String(v.status ?? ''),
    clientId: String(v.clientId ?? ''),
    clientName: String(v.clientName ?? ''),
    masterId: typeof v.masterId === 'string' ? v.masterId : null,
    masterName: typeof v.masterName === 'string' ? v.masterName : null,
    city: String(v.city ?? ''),
    category: String(v.category ?? ''),
    address: String(v.address ?? ''),
    comment: String(v.comment ?? ''),
    photoUrl: typeof v.photoUrl === 'string' ? v.photoUrl : null,
    agreedPrice: typeof v.agreedPrice === 'number' ? v.agreedPrice : null,
    createdMs: ms(v.createdAt),
    completedMs: ms(v.completedAt),
    closedByAdmin: v.closedByAdmin === true,
    adminCloseReason: typeof v.adminCloseReason === 'string' ? v.adminCloseReason : null,
  };
}

function toComplaint(d: QueryDocumentSnapshot | DocumentSnapshot): Complaint {
  const v = d.data() ?? {};
  return {
    id: d.id,
    byUid: String(v.byUid ?? ''),
    masterId: String(v.masterId ?? ''),
    orderId: String(v.orderId ?? ''),
    reviewClientId: String(v.reviewClientId ?? ''),
    text: String(v.text ?? ''),
    status: String(v.status ?? ''),
    createdMs: ms(v.createdAt),
  };
}

export function AdminStateProvider({ open, children }: { open: boolean; children: ReactNode }) {
  const { user } = useAuth();
  const { isAdmin, showNotice } = useAppState();
  const active = open && isAdmin;

  // ---------- очередь проверки ----------

  const [pending, setPending] = useState<Pending[]>([]);
  useEffect(() => {
    if (!active) return;
    return onSnapshot(
      query(collectionGroup(db, 'verification'), where('status', '==', 'pending')),
      async (snap) => {
        // Имя, город и специальности лежат в самой анкете, а не в заявке:
        // дублировать их незачем, а модератору они нужны
        const rows = await Promise.all(
          snap.docs.map(async (d) => {
            const uid = d.ref.parent.parent?.id;
            if (!uid) return null;
            const v = d.data();
            const profile = await getDoc(doc(db, 'masters', uid)).catch(() => null);
            return {
              uid,
              name: String(profile?.get('name') ?? 'Без имени'),
              cities: Array.isArray(profile?.get('cities'))
                ? profile.get('cities')
                : profile?.get('city')
                  ? [String(profile.get('city'))]
                  : [],
              skills: Array.isArray(profile?.get('skills')) ? profile.get('skills') : [],
              phone: String(v.phone ?? ''),
              about: String(v.about ?? ''),
              photoUrl: typeof v.photoUrl === 'string' ? v.photoUrl : null,
              cardLast4: typeof v.cardLast4 === 'string' ? v.cardLast4 : null,
              cardBrand: typeof v.cardBrand === 'string' ? v.cardBrand : null,
              appliedMs: ms(v.appliedAt),
            } as Pending;
          }),
        );
        setPending(rows.filter((r): r is Pending => r !== null));
      },
      (e) => console.warn('Очередь модерации недоступна:', e),
    );
  }, [active]);

  // Одобрение — два документа одним пакетом: флаг доступа и вердикт по
  // заявке. Порознь они могли бы разъехаться, и мастер остался бы
  // «одобренным» без доступа или наоборот.
  const decide = useCallback(
    async (uid: string, approved: boolean, reason: string) => {
      if (!user) return;
      try {
        const batch = writeBatch(db);
        if (approved) {
          batch.update(doc(db, 'masters', uid), { verified: true });
        }
        batch.update(doc(db, 'masters', uid, 'verification', 'application'), {
          status: approved ? 'approved' : 'rejected',
          rejectionReason: approved ? null : reason.trim() || 'Причина не указана',
          reviewedAt: serverTimestamp(),
          reviewedBy: user.uid,
        });
        await batch.commit();
      } catch (e) {
        console.warn('Не удалось вынести решение:', e);
        showNotice(firestoreErrorText(e, 'Не удалось сохранить решение'));
      }
    },
    [user, showNotice],
  );

  // ---------- сводка и дашборд ----------

  // Сводка не подписка, а разовый запрос: агрегатные запросы Firestore
  // одноразовые, живого счётчика из них не выйдет. Обновляется при открытии
  // раздела и жестом «потянуть вниз».
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshStats = useCallback(async () => {
    setRefreshing(true);
    try {
      setStats(await loadAdminStats());
    } catch (e) {
      console.warn('Сводка недоступна:', e);
      showNotice(firestoreErrorText(e, 'Не удалось посчитать сводку'));
    }
    setRefreshing(false);
  }, [showNotice]);

  useEffect(() => {
    if (!active) return;
    refreshStats();
  }, [active, refreshStats]);

  // Дашборд считает сервер по расписанию; здесь — только чтение готового
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  useEffect(() => {
    if (!active) return;
    return onSnapshot(
      doc(db, 'stats', 'dashboard'),
      (snap) => {
        if (!snap.exists()) {
          setDashboard(null);
          return;
        }
        const v = snap.data();
        setDashboard({
          days: Array.isArray(v.days) ? v.days : [],
          weeks: Array.isArray(v.weeks) ? v.weeks : [],
          conversion30d: v.conversion30d ?? { total: 0, picked: 0 },
          activeMasters: Number(v.activeMasters ?? 0),
          timeToFirstOffer7d: v.timeToFirstOffer7d ?? {
            avgMinutes: null,
            withOffers: 0,
            withoutOffers: 0,
          },
          updatedMs: ms(v.updatedAt),
        });
      },
      (e) => console.warn('Дашборд недоступен:', e),
    );
  }, [active]);

  // ---------- заявки ----------

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [ordersFilter, setOrdersFilterState] = useState<OrdersFilter>({
    status: null,
    category: null,
    days: 30,
  });
  const [ordersExhausted, setOrdersExhausted] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  // Курсор пагинации и счётчик запросов: страница, приехавшая после смены
  // фильтра, не должна попасть в чужой список
  const paging = useRef({ cursor: null as QueryDocumentSnapshot | null, seq: 0 }).current;

  const ordersQuery = useCallback((filter: OrdersFilter, after: QueryDocumentSnapshot | null) => {
    const parts = [
      filter.status ? where('status', '==', filter.status) : null,
      filter.category ? where('category', '==', filter.category) : null,
      filter.days
        ? where('createdAt', '>=', new Date(Date.now() - filter.days * 24 * 60 * 60 * 1000))
        : null,
    ].filter((p): p is NonNullable<typeof p> => p !== null);
    const base = query(
      collection(db, 'orders'),
      ...parts,
      orderBy('createdAt', 'desc'),
      limit(PAGE),
    );
    return after ? query(base, startAfter(after)) : base;
  }, []);

  const loadOrdersPage = useCallback(
    async (filter: OrdersFilter, reset: boolean) => {
      const seq = ++paging.seq;
      if (reset) {
        paging.cursor = null;
        setOrders([]);
        setOrdersExhausted(false);
      }
      setOrdersLoading(true);
      try {
        const snap = await getDocs(ordersQuery(filter, reset ? null : paging.cursor));
        if (seq !== paging.seq) return; // фильтр уже сменился
        paging.cursor = snap.size ? snap.docs[snap.size - 1] : paging.cursor;
        setOrders((prev) => (reset ? [] : prev).concat(snap.docs.map(toAdminOrder)));
        setOrdersExhausted(snap.size < PAGE);
      } catch (e) {
        console.warn('Список заявок недоступен:', e);
        showNotice(firestoreErrorText(e, 'Не удалось загрузить заявки'));
      }
      if (seq === paging.seq) setOrdersLoading(false);
    },
    [ordersQuery, showNotice, paging],
  );

  const setOrdersFilter = useCallback(
    (f: OrdersFilter) => {
      setOrdersFilterState(f);
      loadOrdersPage(f, true);
    },
    [loadOrdersPage],
  );

  const loadMoreOrders = useCallback(
    () => loadOrdersPage(ordersFilter, false),
    [loadOrdersPage, ordersFilter],
  );

  // Первая страница — при открытии раздела
  const [ordersPrimed, setOrdersPrimed] = useState(false);
  useEffect(() => {
    if (!active || ordersPrimed) return;
    setOrdersPrimed(true);
    loadOrdersPage(ordersFilter, true);
  }, [active, ordersPrimed, loadOrdersPage, ordersFilter]);

  // «Поиск» по заявкам — это точный переход по id: полнотекстового поиска
  // у Firestore нет, и притворяться не будем
  const openOrderById = useCallback(async (orderId: string): Promise<AdminOrder | null> => {
    try {
      const snap = await getDoc(doc(db, 'orders', orderId.trim()));
      return snap.exists() ? toAdminOrder(snap) : null;
    } catch (e) {
      console.warn('Заявка не открылась:', e);
      return null;
    }
  }, []);

  // Карточка заявки: сама заявка, предложения и переписка (только чтение)
  const watchOrder = useCallback((orderId: string, cb: (card: AdminOrderCard | null) => void) => {
    let order: AdminOrder | null = null;
    let offers: AdminOffer[] = [];
    let messages: OrderMessage[] = [];
    const emit = () => cb(order ? { order, offers, messages } : null);

    const unsubs = [
      onSnapshot(
        doc(db, 'orders', orderId),
        (snap) => {
          order = snap.exists() ? toAdminOrder(snap) : null;
          emit();
        },
        (e) => console.warn('Заявка недоступна:', e),
      ),
      onSnapshot(
        query(collection(db, 'orders', orderId, 'offers'), orderBy('price', 'asc')),
        (snap) => {
          offers = snap.docs.map((d) => {
            const v = d.data();
            return {
              masterId: String(v.masterId ?? d.id),
              masterName: String(v.masterName ?? 'Мастер'),
              price: Number(v.price ?? 0),
              comment: String(v.comment ?? ''),
              status: v.status === 'accepted' ? ('accepted' as const) : ('pending' as const),
            };
          });
          emit();
        },
        (e) => console.warn('Предложения недоступны:', e),
      ),
      onSnapshot(
        query(collection(db, 'orders', orderId, 'messages'), orderBy('createdAt')),
        (snap) => {
          messages = snap.docs.map((d) => {
            const v = d.data();
            return {
              id: d.id,
              senderId: String(v.senderId ?? ''),
              text: String(v.text ?? ''),
              time: String(v.time ?? ''),
            };
          });
          emit();
        },
        (e) => console.warn('Переписка недоступна:', e),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // ---------- вызовы сервера ----------

  // Общий путь всех новых действий: callable с серверной проверкой прав.
  // Ошибка показывается человеку и не бросается дальше — экран по false
  // просто не закрывает форму.
  const call = useCallback(
    async (name: string, data: Record<string, unknown>, failText: string): Promise<boolean> => {
      try {
        await httpsCallable(functions, name)(data);
        return true;
      } catch (e) {
        console.warn(`${name} не выполнен:`, e);
        showNotice(callableErrorText(e, failText));
        return false;
      }
    },
    [showNotice],
  );

  const closeOrder = useCallback(
    (orderId: string, outcome: 'Отменена' | 'Завершена', reason: string) =>
      call('adminCloseOrder', { orderId, outcome, reason }, 'Не удалось закрыть заявку'),
    [call],
  );

  const setUserBlocked = useCallback(
    (uid: string, blocked: boolean, reason: string) =>
      call('adminSetUserBlocked', { uid, blocked, reason }, 'Не удалось изменить блокировку'),
    [call],
  );

  const setMasterBlocked = useCallback(
    (uid: string, blocked: boolean, reason: string) =>
      call('adminSetMasterBlocked', { uid, blocked, reason }, 'Не удалось изменить блокировку'),
    [call],
  );

  const setReviewHidden = useCallback(
    (masterId: string, orderId: string, hidden: boolean, reason: string) =>
      call(
        'adminSetReviewHidden',
        { masterId, orderId, hidden, reason },
        'Не удалось изменить отзыв',
      ),
    [call],
  );

  const resolveComplaint = useCallback(
    (complaintId: string, outcome: 'решена' | 'отклонена', note?: string) =>
      call(
        'adminResolveComplaint',
        { complaintId, outcome, note: note ?? null },
        'Не удалось закрыть жалобу',
      ),
    [call],
  );

  const findByPhone = useCallback(
    async (phone: string): Promise<FoundUser[] | null> => {
      try {
        const res = await httpsCallable(functions, 'adminFindUserByPhone')({ phone });
        const found = (res.data as { found?: FoundUser[] })?.found;
        return Array.isArray(found) ? found : [];
      } catch (e) {
        console.warn('Поиск не выполнен:', e);
        showNotice(callableErrorText(e, 'Поиск недоступен'));
        return null;
      }
    },
    [showNotice],
  );

  // ---------- карточка человека ----------

  const watchUserCard = useCallback((uid: string, cb: (card: AdminUserCard) => void) => {
    const card: AdminUserCard = {
      profile: {
        exists: false,
        name: '',
        phone: '',
        city: '',
        blocked: false,
        blockedReason: null,
      },
      master: {
        exists: false,
        name: '',
        verified: false,
        blocked: false,
        rating: null,
        reviewsCount: 0,
        completedOrders: 0,
      },
      clientOrders: [],
      masterOrders: [],
      reviews: [],
      complaints: [],
    };
    const emit = () => cb({ ...card });

    const unsubs = [
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          const v = snap.data() ?? {};
          card.profile = {
            exists: snap.exists(),
            name: String(v.name ?? ''),
            phone: String(v.phone ?? ''),
            city: String(v.city ?? ''),
            blocked: v.blocked === true,
            blockedReason: typeof v.blockedReason === 'string' ? v.blockedReason : null,
          };
          emit();
        },
        (e) => console.warn('Профиль недоступен:', e),
      ),
      onSnapshot(
        doc(db, 'masters', uid),
        (snap) => {
          const v = snap.data() ?? {};
          card.master = {
            exists: snap.exists(),
            name: String(v.name ?? ''),
            verified: v.verified === true,
            blocked: v.blocked === true,
            rating: typeof v.rating === 'number' ? v.rating : null,
            reviewsCount: Number(v.reviewsCount ?? 0),
            completedOrders: Number(v.completedOrders ?? 0),
          };
          emit();
        },
        (e) => console.warn('Анкета недоступна:', e),
      ),
      onSnapshot(
        query(
          collection(db, 'orders'),
          where('clientId', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(PAGE),
        ),
        (snap) => {
          card.clientOrders = snap.docs.map(toAdminOrder);
          emit();
        },
        (e) => console.warn('Заявки клиента недоступны:', e),
      ),
      onSnapshot(
        query(
          collection(db, 'orders'),
          where('masterId', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(PAGE),
        ),
        (snap) => {
          card.masterOrders = snap.docs.map(toAdminOrder);
          emit();
        },
        (e) => console.warn('Заявки мастера недоступны:', e),
      ),
      onSnapshot(
        query(
          collectionGroup(db, 'reviews'),
          where('clientId', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(PAGE),
        ),
        (snap) => {
          card.reviews = snap.docs.map((d) => {
            const v = d.data();
            return {
              masterId: d.ref.parent.parent?.id ?? '',
              orderId: d.id,
              stars: Number(v.stars ?? 0),
              text: String(v.text ?? ''),
              clientId: String(v.clientId ?? ''),
              clientName: String(v.clientName ?? ''),
              hidden: v.hidden === true,
            };
          });
          emit();
        },
        (e) => console.warn('Отзывы недоступны:', e),
      ),
      onSnapshot(
        query(
          collection(db, 'complaints'),
          where('byUid', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(PAGE),
        ),
        (snap) => {
          card.complaints = snap.docs.map(toComplaint);
          emit();
        },
        (e) => console.warn('Жалобы недоступны:', e),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // ---------- поддержка ----------

  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([]);
  useEffect(() => {
    if (!active) return;
    // Фильтр по kind обязателен — без него правила отклоняют запрос целиком
    return onSnapshot(
      query(
        collectionGroup(db, 'threads'),
        where('kind', '==', 'support'),
        orderBy('updatedAt', 'desc'),
        limit(SUPPORT_LIMIT),
      ),
      (snap) => {
        setSupportThreads(
          snap.docs.flatMap((d) => {
            const uid = d.ref.parent.parent?.id;
            if (!uid) return [];
            const v = d.data();
            return [
              {
                uid,
                lastText: String(v.lastText ?? ''),
                lastFrom: v.lastFrom === 'master' ? ('master' as const) : ('user' as const),
                updatedMs: ms(v.updatedAt),
                supportStatus:
                  v.supportStatus === 'в работе' || v.supportStatus === 'закрыто'
                    ? (v.supportStatus as SupportStatus)
                    : 'новое',
              },
            ];
          }),
        );
      },
      (e) => console.warn('Обращения в поддержку недоступны:', e),
    );
  }, [active]);

  const watchSupportChat = useCallback((uid: string, cb: (messages: SupportMessage[]) => void) => {
    return onSnapshot(
      query(collection(db, 'users', uid, 'threads', 'support', 'messages'), orderBy('createdAt')),
      (snap) => {
        cb(
          snap.docs.map((m) => {
            const v = m.data();
            return {
              id: m.id,
              from: v.from === 'user' ? ('user' as const) : ('master' as const),
              text: String(v.text ?? ''),
              time: String(v.time ?? ''),
            };
          }),
        );
      },
      (e) => console.warn('Переписка поддержки недоступна:', e),
    );
  }, []);

  const sendSupportReply = useCallback(
    async (uid: string, text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      try {
        // Сообщение и превью в треде — одним пакетом: порознь список
        // обращений мог бы показывать не то, что лежит в переписке
        const pad = (n: number) => String(n).padStart(2, '0');
        const d = new Date();
        const batch = writeBatch(db);
        batch.set(doc(collection(db, 'users', uid, 'threads', 'support', 'messages')), {
          from: 'master',
          text: trimmed,
          time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
          createdAt: serverTimestamp(),
        });
        batch.update(doc(db, 'users', uid, 'threads', 'support'), {
          unread: true,
          lastText: trimmed,
          lastFrom: 'master',
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        return true;
      } catch (e) {
        console.warn('Ответ не отправлен:', e);
        showNotice(firestoreErrorText(e, 'Ответ не отправлен. Проверьте связь'));
        return false;
      }
    },
    [showNotice],
  );

  // Статус — прямой записью: правила пускают его через allowlist треда,
  // и без развёрнутых функций поддержка остаётся полностью рабочей
  const setSupportStatus = useCallback(
    async (uid: string, status: SupportStatus) => {
      try {
        await updateDoc(doc(db, 'users', uid, 'threads', 'support'), {
          supportStatus: status,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('Статус обращения не сохранён:', e);
        showNotice(firestoreErrorText(e, 'Не удалось сменить статус'));
      }
    },
    [showNotice],
  );

  // ---------- жалобы ----------

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  useEffect(() => {
    if (!active) return;
    return onSnapshot(
      query(
        collection(db, 'complaints'),
        where('status', '==', 'новая'),
        orderBy('createdAt', 'desc'),
        limit(SUPPORT_LIMIT),
      ),
      (snap) => setComplaints(snap.docs.map(toComplaint)),
      (e) => console.warn('Жалобы недоступны:', e),
    );
  }, [active]);

  const loadComplaintsArchive = useCallback(async (): Promise<Complaint[]> => {
    try {
      const snap = await getDocs(
        query(
          collection(db, 'complaints'),
          where('status', 'in', ['решена', 'отклонена']),
          orderBy('createdAt', 'desc'),
          limit(SUPPORT_LIMIT),
        ),
      );
      return snap.docs.map(toComplaint);
    } catch (e) {
      console.warn('Архив жалоб недоступен:', e);
      showNotice(firestoreErrorText(e, 'Не удалось загрузить архив жалоб'));
      return [];
    }
  }, [showNotice]);

  // ---------- журнал ----------

  const loadAudit = useCallback(
    async (filter: AuditFilter, cursor?: unknown): Promise<AuditPage> => {
      try {
        const parts = filter.subject
          ? [
              where('subjectType', '==', filter.subject.type),
              where('subjectId', '==', filter.subject.id),
            ]
          : filter.action
            ? [where('action', '==', filter.action)]
            : [];
        const base = query(collection(db, 'audit'), ...parts, orderBy('at', 'desc'), limit(PAGE));
        const snap = await getDocs(
          cursor ? query(base, startAfter(cursor as QueryDocumentSnapshot)) : base,
        );
        return {
          entries: snap.docs.map((d) => {
            const v = d.data();
            return {
              id: d.id,
              action: String(v.action ?? ''),
              actorType: String(v.actorType ?? ''),
              actorUid: typeof v.actorUid === 'string' ? v.actorUid : null,
              subjectType: String(v.subjectType ?? ''),
              subjectId: String(v.subjectId ?? ''),
              atMs: ms(v.at),
              details: (v.details ?? {}) as Record<string, unknown>,
            };
          }),
          cursor: snap.size === PAGE ? snap.docs[snap.size - 1] : null,
        };
      } catch (e) {
        console.warn('Журнал недоступен:', e);
        showNotice(firestoreErrorText(e, 'Не удалось загрузить журнал'));
        return { entries: [], cursor: null };
      }
    },
    [showNotice],
  );

  const value: AdminStateValue = {
    pending,
    decide,
    stats,
    refreshing,
    refreshStats,
    dashboard,
    orders,
    ordersFilter,
    ordersExhausted,
    ordersLoading,
    setOrdersFilter,
    loadMoreOrders,
    openOrderById,
    watchOrder,
    closeOrder,
    findByPhone,
    watchUserCard,
    setUserBlocked,
    setMasterBlocked,
    supportThreads,
    watchSupportChat,
    sendSupportReply,
    setSupportStatus,
    complaints,
    loadComplaintsArchive,
    resolveComplaint,
    setReviewHidden,
    loadAudit,
  };

  return <AdminStateContext.Provider value={value}>{children}</AdminStateContext.Provider>;
}
