// Единый источник правды: цвета, кривые, пружины. В компонентах ничего
// не инлайнится — иначе палитра расползается и ролик теряет цельность.
import { Easing } from 'remotion';

export const theme = {
  colors: {
    // Светлый мир приложения — прямо из theme.ts самого domio
    bg: '#F2F5F0',
    card: '#FFFFFF',
    ink: '#2E3A2A',
    inkSoft: '#7A857A',
    border: '#E6E9E1',
    // Герой — фирменный зелёный. Не больше одного зелёного акцента в кадре.
    hero: '#5E7A56',
    glow: 'rgba(94, 122, 86, 0.4)',
    // Мир гор на рассвете (сцены 1–2)
    night: '#141A12',
    nightAlt: '#1E2619',
    ridgeFar: '#2A3424',
    ridgeMid: '#202A1B',
    ridgeNear: '#161D12',
    dawn: '#E8B44C',
    dawnSoft: '#F4E0B0',
    fog: 'rgba(244, 224, 176, 0.14)',
  },
  ease: {
    out: Easing.bezier(0.16, 1, 0.3, 1),
    inOut: Easing.bezier(0.83, 0, 0.17, 1),
    in: Easing.bezier(0.7, 0, 0.84, 0),
  },
  spring: {
    snappy: { damping: 14, stiffness: 160, mass: 0.6 },
    smooth: { damping: 20, stiffness: 90, mass: 1 },
    bouncy: { damping: 11, stiffness: 170, mass: 0.7 },
  },
} as const;
