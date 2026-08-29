import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Тактильный отклик на ключевые действия.
//
// Ровно четыре события: отправка заявки, выбор мастера, подтверждение работы
// и отзыв. Больше не нужно: вибрация на каждое касание перестаёт быть
// событием. В вебе хаптики нет — тихо пропускаем, ошибка отклика не должна
// ломать само действие.

export function hapticSuccess() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function hapticImpact() {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}
