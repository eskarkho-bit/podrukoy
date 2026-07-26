import { ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Line, Polygon, Rect } from 'react-native-svg';
import { springs } from '../motion';
import { PressableScale } from './PressableScale';

export type AreaId = 'Дом' | 'Двор' | 'Гараж';
export type Stage = 'exterior' | 'open' | 'room';

export type SceneObject = {
  id: string;
  title: string;
  icon: string;
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
    id: 'kitchen', title: 'Кухня', icon: '🍳', x: 200, y: 118,
    points: '200,100 255,127.5 200,155 145,127.5', fill: '#F5E9D2',
    objects: [
      { id: 'sink', title: 'Мойка', icon: '🚰', place: 'Кухня', x: 170, y: 120 },
      { id: 'stove', title: 'Плита', icon: '🔥', place: 'Кухня', x: 228, y: 140 },
    ],
  },
  {
    id: 'living', title: 'Гостиная', icon: '🛋️', x: 255, y: 153,
    points: '255,127.5 310,155 255,182.5 200,155', fill: '#E3ECDB',
    objects: [
      { id: 'light', title: 'Свет', icon: '💡', place: 'Гостиная', x: 255, y: 155 },
    ],
  },
  {
    id: 'bath', title: 'Ванная', icon: '🛁', x: 200, y: 188,
    points: '200,155 255,182.5 200,210 145,182.5', fill: '#D9E7E9',
    objects: [
      { id: 'shower', title: 'Душ', icon: '🚿', place: 'Ванная', x: 174, y: 170 },
      { id: 'pipe', title: 'Труба', icon: '🔧', place: 'Ванная', x: 230, y: 192 },
    ],
  },
  {
    id: 'bedroom', title: 'Спальня', icon: '🛏️', x: 145, y: 153,
    points: '145,127.5 200,155 145,182.5 90,155', fill: '#EFE4EE',
    objects: [
      { id: 'socket', title: 'Розетка', icon: '🔌', place: 'Спальня', x: 119, y: 143 },
      { id: 'window', title: 'Окно', icon: '🪟', place: 'Спальня', x: 175, y: 167 },
    ],
  },
];

// Объекты во дворе и в гараже — доступны сразу при выборе вкладки
const AREA_OBJECTS: Record<'Двор' | 'Гараж', SceneObject[]> = {
  Двор: [
    { id: 'lawn', title: 'Газон', icon: '🌿', place: 'Двор', x: 283, y: 262 },
    { id: 'trees', title: 'Деревья', icon: '🌳', place: 'Двор', x: 332, y: 214 },
  ],
  Гараж: [
    { id: 'gate', title: 'Ворота', icon: '🚪', place: 'Гараж', x: 104, y: 290 },
    { id: 'tools', title: 'Инструменты', icon: '🧰', place: 'Гараж', x: 64, y: 244 },
  ],
};

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

type Props = {
  area: AreaId;
  stage: Stage;
  roomId: string | null;
  focusedObjectId: string | null;
  onOpenHouse: () => void;
  onSelectRoom: (room: Room) => void;
  onSelectObject: (obj: SceneObject) => void;
  onBack: () => void;
};

