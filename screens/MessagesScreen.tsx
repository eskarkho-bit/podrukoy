import { useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
  FadeOutLeft,
  LinearTransition,
  SlideInRight,
  SlideOutRight,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHAT_SETTLE_MS, STAGGER, timings } from '../motion';
import { palettes, Palette, useTheme } from '../theme';
import { useBackClose } from '../components/backClose';
import { EdgeBackLayer, useEdgeBack } from '../components/edgeBack';
import { PressableScale } from '../components/PressableScale';
import { Glyph, themedIconColors } from '../components/glyphIcons';
import { FONTS } from '../components/typography';
import { PulseDot } from '../components/PulseDot';
import { EmptyScene } from '../components/illustrations';

export type ChatMessage = {
  id: string;
  from: 'user' | 'master';
  text: string;
  time: string;
  // Фото из Storage; сообщение может быть и вовсе без текста
  imageUrl?: string;
};
export type Thread = {
  id: string;
  name: string;
  icon: string;
  unread: boolean;
  // Можно ли прикладывать фото: в чате заявки — да, в поддержке — нет,
  // её правила ждут только текст
  canAttach: boolean;
  // Сделки по заявке больше нет — читать можно, писать нельзя
  closed?: boolean;
  messages: ChatMessage[];
};

type Props = {
  threads: Thread[];
  // В каком чате собеседник сейчас «печатает»
  typingThreadId: string | null;
  // Просьба другого экрана открыть конкретный чат
  openRequestId: string | null;
  onOpenRequestHandled: () => void;
  onOpenThread: (threadId: string) => void;
  onSendMessage: (threadId: string, text: string) => void;
  onSendImage: (threadId: string, localUri: string, caption: string) => Promise<void>;
  // Жалоба на сообщение собеседника — удержанием пузыря; true — принята
  onReportMessage: (threadId: string, messageId: string, text: string) => Promise<boolean>;
  // Открытая переписка — это «вложенный» экран, поэтому нижние вкладки на время прячутся
  onThreadOpenChange: (open: boolean) => void;
};

export function MessagesScreen({
  threads,
  typingThreadId,
  openRequestId,
  onOpenRequestHandled,
  onOpenThread,
  onSendMessage,
  onSendImage,
  onReportMessage,
  onThreadOpenChange,
}: Props) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const [openId, setOpenId] = useState<string | null>(null);
  const openThread = threads.find((t) => t.id === openId) ?? null;

  const handleOpen = (id: string) => {
    setOpenId(id);
    onOpenThread(id);
    onThreadOpenChange(true);
  };

  const handleBack = () => {
    // Помечаем прочитанным и на выходе: ответ мог прийти, пока чат был открыт
    if (openId) onOpenThread(openId);
    setOpenId(null);
    onThreadOpenChange(false);
  };

  // Ответ пришёл, пока чат открыт: он уже прочитан — иначе бейдж вспыхивал
  // бы на вкладке у человека, который смотрит на это самое сообщение.
  // Обработчик — через ссылку, по той же причине, что и выше.
  const onOpenThreadRef = useRef(onOpenThread);
  onOpenThreadRef.current = onOpenThread;
  const openCount = openThread?.messages.length ?? 0;
  useEffect(() => {
    if (openId && openCount) onOpenThreadRef.current(openId);
  }, [openId, openCount]);

  // Экран въехал справа как push — выезжать обязан и свайпом от края,
  // и системной кнопкой «назад», а не только чипом в шапке
  const edge = useEdgeBack(openId != null, handleBack);
  useBackClose(openId != null, handleBack);

  // Другой экран попросил открыть чат (профиль → поддержка, заказ → мастер).
  //
  // Обработчики держим в ссылках, а не в зависимостях: они пересоздаются на
  // каждой отрисовке, а `handleOpen` помечает тред прочитанным — то есть
  // пишет в Firestore. В зависимостях это дало бы запись на каждую отрисовку.
  const handleOpenRef = useRef(handleOpen);
  handleOpenRef.current = handleOpen;
  const onHandledRef = useRef(onOpenRequestHandled);
  onHandledRef.current = onOpenRequestHandled;

  useEffect(() => {
    if (!openRequestId) return;
    handleOpenRef.current(openRequestId);
    onHandledRef.current();
  }, [openRequestId]);

  return (
    <View style={styles.root}>
      {/* Пустые чаты в списке не показываем — выглядели бы мусором. Но в
          данных они есть, и открыть такой по просьбе другого экрана можно:
          заявка только что принята, сообщений ещё нет. */}
      <ThreadList
        threads={threads.filter((t) => t.messages.length > 0)}
        typingThreadId={typingThreadId}
        onOpen={handleOpen}
      />

      {openThread && (
        <Animated.View
          entering={SlideInRight.duration(timings.slideIn.duration).easing(timings.slideIn.easing)}
          // Экран, уехавший пальцем, не провожаем второй анимацией
          exiting={
            edge.dragDismissed
              ? undefined
              : SlideOutRight.duration(timings.slideOut.duration).easing(timings.slideOut.easing)
          }
          style={[StyleSheet.absoluteFill, edge.screenStyle]}
        >
          <EdgeBackLayer gesture={edge.gesture}>
            <ThreadDetail
              thread={openThread}
              typing={typingThreadId === openThread.id}
              onBack={handleBack}
              onSend={(text) => onSendMessage(openThread.id, text)}
              onSendImage={(uri, caption) => onSendImage(openThread.id, uri, caption)}
              // Жаловаться есть на кого только в чате заявки: в поддержке
              // на том конце модератор
              onReport={
                openThread.canAttach
                  ? (messageId, text) => onReportMessage(openThread.id, messageId, text)
                  : undefined
              }
            />
          </EdgeBackLayer>
        </Animated.View>
      )}
    </View>
  );
}

