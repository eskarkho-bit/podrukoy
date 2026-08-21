import Constants, { ExecutionEnvironment } from 'expo-constants';

// Крашрепорты через Sentry. После публикации это единственный способ узнать
// о падениях: пользователь не пишет письмо, он просто удаляет приложение.
//
// Пока DSN не задан, модуль честно не делает ничего — как привязка карты без
// ключей ЮKassa. DSN — публичное значение (как ключи Firebase в
// firebaseConfig.ts): он позволяет отправлять события, но не читать их.
// Задаётся в .env: EXPO_PUBLIC_SENTRY_DSN=https://…@….ingest.sentry.io/….

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initCrashReporting() {
  if (!dsn) return;

  // В Expo Go нативного модуля Sentry нет — init уронил бы приложение при
  // запуске через QR-код. Отчёты и не нужны в разработке: падение видно в
  // Metro. Поэтому и require ниже ленивый, а не import сверху файла.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  Sentry.init({
    dsn,
    // Трассировка производительности выключена: платим только за ошибки
    tracesSampleRate: 0,
  });
}
