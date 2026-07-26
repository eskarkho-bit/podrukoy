import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebaseConfig';

// expo-image-picker отдаёт локальный URI (file:// на телефоне, blob: на вебе).
// Другому устройству он ничего не скажет, поэтому файл уезжает в Storage,
// а в заявке остаётся постоянная ссылка.
export async function uploadOrderPhoto(uid: string, localUri: string): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();

  const path = `orders/${uid}/${Date.now()}.jpg`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, blob, { contentType: blob.type || 'image/jpeg' });

  return getDownloadURL(fileRef);
}