function ThreadList({
  threads,
  typingThreadId,
  onOpen,
}: {
  threads: Thread[];
  typingThreadId: string | null;
  onOpen: (id: string) => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const insets = useSafeAreaInsets();
  // Стаггер — это представление списка при первом появлении экрана. Дальше
  // треды приходят по одному из подписки, и задержка «по номеру в списке»
  // означала бы, что новое сообщение показывается спустя полсекунды.
  const firstMount = useRef(true);
  const mountedWithStagger = firstMount.current;
  firstMount.current = false;
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
    >
      <Animated.Text entering={FadeInDown.duration(420)} style={styles.header}>
        Сообщения
      </Animated.Text>

      {threads.length === 0 ? (
        <Animated.View entering={FadeIn.delay(120).duration(400)} style={styles.emptyWrap}>
          <EmptyScene kind="messages" />
          <Text style={styles.emptyTitle}>Пока нет сообщений</Text>
          <Text style={styles.emptySub}>
            Здесь появятся ответы мастера, когда вы создадите заявку
          </Text>
        </Animated.View>
      ) : (
        threads.map((thread, i) => {
          const last = thread.messages[thread.messages.length - 1];
          return (
            <Animated.View
              key={thread.id}
              entering={FadeInDown.delay(
                mountedWithStagger ? 120 + Math.min(i, 8) * STAGGER : 0,
              ).duration(340)}
              exiting={FadeOut.duration(180)}
              layout={LinearTransition.springify().damping(20).stiffness(170)}
            >
              <PressableScale style={styles.threadItem} onPress={() => onOpen(thread.id)}>
                <View style={styles.avatar}>
                  <Glyph
                    glyph={thread.icon}
                    size={24}
                    colors={themedIconColors(t)}
                    textStyle={styles.avatarIcon}
                  />
                </View>
                <View style={styles.threadBody}>
                  <View style={styles.threadTopRow}>
                    <Text style={styles.threadName}>{thread.name}</Text>
                    <Text style={styles.threadTime}>{last?.time}</Text>
                  </View>
                  {typingThreadId === thread.id ? (
                    <Text style={styles.threadTyping}>печатает…</Text>
                  ) : (
                    <Text style={styles.threadPreview} numberOfLines={1}>
                      {last?.from === 'user' ? 'Вы: ' : ''}
                      {last?.text || (last?.imageUrl ? 'Фото' : '')}
                    </Text>
                  )}
                </View>
                {thread.unread && <PulseDot style={styles.unreadDot} />}
              </PressableScale>
            </Animated.View>
          );
        })
      )}
    </ScrollView>
  );
}

