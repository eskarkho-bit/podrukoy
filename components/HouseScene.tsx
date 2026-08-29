import { ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeInDown,
  FadeOut,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  Line,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { springs } from '../motion';
import { useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import { Glyph } from './glyphIcons';
import { hasObjectIcon, ObjectIcon } from './objectIcons';

export type AreaId = 'Дом' | 'Двор' | 'Гараж';
export type Stage = 'exterior' | 'open' | 'room';

// Сцена днём и ночью. Тёмная тема раньше оставляла дом ярким пятном —
// теперь вместе с ней наступает ночь: тёмное небо, тёплый свет в окнах,
// луна вместо облаков. Цвета собраны парой палитр, а не рассыпаны по SVG.
type ScenePalette = {
  sky: string;
  sceneBorder: string;
  ground: string;
  groundStroke: string;
  path: string;
  garage: [string, string, string, string];
  lineSoft: string;
  wallLeft: string;
  wallRight: string;
  door: string;
  doorKnob: string;
  windowGlass: string;
  windowFrame: string;
  planBase: string;
  planStroke: string;
  roof: [string, string, string, string];
  chimney: [string, string, string];
  trunk: string;
  crowns: [string, string, string];
  label: string;
  objectLabel: string;
};

const DAY: ScenePalette = {
  sky: '#F6FAF3',
  sceneBorder: '#E6E9E1',
  ground: '#E4EDDC',
  groundStroke: '#D8E4CC',
  path: '#ECEAE0',
  garage: ['#DCE6D2', '#F6F4EC', '#EAE7DD', '#D5DCCB'],
  lineSoft: '#FFFFFF',
  wallLeft: '#ECE9E0',
  wallRight: '#F8F6EF',
  door: '#6E8A64',
  doorKnob: '#F2F5F0',
  windowGlass: '#C7D6E0',
  windowFrame: '#FFFFFF',
  planBase: '#FBF9F3',
  planStroke: '#E8E5DA',
  roof: ['#708A66', '#7E9873', '#9CB48E', '#F3F1E8'],
  chimney: ['#F0ECE0', '#E8E4D6', '#DDD8C8'],
  trunk: '#B49B7D',
  crowns: ['#9CB88C', '#8AA97A', '#A9C29A'],
  label: '#5E7A56',
  objectLabel: '#3C4A37',
};

const NIGHT: ScenePalette = {
  sky: '#141C17',
  sceneBorder: '#243329',
  ground: '#1D2A21',
  groundStroke: '#243329',
  path: '#242F26',
  garage: ['#22301F', '#2C3A2E', '#25322A', '#1C271F'],
  lineSoft: 'rgba(255,255,255,0.14)',
  wallLeft: '#2A382E',
  wallRight: '#33453A',
  door: '#48624A',
  doorKnob: '#DCD6B8',
  // Ночью дома живёт свет — окна тёплые, это половина всего настроения
  windowGlass: '#F2D98F',
  windowFrame: '#E8D9A0',
  planBase: '#243026',
  planStroke: '#2E3B31',
  roof: ['#31463A', '#3B5344', '#4A6450', '#2A3A32'],
  chimney: ['#3B4B41', '#33423A', '#2C3A32'],
  trunk: '#6E5C46',
  crowns: ['#3F5A44', '#354E3A', '#4A6850'],
  label: '#A9C29A',
  objectLabel: '#DEE5D8',
};

// Комнаты на плане ночью — те же цвета, приглушённые до «света ламп»
const NIGHT_ROOM_FILLS: Record<string, string> = {
  kitchen: '#4A4331',
  living: '#3B4A35',
  bath: '#33444A',
  bedroom: '#453A47',
};

export type SceneObject = {
  id: string;
  title: string;
  icon: string; // эмодзи-запас: показывается, только если векторной иконки нет
  place: string;
  // Координаты в системе сцены (viewBox 400×340)
  x: number;
  y: number;
};

export type Room = {
  id: string;
  title: string;
  icon: string;
  x: number;
  y: number;
  points: string;
  fill: string;
  objects: SceneObject[];
};

// План этажа: верхняя грань дома, разделённая на четыре комнаты
export const ROOMS: Room[] = [
  {
    id: 'kitchen',
    title: 'Кухня',
    icon: '🍳',
    x: 200,
    y: 118,
    points: '200,100 255,127.5 200,155 145,127.5',
    fill: '#F5E9D2',
    // Координаты подобраны так, чтобы кружки и подписи трёх чипов не
    // наезжали друг на друга: подпись висит под кружком, и «Холодильник»
    // шире всех — ему правый угол, где снизу пусто
    objects: [
      { id: 'sink', title: 'Мойка', icon: '🚰', place: 'Кухня', x: 158, y: 124 },
      { id: 'stove', title: 'Плита', icon: '🔥', place: 'Кухня', x: 196, y: 152 },
      { id: 'fridge', title: 'Холодильник', icon: '❄️', place: 'Кухня', x: 245, y: 125 },
    ],
  },
  {
    id: 'living',
    title: 'Гостиная',
    icon: '🛋️',
    x: 255,
    y: 153,
    points: '255,127.5 310,155 255,182.5 200,155',
    fill: '#E3ECDB',
    objects: [
      { id: 'light', title: 'Свет', icon: '💡', place: 'Гостиная', x: 238, y: 152 },
      { id: 'ac', title: 'Кондиционер', icon: '🌬️', place: 'Гостиная', x: 296, y: 158 },
    ],
  },
  {
    id: 'bath',
    title: 'Ванная',
    icon: '🛁',
    x: 200,
    y: 188,
    points: '200,155 255,182.5 200,210 145,182.5',
    fill: '#D9E7E9',
    objects: [
      { id: 'shower', title: 'Душ', icon: '🚿', place: 'Ванная', x: 174, y: 170 },
      { id: 'pipe', title: 'Труба', icon: '🔧', place: 'Ванная', x: 234, y: 188 },
      { id: 'washer', title: 'Стиральная машина', icon: '👕', place: 'Ванная', x: 200, y: 208 },
    ],
  },
  {
    id: 'bedroom',
    title: 'Спальня',
    icon: '🛏️',
    x: 145,
    y: 153,
    points: '145,127.5 200,155 145,182.5 90,155',
    fill: '#EFE4EE',
    objects: [
      { id: 'socket', title: 'Розетка', icon: '🔌', place: 'Спальня', x: 119, y: 143 },
      { id: 'window', title: 'Окно', icon: '🪟', place: 'Спальня', x: 175, y: 167 },
    ],
  },
];

// Объекты во дворе и в гараже — доступны сразу при выборе вкладки.
// Двор заодно отвечает за то, что видно с улицы: входную дверь, крышу,
// котёл у стены — в план комнат они не ложатся, а со двора до них рукой
// подать. Координаты подобраны, чтобы кружок одного чипа не наезжал на
// подпись соседнего: подпись висит под кружком и шире него.
const AREA_OBJECTS: Record<'Двор' | 'Гараж', SceneObject[]> = {
  Двор: [
    { id: 'lawn', title: 'Газон', icon: '🌿', place: 'Двор', x: 283, y: 262 },
    { id: 'trees', title: 'Деревья', icon: '🌳', place: 'Двор', x: 332, y: 214 },
    { id: 'door', title: 'Входная дверь', icon: '🚪', place: 'Вход в дом', x: 251, y: 222 },
    { id: 'roof', title: 'Крыша', icon: '🏠', place: 'Дом', x: 200, y: 160 },
    { id: 'boiler', title: 'Котёл и бойлер', icon: '♨️', place: 'Котельная', x: 198, y: 246 },
    { id: 'septic', title: 'Септик', icon: '🕳️', place: 'Двор', x: 256, y: 304 },
    { id: 'fence', title: 'Забор и навес', icon: '🧱', place: 'Двор', x: 352, y: 284 },
  ],
  Гараж: [
    { id: 'gate', title: 'Ворота', icon: '🚪', place: 'Гараж', x: 104, y: 290 },
    { id: 'tools', title: 'Инструменты', icon: '🧰', place: 'Гараж', x: 64, y: 244 },
    { id: 'panel', title: 'Щиток', icon: '⚡', place: 'Гараж', x: 158, y: 252 },
  ],
};

// Все объекты сцены одним списком, по вкладкам. Нужен шторке «Выбрать из
// списка»: изометрия — витрина, но не единственная дверь. Кому-то список
// привычнее картинки, скринридер читает только его, а котёл или септик
// глазами на сцене можно и не найти.
export const SCENE_OBJECT_GROUPS: { area: AreaId; objects: SceneObject[] }[] = [
  { area: 'Дом', objects: ROOMS.flatMap((room) => room.objects) },
  { area: 'Двор', objects: AREA_OBJECTS['Двор'] },
  { area: 'Гараж', objects: AREA_OBJECTS['Гараж'] },
];

// Центр «кадра»: куда камера привозит выбранную точку
const CX = 200;
const CY = 170;

// Куда смотрит камера в каждом состоянии: s — зум, x/y — точка интереса
function cameraTarget(area: AreaId, stage: Stage, room: Room | null, hasObject: boolean) {
  if (area === 'Двор') return { s: hasObject ? 1.5 : 1.35, x: 300, y: 235 };
  if (area === 'Гараж') return { s: hasObject ? 1.6 : 1.45, x: 92, y: 265 };
  if (stage === 'exterior') return { s: 1, x: CX, y: CY };
  if (stage === 'open' || !room) return { s: 1.16, x: 200, y: 150 };
  return { s: hasObject ? 2.0 : 1.8, x: room.x, y: room.y };
}

// Вдох-выдох: 0 в начале и в конце периода, 1 в середине
function wave(phase: number) {
  'worklet';
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

// Качание: 0 в покое, ±1 по краям размаха
function swing(phase: number) {
  'worklet';
  return Math.sin(2 * Math.PI * phase);
}

type Props = {
  area: AreaId;
  stage: Stage;
  roomId: string | null;
  focusedObjectId: string | null;
  onOpenHouse: () => void;
  onSelectRoom: (room: Room) => void;
  onSelectObject: (obj: SceneObject) => void;
  onBack: () => void;
  // Сцену не видно: другая вкладка, открытая шторка, режим мастера.
  // Фоновые циклы на это время останавливаются.
  paused?: boolean;
};

export function HouseScene({
  area,
  stage,
  roomId,
  focusedObjectId,
  onOpenHouse,
  onSelectRoom,
  onSelectObject,
  onBack,
  paused,
}: Props) {
  const [w, setW] = useState(0);
  const k = w / 400; // масштаб: координаты сцены → пиксели экрана

  // Ночь приходит вместе с тёмной темой приложения
  const { mode } = useTheme();
  const night = mode === 'dark';
  const P = night ? NIGHT : DAY;

  // «Камера»: масштаб и смещение всей сцены
  const cs = useSharedValue(1);
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  // Прогресс «открытия» дома: 0 — крыша на месте, 1 — виден план комнат
  const openP = useSharedValue(0);
  // Фазы бесконечных циклов: 0…1 по кругу, а само значение берётся синусом от
  // фазы. Поэтому ноль — это состояние покоя, и цикл можно оборвать в любой
  // момент, вернув фазу в ноль, а не доигрывая период до конца.
  const breath = useSharedValue(0);
  // Амплитуда дыхания отдельно от фазы: при входе в дом она гаснет плавно
  const breathOn = useSharedValue(1);
  const sway = useSharedValue(0);
  const drift = useSharedValue(0);
  const prevStage = useRef<Stage>('exterior');

  const reduceMotion = useReducedMotion();
  // Циклы живут на UI-потоке и сами не заканчиваются. Без этого дом дышал, а
  // облака плыли и под другой вкладкой, и под открытой шторкой: работа, которой
  // никто не видит, но за которую платит батарея.
  const idle = !!paused || reduceMotion;

  // Деревья и облака двигаются, только пока сцену видно
  useEffect(() => {
    if (idle) {
      // При фазе 0 первое облако стоит за краем кадра — в покое сдвигаем их так,
      // чтобы небо не выглядело пустым
      drift.value = reduceMotion ? 0.25 : 0;
      return;
    }
    sway.value = 0;
    drift.value = 0;
    sway.value = withRepeat(withTiming(1, { duration: 11200, easing: Easing.linear }), -1, false);
    drift.value = withRepeat(withTiming(1, { duration: 80000, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(sway);
      cancelAnimation(drift);
      sway.value = 0;
    };
  }, [idle, reduceMotion, drift, sway]);

  // Дыхание дома: замирает внутри дома и полностью останавливается, когда
  // сцены не видно
  useEffect(() => {
    if (idle || stage !== 'exterior') {
      // Сперва гаснет амплитуда — оборвать цикл сразу значило бы бросить дом
      // на полувдохе, — и только по её окончании останавливается сама фаза
      breathOn.value = withTiming(0, { duration: 600 }, (done) => {
        if (done) {
          cancelAnimation(breath);
          breath.value = 0;
        }
      });
      return;
    }
    breath.value = 0;
    breath.value = withRepeat(withTiming(1, { duration: 8400, easing: Easing.linear }), -1, false);
    breathOn.value = withTiming(1, { duration: 600 });
    return () => cancelAnimation(breath);
  }, [idle, stage, breath, breathOn]);

  // Камера плавно едет к цели при каждой смене состояния
  useEffect(() => {
    if (k <= 0) return;
    const room = ROOMS.find((r) => r.id === roomId) ?? null;
    const t = cameraTarget(area, stage, room, focusedObjectId != null);
    // Вход в дом — самый «киношный» переход, остальное — обычная навигация
    const cfg = stage === 'open' && prevStage.current === 'exterior' ? springs.hero : springs.nav;
    prevStage.current = stage;
    cs.value = withSpring(t.s, cfg);
    cx.value = withSpring((CX - t.x) * t.s * k, cfg);
    cy.value = withSpring((CY - t.y) * t.s * k, cfg);
  }, [area, stage, roomId, focusedObjectId, k, cs, cx, cy]);

  // Крыша поднимается, стены становятся полупрозрачными, дыхание замирает
  useEffect(() => {
    const open = stage !== 'exterior';
    openP.value = withSpring(open ? 1 : 0, springs.hero);
    breathOn.value = withTiming(open ? 0 : 1, { duration: 600 });
  }, [stage, breathOn, openP]);

  const cameraStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cx.value }, { translateY: cy.value }, { scale: cs.value }],
  }));

  const houseStyle = useAnimatedStyle(() => {
    const b = wave(breath.value) * breathOn.value;
    return { transform: [{ translateY: -2.6 * b * k }, { scale: 1 + 0.005 * b }] };
  });

  // Непрозрачность самой тени задаёт градиент в разметке; здесь только
  // дыхание — тень слабеет и сжимается, когда дом «поднимается»
  const shadowStyle = useAnimatedStyle(() => {
    const b = wave(breath.value) * breathOn.value;
    return { opacity: 0.9 - 0.25 * b, transform: [{ scale: 1 - 0.02 * b }] };
  });

  const roofStyle = useAnimatedStyle(() => ({
    opacity: interpolate(openP.value, [0, 0.55, 1], [1, 0.85, 0], Extrapolation.CLAMP),
    transform: [{ translateY: -76 * openP.value * k }, { scale: 1 + 0.05 * openP.value }],
  }));

  const wallsStyle = useAnimatedStyle(() => ({
    opacity: 1 - 0.62 * openP.value,
  }));

  const floorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(openP.value, [0.3, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: (1 - openP.value) * 10 * k }],
  }));

  const tree1Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${1.2 * swing(sway.value)}deg` }],
  }));
  // Второе дерево качается в противоход первому и слабее — иначе лужайка
  // выглядит как один механизм
  const tree2Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-0.9 * swing(sway.value)}deg` }],
  }));

  // Внутри дома облака гаснут, чтобы не отвлекать от плана комнат
  const cloud1Style = useAnimatedStyle(() => ({
    opacity: 0.9 * (1 - openP.value),
    transform: [{ translateX: interpolate(drift.value, [0, 1], [-140, 420]) * k }],
  }));
  const cloud2Style = useAnimatedStyle(() => ({
    opacity: 0.7 * (1 - openP.value),
    transform: [{ translateX: interpolate((drift.value + 0.45) % 1, [0, 1], [-140, 420]) * k }],
  }));

  // Луна не плывёт — висит; внутри дома гаснет, как и облака
  const moonStyle = useAnimatedStyle(() => ({
    opacity: 0.95 * (1 - openP.value),
  }));

  const focusedRoom = ROOMS.find((r) => r.id === roomId) ?? null;
  const areaObjects = area === 'Дом' ? null : AREA_OBJECTS[area];

  return (
    <View
      style={[styles.scene, { backgroundColor: P.sky, borderColor: P.sceneBorder }]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      {w > 0 && (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, cameraStyle]}>
            {/* Земля: лужайка, дорожка, гараж */}
            <Layer>
              <Rect
                x={18}
                y={150}
                width={364}
                height={172}
                rx={56}
                fill={P.ground}
                stroke={P.groundStroke}
                strokeWidth={1.5}
              />
              <Polygon points="244,252 294,277 320,264 270,239" fill={P.path} />
              <Polygon
                points="80,238 124,260 84,280 40,258"
                fill={P.garage[0]}
                stroke={P.lineSoft}
                strokeWidth={2}
                strokeOpacity={0.6}
              />
              <Polygon points="124,260 84,280 84,306 124,286" fill={P.garage[1]} />
              <Polygon points="40,258 84,280 84,306 40,284" fill={P.garage[2]} />
              <Polygon points="92,302 116,290 116,272 92,284" fill={P.garage[3]} />
              <Line
                x1={92}
                y1={296}
                x2={116}
                y2={284}
                stroke={P.lineSoft}
                strokeWidth={1.5}
                strokeOpacity={0.55}
              />
              <Line
                x1={92}
                y1={290}
                x2={116}
                y2={278}
                stroke={P.lineSoft}
                strokeWidth={1.5}
                strokeOpacity={0.55}
              />
            </Layer>

            {/* Тень дома: дышит в противофазе с ним. Радиальный градиент, а
                не плоская заливка: у настоящей тени нет жёсткой кромки, и
                эллипс с чётким краем читался как тёмная лужа рядом с домом,
                а не как тень под ним */}
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  left: 100 * k,
                  top: 256 * k,
                  width: 200 * k,
                  height: 32 * k,
                },
                shadowStyle,
              ]}
            >
              <Svg width="100%" height="100%" viewBox="0 0 200 32">
                <Defs>
                  <RadialGradient id="houseShadow" cx="50%" cy="50%" rx="50%" ry="50%">
                    <Stop offset="0%" stopColor="#22301E" stopOpacity={0.16} />
                    <Stop offset="65%" stopColor="#22301E" stopOpacity={0.08} />
                    <Stop offset="100%" stopColor="#22301E" stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Ellipse cx={100} cy={16} rx={98} ry={14} fill="url(#houseShadow)" />
              </Svg>
            </Animated.View>

            {/* Дом: дышащая группа — стены, план комнат, крыша */}
            <Animated.View style={[StyleSheet.absoluteFill, houseStyle]} pointerEvents="box-none">
              <Animated.View style={[StyleSheet.absoluteFill, wallsStyle]} pointerEvents="none">
                <Layer>
                  <Polygon points="90,155 200,210 200,268 90,213" fill={P.wallLeft} />
                  <Polygon points="310,155 200,210 200,268 310,213" fill={P.wallRight} />
                  <Polygon points="238,249 264,236 264,200 238,213" fill={P.door} />
                  <Circle cx={259} cy={222} r={1.6} fill={P.doorKnob} />
                  <Polygon
                    points="110,223 136,236 136,210 110,197"
                    fill={P.windowGlass}
                    stroke={P.windowFrame}
                    strokeWidth={2}
                  />
                  <Line
                    x1={123}
                    y1={203.5}
                    x2={123}
                    y2={229.5}
                    stroke={P.windowFrame}
                    strokeWidth={1.5}
                  />
                </Layer>
              </Animated.View>

              {/* План этажа: появляется, когда крыша уходит */}
              <Animated.View style={[StyleSheet.absoluteFill, floorStyle]} pointerEvents="none">
                <Layer>
                  <Polygon
                    points="200,100 310,155 200,210 90,155"
                    fill={P.planBase}
                    stroke={P.planStroke}
                    strokeWidth={1}
                  />
                </Layer>
                {ROOMS.map((room) => (
                  <RoomLayer
                    key={room.id}
                    room={room}
                    fill={night ? (NIGHT_ROOM_FILLS[room.id] ?? room.fill) : room.fill}
                    stroke={P.lineSoft}
                    hidden={stage === 'room' && roomId !== room.id}
                  />
                ))}
              </Animated.View>

              {/* Крыша: поднимается вверх и растворяется */}
              <Animated.View style={[StyleSheet.absoluteFill, roofStyle]} pointerEvents="none">
                <Layer>
                  <Polygon points="200,100 90,155 145,89.5" fill={P.roof[0]} />
                  <Polygon points="200,100 310,155 255,144.5 145,89.5" fill={P.roof[1]} />
                  <Polygon points="90,155 200,210 255,144.5 145,89.5" fill={P.roof[2]} />
                  <Polygon points="310,155 200,210 255,144.5" fill={P.roof[3]} />
                  <Line
                    x1={145}
                    y1={89.5}
                    x2={255}
                    y2={144.5}
                    stroke={P.lineSoft}
                    strokeWidth={1.5}
                    strokeOpacity={0.25}
                  />
                  <Polygon points="222,98 234,104 222,110 210,104" fill={P.chimney[0]} />
                  <Polygon points="210,104 222,110 222,124 210,118" fill={P.chimney[1]} />
                  <Polygon points="222,110 234,104 234,118 222,124" fill={P.chimney[2]} />
                </Layer>
              </Animated.View>
            </Animated.View>

            {/* Деревья: качаются вокруг основания, едва заметно */}
            <Tree k={k} x={308} y={166} w={60} h={84} style={tree1Style} palette={P} />
            <Tree k={k} x={26} y={148} w={45} h={63} style={tree2Style} palette={P} />

            {/* Днём по небу плывут облака, ночью висит луна */}
            {night ? (
              <Moon k={k} style={moonStyle} />
            ) : (
              <>
                <Cloud k={k} y={14} w={68} h={30} style={cloud1Style} />
                <Cloud k={k} y={44} w={54} h={24} style={cloud2Style} />
              </>
            )}

            {/* Иконки комнат: появляются по очереди после подъёма крыши */}
            {stage !== 'exterior' &&
              ROOMS.map((room, i) => (
                <RoomChip
                  key={room.id}
                  room={room}
                  k={k}
                  index={i}
                  labelColor={P.label}
                  visible={stage !== 'room'}
                  onPress={() => onSelectRoom(room)}
                />
              ))}

            {/* Объекты выбранной комнаты (или двора/гаража) */}
            {(stage === 'room' && focusedRoom ? focusedRoom.objects : (areaObjects ?? [])).map(
              (obj, i) => (
                <ObjectChip
                  key={obj.id}
                  obj={obj}
                  k={k}
                  index={i}
                  labelColor={P.objectLabel}
                  focused={focusedObjectId === obj.id}
                  onPress={() => onSelectObject(obj)}
                />
              ),
            )}
          </Animated.View>

          {/* Тап по дому открывает его — только на «внешнем» виде */}
          {area === 'Дом' && stage === 'exterior' && (
            <Pressable
              style={styles.houseTap}
              onPress={onOpenHouse}
              accessibilityRole="button"
              accessibilityLabel="Открыть план дома"
            />
          )}

          {/* Кнопка «назад»: шаг наружу, сохраняя ориентацию */}
          {stage !== 'exterior' && (
            <Animated.View
              entering={FadeInDown.delay(200).duration(300)}
              exiting={FadeOut.duration(180)}
              style={styles.backWrap}
            >
              <PressableScale style={styles.backChip} onPress={onBack}>
                <Text style={styles.backText}>‹ Назад</Text>
              </PressableScale>
            </Animated.View>
          )}
        </>
      )}
    </View>
  );
}

