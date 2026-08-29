// Сцена 5: развязка — оплата только после приёмки. Галочка прорисовывается
// штрихом, кольцо расходится пульсом: самый крупный жест ролика.
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { displayFont } from '../fonts';
import { theme } from '../theme';
import { SceneExit, WordReveal } from '../components/ui';

export const Payoff: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

  const circleIn = spring({ frame: frame - 4, fps, config: theme.spring.bouncy });
  // Штрих галочки: длина пути ~168, прорисовка через dashoffset
  const stroke = interpolate(frame, [14, 34], [168, 0], { easing: theme.ease.out, ...clamp });
  const pulse = interpolate(frame, [30, 78], [0, 1], { easing: theme.ease.out, ...clamp });
  const breathe = 1 + Math.sin(frame / 22) * 0.012;

  return (
    <SceneExit>
      <AbsoluteFill style={{ background: theme.colors.bg }}>
        <div
          style={{
            position: 'absolute',
            width: 1200,
            height: 1200,
            borderRadius: '50%',
            top: -420,
            right: -320 + Math.sin(frame / 60) * 30,
            filter: 'blur(70px)',
            background: `radial-gradient(circle, ${theme.colors.hero}1e, transparent 62%)`,
          }}
        />

        {/* Пульс-кольцо расходится от галочки */}
        <div
          style={{
            position: 'absolute',
            left: 540 - 170 - pulse * 210,
            top: 700 - 170 - pulse * 210,
            width: 340 + pulse * 420,
            height: 340 + pulse * 420,
            borderRadius: '50%',
            border: `3px solid ${theme.colors.hero}`,
            opacity: (1 - pulse) * 0.5,
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 540 - 170,
            top: 700 - 170,
            width: 340,
            height: 340,
            borderRadius: '50%',
            background: theme.colors.hero,
            boxShadow: `0 0 60px ${theme.colors.glow}, 0 40px 80px -20px rgba(20,30,16,0.35)`,
            opacity: circleIn,
            transform: `scale(${interpolate(circleIn, [0, 1], [0.5, 1]) * breathe})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width={190} height={190} viewBox="0 0 100 100">
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
            top: 1040,
            fontFamily: displayFont,
            fontWeight: 800,
            fontSize: 82,
            lineHeight: 1.12,
            letterSpacing: '-0.02em',
            color: theme.colors.ink,
            textAlign: 'center',
          }}
        >
          <WordReveal text="Оплата — когда работа принята" delay={26} per={4} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 120,
            right: 120,
            top: 1300,
            fontFamily: displayFont,
            fontWeight: 500,
            fontSize: 42,
            lineHeight: 1.3,
            color: theme.colors.inkSoft,
            textAlign: 'center',
          }}
        >
          <WordReveal text="Цену вы выбираете сами — из предложений мастеров" delay={44} per={3} />
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};
