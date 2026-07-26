// Темы приложения. Светлая — исходная палитра, тёмная — те же роли цветов
// в «ночном» исполнении. Компоненты берут цвета по роли (t.card, t.text),
// поэтому обе темы живут в одном и том же коде стилей.
import { createContext, useContext } from 'react';

export type ThemeMode = 'light' | 'dark';

const light = {
  bg: '#F2F5F0',           // фон экранов
  card: '#FFFFFF',         // карточки, кнопки-«чипы», пузыри
  border: '#E6E9E1',       // рамки карточек
  divider: '#EFF1EA',      // разделители внутри карточек
  text: '#2E3A2A',         // основной текст
  textSoft: '#7A857A',     // вторичный текст
  textMuted: '#A6AFA1',    // подписи, плейсхолдеры
  accent: '#5E7A56',       // фирменный зелёный: кнопки, ссылки
  accentStrong: '#42593C', // выбранный таб, акцентный текст
  accentSoft: '#E3ECDE',   // подсветка-пилюля, мягкие плашки
  accentBorder: '#CBDCC5', // рамки акцентных карточек
  accentFaint: '#F4F8F1',  // едва зелёный фон («цена принята»)
  onAccent: '#FFFFFF',     // текст на акцентных кнопках
  chip: '#F2F5F0',         // кружки-иконки на карточках
  soft: '#F6FAF3',         // мягкие подложки (комментарий, фото-кнопки)
  inputBg: '#FBFCFA',      // поля ввода
  inputBorder: '#CBD6C5',
  disabled: '#C7D0C3',     // выключенные кнопки
  toggleOff: '#E3E3DC',    // выключенный тумблер, «ручка» шторки
  warn: '#C08A2D',         // ожидание, непрочитанное
  blue: '#6B84B8',         // «в работе», «ждём клиента»
  danger: '#B8564F',       // отмена, выход
  shadow: '#1F2B1C',
  dim: 'rgba(30, 38, 28, 0.18)',     // затемнение под шторками
  overlay: 'rgba(30, 38, 28, 0.55)', // кнопки поверх фото
};

export type Palette = typeof light;

const dark: Palette = {
  bg: '#141A13',
  card: '#1E251D',
  border: '#2E372B',
  divider: '#283126',
  text: '#E6ECE1',
  textSoft: '#A3AF9C',
  textMuted: '#78846F',
  accent: '#8FAF83',
  accentStrong: '#B4CCA8',
  accentSoft: '#2B3827',
  accentBorder: '#3D5136',
  accentFaint: '#232E20',
  onAccent: '#131B10',
  chip: '#293226',
  soft: '#212A1F',
  inputBg: '#181F16',
  inputBorder: '#3C4837',
  disabled: '#394435',
  toggleOff: '#394435',
  warn: '#D9A44E',
  blue: '#8FA7D1',
  danger: '#D57A70',
  shadow: '#000000',
  dim: 'rgba(0, 0, 0, 0.5)',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const palettes: Record<ThemeMode, Palette> = { light, dark };

type ThemeValue = {
  mode: ThemeMode;
  colors: Palette;
  setMode: (mode: ThemeMode) => void;
};

export const ThemeContext = createContext<ThemeValue>({
  mode: 'light',
  colors: light,
  setMode: () => {},
});

export const useTheme = () => useContext(ThemeContext);
