import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import { FONTS } from './typography';
import { hasObjectIcon, ObjectIcon } from './objectIcons';
import { SheetGrabber, useSheetDrag } from './sheetDrag';
import { SCENE_OBJECT_GROUPS, type SceneObject } from './HouseScene';

// Дом списком. Изометрия — витрина, но не единственная дверь: кому-то
// привычнее перечень, скринридер читает только его, а септик или щиток
// глазами на сцене можно и не найти. Список ведёт в ту же шторку заявки,
// что и тап по объекту, — путь один, входов два.

type Props = {
  onClose: () => void;
  onPick: (obj: SceneObject) => void;
};

export function ObjectListSheet({ onClose, onPick }: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const { gesture, cardStyle } = useSheetDrag(onClose);

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      <Animated.View
        entering={FadeIn.duration(260)}
        exiting={FadeOut.duration(220)}
        style={StyleSheet.absoluteFill}
      >
        <BlurView
          intensity={26}
          tint={mode === 'dark' ? 'dark' : 'light'}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <Pressable style={[StyleSheet.absoluteFill, styles.dim]} onPress={onClose} />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.springify().damping(19).stiffness(150).mass(1)}
        exiting={SlideOutDown.duration(280)}
        layout={LinearTransition.springify().damping(20).stiffness(170)}
        style={[styles.card, cardStyle]}
      >
        <SheetGrabber gesture={gesture} />

        <Animated.View entering={FadeIn.delay(90).duration(280)} style={styles.header}>
          <Text style={styles.title}>Что починить?</Text>
          <Text style={styles.subtitle}>Все объекты дома, двора и гаража</Text>
        </Animated.View>

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {SCENE_OBJECT_GROUPS.map((group) => (
            <View key={group.area}>
              <Text style={styles.groupLabel}>{group.area}</Text>
              {group.objects.map((obj) => (
                <PressableScale
                  key={obj.id}
                  style={styles.row}
                  onPress={() => onPick(obj)}
                  accessibilityRole="button"
                  accessibilityLabel={`${obj.title} — ${obj.place}`}
                >
                  <View style={styles.rowIcon}>
                    {hasObjectIcon(obj.id) ? (
                      <ObjectIcon
                        id={obj.id}
                        size={22}
                        colors={{ stroke: t.accent, fill: t.accentSoft, glass: t.blue }}
                      />
                    ) : (
                      <Text style={styles.rowEmoji}>{obj.icon}</Text>
                    )}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{obj.title}</Text>
                    <Text style={styles.rowPlace}>{obj.place}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </PressableScale>
              ))}
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: { justifyContent: 'flex-end' },
    dim: { backgroundColor: t.dim },
    card: {
      margin: 12,
      // Объектов два десятка: шторка держит рост, список прокручивается внутри
      maxHeight: '78%',
      borderRadius: 28,
      backgroundColor: t.card,
      padding: 20,
      paddingBottom: 14,
      shadowColor: t.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    header: { marginBottom: 10 },
    title: { fontSize: 17, fontFamily: FONTS.heading, color: t.text },
    subtitle: { fontSize: 12, color: t.textMuted, fontWeight: '600', marginTop: 2 },
    list: { flexGrow: 0 },
    groupLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: t.textMuted,
      marginTop: 10,
      marginBottom: 6,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      borderRadius: 14,
      paddingVertical: 9,
      paddingHorizontal: 10,
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
      marginBottom: 7,
    },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowEmoji: { fontSize: 17 },
    rowBody: { flex: 1 },
    rowTitle: { fontWeight: '700', fontSize: 13.5, color: t.text },
    rowPlace: { fontSize: 11, fontWeight: '600', color: t.textMuted, marginTop: 1 },
    chevron: { fontSize: 18, color: t.textMuted, fontWeight: '600' },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
