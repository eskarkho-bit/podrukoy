import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { Auth, browserLocalPersistence, initializeAuth } from 'firebase/auth';
import { collection, doc, getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

// Ключи веб-приложения Firebase не являются секретом: доступ к данным
// определяют правила в firestore.rules, а не скрытие конфига.
const firebaseConfig = {
  apiKey: 'AIzaSyA5GJjfbItpgEKS1TArXVyrcPWLoH3AGX8',
  authDomain: 'domio-7ad1c.firebaseapp.com',
  projectId: 'domio-7ad1c',
  storageBucket: 'domio-7ad1c.firebasestorage.app',
  messagingSenderId: '380253738862',
  appId: '1:380253738862:web:0f255925da3ed50775137f',
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);
// Storage по умолчанию молча повторяет неудачную загрузку до десяти минут —
// на экране это выглядит как вечное «Сохраняем…». Пока бакет не подключён
// или недоступен, честная ошибка через полминуты полезнее тихой надежды.
storage.maxUploadRetryTime = 20_000;
storage.maxOperationRetryTime = 10_000;
// Регион должен совпадать с тем, где развёрнуты функции: в functions/src
// регион не задан, значит us-central1
export const functions = getFunctions(app, 'us-central1');

/**
 * Идентификатор будущей заявки, выданный заранее.
 *
 * Нужен, чтобы создание было идемпотентным: с известным id запись идёт через
 * setDoc, и повторная отправка перезаписала бы тот же документ, а не создала
 * второй. Генератор берём у SDK — у его идентификаторов равномерное
 * распределение, а последовательные ключи упирались бы в один шард.
 */
export const newOrderId = () => doc(collection(db, 'orders')).id;

// Сессия должна переживать перезапуск приложения, иначе пользователь будет
// логиниться при каждом запуске. Хранилище на вебе и на телефоне разное:
// getReactNativePersistence живёт только в react-native сборке @firebase/auth,
// а типы для 'firebase/auth' берутся из веб-сборки — поэтому доступ через require.
function createAuth(): Auth {
  if (Platform.OS === 'web') {
    return initializeAuth(app, { persistence: browserLocalPersistence });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- см. комментарий выше
  const rn = require('firebase/auth') as {
    getReactNativePersistence: (storage: unknown) => never;
  };
  return initializeAuth(app, { persistence: rn.getReactNativePersistence(AsyncStorage) });
}

export const auth = createAuth();
