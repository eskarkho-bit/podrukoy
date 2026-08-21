// Заглушки нативных модулей, которых в тестовой среде нет.
//
// Firebase здесь не инициализируется намеренно: чистые функции его не
// требуют, а компонентные тесты работают с заглушками. Тесты, которым нужна
// настоящая база, живут отдельно и ходят в эмулятор.

// Сам SDK Firebase подменяем целиком. Причин две: он поставляется в ESM,
// который jest без отдельной настройки не разбирает, и главное — тестировать
// здесь нечего. Поведение базы проверяется на эмуляторе (npm run test:rules),
// а сюда попадают функции, которые про базу ничего не знают.
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => jest.fn(async () => ({ data: {} }))),
  getFunctions: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  arrayUnion: jest.fn(),
  collection: jest.fn(),
  collectionGroup: jest.fn(),
  deleteDoc: jest.fn(),
  doc: jest.fn(() => ({ id: 'doc' })),
  getDoc: jest.fn(async () => ({ exists: () => false, data: () => undefined })),
  getDocs: jest.fn(async () => ({ docs: [] })),
  getFirestore: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(() => () => {}),
  orderBy: jest.fn(),
  query: jest.fn(),
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  where: jest.fn(),
  writeBatch: jest.fn(() => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() })),
}));

jest.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: jest.fn() },
  createUserWithEmailAndPassword: jest.fn(),
  deleteUser: jest.fn(),
  getAuth: jest.fn(),
  onAuthStateChanged: jest.fn(() => () => {}),
  reauthenticateWithCredential: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  updateProfile: jest.fn(),
}));

jest.mock('firebase/storage', () => ({
  deleteObject: jest.fn(),
  getDownloadURL: jest.fn(),
  getStorage: jest.fn(),
  ref: jest.fn(),
  uploadBytes: jest.fn(),
}));

// Инициализация Firebase на модульном уровне: любой импорт компонента тянет
// firebaseConfig, а тому нужна сеть. Подменяем целиком.
jest.mock('./firebaseConfig', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  // Идентификаторы заявок должны быть разными при каждом вызове — на этом
  // держится проверка идемпотентного создания
  newOrderId: jest.fn(() => `order-${Math.random().toString(36).slice(2, 10)}`),
}));

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  CameraType: { front: 'front', back: 'back' },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'dismiss' })),
}));

jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { BlurView: View };
});

// Reanimated в тестах подменяется своим же моком: анимации не проигрываются,
// но компоненты рендерятся. useReducedMotion в моке отсутствует — доопределяем.
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));
