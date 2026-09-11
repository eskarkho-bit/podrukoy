import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { palettes, Palette, useTheme } from '../../theme';
import { PressableScale } from '../../components/PressableScale';
import { counted } from '../../components/format';
import { dayLabel } from '../../components/masterStats';
import { useAdminState, type Complaint } from '../../components/AdminState';

// Жалобы. Живут во вкладке «Мастера»: у жалобы мастера на отзыв исход —
// модерация отзыва, тот же тип решения, что вердикт по анкете; у жалобы
// клиента на мастера или его сообщение — разбор по заявке и переписке
// (вкладка «Заявки»), а здесь — только вердикт с запиской автору.
//
// «Скрыть отзыв» делает два серверных вызова подряд — скрытие и закрытие
// жалобы: путь скрытия в системе один, и в журнале он один.

const short = (id: string) => `${id.slice(0, 6)}…`;

/** Кто на кого жалуется — одной строкой, по виду жалобы. */
function complaintMeta(c: Complaint): string {
  if (c.subjectType === 'message') {
    return `Клиент ${short(c.byUid)} · сообщение мастера ${short(c.masterId)} · заявка ${short(c.orderId)}`;
  }
  if (c.subjectType === 'master') {
    return `Клиент ${short(c.byUid)} · мастер ${short(c.masterId)} · заявка ${short(c.orderId)}`;
  }
  return `Мастер ${short(c.byUid)} · отзыв ${short(c.orderId)}`;
}

/**
 * Карточка жалобы. Скрытие отзыва требует причину (уйдёт мастеру пушем),
 * решение по жалобе клиента — записку о принятых мерах, отклонение —
 * короткую записку автору, тоже обязательную: «нет» без объяснения
 * обесценило бы сам механизм.
 */
export function ComplaintCard({
  complaint,
  busy,
  onHide,
  onResolve,
  onDismiss,
}: {
  complaint: Complaint;
  busy: boolean;
  /** Жалоба на отзыв: скрыть отзыв и закрыть жалобу */
  onHide: (reason: string) => void;
  /** Жалоба клиента: закрыть как решённую с запиской о мерах */
  onResolve: (note: string) => void;
  onDismiss: (note: string) => void;
}) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [mode2, setMode2] = useState<null | 'hide' | 'dismiss'>(null);
  const [reason, setReason] = useState('');
  const resolved = complaint.status !== 'новая';
  const aboutReview = complaint.subjectType === 'review';

  return (
    <View style={styles.card}>
      <Text style={styles.meta}>
        {complaintMeta(complaint)}
        {complaint.createdMs != null ? ` · ${dayLabel(complaint.createdMs)}` : ''}
        {resolved ? ` · ${complaint.status}` : ''}
      </Text>
      <Text style={styles.text}>{complaint.text}</Text>

      {!resolved && mode2 === null && (
        <View style={styles.row}>
          <PressableScale
            style={[
              styles.btn,
              aboutReview ? styles.btnDanger : styles.btnAccent,
              busy && styles.btnDim,
            ]}
            onPress={() => {
              setMode2('hide');
              setReason('');
            }}
            disabled={busy}
          >
            <Text style={aboutReview ? styles.btnDangerText : styles.btnAccentText}>
              {aboutReview ? 'Скрыть отзыв' : 'Решена'}
            </Text>
          </PressableScale>
          <PressableScale
            style={[styles.btn, styles.btnGhost, busy && styles.btnDim]}
            onPress={() => {
              setMode2('dismiss');
              setReason('');
            }}
            disabled={busy}
          >
            <Text style={styles.btnGhostText}>Отклонить</Text>
          </PressableScale>
        </View>
      )}

      {!resolved && mode2 !== null && (
        <View style={styles.reasonBox}>
          <TextInput
            style={styles.reasonInput}
            value={reason}
            onChangeText={setReason}
            placeholder={
              mode2 === 'hide'
                ? aboutReview
                  ? 'Причина скрытия — уйдёт мастеру'
                  : 'Что сделано — уйдёт автору жалобы'
                : 'Почему жалоба отклонена'
            }
            placeholderTextColor={t.textMuted}
            multiline
            maxLength={300}
            autoFocus
          />
          <View style={styles.row}>
            <PressableScale
              style={[
                styles.btn,
                mode2 === 'hide' ? styles.btnDanger : styles.btnAccent,
                (!reason.trim() || busy) && styles.btnDim,
              ]}
              onPress={() => {
                (mode2 === 'hide' ? (aboutReview ? onHide : onResolve) : onDismiss)(reason.trim());
                setMode2(null);
              }}
              disabled={!reason.trim() || busy}
            >
              <Text style={mode2 === 'hide' ? styles.btnDangerText : styles.btnAccentText}>
                {busy
                  ? 'Сохраняем…'
                  : mode2 === 'hide'
                    ? aboutReview
                      ? 'Скрыть и закрыть жалобу'
                      : 'Закрыть как решённую'
                    : 'Отклонить'}
              </Text>
            </PressableScale>
            <PressableScale style={[styles.btn, styles.btnGhost]} onPress={() => setMode2(null)}>
              <Text style={styles.btnGhostText}>Отмена</Text>
            </PressableScale>
          </View>
        </View>
      )}
    </View>
  );
}

