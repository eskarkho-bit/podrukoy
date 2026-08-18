import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import {
  searchSettlements,
  settlementKey,
  type Settlement,
} from './cities';

// Выбор населённого пункта.
//
// Список, а не поле ввода: свободный текст разводил один город на несколько
// написаний, и мастер из «Грозного» не видел заявок из «грозного». Раз обе
// стороны выбирают из одного списка, совпадение гарантировано.
//
// С поиском, потому что пунктов около полутора сотен: пролистывать их —
// не выбор, а наказание.

type Props = {
  /** Ключ выбранного пункта, чтобы отметить его в списке */
  value: string;
  onSelect: (key: string, name: string) => void;
  onClose: () => void;
  title?: string;
};

export function CityPicker({ value, onSelect, onClose, title }: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [query, setQuery] = useState('');

  const found = useMemo(() => searchSettlements(query), [query]);

  const renderItem = ({ item }: { item: Settlement }) => {
    const key = settlementKey(item.name);
    const picked = key === value;
    return (
      <PressableScale
        style={[styles.row, picked && styles.rowPicked]}
        onPress={() => onSelect(key, item.name)}
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
          <Text style={styles.backText}>‹  Назад</Text>
        </PressableScale>
        <View style={styles.backChipGhost} />
      </View>

      <View style={styles.head}>
        <Text style={styles.title}>{title ?? 'Населённый пункт'}</Text>
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
          <Text style={styles.emptyText}>
            Проверьте написание. Если вашего населённого пункта нет в списке,
            напишите в поддержку — добавим.
          </Text>
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
        />
      )}
    </Animated.View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
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
  title: { fontSize: 19, fontWeight: '800', color: t.text, marginBottom: 12 },
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
});

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
