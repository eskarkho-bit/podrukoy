// Фирменная заставка для начала роликов: башня складывается из каменных
// рядов, буквы DOMIO выезжают по одной, в верхнем окне зажигается свет.
// Одна и та же сцена собирает вертикаль и горизонталь — раскладка выбирается
// по соотношению сторон кадра, а не отдельным компонентом: иначе версии
// расползутся при первой же правке хронометража.
import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { displayFont } from './fonts';
import { theme } from './theme';
import { trunkCourses, TOWER_POLYGONS, TOWER_VIEWBOX, TOWER_WINDOWS } from './tower';
import { Grade, Grain, Vignette } from './components/ui';

export const LOGO_FRAMES = 216; // 7.2 c при 30 fps — умещается в бампер 5–10 c

// Хронометраж, кадры при 30 fps. Правится только здесь.
const T = {
  coursesFrom: 8, // ряды кладки, дальше каждый через coursesStep
  coursesStep: 5,
  topsFrom: 48, // уступы и кровля
  topsStep: 7,
  roofLand: 76, // кровля садится — сюда же удар и пыль
  windowsFrom: 86,
  seamsGone: [88, 108] as const, // швы кладки растворяются — знак становится плоским
  lettersFrom: 94, // буквы DOMIO, дальше каждая через lettersStep
  lettersStep: 3,
  subtitleFrom: 114,
  lightOn: [128, 142] as const, // свет в верхнем окне — «дом под присмотром»
  exit: [196, 212] as const,
} as const;

const COURSES = trunkCourses(7);
// Уступы и кровля — все полигоны знака, кроме ствола (он собран из рядов)
const TOPS = TOWER_POLYGONS.slice(1);
const DUST_COUNT = 10;

