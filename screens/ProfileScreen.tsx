import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { springs, STAGGER } from '../motion';
import { palettes, Palette, useTheme } from '../theme';
import { PressableScale } from '../components/PressableScale';
import { formatRuPhone } from '../components/phoneAuth';
import { LEGAL_DOCS, type LegalDocId } from '../components/legal';
import { CityPicker } from '../components/CityPicker';
import { settlementLabel } from '../components/cities';
import { LegalScreen } from './LegalScreen';

type Props = {
  name: string;
  onChangeName: (name: string) => void;
  email: string;
  phone: string;
  address: string;
  // Город определяет, каким мастерам покажут новую заявку
  city: string;
  onChangeCity: (city: string) => void;
  ordersTotal: number;
  ordersActive: number;
  onContactSupport: () => void;
  // Вход в режим мастера (перед ним — обязательная авторизация)
  onOpenMaster: () => void;
  // Модерация мастеров — только у владельцев admins/{uid}
  isAdmin: boolean;
  onOpenAdmin: () => void;
  onLogout: () => void;
  // Чем аккаунт подтверждает владельца: паролем или кодом из СМС. У
  // телефонного аккаунта пароля нет — ему не показываются ни смена пароля,
  // ни поле пароля при удалении.
  authMethod: 'password' | 'phone';
  // Смена пароля. Ошибку возвращает текстом, готовым к показу: экран про
  // Firebase ничего не знает.
  onChangePassword: (current: string, next: string) => Promise<void>;
  // Код на собственный номер — подтверждение удаления телефонного аккаунта
  onRequestDeleteCode: () => Promise<void>;
  // Секрет — пароль либо код из СМС, смотря какой authMethod
  onDeleteAccount: (secret: string) => Promise<void>;
};

