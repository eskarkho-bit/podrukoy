import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from '../components/PressableScale';
import { LEGAL_DOCS, type LegalDocId } from '../components/legal';

// Чтение документа. Тексты лежат в коде, поэтому открываются без сети —
// это важно: согласие нельзя дать вслепую, а связь может пропасть.

type Props = {
  docId: LegalDocId;
  onClose: () => void;
};

export function LegalScreen({ docId, onClose }: Props) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const doc = LEGAL_DOCS[docId];

  return (
    <Animated.View entering={FadeIn.duration(220)} style={[StyleSheet.absoluteFill, styles.root]}>
      <View style={styles.topBar}>
        <PressableScale style={styles.backChip} onPress={onClose}>
          <Text style={styles.backText}>‹ Назад</Text>
        </PressableScale>
        <View style={styles.backChipGhost} />
      </View>

      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <Animated.Text entering={FadeInDown.duration(360)} style={styles.title}>
          {doc.title}
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(40).duration(340)} style={styles.version}>
          Редакция от {doc.version}
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(80).duration(340)} style={styles.body}>
          {doc.body}
        </Animated.Text>
      </ScrollView>
    </Animated.View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    root: { backgroundColor: t.bg },
    fill: { flex: 1 },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingTop: 54,
      paddingBottom: 6,
    },
    backChip: { paddingVertical: 8, paddingHorizontal: 10 },
    backChipGhost: { width: 60 },
    backText: { color: t.accent, fontWeight: '800', fontSize: 13 },
    content: { padding: 20, paddingBottom: 70 },
    title: { fontSize: 19, fontWeight: '800', color: t.text },
    version: {
      fontSize: 11.5,
      fontWeight: '700',
      color: t.textMuted,
      marginTop: 4,
      marginBottom: 18,
    },
    body: { fontSize: 13, fontWeight: '500', color: t.text, lineHeight: 20 },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
