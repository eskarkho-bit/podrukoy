// Единая система движения приложения.
// Все анимации берут параметры отсюда, чтобы интерфейс двигался «одним характером»:
// спокойно, с весом, без резких скачков.
import { Easing } from 'react-native-reanimated';

// Пружины: duration — общая длительность, dampingRatio — «гашение»
// (ближе к 1 — без перелёта, меньше — лёгкий упругий перелёт).
export const springs = {
  // Микро-отклики: нажатия, выделения
  micro: { duration: 180, dampingRatio: 0.9 },
  // Карточки, переключатели
  card: { duration: 320, dampingRatio: 0.85 },
  // Нижняя шторка — с едва заметным перелётом
  sheet: { duration: 480, dampingRatio: 0.78 },
  // Движение «камеры» по сцене дома
  nav: { duration: 620, dampingRatio: 0.88 },
  // Крупные «киношные» переходы: подъём крыши, вход в дом
  hero: { duration: 820, dampingRatio: 0.92 },
} as const;

export const timings = {
  micro: { duration: 150, easing: Easing.out(Easing.quad) },
  fade: { duration: 260, easing: Easing.inOut(Easing.quad) },
} as const;

// Пауза между элементами списка (stagger), мс
export const STAGGER = 55;
