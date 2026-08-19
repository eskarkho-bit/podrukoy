import { useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeOut,
  LinearTransition,
  SlideInRight,
  SlideOutRight,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { springs, STAGGER } from '../motion';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from '../components/PressableScale';
import { useAuth } from '../components/AuthState';
import { useAppState } from '../components/AppState';
import { counted, ratingText, rub } from '../components/format';
import { CATEGORIES, type Category } from '../components/serviceOptions';
import { deleteVerificationPhoto, uploadVerificationPhoto } from '../components/photoUpload';
import { firestoreErrorText } from '../components/firestoreError';
import { LEGAL_DOCS, type LegalDocId } from '../components/legal';
import { CityPicker } from '../components/CityPicker';
import { settlementLabel } from '../components/cities';
import { LegalScreen } from './LegalScreen';
import {
  applicationFrom,
  EMPTY_APPLICATION,
  phoneValid,
  startCardBinding,
  type Application,
} from '../components/verification';
import { db } from '../firebaseConfig';

// Сколько заявок тянем в ленту за раз. Без ограничения запрос выгребал бы
// всю коллекцию на телефон — на сотне заявок это ещё терпимо, на десяти
// тысячах уже нет.
const FEED_LIMIT = 50;

// Больше десяти подписок на ленту — это уже не выбор мест работы, а желание
// видеть всё; для такого есть пустой список, который означает всю республику
const MAX_FEED_CITIES = 10;

// Режим мастера — отдельный «мир» поверх клиентского приложения.
// Аккаунт один на человека: роль мастера — это анкета masters/{uid}.
//
// Одной анкеты мало: доступ к заявкам даёт флаг verified, который ставит
// модератор, посмотрев фотографию, телефон и привязанную карту. До этого
// раздел работает, но лента пуста — иначе адреса и фотографии квартир
// клиентов доставались бы любому, кто нажал «стать мастером».

// Что мастеру делать с заявкой:
//   new       — открыта, цену я ещё не называл
//   offered   — моё предложение отправлено, клиент выбирает между несколькими
//   accepted  — клиент выбрал меня, можно работать
//   closed    — заявка ушла: выбрали другого или клиент её закрыл
//   done      — работа сдана
//   cancelled — клиент отменил заявку, которая уже была моей
//   declined  — старая схема: клиент отклонил цену, можно назвать другую
type JobStatus = 'new' | 'offered' | 'accepted' | 'declined' | 'done' | 'cancelled' | 'closed';

type JobMessage = { id: string; from: 'me' | 'client'; text: string; time: string };

type Job = {
  id: string;
  title: string;
  client: string;
  address: string;
  date: string;
  desc: string;
  status: JobStatus;
  // Согласованная цена, а у старых заявок — предложенная
  price?: number;
  // Сколько предложил я. Живёт в orders/{id}/offers/{myUid}.
  myOffer?: number;
  // Заявка со старой схемой согласования — цена лежит в ней самой
  legacy: boolean;
  unread: boolean;
  messages: JobMessage[];
};

const STATUS_LABEL: Record<JobStatus, string> = {
  new: 'Новая',
  offered: 'Клиент выбирает',
  accepted: 'Вас выбрали',
  declined: 'Цена отклонена',
  done: 'Завершена',
  cancelled: 'Отменена',
  closed: 'Заявка закрыта',
};

const statusColorFor = (status: JobStatus, t: Palette): string =>
  ({
    new: t.warn,
    offered: t.blue,
    accepted: t.accent,
    declined: t.danger,
    done: t.textMuted,
    cancelled: t.textMuted,
    closed: t.textMuted,
  })[status];

// Сверху то, где от мастера ждут действия
const STATUS_RANK: Record<JobStatus, number> = {
  new: 0,
  declined: 1,
  accepted: 2,
  offered: 3,
  done: 4,
  cancelled: 5,
  closed: 6,
};

function now() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

type MasterProfile = {
  name: string;
  // Куда мастер готов выезжать. Пустой массив — вся республика.
  // У анкет, заведённых до множественного выбора, читается прежнее поле city.
  cities: string[];
  skills: Category[];
  // Ставит только модератор. Без него заявок не видно — это и есть проверка.
  verified: boolean;
  // Считает Cloud Function по отзывам — сам мастер эти поля переписать не может
  rating: number | null;
  reviewsCount: number;
};

// Моё предложение по чужой пока заявке. Название заявки лежит копией в самом
// предложении: когда клиент выберет другого, сама заявка станет недоступной,
// а показать в списке что-то надо.
type MyOffer = { orderId: string; title: string; price: number };

export function MasterScreen({ open, onClose }: Props) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const { user } = useAuth();
  const { showNotice } = useAppState();
  const myUid = user?.uid ?? null;
  // Анкета мастера: есть — раздел открыт, нет — предлагаем её заполнить
  const [master, setMaster] = useState<MasterProfile | null>(null);
  const [application, setApplication] = useState<Application>(EMPTY_APPLICATION);
  // Правка анкеты: город и специальности задают, какие заявки вообще видны,
  // поэтому менять их нужно уметь не только при первом входе
  const [editingProfile, setEditingProfile] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  // В какой заявке клиент сейчас «печатает».
  //
  // ДОЛГ: разводка по интерфейсу есть, а источника нет — setTypingJobId не
  // вызывается нигде, поэтому индикатор у мастера не показывается никогда.
  // Признак «печатает» требует записи в Firestore на каждое нажатие клавиши,
  // и это отдельное решение по стоимости, а не забытая строчка.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [typingJobId, setTypingJobId] = useState<string | null>(null);

  const openJob = jobs.find((j) => j.id === openJobId) ?? null;

  // Весь оверлей мягко выезжает справа, как вложенный экран. Значения ведём из
  // эффекта, а не изнутри стиля: экран перерисовывается на каждое обновление
  // ленты и переписки, и анимация в стиле начиналась бы заново.
  const shown = useSharedValue(open ? 1 : 0);
  const slide = useSharedValue(open ? 0 : 60);
  useEffect(() => {
    shown.value = withTiming(open ? 1 : 0, { duration: 260 });
    slide.value = withSpring(open ? 0 : 60, springs.nav);
  }, [open, shown, slide]);
  const layerStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateX: slide.value }],
  }));

  // Анкету проверяем при каждом открытии раздела: она могла появиться
  // на другом устройстве под тем же аккаунтом
  useEffect(() => {
    if (!open || !myUid) return;
    // Подписка, а не разовое чтение: рейтинг пересчитывает Cloud Function
    // после чужого отзыва, и мастер должен увидеть это без перезахода
    return onSnapshot(
      doc(db, 'masters', myUid),
      (snap) => {
        const v = snap.data();
        setMaster(
          snap.exists() && v
            ? {
                name: String(v.name ?? ''),
                cities: Array.isArray(v.cities)
                  ? (v.cities as string[])
                  : // Анкеты до множественного выбора: один город строкой
                    v.city
                    ? [String(v.city)]
                    : [],
                skills: Array.isArray(v.skills) ? (v.skills as Category[]) : [],
                verified: v.verified === true,
                rating: typeof v.rating === 'number' ? v.rating : null,
                reviewsCount: typeof v.reviewsCount === 'number' ? v.reviewsCount : 0,
              }
            : null,
        );
      },
      (e) => console.warn('Анкета мастера недоступна:', e),
    );
  }, [open, myUid]);

  // Заявка на проверку. Лежит отдельно от анкеты: телефон, селфи и данные
  // карты не должны читаться всеми, кому видна анкета.
  useEffect(() => {
    if (!open || !myUid) return;
    return onSnapshot(
      doc(db, 'masters', myUid, 'verification', 'application'),
      (snap) => setApplication(applicationFrom(snap.data())),
      (e) => console.warn('Заявка на проверку недоступна:', e),
    );
  }, [open, myUid]);

  // Заявки собираются из трёх источников, потому что Firestore не умеет «ИЛИ»
  // по разным полям: открытая лента (отфильтрованная по городу и
  // специальностям), свои выигранные заявки и свои отправленные предложения.
  // open — карта «город → заявки»: подписок столько же, сколько выбранных
  // населённых пунктов, и результат каждой лежит отдельно, чтобы обновление
  // одной не затирало остальные
  const buckets = useRef<{ open: Map<string, Job[]>; mine: Job[]; offers: MyOffer[] }>({
    open: new Map(),
    mine: [],
    offers: [],
  });

  const citiesKey = (master?.cities ?? []).join(',');
  const skillsKey = (master?.skills ?? []).join(',');

  useEffect(() => {
    // Непроверенному мастеру запросы делать незачем: правила их отклонят,
    // а консоль засыплет permission-denied
    if (!master?.verified || !myUid) {
      setJobs([]);
      buckets.current = { open: new Map(), mine: [], offers: [] };
      return;
    }

    const toJob = (d: QueryDocumentSnapshot): Job => {
      const v = d.data();
      const legacy = v.priceStatus === 'offered' || v.priceStatus === 'declined';
      // «В работе» видно только выбранному мастеру — остальным заявка уже
      // недоступна, поэтому отдельной проверки masterId здесь не нужно
      const status: JobStatus =
        v.status === 'Отменена'
          ? 'cancelled'
          : v.status === 'Завершена' || v.status === 'Ждёт подтверждения'
            ? 'done'
            : v.status === 'В работе'
              ? 'accepted'
              : v.priceStatus === 'offered'
                ? 'offered'
                : v.priceStatus === 'declined'
                  ? 'declined'
                  : 'new';
      return {
        id: d.id,
        title: v.title ?? 'Заявка',
        client: v.clientName ?? 'Клиент',
        address: v.address ?? '',
        date: v.date ?? '',
        desc: v.comment || 'Клиент не оставил комментарий.',
        status,
        price: v.agreedPrice ?? v.price ?? undefined,
        legacy,
        unread: false,
        messages: [],
      };
    };

    // Переписка и отметка «прочитано» живут только на устройстве мастера,
    // поэтому при обновлении списка их нужно сохранить
    const merge = () => {
      const all = new Map<string, Job>();
      // Один и тот же заказ не может прийти из двух городов, но объединение
      // по id всё равно спасёт, если список городов поменяется на лету
      buckets.current.open.forEach((jobs) => jobs.forEach((j) => all.set(j.id, j)));
      // Свои заявки кладём поверх ленты: там точнее статус
      buckets.current.mine.forEach((j) => all.set(j.id, j));

      buckets.current.offers.forEach((offer) => {
        const job = all.get(offer.orderId);
        if (job) {
          all.set(offer.orderId, {
            ...job,
            myOffer: offer.price,
            status: job.status === 'new' ? 'offered' : job.status,
          });
          return;
        }
        // Заявки не видно: её либо отдали другому мастеру, либо закрыли.
        // Что именно — правила знать не дают, поэтому и формулировка общая.
        all.set(offer.orderId, {
          id: offer.orderId,
          title: offer.title,
          client: '',
          address: '',
          date: '',
          desc: '',
          status: 'closed',
          myOffer: offer.price,
          legacy: false,
          unread: false,
          messages: [],
        });
      });

      setJobs((prev) =>
        [...all.values()]
          .map((j) => {
            const old = prev.find((p) => p.id === j.id);
            return old ? { ...j, unread: old.unread, messages: old.messages } : j;
          })
          .sort(
            (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.id.localeCompare(a.id),
          ),
      );
    };

    // Лента: только открытые заявки, только выбранных населённых пунктов и
    // своих специальностей. Пустой список пунктов означает «вся республика» —
    // иначе мастер, не заполнивший анкету, не увидел бы ничего.
    //
    // Подписка на каждый пункт отдельно, а не один запрос со списком: в
    // Firestore допускается лишь одно «ИЛИ»-условие на запрос, и оно уже
    // занято специальностями. Складывать город и специальность в одно
    // денормализованное поле было бы быстрее, но потребовало бы миграции
    // и упёрлось бы в предел на число значений.
    const cities = master.cities.length ? master.cities.slice(0, MAX_FEED_CITIES) : [null];
    // Лимит общий на ленту, а не на каждый пункт: иначе десять городов дали
    // бы пятьсот заявок на телефоне
    const perCity = Math.max(10, Math.floor(FEED_LIMIT / cities.length));

    const unsubsOpen = cities.map((city) => {
      const filters = [where('status', '==', 'Поиск мастера')];
      if (city) filters.push(where('city', '==', city));
      // «in» принимает не больше десяти значений, а специальностей восемь
      if (master.skills.length) {
        filters.push(where('category', 'in', master.skills.slice(0, 10)));
      }

      return onSnapshot(
        query(collection(db, 'orders'), ...filters, orderBy('createdAt', 'desc'), limit(perCity)),
        (snap) => {
          // Заявку, которую кто-то уже взял по старой схеме, в ленте не
          // показываем: предложить по ней цену правила не дадут
          buckets.current.open.set(
            city ?? '*',
            snap.docs
              .filter((d) => {
                const owner = d.data().masterId ?? null;
                return owner === null || owner === myUid;
              })
              .map(toJob),
          );
          merge();
        },
        (e) => console.warn('Лента заявок недоступна:', e),
      );
    });

    const unsubMine = onSnapshot(
      query(collection(db, 'orders'), where('masterId', '==', myUid)),
      (snap) => {
        buckets.current.mine = snap.docs.map(toJob);
        merge();
      },
      (e) => console.warn('Свои заявки недоступны:', e),
    );

    // Свои предложения по всем заявкам сразу: заявка, где я только назвал
    // цену, мне ещё не принадлежит, и запросом по masterId её не найти
    const unsubOffers = onSnapshot(
      query(collectionGroup(db, 'offers'), where('masterId', '==', myUid)),
      (snap) => {
        buckets.current.offers = snap.docs.map((d) => {
          const v = d.data();
          return {
            orderId: d.ref.parent.parent?.id ?? d.id,
            title: v.orderTitle ?? 'Заявка',
            price: v.price ?? 0,
          };
        });
        merge();
      },
      (e) => console.warn('Свои предложения недоступны:', e),
    );

    return () => {
      unsubsOpen.forEach((u) => u());
      unsubMine();
      unsubOffers();
    };
  }, [master, myUid, citiesKey, skillsKey]);

  // «Выйти» в режиме мастера теперь означает выход из раздела: сам аккаунт
  // остаётся тем же, анкета никуда не девается
  const handleLogout = () => {
    setOpenJobId(null);
    onClose();
  };

  const patchJob = (jobId: string, patch: (j: Job) => Job) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? patch(j) : j)));
  };

  // Сообщение уходит в общую переписку заявки — ту же, что видит клиент
  const pushMessage = (jobId: string, text: string) => {
    if (!myUid) return;
    addDoc(collection(db, 'orders', jobId, 'messages'), {
      senderId: myUid,
      text,
      time: now(),
      createdAt: serverTimestamp(),
    }).catch((e) => {
      console.warn('Сообщение не отправлено:', e);
      showNotice(firestoreErrorText(e, 'Сообщение не отправлено. Проверьте связь'));
    });
  };

  // Переписка открытой заявки. Подписываемся только на неё: держать живыми
  // подписки на все заявки сразу незачем.
  useEffect(() => {
    if (!openJobId || !myUid) return;
    return onSnapshot(
      query(collection(db, 'orders', openJobId, 'messages'), orderBy('createdAt', 'asc')),
      (snap) => {
        const messages: JobMessage[] = snap.docs.map((m) => {
          const v = m.data();
          return {
            id: m.id,
            from: v.senderId === myUid ? 'me' : 'client',
            text: v.text,
            time: v.time,
          };
        });
        patchJob(openJobId, (j) => ({ ...j, messages }));
      },
      (e) => console.warn('Переписка недоступна:', e),
    );
  }, [openJobId, myUid]);

  // Предложение — отдельный документ orders/{id}/offers/{myUid}. Из этого
  // следует всё остальное: перебить чужую цену невозможно (каждый пишет свой
  // документ), заявка остаётся открытой для других, а выбор делает клиент.
  // Переписки до выбора нет — правила пускают в чат только участников
  // заявки, поэтому всё, что мастер хочет сказать, идёт в комментарий.
  const sendOffer = async (jobId: string, price: number, comment: string) => {
    if (!myUid || !master) return;
    const job = jobs.find((j) => j.id === jobId);
    try {
      await setDoc(doc(db, 'orders', jobId, 'offers', myUid), {
        masterId: myUid,
        masterName: master.name || 'Мастер',
        price,
        comment: comment.trim().slice(0, 300),
        status: 'pending',
        // Копия названия: когда клиент выберет другого, сама заявка станет
        // недоступной, а строку в списке показать всё равно надо
        orderTitle: job?.title ?? 'Заявка',
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('Не удалось отправить предложение:', e);
      showNotice(firestoreErrorText(e, 'Не удалось отправить предложение. Проверьте связь'));
    }
  };

  const withdrawOffer = async (jobId: string) => {
    if (!myUid) return;
    try {
      await deleteDoc(doc(db, 'orders', jobId, 'offers', myUid));
    } catch (e) {
      console.warn('Не удалось отозвать предложение:', e);
      showNotice(firestoreErrorText(e, 'Не удалось отозвать предложение. Проверьте связь'));
    }
  };

  // Пересмотр цены у заявки, созданной до появления offers: там предложение
  // лежит в самой заявке. Новые заявки этим путём не ходят.
  const offerPriceLegacy = async (jobId: string, price: number) => {
    if (!myUid) return;
    const previous = jobs.find((j) => j.id === jobId)?.price;
    try {
      await updateDoc(doc(db, 'orders', jobId), {
        masterName: master?.name ?? 'Мастер',
        price,
        priceStatus: 'offered',
        priceHistory: arrayUnion({
          amount: price,
          by: 'master',
          action: previous == null ? 'offered' : 'changed',
          at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      console.warn('Не удалось предложить цену:', e);
      showNotice(firestoreErrorText(e, 'Не удалось отправить цену. Проверьте связь'));
      return;
    }

    pushMessage(
      jobId,
      previous == null
        ? `Готов взяться. Моя цена — ${rub(price)}.`
        : `Пересмотрел цену: теперь ${rub(price)}.`,
    );
  };

  // Мастер отмечает работу выполненной — подтверждать её будет клиент
  const finishJob = (jobId: string) => {
    updateDoc(doc(db, 'orders', jobId), { status: 'Ждёт подтверждения' }).catch((e) => {
      console.warn('Не удалось завершить заявку:', e);
      showNotice(firestoreErrorText(e, 'Не удалось отметить работу выполненной. Проверьте связь'));
    });

    pushMessage(jobId, 'Работа выполнена. Спасибо, что выбрали меня!');
  };

  // Ответ клиента здесь больше не подделывается: на том конце живой человек
  const sendMessage = (jobId: string, text: string) => {
    pushMessage(jobId, text);
  };

  const handleOpenJob = (jobId: string) => {
    setOpenJobId(jobId);
    patchJob(jobId, (j) => ({ ...j, unread: false }));
  };

  const handleBackFromJob = () => {
    // Ответ мог прийти, пока заявка была открыта — помечаем прочитанным на выходе
    if (openJobId) patchJob(openJobId, (j) => ({ ...j, unread: false }));
    setOpenJobId(null);
  };

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, layerStyle]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      {/* Пока модератор не подтвердил анкету, ленты нет: в заявках лежат
          адреса и фотографии жилья клиентов */}
      {!master?.verified || editingProfile ? (
        <MasterApplicationScreen
          uid={myUid}
          profile={master}
          application={application}
          defaultName={user?.displayName ?? ''}
          onClose={() => (editingProfile ? setEditingProfile(false) : onClose())}
          onDone={() => setEditingProfile(false)}
        />
      ) : (
        <View style={styles.fill}>
          <JobList
            email={user?.email ?? ''}
            profile={master}
            jobs={jobs}
            typingJobId={typingJobId}
            onOpenJob={handleOpenJob}
            onClose={onClose}
            onLogout={handleLogout}
            onEditProfile={() => setEditingProfile(true)}
          />

          {openJob && (
            <Animated.View
              entering={SlideInRight.springify().damping(20).stiffness(160)}
              exiting={SlideOutRight.duration(280)}
              style={StyleSheet.absoluteFill}
            >
              <JobDetail
                job={openJob}
                typing={typingJobId === openJob.id}
                onBack={handleBackFromJob}
                onSendOffer={(price, comment) => sendOffer(openJob.id, price, comment)}
                onWithdrawOffer={() => withdrawOffer(openJob.id)}
                onOfferLegacy={(price) => offerPriceLegacy(openJob.id, price)}
                onFinish={() => finishJob(openJob.id)}
                onSend={(text) => sendMessage(openJob.id, text)}
              />
            </Animated.View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

// ---------- Анкета и проверка мастера ----------

// Один экран на три состояния: заполнение заявки, ожидание модерации и
// правка анкеты уже проверенным мастером. Разводить их по компонентам
// незачем — поля те же, отличается набор и подпись кнопки.
function MasterApplicationScreen({
  uid: myUid,
  profile,
  application,
  defaultName,
  onClose,
  onDone,
}: {
  uid: string | null;
  profile: MasterProfile | null;
  application: Application;
  defaultName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { mode: themeMode, colors: t } = useTheme();
  const styles = themed[themeMode];

  const verified = !!profile?.verified;
  const pending = application.status === 'pending';
  const rejected = application.status === 'rejected';

  const [name, setName] = useState(profile?.name || defaultName);
  const [cities, setCities] = useState<string[]>(profile?.cities ?? []);
  const [skills, setSkills] = useState<Category[]>(profile?.skills ?? []);
  const [phone, setPhone] = useState(application.phone);
  const [about, setAbout] = useState(application.about);
  const [photoUri, setPhotoUri] = useState<string | null>(application.photoUrl);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [binding, setBinding] = useState(false);

  const cardBound = !!application.cardBindingId;
  // Платёж создан, банк ещё не ответил. Исход подтвердит сервер — вебхуком
  // либо сверкой; до этого повторная попытка только создаст второй платёж.
  const cardAwaiting = !cardBound && application.bindingState === 'pending';
  const cardFailed =
    !cardBound &&
    (application.bindingState === 'failed' || application.bindingState === 'canceled');
  // Согласие на фотографию — отдельное и обязательно до съёмки: снимать
  // лицо, а потом спрашивать разрешение, поздно
  const [faceConsent, setFaceConsent] = useState(!!application.biometricConsent);
  const [openDoc, setOpenDoc] = useState<LegalDocId | null>(null);
  const [pickingCity, setPickingCity] = useState(false);

  const toggleSkill = (c: Category) => {
    setSkills((prev) => (prev.includes(c) ? prev.filter((s) => s !== c) : [...prev, c]));
  };

  // Снимок лица. Просим камеру, а не галерею: смысл в том, чтобы человек
  // сфотографировался сейчас, а не приложил чужое фото. Полной гарантии это
  // не даёт — проверяет всё равно человек.
  const takePhoto = async () => {
    if (!faceConsent) {
      setError('Сначала дайте согласие на обработку фотографии лица');
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.6,
        cameraType: ImagePicker.CameraType.front,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
    } catch (e) {
      console.warn('Камера недоступна:', e);
      setError('Не удалось открыть камеру. Проверьте разрешения в настройках телефона');
    }
  };

  // Отзыв согласия. Обязан приводить к настоящему удалению снимка, иначе это
  // не отзыв. Вместе с ним снимается и допуск: личность больше не
  // подтверждена, а заявки клиентов проверенным мастерам показываем не зря.
  const revokeFace = async () => {
    if (!myUid) return;
    setError(null);
    setLoading(true);
    try {
      await deleteVerificationPhoto(myUid);
      await updateDoc(doc(db, 'masters', myUid, 'verification', 'application'), {
        photoUrl: null,
        biometricConsent: null,
        status: 'draft',
      });
      if (verified) {
        await updateDoc(doc(db, 'masters', myUid), { verified: false });
      }
      setPhotoUri(null);
      setFaceConsent(false);
    } catch (e) {
      console.warn('Не удалось отозвать согласие:', e);
      setError(firestoreErrorText(e, 'Не удалось отозвать согласие. Попробуйте ещё раз'));
    }
    setLoading(false);
  };

  const bindCard = async () => {
    setError(null);
    setBinding(true);
    const result = await startCardBinding();
    setBinding(false);
    if (result === 'not-configured') {
      setError('Привязка карты пока недоступна: не настроен платёжный провайдер');
    } else if (result === 'failed') {
      setError('Не удалось начать привязку карты. Попробуйте позже');
    }
    // 'awaiting', 'already-bound' и 'cancelled' ничего не показывают: исход
    // подтверждает сервер, и подписка на заявку принесёт его сама
  };

  const save = async (sendForReview: boolean) => {
    if (name.trim().length < 2) {
      setError('Напишите, как вас зовут');
      return;
    }
    if (!myUid) {
      setError('Сессия не найдена — войдите в приложение заново');
      return;
    }
    if (sendForReview) {
      if (!phoneValid(phone)) {
        setError('Телефон нужен в виде 11 цифр — по нему с вами свяжутся');
        return;
      }
      if (!photoUri) {
        setError('Сделайте фотографию лица — без неё заявку не проверить');
        return;
      }
      // Карту здесь не требуем, хотя она обязательна: решает модератор, и он
      // видит в очереди, привязана она или нет. Жёсткая проверка на этом шаге
      // делала заявку неотправляемой, пока не настроен платёжный провайдер, —
      // то есть отбирала у модератора право решать.
    }

    setError(null);
    setLoading(true);
    try {
      // Документ masters/{uid} — это роль мастера. Флаг verified сюда не
      // пишем: правила его отсюда и не пропустят, ставит его модератор.
      await setDoc(
        doc(db, 'masters', myUid),
        {
          name: name.trim(),
          cities,
          skills,
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );

      if (!verified) {
        // Фото уезжает в Storage под путь, закрытый для всех, кроме
        // владельца и модератора
        let photoUrl = application.photoUrl;
        if (photoUri && photoUri !== application.photoUrl) {
          photoUrl = await uploadVerificationPhoto(myUid, photoUri);
        }

        const ref = doc(db, 'masters', myUid, 'verification', 'application');
        // Сначала черновик: правила не дают создать заявку сразу «на
        // проверке», иначе её можно было бы подать пустой
        await setDoc(
          ref,
          {
            phone: phone.replace(/\D/g, ''),
            about: about.trim(),
            photoUrl: photoUrl ?? null,
            biometricConsent: faceConsent ? LEGAL_DOCS.biometrics.version : null,
            status: 'draft',
          },
          { merge: true },
        );

        if (sendForReview) {
          await updateDoc(ref, { status: 'pending', appliedAt: serverTimestamp() });
        }
      }

      onDone();
    } catch (e) {
      console.warn('Не удалось сохранить анкету мастера:', e);
      setError(firestoreErrorText(e, 'Не удалось сохранить. Попробуйте ещё раз'));
      setLoading(false);
    }
  };

  // Заявка на проверке — правки закрыты, показываем только состояние
  if (pending) {
    return (
      <View style={styles.fill}>
        <View style={styles.topBar}>
          <PressableScale style={styles.backChip} onPress={onClose}>
            <Text style={styles.backText}>‹ Профиль</Text>
          </PressableScale>
          <View style={styles.backChipGhost} />
        </View>

        <ScrollView contentContainerStyle={styles.loginContent}>
          <Animated.View entering={FadeInDown.duration(420)} style={styles.loginBadge}>
            <Text style={styles.loginBadgeIcon}>⏳</Text>
          </Animated.View>
          <Animated.Text entering={FadeInDown.delay(60).duration(380)} style={styles.loginTitle}>
            Заявка на проверке
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(100).duration(380)} style={styles.loginSub}>
            Мы смотрим анкету вручную — обычно это занимает не больше суток. Как только проверим,
            заявки клиентов появятся здесь сами.
          </Animated.Text>

          <Animated.View entering={FadeInDown.delay(140).duration(360)} style={styles.loginCard}>
            <SummaryRow label="Имя" value={name} />
            <SummaryRow
              label="Где работает"
              value={cities.length ? cities.map(settlementLabel).join(', ') : 'вся республика'}
            />
            <SummaryRow label="Телефон" value={phone || '—'} />
            <SummaryRow label="Фото" value={application.photoUrl ? 'загружено' : 'нет'} />
            <SummaryRow
              label="Карта"
              value={application.cardLast4 ? `•••• ${application.cardLast4}` : 'нет'}
            />
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  const primaryLabel = loading
    ? 'Сохраняем…'
    : verified
      ? 'Сохранить'
      : rejected
        ? 'Отправить снова'
        : 'Отправить на проверку';

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topBar}>
        <PressableScale style={styles.backChip} onPress={onClose}>
          <Text style={styles.backText}>‹ Назад</Text>
        </PressableScale>
        <View style={styles.backChipGhost} />
      </View>

      <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.duration(420)} style={styles.loginBadge}>
          <Text style={styles.loginBadgeIcon}>🛠️</Text>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(60).duration(380)} style={styles.loginTitle}>
          {verified ? 'Анкета мастера' : 'Стать мастером'}
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(380)} style={styles.loginSub}>
          {verified
            ? 'Город и специальности решают, какие заявки вы видите в ленте.'
            : 'Мы проверяем каждого мастера вручную: к клиентам домой едет живой ' +
              'человек, и они должны знать, кто это. Отдельный аккаунт не нужен.'}
        </Animated.Text>

        {rejected && (
          <Animated.View entering={FadeInDown.delay(120).duration(360)} style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Заявку отклонили</Text>
            <Text style={styles.rejectText}>
              {application.rejectionReason || 'Причина не указана.'}
            </Text>
            <Text style={styles.rejectHint}>Исправьте и отправьте снова.</Text>
          </Animated.View>
        )}

        <Animated.View entering={FadeInDown.delay(140).duration(360)} style={styles.loginCard}>
          <Text style={styles.fieldLabel}>Имя</Text>
          <TextInput
            style={styles.fieldInput}
            value={name}
            onChangeText={setName}
            placeholder="Иван Петров"
            placeholderTextColor={t.textMuted}
            editable={!loading}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Где работаете</Text>
          {/* Выбор из списка, а не ввод: заявка находит мастера сравнением
              строк, и «Грозный» с «грозный» были бы разными местами.
              Пунктов можно отметить несколько — на каждый заводится своя
              подписка на ленту. */}
          <PressableScale
            style={styles.pickerField}
            onPress={() => setPickingCity(true)}
            disabled={loading}
          >
            <Text style={[styles.pickerValue, !cities.length && styles.pickerPlaceholder]}>
              {cities.length ? cities.map(settlementLabel).join(', ') : 'Вся республика'}
            </Text>
            <Text style={styles.pickerChevron}>›</Text>
          </PressableScale>
          {cities.length ? (
            <PressableScale style={styles.clearCity} onPress={() => setCities([])}>
              <Text style={styles.clearCityText}>Показывать заявки со всей республики</Text>
            </PressableScale>
          ) : (
            <Text style={styles.fieldHint}>
              Ничего не отмечено — в ленте будут заявки со всей республики
            </Text>
          )}

          <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Что умеете</Text>
          {/* Список закрытый: по свободному тексту заявку не найти */}
          <View style={styles.chipsWrap}>
            {CATEGORIES.map((c) => {
              const on = skills.includes(c);
              return (
                <PressableScale
                  key={c}
                  style={[styles.skillChip, on && styles.skillChipOn]}
                  onPress={() => toggleSkill(c)}
                >
                  <Text style={[styles.skillChipText, on && styles.skillChipTextOn]}>{c}</Text>
                </PressableScale>
              );
            })}
          </View>
          <Text style={styles.fieldHint}>Ничего не выбрано — в ленте будут заявки всех видов</Text>

          {/* Всё, что ниже, нужно только для проверки: у проверенного мастера
              эти данные уже приняты и больше не спрашиваются */}
          {!verified && (
            <>
              <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Телефон</Text>
              <TextInput
                style={styles.fieldInput}
                value={phone}
                onChangeText={setPhone}
                placeholder="79991234567"
                placeholderTextColor={t.textMuted}
                keyboardType="phone-pad"
                editable={!loading}
                maxLength={16}
              />
              <Text style={styles.fieldHint}>По нему свяжемся, если что-то не сойдётся</Text>

              <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>О себе</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldInputArea]}
                value={about}
                onChangeText={setAbout}
                placeholder="Опыт, инструмент, за какие работы берётесь"
                placeholderTextColor={t.textMuted}
                editable={!loading}
                multiline
                maxLength={600}
              />

              <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Фотография лица</Text>

              {/* Отдельное согласие: фотография лица — не то же самое, что
                  фото поломки, и общего согласия для неё недостаточно */}
              <View style={styles.consentRow}>
                <PressableScale
                  style={[styles.checkbox, faceConsent && styles.checkboxOn]}
                  onPress={() => setFaceConsent((v) => !v)}
                  disabled={loading}
                >
                  {faceConsent && <Text style={styles.checkboxTick}>✓</Text>}
                </PressableScale>
                <Text style={styles.consentText}>
                  Даю{' '}
                  <Text style={styles.consentLink} onPress={() => setOpenDoc('biometrics')}>
                    согласие на обработку фотографии лица
                  </Text>
                </Text>
              </View>

              <View style={styles.faceRow}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.facePhoto} />
                ) : (
                  <View style={[styles.facePhoto, styles.facePhotoEmpty]}>
                    <Text style={styles.facePhotoIcon}>🙂</Text>
                  </View>
                )}
                <View style={styles.faceBody}>
                  <PressableScale
                    style={[styles.faceBtn, !faceConsent && styles.loginBtnDim]}
                    onPress={takePhoto}
                    disabled={loading || !faceConsent}
                  >
                    <Text style={styles.faceBtnText}>
                      {photoUri ? 'Переснять' : 'Сделать фото'}
                    </Text>
                  </PressableScale>
                  <Text style={styles.fieldHint}>
                    Снимок видят только вы и модератор. Клиентам он не показывается.
                  </Text>
                  {/* Право отозвать согласие бесполезно, если отзывать негде */}
                  {application.photoUrl && (
                    <PressableScale
                      style={styles.revokeBtn}
                      onPress={revokeFace}
                      disabled={loading}
                    >
                      <Text style={styles.revokeText}>Отозвать согласие и удалить фото</Text>
                    </PressableScale>
                  )}
                </View>
              </View>

              <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Карта</Text>
              {cardBound ? (
                <View style={styles.cardBound}>
                  <Text style={styles.cardBoundText}>
                    {application.cardBrand ? `${application.cardBrand} ` : ''}
                    •••• {application.cardLast4}
                  </Text>
                  <Text style={styles.cardBoundOk}>привязана</Text>
                </View>
              ) : cardAwaiting ? (
                // Банк ответит не мгновенно, а уведомление от него может и не
                // дойти — тогда исход доберёт сверка. Показываем ожидание, а
                // не мнимый успех и не предложение платить второй раз.
                <View style={styles.cardPending}>
                  <Text style={styles.cardPendingText}>Проверяем оплату у банка…</Text>
                  <Text style={styles.fieldHint}>
                    Обычно занимает меньше минуты. Если банк ответит не сразу, мы завершим привязку
                    сами — платить второй раз не нужно.
                  </Text>
                </View>
              ) : (
                <PressableScale
                  style={[styles.faceBtn, binding && styles.loginBtnDim]}
                  onPress={bindCard}
                  disabled={binding || loading}
                >
                  <Text style={styles.faceBtnText}>
                    {binding
                      ? 'Открываем банк…'
                      : cardFailed
                        ? 'Попробовать снова'
                        : 'Привязать карту'}
                  </Text>
                </PressableScale>
              )}

              {cardFailed && (
                <Text style={styles.cardWarn}>
                  {application.bindingState === 'canceled'
                    ? 'Прошлая попытка не завершилась — карта не привязана.'
                    : 'Прошлая попытка не удалась — карта не привязана.'}
                </Text>
              )}

              <Text style={styles.fieldHint}>
                Номер карты вводится на странице банка — приложение его не видит и не хранит. Нужна
                для подтверждения личности и будущих выплат.
              </Text>
              {!cardBound && !cardAwaiting && (
                <Text style={styles.cardWarn}>
                  Без карты заявку отправить можно, но одобрят её вряд ли.
                </Text>
              )}
            </>
          )}

          {error && (
            <Animated.Text entering={FadeInDown.duration(240)} style={styles.fieldError}>
              {error}
            </Animated.Text>
          )}

          <PressableScale
            style={[styles.loginBtn, loading && styles.loginBtnDim]}
            onPress={() => save(!verified)}
            disabled={loading}
          >
            <Text style={styles.loginBtnText}>{primaryLabel}</Text>
          </PressableScale>

          {/* Черновик даёт бросить заполнение и вернуться позже */}
          {!verified && (
            <PressableScale style={styles.draftBtn} onPress={() => save(false)} disabled={loading}>
              <Text style={styles.draftBtnText}>Сохранить черновик</Text>
            </PressableScale>
          )}
        </Animated.View>
      </ScrollView>

      {openDoc && <LegalScreen docId={openDoc} onClose={() => setOpenDoc(null)} />}

      {pickingCity && (
        <CityPicker
          mode="multi"
          values={cities}
          title="Где вы работаете"
          onToggle={(key) =>
            setCities((prev) =>
              prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key],
            )
          }
          onClose={() => setPickingCity(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const { mode } = useTheme();
  const styles = themed[mode];
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

// ---------- Лента заявок ----------

function JobList({
  email,
  profile,
  jobs,
  typingJobId,
  onOpenJob,
  onClose,
  onLogout,
  onEditProfile,
}: {
  email: string;
  profile: MasterProfile;
  jobs: Job[];
  typingJobId: string | null;
  onOpenJob: (id: string) => void;
  onClose: () => void;
  onLogout: () => void;
  onEditProfile: () => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  // Стаггер положен первой пачке — она представляет список целиком. Заявка,
  // пришедшая из подписки позже, должна появляться сразу, а не ждать очереди
  // по своему номеру в списке.
  const listShown = useRef(false);
  const firstBatch = !listShown.current;
  if (jobs.length) listShown.current = true;
  // Отклонённая цена требует того же действия, что и новая заявка, —
  // назвать сумму, поэтому считаются вместе
  const newCount = jobs.filter((j) => j.status === 'new' || j.status === 'declined').length;
  const activeCount = jobs.filter((j) => j.status === 'accepted').length;

  const filterText = [
    profile.cities.length ? profile.cities.map(settlementLabel).join(', ') : 'вся республика',
    profile.skills.length ? profile.skills.join(', ') : 'все специальности',
  ].join(' · ');

  return (
    <View style={styles.fill}>
      <View style={styles.topBar}>
        <PressableScale style={styles.backChip} onPress={onClose}>
          <Text style={styles.backText}>‹ Профиль</Text>
        </PressableScale>
        <PressableScale style={styles.backChip} onPress={onLogout}>
          <Text style={styles.logoutText}>Выйти из раздела</Text>
        </PressableScale>
      </View>

      <ScrollView style={styles.fill} contentContainerStyle={styles.listContent}>
        <Animated.Text entering={FadeInDown.duration(420)} style={styles.header}>
          Я мастер
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(40).duration(380)} style={styles.headerSub}>
          {profile.rating != null
            ? `★ ${ratingText(profile.rating)} · ${counted(profile.reviewsCount, 'отзыв', 'отзыва', 'отзывов')}`
            : email}
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(80).duration(360)} style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, newCount > 0 && styles.statValueNew]}>{newCount}</Text>
            <Text style={styles.statLabel}>ждут вашей цены</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, activeCount > 0 && styles.statValueActive]}>
              {activeCount}
            </Text>
            <Text style={styles.statLabel}>в работе</Text>
          </View>
        </Animated.View>

        {/* Что именно отсекает ленту — видно сразу, иначе пустой список
            выглядит поломкой, а не настройкой */}
        <Animated.View entering={FadeInDown.delay(100).duration(360)}>
          <PressableScale style={styles.filterRow} onPress={onEditProfile}>
            <Text style={styles.filterText} numberOfLines={1}>
              {filterText}
            </Text>
            <Text style={styles.filterEdit}>изменить</Text>
          </PressableScale>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(120).duration(360)} style={styles.sectionTitle}>
          Поступающие заказы
        </Animated.Text>

        {jobs.length === 0 ? (
          <Animated.View entering={FadeIn.delay(160).duration(400)} style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>Пока нет заявок</Text>
            <Text style={styles.emptySub}>
              {profile.cities.length || profile.skills.length
                ? 'По выбранным городу и специальностям заявок нет. Попробуйте расширить анкету.'
                : 'Новые заказы рядом с вами появятся здесь'}
            </Text>
          </Animated.View>
        ) : (
          jobs.map((job, i) => {
            const last = job.messages[job.messages.length - 1];
            return (
              <Animated.View
                key={job.id}
                entering={FadeInDown.delay(firstBatch ? 140 + i * STAGGER : 0).duration(340)}
                exiting={FadeOut.duration(180)}
                layout={LinearTransition.springify().damping(20).stiffness(170)}
              >
                <PressableScale style={styles.jobItem} onPress={() => onOpenJob(job.id)}>
                  <View style={styles.jobBody}>
                    <Text style={styles.jobTitle}>{job.title}</Text>
                    <Text style={styles.jobMeta}>
                      {[job.client, job.address].filter(Boolean).join(' · ') || 'Заявка закрыта'}
                    </Text>
                    {typingJobId === job.id ? (
                      <Text style={styles.jobTyping}>клиент печатает…</Text>
                    ) : last ? (
                      <Text style={styles.jobPreview} numberOfLines={1}>
                        {last.from === 'me' ? 'Вы: ' : ''}
                        {last.text}
                      </Text>
                    ) : (
                      <Text style={styles.jobPreview} numberOfLines={1}>
                        {job.desc}
                      </Text>
                    )}
                  </View>
                  <View style={styles.jobRight}>
                    <Text style={[styles.jobStatus, { color: statusColorFor(job.status, t) }]}>
                      {STATUS_LABEL[job.status]}
                    </Text>
                    {(job.price ?? job.myOffer) != null && (
                      <Text style={styles.jobPrice}>
                        {rub((job.price ?? job.myOffer) as number)}
                      </Text>
                    )}
                    {job.unread && <View style={styles.unreadDot} />}
                  </View>
                </PressableScale>
              </Animated.View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ---------- Заявка: детали, цена, чат с клиентом ----------

function JobDetail({
  job,
  typing,
  onBack,
  onSendOffer,
  onWithdrawOffer,
  onOfferLegacy,
  onFinish,
  onSend,
}: {
  job: Job;
  typing: boolean;
  onBack: () => void;
  onSendOffer: (price: number, comment: string) => void;
  onWithdrawOffer: () => void;
  onOfferLegacy: (price: number) => void;
  onFinish: () => void;
  onSend: (text: string) => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [priceDraft, setPriceDraft] = useState('');
  const [offerComment, setOfferComment] = useState('');
  const [text, setText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const price = parseInt(priceDraft.replace(/\D/g, ''), 10);
  const priceValid = Number.isFinite(price) && price > 0;

  // Переписка открыта только выбранному мастеру: правила пускают в чат
  // участников заявки, а до выбора мастер ей не участник
  const canChat = job.legacy || job.status === 'accepted' || job.status === 'done';

  const submitPrice = () => {
    if (!priceValid) return;
    if (job.legacy) onOfferLegacy(price);
    else onSendOffer(price, offerComment);
    setPriceDraft('');
    setOfferComment('');
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <KeyboardAvoidingView
      style={[styles.fill, styles.detailRoot]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topBar}>
        <PressableScale style={styles.backChip} onPress={onBack}>
          <Text style={styles.backText}>‹ Заявки</Text>
        </PressableScale>
        <View style={styles.detailTitleWrap}>
          <Text style={styles.detailName}>{job.client}</Text>
        </View>
        <View style={styles.backChipGhost} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.fill}
        contentContainerStyle={styles.detailContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        <View style={styles.detailCard}>
          <Text style={styles.detailJobTitle}>{job.title}</Text>
          <Text style={styles.detailMeta}>
            {job.address} · {job.date}
          </Text>
          <Text style={styles.detailDesc}>{job.desc}</Text>
        </View>

        {/* Блок цены. Заявку у клиента может просить несколько мастеров, и
            выбирает он: поэтому здесь не «взять заявку», а прислать цену
            с парой слов о себе — больше сказать до выбора негде. */}
        {job.status === 'new' || job.status === 'declined' ? (
          <View style={styles.priceCard}>
            <Text style={styles.priceLabel}>
              {job.status === 'declined'
                ? `Клиент отклонил ${rub(job.price ?? 0)} — назовите другую цену`
                : 'Ваша цена за работу'}
            </Text>
            <View style={styles.priceRow}>
              <TextInput
                style={styles.priceInput}
                value={priceDraft}
                onChangeText={setPriceDraft}
                placeholder="3 500"
                placeholderTextColor={t.textMuted}
                keyboardType="number-pad"
                maxLength={7}
              />
              <Text style={styles.priceCurrency}>₽</Text>
              <PressableScale
                style={[styles.priceBtn, !priceValid && styles.priceBtnDim]}
                onPress={submitPrice}
                disabled={!priceValid}
              >
                <Text style={styles.priceBtnText}>Предложить</Text>
              </PressableScale>
            </View>

            {!job.legacy && (
              <TextInput
                style={styles.offerCommentInput}
                value={offerComment}
                onChangeText={setOfferComment}
                placeholder="Пара слов клиенту: когда можете приехать, что входит в цену"
                placeholderTextColor={t.textMuted}
                multiline
                maxLength={300}
              />
            )}
          </View>
        ) : (
          <View
            style={[
              styles.priceCard,
              (job.status === 'accepted' || job.status === 'done') && styles.priceCardAccepted,
            ]}
          >
            <Text style={[styles.priceStatusText, { color: statusColorFor(job.status, t) }]}>
              {job.status === 'offered'
                ? `Вы предложили ${rub(job.myOffer ?? job.price ?? 0)} — клиент выбирает`
                : job.status === 'accepted'
                  ? `Клиент выбрал вас · ${rub(job.price ?? 0)} 🎉`
                  : job.status === 'cancelled'
                    ? 'Клиент отменил заявку'
                    : job.status === 'closed'
                      ? 'Заявку закрыли — выбрали другого мастера либо клиент её отменил'
                      : `Работа завершена · ${rub(job.price ?? 0)}`}
            </Text>

            {/* Цена принята — осталось сделать работу и отметить её выполненной */}
            {job.status === 'accepted' && (
              <PressableScale style={styles.finishBtn} onPress={onFinish}>
                <Text style={styles.finishBtnText}>✓ Работа выполнена</Text>
              </PressableScale>
            )}

            {/* Пока клиент не выбрал, предложение можно забрать назад */}
            {job.status === 'offered' && !job.legacy && (
              <PressableScale style={styles.withdrawBtn} onPress={onWithdrawOffer}>
                <Text style={styles.withdrawBtnText}>Отозвать предложение</Text>
              </PressableScale>
            )}
          </View>
        )}

        {/* Чат с клиентом */}
        {(job.messages.length > 0 || typing) && (
          <Text style={styles.chatTitle}>Чат с клиентом</Text>
        )}

        {job.messages.map((m) => (
          <Animated.View
            key={m.id}
            entering={m.from === 'me' ? FadeInRight.duration(260) : FadeInDown.duration(260)}
            style={[styles.bubbleWrap, m.from === 'me' && styles.bubbleWrapMe]}
          >
            <View style={[styles.bubble, m.from === 'me' && styles.bubbleMe]}>
              <Text style={[styles.bubbleText, m.from === 'me' && styles.bubbleTextMe]}>
                {m.text}
              </Text>
            </View>
            <Text style={styles.bubbleTime}>{m.time}</Text>
          </Animated.View>
        ))}

        {typing && (
          <Animated.View
            entering={FadeInDown.duration(240)}
            exiting={FadeOut.duration(160)}
            style={styles.bubbleWrap}
          >
            <View style={styles.bubble}>
              <TypingDots />
            </View>
          </Animated.View>
        )}
      </ScrollView>

      {/* Писать клиенту может только выбранный мастер: до выбора чат общий
          с конкурентами, а правила пускают туда лишь участников заявки */}
      {canChat ? (
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Написать клиенту…"
            placeholderTextColor={t.textMuted}
            style={styles.input}
            multiline
          />
          <PressableScale
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!text.trim()}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </PressableScale>
        </View>
      ) : (
        <View style={styles.chatLockedRow}>
          <Text style={styles.chatLockedText}>Чат откроется, когда клиент выберет вас</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// Три точки, «дышащие» по очереди — клиент набирает текст
function TypingDots() {
  const { mode } = useTheme();
  const styles = themed[mode];
  const p = useSharedValue(0);
  // Цикл бесконечный, поэтому обрываем его руками: клиент перестал печатать —
  // компонент исчез, а анимация без этого осталась бы висеть на UI-потоке
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) return;
    p.value = withRepeat(
      withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
      -1,
      false,
    );
    return () => cancelAnimation(p);
  }, [reduceMotion, p]);

  // Это настоящий хук: три вызова ниже безусловны и всегда в одном порядке.
  // Имя с `use` не косметика — оно включает правило, которое не даст обернуть
  // вызов в условие и тихо сломать порядок хуков.
  const useDotStyle = (phase: number) =>
    useAnimatedStyle(() => {
      const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (p.value - phase));
      return {
        opacity: 0.25 + 0.75 * wave,
        transform: [{ translateY: -2.5 * wave }],
      };
    });

  const d0 = useDotStyle(0);
  const d1 = useDotStyle(0.18);
  const d2 = useDotStyle(0.36);

  return (
    <View style={styles.typingRow}>
      <Animated.View style={[styles.typingDot, d0]} />
      <Animated.View style={[styles.typingDot, d1]} />
      <Animated.View style={[styles.typingDot, d2]} />
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    root: { backgroundColor: t.bg },
    fill: { flex: 1 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 60,
      paddingBottom: 12,
    },
    backChip: {
      backgroundColor: t.card,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: t.border,
    },
    backChipGhost: { width: 84 },
    backText: { fontWeight: '700', fontSize: 12.5, color: t.accent },
    logoutText: { fontWeight: '700', fontSize: 12.5, color: t.danger },

    // Вход
    loginContent: { padding: 24, paddingTop: 24, alignItems: 'center' },
    loginBadge: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    loginBadgeIcon: { fontSize: 32 },
    loginTitle: { fontSize: 20, fontWeight: '800', color: t.text },
    loginSub: {
      color: t.textSoft,
      fontWeight: '600',
      fontSize: 12.5,
      textAlign: 'center',
      marginTop: 6,
      marginBottom: 20,
      paddingHorizontal: 12,
      lineHeight: 18,
    },
    loginCard: {
      alignSelf: 'stretch',
      backgroundColor: t.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: t.border,
      padding: 18,
    },
    fieldLabel: { fontWeight: '700', fontSize: 12, color: t.textSoft, marginBottom: 6 },
    fieldLabelGap: { marginTop: 14 },
    fieldInput: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 14,
      fontWeight: '600',
      color: t.text,
      backgroundColor: t.inputBg,
    },
    fieldError: { color: t.danger, fontWeight: '700', fontSize: 12, marginTop: 10 },
    fieldHint: { color: t.textMuted, fontWeight: '600', fontSize: 11, marginTop: 6 },
    pickerField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      backgroundColor: t.inputBg,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    pickerValue: { flex: 1, fontSize: 14, fontWeight: '700', color: t.text },
    pickerPlaceholder: { color: t.textMuted, fontWeight: '600' },
    pickerChevron: { fontSize: 18, fontWeight: '700', color: t.textMuted },
    clearCity: { paddingVertical: 8, marginTop: 2 },
    clearCityText: { color: t.accent, fontWeight: '700', fontSize: 11.5 },
    fieldInputArea: { minHeight: 74, textAlignVertical: 'top', paddingTop: 10 },
    rejectCard: {
      backgroundColor: t.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.danger,
      padding: 14,
      marginBottom: 14,
    },
    rejectTitle: { fontWeight: '800', fontSize: 13.5, color: t.danger },
    rejectText: {
      fontWeight: '600',
      fontSize: 12.5,
      color: t.text,
      lineHeight: 17,
      marginTop: 6,
    },
    rejectHint: { fontWeight: '600', fontSize: 11.5, color: t.textMuted, marginTop: 8 },
    faceRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    facePhoto: { width: 78, height: 78, borderRadius: 16, backgroundColor: t.chip },
    facePhotoEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: t.border,
    },
    facePhotoIcon: { fontSize: 30 },
    faceBody: { flex: 1 },
    faceBtn: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.accentBorder,
      backgroundColor: t.accentSoft,
      paddingVertical: 11,
      alignItems: 'center',
    },
    faceBtnText: { color: t.accent, fontWeight: '800', fontSize: 13 },
    cardBound: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.accentBorder,
      backgroundColor: t.accentFaint,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    cardBoundText: { color: t.text, fontWeight: '800', fontSize: 13 },
    cardBoundOk: { color: t.accent, fontWeight: '800', fontSize: 11.5 },
    cardWarn: { color: t.warn, fontWeight: '700', fontSize: 11.5, marginTop: 6 },
    cardPending: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.soft,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    cardPendingText: { color: t.blue, fontWeight: '800', fontSize: 13 },
    consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 12 },
    checkbox: {
      width: 21,
      height: 21,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: t.inputBorder,
      backgroundColor: t.inputBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: t.accent, borderColor: t.accent },
    checkboxTick: { color: t.onAccent, fontSize: 13, fontWeight: '800', lineHeight: 15 },
    consentText: { flex: 1, fontSize: 11.5, fontWeight: '600', color: t.textMuted, lineHeight: 17 },
    consentLink: { color: t.accent, fontWeight: '800' },
    revokeBtn: { paddingVertical: 8, marginTop: 4 },
    revokeText: { color: t.danger, fontWeight: '700', fontSize: 11.5 },
    draftBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
    draftBtnText: { color: t.textMuted, fontWeight: '700', fontSize: 12.5 },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 9,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    summaryLabel: { fontWeight: '700', fontSize: 12.5, color: t.textMuted },
    summaryValue: { fontWeight: '800', fontSize: 12.5, color: t.text },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    skillChip: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
      paddingHorizontal: 11,
      paddingVertical: 8,
    },
    skillChipOn: { backgroundColor: t.accentSoft, borderColor: t.accentBorder },
    skillChipText: { fontSize: 12, fontWeight: '700', color: t.textSoft },
    skillChipTextOn: { color: t.accent },
    loginBtn: {
      marginTop: 18,
      backgroundColor: t.accent,
      borderRadius: 14,
      paddingVertical: 13,
      alignItems: 'center',
    },
    loginBtnDim: { backgroundColor: t.disabled },
    loginBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 14 },
    loginHint: { color: t.textMuted, fontWeight: '600', fontSize: 11.5 },
    loginSwitchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
    loginSwitchText: { color: t.accent, fontWeight: '800', fontSize: 11.5 },

    // Лента заявок
    listContent: { padding: 16, paddingTop: 8, paddingBottom: 40 },
    header: { fontSize: 20, fontWeight: '800', color: t.text },
    headerSub: {
      color: t.textMuted,
      fontWeight: '600',
      fontSize: 12,
      marginTop: 2,
      marginBottom: 14,
    },
    statsRow: { flexDirection: 'row', gap: 9, marginBottom: 20 },
    statCard: {
      flex: 1,
      backgroundColor: t.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      paddingVertical: 14,
    },
    statValue: { fontSize: 20, fontWeight: '800', color: t.text },
    statValueNew: { color: t.warn },
    statValueActive: { color: t.accent },
    statLabel: { fontSize: 11, fontWeight: '700', color: t.textMuted, marginTop: 2 },
    sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10, color: t.text },
    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: t.soft,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 18,
    },
    filterText: { flex: 1, fontSize: 12, fontWeight: '700', color: t.textSoft },
    filterEdit: { fontSize: 12, fontWeight: '800', color: t.accent },
    jobItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.card,
      borderRadius: 16,
      padding: 12,
      marginBottom: 9,
      borderWidth: 1,
      borderColor: t.border,
    },
    jobBody: { flex: 1, marginRight: 8 },
    jobTitle: { fontWeight: '700', fontSize: 13.5, color: t.text },
    jobMeta: { color: t.textMuted, fontSize: 11, fontWeight: '600', marginTop: 2 },
    jobPreview: { color: t.textSoft, fontSize: 12, marginTop: 3 },
    jobTyping: {
      color: t.accent,
      fontSize: 12,
      marginTop: 3,
      fontWeight: '700',
      fontStyle: 'italic',
    },
    jobRight: { alignItems: 'flex-end', gap: 3 },
    jobStatus: { fontWeight: '700', fontSize: 11.5 },
    jobPrice: { color: t.text, fontWeight: '800', fontSize: 12 },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.warn },
    emptyWrap: {
      alignItems: 'center',
      paddingVertical: 40,
      backgroundColor: t.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
    },
    emptyIcon: { fontSize: 30, marginBottom: 8 },
    emptyTitle: { fontWeight: '800', fontSize: 14, color: t.text },
    emptySub: {
      color: t.textMuted,
      fontWeight: '600',
      fontSize: 11.5,
      marginTop: 4,
      textAlign: 'center',
      paddingHorizontal: 30,
    },

    // Детали заявки
    detailRoot: { backgroundColor: t.bg },
    detailTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    detailName: { fontWeight: '800', fontSize: 14.5, color: t.text },
    detailContent: { padding: 16, paddingTop: 4, paddingBottom: 24 },
    detailCard: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      padding: 16,
      marginBottom: 10,
    },
    detailJobTitle: { fontWeight: '800', fontSize: 15, color: t.text },
    detailMeta: { color: t.textMuted, fontWeight: '600', fontSize: 11.5, marginTop: 3 },
    detailDesc: { color: t.textSoft, fontSize: 13, lineHeight: 19, marginTop: 10 },
    priceCard: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      padding: 16,
      marginBottom: 16,
    },
    priceCardAccepted: { borderColor: t.accentBorder, backgroundColor: t.accentFaint },
    priceLabel: { fontWeight: '700', fontSize: 12, color: t.textSoft, marginBottom: 8 },
    priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    priceInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 9,
      fontSize: 15,
      fontWeight: '800',
      color: t.text,
      backgroundColor: t.inputBg,
    },
    priceCurrency: { fontWeight: '800', fontSize: 15, color: t.textSoft },
    priceBtn: {
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 11,
    },
    priceBtnDim: { backgroundColor: t.disabled },
    priceBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 13 },
    priceStatusText: { fontWeight: '700', fontSize: 13, lineHeight: 19 },
    finishBtn: {
      marginTop: 12,
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
    },
    finishBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 13 },
    offerCommentInput: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      backgroundColor: t.inputBg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 10,
      fontSize: 12.5,
      fontWeight: '600',
      color: t.text,
      minHeight: 58,
      textAlignVertical: 'top',
    },
    withdrawBtn: { alignItems: 'center', paddingVertical: 11, marginTop: 6 },
    withdrawBtnText: { color: t.danger, fontWeight: '800', fontSize: 12.5 },
    chatLockedRow: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: t.border,
      backgroundColor: t.card,
    },
    chatLockedText: {
      textAlign: 'center',
      color: t.textMuted,
      fontWeight: '700',
      fontSize: 12,
    },
    chatTitle: { fontSize: 13, fontWeight: '800', color: t.textSoft, marginBottom: 10 },
    bubbleWrap: { marginBottom: 12, alignItems: 'flex-start', maxWidth: '78%' },
    bubbleWrapMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
    bubble: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderBottomLeftRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.border,
    },
    bubbleMe: {
      backgroundColor: t.accent,
      borderColor: t.accent,
      borderBottomLeftRadius: 18,
      borderBottomRightRadius: 6,
    },
    bubbleText: { fontSize: 13.5, color: t.text, lineHeight: 19 },
    bubbleTextMe: { color: t.onAccent },
    bubbleTime: {
      color: t.textMuted,
      fontSize: 10,
      fontWeight: '600',
      marginTop: 4,
      marginHorizontal: 4,
    },
    typingRow: { flexDirection: 'row', gap: 4, paddingVertical: 3 },
    typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.textMuted },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 16,
      paddingBottom: Platform.OS === 'ios' ? 28 : 16,
      paddingTop: 8,
      gap: 8,
    },
    input: {
      flex: 1,
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 13.5,
      color: t.text,
      maxHeight: 100,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: { backgroundColor: t.disabled },
    sendIcon: { color: t.onAccent, fontSize: 17, fontWeight: '800' },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
