// Композиция «Цена» — вирусный формат для Instagram: шок-цифра в первые
// две секунды, падающие цены, счётчик экономии. 22 секунды, 660 кадров.
//
// Драматургия: 8 000 ₽ (хук) → «не соглашайтесь» → предложения падают
// 5 500 → 4 200 → 3 100 → экономия 4 900 ₽ (кульминация) → доверие →
// оплата после приёмки → логотип.
import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { displayFont } from './fonts';
import { theme } from './theme';
import { Tower } from './components/Tower';
import { Grade, Grain, SceneExit, Vignette, WordReveal } from './components/ui';

// Красный — только для «чужой» цены в хуке; герой ролика остаётся зелёным
const DANGER = '#C24444';

// Сцены раздвинуты под темп закадрового голоса
const T = {
  hook: { from: 0, len: 90 },
  advice: { from: 90, len: 105 },
  offers: { from: 195, len: 180 },
  savings: { from: 375, len: 105 },
  trust: { from: 480, len: 120 },
  payment: { from: 600, len: 90 },
  logo: { from: 690, len: 135 },
} as const;

export const TSENA_FRAMES = 825;

// Фразы озвучки: кадр старта и длительность (по ffprobe), для даккинга
const VO: [string, number, number][] = [
  ['t1', 6, 89],
  ['t2', 96, 90],
  ['t3', 204, 176],
  ['t4', 384, 124],
  ['t5', 492, 134],
  ['t6', 618, 96],
  ['t7', 708, 117],
];

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// ---------- Сцена 1: шок-цифра ----------
const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slam = spring({ frame: frame - 2, fps, config: theme.spring.bouncy });
  // Тряска камеры после удара, затухает
  const shake = Math.sin(frame * 2.7) * 14 * Math.max(0, 1 - (frame - 4) / 10);
  const strike = interpolate(frame, [40, 50], [0, 1], { easing: theme.ease.out, ...clamp });

  return (
    <SceneExit>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 35%, ${theme.colors.nightAlt} 0%, ${theme.colors.night} 75%)`,
          transform: `translate(${shake}px, ${shake * 0.6}px)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 640,
            textAlign: 'center',
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 230,
            letterSpacing: '-0.03em',
            color: '#FFFFFF',
            opacity: slam,
            transform: `scale(${interpolate(slam, [0, 1], [2.4, 1])})`,
          }}
        >
          8 000 ₽{/* Красное перечёркивание — приговор чужой цене */}
          <div
            style={{
              position: 'absolute',
              left: 120,
              top: 150,
              width: 840 * strike,
              height: 18,
              background: DANGER,
              borderRadius: 12,
              transform: 'rotate(-7deg)',
              boxShadow: `0 0 40px ${DANGER}88`,
            }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 90,
            right: 90,
            top: 960,
            fontFamily: displayFont,
            fontWeight: 600,
            fontSize: 54,
            lineHeight: 1.2,
            color: theme.colors.dawnSoft,
          }}
        >
          <WordReveal text="столько запросили за замену смесителя" delay={14} per={3} />
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};

// ---------- Сцена 2: совет ----------
const Advice: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Зелёная плашка подчёркивает слово «первую» после его появления
  const pill = spring({ frame: frame - 26, fps, config: theme.spring.snappy });
  return (
    <SceneExit>
      <AbsoluteFill style={{ background: theme.colors.bg }}>
        <div
          style={{
            position: 'absolute',
            left: 60,
            right: 60,
            top: 740,
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 88,
            lineHeight: 1.16,
            letterSpacing: '-0.02em',
            color: theme.colors.ink,
            textAlign: 'center',
          }}
        >
          <WordReveal text="Не соглашайтесь" delay={4} per={3} />
          <div
            style={{
              position: 'relative',
              display: 'flex',
              justifyContent: 'center',
              marginTop: 10,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '55%',
                top: 4,
                width: 620 * pill,
                height: 112,
                transform: 'translateX(-50%) rotate(-1.5deg)',
                background: `${theme.colors.hero}33`,
                borderRadius: 24,
              }}
            />
            <WordReveal text="на первую цену" delay={14} per={3} />
          </div>
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};