function ThreadDetail({
  thread,
  typing,
  onBack,
  onSend,
  onSendImage,
  onReport,
}: {
  thread: Thread;
  typing: boolean;
  onBack: () => void;
  onSend: (text: string) => void;
  onSendImage: (localUri: string, caption: string) => Promise<void>;
  onReport?: (messageId: string, text: string) => Promise<boolean>;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  // Выбранное фото не уходит сразу: сначала предпросмотр у поля ввода,
  // отправка — той же кнопкой, что и текст. Случайный тап по галерее не
  // должен ничего отправлять.
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [sendingImage, setSendingImage] = useState(false);
  // Жалоба на сообщение собеседника: удержание пузыря раскрывает поле
  // причины над строкой ввода; отправленные помечаются под пузырём
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportText, setReportText] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const submitReport = async () => {
    const text = reportText.trim();
    if (!reportId || !onReport || !text || reportBusy) return;
    setReportBusy(true);
    const ok = await onReport(reportId, text);
    setReportBusy(false);
    if (ok) {
      setReportedIds((prev) => new Set(prev).add(reportId));
      setReportId(null);
      setReportText('');
    }
  };
  const scrollRef = useRef<ScrollView>(null);
  // Позиция прокрутки принадлежит пальцу: новое сообщение (и пузырь
  // «печатает…») уводит ленту вниз, только если человек и так был внизу,
  // а не выдёргивает его из чтения истории
  const atBottom = useRef(true);
  // Что уже было в переписке при открытии, появляется без анимации: экран и
  // так выезжает, а пузыри, проявляющиеся поверх, давали тряску. Анимируются
  // только сообщения, пришедшие позже.
  const openedAt = useRef(Date.now());
  const initialMessageIds = useRef(new Set(thread.messages.map((m) => m.id)));
  const settled = () => Date.now() - openedAt.current > CHAT_SETTLE_MS;

  const send = async () => {
    if (sendingImage) return;
    const trimmed = text.trim();
    if (pendingImage) {
      setSendingImage(true);
      try {
        // Текст из поля становится подписью — правила разрешают одно
        // сообщение с фото и текстом сразу
        await onSendImage(pendingImage, trimmed);
        setPendingImage(null);
        setText('');
        // Своё сообщение возвращает ленту вниз, даже если читали историю
        atBottom.current = true;
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      } finally {
        setSendingImage(false);
      }
      return;
    }
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    atBottom.current = true;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const attachImage = async () => {
    if (sendingImage) return;
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 }).catch(() => null);
    if (!result || result.canceled || !result.assets[0]) return;
    // Повторный выбор заменяет фото, а не шлёт два
    setPendingImage(result.assets[0].uri);
  };

  return (
    <KeyboardAvoidingView
      style={styles.detailRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.detailHeader, { paddingTop: insets.top + 12 }]}>
        <PressableScale
          style={styles.backChip}
          onPress={onBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backText}>‹ Назад</Text>
        </PressableScale>
        <View style={styles.detailTitleWrap}>
          <Glyph
            glyph={thread.icon}
            size={22}
            colors={themedIconColors(t)}
            textStyle={styles.detailAvatar}
          />
          <Text style={styles.detailName}>{thread.name}</Text>
        </View>
        <View style={styles.backChip_ghost} />
      </View>
      {/* Способ пожаловаться должен быть виден, а не угадываться */}
      {!!onReport && thread.messages.some((m) => m.from === 'master') && (
        <Text style={styles.reportHint}>Удерживайте сообщение мастера, чтобы пожаловаться</Text>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.messagesScroll}
        contentContainerStyle={styles.messagesContent}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          atBottom.current = contentOffset.y >= contentSize.height - layoutMeasurement.height - 40;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          // Пока экран открывается, к концу — прыжком; дальше — плавно
          if (atBottom.current) scrollRef.current?.scrollToEnd({ animated: settled() });
        }}
      >
        {thread.messages.map((m) => (
          <Animated.View
            key={m.id}
            entering={
              initialMessageIds.current.has(m.id)
                ? undefined
                : m.from === 'user'
                  ? FadeInRight.duration(260)
                  : FadeInDown.duration(260)
            }
            exiting={FadeOutLeft.duration(180)}
            style={[styles.bubbleWrap, m.from === 'user' && styles.bubbleWrapUser]}
          >
            <Pressable
              style={[styles.bubble, m.from === 'user' && styles.bubbleUser]}
              onLongPress={
                onReport && m.from === 'master'
                  ? () => {
                      setReportId(m.id);
                      setReportText('');
                    }
                  : undefined
              }
              delayLongPress={350}
            >
              {!!m.imageUrl && <Image source={{ uri: m.imageUrl }} style={styles.bubbleImage} />}
              {!!m.text && (
                <Text style={[styles.bubbleText, m.from === 'user' && styles.bubbleTextUser]}>
                  {m.text}
                </Text>
              )}
            </Pressable>
            <Text style={styles.bubbleTime}>
              {m.time}
              {reportedIds.has(m.id) ? ' · жалоба отправлена' : ''}
            </Text>
          </Animated.View>
        ))}

        {/* Собеседник печатает: пузырь с тремя «дышащими» точками */}
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

      {reportId && (
        <View style={styles.reportBox}>
          <Text style={styles.reportTitle}>Жалоба на сообщение</Text>
          <TextInput
            style={styles.reportInput}
            value={reportText}
            onChangeText={setReportText}
            placeholder="Что не так? Модерация прочитает переписку"
            placeholderTextColor={t.textMuted}
            multiline
            maxLength={1000}
            autoFocus
          />
          <View style={styles.reportRow}>
            <PressableScale
              style={[styles.reportBtn, (!reportText.trim() || reportBusy) && styles.reportBtnDim]}
              onPress={submitReport}
              disabled={!reportText.trim() || reportBusy}
            >
              <Text style={styles.reportBtnText}>{reportBusy ? 'Отправляем…' : 'Отправить'}</Text>
            </PressableScale>
            <PressableScale style={styles.reportGhost} onPress={() => setReportId(null)}>
              <Text style={styles.reportGhostText}>Отмена</Text>
            </PressableScale>
          </View>
        </View>
      )}

      {pendingImage && (
        <View style={styles.pendingRow}>
          <Image source={{ uri: pendingImage }} style={styles.pendingThumb} />
          <Text style={styles.pendingHint}>Фото готово к отправке — можно добавить подпись</Text>
          <PressableScale
            accessibilityLabel="Убрать фото"
            style={styles.pendingCancel}
            onPress={() => setPendingImage(null)}
            disabled={sendingImage}
            hitSlop={8}
          >
            <Text style={styles.pendingCancelText}>✕</Text>
          </PressableScale>
        </View>
      )}

      <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {thread.canAttach && !thread.closed && (
          <PressableScale
            accessibilityLabel="Прикрепить фото"
            style={[styles.attachBtn, sendingImage && styles.sendBtnDisabled]}
            onPress={attachImage}
            disabled={sendingImage}
          >
            <Glyph glyph="📎" size={16} colors={themedIconColors(t)} />
          </PressableScale>
        )}
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={
            thread.closed
              ? 'Переписка закрыта: сделки по заявке больше нет'
              : pendingImage
                ? 'Подпись к фото…'
                : 'Написать сообщение…'
          }
          placeholderTextColor={t.textMuted}
          style={styles.input}
          editable={!thread.closed}
          maxLength={2000}
          multiline
        />
        <PressableScale
          accessibilityLabel="Отправить"
          style={[
            styles.sendBtn,
            ((!text.trim() && !pendingImage) || thread.closed) && styles.sendBtnDisabled,
          ]}
          onPress={send}
          disabled={(!text.trim() && !pendingImage) || sendingImage || !!thread.closed}
        >
          <Text style={styles.sendIcon}>↑</Text>
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}

