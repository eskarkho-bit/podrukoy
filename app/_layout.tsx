import * as Notifications from 'expo-notifications';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReduceMotion, ReducedMotionConfig } from 'react-native-reanimated';
import { AppStateProvider, useAppState } from '../components/AppState';
import { AuthProvider, useAuth } from '../components/AuthState';
import { ConsentGate } from '../components/ConsentGate';
import { consentsCurrent } from '../components/legal';
import { NoticeBanner } from '../components/NoticeBanner';
import { AdminScreen } from '../screens/AdminScreen';
import { MasterScreen } from '../screens/MasterScreen';
import { SplashScreen } from '../components/SplashScreen';
import { useTheme } from '../theme';

// Роуты, доступные без входа (кроме самого экрана входа). Новый публичный
// роут — это одна строка здесь, а не новая ветка в условии редиректа.
// Сейчас это только dev-витрина /demo: она живёт на подставных данных,
// базу не трогает, а в прод-сборке сама уводит на вход.
const PUBLIC_SEGMENTS = new Set(['demo']);

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppStateProvider>
        <RootShell />
      </AppStateProvider>
    </AuthProvider>
  );
}

// Оболочка живёт внутри провайдеров — только так она видит тему, сессию и режим мастера
function RootShell() {
  const { mode, colors } = useTheme();
  const { user, initializing } = useAuth();
  const {
    masterOpen,
    setMasterOpen,
    isAdmin,
    adminOpen,
    setAdminOpen,
    notice,
    dismissNotice,
    consents,
    acceptConsents,
    logout,
  } = useAppState();
  // Профиль ещё грузится, пока consents === null: показывать в этот момент
  // требование принять документы значит мигать им у тех, кто их уже принял
  const needsConsent = !!user && consents !== null && !consentsCurrent(consents);
  const segments = useSegments();
  // Заставка запуска. Показывается один раз за холодный старт и накрывает
  // момент, когда сессия ещё определяется и роутер решает, вход или главная.
  const [splashDone, setSplashDone] = useState(false);

  // Без сессии данные всё равно не сохранить — правила Firestore требуют
  // авторизации. Поэтому неавторизованного уводим на вход, а вошедшего — с него.
  useEffect(() => {
    if (initializing) return;
    const onLogin = segments[0] === 'login';
    const isPublic = onLogin || PUBLIC_SEGMENTS.has(segments[0] ?? '');
    if (!user && !isPublic) router.replace('/login');
    else if (user && onLogin) router.replace('/');
  }, [user, initializing, segments]);

  // Нажатие на уведомление ведёт на нужный экран. Без роутера этого нельзя
  // было сделать в принципе — вкладка жила в useState и адреса не имела.
  const coldStartHandled = useRef(false);
  useEffect(() => {
    if (!user) return;

    const go = (response: Notifications.NotificationResponse | null) => {
      const href = response?.notification.request.content.data?.href;
      if (typeof href === 'string') router.navigate(href as never);
    };

    // приложение открыли нажатием на уведомление из закрытого состояния
    if (!coldStartHandled.current) {
      coldStartHandled.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then(go)
        .catch(() => {});
    }

    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [user]);

  return (
    // Корень жестов нужен всему, что тянут пальцем, — сейчас это нижние шторки
    <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />

      {/* Уважаем системное «уменьшение движения»: тогда анимации не
          проигрываются, а сразу показывают результат. Настройка общая на все
          анимации Reanimated, поэтому стоит один раз в корне. */}
      <ReducedMotionConfig mode={ReduceMotion.System} />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />

      {/* Режим мастера — оверлей поверх всего приложения. Он намеренно остаётся
          смонтированным: иначе сессия мастера и его заявки сбрасывались бы при
          каждом выходе в профиль. */}
      {user && <MasterScreen open={masterOpen} onClose={() => setMasterOpen(false)} />}

      {/* Модерация — такой же оверлей. Монтируется только у модераторов:
          у остальных правила всё равно не дадут прочитать очередь. */}
      {user && isAdmin && <AdminScreen open={adminOpen} onClose={() => setAdminOpen(false)} />}

      {/* Поверх всего, кроме сообщения о сбое: без действующего согласия
          пользоваться сервисом нельзя вообще */}
      {needsConsent && <ConsentGate onAccept={acceptConsents} onLogout={logout} />}

      {/* Заставка — поверх экранов и оверлеев: раскрытие в конце должно
          открывать то, что человек реально увидит. Готовность = сессия
          определена, роутер уже увёл на вход либо на главную. */}
      {!splashDone && <SplashScreen ready={!initializing} onDone={() => setSplashDone(true)} />}

      {/* Поверх всего, включая режим мастера: сбой важнее того, что открыто */}
      {notice && <NoticeBanner text={notice} onDismiss={dismissNotice} />}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
