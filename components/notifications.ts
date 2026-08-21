import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Уведомления сервиса заказов. Все события присылает сервер (Cloud Functions
// в functions/) — локальных уведомлений не осталось: последним был поддельный
// ответ поддержки, теперь и она отвечает по-настоящему.
// Удалённые пуши требуют dev build: в Expo Go на Android их нет начиная с SDK 53.

// Показываем баннер даже когда приложение открыто: смена статуса заявки —
// это то, ради чего человек и держит приложение
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const CHANNEL_ID = 'default';

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  // На Android 8+ без канала уведомления не показываются, а его создание
  // должно предшествовать запросу токена
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Заявки и сообщения',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
  });
}

/** Запрашивает разрешение. Возвращает true, если уведомления можно показывать. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await ensureAndroidChannel();

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;

  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Токен для удалённых пушей. Возвращает null во всех случаях, когда его
 * получить нельзя, — это не ошибка, а нормальная работа на вебе, в симуляторе
 * или до настройки EAS.
 */
export async function getPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  // На симуляторе токен не выдаётся в принципе
  if (!Device.isDevice) return null;

  if (!(await ensureNotificationPermission())) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (!projectId) {
    // Проект ещё не заведён в EAS — до этого удалённые пуши невозможны,
    // но локальные уведомления работают и без него
    console.warn('Нет EAS projectId: удалённые пуши недоступны, локальные работают');
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (e) {
    console.warn('Не удалось получить push-токен:', e);
    return null;
  }
}