// Полноразмерный SVG-слой сцены
function Layer({ children }: { children: ReactNode }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 400 340">
        {children}
      </Svg>
    </View>
  );
}

// Комната на плане. Когда выбрана другая, эта уходит совсем, а не бледнеет:
// полупрозрачные соседние комнаты просвечивали сквозь объекты выбранной и
// читались как часть неё.
function RoomLayer({
  room,
  fill,
  stroke,
  hidden,
}: {
  room: Room;
  fill: string;
  stroke: string;
  hidden: boolean;
}) {
  // Анимация запускается из эффекта, а не изнутри useAnimatedStyle: там она
  // пересоздавалась бы на каждой перерисовке и могла оборваться на полпути
  const opacity = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    opacity.value = withTiming(hidden ? 0 : 1, { duration: 320 });
  }, [hidden, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Layer>
        <Polygon
          points={room.points}
          fill={fill}
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      </Layer>
    </Animated.View>
  );
}

// Подпись комнаты на плане.
//
// Внутри комнаты не показывается ни одна: раньше соседние гасли до 25% и
// оставались читаемыми — «Спальня» и «Гостиная» просвечивали сквозь мойку
// и плиту, и было непонятно, где ты находишься. Промежуточного состояния
// больше нет, поэтому и видимость теперь одним флагом.
function RoomChip({
  room,
  k,
  index,
  labelColor,
  visible,
  onPress,
}: {
  room: Room;
  k: number;
  index: number;
  labelColor: string;
  visible: boolean;
  onPress: () => void;
}) {
  const target = visible ? 1 : 0;
  const opacity = useSharedValue(target);
  useEffect(() => {
    opacity.value = withTiming(target, { duration: 320 });
  }, [target, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      entering={FadeInDown.delay(140 + index * 65).duration(340)}
      exiting={FadeOut.duration(220)}
      style={[
        { position: 'absolute', left: room.x * k - 40, top: room.y * k - 26, width: 80 },
        style,
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <PressableScale
        style={styles.roomChipInner}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Комната: ${room.title}`}
      >
        <View style={styles.roomCircle}>
          <Glyph glyph={room.icon} size={22} textStyle={styles.roomIcon} />
        </View>
        <Text style={[styles.roomLabel, { color: labelColor }]}>{room.title}</Text>
      </PressableScale>
    </Animated.View>
  );
}

function ObjectChip({
  obj,
  k,
  index,
  labelColor,
  focused,
  onPress,
}: {
  obj: SceneObject;
  k: number;
  index: number;
  labelColor: string;
  focused: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(focused ? 1.08 : 1);
  useEffect(() => {
    scale.value = withSpring(focused ? 1.08 : 1, springs.micro);
  }, [focused, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      entering={FadeInDown.delay(160 + index * 70).duration(320)}
      exiting={FadeOut.duration(200)}
      style={[
        {
          position: 'absolute',
          left: obj.x * k - 45,
          top: obj.y * k - 17,
          width: 90,
          alignItems: 'center',
        },
        style,
      ]}
    >
      <PressableScale
        style={styles.objectChipInner}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${obj.title} — ${obj.place}`}
      >
        <View style={[styles.objectCircle, focused && styles.objectCircleFocused]}>
          {hasObjectIcon(obj.id) ? (
            <ObjectIcon id={obj.id} size={20} />
          ) : (
            <Text style={styles.objectIcon}>{obj.icon}</Text>
          )}
        </View>
        <Text style={[styles.objectText, { color: labelColor }]}>{obj.title}</Text>
      </PressableScale>
    </Animated.View>
  );
}

function Tree({
  k,
  x,
  y,
  w,
  h,
  style,
  palette,
}: {
  k: number;
  x: number;
  y: number;
  w: number;
  h: number;
  style: object;
  palette: ScenePalette;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: x * k,
          top: y * k,
          width: w * k,
          height: h * k,
          transformOrigin: '50% 100%',
        },
        style,
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 60 84">
        <Rect x={27.5} y={58} width={5} height={20} rx={2.5} fill={palette.trunk} />
        <Circle cx={30} cy={36} r={19} fill={palette.crowns[0]} />
        <Circle cx={18} cy={46} r={12} fill={palette.crowns[1]} />
        <Circle cx={43} cy={45} r={13} fill={palette.crowns[2]} />
      </Svg>
    </Animated.View>
  );
}

// Луна с парой кратеров и три звезды — всё небо ночной сцены
function Moon({ k, style }: { k: number; style: object }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: 296 * k, top: 16 * k, width: 72 * k, height: 46 * k },
        style,
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 72 46">
        <Circle cx={30} cy={23} r={14} fill="#EDE8CF" />
        <Circle cx={25} cy={19} r={3} fill="#DDD6B8" />
        <Circle cx={35} cy={27} r={2.2} fill="#DDD6B8" />
        <Circle cx={31} cy={13.5} r={1.6} fill="#DDD6B8" />
        <Circle cx={58} cy={9} r={1.5} fill="#EDE8CF" opacity={0.8} />
        <Circle cx={64} cy={30} r={1.2} fill="#EDE8CF" opacity={0.6} />
        <Circle cx={6} cy={12} r={1.2} fill="#EDE8CF" opacity={0.6} />
      </Svg>
    </Animated.View>
  );
}