export function ComplaintsSection() {
  const { mode } = useTheme();
  const styles = themed[mode];
  const { complaints, loadComplaintsArchive, resolveComplaint, setReviewHidden } = useAdminState();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [archive, setArchive] = useState<Complaint[] | null>(null);

  const hide = async (c: Complaint, reason: string) => {
    setBusyId(c.id);
    // Сначала скрытие, потом вердикт: если скрытие не прошло (нет функций,
    // отзыв удалён) — жалоба остаётся открытой и видимой
    if (await setReviewHidden(c.masterId, c.orderId, true, reason)) {
      await resolveComplaint(c.id, 'решена', reason);
    }
    setBusyId(null);
  };

  const dismiss = async (c: Complaint, note: string) => {
    setBusyId(c.id);
    await resolveComplaint(c.id, 'отклонена', note);
    setBusyId(null);
  };

  // Жалоба клиента: меры (блокировка, закрытие заявки) принимаются в своих
  // вкладках, здесь фиксируется только исход
  const resolve = async (c: Complaint, note: string) => {
    setBusyId(c.id);
    await resolveComplaint(c.id, 'решена', note);
    setBusyId(null);
  };

  const toggleArchive = async () => {
    setArchive(archive === null ? await loadComplaintsArchive() : null);
  };

  return (
    <View>
      <Animated.Text entering={FadeInDown.duration(360)} style={styles.sectionTitle}>
        {complaints.length
          ? `Жалобы · ${counted(complaints.length, 'ждёт', 'ждут', 'ждут')} решения`
          : 'Жалобы'}
      </Animated.Text>

      {complaints.length === 0 && (
        <Animated.Text entering={FadeIn.duration(300)} style={styles.empty}>
          Новых жалоб нет
        </Animated.Text>
      )}

      {complaints.map((c) => (
        <Animated.View key={c.id} entering={FadeIn.duration(240)} layout={LinearTransition}>
          <ComplaintCard
            complaint={c}
            busy={busyId === c.id}
            onHide={(reason) => hide(c, reason)}
            onResolve={(note) => resolve(c, note)}
            onDismiss={(note) => dismiss(c, note)}
          />
        </Animated.View>
      ))}

      <PressableScale style={styles.archiveRow} onPress={toggleArchive}>
        <Text style={styles.archiveText}>
          {archive === null ? 'Показать архив ›' : 'Скрыть архив'}
        </Text>
      </PressableScale>

      {(archive ?? []).map((c) => (
        <ComplaintCard
          key={c.id}
          complaint={c}
          busy={false}
          onHide={() => {}}
          onResolve={() => {}}
          onDismiss={() => {}}
        />
      ))}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    sectionTitle: {
      fontSize: 11,
      fontWeight: '800',
      color: t.textMuted,
      marginTop: 20,
      marginBottom: 8,
    },
    empty: { fontSize: 12, fontWeight: '600', color: t.textMuted, lineHeight: 17 },
    card: {
      backgroundColor: t.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 13,
      marginBottom: 8,
    },
    meta: { fontSize: 11, fontWeight: '700', color: t.textMuted },
    text: { fontSize: 12.5, fontWeight: '600', color: t.text, marginTop: 6, lineHeight: 17 },
    row: { flexDirection: 'row', gap: 8, marginTop: 12 },
    btn: { flex: 1, borderRadius: 14, paddingVertical: 11, alignItems: 'center' },
    btnDim: { opacity: 0.6 },
    btnDanger: { backgroundColor: t.danger },
    btnDangerText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12.5, textAlign: 'center' },
    btnAccent: { backgroundColor: t.accent },
    btnAccentText: { color: t.onAccent, fontWeight: '800', fontSize: 12.5, textAlign: 'center' },
    btnGhost: { backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
    btnGhostText: { color: t.textMuted, fontWeight: '800', fontSize: 12.5 },
    reasonBox: { marginTop: 12 },
    reasonInput: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      backgroundColor: t.inputBg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 12.5,
      fontWeight: '600',
      color: t.text,
      minHeight: 58,
      textAlignVertical: 'top',
    },
    archiveRow: { paddingVertical: 8 },
    archiveText: { fontSize: 12, fontWeight: '800', color: t.accent },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
