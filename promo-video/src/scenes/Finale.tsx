// Сцена 6: финал в ритме сплэша приложения — знак вырастает с отскоком,
// название выезжает снизу, слоган и спокойный призыв.
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { displayFont } from '../fonts';
import { theme } from '../theme';
import { Tower } from '../components/Tower';
import { WordReveal } from '../components/ui';

export const Finale: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

  const towerIn = spring({ frame: frame - 2, fps, config: theme.spring.bouncy });
  const titleIn = spring({ frame: frame - 16, fps, config: theme.spring.smooth });
  const breathe = 1 + Math.sin(frame / 26) * 0.008;
  const out = interpolate(frame, [durationInFrames - 14, durationInFrames - 2], [1, 0], {
    easing: theme.ease.in,
    ...clamp,
  });

  return (
    <AbsoluteFill style={{ background: theme.colors.bg, opacity: out }}>
      <div
        style={{
          position: 'absolute',
          width: 1300,
          height: 1300,
          borderRadius: '50%',
          top: 240,
          left: -110 + Math.sin(frame / 60) * 24,
          filter: 'blur(80px)',
          background: `radial-gradient(circle, ${theme.colors.hero}1a, transparent 62%)`,
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 500,
          display: 'flex',
          justifyContent: 'center',
          opacity: towerIn,
          transform: `scale(${interpolate(towerIn, [0, 1], [0.7, 1]) * breathe})`,
        }}
      >
        <Tower height={430} color={theme.colors.hero} windowColor={theme.colors.bg} />
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
          transform: `translateY(${interpolate(titleIn, [0, 1], [46, 0])}px)`,
        }}
      >
        <div
          style={{
            fontSize: 118,
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
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: '0.3em',
            marginRight: '-0.3em',
            color: theme.colors.inkSoft,
            marginTop: 18,
          }}
        >
          МАСТЕР ПО ДОМУ
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 90,
          right: 90,
          top: 1330,
          fontFamily: displayFont,
          fontWeight: 700,
          fontSize: 64,
          color: theme.colors.ink,
          textAlign: 'center',
        }}
      >
        <WordReveal text="Дом под присмотром" delay={46} per={4} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 90,
          right: 90,
          top: 1470,
          fontFamily: displayFont,
          fontWeight: 500,
          fontSize: 38,
          color: theme.colors.inkSoft,
          textAlign: 'center',
        }}
      >
        <WordReveal text="Ссылка на приложение — в профиле" delay={68} per={3} />
      </div>
    </AbsoluteFill>
  );
};