function Cloud({
  k,
  y,
  w,
  h,
  style,
}: {
  k: number;
  y: number;
  w: number;
  h: number;
  style: object;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, top: y * k, width: w * k, height: h * k }, style]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 68 30">
        <Ellipse cx={20} cy={18} rx={11} ry={8} fill="#FFFFFF" />
        <Ellipse cx={36} cy={13} rx={14} ry={10} fill="#FFFFFF" />
        <Ellipse cx={50} cy={18} rx={10} ry={7} fill="#FFFFFF" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scene: {
    width: '100%',
    aspectRatio: 400 / 340,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#F6FAF3',
    borderWidth: 1,
    borderColor: '#E6E9E1',
  },
  houseTap: {
    position: 'absolute',
    left: '22%',
    top: '18%',
    width: '56%',
    height: '58%',
  },
  backWrap: { position: 'absolute', top: 12, left: 12 },
  backChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E6E9E1',
    shadowColor: '#1F2B1C',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  backText: { fontWeight: '700', fontSize: 12.5, color: '#5E7A56' },
  roomChipInner: { alignItems: 'center' },
  roomCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1F2B1C',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  roomIcon: { fontSize: 19 },
  roomLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
    color: '#5E7A56',
    textAlign: 'center',
  },
  objectChipInner: { alignItems: 'center' },
  objectCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#1F2B1C',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  objectCircleFocused: { borderColor: '#5E7A56' },
  objectIcon: { fontSize: 15 },
  objectText: {
    marginTop: 3,
    fontSize: 9.5,
    fontWeight: '700',
    color: '#3C4A37',
    textAlign: 'center',
  },
});
