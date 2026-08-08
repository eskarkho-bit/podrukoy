import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebaseConfig';

// expo-image-picker отдаёт локальный URI (file:// на телефоне, blob: на вебе).
// Другому устройству он ничего не скажет, поэтому файл уезжает в Storage,
// а в заявке остаётся постоянная ссылка.
async function upload(path: string, localUri: string): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();

  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, blob, { contentType: blob.type || 'image/jpeg' });

  return getDownloadURL(fileRef);
}

/**
 * Фото к заявке. Путь построен по идентификатору заявки, а не пользователя:
 * только так правила Storage могут спросить у Firestore, кто участник этой
 * заявки, и не пустить остальных. Имя файла постоянное — повторная попытка
 * перезаписывает снимок, а не копит мусор.
 */
export function uploadOrderPhoto(orderId: string, localUri: string): Promise<string> {
  return upload(`orders/${orderId}/photo.jpg`, localUri);
}

/**
 * Снимок лица для проверки мастера. Путь фиксированный: пересъёмка заменяет
 * предыдущий кадр, а не копит их — это документ, а не галерея. Читать его
 * по правилам Storage могут только сам мастер и модератор.
 */
export function uploadVerificationPhoto(uid: string, localUri: string): Promise<string> {
  return upload(`verification/${uid}/face.jpg`, localUri);
}

/** Снимок удаляется вместе с аккаунтом. Его отсутствие — не ошибка. */
export async function deleteVerificationPhoto(uid: string): Promise<void> {
  try {
    await deleteObject(ref(storage, `verification/${uid}/face.jpg`));
  } catch {
    // Мастером человек мог и не быть — тогда удалять нечего
  }
}
