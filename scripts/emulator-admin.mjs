// Роль модератора и демо-данные в ЭМУЛЯТОРЕ.
//
//   node scripts/emulator-admin.mjs you@mail.ru          — выдать роль модератора
//   node scripts/emulator-admin.mjs you@mail.ru --demo   — плюс насыпать демо-данные
//
// Перед запуском: эмуляторы подняты (см. README, «Локальный контур»), а
// аккаунт с этой почтой уже зарегистрирован в приложении — скрипт находит
// его uid в эмуляторе Auth.
//
// В боевой проект скрипт не ходит принципиально: хосты эмуляторов заданы
// жёстко, а не берутся из окружения. В бою роль модератора выдаётся только
// руками в консоли Firebase — на этом держится вся модель доступа.

import { createRequire } from 'node:module';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

// firebase-admin установлен в functions/, у корня его нет — берём оттуда
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

const email = process.argv[2];
if (!email || email.startsWith('--')) {
  console.error('Использование: node scripts/emulator-admin.mjs <email аккаунта> [--demo]');
  process.exit(1);
}

initializeApp({ projectId: 'demo-domio' });
const db = getFirestore();

const account = await getAuth()
  .getUserByEmail(email)
  .catch(() => null);
if (!account) {
  console.error(`В эмуляторе Auth нет аккаунта ${email} — сначала зарегистрируйтесь в приложении`);
  process.exit(1);
}

await db.doc(`admins/${account.uid}`).set({ addedAt: new Date().toISOString() });
console.log(`Модератор: ${email} (${account.uid})`);

if (process.argv.includes('--demo')) {
  const now = FieldValue.serverTimestamp();

  // Мастер в очереди на проверку — для вкладки «Мастера»
  await db.doc('masters/demo-applicant').set({
    name: 'Ахмед',
    cities: ['грозный'],
    skills: ['электрика'],
  });
  await db.doc('masters/demo-applicant/verification/application').set({
    phone: '79280001122',
    about: 'Электрик, свой инструмент, стаж 6 лет',
    photoUrl: null,
    status: 'pending',
    appliedAt: now,
  });

  // Проверенный мастер с отзывом и жалобой на него
  await db.doc('masters/demo-master').set({
    name: 'Иван',
    cities: ['грозный'],
    skills: ['сантехника'],
    verified: true,
    rating: 3,
    reviewsCount: 2,
    completedOrders: 5,
  });

  // Клиент и его заявки — для вкладок «Заявки» и «Люди»
  await db.doc('users/demo-client').set({
    name: 'Дмитрий',
    phone: '+79991234567',
    city: 'грозный',
  });
  await db.doc('orders/demo-open').set({
    clientId: 'demo-client',
    clientName: 'Дмитрий',
    masterId: null,
    masterName: null,
    title: 'Не работает розетка',
    comment: 'Искрит при включении чайника',
    address: 'ул. Ленина, 24',
    city: 'грозный',
    category: 'электрика',
    status: 'Поиск мастера',
    agreedPrice: null,
    agreedAt: null,
    reviewed: false,
    photoUrl: null,
    createdAt: now,
  });
  await db.doc('orders/demo-open/offers/demo-master').set({
    masterId: 'demo-master',
    masterName: 'Иван',
    price: 1500,
    comment: 'Приеду сегодня после 18:00',
    status: 'pending',
    orderTitle: 'Не работает розетка',
    createdAt: now,
  });
  await db.doc('orders/demo-done').set({
    clientId: 'demo-client',
    clientName: 'Дмитрий',
    masterId: 'demo-master',
    masterName: 'Иван',
    title: 'Течёт смеситель',
    comment: '',
    address: 'ул. Ленина, 24',
    city: 'грозный',
    category: 'сантехника',
    status: 'Завершена',
    agreedPrice: 2500,
    agreedAt: now,
    completedAt: now,
    reviewed: true,
    photoUrl: null,
    createdAt: now,
  });

  // Отзыв и жалоба мастера на него — для секции жалоб
  await db.doc('masters/demo-master/reviews/demo-done').set({
    orderId: 'demo-done',
    clientId: 'demo-client',
    clientName: 'Дмитрий',
    stars: 1,
    text: 'Ужасный мастер, всё сломал',
    createdAt: now,
  });
  await db.collection('complaints').add({
    byUid: 'demo-master',
    subjectType: 'review',
    masterId: 'demo-master',
    orderId: 'demo-done',
    reviewClientId: 'demo-client',
    text: 'Отзыв не о моей работе — смеситель менял другой человек',
    status: 'новая',
    createdAt: now,
  });

  // Обращение в поддержку — для вкладки «Поддержка»
  await db.doc('users/demo-client/threads/support').set({
    name: 'Поддержка',
    icon: '🛟',
    kind: 'support',
    unread: false,
    lastText: 'Не приходит код по СМС',
    lastFrom: 'user',
    updatedAt: now,
  });
  await db.collection('users/demo-client/threads/support/messages').add({
    from: 'user',
    text: 'Не приходит код по СМС',
    time: '12:00',
    createdAt: now,
  });

  console.log('Демо-данные насыпаны: очередь, заявки, отзыв с жалобой, обращение в поддержку');
}

process.exit(0);
