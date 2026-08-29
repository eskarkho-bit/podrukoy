// Сцена 3: матч-кат. Из верхнего окна тёмной башни распахивается светлый мир
// приложения, силуэт перекрашивается в фирменный зелёный и сжимается в знак.
// Механика повторяет сплэш приложения: экран открывается «через окно».
import React from 'react';
import { AbsoluteFill, interpolate, interpolateColors, useCurrentFrame } from 'remotion';
import { displayFont } from '../fonts';
import { theme } from '../theme';
import { Tower } from '../components/Tower';
import { SceneExit, WordReveal } from '../components/ui';

const H_START = 880;
const TOP_START = 330;

export const MatchCut: React.FC = () => {
  const frame = useCurrentFrame();
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

  // Светлый круг растёт из центра верхнего окна башни
  const k = H_START / 120;
  const winCx = 1080 / 2; // окно по оси знака
  const winCy = TOP_START + (58 + 9) * k;
  const circle = interpolate(frame, [6, 44], [0, 1], { easing: theme.ease.inOut, ...clamp });
  const circleR = circle * 2300;

  // Башня: тёмная → зелёная, большая → знак
  const recolor = interpolate(frame, [14, 40], [0, 1], { easing: theme.ease.inOut, ...clamp });
  const shrink = interpolate(frame, [48, 86], [0, 1], { easing: theme.ease.inOut, ...clamp });
  const hTower = interpolate(shrink, [0, 1], [H_START, 360]);
  const topTower = interpolate(shrink, [0, 1], [TOP_START, 560]);

  return (
    <SceneExit>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 30%, ${theme.colors.nightAlt} 0%, ${theme.colors.night} 70%)`,
        }}
      >
        {/* Мир приложения, вырывающийся из окна */}
        <div
          style={{
            position: 'absolute',
            left: winCx - circleR,
            top: winCy - circleR,
            width: circleR * 2,
            height: circleR * 2,
            borderRadius: '50%',
            background: theme.colors.bg,
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: topTower,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {/* Два слоя башни: тёмный гаснет, зелёный проявляется — честный
              переход цвета без пересчёта заливок. Окна светлеют вместе с
              кругом, чтобы стык со сценой стройки не мигал */}
          <div style={{ position: 'relative' }}>
            <Tower
              height={hTower}
              color="#232D19"
              windowColor={interpolateColors(frame, [4, 26], ['#1E2619', theme.colors.bg])}
            />
            <div style={{ position: 'absolute', inset: 0, opacity: recolor }}>
              <Tower height={hTower} color={theme.colors.hero} windowColor={theme.colors.bg} />
            </div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: 90,
            right: 90,
            top: 1080,
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 84,
            lineHeight: 1.12,
            letterSpacing: '-0.02em',
            color: theme.colors.ink,
            textAlign: 'center',
          }}
        >
          <WordReveal text="Башня осталась." delay={56} per={4} />
          <WordReveal text="Мастера — тоже." delay={70} per={4} />
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};
