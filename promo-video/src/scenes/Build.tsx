// Сцена 2: башню складывают ряд за рядом — «мастера, которым доверяли».
// Ствол собирается из каменных рядов, уступы и кровля прилетают следом,
// в конце в верхнем окне зажигается тёплый свет.
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { displayFont } from '../fonts';
import { theme } from '../theme';
import { trunkCourses, TOWER_POLYGONS, TOWER_VIEWBOX, TOWER_WINDOWS } from '../tower';
import { SceneExit, WordReveal } from '../components/ui';

const H_TOWER = 880;
const COURSES = trunkCourses(7);
// Уступы и кровля — все полигоны знака, кроме ствола (он собран из рядов)
const TOPS = TOWER_POLYGONS.slice(1);

export const Build: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { width: vw, height: vh } = TOWER_VIEWBOX;
  const w = (H_TOWER * vw) / vh;

  const glow = interpolate(frame, [104, 122], [0, 1], {
    easing: theme.ease.out,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const breathe = 1 + Math.sin(frame / 24) * 0.006;

  return (
    <SceneExit>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 30%, ${theme.colors.nightAlt} 0%, ${theme.colors.night} 70%)`,
        }}
      >
        {/* Тёплая подсветка из-за башни — иначе камень сливается с ночью */}
        <div
          style={{
            position: 'absolute',
            left: 540 - 620,
            top: 770 - 620,
            width: 1240,
            height: 1240,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${theme.colors.dawn}38, transparent 60%)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: (1080 - w) / 2,
            top: 330,
            transform: `scale(${breathe})`,
            filter: 'drop-shadow(0 24px 60px rgba(0,0,0,0.5))',
          }}
        >
          <svg viewBox={`0 0 ${vw} ${vh}`} width={w} height={H_TOWER}>
            {/* Ряды кладки падают снизу вверх, каждый со своей пружиной */}
            {COURSES.map((points, i) => {
              const p = spring({ frame: frame - 8 - i * 6, fps, config: theme.spring.snappy });
              return (
                <polygon
                  key={points}
                  points={points}
                  fill="#232D19"
                  stroke="#36432A"
                  strokeWidth={0.5}
                  opacity={p}
                  transform={`translate(0, ${interpolate(p, [0, 1], [-14, 0])})`}
                />
              );
            })}
            {/* Уступы и кровля — после ствола, кровля с лёгким отскоком */}
            {TOPS.map((points, i) => {
              const last = i === TOPS.length - 1;
              const p = spring({
                frame: frame - 58 - i * 8,
                fps,
                config: last ? theme.spring.bouncy : theme.spring.snappy,
              });
              return (
                <polygon
                  key={points}
                  points={points}
                  fill="#232D19"
                  stroke="#36432A"
                  strokeWidth={0.5}
                  opacity={p}
                  transform={`translate(0, ${interpolate(p, [0, 1], [-12, 0])})`}
                />
              );
            })}
            {/* Окна проявляются, верхнее — тёплым светом очага */}
            {TOWER_WINDOWS.map((win, i) => {
              const p = interpolate(frame, [92 + i * 6, 104 + i * 6], [0, 1], {
                easing: theme.ease.out,
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
              return (
                <rect
                  key={win.y}
                  {...win}
                  fill={i === 0 ? theme.colors.dawn : theme.colors.nightAlt}
                  opacity={i === 0 ? p * (0.7 + glow * 0.3) : p}
                />
              );
            })}
          </svg>
          {/* Ореол света из верхнего окна */}
          <div
            style={{
              position: 'absolute',
              left: w / 2 - 90,
              top: (58 + 9) * (H_TOWER / vh) - 90,
              width: 180,
              height: 180,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${theme.colors.dawn}55, transparent 70%)`,
              opacity: glow * (0.8 + Math.sin(frame / 9) * 0.2),
              filter: 'blur(6px)',
            }}
          />
        </div>

        <div
          style={{
            position: 'absolute',
            left: 90,
            right: 90,
            top: 1470,
            fontFamily: displayFont,
            fontWeight: 700,
            fontSize: 68,
            lineHeight: 1.14,
            letterSpacing: '-0.02em',
            color: theme.colors.dawnSoft,
            textShadow: '0 4px 30px rgba(0,0,0,0.5)',
          }}
        >
          <WordReveal text="Её строили мастера, которым доверяли" delay={34} per={4} />
        </div>
      </AbsoluteFill>
    </SceneExit>
  );
};
