import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeOut,
  LinearTransition,
  SlideInRight,
  SlideOutRight,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
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
import { db } from '../firebaseConfig';

// Режим мастера — отдельный «мир» поверх клиентского приложения.
// Аккаунт один на человека: роль мастера — это анкета masters/{uid}.
// На её существовании построена проверка isMaster() в firestore.rules,
// поэтому отдельного «входа для мастеров» больше нет: есть анкета — есть доступ.

type JobStatus = 'new' | 'offered' | 'accepted' | 'done';

type JobMessage = { id: string; from: 'me' | 'client'; text: string; time: string };

type Job = {
  id: string;
  title: string;
  client: string;
  address: string;
  date: string;
  desc: string;
  status: JobStatus;
  price?: number;
  unread: boolean;
  messages: JobMessage[];
};

const STATUS_LABEL: Record<JobStatus, string> = {
  new: 'Новая',
  offered: 'Ждём клиента',
  accepted: 'Цена принята',
  done: 'Завершена',
};

const statusColorFor = (status: JobStatus, t: Palette): string => ({
  new: t.warn,
  offered: t.blue,
  accepted: t.accent,
  done: t.textMuted,
}[status]);

function now() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let seq = 0;
const uid = () => `m${Date.now()}-${seq++}`;

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

type Props = {
  open: boolean;
  onClose: () => void;
};

