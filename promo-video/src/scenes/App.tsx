// Сцена 4: телефон с настоящими экранами приложения. Главный → создание
// заявки → предложения мастеров; предложения прилетают пуш-плашками.
import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { displayFont } from '../fonts';
import { theme } from '../theme';
import { SceneExit, WordReveal } from '../components/ui';

const PHONE_W = 560;
const PHONE_H = 1214;
const PHONE_TOP = 240;

const SCREENS = [
  { src: 'screens/01-home.png', from: 0, to: 62 },
  { src: 'screens/08-create.png', from: 62, to: 124 },
  { src: 'screens/02-offers.png', from: 124, to: 225 },
];

const OFFERS = [
  { name: 'Адам', price: '3 100 ₽', at: 134 },
  { name: 'Магомед', price: '4 200 ₽', at: 144 },
  { name: 'Ахмед', price: '5 500 ₽', at: 154 },
];

export const AppScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

  const phoneIn = spring({ frame: frame - 4, fps, config: theme.spring.smooth });
  const float = Math.sin(frame / 30) * 5;

  return (
    <SceneExit>
      <AbsoluteFill style={{ background: theme.colors.bg }}>
        {/* Мягкие пятна фона — свет вместо плоской заливки */}
        <div
          style={{
            position: 'absolute',
            width: 1100,
            height: 1100,
            borderRadius: '50%',
            top: -380 + Math.sin(frame / 55) * 40,
            left: -260,
            filter: 'blur(60px)',
            background: `radial-gradient(circle, ${theme.colors.hero}22, transparent 62%)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: 900,
            height: 900,
            borderRadius: '50%',
            bottom: -360,
            right: -240 - Math.cos(frame / 70) * 36,
            filter: 'blur(70px)',
            background: `radial-gradient(circle, ${theme.colors.dawn}1c, transparent 65%)`,
          }}
        />

        {/* Телефон */}
        <div
          style={{
            position: 'absolute',
            left: (1080 - PHONE_W) / 2,
            top: PHONE_TOP,
            width: PHONE_W,
            height: PHONE_H,
            opacity: phoneIn,
            transform: `translateY(${interpolate(phoneIn, [0, 1], [80, 0]) + float}px) scale(${interpolate(phoneIn, [0, 1], [0.94, 1])})`,
            borderRadius: 64,
            padding: 14,
            background: theme.colors.ink,
            boxShadow: '0 60px 120px -30px rgba(20, 30, 16, 0.45)',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 50,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {SCREENS.map((s, i) => {
              // Экраны сменяются подъездом снизу; каждый живёт с кен-бёрнсом
              const enter =
                i === 0 ? 1 : spring({ frame: frame - s.from, fps, config: theme.spring.smooth });
              const kb = interpolate(frame, [s.from, s.to], [1, 1.06], {
                easing: theme.ease.inOut,
                ...clamp,
              });
              if (frame < s.from - 4) return null;
              return (
                <div
                  key={s.src}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: enter,
                    transform: `translateY(${interpolate(enter, [0, 1], [120, 0])}px)`,
                  }}
                >
                  <Img
                    src={staticFile(s.src)}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'top',
                      transform: `scale(${kb})`,
                      transformOrigin: '50% 20%',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Пуш-плашки предложений — прилетают одна за другой */}
        {OFFERS.map((o, i) => {
          const p = spring({ frame: frame - o.at, fps, config: theme.spring.snappy });
          if (frame < o.at - 2) return null;
          return (
            <div
              key={o.name}
              style={{
                position: 'absolute',
                left: 110,
                top: 330 + i * 118,
                width: 860,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [-46, 0])}px) scale(${interpolate(p, [0, 1], [0.92, 1])})`,
                background: theme.colors.card,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: 28,
                padding: '22px 30px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 24px 48px -18px rgba(20, 30, 16, 0.28)',
                fontFamily: displayFont,
              }}
            >
              <span style={{ fontSize: 32, fontWeight: 600, color: theme.colors.ink }}>
                {o.name} · новое предложение
              </span>
              <span style={{ fontSize: 36, fontWeight: 800, color: theme.colors.hero }}>
                {o.price}
              </span>
            </div>
          );
        })}

        <div
          style={{
            position: 'absolute',
            left: 90,
            right: 90,
            top: 1560,
            fontFamily: displayFont,
            fontWeight: 700,
            fontSize: 54,
            lineHeight: 1.14,
            letterSpacing: '-0.02em',
            color: theme.colors.ink,
            textAlign: 'center',
          }}
        >
          <WordReveal text="Вы знаете, кто придёт в дом" delay={140} per={4} />
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};
