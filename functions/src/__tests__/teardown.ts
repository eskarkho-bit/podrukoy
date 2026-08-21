import { getFirestore } from 'firebase-admin/firestore';

// Соединение с Firestore держит процесс открытым, и jest жалуется, что не
// может выйти. Закрываем его после каждого набора.
afterAll(async () => {
  try {
    await getFirestore().terminate();
  } catch {
    // Приложение могло не инициализироваться — тогда закрывать нечего
  }
});
