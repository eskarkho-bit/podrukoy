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
import { STAGGER } from '../motion';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from '../components/PressableScale';

export type ChatMessage = { id: string; from: 'user' | 'master'; text: string; time: string };
export type Thread = { id: string; name: string; icon: string; unread: boolean; messages: ChatMessage[] };

type Props = {
  threads: Thread[];
  // В каком чате собеседник сейчас «печатает»
  typingThreadId: string | null;
  // Просьба другого экрана открыть конкретный чат
  openRequestId: string | null;
  onOpenRequestHandled: () => void;
  onOpenThread: (threadId: string) => void;
  onSendMessage: (threadId: string, text: string) => void;
  // Открытая переписка — это «вложенный» экран, поэтому нижние вкладки на время прячутся
  onThreadOpenChange: (open: boolean) => void;
};

export function MessagesScreen({
  threads, typingThreadId, openRequestId, onOpenRequestHandled,
  onOpenThread, onSendMessage, onThreadOpenChange,
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

  // Другой экран попросил открыть чат (профиль → поддержка, заказ → мастер)
  useEffect(() => {
    if (openRequestId) {
      handleOpen(openRequestId);
      onOpenRequestHandled();
    }
  }, [openRequestId]);

  return (
    <View style={styles.root}>
      <ThreadList threads={threads} typingThreadId={typingThreadId} onOpen={handleOpen} />

      {openThread && (
        <Animated.View
          entering={SlideInRight.springify().damping(20).stiffness(160)}
          exiting={SlideOutRight.duration(280)}
          style={StyleSheet.absoluteFill}
        >
          <ThreadDetail
            thread={openThread}
            typing={typingThreadId === openThread.id}
            onBack={handleBack}
            onSend={(text) => onSendMessage(openThread.id, text)}
          />
        </Animated.View>
      )}
    </View>
  );
}

function ThreadList({
  threads, typingThreadId, onOpen,
}: {
  threads: Thread[]; typingThreadId: string | null; onOpen: (id: string) => void;
}) {
  const { mode } = useTheme();
  const styles = themed[mode];
  // Стаггер — это представление списка при первом появлении экрана. Дальше
  // треды приходят по одному из подписки, и задержка «по номеру в списке»
  // означала бы, что новое сообщение показывается спустя полсекунды.
  const firstMount = useRef(true);
  const mountedWithStagger = firstMount.current;
  firstMount.current = false;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Animated.Text entering={FadeInDown.duration(420)} style={styles.header}>
        Сообщения
      </Animated.Text>

      {threads.length === 0 ? (
        <Animated.View entering={FadeIn.delay(120).duration(400)} style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>Пока нет сообщений</Text>
          <Text style={styles.emptySub}>Здесь появятся ответы мастера, когда вы создадите заявку</Text>
        </Animated.View>
      ) : (
        threads.map((thread, i) => {
          const last = thread.messages[thread.messages.length - 1];
          return (
            <Animated.View
              key={thread.id}
              entering={FadeInDown.delay(mountedWithStagger ? 120 + i * STAGGER : 0).duration(340)}
              exiting={FadeOut.duration(180)}
              layout={LinearTransition.springify().damping(20).stiffness(170)}
            >
              <PressableScale style={styles.threadItem} onPress={() => onOpen(thread.id)}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarIcon}>{thread.icon}</Text>
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
                      {last?.text}
                    </Text>
                  )}
                </View>
                {thread.unread && <View style={styles.unreadDot} />}
              </PressableScale>
            </Animated.View>
          );
        })
      )}
    </ScrollView>
  );
}

function ThreadDetail({
  thread, typing, onBack, onSend,
}: {
  thread: Thread; typing: boolean; onBack: () => void; onSend: (text: string) => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [text, setText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <KeyboardAvoidingView
      style={styles.detailRoot}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.detailHeader}>
        <PressableScale style={styles.backChip} onPress={onBack}>
          <Text style={styles.backText}>‹  Назад</Text>
        </PressableScale>
        <View style={styles.detailTitleWrap}>
          <Text style={styles.detailAvatar}>{thread.icon}</Text>
          <Text style={styles.detailName}>{thread.name}</Text>
        </View>
        <View style={styles.backChip_ghost} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messagesScroll}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {thread.messages.map((m) => (
          <Animated.View
            key={m.id}
            entering={m.from === 'user' ? FadeInRight.duration(260) : FadeInDown.duration(260)}
            exiting={FadeOutLeft.duration(180)}
            style={[styles.bubbleWrap, m.from === 'user' && styles.bubbleWrapUser]}
          >
            <View style={[styles.bubble, m.from === 'user' && styles.bubbleUser]}>
              <Text style={[styles.bubbleText, m.from === 'user' && styles.bubbleTextUser]}>
                {m.text}
              </Text>
            </View>
            <Text style={styles.bubbleTime}>{m.time}</Text>
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

      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Написать сообщение…"
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
      withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.sin) }), -1, false,
    );
    return () => cancelAnimation(p);
  }, [reduceMotion]);

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
  root: { flex: 1, backgroundColor: t.bg },
  container: { flex: 1 },
  content: { padding: 16, paddingTop: 60, paddingBottom: 120 },
  header: { fontSize: 20, fontWeight: '800', marginBottom: 16, color: t.text },
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
  threadTyping: { color: t.accent, fontSize: 12, marginTop: 2, fontWeight: '700', fontStyle: 'italic' },
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
  bubbleTime: { color: t.textMuted, fontSize: 10, fontWeight: '600', marginTop: 4, marginHorizontal: 4 },
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
