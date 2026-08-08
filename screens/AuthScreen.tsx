import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { PressableScale } from '../components/PressableScale';
import { authErrorText, useAuth } from '../components/AuthState';
import { currentConsents, LEGAL_DOCS, rememberConsent, type LegalDocId } from '../components/legal';
import { LegalScreen } from './LegalScreen';
import { Palette, palettes, useTheme } from '../theme';

// Вход в приложение. Показывается вместо всего остального, пока нет сессии:
// правила Firestore требуют авторизации, без неё заявки просто не сохранятся.

export function AuthScreen() {
  const { mode: themeMode, colors: t } = useTheme();
  const styles = themed[themeMode];
  const { signIn, register, resetPassword } = useAuth();

  // Один экран — два режима: вход и регистрация
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Галочка снята по умолчанию: предустановленное согласие согласием не является
  const [accepted, setAccepted] = useState(false);
  const [openDoc, setOpenDoc] = useState<LegalDocId | null>(null);

  const isRegister = mode === 'register';

  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setError(null);
    setNotice(null);
  };

  // Восстановление пароля. Ответ одинаков независимо от того, есть такой
  // аккаунт или нет — иначе форма стала бы способом проверять чужие email.
  const forgotPassword = async () => {
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setError('Введите email — на него придёт ссылка для смены пароля');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await resetPassword(e);
    } catch (err) {
      // Сообщать об ошибке здесь нельзя по той же причине
      console.warn('Сброс пароля:', err);
    }
    setNotice(`Если аккаунт с ${e} существует, письмо со ссылкой уже отправлено`);
    setLoading(false);
  };

  const submit = async () => {
    if (isRegister && name.trim().length < 2) {
      setError('Напишите, как вас зовут');
      return;
    }
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setError('Похоже, в email опечатка');
      return;
    }
    if (password.length < 6) {
      setError('Пароль — не короче 6 символов');
      return;
    }
    // Согласие должно быть получено до того, как мы начали обрабатывать
    // данные, а регистрация — это уже обработка имени и email
    if (isRegister && !accepted) {
      setError('Чтобы зарегистрироваться, примите соглашение и политику');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      if (isRegister) {
        // Согласие даётся здесь, а профиль в базе создаётся после входа,
        // когда появится uid, — передаём его туда через legal.ts
        rememberConsent(currentConsents());
        await register(name, e, password);
      } else await signIn(e, password);
      // При успехе экран пропадёт сам: сессия появится в AuthProvider
    } catch (err) {
      setError(authErrorText(err));
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.duration(420)} style={styles.badge}>
          <Text style={styles.badgeIcon}>🏠</Text>
        </Animated.View>

        <Animated.Text
          key={`title-${mode}`}
          entering={FadeInDown.delay(60).duration(380)}
          style={styles.title}
        >
          {isRegister ? 'Регистрация' : 'Подрукой'}
        </Animated.Text>
        <Animated.Text
          key={`sub-${mode}`}
          entering={FadeInDown.delay(100).duration(380)}
          style={styles.sub}
        >
          {isRegister
            ? 'Создайте аккаунт — и вызывайте мастера в пару касаний.'
            : 'Мастер по дому — под рукой. Войдите, чтобы продолжить.'}
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(140).duration(360)} style={styles.card}>
          {isRegister && (
            <Animated.View entering={FadeInDown.duration(260)}>
              <Text style={styles.fieldLabel}>Имя</Text>
              <TextInput
                style={styles.fieldInput}
                value={name}
                onChangeText={setName}
                placeholder="Дмитрий"
                placeholderTextColor={t.textMuted}
                editable={!loading}
              />
            </Animated.View>
          )}

          <Text style={[styles.fieldLabel, isRegister && styles.fieldLabelGap]}>Email</Text>
          <TextInput
            style={styles.fieldInput}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.ru"
            placeholderTextColor={t.textMuted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            editable={!loading}
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Пароль</Text>
          <TextInput
            style={styles.fieldInput}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••"
            placeholderTextColor={t.textMuted}
            secureTextEntry
            editable={!loading}
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          {/* Согласие — до регистрации, а не после: она уже обработка данных */}
          {isRegister && (
            <Animated.View entering={FadeInDown.duration(260)} style={styles.consentRow}>
              <PressableScale
                style={[styles.checkbox, accepted && styles.checkboxOn]}
                onPress={() => setAccepted((v) => !v)}
                disabled={loading}
              >
                {accepted && <Text style={styles.checkboxTick}>✓</Text>}
              </PressableScale>
              {/* Падеж не выводится из заголовка документа: «принимаю ...
                  политика конфиденциальности» читается как машинный перевод */}
              <Text style={styles.consentText}>
                Принимаю{' '}
                <Text style={styles.consentLink} onPress={() => setOpenDoc('terms')}>
                  пользовательское соглашение
                </Text>
                {' '}и{' '}
                <Text style={styles.consentLink} onPress={() => setOpenDoc('privacy')}>
                  политику конфиденциальности
                </Text>
              </Text>
            </Animated.View>
          )}

          {error && (
            <Animated.Text entering={FadeInDown.duration(240)} style={styles.fieldError}>
              {error}
            </Animated.Text>
          )}

          {notice && (
            <Animated.Text entering={FadeInDown.duration(240)} style={styles.fieldNotice}>
              {notice}
            </Animated.Text>
          )}

          <PressableScale
            style={[styles.btn, loading && styles.btnDim]}
            onPress={submit}
            disabled={loading}
          >
            <Text style={styles.btnText}>
              {loading
                ? (isRegister ? 'Создаём аккаунт…' : 'Входим…')
                : (isRegister ? 'Зарегистрироваться' : 'Войти')}
            </Text>
          </PressableScale>

          {/* Без восстановления пароля забывший его теряет доступ навсегда */}
          {!isRegister && (
            <PressableScale onPress={forgotPassword} disabled={loading}>
              <Text style={styles.forgot}>Забыли пароль?</Text>
            </PressableScale>
          )}
        </Animated.View>

        <Animated.View entering={FadeIn.delay(240).duration(360)} style={styles.switchRow}>
          <Text style={styles.hint}>
            {isRegister ? 'Уже есть аккаунт?' : 'Впервые здесь?'}
          </Text>
          <PressableScale onPress={switchMode} disabled={loading}>
            <Text style={styles.switchText}>
              {isRegister ? 'Войти' : 'Создать аккаунт'}
            </Text>
          </PressableScale>
        </Animated.View>
      </ScrollView>

      {openDoc && <LegalScreen docId={openDoc} onClose={() => setOpenDoc(null)} />}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  fill: { flex: 1, backgroundColor: t.bg },
  content: { padding: 24, paddingTop: 96, alignItems: 'center' },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  badgeIcon: { fontSize: 32 },
  title: { fontSize: 22, fontWeight: '800', color: t.text },
  sub: {
    color: t.textSoft,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
    maxWidth: 280,
    lineHeight: 18,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: t.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: t.border,
    padding: 18,
  },
  fieldLabel: { color: t.textSoft, fontWeight: '700', fontSize: 11.5, marginBottom: 6 },
  fieldLabelGap: { marginTop: 14 },
  fieldInput: {
    backgroundColor: t.inputBg,
    borderWidth: 1,
    borderColor: t.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13.5,
    color: t.text,
  },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 16 },
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
  consentText: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: '600',
    color: t.textMuted,
    lineHeight: 17,
  },
  consentLink: { color: t.accent, fontWeight: '800' },
  fieldError: { color: t.danger, fontWeight: '700', fontSize: 11.5, marginTop: 10 },
  fieldNotice: { color: t.accent, fontWeight: '700', fontSize: 11.5, marginTop: 10, lineHeight: 16 },
  forgot: {
    color: t.textMuted,
    fontWeight: '700',
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 14,
  },
  btn: {
    backgroundColor: t.accent,
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 18,
  },
  btnDim: { backgroundColor: t.disabled },
  btnText: { color: t.onAccent, fontWeight: '800', fontSize: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18 },
  hint: { color: t.textMuted, fontWeight: '600', fontSize: 11.5 },
  switchText: { color: t.accent, fontWeight: '800', fontSize: 11.5 },
});

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
