import * as Notifications from 'expo-notifications';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';
import { AppStateProvider, useAppState } from '../components/AppState';
import { AuthProvider, useAuth } from '../components/AuthState';
import { MasterScreen } from '../screens/MasterScreen';
import { useTheme } from '../theme';

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
  const { masterOpen, setMasterOpen } = useAppState();
  const segments = useSegments();

  // Без сессии данные всё равно не сохранить — правила Firestore требуют
  // авторизации. Поэтому неавторизованного уводим на вход, а вошедшего — с него.
  useEffect(() => {
    if (initializing) return;
    const onLogin = segments[0] === 'login';
    if (!user && !onLogin) router.replace('/login');
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
      Notifications.getLastNotificationResponseAsync().then(go).catch(() => {});
    }

    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [user]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
