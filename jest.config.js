// Тесты приложения. Правила доступа проверяются отдельно, на эмуляторе
// Firestore (npm run test:rules) — здесь только код, который выполняется
// на устройстве.
module.exports = {
  preset: 'jest-expo',

  // Тесты правил лежат в tests/ и запускаются своим прогоном на node:test —
  // jest их не касается. Тесты функций живут в functions/ и имеют свой
  // конфиг: у них другое окружение и другой набор моков.
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/tests/',
    '<rootDir>/functions/',
    '<rootDir>/podrukoy2/',
  ],

  // Модули Expo и React Native поставляются нескомпилированными, поэтому
  // из общего игнора их надо исключить
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|firebase|@firebase/.*)',
  ],

  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  collectCoverageFrom: ['components/**/*.{ts,tsx}', 'screens/**/*.{ts,tsx}', '!**/node_modules/**'],
};
