// Единая система движения приложения.
// Все анимации берут параметры отсюда, чтобы интерфейс двигался «одним характером»:
// спокойно, с весом, без резких скачков.
import { Easing } from 'react-native-reanimated';

// Пружины: duration — общая длительность, dampingRatio — «гашение»
// (ближе к 1 — без перелёта, меньше — лёгкий упругий перелёт).
export const springs = {
  // Микро-отклики: нажатия, выделения
  micro: { duration: 180, dampingRatio: 0.9 },
  // Отпущенная кнопка: недодемпфированная пружина сама даёт лёгкий перелёт —
  // вместо расписанной последовательности «вверх, потом сесть»
  pop: { duration: 300, dampingRatio: 0.5 },
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
  // Вложенный экран (переписка, карточка заявки у мастера, разделы
  // модерации) выезжает справа и уезжает обратно. Не пружина, а кривая без
  // перелёта: недодемпфированная пружина на входе проскакивала край и
  // возвращалась — вместе с проявляющимися пузырями чата это читалось как
  // тряска, особенно на слабых устройствах и эмуляторах.
  slideIn: { duration: 320, easing: Easing.out(Easing.cubic) },
  slideOut: { duration: 240, easing: Easing.in(Easing.cubic) },
} as const;

// Сколько после открытия чата лента «устраивается» молча: первый прокрут к
// последнему сообщению — прыжком, а не анимацией, иначе лента едет вниз
// одновременно с выездом экрана
export const CHAT_SETTLE_MS = 600;

// Пауза между элементами списка (stagger), мс
export const STAGGER = 55;

// Куда «долетел» бы жест, отпусти его свободно: проекция импульса той же
// экспоненциальной формулой, что у инерции скролла. Отпуская палец, решение
// «закрыть или вернуть» принимают по этой точке и по знаку скорости,
// а не по тому, где палец случайно остановился.
export function projectMomentum(velocity: number, decelerationRate = 0.998) {
  'worklet';
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// Сопротивление за границей: чем дальше тянут, тем меньше следует элемент.
// Жёсткий стоп читается как «зависло», нарастающее сопротивление — как
// «живое, но дальше ничего нет».
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  'worklet';
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
