import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { useTheme } from '../theme';
import type { MasterOrderStat } from '../components/masterStats';
import type { OrderStats } from '../components/orderStats';
import {
  ACTIVE_STATUSES,
  HistoryTab,
  JobDetail,
  JobList,
  MasterTabs,
  ProfileTab,
  StatsTab,
  type Job,
  type MasterProfile,
  type MasterReview,
  type MasterTab,
} from './MasterScreen';

// Витрина раздела мастера: те же вкладки, что у настоящего MasterScreen, но
// на подставных данных, без входа и без Firestore. Нужна для промо-материалов
// и App Review — настоящий раздел открывается только проверенному мастеру.
// Живёт только в dev-сборке (см. app/demo-master.tsx): вымышленные клиенты и
// отзывы в проде выглядели бы настоящими. Совпадения имён случайны.

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => Date.now() - n * DAY;

// Дата на n месяцев назад: месяцы двигаем календарно, а не по 30 дней,
// чтобы заказ не уполз в соседний столбик графика
function monthsAgo(monthsBack: number, day: number): number {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsBack);
  d.setDate(Math.min(day, 28));
  return d.getTime();
}

const DEMO_PROFILE: MasterProfile = {
  name: 'Магомед',
  lastName: 'Эльмурзаев',
  cities: ['грозный'],
  skills: ['электрика', 'сантехника'],
  experienceYears: 9,
  education: 'среднее специальное',
  verified: true,
  blocked: false,
  rating: 4.8,
  reviewsCount: 41,
  // 43 — чтобы витрина показывала и прогресс «до 50 заказов осталось 7»
  completedOrders: 43,
};

const baseJob = {
  createdMs: null as number | null,
  completedMs: null as number | null,
  clientPhone: null as string | null,
  legacy: false,
  unread: false,
  messages: [] as Job['messages'],
};

const DEMO_JOBS: Job[] = [
  {
    ...baseJob,
    id: 'demo-j1',
    title: 'Свет · Установка · Люстра',
    client: 'Дмитрий',
    address: 'ул. Мира, 24',
    date: '22.08.2026',
    desc: 'Нужно повесить люстру в гостиной, потолок бетонный. Люстра уже куплена.',
    status: 'new',
    createdMs: daysAgo(1),
  },
  {
    ...baseJob,
    id: 'demo-j2',
    title: 'Розетка · Не работает · Искрит',
    client: 'Амина',
    address: 'пр. Путина, 12',
    date: '21.08.2026',
    desc: 'Розетка на кухне искрит, когда включаем чайник.',
    status: 'offered',
    myOffer: 1800,
    createdMs: daysAgo(2),
  },
  {
    ...baseJob,
    id: 'demo-j3',
    title: 'Мойка · Протекает · Сифон',
    client: 'Хава',
    address: 'ул. Кадырова, 7',
    date: '20.08.2026',
    desc: 'Под мойкой собирается вода, кажется, течёт сифон.',
    status: 'accepted',
    price: 2500,
    // В витрине виден и звонок: номер ненастоящий
    clientPhone: '+79280000000',
    createdMs: daysAgo(3),
    messages: [
      { id: 'demo-m1', from: 'client', text: 'Когда сможете приехать?', time: '14:02' },
      { id: 'demo-m2', from: 'me', text: 'Завтра к 10 утра, всё сделаю.', time: '14:05' },
      { id: 'demo-m3', from: 'client', text: 'Хорошо, ждём!', time: '14:06' },
    ],
  },
  {
    ...baseJob,
    id: 'demo-j4',
    title: 'Плита · Не работает · Духовка',
    client: 'Рустам',
    address: 'ул. Садовая, 3',
    date: '18.08.2026',
    desc: 'Духовка не греет, конфорки работают.',
    status: 'awaiting',
    price: 3200,
    createdMs: daysAgo(5),
  },
  {
    ...baseJob,
    id: 'demo-h1',
    title: 'Свет · Замена · Люстра',
    client: 'Дмитрий',
    address: 'ул. Мира, 24',
    date: '15.08.2026',
    desc: 'Заменить старую люстру на новую.',
    status: 'done',
    price: 2800,
    createdMs: daysAgo(8),
    completedMs: daysAgo(4),
  },
  {
    ...baseJob,
    id: 'demo-h2',
    title: 'Свет · Замена · Выключатель',
    client: 'Амина',
    address: 'пр. Путина, 12',
    date: '25.07.2026',
    desc: 'Поставить двухклавишный выключатель.',
    status: 'done',
    price: 1200,
    createdMs: daysAgo(32),
    completedMs: daysAgo(29),
  },
  {
    ...baseJob,
    id: 'demo-h3',
    title: 'Свет · Не работает · Проводка',
    client: 'Ибрагим',
    address: 'ул. Речная, 18',
    date: '20.06.2026',
    desc: 'В спальне пропадает свет, найти причину.',
    status: 'done',
    price: 4500,
    createdMs: daysAgo(65),
    completedMs: daysAgo(61),
  },
  {
    ...baseJob,
    id: 'demo-h4',
    title: 'Мойка · Установка · Смеситель',
    client: 'Хеда',
    address: 'ул. Заветы Ильича, 9',
    date: '01.08.2026',
    desc: 'Установить новый смеситель.',
    status: 'cancelled',
    createdMs: daysAgo(22),
  },
  {
    ...baseJob,
    id: 'demo-h5',
    title: 'Плита · Подключение · Электроплита',
    client: '',
    address: '',
    date: '',
    desc: '',
    status: 'closed',
    myOffer: 2000,
  },
];