// ---------- Сцена 3: предложения падают ----------
const OFFERS = [
  { name: 'Ахмед', price: '5 500 ₽', at: 60, hero: false },
  { name: 'Магомед', price: '4 200 ₽', at: 78, hero: false },
  { name: 'Адам', price: '3 100 ₽', at: 96, hero: true },
];

const Offers: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phoneIn = spring({ frame: frame - 2, fps, config: theme.spring.smooth });
  const kb = interpolate(frame, [0, 180], [1, 1.05], { easing: theme.ease.inOut, ...clamp });

  return (
    <SceneExit>
      <AbsoluteFill style={{ background: theme.colors.bg }}>
        <div
          style={{
            position: 'absolute',
            left: (1080 - 620) / 2,
            top: 340,
            width: 620,
            height: 1280,
            opacity: phoneIn,
            transform: `translateY(${interpolate(phoneIn, [0, 1], [160, 0])}px)`,
            borderRadius: 68,
            padding: 14,
            background: theme.colors.ink,
            boxShadow: '0 60px 120px -30px rgba(20, 30, 16, 0.45)',
          }}
        >
          <div style={{ width: '100%', height: '100%', borderRadius: 54, overflow: 'hidden' }}>
            <Img
              src={staticFile('screens/02-offers.png')}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top',
                transform: `scale(${kb})`,
                transformOrigin: '50% 15%',
              }}
            />
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: 60,
            right: 60,
            top: 170,
            fontFamily: displayFont,
            fontWeight: 700,
            fontSize: 54,
            color: theme.colors.ink,
            textAlign: 'center',
          }}
        >
          <WordReveal text="Мастера прислали свои цены" delay={16} per={3} />
        </div>

        {OFFERS.map((o, i) => {
          const p = spring({ frame: frame - o.at, fps, config: theme.spring.snappy });
          if (frame < o.at - 2) return null;
          return (
            <div
              key={o.name}
              style={{
                position: 'absolute',
                left: 110,
                top: 560 + i * 150,
                width: 860,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [-52, 0])}px) scale(${interpolate(p, [0, 1], [0.9, o.hero ? 1.04 : 1])})`,
                background: theme.colors.card,
                border: `2px solid ${o.hero ? theme.colors.hero : theme.colors.border}`,
                borderRadius: 32,
                padding: '28px 36px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: o.hero
                  ? `0 0 60px ${theme.colors.glow}, 0 28px 56px -20px rgba(20,30,16,0.3)`
                  : '0 24px 48px -18px rgba(20, 30, 16, 0.25)',
                fontFamily: displayFont,
              }}
            >
              <span style={{ fontSize: 42, fontWeight: 600, color: theme.colors.ink }}>
                {o.name}
              </span>
              <span
                style={{
                  fontSize: 52,
                  fontWeight: 800,
                  color: o.hero ? theme.colors.hero : theme.colors.inkSoft,
                }}
              >
                {o.price}
              </span>
            </div>
          );
        })}
      </AbsoluteFill>
    </SceneExit>
  );
};

// ---------- Сцена 4: счётчик экономии ----------
const Savings: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - 6, fps, config: { damping: 30, stiffness: 60, mass: 1 } });
  const value = Math.round(interpolate(p, [0, 1], [0, 4900]) / 100) * 100;
  const pulse = interpolate(frame, [40, 84], [0, 1], { easing: theme.ease.out, ...clamp });
  const breathe = 1 + Math.sin(frame / 22) * 0.01;

  return (
    <SceneExit>
      <AbsoluteFill style={{ background: theme.colors.bg }}>
        <div
          style={{
            position: 'absolute',
            left: 540 - 400 - pulse * 240,
            top: 830 - 400 - pulse * 240,
            width: 800 + pulse * 480,
            height: 800 + pulse * 480,
            borderRadius: '50%',
            border: `3px solid ${theme.colors.hero}`,
            opacity: (1 - pulse) * 0.4,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 560,
            textAlign: 'center',
            fontFamily: displayFont,
            fontWeight: 600,
            fontSize: 56,
            color: theme.colors.inkSoft,
          }}
        >
          <WordReveal text="Экономия" delay={2} per={3} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 680,
            textAlign: 'center',
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 210,
            letterSpacing: '-0.03em',
            color: theme.colors.hero,
            fontVariantNumeric: 'tabular-nums',
            transform: `scale(${breathe})`,
            textShadow: `0 0 60px ${theme.colors.glow}`,
          }}
        >
          {value.toLocaleString('ru-RU').replace(/ /g, ' ')} ₽
        </div>
        <div
          style={{
            position: 'absolute',
            left: 90,
            right: 90,
            top: 980,
            textAlign: 'center',
            fontFamily: displayFont,
            fontWeight: 600,
            fontSize: 48,
            color: theme.colors.ink,
          }}
        >
          <WordReveal text="просто потому, что цены конкурируют" delay={34} per={3} />
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};

// ---------- Сцена 5: доверие ----------
const Trust: React.FC = () => {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 120], [1.12, 1.02], { easing: theme.ease.inOut, ...clamp });
  return (
    <SceneExit>
      <AbsoluteFill style={{ background: theme.colors.night }}>
        <Img
          src={staticFile('screens/02-offers.png')}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: '50% 30%',
            transform: `scale(${kb})`,
            opacity: 0.9,
          }}
        />
        <AbsoluteFill
          style={{
            background:
              'linear-gradient(180deg, transparent 40%, rgba(15, 20, 12, 0.88) 72%, rgba(15, 20, 12, 0.96) 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 90,
            right: 90,
            top: 1420,
            fontFamily: displayFont,
            fontWeight: 700,
            fontSize: 62,
            lineHeight: 1.16,
            color: '#FFFFFF',
          }}
        >
          <WordReveal text="Имя, стаж и рейтинг — вы знаете, кто придёт в дом" delay={8} per={3} />
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};

// ---------- Сцена 6: оплата после приёмки ----------
const Payment: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const circleIn = spring({ frame: frame - 2, fps, config: theme.spring.bouncy });
  const stroke = interpolate(frame, [10, 28], [168, 0], { easing: theme.ease.out, ...clamp });
  return (
    <SceneExit>
      <AbsoluteFill style={{ background: theme.colors.bg }}>
        <div
          style={{
            position: 'absolute',
            left: 540 - 150,
            top: 620 - 150,
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: theme.colors.hero,
            boxShadow: `0 0 60px ${theme.colors.glow}`,
            opacity: circleIn,
            transform: `scale(${interpolate(circleIn, [0, 1], [0.5, 1])})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width={170} height={170} viewBox="0 0 100 100">
            <path
              d="M 22 52 L 43 73 L 80 30"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={11}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={168}
              strokeDashoffset={stroke}
            />
          </svg>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 90,
            right: 90,
            top: 900,
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 88,
            lineHeight: 1.12,
            color: theme.colors.ink,
            textAlign: 'center',
          }}
        >
          <WordReveal text="Оплата — после приёмки работы" delay={14} per={3} />
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};

