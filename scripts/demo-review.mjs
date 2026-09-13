// Демо-аккаунты для ревью в магазинах: клиент и проверенный мастер с живой
// историей заявок. Ревьюер Apple отклоняет приложение, в котором не смог
// пройти основной сценарий, а у нас он двусторонний: предложения клиенту
// присылает только проверенный мастер.
//
// Скрипт ходит в боевой проект теми же записями, что делает приложение, —
// от имени самих демо-пользователей, под теми же правилами доступа. Ничего
// админского в нём нет: единственный шаг, который правила ему запрещают, —
// одобрить анкету мастера, это делает модератор в приложении.
//
// Два этапа:
//   accounts  — аккаунты, профили, анкета мастера на проверку, заявки клиента
//   scenario  — после одобрения мастера: предложения, выбор, чат, оплата,
//               завершение и отзыв
// Оба идемпотентны: повторный прогон ничего не дублирует.
//
// Демо-данные живут в отдельном ключе населённого пункта «демо»: заявки
// демо-клиента видит только демо-мастер, а настоящие мастера Грозного не
// получают пушей о вымышленных розетках.
//
// Пароли — только через переменные окружения, в репозиторий они не попадают
// (он публичный):
//   DEMO_CLIENT_PASSWORD=… DEMO_MASTER_PASSWORD=… node scripts/demo-review.mjs accounts

import { deflateSync } from 'node:zlib';
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';

// Публичный веб-конфиг проекта — тот же, что в firebaseConfig.ts; доступ
// ограничивают правила, а не секретность ключа
const firebaseConfig = {
  apiKey: 'AIzaSyA5GJjfbItpgEKS1TArXVyrcPWLoH3AGX8',
  authDomain: 'domio-7ad1c.firebaseapp.com',
  projectId: 'domio-7ad1c',
  storageBucket: 'domio-7ad1c.firebasestorage.app',
  messagingSenderId: '380253738862',
  appId: '1:380253738862:web:0f255925da3ed50775137f',
};

const CLIENT = { email: 'client.review@domio.invalid', name: 'Дмитрий' };
const MASTER = { email: 'master.review@domio.invalid', name: 'Магомед', lastName: 'Эльмурзаев' };
const CITY = 'демо';
const ADDRESS = 'ул. Мира, 24';
// Редакции документов из components/legal.ts: если они поднимутся, гейт
// просто попросит принять их заново — это штатно
const CONSENTS = { terms: '2026-09-06', privacy: '2026-09-06' };
const BIOMETRIC_CONSENT = '2026-08-21';

const stage = process.argv[2];
if (stage !== 'accounts' && stage !== 'scenario') {
  console.error('Использование: node scripts/demo-review.mjs accounts|scenario');
  process.exit(1);
}
const passwords = {
  client: process.env.DEMO_CLIENT_PASSWORD,
  master: process.env.DEMO_MASTER_PASSWORD,
};
if (!passwords.client || !passwords.master) {
  console.error('Нужны DEMO_CLIENT_PASSWORD и DEMO_MASTER_PASSWORD в окружении');
  process.exit(1);
}

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const clock = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Отдельное приложение Firebase на каждого пользователя — без переключения сессий. */
async function session(key, { email, name }, password) {
  const app = initializeApp(firebaseConfig, key);
  const auth = getAuth(app);
  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    if (
      ![
        'auth/user-not-found',
        'auth/invalid-credential',
        'auth/invalid-login-credentials',
      ].includes(e.code)
    ) {
      throw e;
    }
    cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    console.log(`создан аккаунт ${key}`);
  }
  return { uid: cred.user.uid, db: getFirestore(app), storage: getStorage(app) };
}

