import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';

// Экспорт данных пользователя — право на переносимость, обещанное политикой
// конфиденциальности (docs/LEGAL-BRIEF.md). Собирается только то, что
// владелец и так читает своими правами: модуль не видит ничего сверх
// приложения. Фотографии уезжают ссылками — файл остаётся лёгким, а сами
// снимки защищены правилами Storage.

// Служебное в выгрузку не кладём: пуш-токены — техника устройств, а
// cardBindingId — токен платёжного провайдера; человеку он ничего не
// говорит, а наружу ему незачем.
const OMIT = new Set(['pushTokens', 'cardBindingId']);

/** Timestamp → ISO-строка, вложенно; служебные поля выбрасываются. */
export function sanitize(value: unknown): unknown {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (OMIT.has(k)) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

export type ExportInput = {
  uid: string;
  email: string;
  phone: string;
  profile: Record<string, unknown> | undefined;
  orders: { id: string; data: Record<string, unknown>; messages: Record<string, unknown>[] }[];
  supportMessages: Record<string, unknown>[];
  master: Record<string, unknown> | undefined;
  verification: Record<string, unknown> | undefined;
  // Как мастер принимает оплату: банки для перевода и наличные
  payment: Record<string, unknown> | undefined;
  myReviews: { orderId: string; data: Record<string, unknown> }[];
};

/** Чистая сборка файла из прочитанного — отдельно от чтения ради тестов. */
export function assembleExport(input: ExportInput): unknown {
  return sanitize({
    service: 'domio',
    exportedAt: new Date().toISOString(),
    account: { uid: input.uid, email: input.email || null, phone: input.phone || null },
    profile: input.profile ?? null,
    // Переписка лежит внутри своей заявки — как и в базе
    orders: input.orders.map((o) => ({ id: o.id, ...o.data, messages: o.messages })),
    support: input.supportMessages,
    master: input.master ?? null,
    verification: input.verification ?? null,
    payment: input.payment ?? null,
    // Написанные отзывы — данные автора. Полученные (о мастере) не
    // выгружаются: они принадлежат написавшим их клиентам
    reviewsWritten: input.myReviews.map((r) => ({ orderId: r.orderId, ...r.data })),
  });
}

/** Читает всё владельческое и собирает объект выгрузки. */
async function buildExport(uid: string, email: string, phone: string): Promise<unknown> {
  const profileSnap = await getDoc(doc(db, 'users', uid));

  const ordersSnap = await getDocs(
    query(collection(db, 'orders'), where('clientId', '==', uid), orderBy('createdAt', 'asc')),
  );
  const orders = [];
  for (const d of ordersSnap.docs) {
    const msgs = await getDocs(
      query(collection(db, 'orders', d.id, 'messages'), orderBy('createdAt', 'asc')),
    );
    orders.push({ id: d.id, data: d.data(), messages: msgs.docs.map((m) => m.data()) });
  }

  const supportSnap = await getDocs(
    query(
      collection(db, 'users', uid, 'threads', 'support', 'messages'),
      orderBy('createdAt', 'asc'),
    ),
  );

  const masterSnap = await getDoc(doc(db, 'masters', uid));
  const verificationSnap = await getDoc(doc(db, 'masters', uid, 'verification', 'application'));
  const paymentSnap = await getDoc(doc(db, 'masters', uid, 'payment', 'details'));

  const reviewsSnap = await getDocs(
    query(collectionGroup(db, 'reviews'), where('clientId', '==', uid), orderBy('createdAt')),
  );

  return assembleExport({
    uid,
    email,
    phone,
    profile: profileSnap.exists() ? profileSnap.data() : undefined,
    orders,
    supportMessages: supportSnap.docs.map((m) => m.data()),
    master: masterSnap.exists() ? masterSnap.data() : undefined,
    verification: verificationSnap.exists() ? verificationSnap.data() : undefined,
    payment: paymentSnap.exists() ? paymentSnap.data() : undefined,
    myReviews: reviewsSnap.docs.map((r) => ({ orderId: r.id, data: r.data() })),
  });
}

/** Собирает файл и отдаёт: на вебе — скачиванием, на телефоне — шарингом. */
export async function exportUserData(uid: string, email: string, phone: string): Promise<void> {
  const json = JSON.stringify(await buildExport(uid, email, phone), null, 2);
  const filename = `domio-data-${new Date().toISOString().slice(0, 10)}.json`;

  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, filename);
  file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
}