export function HouseScene({
  area, stage, roomId, focusedObjectId,
  onOpenHouse, onSelectRoom, onSelectObject, onBack,
}: Props) {
  const [w, setW] = useState(0);
  const k = w / 400; // масштаб: координаты сцены → пиксели экрана

  // «Камера»: масштаб и смещение всей сцены
  const cs = useSharedValue(1);
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  // Прогресс «открытия» дома: 0 — крыша на месте, 1 — виден план комнат
  const openP = useSharedValue(0);
  // Дыхание дома и его плавное отключение при входе внутрь
  const breath = useSharedValue(0);
  const breathOn = useSharedValue(1);
  const sway = useSharedValue(0);
  const drift = useSharedValue(0);
  const prevStage = useRef<Stage>('exterior');

  // Бесконечные, почти незаметные циклы: дыхание, покачивание деревьев, облака
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.sin) }), -1, true,
    );
    sway.value = withRepeat(
      withTiming(1, { duration: 5600, easing: Easing.inOut(Easing.sin) }), -1, true,
    );
    drift.value = withRepeat(
      withTiming(1, { duration: 80000, easing: Easing.linear }), -1, false,
    );
  }, []);

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
  }, [area, stage, roomId, focusedObjectId, k]);

  // Крыша поднимается, стены становятся полупрозрачными, дыхание замирает
  useEffect(() => {
    const open = stage !== 'exterior';
    openP.value = withSpring(open ? 1 : 0, springs.hero);
    breathOn.value = withTiming(open ? 0 : 1, { duration: 600 });
  }, [stage]);

  const cameraStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cx.value }, { translateY: cy.value }, { scale: cs.value }],
  }));

  const houseStyle = useAnimatedStyle(() => {
    const b = breath.value * breathOn.value;
    return { transform: [{ translateY: -2.6 * b * k }, { scale: 1 + 0.005 * b }] };
  });

  const shadowStyle = useAnimatedStyle(() => {
    const b = breath.value * breathOn.value;
    return { opacity: 0.09 - 0.02 * b, transform: [{ scale: 1 - 0.02 * b }] };
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
    transform: [{ rotate: `${interpolate(sway.value, [0, 1], [-1.2, 1.2])}deg` }],
  }));
  const tree2Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(sway.value, [0, 1], [0.9, -0.9])}deg` }],
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

  const focusedRoom = ROOMS.find((r) => r.id === roomId) ?? null;
  const areaObjects = area === 'Дом' ? null : AREA_OBJECTS[area];

  return (
    <View style={styles.scene} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, cameraStyle]}>
            {/* Земля: лужайка, дорожка, гараж */}
            <Layer>
              <Rect x={18} y={150} width={364} height={172} rx={56} fill="#E4EDDC" stroke="#D8E4CC" strokeWidth={1.5} />
              <Polygon points="244,252 294,277 320,264 270,239" fill="#ECEAE0" />
              <Polygon points="80,238 124,260 84,280 40,258" fill="#DCE6D2" stroke="#FFFFFF" strokeWidth={2} strokeOpacity={0.6} />
              <Polygon points="124,260 84,280 84,306 124,286" fill="#F6F4EC" />
              <Polygon points="40,258 84,280 84,306 40,284" fill="#EAE7DD" />
              <Polygon points="92,302 116,290 116,272 92,284" fill="#D5DCCB" />
              <Line x1={92} y1={296} x2={116} y2={284} stroke="#FFFFFF" strokeWidth={1.5} strokeOpacity={0.55} />
              <Line x1={92} y1={290} x2={116} y2={278} stroke="#FFFFFF" strokeWidth={1.5} strokeOpacity={0.55} />
            </Layer>

            {/* Тень дома: дышит в противофазе с ним */}
            <Animated.View
              pointerEvents="none"
              style={[
                { position: 'absolute', left: 80 * k, top: 250 * k, width: 240 * k, height: 44 * k },
                shadowStyle,
              ]}
            >
              <Svg width="100%" height="100%" viewBox="0 0 240 44">
                <Ellipse cx={120} cy={22} rx={118} ry={20} fill="#22301E" />
              </Svg>
            </Animated.View>

            {/* Дом: дышащая группа — стены, план комнат, крыша */}
            <Animated.View style={[StyleSheet.absoluteFill, houseStyle]} pointerEvents="box-none">
              <Animated.View style={[StyleSheet.absoluteFill, wallsStyle]} pointerEvents="none">
                <Layer>
                  <Polygon points="90,155 200,210 200,268 90,213" fill="#ECE9E0" />
                  <Polygon points="310,155 200,210 200,268 310,213" fill="#F8F6EF" />
                  <Polygon points="238,249 264,236 264,200 238,213" fill="#6E8A64" />
                  <Circle cx={259} cy={222} r={1.6} fill="#F2F5F0" />
                  <Polygon points="110,223 136,236 136,210 110,197" fill="#C7D6E0" stroke="#FFFFFF" strokeWidth={2} />
                  <Line x1={123} y1={203.5} x2={123} y2={229.5} stroke="#FFFFFF" strokeWidth={1.5} />
                </Layer>
              </Animated.View>

              {/* План этажа: появляется, когда крыша уходит */}
              <Animated.View style={[StyleSheet.absoluteFill, floorStyle]} pointerEvents="none">
                <Layer>
                  <Polygon points="200,100 310,155 200,210 90,155" fill="#FBF9F3" stroke="#E8E5DA" strokeWidth={1} />
                </Layer>
                {ROOMS.map((room) => (
                  <RoomLayer
                    key={room.id}
                    room={room}
                    dimmed={stage === 'room' && roomId !== room.id}
                  />
                ))}
              </Animated.View>

              {/* Крыша: поднимается вверх и растворяется */}
              <Animated.View style={[StyleSheet.absoluteFill, roofStyle]} pointerEvents="none">
                <Layer>
                  <Polygon points="200,100 90,155 145,89.5" fill="#708A66" />
                  <Polygon points="200,100 310,155 255,144.5 145,89.5" fill="#7E9873" />
                  <Polygon points="90,155 200,210 255,144.5 145,89.5" fill="#9CB48E" />
                  <Polygon points="310,155 200,210 255,144.5" fill="#F3F1E8" />
                  <Line x1={145} y1={89.5} x2={255} y2={144.5} stroke="#FFFFFF" strokeWidth={1.5} strokeOpacity={0.25} />
                  <Polygon points="222,98 234,104 222,110 210,104" fill="#F0ECE0" />
                  <Polygon points="210,104 222,110 222,124 210,118" fill="#E8E4D6" />
                  <Polygon points="222,110 234,104 234,118 222,124" fill="#DDD8C8" />
                </Layer>
              </Animated.View>
            </Animated.View>

            {/* Деревья: качаются вокруг основания, едва заметно */}
            <Tree k={k} x={308} y={166} w={60} h={84} style={tree1Style} />
            <Tree k={k} x={26} y={148} w={45} h={63} style={tree2Style} />

            {/* Облака: медленно плывут через сцену */}
            <Cloud k={k} y={14} w={68} h={30} style={cloud1Style} />
            <Cloud k={k} y={44} w={54} h={24} style={cloud2Style} />

            {/* Иконки комнат: появляются по очереди после подъёма крыши */}
            {stage !== 'exterior' &&
              ROOMS.map((room, i) => (
                <RoomChip
                  key={room.id}
                  room={room}
                  k={k}
                  index={i}
                  mode={stage === 'room' ? (roomId === room.id ? 'hidden' : 'dim') : 'normal'}
                  onPress={() => onSelectRoom(room)}
                />
              ))}

            {/* Объекты выбранной комнаты (или двора/гаража) */}
            {(stage === 'room' && focusedRoom ? focusedRoom.objects : areaObjects ?? []).map(
              (obj, i) => (
                <ObjectChip
                  key={obj.id}
                  obj={obj}
                  k={k}
                  index={i}
                  focused={focusedObjectId === obj.id}
                  onPress={() => onSelectObject(obj)}
                />
              ),
            )}
          </Animated.View>

          {/* Тап по дому открывает его — только на «внешнем» виде */}
          {area === 'Дом' && stage === 'exterior' && (
            <Pressable style={styles.houseTap} onPress={onOpenHouse} />
          )}

          {/* Кнопка «назад»: шаг наружу, сохраняя ориентацию */}
          {stage !== 'exterior' && (
            <Animated.View
              entering={FadeInDown.delay(200).duration(300)}
              exiting={FadeOut.duration(180)}
              style={styles.backWrap}
            >
              <PressableScale style={styles.backChip} onPress={onBack}>
                <Text style={styles.backText}>‹  Назад</Text>
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

// Комната на плане: гаснет до 25%, когда выбрана другая
function RoomLayer({ room, dimmed }: { room: Room; dimmed: boolean }) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(dimmed ? 0.25 : 1, { duration: 320 }),
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Layer>
        <Polygon
          points={room.points}
          fill={room.fill}
          stroke="#FFFFFF"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      </Layer>
    </Animated.View>
  );
}

function RoomChip({
  room, k, index, mode, onPress,
}: {
  room: Room; k: number; index: number;
  mode: 'normal' | 'dim' | 'hidden';
  onPress: () => void;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(mode === 'normal' ? 1 : mode === 'dim' ? 0.25 : 0, { duration: 320 }),
  }));
  return (
    <Animated.View
      entering={FadeInDown.delay(140 + index * 65).duration(340)}
      exiting={FadeOut.duration(220)}
      style={[{ position: 'absolute', left: room.x * k - 40, top: room.y * k - 26, width: 80 }, style]}
      pointerEvents={mode === 'normal' ? 'auto' : 'none'}
    >
      <PressableScale style={styles.roomChipInner} onPress={onPress}>
        <View style={styles.roomCircle}>
          <Text style={styles.roomIcon}>{room.icon}</Text>
        </View>
        <Text style={styles.roomLabel}>{room.title}</Text>
      </PressableScale>
    </Animated.View>
  );
}

function ObjectChip({
  obj, k, index, focused, onPress,
}: {
  obj: SceneObject; k: number; index: number; focused: boolean; onPress: () => void;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(focused ? 1.08 : 1, springs.micro) }],
  }));
  return (
    <Animated.View
      entering={FadeInDown.delay(160 + index * 70).duration(320)}
      exiting={FadeOut.duration(200)}
      style={[
        { position: 'absolute', left: obj.x * k - 45, top: obj.y * k - 17, width: 90, alignItems: 'center' },
        style,
      ]}
    >
      <PressableScale style={styles.objectChipInner} onPress={onPress}>
        <View style={[styles.objectCircle, focused && styles.objectCircleFocused]}>
          <Text style={styles.objectIcon}>{obj.icon}</Text>
        </View>
        <Text style={styles.objectText}>{obj.title}</Text>
      </PressableScale>
    </Animated.View>
  );
}

function Tree({
  k, x, y, w, h, style,
}: {
  k: number; x: number; y: number; w: number; h: number; style: object;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: x * k, top: y * k, width: w * k, height: h * k, transformOrigin: '50% 100%' },
        style,
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 60 84">
        <Rect x={27.5} y={58} width={5} height={20} rx={2.5} fill="#B49B7D" />
        <Circle cx={30} cy={36} r={19} fill="#9CB88C" />
        <Circle cx={18} cy={46} r={12} fill="#8AA97A" />
        <Circle cx={43} cy={45} r={13} fill="#A9C29A" />
      </Svg>
    </Animated.View>
  );
}

function Cloud({
  k, y, w, h, style,
}: {
  k: number; y: number; w: number; h: number; style: object;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: 0, top: y * k, width: w * k, height: h * k },
        style,
      ]}
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
