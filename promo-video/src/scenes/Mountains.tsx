// Сцена 1: рассвет в горах, родовая башня на гребне.
// Слои: небо → солнце → дальний хребет → туман → средний хребет с башней →
// ближний хребет → текст. Параллакс разводит хребты по скорости.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { displayFont } from '../fonts';
import { theme } from '../theme';
import { Tower } from '../components/Tower';
import { SceneExit, WordReveal } from '../components/ui';

const W = 1080;
const H = 1920;

// Гребни нарисованы руками: ломаные с разным характером пиков.
// Основание уводим за нижнюю кромку кадра, чтобы под хребтом не светился фон.
const ridge = (pts: number[][], _base: number) =>
  `M -60 ${H + 200} L ${pts.map(([x, y]) => `${x} ${y}`).join(' L ')} L ${W + 60} ${H + 200} Z`;

const FAR = ridge(
  [
    [-60, 1010],
    [140, 830],
    [300, 950],
    [470, 760],
    [640, 930],
    [830, 800],
    [1000, 940],
    [1140, 860],
  ],
  1000,
);
const MID = ridge(
  [
    [-60, 1180],
    [120, 1050],
    [330, 1170],
    [560, 990],
    [700, 1120],
    [900, 1030],
    [1140, 1160],
  ],
  1150,
);
const NEAR = ridge(
  [
    [-60, 1400],
    [200, 1290],
    [460, 1420],
    [760, 1260],
    [1000, 1400],
    [1140, 1330],
  ],
  1380,
);

export const Mountains: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Единый ход камеры: хребты уезжают с разной скоростью
  const drift = interpolate(frame, [0, durationInFrames], [0, -90], {
    easing: theme.ease.inOut,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Солнце всходит первые ~3 секунды
  const sunRise = interpolate(frame, [0, 100], [220, 0], {
    easing: theme.ease.out,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const sunGlow = interpolate(frame, [0, 100], [0.35, 1], {
    easing: theme.ease.out,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fogDrift = Math.sin(frame / 40) * 30 + drift * 0.4;

  return (
    <SceneExit>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${theme.colors.night} 0%, ${theme.colors.ridgeFar} 42%, ${theme.colors.dawn} 78%, ${theme.colors.dawnSoft} 100%)`,
        }}
      >
        {/* Солнце с ореолом — единственный тёплый акцент. Ореол — отдельным
            градиентом: box-shadow под filter обрезался бы по краю слоя */}
        <div
          style={{
            position: 'absolute',
            left: W / 2 - 450,
            top: 540 + sunRise,
            width: 900,
            height: 900,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${theme.colors.dawn}66, transparent 62%)`,
            opacity: sunGlow,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: W / 2 - 190,
            top: 800 + sunRise,
            width: 380,
            height: 380,
            borderRadius: '50%',
            background: theme.colors.dawnSoft,
            opacity: sunGlow,
          }}
        />

        <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
          <g transform={`translate(${drift * 0.3}, 0)`}>
            <path d={FAR} fill={theme.colors.ridgeFar} />
          </g>
        </svg>

        {/* Полоса тумана между хребтами */}
        <div
          style={{
            position: 'absolute',
            left: -120 + fogDrift,
            top: 980,
            width: W + 240,
            height: 190,
            background: theme.colors.fog,
            filter: 'blur(40px)',
            borderRadius: 200,
          }}
        />

        <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
          <g transform={`translate(${drift * 0.6}, 0)`}>
            <path d={MID} fill={theme.colors.ridgeMid} />
          </g>
        </svg>

        {/* Башня стоит на среднем хребте и едет вместе с ним */}
        <div
          style={{
            position: 'absolute',
            left: 560 + drift * 0.6,
            top: 990 - 265,
            filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.35))',
          }}
        >
          <Tower height={280} color="#0F140C" windowColor={theme.colors.dawn} />
        </div>

        <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
          <g transform={`translate(${drift}, 0)`}>
            <path d={NEAR} fill={theme.colors.ridgeNear} />
          </g>
        </svg>

        {/* Нижний туман, прячет стык ближнего хребта с кромкой кадра */}
        <div
          style={{
            position: 'absolute',
            left: -160 - fogDrift,
            top: 1330,
            width: W + 320,
            height: 260,
            background: theme.colors.fog,
            filter: 'blur(56px)',
            borderRadius: 300,
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 90,
            right: 90,
            top: 1460,
            fontFamily: displayFont,
            fontWeight: 700,
            fontSize: 72,
            lineHeight: 1.12,
            letterSpacing: '-0.02em',
            color: theme.colors.dawnSoft,
            textShadow: '0 4px 30px rgba(0,0,0,0.45)',
          }}
        >
          <WordReveal text="Веками дом охраняла башня" delay={22} per={4} />
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};