// ---------- Сцена 7: логотип ----------
const Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const towerIn = spring({ frame: frame - 2, fps, config: theme.spring.bouncy });
  const titleIn = spring({ frame: frame - 12, fps, config: theme.spring.smooth });
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames - 2], [1, 0], {
    easing: theme.ease.in,
    ...clamp,
  });
  return (
    <AbsoluteFill style={{ background: theme.colors.bg, opacity: out }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 560,
          display: 'flex',
          justifyContent: 'center',
          opacity: towerIn,
          transform: `scale(${interpolate(towerIn, [0, 1], [0.7, 1])})`,
        }}
      >
        <Tower height={380} color={theme.colors.hero} windowColor={theme.colors.bg} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 1010,
          textAlign: 'center',
          fontFamily: displayFont,
          opacity: titleIn,
          transform: `translateY(${interpolate(titleIn, [0, 1], [40, 0])}px)`,
        }}
      >
        <div
          style={{
            fontSize: 108,
            fontWeight: 700,
            letterSpacing: '0.22em',
            marginRight: '-0.22em',
            color: theme.colors.ink,
          }}
        >
          DOMIO
        </div>
        <div
          style={{
            fontSize: 44,
            fontWeight: 700,
            color: theme.colors.ink,
            marginTop: 34,
          }}
        >
          Дом под присмотром
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 500,
            color: theme.colors.inkSoft,
            marginTop: 22,
          }}
        >
          Ссылка на приложение — в профиле
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Сборка ----------
const sfx = (name: string, from: number, volume = 0.7) => (
  <Sequence key={`${name}-${from}`} from={from}>
    <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
  </Sequence>
);

