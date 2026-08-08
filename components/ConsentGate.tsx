import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import { LEGAL_DOCS, REQUIRED_DOCS, type LegalDocId } from './legal';
import { LegalScreen } from '../screens/LegalScreen';

// Экран для тех, кто зарегистрировался до появления документов или чья
// редакция устарела. Перекрывает приложение целиком: пользоваться сервисом
// без действующего согласия нельзя, а тихо считать старое согласие
// действующим для новой редакции — обман.

type Props = {
  onAccept: () => Promise<void>;
  onLogout: () => void;
};

export function ConsentGate({ onAccept, onLogout }: Props) {
  const { mode } = useTheme();
  const styles = themed[mode];
  const [accepted, setAccepted] = useState(false);
  const [openDoc, setOpenDoc] = useState<LegalDocId | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!accepted) return;
    setBusy(true);
    try {
      await onAccept();
    } catch {
      // Сообщение уже показал AppState — здесь только снимаем блокировку
      setBusy(false);
    }
  };

  return (
    <Animated.View
      entering={FadeIn.duration(240)}
      style={[StyleSheet.absoluteFill, styles.root]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Animated.View entering={FadeInDown.duration(420)} style={styles.badge}>
          <Text style={styles.badgeIcon}>📄</Text>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(60).duration(380)} style={styles.title}>
          Обновились документы
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(380)} style={styles.sub}>
          Чтобы продолжить пользоваться сервисом, примите действующие редакции.
          Читать можно прямо здесь — интернет для этого не нужен.
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(140).duration(360)} style={styles.card}>
          {REQUIRED_DOCS.map((id) => (
            <PressableScale key={id} style={styles.docRow} onPress={() => setOpenDoc(id)}>
              <View style={styles.docBody}>
                <Text style={styles.docTitle}>{LEGAL_DOCS[id].title}</Text>
                <Text style={styles.docMeta}>Редакция от {LEGAL_DOCS[id].version}</Text>
              </View>
              <Text style={styles.docChevron}>›</Text>
            </PressableScale>
          ))}

          <View style={styles.consentRow}>
            <PressableScale
              style={[styles.checkbox, accepted && styles.checkboxOn]}
              onPress={() => setAccepted((v) => !v)}
              disabled={busy}
            >
              {accepted && <Text style={styles.checkboxTick}>✓</Text>}
            </PressableScale>
            <Text style={styles.consentText}>
              Прочитал и принимаю обе редакции
            </Text>
          </View>

          <PressableScale
            style={[styles.btn, (!accepted || busy) && styles.btnDim]}
            onPress={submit}
            disabled={!accepted || busy}
          >
            <Text style={styles.btnText}>{busy ? 'Сохраняем…' : 'Продолжить'}</Text>
          </PressableScale>

          {/* Не согласиться — тоже вариант, и он не должен вести в тупик */}
          <PressableScale style={styles.logoutBtn} onPress={onLogout} disabled={busy}>
            <Text style={styles.logoutText}>Не принимаю — выйти</Text>
          </PressableScale>
        </Animated.View>
      </ScrollView>

      {openDoc && <LegalScreen docId={openDoc} onClose={() => setOpenDoc(null)} />}
    </Animated.View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  root: { backgroundColor: t.bg },
  content: { padding: 20, paddingTop: 90, paddingBottom: 60 },
  badge: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  badgeIcon: { fontSize: 27 },
  title: { fontSize: 20, fontWeight: '800', color: t.text, textAlign: 'center' },
  sub: {
    fontSize: 12.5,
    fontWeight: '600',
    color: t.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 20,
  },
  card: {
    backgroundColor: t.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.border,
    padding: 16,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  docBody: { flex: 1 },
  docTitle: { fontSize: 13.5, fontWeight: '800', color: t.text },
  docMeta: { fontSize: 11, fontWeight: '600', color: t.textMuted, marginTop: 2 },
  docChevron: { fontSize: 18, color: t.accent, fontWeight: '700' },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16 },
  checkbox: {
    width: 21,
    height: 21,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: t.inputBorder,
    backgroundColor: t.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: t.accent, borderColor: t.accent },
  checkboxTick: { color: t.onAccent, fontSize: 13, fontWeight: '800', lineHeight: 15 },
  consentText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: t.text },
  btn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: t.accent,
    marginTop: 16,
  },
  btnDim: { opacity: 0.5 },
  btnText: { color: t.onAccent, fontWeight: '800', fontSize: 14 },
  logoutBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  logoutText: { color: t.textMuted, fontWeight: '700', fontSize: 12.5 },
});

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
