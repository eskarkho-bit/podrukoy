import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import { counted } from './format';
import { OPEN_SETTLEMENTS, searchSettlements, settlementKey, type Settlement } from './cities';

// Выбор населённого пункта.
//
// Список, а не поле ввода: свободный текст разводил один город на несколько
// написаний, и мастер из «Грозного» не видел заявок из «грозного». Раз обе
// стороны выбирают из одного списка, совпадение гарантировано.
//
// С поиском, потому что в полном списке около полутора сотен пунктов, и он
// ещё пригодится: сейчас выбор сужен до открытых городов, но список цел.

/**
 * Почему в списке мало пунктов.
 *
 * Человек, набравший «Аргун» и не нашедший его, иначе решит, что ошибся
 * в написании, и будет пробовать снова. Текст считается от открытого
 * списка — открыли город, надпись поменялась сама.
 */
const openNote =
  OPEN_SETTLEMENTS.length === 1
    ? `Пока мы работаем только в одном городе — ${OPEN_SETTLEMENTS[0]?.name ?? ''}.`
    : `Пока мы работаем в ${counted(OPEN_SETTLEMENTS.length, 'городе', 'городах', 'городах')}.`;

type Props = {
  onClose: () => void;
  title?: string;
} &
  // Клиент живёт в одном месте и выбирает один пункт — список закрывается сразу
  (
    | { mode?: 'single'; value: string; onSelect: (key: string, name: string) => void }
    // Мастер выезжает в несколько: отмечает их и подтверждает кнопкой
    | { mode: 'multi'; values: string[]; onToggle: (key: string) => void }
  );

export function CityPicker(props: Props) {
  const { onClose, title } = props;
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [query, setQuery] = useState('');
  const multi = props.mode === 'multi';

  const found = useMemo(() => searchSettlements(query), [query]);

  const isPicked = (key: string) =>
    props.mode === 'multi' ? props.values.includes(key) : props.value === key;

  const Note = () => (
    <View style={styles.noteWrap}>
      <Text style={styles.noteTitle}>{openNote}</Text>
      <Text style={styles.noteText}>
        Другие населённые пункты появятся в следующих обновлениях.
      </Text>
    </View>
  );

  const renderItem = ({ item }: { item: Settlement }) => {
    const key = settlementKey(item.name);
    const picked = isPicked(key);
    return (
      <PressableScale
        style={[styles.row, picked && styles.rowPicked]}
        onPress={() =>
          props.mode === 'multi' ? props.onToggle(key) : props.onSelect(key, item.name)
        }
      >
        <View style={styles.rowBody}>
          <Text style={[styles.rowName, picked && styles.rowNamePicked]}>{item.name}</Text>
          <Text style={styles.rowMeta}>
            {item.kind === 'город' ? 'город' : `${item.district} район`}
          </Text>
        </View>
        {picked && <Text style={styles.rowTick}>✓</Text>}
      </PressableScale>
    );
  };

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(160)}
      style={[StyleSheet.absoluteFill, styles.root]}
    >
      <View style={styles.topBar}>
        <PressableScale style={styles.backChip} onPress={onClose}>
          <Text style={styles.backText}>‹ Назад</Text>
        </PressableScale>
        <View style={styles.backChipGhost} />
      </View>

      <View style={styles.head}>
        <Text style={styles.title}>{title ?? 'Населённый пункт'}</Text>
        {multi && (
          <Text style={styles.hint}>
            Отметьте все, куда готовы выезжать. Заявки из них будут в вашей ленте.
          </Text>
        )}
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Начните вводить название"
          placeholderTextColor={t.textMuted}
          autoCorrect={false}
          autoFocus
        />
      </View>

      {found.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Ничего не нашлось</Text>
          <Text style={styles.emptyText}>Проверьте написание.</Text>
          <Note />
        </View>
      ) : (
        // Список длинный, поэтому FlatList: рисуются только видимые строки
        <FlatList
          data={found}
          keyExtractor={(item) => `${item.district}-${item.name}`}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          ListFooterComponent={Note}
        />
      )}

      {/* При множественном выборе список сам не закрывается: человек отмечает
          несколько пунктов и подтверждает, когда закончил */}
      {multi && props.mode === 'multi' && (
        <View style={styles.footer}>
          <PressableScale style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>
              {props.values.length
                ? `Готово · ${counted(props.values.length, 'пункт', 'пункта', 'пунктов')}`
                : 'Готово · вся республика'}
            </Text>
          </PressableScale>
        </View>
      )}
    </Animated.View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    root: { backgroundColor: t.bg },
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
    head: { paddingHorizontal: 20, paddingBottom: 12 },
    title: { fontSize: 19, fontWeight: '800', color: t.text, marginBottom: 8 },
    hint: {
      fontSize: 12,
      fontWeight: '600',
      color: t.textMuted,
      lineHeight: 17,
      marginBottom: 12,
    },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 28,
      borderTopWidth: 1,
      borderTopColor: t.border,
      backgroundColor: t.bg,
    },
    doneBtn: {
      borderRadius: 16,
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: t.accent,
    },
    doneBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 14 },
    search: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 14,
      backgroundColor: t.inputBg,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 14,
      fontWeight: '600',
      color: t.text,
    },
    list: { paddingHorizontal: 20, paddingBottom: 40 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
      marginBottom: 8,
    },
    rowPicked: { borderColor: t.accentBorder, backgroundColor: t.accentSoft },
    rowBody: { flex: 1 },
    rowName: { fontSize: 14, fontWeight: '700', color: t.text },
    rowNamePicked: { color: t.accent, fontWeight: '800' },
    rowMeta: { fontSize: 11.5, fontWeight: '600', color: t.textMuted, marginTop: 2 },
    rowTick: { fontSize: 15, fontWeight: '800', color: t.accent },
    emptyWrap: { paddingHorizontal: 20, paddingTop: 40, alignItems: 'center' },
    emptyTitle: { fontSize: 14, fontWeight: '800', color: t.text },
    emptyText: {
      fontSize: 12.5,
      fontWeight: '600',
      color: t.textMuted,
      lineHeight: 18,
      textAlign: 'center',
      marginTop: 6,
    },
    // Под списком, а не над ним: сначала выбор, потом объяснение,
    // почему выбор такой короткий
    noteWrap: {
      marginTop: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
      gap: 4,
    },
    noteTitle: { fontSize: 12.5, fontWeight: '800', color: t.text, lineHeight: 18 },
    noteText: { fontSize: 12.5, fontWeight: '600', color: t.textMuted, lineHeight: 18 },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