// Тики под счётчик экономии
const TICKS = Array.from({ length: 14 }, (_, i) => T.savings.from + 8 + i * 3);

// Постель ныряет под голос и выныривает за 8 кадров до/после фразы
const duckedBed = (base: number, low: number) => (f: number) =>
  VO.reduce(
    (v, [, s, d]) =>
      Math.min(
        v,
        interpolate(f, [s - 8, s, s + d, s + d + 8], [base, low, low, base], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
      ),
    base,
  );

export const Tsena: React.FC<{ vo?: boolean }> = ({ vo = false }) => (
  <AbsoluteFill style={{ backgroundColor: theme.colors.night }}>
    <Sequence from={T.hook.from} durationInFrames={T.hook.len}>
      <Hook />
    </Sequence>
    <Sequence from={T.advice.from} durationInFrames={T.advice.len}>
      <Advice />
    </Sequence>
    <Sequence from={T.offers.from} durationInFrames={T.offers.len}>
      <Offers />
    </Sequence>
    <Sequence from={T.savings.from} durationInFrames={T.savings.len}>
      <Savings />
    </Sequence>
    <Sequence from={T.trust.from} durationInFrames={T.trust.len}>
      <Trust />
    </Sequence>
    <Sequence from={T.payment.from} durationInFrames={T.payment.len}>
      <Payment />
    </Sequence>
    <Sequence from={T.logo.from} durationInFrames={T.logo.len}>
      <Logo />
    </Sequence>

    <Grade opacity={0.07} />
    <Grain opacity={0.05} />
    <Vignette strength={0.18} />

    <Audio src={staticFile('sfx/bed.wav')} volume={vo ? duckedBed(0.16, 0.07) : 0.16} />
    {vo &&
      VO.map(([name, from]) => (
        <Sequence key={name} from={from}>
          <Audio src={staticFile(`vo/${name}.wav`)} volume={1} />
        </Sequence>
      ))}
    {sfx('thump', 0, 0.8)}
    {sfx('whoosh', T.hook.from + 38, 0.5)}
    {sfx('whoosh', T.advice.from - 3, 0.5)}
    {sfx('whoosh', T.offers.from - 3, 0.5)}
    {sfx('pop', T.offers.from + 58, 0.6)}
    {sfx('pop', T.offers.from + 76, 0.6)}
    {sfx('pop', T.offers.from + 94, 0.7)}
    {sfx('whoosh', T.savings.from - 3, 0.5)}
    {TICKS.map((f) => sfx('tick', f, 0.5))}
    {sfx('thump', T.savings.from + 44, 0.6)}
    {sfx('whoosh', T.trust.from - 3, 0.5)}
    {sfx('thump', T.payment.from + 6, 0.7)}
    {sfx('whoosh', T.logo.from - 3, 0.5)}
    {sfx('chime', T.logo.from + 10, 0.55)}
  </AbsoluteFill>
);