// Заказы для доходов: 43 завершённых, разложенных по последним месяцам, —
// чтобы график дышал, а счётчики сходились с профилем. Плюс сданная работа
// и пара отмен.
const MONTH_COUNTS = [4, 7, 6, 9, 5, 6, 4, 2]; // от текущего месяца в прошлое
const PRICES = [1800, 2500, 3200, 1500, 4200, 2800, 3600, 2200, 5000, 1900];

const DEMO_ORDER_STATS: MasterOrderStat[] = MONTH_COUNTS.flatMap((count, monthsBack) =>
  Array.from({ length: count }, (_, i): MasterOrderStat => {
    const completedMs = monthsAgo(monthsBack, 3 + i * 3);
    return {
      status: 'Завершена',
      price: PRICES[(monthsBack * 7 + i) % PRICES.length],
      createdMs: completedMs - 3 * DAY,
      completedMs,
    };
  }),
).concat([
  { status: 'Ждёт подтверждения', price: 3200, createdMs: daysAgo(5), completedMs: null },
  { status: 'Отменена', price: null, createdMs: daysAgo(22), completedMs: null },
  { status: 'Отменена', price: null, createdMs: daysAgo(40), completedMs: null },
]);

// Обезличенная сводка цен — как её присылает сервер
const DEMO_MARKET: OrderStats = {
  completed: 66,
  sum: 215000,
  buckets: {
    1500: 3,
    2000: 8,
    2500: 12,
    3000: 15,
    3500: 11,
    4000: 7,
    4500: 4,
    5000: 3,
    6000: 2,
    8000: 1,
  },
};

const DEMO_REVIEWS: MasterReview[] = [
  {
    id: 'demo-r1',
    clientId: 'demo-c1',
    clientName: 'Дмитрий',
    stars: 5,
    text: 'Повесил люстру за час, убрал за собой. Рекомендую!',
    createdMs: daysAgo(4),
  },
  {
    id: 'demo-r2',
    clientId: 'demo-c2',
    clientName: 'Амина',
    stars: 5,
    text: 'Быстро нашёл причину, розетка больше не искрит.',
    createdMs: daysAgo(29),
  },
  {
    id: 'demo-r3',
    clientId: 'demo-c3',
    clientName: 'Ибрагим',
    stars: 4,
    text: 'Сделал хорошо, но приехал на полчаса позже.',
    createdMs: daysAgo(61),
  },
  {
    id: 'demo-r4',
    clientId: 'demo-c4',
    clientName: 'Хава',
    stars: 5,
    text: 'Аккуратный и вежливый мастер, всё объяснил.',
    createdMs: daysAgo(90),
  },
];

const noop = () => {};

function clock() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MasterDemoScreen() {
  const { colors } = useTheme();
  const [tab, setTab] = useState<MasterTab>('jobs');
  const [jobs, setJobs] = useState<Job[]>(DEMO_JOBS);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const openJob = jobs.find((j) => j.id === openJobId) ?? null;

  const patchJob = (jobId: string, patch: (j: Job) => Job) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? patch(j) : j)));
  };

  const pushMessage = (jobId: string, text: string) => {
    patchJob(jobId, (j) => ({
      ...j,
      messages: [...j.messages, { id: `demo-m${Date.now()}`, from: 'me', text, time: clock() }],
    }));
  };

  // Действия меняют только локальное состояние — сервера у витрины нет,
  // но пластика экранов ровно та же, что в бою
  const sendOffer = (jobId: string, price: number) => {
    patchJob(jobId, (j) => ({
      ...j,
      myOffer: price,
      status: j.status === 'new' ? 'offered' : j.status,
    }));
  };

  const withdrawOffer = (jobId: string) => {
    patchJob(jobId, (j) => ({ ...j, myOffer: undefined, status: 'new' }));
  };

  const finishJob = (jobId: string) => {
    patchJob(jobId, (j) => ({ ...j, status: 'awaiting' }));
    pushMessage(jobId, 'Работа выполнена. Спасибо, что выбрали меня!');
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      {tab === 'jobs' && (
        <JobList
          email="demo@domio.app"
          profile={DEMO_PROFILE}
          blockedReason={null}
          jobs={jobs.filter((j) => ACTIVE_STATUSES.includes(j.status))}
          typingJobId={null}
          onOpenJob={setOpenJobId}
          onClose={noop}
          onEditProfile={noop}
        />
      )}
      {tab === 'stats' && (
        <StatsTab
          profile={DEMO_PROFILE}
          orders={DEMO_ORDER_STATS}
          offersSent={90}
          ordersWon={46}
          market={DEMO_MARKET}
          onClose={noop}
        />
      )}
      {tab === 'history' && (
        <HistoryTab
          jobs={jobs.filter((j) => !ACTIVE_STATUSES.includes(j.status))}
          onOpenJob={setOpenJobId}
          onClose={noop}
        />
      )}
      {tab === 'profile' && (
        <ProfileTab
          email="demo@domio.app"
          profile={DEMO_PROFILE}
          reviews={DEMO_REVIEWS}
          onEdit={noop}
          onComplain={async () => true}
          onLogout={noop}
          onClose={noop}
        />
      )}

      <MasterTabs
        active={tab}
        onSelect={setTab}
        hidden={!!openJob}
        hasNew={jobs.some((j) => j.status === 'new' || j.status === 'declined')}
      />

      {openJob && (
        <Animated.View
          entering={SlideInRight.springify().damping(20).stiffness(160)}
          exiting={SlideOutRight.duration(280)}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}
        >
          <JobDetail
            job={openJob}
            typing={false}
            onBack={() => setOpenJobId(null)}
            onSendOffer={(price) => sendOffer(openJob.id, price)}
            onWithdrawOffer={() => withdrawOffer(openJob.id)}
            onOfferLegacy={(price) => sendOffer(openJob.id, price)}
            onFinish={() => finishJob(openJob.id)}
            onSend={(text) => pushMessage(openJob.id, text)}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