// Три точки, «дышащие» по очереди — классический индикатор набора текста
function TypingDots() {
  const { mode } = useTheme();
  const styles = themed[mode];
  const p = useSharedValue(0);
  // Цикл бесконечный, поэтому обрываем его руками: собеседник перестал печатать —
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
    root: { flex: 1, backgroundColor: t.bg },
    container: { flex: 1 },
    // Верхний отступ добавляется на месте — от системной зоны прибора
    content: { padding: 16, paddingBottom: 120 },
    header: { fontSize: 20, fontFamily: FONTS.display, marginBottom: 16, color: t.text },
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
      fontWeight: '400',
      fontSize: 11.5,
      marginTop: 4,
      textAlign: 'center',
      paddingHorizontal: 30,
    },
    threadItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.card,
      borderRadius: 16,
      padding: 12,
      marginBottom: 9,
      borderWidth: 1,
      borderColor: t.border,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.chip,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    avatarIcon: { fontSize: 20 },
    threadBody: { flex: 1 },
    threadTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    threadName: { fontWeight: '700', fontSize: 13.5, color: t.text },
    threadTime: { color: t.textMuted, fontSize: 10.5, fontWeight: '600' },
    threadPreview: { color: t.textSoft, fontSize: 12, marginTop: 2 },
    threadTyping: {
      color: t.accent,
      fontSize: 12,
      marginTop: 2,
      fontWeight: '700',
      fontStyle: 'italic',
    },
    typingRow: { flexDirection: 'row', gap: 4, paddingVertical: 3 },
    typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.textMuted },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.warn,
      marginLeft: 8,
    },
    detailRoot: { flex: 1, backgroundColor: t.bg },
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
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
    backChip_ghost: { width: 68 },
    backText: { fontWeight: '700', fontSize: 12.5, color: t.accent },
    detailTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    detailAvatar: { fontSize: 18 },
    detailName: { fontWeight: '800', fontSize: 14.5, color: t.text },
    messagesScroll: { flex: 1 },
    messagesContent: { padding: 16, paddingBottom: 24 },
    bubbleWrap: { marginBottom: 12, alignItems: 'flex-start', maxWidth: '78%' },
    bubbleWrapUser: { alignSelf: 'flex-end', alignItems: 'flex-end' },
    bubble: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderBottomLeftRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.border,
    },
    bubbleUser: {
      backgroundColor: t.accent,
      borderColor: t.accent,
      borderBottomLeftRadius: 18,
      borderBottomRightRadius: 6,
    },
    bubbleText: { fontSize: 13.5, color: t.text, lineHeight: 19 },
    bubbleTextUser: { color: t.onAccent },
    bubbleTime: {
      color: t.textMuted,
      fontSize: 10,
      fontWeight: '600',
      marginTop: 4,
      marginHorizontal: 4,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 16,
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
    // 44×44 — минимальная цель касания
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: { backgroundColor: t.disabled },
    sendIcon: { color: t.onAccent, fontSize: 17, fontWeight: '800' },
    attachBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pendingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 16,
      marginTop: 6,
      padding: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
    },
    pendingThumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: t.border },
    pendingHint: { flex: 1, fontSize: 12, color: t.textMuted },
    reportHint: {
      fontSize: 11.5,
      fontWeight: '600',
      color: t.textMuted,
      textAlign: 'center',
      paddingHorizontal: 16,
      paddingBottom: 6,
    },
    reportBox: {
      marginHorizontal: 12,
      marginBottom: 8,
      backgroundColor: t.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      padding: 12,
    },
    reportTitle: { fontSize: 12.5, fontWeight: '800', color: t.text, marginBottom: 8 },
    reportInput: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      backgroundColor: t.inputBg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 13,
      color: t.text,
      minHeight: 60,
      textAlignVertical: 'top',
    },
    reportRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    reportBtn: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: 'center',
      backgroundColor: t.danger,
    },
    reportBtnDim: { opacity: 0.5 },
    reportBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12.5 },
    reportGhost: {
      borderRadius: 12,
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
      alignItems: 'center',
    },
    reportGhostText: { color: t.textMuted, fontWeight: '800', fontSize: 12.5 },
    pendingCancel: { padding: 6 },
    pendingCancelText: { fontSize: 16, fontWeight: '800', color: t.textMuted },
    bubbleImage: {
      width: 200,
      height: 200,
      borderRadius: 10,
      marginVertical: 2,
      backgroundColor: t.border,
    },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
