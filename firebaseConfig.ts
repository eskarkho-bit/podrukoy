import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { Auth, browserLocalPersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
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

// Сессия должна переживать перезапуск приложения, иначе пользователь будет
// логиниться при каждом запуске. Хранилище на вебе и на телефоне разное:
// getReactNativePersistence живёт только в react-native сборке @firebase/auth,
// а типы для 'firebase/auth' берутся из веб-сборки — поэтому доступ через require.
function createAuth(): Auth {
  if (Platform.OS === 'web') {
    return initializeAuth(app, { persistence: browserLocalPersistence });
  }
  const rn = require('firebase/auth') as {
    getReactNativePersistence: (storage: unknown) => never;
  };
  return initializeAuth(app, { persistence: rn.getReactNativePersistence(AsyncStorage) });
}

export const auth = createAuth();