export function ProfileScreen({
  name,
  onChangeName,
  email,
  phone,
  address,
  city,
  onChangeCity,
  ordersTotal,
  ordersActive,
  onContactSupport,
  onOpenMaster,
  isAdmin,
  onOpenAdmin,
  onLogout,
  authMethod,
  onChangePassword,
  onRequestDeleteCode,
  onDeleteAccount,
}: Props) {
  const { mode, colors: t, setMode } = useTheme();
  const styles = themed[mode];
  const [pushOn, setPushOn] = useState(true);
  const [emailOn, setEmailOn] = useState(false);
  // Редактирование имени прямо в карточке — без отдельного экрана
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pickingCity, setPickingCity] = useState(false);
  const [openDoc, setOpenDoc] = useState<LegalDocId | null>(null);
  // Смена пароля разворачивается в списке, как и удаление: без отдельного
  // экрана, но с текущим паролем — открытая сессия сама по себе не даёт
  // отрезать владельца от аккаунта
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  // Удаление аккаунта разворачивается прямо в списке: сначала предупреждение
  // и подтверждение владельца, и только потом кнопка, которую нельзя отменить
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Пароль — или код из СМС у телефонного аккаунта
  const [deleteSecret, setDeleteSecret] = useState('');
  const [deleteCodeSent, setDeleteCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const byPhone = authMethod === 'phone';

  const startEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  const saveName = () => {
    const trimmed = draft.trim();
    if (trimmed) onChangeName(trimmed);
    setEditing(false);
  };

  const openPasswordChange = () => {
    setChangingPassword(true);
    setPasswordDone(false);
    setPasswordError(null);
    setCurrentPassword('');
    setNewPassword('');
  };

  const submitPassword = async () => {
    if (!currentPassword) {
      setPasswordError('Введите текущий пароль');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('Новый пароль — не короче 6 символов');
      return;
    }
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      // Пароли не задерживаются в состоянии дольше необходимого
      setCurrentPassword('');
      setNewPassword('');
      setChangingPassword(false);
      setPasswordDone(true);
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Не удалось сменить пароль');
    } finally {
      setSavingPassword(false);
    }
  };

  const cancelDelete = () => {
    setConfirmingDelete(false);
    setDeleteSecret('');
    setDeleteCodeSent(false);
    setDeleteError(null);
  };

  const sendDeleteCode = async () => {
    setDeleteError(null);
    setSendingCode(true);
    try {
      await onRequestDeleteCode();
      setDeleteCodeSent(true);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Не удалось отправить код');
    } finally {
      setSendingCode(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteSecret) {
      setDeleteError(
        byPhone
          ? 'Введите код из СМС, чтобы подтвердить удаление'
          : 'Введите пароль, чтобы подтвердить удаление',
      );
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    try {
      await onDeleteAccount(deleteSecret);
      // Дальше экран исчезнет сам: без сессии приложение уводит на вход
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Не удалось удалить аккаунт');
      setDeleting(false);
    }
  };

  return (
    <View style={styles.fill}>
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Animated.Text entering={FadeInDown.duration(420)} style={styles.header}>
          Профиль
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(80).duration(360)} style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarIcon}>👤</Text>
          </View>

          {editing ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.nameEditRow}>
              <TextInput
                style={styles.nameInput}
                value={draft}
                onChangeText={setDraft}
                autoFocus
                onSubmitEditing={saveName}
                onBlur={saveName}
                returnKeyType="done"
              />
            </Animated.View>
          ) : (
            <PressableScale style={styles.nameRow} onPress={startEdit}>
              <Text style={styles.name}>{name}</Text>
              <Text style={styles.namePencil}>✎</Text>
            </PressableScale>
          )}

          {/* Чем человек входит, то и показываем: у телефонного аккаунта
            почты нет, у почтового — телефона */}
          <Text style={styles.email}>{email || formatRuPhone(phone)}</Text>
          <Text style={styles.address}>{address}</Text>
        </Animated.View>

        {/* Живая статистика: считается по реальным заказам */}
        <Animated.View entering={FadeInDown.delay(120).duration(360)} style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{ordersTotal}</Text>
            <Text style={styles.statLabel}>всего заказов</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, ordersActive > 0 && styles.statValueActive]}>
              {ordersActive}
            </Text>
            <Text style={styles.statLabel}>активных</Text>
          </View>
        </Animated.View>

        {/* Вход в раздел для мастеров — за ним экран авторизации */}
        <Animated.View entering={FadeInDown.delay(140).duration(360)}>
          <PressableScale style={styles.masterCard} onPress={onOpenMaster}>
            <View style={styles.masterIconWrap}>
              <Text style={styles.masterIcon}>🛠️</Text>
            </View>
            <View style={styles.masterBody}>
              <Text style={styles.masterTitle}>Я мастер</Text>
              <Text style={styles.masterSub}>Заказы рядом, отклики и чат с клиентами</Text>
            </View>
            <Text style={styles.masterChevron}>›</Text>
          </PressableScale>
        </Animated.View>

        {/* Модерация мастеров. Пункта нет у всех, кроме владельцев
          admins/{uid} — и очередь им всё равно не отдадут правила. */}
        {isAdmin && (
          <Animated.View entering={FadeInDown.delay(150).duration(360)}>
            <PressableScale style={styles.masterCard} onPress={onOpenAdmin}>
              <View style={styles.masterIconWrap}>
                <Text style={styles.masterIcon}>🛡️</Text>
              </View>
              <View style={styles.masterBody}>
                <Text style={styles.masterTitle}>Модерация</Text>
                <Text style={styles.masterSub}>Заявки мастеров на проверку</Text>
              </View>
              <Text style={styles.masterChevron}>›</Text>
            </PressableScale>
          </Animated.View>
        )}

        <Animated.Text entering={FadeInDown.delay(160).duration(360)} style={styles.sectionTitle}>
          Настройки
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(160 + STAGGER).duration(340)} style={styles.row}>
          <Text style={styles.rowLabel}>Тёмная тема</Text>
          <Toggle value={mode === 'dark'} onChange={(v) => setMode(v ? 'dark' : 'light')} />
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(160 + STAGGER * 2).duration(340)}
          style={styles.row}
        >
          <Text style={styles.rowLabel}>Push-уведомления</Text>
          <Toggle value={pushOn} onChange={setPushOn} />
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(160 + STAGGER * 3).duration(340)}
          style={styles.row}
        >
          <Text style={styles.rowLabel}>Email-уведомления</Text>
          <Toggle value={emailOn} onChange={setEmailOn} />
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(160 + STAGGER * 4).duration(340)}
          style={styles.row}
        >
          <Text style={styles.rowLabel}>Мой адрес</Text>
          <Text style={styles.rowValue}>{address}</Text>
        </Animated.View>

        {/* Город — единственное, по чему заявка находит мастеров рядом.
          Выбор из списка, а не ввод: разное написание одного села разводило
          клиента и мастера по разным «городам». */}
        <Animated.View entering={FadeInDown.delay(160 + STAGGER * 4.5).duration(340)}>
          <PressableScale style={styles.row} onPress={() => setPickingCity(true)}>
            <Text style={styles.rowLabel}>Населённый пункт</Text>
            <Text style={[styles.rowValue, !city && styles.rowValueWarn]}>
              {city ? `${settlementLabel(city)}  ›` : 'Не указан — мастера не найдут  ›'}
            </Text>
          </PressableScale>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(160 + STAGGER * 5).duration(340)}>
          <PressableScale style={styles.row} onPress={onContactSupport}>
            <Text style={styles.rowLabel}>Написать в поддержку</Text>
            <Text style={styles.rowChevron}>›</Text>
          </PressableScale>
        </Animated.View>

        {/* Смена пароля. У телефонного аккаунта пароля нет — его владельца
          подтверждает код из СМС, менять нечего. */}
        {!byPhone && (
          <Animated.View entering={FadeInDown.delay(160 + STAGGER * 5.5).duration(340)}>
            {changingPassword ? (
              <Animated.View entering={FadeIn.duration(220)} style={styles.passwordCard}>
                <Text style={styles.passwordTitle}>Смена пароля</Text>

                <TextInput
                  style={styles.deleteInput}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Текущий пароль"
                  placeholderTextColor={t.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!savingPassword}
                />
                <TextInput
                  style={[styles.deleteInput, styles.passwordInputGap]}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Новый пароль — не короче 6 символов"
                  placeholderTextColor={t.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!savingPassword}
                  onSubmitEditing={submitPassword}
                  returnKeyType="done"
                />

                {passwordError && (
                  <Animated.Text entering={FadeIn.duration(200)} style={styles.deleteError}>
                    {passwordError}
                  </Animated.Text>
                )}

                <PressableScale
                  style={[styles.passwordBtn, savingPassword && styles.deleteBtnDim]}
                  onPress={submitPassword}
                  disabled={savingPassword}
                >
                  <Text style={styles.passwordBtnText}>
                    {savingPassword ? 'Сохраняем…' : 'Сменить пароль'}
                  </Text>
                </PressableScale>

                <PressableScale
                  style={styles.deleteCancel}
                  onPress={() => setChangingPassword(false)}
                  disabled={savingPassword}
                >
                  <Text style={styles.deleteCancelText}>Отмена</Text>
                </PressableScale>
              </Animated.View>
            ) : (
              <PressableScale style={styles.row} onPress={openPasswordChange}>
                <Text style={styles.rowLabel}>Сменить пароль</Text>
                {passwordDone ? (
                  <Text style={styles.passwordDone}>Пароль изменён ✓</Text>
                ) : (
                  <Text style={styles.rowChevron}>›</Text>
                )}
              </PressableScale>
            )}
          </Animated.View>
        )}

        {/* Документы должны открываться из приложения, а не искаться на сайте:
          человек принимал их здесь, читать перечитывать тоже должен здесь */}
        {(['terms', 'privacy'] as const).map((id, i) => (
          <Animated.View
            key={id}
            entering={FadeInDown.delay(160 + STAGGER * (6 + i)).duration(340)}
          >
            <PressableScale style={styles.row} onPress={() => setOpenDoc(id)}>
              <Text style={styles.rowLabel}>{LEGAL_DOCS[id].title}</Text>
              <Text style={styles.rowChevron}>›</Text>
            </PressableScale>
          </Animated.View>
        ))}

        <Animated.View
          entering={FadeInDown.delay(160 + STAGGER * 8).duration(340)}
          style={styles.row}
        >
          <Text style={styles.rowLabel}>О приложении</Text>
          <Text style={styles.rowValue}>domio · v1.0.0</Text>
        </Animated.View>

        {/* Выход и удаление аккаунта. Удаление обязано быть здесь, а не письмом
          в поддержку: этого требуют правила магазинов приложений. */}
        <Animated.View entering={FadeInDown.delay(160 + STAGGER * 7).duration(340)}>
          <PressableScale style={styles.row} onPress={onLogout}>
            <Text style={styles.rowLabelAccent}>Выйти из аккаунта</Text>
            <Text style={styles.rowChevron}>›</Text>
          </PressableScale>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(160 + STAGGER * 8).duration(340)}>
          {confirmingDelete ? (
            <Animated.View entering={FadeIn.duration(220)} style={styles.deleteCard}>
              <Text style={styles.deleteTitle}>Удалить аккаунт навсегда?</Text>
              <Text style={styles.deleteText}>
                Пропадут профиль, адреса, переписка и анкета мастера. Незакрытые заявки будут
                отменены. Отменить удаление нельзя.
              </Text>

              {byPhone ? (
                // Пароля у телефонного аккаунта нет — владельца подтверждает
                // код, отправленный на его собственный номер
                <>
                  <PressableScale
                    style={[styles.deleteCodeBtn, (sendingCode || deleting) && styles.deleteBtnDim]}
                    onPress={sendDeleteCode}
                    disabled={sendingCode || deleting}
                  >
                    <Text style={styles.deleteCodeBtnText}>
                      {sendingCode
                        ? 'Отправляем…'
                        : deleteCodeSent
                          ? 'Отправить код ещё раз'
                          : `Получить код на ${formatRuPhone(phone)}`}
                    </Text>
                  </PressableScale>
                  {deleteCodeSent && (
                    <TextInput
                      style={[styles.deleteInput, styles.passwordInputGap]}
                      value={deleteSecret}
                      onChangeText={setDeleteSecret}
                      placeholder="Код из СМС"
                      placeholderTextColor={t.textMuted}
                      keyboardType="number-pad"
                      maxLength={6}
                      editable={!deleting}
                    />
                  )}
                </>
              ) : (
                <TextInput
                  style={styles.deleteInput}
                  value={deleteSecret}
                  onChangeText={setDeleteSecret}
                  placeholder="Ваш пароль"
                  placeholderTextColor={t.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  editable={!deleting}
                />
              )}

              {deleteError && (
                <Animated.Text entering={FadeIn.duration(200)} style={styles.deleteError}>
                  {deleteError}
                </Animated.Text>
              )}

              <PressableScale
                style={[styles.deleteBtn, deleting && styles.deleteBtnDim]}
                onPress={submitDelete}
                disabled={deleting}
              >
                <Text style={styles.deleteBtnText}>
                  {deleting ? 'Удаляем…' : 'Удалить навсегда'}
                </Text>
              </PressableScale>

              <PressableScale
                style={styles.deleteCancel}
                onPress={cancelDelete}
                disabled={deleting}
              >
                <Text style={styles.deleteCancelText}>Отмена</Text>
              </PressableScale>
            </Animated.View>
          ) : (
            <PressableScale style={styles.row} onPress={() => setConfirmingDelete(true)}>
              <Text style={styles.rowLabelDanger}>Удалить аккаунт</Text>
              <Text style={styles.rowChevron}>›</Text>
            </PressableScale>
          )}
        </Animated.View>
      </ScrollView>

      {/* Поверх экрана, а не внутри списка: absoluteFill внутри ScrollView
        считается от содержимого и уехал бы вместе с прокруткой */}
      {openDoc && <LegalScreen docId={openDoc} onClose={() => setOpenDoc(null)} />}

      {pickingCity && (
        <CityPicker
          value={city}
          onSelect={(key) => {
            onChangeCity(key);
            setPickingCity(false);
          }}
          onClose={() => setPickingCity(false)}
        />
      )}
    </View>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const on = useSharedValue(value ? 1 : 0);
  const knob = useSharedValue(value ? 18 : 2);
  useEffect(() => {
    on.value = withTiming(value ? 1 : 0, { duration: 200 });
    knob.value = withSpring(value ? 18 : 2, springs.micro);
  }, [value, knob, on]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [t.toggleOff, t.accent]),
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knob.value }],
  }));

  return (
    <PressableScale style={styles.toggleHit} onPress={() => onChange(!value)}>
      <Animated.View style={[styles.toggleTrack, trackStyle]}>
        <Animated.View style={[styles.toggleKnob, knobStyle]} />
      </Animated.View>
    </PressableScale>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    root: { flex: 1, backgroundColor: t.bg },
    content: { padding: 16, paddingTop: 60, paddingBottom: 120 },
    header: { fontSize: 20, fontWeight: '800', marginBottom: 16, color: t.text },
    card: {
      backgroundColor: t.card,
      borderRadius: 20,
      padding: 22,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.border,
      marginBottom: 12,
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    avatarIcon: { fontSize: 28 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    name: { fontWeight: '800', fontSize: 16.5, color: t.text },
    namePencil: { fontSize: 13, color: t.textMuted },
    nameEditRow: { alignSelf: 'stretch', alignItems: 'center' },
    nameInput: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 7,
      fontSize: 15,
      fontWeight: '800',
      color: t.text,
      textAlign: 'center',
      minWidth: 160,
      backgroundColor: t.inputBg,
    },
    email: { fontWeight: '600', fontSize: 12.5, color: t.textSoft, marginTop: 5 },
    address: { color: t.textMuted, fontWeight: '600', fontSize: 12, marginTop: 3 },
    statsRow: { flexDirection: 'row', gap: 9, marginBottom: 22 },
    statCard: {
      flex: 1,
      backgroundColor: t.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      paddingVertical: 14,
    },
    statValue: { fontSize: 20, fontWeight: '800', color: t.text },
    statValueActive: { color: t.warn },
    statLabel: { fontSize: 11, fontWeight: '700', color: t.textMuted, marginTop: 2 },
    masterCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.accentSoft,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.accentBorder,
      padding: 14,
      marginBottom: 22,
    },
    masterIconWrap: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: t.card,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    masterIcon: { fontSize: 20 },
    masterBody: { flex: 1 },
    masterTitle: { fontWeight: '800', fontSize: 14, color: t.text },
    masterSub: { color: t.accent, fontWeight: '600', fontSize: 11.5, marginTop: 2 },
    masterChevron: { fontSize: 18, color: t.accent, fontWeight: '700', marginLeft: 8 },
    sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 10, color: t.text },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: t.card,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 14,
      marginBottom: 9,
      borderWidth: 1,
      borderColor: t.border,
    },
    rowLabel: { fontWeight: '700', fontSize: 13.5, color: t.text },
    rowLabelAccent: { fontWeight: '700', fontSize: 13.5, color: t.accent },
    rowLabelDanger: { fontWeight: '700', fontSize: 13.5, color: t.danger },
    rowValue: { fontWeight: '600', fontSize: 12, color: t.textMuted },
    rowValueWarn: { color: t.warn, fontWeight: '700' },
    cityInput: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 5,
      fontSize: 12.5,
      fontWeight: '700',
      color: t.text,
      backgroundColor: t.inputBg,
      minWidth: 130,
      textAlign: 'right',
    },
    rowChevron: { fontSize: 18, color: t.textMuted, fontWeight: '700' },
    passwordCard: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.border,
      padding: 16,
      marginBottom: 9,
    },
    passwordTitle: { fontWeight: '800', fontSize: 14, color: t.text, marginBottom: 12 },
    passwordInputGap: { marginTop: 9 },
    passwordBtn: {
      borderRadius: 14,
      paddingVertical: 13,
      alignItems: 'center',
      backgroundColor: t.accent,
      marginTop: 12,
    },
    passwordBtnText: { fontWeight: '800', fontSize: 13.5, color: t.onAccent },
    passwordDone: { fontWeight: '700', fontSize: 12, color: t.accent },
    deleteCodeBtn: {
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.inputBorder,
      backgroundColor: t.inputBg,
    },
    deleteCodeBtnText: { fontWeight: '700', fontSize: 12.5, color: t.text },
    deleteCard: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.danger,
      padding: 16,
      marginBottom: 9,
    },
    deleteTitle: { fontWeight: '800', fontSize: 14, color: t.danger },
    deleteText: {
      fontWeight: '600',
      fontSize: 12,
      color: t.textSoft,
      lineHeight: 17,
      marginTop: 6,
      marginBottom: 12,
    },
    deleteInput: {
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontSize: 14,
      fontWeight: '600',
      color: t.text,
      backgroundColor: t.inputBg,
    },
    deleteError: { color: t.danger, fontWeight: '700', fontSize: 12, marginTop: 8 },
    deleteBtn: {
      borderRadius: 14,
      paddingVertical: 13,
      alignItems: 'center',
      backgroundColor: t.danger,
      marginTop: 12,
    },
    deleteBtnDim: { opacity: 0.6 },
    deleteBtnText: { fontWeight: '800', fontSize: 13.5, color: '#FFFFFF' },
    deleteCancel: { alignItems: 'center', paddingVertical: 11, marginTop: 2 },
    deleteCancelText: { fontWeight: '700', fontSize: 13, color: t.textMuted },
    toggleHit: { padding: 2 },
    toggleTrack: {
      width: 44,
      height: 26,
      borderRadius: 13,
      padding: 2,
      justifyContent: 'center',
    },
    toggleKnob: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: '#FFFFFF',
      shadowColor: t.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