export const Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  const portrait = height > width;

  // Раскладка. Числа подобраны на глаз по стоп-кадрам, а не выведены формулой:
  // в вертикали лочка стоит чуть выше центра (запас под плашки платформ),
  // в горизонтали — почти по центру.
  const L = portrait
    ? { towerH: 560, towerTop: 380, titleTop: 1000, titleSize: 128, subSize: 42, subGap: 18 }
    : { towerH: 420, towerTop: 150, titleTop: 620, titleSize: 108, subSize: 36, subGap: 14 };

  const { width: vw, height: vh } = TOWER_VIEWBOX;
  const towerW = (L.towerH * vw) / vh;
  const towerLeft = (width - towerW) / 2;
  const k = L.towerH / vh; // юниты знака → пиксели

  // Дыхание включается после сборки, иначе качало бы ещё падающие ряды
  const settled = interpolate(frame, [T.roofLand, T.roofLand + 20], [0, 1], clamp);
  const breathe = 1 + Math.sin(frame / 26) * 0.008 * settled;

  // Швы кладки видны только пока идёт стройка — потом ряды сливаются в знак
  const seams = interpolate(frame, [...T.seamsGone], [1, 0], { easing: theme.ease.out, ...clamp });

  // Свет в верхнем окне — финальная деталь, тёплый и чуть живой
  const lightOn = interpolate(frame, [...T.lightOn], [0, 1], { easing: theme.ease.out, ...clamp });
  const flicker = 0.75 + Math.sin(frame / 9) * 0.15;
  const door = TOWER_WINDOWS[0];

  // Уход быстрее входа: заставку клеят встык с роликом. inOut, а не in:
  // с ease.in весь фейд сваливается в последние пять кадров и выглядит обрывом
  const out = interpolate(frame, [...T.exit], [1, 0], { easing: theme.ease.inOut, ...clamp });
  const outShift = interpolate(frame, [...T.exit], [0, -24], {
    easing: theme.ease.inOut,
    ...clamp,
  });

  const bgIn = interpolate(frame, [0, 14], [0, 1], { easing: theme.ease.out, ...clamp });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      <AbsoluteFill style={{ opacity: out, transform: `translateY(${outShift}px)` }}>
        {/* Фон: два встречных пятна света, ближнее крупнее и медленнее */}
        <div
          style={{
            position: 'absolute',
            width: L.towerH * 2.3,
            height: L.towerH * 2.3,
            borderRadius: '50%',
            left: width / 2 - L.towerH * 1.15 + Math.sin(frame / 60) * 24,
            top: L.towerTop + L.towerH * 0.4 - L.towerH * 1.15,
            filter: 'blur(80px)',
            background: `radial-gradient(circle, ${theme.colors.hero}1a, transparent 62%)`,
            opacity: bgIn,
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: L.towerH * 1.3,
            height: L.towerH * 1.3,
            borderRadius: '50%',
            left: width * 0.62 - Math.sin(frame / 60) * 10,
            top: height * 0.55,
            filter: 'blur(80px)',
            background: `radial-gradient(circle, ${theme.colors.hero}12, transparent 62%)`,
            opacity: bgIn,
          }}
        />

        {/* Башня строит себя: ряды кладки падают снизу вверх, каждый со своей
            пружиной — тот же приём, что в сцене стройки ролика, но в светлом
            мире приложения */}
        <div
          style={{
            position: 'absolute',
            left: towerLeft,
            top: L.towerTop,
            transform: `scale(${breathe})`,
            filter: 'drop-shadow(0 18px 44px rgba(46, 58, 42, 0.18))',
          }}
        >
          <svg viewBox={`0 0 ${vw} ${vh}`} width={towerW} height={L.towerH}>
            {COURSES.map((points, i) => {
              const p = spring({
                frame: frame - T.coursesFrom - i * T.coursesStep,
                fps,
                config: theme.spring.snappy,
              });
              return (
                <polygon
                  key={points}
                  points={points}
                  fill={theme.colors.hero}
                  stroke="#4C6345"
                  strokeWidth={0.5}
                  strokeOpacity={seams}
                  opacity={p}
                  transform={`translate(0, ${interpolate(p, [0, 1], [-14, 0])})`}
                />
              );
            })}
            {TOPS.map((points, i) => {
              const last = i === TOPS.length - 1;
              const p = spring({
                frame: frame - T.topsFrom - i * T.topsStep,
                fps,
                config: last ? theme.spring.bouncy : theme.spring.snappy,
              });
              return (
                <polygon
                  key={points}
                  points={points}
                  fill={theme.colors.hero}
                  stroke="#4C6345"
                  strokeWidth={0.5}
                  strokeOpacity={seams}
                  opacity={p}
                  transform={`translate(0, ${interpolate(p, [0, 1], [-12, 0])})`}
                />
              );
            })}
            {/* Ряды сливаются в знак: между рядами лежит зазор-«раствор», и на
                светлом фоне он просвечивал бы вечно — цельный ствол проявляется
                поверх и накрывает швы вместе с обводкой */}
            <polygon points={TOWER_POLYGONS[0]} fill={theme.colors.hero} opacity={1 - seams} />
            {/* Окна-бойницы — дырки цвета фона, как в самом знаке */}
            {TOWER_WINDOWS.map((win, i) => {
              const p = interpolate(
                frame,
                [T.windowsFrom + i * 5, T.windowsFrom + 12 + i * 5],
                [0, 1],
                { easing: theme.ease.out, ...clamp },
              );
              return <rect key={win.y} {...win} fill={theme.colors.bg} opacity={p} />;
            })}
            {/* Тёплый свет в верхнем окне поверх дырки */}
            <rect {...door} fill={theme.colors.dawn} opacity={lightOn * flicker} />
          </svg>
          {/* Ореол света из окна — без него огонёк читается как пиксель */}
          <div
            style={{
              position: 'absolute',
              left: (door.x + door.width / 2) * k - 70,
              top: (door.y + door.height / 2) * k - 70,
              width: 140,
              height: 140,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${theme.colors.dawn}66, transparent 70%)`,
              opacity: lightOn * flicker * 0.8,
              filter: 'blur(6px)',
            }}
          />
        </div>

        {/* Пыль от посадки кровли: разлетается вверх дугой и оседает */}
        {Array.from({ length: DUST_COUNT }, (_, i) => {
          const a = -Math.PI / 2 + (random(`dust-a-${i}`) - 0.5) * 2.2;
          const dist = 40 + random(`dust-d-${i}`) * 55;
          const t = interpolate(frame, [T.roofLand, T.roofLand + 24], [0, 1], {
            easing: theme.ease.out,
            ...clamp,
          });
          if (t <= 0 || t >= 1) return null;
          const size = 4 + random(`dust-s-${i}`) * 5;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: towerLeft + 40 * k + Math.cos(a) * dist * t - size / 2,
                top: L.towerTop + 3 * k + Math.sin(a) * dist * t + 16 * t * t - size / 2,
                width: size,
                height: size,
                borderRadius: '50%',
                backgroundColor: theme.colors.inkSoft,
                opacity: (1 - t) * 0.55,
              }}
            />
          );
        })}

        {/* Имя: буквы выезжают по одной, разрядка — как в финале ролика.
            Зазор в пикселях: em в gap считался бы от шрифта родителя */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: L.titleTop,
            fontFamily: displayFont,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: Math.round(L.titleSize * 0.22),
              fontSize: L.titleSize,
              fontWeight: 700,
              color: theme.colors.ink,
            }}
          >
            {'DOMIO'.split('').map((ch, i) => {
              const p = spring({
                frame: frame - T.lettersFrom - i * T.lettersStep,
                fps,
                config: theme.spring.snappy,
              });
              return (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    opacity: p,
                    transform: `translateY(${interpolate(p, [0, 1], [44, 0])}px) scale(${interpolate(p, [0, 1], [0.92, 1])})`,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>
          {(() => {
            const p = spring({ frame: frame - T.subtitleFrom, fps, config: theme.spring.smooth });
            return (
              <div
                style={{
                  fontSize: L.subSize,
                  fontWeight: 600,
                  letterSpacing: '0.3em',
                  marginRight: '-0.3em',
                  color: theme.colors.inkSoft,
                  marginTop: L.subGap,
                  opacity: p,
                  transform: `translateY(${interpolate(p, [0, 1], [26, 0])}px)`,
                }}
              >
                МАСТЕР ПО ДОМУ
              </div>
            );
          })()}
        </div>
      </AbsoluteFill>

      {/* Отделка поверх: грейд → зерно → виньетка, как во всех роликах */}
      <Grade opacity={0.08} />
      <Grain opacity={0.05} />
      <Vignette strength={0.18} />

      {/* Звук: постель тише обычного — заставка клеится к чужому звуку ролика */}
      <Audio
        src={staticFile('sfx/bed.wav')}
        volume={(f) => interpolate(f, [0, 10, 186, 212], [0, 0.18, 0.18, 0], clamp)}
      />
      <Sequence from={0}>
        <Audio src={staticFile('sfx/whoosh.wav')} volume={0.45} />
      </Sequence>
      {/* Стук кладки — через ряд, иначе очередь вместо стройки */}
      {[0, 2, 4, 6].map((i) => (
        <Sequence key={`tick-${i}`} from={T.coursesFrom + i * T.coursesStep + 8}>
          <Audio src={staticFile('sfx/tick.wav')} volume={0.3} />
        </Sequence>
      ))}
      <Sequence from={T.roofLand - 2}>
        <Audio src={staticFile('sfx/thump.wav')} volume={0.65} />
      </Sequence>
      <Sequence from={T.windowsFrom - 2}>
        <Audio src={staticFile('sfx/pop.wav')} volume={0.35} />
      </Sequence>
      <Sequence from={T.windowsFrom + 3}>
        <Audio src={staticFile('sfx/pop.wav')} volume={0.3} />
      </Sequence>
      <Sequence from={T.lettersFrom - 4}>
        <Audio src={staticFile('sfx/chime.wav')} volume={0.55} />
      </Sequence>
      <Sequence from={T.lightOn[0] - 2}>
        <Audio src={staticFile('sfx/pop.wav')} volume={0.3} />
      </Sequence>
    </AbsoluteFill>
  );
};
