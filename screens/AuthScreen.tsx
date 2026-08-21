import { useEffect, useState } from 'react';
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
import { Oswald_400Regular, useFonts } from '@expo-google-fonts/oswald';
import { PressableScale } from '../components/PressableScale';
import { DomioLogo } from '../components/DomioLogo';
import { authErrorText, useAuth } from '../components/AuthState';
import { formatRuPhone, normalizeRuPhone, phoneAuthErrorText } from '../components/phoneAuth';
import { currentConsents, rememberConsent, type LegalDocId } from '../components/legal';
import { CityPicker } from '../components/CityPicker';
import { rememberSignup } from '../components/signupDraft';
import { LegalScreen } from './LegalScreen';
import { Palette, palettes, useTheme } from '../theme';

// Вход в приложение. Показывается вместо всего остального, пока нет сессии:
// правила Firestore требуют авторизации, без неё заявки просто не сохранятся.

export function AuthScreen() {
  const { mode: themeMode, colors: t } = useTheme();
  const styles = themed[themeMode];
  const { signIn, register, resetPassword, requestPhoneCode, signInWithPhone } = useAuth();
  // Фирменный Oswald — только для слова «domio». Пока файл не загрузился,
  // слово стоит системным шрифтом: неизвестное семейство уронило бы iOS
  const [brandFontLoaded] = useFonts({ Oswald_400Regular });

  // Один экран — два режима: вход и регистрация
  const [mode, setMode] = useState<'login' | 'register'>('login');
  // И два способа: по почте с паролем или по телефону с кодом из СМС
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  // Код запрошен — дальше поле кода и кнопка входа вместо «Получить код»
  const [codeSent, setCodeSent] = useState(false);
  // До этого момента повторная отправка выключена — сервер всё равно откажет
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [, bump] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Галочка снята по умолчанию: предустановленное согласие согласием не является
  const [accepted, setAccepted] = useState(false);
  const [openDoc, setOpenDoc] = useState<LegalDocId | null>(null);
  // Город и адрес спрашиваем сразу: без города заявка не найдёт мастеров, а
  // просить адрес в момент вызова мастера — терять человека на полпути
  const [cityKey, setCityKey] = useState('');
  const [cityName, setCityName] = useState('');
  const [address, setAddress] = useState('');
  const [pickingCity, setPickingCity] = useState(false);

  const isRegister = mode === 'register';
  const isPhone = method === 'phone';

  // Тикает раз в секунду, пока идёт обратный отсчёт до повторной отправки
  useEffect(() => {
    if (!cooldownUntil) return;
    const id = setInterval(() => {
      if (Date.now() >= cooldownUntil) setCooldownUntil(0);
      else bump((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);
  const cooldownLeft = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
    : 0;

  const switchMode = () => {
    setMode(isRegister ? 'login' : 'register');
    setError(null);
    setNotice(null);
    // Код был запрошен для другого действия: у входа и регистрации разные
    // проверки на сервере, начатый путь не переносится
    setCodeSent(false);
    setCode('');
  };

  const switchMethod = (next: 'email' | 'phone') => {
    if (next === method) return;
    setMethod(next);
    setError(null);
    setNotice(null);
    setCodeSent(false);
    setCode('');
  };

  // Проверки полей регистрации, общие для обоих способов входа. Возвращает
  // текст ошибки — согласие проверяется до любых обращений к серверу:
  // отправка СМС на номер — это уже обработка персональных данных.
  const registerFieldsError = (): string | null => {
    if (name.trim().length < 2) return 'Напишите, как вас зовут';
    if (!cityKey) return 'Выберите населённый пункт — без него заявку не увидят мастера';
    if (address.trim().length < 5) return 'Укажите адрес: улицу и дом';
    if (!accepted) return 'Чтобы зарегистрироваться, примите соглашение и политику';
    return null;
  };

  // Шаг первый телефонного входа: отправить код на номер
  const sendCode = async () => {
    const normalized = normalizeRuPhone(phone);
    if (!normalized) {
      setError('Нужен мобильный номер РФ — на него придёт код');
      return;
    }
    if (isRegister) {
      const fieldsError = registerFieldsError();
      if (fieldsError) {
        setError(fieldsError);
        return;
      }
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const result = await requestPhoneCode(normalized);
      if (result === 'not-configured') {
        setError('Вход по телефону пока недоступен — войдите по почте');
        return;
      }
      setCodeSent(true);
      setCooldownUntil(Date.now() + 60_000);
      setNotice(`Код отправлен на ${formatRuPhone(normalized)}`);
    } catch (e) {
      setError(phoneAuthErrorText(e, 'Не удалось отправить код. Попробуйте ещё раз'));
    } finally {
      setLoading(false);
    }
  };

  // Шаг второй: вход по коду. При регистрации согласие и профиль передаются
  // тем же путём, что и у почтовой, — через модули-хранилища.
  const submitPhone = async () => {
    const normalized = normalizeRuPhone(phone);
    if (!normalized) {
      setError('Нужен мобильный номер РФ — на него придёт код');
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Код — шесть цифр из СМС');
      return;
    }
    if (isRegister) {
      const fieldsError = registerFieldsError();
      if (fieldsError) {
        setError(fieldsError);
        return;
      }
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (isRegister) {
        rememberConsent(currentConsents());
        rememberSignup({ city: cityKey, address: address.trim(), name: name.trim() });
        await signInWithPhone(normalized, code.trim(), true);
      } else {
        await signInWithPhone(normalized, code.trim(), false);
      }
      // При успехе экран пропадёт сам: сессия появится в AuthProvider
    } catch (e) {
      setError(phoneAuthErrorText(e));
      setLoading(false);
    }
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
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setError('Похоже, в email опечатка');
      return;
    }
    if (password.length < 6) {
      setError('Пароль — не короче 6 символов');
      return;
    }
    // Согласие проверяется внутри: оно должно быть получено до того, как мы
    // начали обрабатывать данные, а регистрация — уже обработка имени и email
    if (isRegister) {
      const fieldsError = registerFieldsError();
      if (fieldsError) {
        setError(fieldsError);
        return;
      }
    }

    setError(null);
    setLoading(true);
    try {
      if (isRegister) {
        // Согласие и профиль даются здесь, а запись в базу происходит после
        // входа, когда появится uid, — передаём их туда через модули-хранилища
        rememberConsent(currentConsents());
        rememberSignup({ city: cityKey, address: address.trim() });
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
          {/* Окна — цветом плашки: в знаке это дырки, сквозь них виден фон */}
          <DomioLogo height={40} color={t.accent} windowColor={t.accentSoft} />
        </Animated.View>

        <Animated.Text
          key={`title-${mode}`}
          entering={FadeInDown.delay(60).duration(380)}
          style={isRegister ? styles.title : [styles.title, brandFontLoaded && styles.wordmark]}
        >
          {isRegister ? 'Регистрация' : 'domio'}
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
          {/* Способ входа. Не вкладки всего экрана: имя, город и согласие
              общие, меняются только поля идентификации */}
          <View style={styles.methodRow}>
            {(
              [
                ['email', 'Почта'],
                ['phone', 'Телефон'],
              ] as const
            ).map(([key, label]) => (
              <PressableScale
                key={key}
                style={[styles.methodBtn, method === key && styles.methodBtnOn]}
                onPress={() => switchMethod(key)}
                disabled={loading}
              >
                <Text style={[styles.methodText, method === key && styles.methodTextOn]}>
                  {label}
                </Text>
              </PressableScale>
            ))}
          </View>

          {isRegister && (
            <Animated.View entering={FadeInDown.duration(260)}>
              <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Имя</Text>
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

          {!isPhone && (
            <>
              <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Email</Text>
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
            </>
          )}

          {isPhone && (
            <Animated.View entering={FadeInDown.duration(260)}>
              <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Телефон</Text>
              <TextInput
                style={styles.fieldInput}
                value={phone}
                // Смена номера обесценивает отправленный код — начинаем заново
                onChangeText={(v) => {
                  setPhone(v);
                  setCodeSent(false);
                  setCode('');
                }}
                placeholder="+7 999 123-45-67"
                placeholderTextColor={t.textMuted}
                keyboardType="phone-pad"
                autoComplete="tel"
                editable={!loading}
              />

              {codeSent && (
                <Animated.View entering={FadeInDown.duration(260)}>
                  <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Код из СМС</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={code}
                    onChangeText={setCode}
                    placeholder="••••••"
                    placeholderTextColor={t.textMuted}
                    keyboardType="number-pad"
                    autoComplete="sms-otp"
                    textContentType="oneTimeCode"
                    maxLength={6}
                    editable={!loading}
                    onSubmitEditing={submitPhone}
                    returnKeyType="go"
                  />
                </Animated.View>
              )}
            </Animated.View>
          )}

          {isRegister && (
            <Animated.View entering={FadeInDown.duration(260)}>
              <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Населённый пункт</Text>
              {/* Выбор из списка, а не ввод: одинаковое написание у клиента и
                  мастера — единственное, что связывает заявку с исполнителем */}
              <PressableScale
                style={styles.pickerField}
                onPress={() => setPickingCity(true)}
                disabled={loading}
              >
                <Text style={[styles.pickerValue, !cityName && styles.pickerPlaceholder]}>
                  {cityName || 'Выберите из списка'}
                </Text>
                <Text style={styles.pickerChevron}>›</Text>
              </PressableScale>

              <Text style={[styles.fieldLabel, styles.fieldLabelGap]}>Адрес</Text>
              <TextInput
                style={styles.fieldInput}
                value={address}
                onChangeText={setAddress}
                placeholder="ул. Ленина, 24, кв. 5"
                placeholderTextColor={t.textMuted}
                editable={!loading}
              />
              <Text style={styles.fieldHint}>
                Адрес увидит только тот мастер, которого вы выберете
              </Text>
            </Animated.View>
          )}

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
                </Text>{' '}
                и{' '}
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
            onPress={isPhone ? (codeSent ? submitPhone : sendCode) : submit}
            disabled={loading}
          >
            <Text style={styles.btnText}>
              {loading
                ? isPhone && !codeSent
                  ? 'Отправляем код…'
                  : isRegister
                    ? 'Создаём аккаунт…'
                    : 'Входим…'
                : isPhone && !codeSent
                  ? 'Получить код'
                  : isRegister
                    ? 'Зарегистрироваться'
                    : 'Войти'}
            </Text>
          </PressableScale>

          {/* Повторная отправка — с обратным отсчётом: сервер всё равно
              не отправит раньше минуты */}
          {isPhone && codeSent && (
            <PressableScale onPress={sendCode} disabled={loading || cooldownLeft > 0}>
              <Text style={styles.forgot}>
                {cooldownLeft > 0
                  ? `Отправить код ещё раз через ${cooldownLeft} с`
                  : 'Отправить код ещё раз'}
              </Text>
            </PressableScale>
          )}

          {/* Без восстановления пароля забывший его теряет доступ навсегда */}
          {!isPhone && !isRegister && (
            <PressableScale onPress={forgotPassword} disabled={loading}>
              <Text style={styles.forgot}>Забыли пароль?</Text>
            </PressableScale>
          )}
        </Animated.View>

        <Animated.View entering={FadeIn.delay(240).duration(360)} style={styles.switchRow}>
          <Text style={styles.hint}>{isRegister ? 'Уже есть аккаунт?' : 'Впервые здесь?'}</Text>
          <PressableScale onPress={switchMode} disabled={loading}>
            <Text style={styles.switchText}>{isRegister ? 'Войти' : 'Создать аккаунт'}</Text>
          </PressableScale>
        </Animated.View>
      </ScrollView>

      {openDoc && <LegalScreen docId={openDoc} onClose={() => setOpenDoc(null)} />}

      {pickingCity && (
        <CityPicker
          value={cityKey}
          onSelect={(key, name) => {
            setCityKey(key);
            setCityName(name);
            setPickingCity(false);
          }}
          onClose={() => setPickingCity(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
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
    title: { fontSize: 22, fontWeight: '800', color: t.text },
    // Начертание слова «domio» из брендбука: Oswald 400, капитель, разрядка
    // 0.14em. Вес явно 400 — иначе Android дорисует жирность поверх файла.
    wordmark: {
      fontFamily: 'Oswald_400Regular',
      fontWeight: '400',
      fontSize: 28,
      letterSpacing: 3.9,
      textTransform: 'uppercase',
      // Разрядка добавляет хвост после последней буквы — сдвигаем к центру
      marginRight: -3.9,
    },
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
    methodRow: {
      flexDirection: 'row',
      backgroundColor: t.inputBg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.inputBorder,
      padding: 3,
      gap: 3,
    },
    methodBtn: {
      flex: 1,
      borderRadius: 9,
      paddingVertical: 8,
      alignItems: 'center',
    },
    methodBtnOn: { backgroundColor: t.card },
    methodText: { fontWeight: '700', fontSize: 12, color: t.textMuted },
    methodTextOn: { color: t.text, fontWeight: '800' },
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
    fieldHint: { color: t.textMuted, fontWeight: '600', fontSize: 11, marginTop: 6 },
    pickerField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: t.inputBorder,
      borderRadius: 12,
      backgroundColor: t.inputBg,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    pickerValue: { flex: 1, fontSize: 14, fontWeight: '700', color: t.text },
    pickerPlaceholder: { color: t.textMuted, fontWeight: '600' },
    pickerChevron: { fontSize: 18, fontWeight: '700', color: t.textMuted },
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
    fieldNotice: {
      color: t.accent,
      fontWeight: '700',
      fontSize: 11.5,
      marginTop: 10,
      lineHeight: 16,
    },
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
