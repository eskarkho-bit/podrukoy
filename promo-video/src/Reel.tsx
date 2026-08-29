// Сборка ролика «Башня»: шесть сцен, звук, общий грейд и зерно поверх.
import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from 'remotion';
import { Mountains } from './scenes/Mountains';
import { Build } from './scenes/Build';
import { MatchCut } from './scenes/MatchCut';
import { AppScene } from './scenes/App';
import { Payoff } from './scenes/Payoff';
import { Finale } from './scenes/Finale';
import { Grade, Grain, Vignette } from './components/ui';

// Хронометраж сцен, кадры при 30 fps. Меняется только здесь.
// Сцены раздвинуты под темп закадрового голоса: живая речь важнее сетки.
export const SCENES = {
  mountains: { from: 0, len: 150 },
  build: { from: 150, len: 150 },
  matchCut: { from: 300, len: 135 },
  app: { from: 435, len: 225 },
  payoff: { from: 660, len: 120 },
  finale: { from: 780, len: 180 },
} as const;

export const TOTAL_FRAMES = 960;

// Фразы озвучки: кадр старта и длительность (по ffprobe), для даккинга
const VO: [string, number, number][] = [
  ['b1', 18, 108],
  ['b2', 156, 133],
  ['b3', 306, 162],
  ['b4', 486, 180],
  ['b5', 672, 121],
  ['b6', 795, 148],
];

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

const sfx = (name: string, from: number, volume = 0.7) => (
  <Sequence key={`${name}-${from}`} from={from}>
    <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
  </Sequence>
);

export const Reel: React.FC<{ vo?: boolean }> = ({ vo = false }) => (
  <AbsoluteFill style={{ backgroundColor: '#141A12' }}>
    <Sequence from={SCENES.mountains.from} durationInFrames={SCENES.mountains.len}>
      <Mountains />
    </Sequence>
    <Sequence from={SCENES.build.from} durationInFrames={SCENES.build.len}>
      <Build />
    </Sequence>
    <Sequence from={SCENES.matchCut.from} durationInFrames={SCENES.matchCut.len}>
      <MatchCut />
    </Sequence>
    <Sequence from={SCENES.app.from} durationInFrames={SCENES.app.len}>
      <AppScene />
    </Sequence>
    <Sequence from={SCENES.payoff.from} durationInFrames={SCENES.payoff.len}>
      <Payoff />
    </Sequence>
    <Sequence from={SCENES.finale.from} durationInFrames={SCENES.finale.len}>
      <Finale />
    </Sequence>

    {/* Отделка поверх всех сцен: грейд → зерно → виньетка */}
    <Grade opacity={0.08} />
    <Grain opacity={0.05} />
    <Vignette strength={0.2} />

    {/* Звук: постель на весь ролик, акценты за 2–3 кадра до визуального удара */}
    <Audio src={staticFile('sfx/bed.wav')} volume={vo ? duckedBed(0.22, 0.08) : 0.22} />
    {vo &&
      VO.map(([name, from]) => (
        <Sequence key={name} from={from}>
          <Audio src={staticFile(`vo/${name}.wav`)} volume={1} />
        </Sequence>
      ))}
    {sfx('whoosh', SCENES.build.from - 3, 0.5)}
    {sfx('whoosh', SCENES.matchCut.from - 3, 0.5)}
    {sfx('whoosh', SCENES.app.from - 3, 0.5)}
    {sfx('whoosh', SCENES.payoff.from - 3, 0.5)}
    {sfx('whoosh', SCENES.finale.from - 3, 0.5)}
    {sfx('thump', SCENES.build.from + 88, 0.7)}
    {sfx('thump', SCENES.matchCut.from + 6, 0.7)}
    {sfx('thump', SCENES.payoff.from + 6, 0.7)}
    {sfx('pop', SCENES.app.from + 132, 0.6)}
    {sfx('pop', SCENES.app.from + 142, 0.6)}
    {sfx('pop', SCENES.app.from + 152, 0.6)}
    {sfx('chime', SCENES.finale.from + 14, 0.55)}
  </AbsoluteFill>
);