export function MasterScreen({ open, onClose }: Props) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const { user } = useAuth();
  const myUid = user?.uid ?? null;
  // Анкета мастера: есть — раздел открыт, нет — предлагаем её заполнить
  const [master, setMaster] = useState<{ name: string } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  // В какой заявке клиент сейчас «печатает»
  const [typingJobId, setTypingJobId] = useState<string | null>(null);


  const openJob = jobs.find((j) => j.id === openJobId) ?? null;

  // Весь оверлей мягко выезжает справа, как вложенный экран
  const layerStyle = useAnimatedStyle(() => ({
    opacity: withTiming(open ? 1 : 0, { duration: 260 }),
    transform: [{ translateX: withSpring(open ? 0 : 60, springs.nav) }],
  }));

  // Анкету проверяем при каждом открытии раздела: она могла появиться
  // на другом устройстве под тем же аккаунтом
  useEffect(() => {
    if (!open || !myUid) return;
    let alive = true;
    getDoc(doc(db, 'masters', myUid))
      .then((snap) => {
        if (!alive) return;
        setMaster(snap.exists() ? { name: String(snap.data().name ?? '') } : null);
      })
      .catch((e) => console.warn('Анкета мастера недоступна:', e));
    return () => { alive = false; };
  }, [open, myUid]);

  // Настоящие заявки из Firestore: свободные, которые вправе видеть любой
  // мастер, и свои уже взятые. Запроса два, потому что Firestore не умеет
  // «ИЛИ» по разным полям, а результаты склеиваются по id.
  const buckets = useRef<{ open: Job[]; mine: Job[] }>({ open: [], mine: [] });

  useEffect(() => {
    if (!master || !myUid) {
      setJobs([]);
      buckets.current = { open: [], mine: [] };
      return;
    }

    const toJob = (d: QueryDocumentSnapshot): Job => {
      const v = d.data();
      const status: JobStatus = (v.status === 'Завершена' || v.status === 'Ждёт подтверждения')
        ? 'done'
        : v.priceStatus === 'accepted'
          ? 'accepted'
          : v.priceStatus === 'offered'
            ? 'offered'
            : 'new';
      return {
        id: d.id,
        title: v.title ?? 'Заявка',
        client: v.clientName ?? 'Клиент',
        address: v.address ?? '',
        date: v.date ?? '',
        desc: v.comment || 'Клиент не оставил комментарий.',
        status,
        price: v.price ?? undefined,
        unread: false,
        messages: [],
      };
    };

    // Переписка и отметка «прочитано» живут только на устройстве мастера,
    // поэтому при обновлении списка их нужно сохранить
    const merge = () => {
      const all = new Map<string, Job>();
      [...buckets.current.open, ...buckets.current.mine].forEach((j) => all.set(j.id, j));
      setJobs((prev) => [...all.values()]
        .map((j) => {
          const old = prev.find((p) => p.id === j.id);
          return old ? { ...j, unread: old.unread, messages: old.messages } : j;
        })
        .sort((a, b) => b.id.localeCompare(a.id)));
    };

    const unsubOpen = onSnapshot(
      query(collection(db, 'orders'), where('status', '==', 'Поиск мастера')),
      (snap) => { buckets.current.open = snap.docs.map(toJob); merge(); },
      (e) => console.warn('Свободные заявки недоступны:', e),
    );

    const unsubMine = onSnapshot(
      query(collection(db, 'orders'), where('masterId', '==', myUid)),
      (snap) => { buckets.current.mine = snap.docs.map(toJob); merge(); },
      (e) => console.warn('Свои заявки недоступны:', e),
    );

    return () => { unsubOpen(); unsubMine(); };
  }, [master, myUid]);

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
      senderId: myUid, text, time: now(), createdAt: serverTimestamp(),
    }).catch((e) => console.warn('Сообщение не отправлено:', e));
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

  // Предложение цены уходит в саму заявку. Ответа здесь не подделываем:
  // статус изменится, только когда клиент реально нажмёт «Принять».
  // Повторное предложение перетирает прежнее и снова требует согласия.
  const offerPrice = (jobId: string, price: number) => {
    if (!myUid) return;
    const previous = jobs.find((j) => j.id === jobId)?.price;

    updateDoc(doc(db, 'orders', jobId), {
      masterId: myUid,
      masterName: master?.name ?? 'Мастер',
      price,
      priceStatus: 'offered',
      priceHistory: arrayUnion({
        amount: price,
        by: 'master',
        action: previous == null ? 'offered' : 'changed',
        at: new Date().toISOString(),
      }),
    }).catch((e) => console.warn('Не удалось предложить цену:', e));

    pushMessage(jobId, previous == null
      ? `Готов взяться. Моя цена — ${rub(price)}.`
      : `Пересмотрел цену: теперь ${rub(price)}.`);
  };

  // Мастер отмечает работу выполненной — подтверждать её будет клиент
  const finishJob = (jobId: string) => {
    updateDoc(doc(db, 'orders', jobId), { status: 'Ждёт подтверждения' })
      .catch((e) => console.warn('Не удалось завершить заявку:', e));

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
      {!master ? (
        <MasterOnboarding
          uid={myUid}
          defaultName={user?.displayName ?? ''}
          onClose={onClose}
          onDone={(name) => setMaster({ name })}
        />
      ) : (
        <View style={styles.fill}>
          <JobList
            email={user?.email ?? ''}
            jobs={jobs}
            typingJobId={typingJobId}
            onOpenJob={handleOpenJob}
            onClose={onClose}
            onLogout={handleLogout}
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
                onOffer={(price) => offerPrice(openJob.id, price)}
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

// ---------- Анкета мастера ----------

function MasterOnboarding({
  uid: myUid, defaultName, onClose, onDone,
}: {
  uid: string | null;
  defaultName: string;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const { mode: themeMode, colors: t } = useTheme();
  const styles = themed[themeMode];
  const [name, setName] = useState(defaultName);
  const [skills, setSkills] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (name.trim().length < 2) {
      setError('Напишите, как вас зовут');
      return;
    }
    if (!myUid) {
      setError('Сессия не найдена — войдите в приложение заново');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Документ masters/{uid} и есть роль мастера: на его существовании
      // держится проверка isMaster() в правилах доступа
      await setDoc(doc(db, 'masters', myUid), {
        name: name.trim(),
        skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
        createdAt: serverTimestamp(),
      }, { merge: true });
      onDone(name.trim());
    } catch (e) {
      console.warn('Не удалось сохранить анкету мастера:', e);
      setError('Не удалось сохранить анкету. Попробуйте ещё раз');
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topBar}>
        <PressableScale style={styles.backChip} onPress={onClose}>
          <Text style={styles.backText}>‹  Назад</Text>
        </PressableScale>
        <View style={styles.backChipGhost} />
      </View>

      <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.duration(420)} style={styles.loginBadge}>
          <Text style={styles.loginBadgeIcon}>🛠️</Text>
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.delay(60).duration(380)}
          style={styles.loginTitle}
        >
          Стать мастером
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(100).duration(380)}
          style={styles.loginSub}
        >
          Расскажите о себе — и начните получать заказы рядом с вами.
          Отдельный аккаунт не нужен: роль добавится к текущему.
        </Animated.Text>

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

          <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Что умеете</Text>
          <TextInput
            style={styles.fieldInput}
            value={skills}
            onChangeText={setSkills}
            placeholder="электрика, сантехника, мебель"
            placeholderTextColor={t.textMuted}
            editable={!loading}
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          {error && (
            <Animated.Text entering={FadeInDown.duration(240)} style={styles.fieldError}>
              {error}
            </Animated.Text>
          )}

          <PressableScale
            style={[styles.loginBtn, loading && styles.loginBtnDim]}
            onPress={submit}
            disabled={loading}
          >
            <Text style={styles.loginBtnText}>
              {loading ? 'Сохраняем…' : 'Начать получать заказы'}
            </Text>
          </PressableScale>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(240).duration(360)} style={styles.loginSwitchRow}>
          <Text style={styles.loginHint}>Анкету можно будет дополнить позже</Text>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------- Лента заявок ----------

function JobList({
  email, jobs, typingJobId, onOpenJob, onClose, onLogout,
}: {
  email: string;
  jobs: Job[];
  typingJobId: string | null;
  onOpenJob: (id: string) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const newCount = jobs.filter((j) => j.status === 'new').length;
  const activeCount = jobs.filter((j) => j.status === 'accepted').length;

  return (
    <View style={styles.fill}>
      <View style={styles.topBar}>
        <PressableScale style={styles.backChip} onPress={onClose}>
          <Text style={styles.backText}>‹  Профиль</Text>
        </PressableScale>
        <PressableScale style={styles.backChip} onPress={onLogout}>
          <Text style={styles.logoutText}>Выйти</Text>
        </PressableScale>
      </View>

      <ScrollView style={styles.fill} contentContainerStyle={styles.listContent}>
        <Animated.Text entering={FadeInDown.duration(420)} style={styles.header}>
          Я мастер
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(40).duration(380)} style={styles.headerSub}>
          {email}
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(80).duration(360)} style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, newCount > 0 && styles.statValueNew]}>{newCount}</Text>
            <Text style={styles.statLabel}>новых заявок</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, activeCount > 0 && styles.statValueActive]}>
              {activeCount}
            </Text>
            <Text style={styles.statLabel}>в работе</Text>
          </View>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(120).duration(360)} style={styles.sectionTitle}>
          Поступающие заказы
        </Animated.Text>

        {jobs.length === 0 ? (
          <Animated.View entering={FadeIn.delay(160).duration(400)} style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>Пока нет заявок</Text>
            <Text style={styles.emptySub}>Новые заказы рядом с вами появятся здесь</Text>
          </Animated.View>
        ) : (
          jobs.map((job, i) => {
            const last = job.messages[job.messages.length - 1];
            return (
              <Animated.View
                key={job.id}
                entering={FadeInDown.delay(140 + i * STAGGER).duration(340)}
                layout={LinearTransition.springify().damping(20).stiffness(170)}
              >
                <PressableScale style={styles.jobItem} onPress={() => onOpenJob(job.id)}>
                  <View style={styles.jobBody}>
                    <Text style={styles.jobTitle}>{job.title}</Text>
                    <Text style={styles.jobMeta}>
                      {job.client} · {job.address}
                    </Text>
                    {typingJobId === job.id ? (
                      <Text style={styles.jobTyping}>клиент печатает…</Text>
                    ) : last ? (
                      <Text style={styles.jobPreview} numberOfLines={1}>
                        {last.from === 'me' ? 'Вы: ' : ''}
                        {last.text}
                      </Text>
                    ) : (
                      <Text style={styles.jobPreview} numberOfLines={1}>{job.desc}</Text>
                    )}
                  </View>
                  <View style={styles.jobRight}>
                    <Text style={[styles.jobStatus, { color: statusColorFor(job.status, t) }]}>
                      {STATUS_LABEL[job.status]}
                    </Text>
                    {job.price != null && <Text style={styles.jobPrice}>{rub(job.price)}</Text>}
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
  job, typing, onBack, onOffer, onFinish, onSend,
}: {
  job: Job;
  typing: boolean;
  onBack: () => void;
  onOffer: (price: number) => void;
  onFinish: () => void;
  onSend: (text: string) => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [priceDraft, setPriceDraft] = useState('');
  const [text, setText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const price = parseInt(priceDraft.replace(/\D/g, ''), 10);
  const priceValid = Number.isFinite(price) && price > 0;

  const submitPrice = () => {
    if (!priceValid) return;
    onOffer(price);
    setPriceDraft('');
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
          <Text style={styles.backText}>‹  Заявки</Text>
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

        {/* Блок цены: предложить свою или увидеть статус предложения */}
        {job.status === 'new' ? (
          <View style={styles.priceCard}>
            <Text style={styles.priceLabel}>Ваша цена за работу</Text>
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
                ? `Вы предложили ${rub(job.price ?? 0)} — ждём ответ клиента`
                : job.status === 'accepted'
                  ? `Клиент принял вашу цену ${rub(job.price ?? 0)} 🎉`
                  : `Работа завершена · ${rub(job.price ?? 0)}`}
            </Text>
            {/* Цена принята — осталось сделать работу и отметить её выполненной */}
            {job.status === 'accepted' && (
              <PressableScale style={styles.finishBtn} onPress={onFinish}>
                <Text style={styles.finishBtnText}>✓  Работа выполнена</Text>
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
    </KeyboardAvoidingView>
  );
}

// Три точки, «дышащие» по очереди — клиент набирает текст
function TypingDots() {
  const { mode } = useTheme();
  const styles = themed[mode];
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(
      withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.sin) }), -1, false,
    );
  }, []);

  const dotStyle = (phase: number) =>
    useAnimatedStyle(() => {
      const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (p.value - phase));
      return {
        opacity: 0.25 + 0.75 * wave,
        transform: [{ translateY: -2.5 * wave }],
      };
    });

  const d0 = dotStyle(0);
  const d1 = dotStyle(0.18);
  const d2 = dotStyle(0.36);

  return (
    <View style={styles.typingRow}>
      <Animated.View style={[styles.typingDot, d0]} />
      <Animated.View style={[styles.typingDot, d1]} />
      <Animated.View style={[styles.typingDot, d2]} />
    </View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
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
  headerSub: { color: t.textMuted, fontWeight: '600', fontSize: 12, marginTop: 2, marginBottom: 14 },
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
  jobTyping: { color: t.accent, fontSize: 12, marginTop: 3, fontWeight: '700', fontStyle: 'italic' },
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
  bubbleTime: { color: t.textMuted, fontSize: 10, fontWeight: '600', marginTop: 4, marginHorizontal: 4 },
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