/** Профиль — как его создаёт AppState при первом входе, плюс согласия. */
async function ensureProfile({ uid, db }, { email, name }) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists() && snap.get('city') === CITY) return;
  await setDoc(
    doc(db, 'users', uid),
    {
      name,
      email,
      phone: '',
      addresses: [ADDRESS],
      activeAddress: ADDRESS,
      city: CITY,
      themeMode: 'light',
      consents: CONSENTS,
      consentsAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
  console.log(`профиль ${email} записан`);
}

/**
 * PNG-заглушка вместо фотографии лица: круг на фирменном фоне. Настоящее
 * лицо в демо-аккаунте было бы чьим-то, а модератор и так знает, что
 * анкета демонстрационная.
 */
function placeholderPng(size = 256) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const cx = size / 2;
  const cy = size * 0.42;
  const r = size * 0.28;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3;
      const face = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const body = y > size * 0.72 && Math.abs(x - cx) < size * 0.3;
      const [R, G, B] = face ? [0xe8, 0xc4, 0xa2] : body ? [0xd9, 0xe1, 0xd4] : [0x5e, 0x7a, 0x56];
      raw[i] = R;
      raw[i + 1] = G;
      raw[i + 2] = B;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function ensureMaster(m) {
  const { uid, db, storage } = m;
  const master = await getDoc(doc(db, 'masters', uid));
  if (!master.exists()) {
    await setDoc(doc(db, 'masters', uid), {
      name: MASTER.name,
      lastName: MASTER.lastName,
      cities: [CITY],
      skills: ['электрика', 'сантехника', 'бытовая техника'],
      experienceYears: 9,
      education: 'среднее специальное',
      createdAt: serverTimestamp(),
    });
    console.log('анкета мастера создана');
  }
  const payment = await getDoc(doc(db, 'masters', uid, 'payment', 'details'));
  if (!payment.exists()) {
    await setDoc(doc(db, 'masters', uid, 'payment', 'details'), {
      banks: ['sber', 'tbank'],
      acceptsCash: true,
      updatedAt: serverTimestamp(),
    });
    console.log('реквизиты мастера записаны');
  }

  const appRef = doc(db, 'masters', uid, 'verification', 'application');
  const app = await getDoc(appRef);
  const status = app.exists() ? app.get('status') : null;
  if (status === 'pending' || status === 'approved') {
    console.log(`заявка на проверку уже ${status}`);
    return;
  }
  // Сначала черновик: правила не дают создать заявку сразу «на проверке»
  await setDoc(
    appRef,
    {
      phone: '79280000001',
      about:
        'Электрика и сантехника в квартирах и домах, свой инструмент. Демонстрационная анкета.',
      photoUrl: null,
      biometricConsent: BIOMETRIC_CONSENT,
      status: 'draft',
    },
    { merge: true },
  );
  const fileRef = ref(storage, `verification/${uid}/face.jpg`);
  await uploadBytes(fileRef, placeholderPng(), { contentType: 'image/png' });
  const photoUrl = await getDownloadURL(fileRef);
  await updateDoc(appRef, { photoUrl, status: 'pending', appliedAt: serverTimestamp() });
  console.log('анкета мастера отправлена на проверку — одобрить в разделе модерации');
}

const ORDERS = [
  {
    id: 'review-order-1',
    title: 'Мойка · Протекает · Сифон',
    comment: 'Под мойкой собирается вода, кажется, течёт сифон. Дом частный, первый этаж.',
    category: 'сантехника',
    objectId: 'sink',
    serviceLabel: 'Протекает',
  },
  {
    id: 'review-order-2',
    title: 'Розетка · Не работает · Искрит',
    comment: 'Розетка в спальне искрит, когда включаем обогреватель.',
    category: 'электрика',
    objectId: 'socket',
    serviceLabel: 'Не работает',
  },
  {
    id: 'review-order-3',
    title: 'Свет · Установка · Люстра',
    comment: 'Нужно повесить люстру в гостиной, потолок бетонный. Люстра уже куплена.',
    category: 'электрика',
    objectId: 'light',
    serviceLabel: 'Установка',
  },
];

async function ensureOrders(c) {
  const { uid, db } = c;
  // Свои заявки — запросом по clientId, как в приложении: прямое чтение
  // несуществующей заявки правила отклоняют, и «нет такой» неотличимо от
  // «нельзя»
  const mine = await getDocs(query(collection(db, 'orders'), where('clientId', '==', uid)));
  const existing = new Set(mine.docs.map((d) => d.id));
  for (const o of ORDERS) {
    if (existing.has(o.id)) continue;
    await setDoc(doc(db, 'orders', o.id), {
      clientId: uid,
      clientName: CLIENT.name,
      masterId: null,
      masterName: null,
      title: o.title,
      date: today(),
      status: 'Поиск мастера',
      comment: o.comment,
      photoUrl: null,
      address: ADDRESS,
      city: CITY,
      category: o.category,
      objectId: o.objectId,
      serviceLabel: o.serviceLabel,
      agreedPrice: null,
      agreedAt: null,
      reviewed: false,
      createdAt: serverTimestamp(),
    });
    console.log(`заявка «${o.title}» создана`);
  }
}

async function say(session, orderId, text) {
  await setDoc(doc(collection(session.db, 'orders', orderId, 'messages')), {
    senderId: session.uid,
    text,
    time: clock(),
    createdAt: serverTimestamp(),
  });
}

async function scenario(c, m) {
  const master = await getDoc(doc(m.db, 'masters', m.uid));
  if (master.get('verified') !== true) {
    console.error('Мастер ещё не одобрен: одобрите анкету в разделе модерации и запустите снова');
    process.exit(2);
  }

  // Предложения на все открытые заявки
  const prices = { 'review-order-1': 2500, 'review-order-2': 1800, 'review-order-3': 2800 };
  const comments = {
    'review-order-1': 'Приеду завтра к 10, сифон привезу с собой',
    'review-order-2': 'Могу сегодня после 18:00, проверю проводку',
    'review-order-3': 'Повешу за час, крепёж для бетона есть',
  };
  for (const o of ORDERS) {
    const order = await getDoc(doc(m.db, 'orders', o.id));
    if (!order.exists() || order.get('status') !== 'Поиск мастера') continue;
    const offer = await getDoc(doc(m.db, 'orders', o.id, 'offers', m.uid));
    if (offer.exists()) continue;
    await setDoc(doc(m.db, 'orders', o.id, 'offers', m.uid), {
      masterId: m.uid,
      masterName: MASTER.name,
      price: prices[o.id],
      comment: comments[o.id],
      status: 'pending',
      orderTitle: o.title,
      createdAt: serverTimestamp(),
    });
    console.log(`предложение к «${o.title}»`);
  }

  // Заявка 2 — в работе с перепиской и способом оплаты
  const accept = async (orderId) => {
    const order = await getDoc(doc(c.db, 'orders', orderId));
    if (order.get('status') !== 'Поиск мастера') return false;
    const batch = writeBatch(c.db);
    batch.update(doc(c.db, 'orders', orderId), {
      masterId: m.uid,
      masterName: MASTER.name,
      agreedPrice: prices[orderId],
      agreedAt: serverTimestamp(),
      status: 'В работе',
    });
    batch.update(doc(c.db, 'orders', orderId, 'offers', m.uid), { status: 'accepted' });
    await batch.commit();
    return true;
  };

  if (await accept('review-order-2')) {
    await sleep(2500); // серверу нужно время положить телефоны в заявку
    await say(c, 'review-order-2', 'Когда сможете приехать?');
    await say(m, 'review-order-2', 'Завтра к 10 утра, всё сделаю.');
    await say(c, 'review-order-2', 'Хорошо, ждём!');
    await updateDoc(doc(c.db, 'orders', 'review-order-2'), { paymentMethod: 'cash' });
    console.log('заявка 2 в работе: чат и способ оплаты');
  }

  // Заявка 3 — пройдена до конца: сдана, принята, оплачена, с отзывом
  if (await accept('review-order-3')) {
    await sleep(2500);
    await say(m, 'review-order-3', 'Люстра висит, проверьте свет.');
    await updateDoc(doc(m.db, 'orders', 'review-order-3'), { status: 'Ждёт подтверждения' });
    await updateDoc(doc(c.db, 'orders', 'review-order-3'), {
      status: 'Завершена',
      completedAt: serverTimestamp(),
      paymentMethod: 'transfer',
    });
    await updateDoc(doc(c.db, 'orders', 'review-order-3'), { paidAt: serverTimestamp() });
    await updateDoc(doc(m.db, 'orders', 'review-order-3'), {
      paymentReceivedAt: serverTimestamp(),
    });
    const batch = writeBatch(c.db);
    batch.set(doc(c.db, 'masters', m.uid, 'reviews', 'review-order-3'), {
      orderId: 'review-order-3',
      clientId: c.uid,
      clientName: CLIENT.name,
      stars: 5,
      text: 'Пришёл вовремя, повесил аккуратно, убрал за собой.',
      createdAt: serverTimestamp(),
    });
    batch.update(doc(c.db, 'orders', 'review-order-3'), { reviewed: true });
    await batch.commit();
    console.log('заявка 3 завершена с отзывом');
  }

  const offers = await getDocs(collection(c.db, 'orders', 'review-order-1', 'offers'));
  console.log(`заявка 1 открыта, предложений: ${offers.size}`);
}

const c = await session('client', CLIENT, passwords.client);
const m = await session('master', MASTER, passwords.master);
await ensureProfile(c, CLIENT);
await ensureProfile(m, MASTER);

if (stage === 'accounts') {
  await ensureMaster(m);
  await ensureOrders(c);
  console.log('готово: этап accounts');
} else {
  await scenario(c, m);
  console.log('готово: этап scenario');
}
process.exit(0);
