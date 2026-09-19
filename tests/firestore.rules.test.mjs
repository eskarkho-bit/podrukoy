// Тесты правил доступа Firestore.
//
// Проверяют не «работает ли приложение», а то, что нельзя сделать в обход
// интерфейса: правила — единственное, что стоит между пользователями и
// чужими адресами, заявками и деньгами.
//
// Запуск: npm run test:rules — поднимает эмулятор Firestore.
// Эмулятор идёт на Java, и firebase-tools требует JDK 21 или новее.

import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  orderBy,
} from 'firebase/firestore';

// Префикс demo- гарантирует, что обращения никогда не уйдут в настоящий проект
const PROJECT_ID = 'demo-domio';

let env;

/** Firestore от имени конкретного пользователя. */
const as = (uid) => env.authenticatedContext(uid).firestore();

/** Firestore без входа. */
const anon = () => env.unauthenticatedContext().firestore();

// Ссылки на файлы правила пускают только в наше хранилище — фикстуры
// строятся так же, как getDownloadURL
const storageUrl = (name) =>
  `https://firebasestorage.googleapis.com/v0/b/domio-7ad1c.firebasestorage.app/o/${name}?alt=media`;

const order = (patch = {}) => ({
  clientId: 'client1',
  clientName: 'Дмитрий',
  masterId: null,
  masterName: null,
  title: 'Не работает розетка',
  comment: 'Искрит',
  photoUrl: null,
  address: 'ул. Ленина, 24',
  date: '06.08.2026',
  city: 'москва',
  category: 'электрика',
  status: 'Поиск мастера',
  agreedPrice: null,
  agreedAt: null,
  reviewed: false,
  // Правила принимают только серверное время создания
  createdAt: serverTimestamp(),
  ...patch,
});

const offer = (patch = {}) => ({
  masterId: 'master1',
  masterName: 'Иван',
  price: 3500,
  comment: 'Приеду сегодня после 18:00',
  status: 'pending',
  orderTitle: 'Не работает розетка',
  ...patch,
});

// Заявка, созданная до появления offers: предложение лежит в ней самой
const legacyOrder = (patch = {}) =>
  order({
    masterId: 'master1',
    masterName: 'Иван',
    status: 'Есть предложения',
    price: 3500,
    priceStatus: 'offered',
    priceHistory: [
      { amount: 3500, by: 'master', action: 'offered', at: '2026-08-01T10:00:00.000Z' },
    ],
    ...patch,
  });

before(async () => {
  // Адрес эмулятора приходит от emulators:exec: тестовые прогоны живут на
  // своих портах (firebase.tests.json) и не сталкиваются с демо-стендом
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host,
      port: Number(port),
    },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Модератор. Документ заводится вручную в консоли — из приложения нельзя.
    await setDoc(doc(db, 'admins/admin1'), { addedAt: '2026-08-06' });

    // Проверенные мастера: без verified лента заявок закрыта
    await setDoc(doc(db, 'masters/master1'), {
      name: 'Иван',
      city: 'москва',
      skills: ['электрика'],
      verified: true,
      rating: 4.8,
      reviewsCount: 5,
    });
    // Как master1 принимает оплату: видят он сам и модератор, клиенту копию
    // кладёт сервер
    await setDoc(doc(db, 'masters/master1/payment/details'), {
      banks: ['sber', 'tbank'],
      acceptsCash: true,
    });
    await setDoc(doc(db, 'masters/master2'), {
      name: 'Пётр',
      city: 'москва',
      skills: ['электрика'],
      verified: true,
    });
    // Анкета заведена, проверку не прошла
    await setDoc(doc(db, 'masters/newbie'), { name: 'Новичок', city: 'москва', skills: [] });
    await setDoc(doc(db, 'masters/newbie/verification/application'), {
      phone: '79991234567',
      about: 'Электрик',
      photoUrl: null,
      status: 'draft',
    });
    // Заявка, готовая к отправке: есть фото и согласие на него
    await setDoc(doc(db, 'masters/ready/verification/application'), {
      phone: '79990000000',
      about: 'Сантехник',
      photoUrl: storageUrl('face.jpg'),
      biometricConsent: '2026-08-06',
      status: 'draft',
    });
    // Заявка на рассмотрении
    await setDoc(doc(db, 'masters/waiting'), { name: 'Ожидающий', city: 'москва', skills: [] });
    await setDoc(doc(db, 'masters/waiting/verification/application'), {
      phone: '79991112233',
      about: '',
      photoUrl: storageUrl('face2.jpg'),
      status: 'pending',
    });

    // Заблокированные сервером: мастер с сохранившимся verified и клиент,
    // которому закрыто создание заявок. Оба флага пишет только Admin SDK.
    await setDoc(doc(db, 'masters/blockedMaster'), {
      name: 'Отстранённый',
      city: 'москва',
      skills: ['электрика'],
      verified: true,
      blocked: true,
    });
    await setDoc(doc(db, 'users/blockedClient'), {
      name: 'Нарушитель',
      blocked: true,
      blockedReason: 'Оскорбления в переписке',
    });

    await setDoc(doc(db, 'orders/open'), order());
    await setDoc(doc(db, 'orders/open/offers/master1'), offer());

    await setDoc(
      doc(db, 'orders/working'),
      order({
        masterId: 'master1',
        masterName: 'Иван',
        status: 'В работе',
        agreedPrice: 3500,
      }),
    );
    await setDoc(
      doc(db, 'orders/finished'),
      order({
        masterId: 'master1',
        masterName: 'Иван',
        status: 'Завершена',
        agreedPrice: 3500,
      }),
    );
    // Работа, начатая до блокировки мастера: бросать клиента посреди
    // ремонта нельзя, доступ к ней сохраняется
    await setDoc(
      doc(db, 'orders/blockedWork'),
      order({
        masterId: 'blockedMaster',
        masterName: 'Отстранённый',
        status: 'В работе',
        agreedPrice: 2000,
      }),
    );
    await setDoc(doc(db, 'orders/legacy'), legacyOrder());

    // Завершённая заявка с отзывом — на него жалуется master1
    await setDoc(
      doc(db, 'orders/finished2'),
      order({ masterId: 'master1', masterName: 'Иван', status: 'Завершена', agreedPrice: 1500 }),
    );
    await setDoc(doc(db, 'masters/master1/reviews/finished2'), {
      orderId: 'finished2',
      clientId: 'client1',
      clientName: 'Дмитрий',
      stars: 1,
      text: 'Плохо',
      createdAt: new Date(),
    });
  });
});

describe('Создание заявки', () => {
  test('своя заявка создаётся', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'orders/new1'), order()));
  });

  test('нельзя создать заявку от чужого имени', async () => {
    await assertFails(setDoc(doc(as('client1'), 'orders/new2'), order({ clientId: 'client2' })));
  });

  // По createdAt сортируется лента мастера: заявка «из будущего» висела бы
  // наверху у всех вечно
  test('время создания — только серверное', async () => {
    await assertFails(
      setDoc(doc(as('client1'), 'orders/late'), order({ createdAt: new Date('2099-01-01') })),
    );
    const noStamp = order();
    delete noStamp.createdAt;
    await assertFails(setDoc(doc(as('client1'), 'orders/nostamp'), noStamp));
  });

  // Заголовок уходит пушем всем мастерам города как есть
  test('заголовок, комментарий и адрес ограничены по длине', async () => {
    await assertFails(setDoc(doc(as('client1'), 'orders/t1'), order({ title: 'x'.repeat(201) })));
    await assertFails(setDoc(doc(as('client1'), 'orders/t2'), order({ title: '' })));
    await assertFails(
      setDoc(doc(as('client1'), 'orders/t3'), order({ comment: 'x'.repeat(1001) })),
    );
    await assertFails(setDoc(doc(as('client1'), 'orders/t4'), order({ address: 'x'.repeat(201) })));
    await assertSucceeds(
      setDoc(
        doc(as('client1'), 'orders/t5'),
        order({ title: 'x'.repeat(200), comment: 'x'.repeat(1000), address: 'x'.repeat(200) }),
      ),
    );
  });

  test('нельзя создать заявку сразу с мастером и ценой', async () => {
    await assertFails(
      setDoc(
        doc(as('client1'), 'orders/new3'),
        order({
          masterId: 'master1',
          status: 'В работе',
          agreedPrice: 100,
        }),
      ),
    );
  });

  test('нельзя создать заявку с выдуманной специальностью', async () => {
    await assertFails(setDoc(doc(as('client1'), 'orders/new4'), order({ category: 'магия' })));
  });

  // Список специальностей в правилах повторяет CATEGORIES из serviceOptions.ts:
  // новая позиция каталога без правки правил падала бы молча — у пользователя
  test('заявка с новой специальностью каталога создаётся', async () => {
    for (const category of ['двери и замки', 'отопление', 'кровля', 'сварка']) {
      await assertSucceeds(
        setDoc(doc(as('client1'), `orders/new-${category}`), order({ category })),
      );
    }
  });

  // Телефоны кладёт только сервер и только после выбора мастера: открытую
  // заявку читают все проверенные мастера города, номерам там не место
  test('нельзя создать заявку сразу с телефонами сторон', async () => {
    await assertFails(
      setDoc(doc(as('client1'), 'orders/new6'), order({ clientPhone: '+79990000000' })),
    );
    await assertFails(
      setDoc(doc(as('client1'), 'orders/new7'), order({ masterPhone: '+79990000000' })),
    );
  });

  test('повторная заявка создаётся с просьбой показать прошлому мастеру', async () => {
    await assertSucceeds(
      setDoc(doc(as('client1'), 'orders/new8'), order({ preferredMasterId: 'master1' })),
    );
  });

  test('просьба о мастере — строка, а не что попало', async () => {
    await assertFails(setDoc(doc(as('client1'), 'orders/new9'), order({ preferredMasterId: 42 })));
  });

  test('нельзя создать заявку сразу отмеченной как оценённая', async () => {
    await assertFails(setDoc(doc(as('client1'), 'orders/new5'), order({ reviewed: true })));
  });

  test('заявку нельзя удалить — только отменить', async () => {
    await assertFails(deleteDoc(doc(as('client1'), 'orders/open')));
  });

  // Заявка создаётся по заранее известному id, поэтому повтор — это update,
  // а не второй документ. Правила такой повтор обязаны отклонить.
  test('повторная отправка той же заявки не проходит', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'orders/twice'), order()));
    await assertFails(setDoc(doc(as('client1'), 'orders/twice'), order()));
  });

  // firstOfferAt считает сервер по первому предложению, closedByAdmin с
  // причиной — след принудительного закрытия. Клиент, засеявший их при
  // создании, испортил бы метрику и журнал спора.
  test('служебные отметки статистики и согласования при создании не подсунуть', async () => {
    await assertFails(setDoc(doc(as('client1'), 'orders/s1'), order({ statsCounted: true })));
    await assertFails(
      setDoc(doc(as('client1'), 'orders/s2'), order({ agreedAt: serverTimestamp() })),
    );
    await assertFails(
      setDoc(doc(as('client1'), 'orders/s3'), order({ photoUrl: storageUrl('early.jpg') })),
    );
  });

  test('нельзя подсунуть при создании серверные поля закрытия и метрики', async () => {
    await assertFails(
      setDoc(doc(as('client1'), 'orders/newS1'), order({ firstOfferAt: serverTimestamp() })),
    );
    await assertFails(
      setDoc(
        doc(as('client1'), 'orders/newS2'),
        order({ closedByAdmin: true, adminCloseReason: 'сам себе закрыл' }),
      ),
    );
  });
});

describe('Блокировка', () => {
  // Блокировка — серверное решение по нарушителю. Мастер теряет ленту и
  // право предлагать цену, клиент — создание новых заявок; уже идущая
  // работа не отнимается — за неё отвечает isAssignedMaster.
  test('заблокированный клиент не создаёт заявку', async () => {
    await assertFails(
      setDoc(doc(as('blockedClient'), 'orders/newBlocked'), order({ clientId: 'blockedClient' })),
    );
  });

  test('заблокированный мастер не видит открытую заявку', async () => {
    await assertFails(getDoc(doc(as('blockedMaster'), 'orders/open')));
  });

  test('заблокированный мастер не присылает предложение', async () => {
    await assertFails(
      setDoc(
        doc(as('blockedMaster'), 'orders/open/offers/blockedMaster'),
        offer({ masterId: 'blockedMaster', masterName: 'Отстранённый' }),
      ),
    );
  });

  test('заблокированный мастер продолжает видеть свою работу', async () => {
    await assertSucceeds(getDoc(doc(as('blockedMaster'), 'orders/blockedWork')));
  });

  // Флаг пишет только сервер: иначе блокировка снималась бы правкой
  // собственного профиля. Перезапись документа целиком, «теряющая» поле,
  // тоже отклоняется — на это и смотрит diff в правиле.
  test('владелец не может снять себе блокировку', async () => {
    await assertFails(
      updateDoc(doc(as('blockedClient'), 'users/blockedClient'), { blocked: false }),
    );
    await assertFails(setDoc(doc(as('blockedClient'), 'users/blockedClient'), { name: 'Чистый' }));
  });

  // То же и у мастера: блокировка лежит в его собственной анкете, но снять её
  // правкой анкеты нельзя — иначе отстранённый вернул бы себе ленту заявок с
  // адресами и фото клиентов. Обычные поля при этом остаются редактируемыми.
  test('отстранённый мастер не может снять себе блокировку', async () => {
    await assertFails(
      updateDoc(doc(as('blockedMaster'), 'masters/blockedMaster'), { blocked: false }),
    );
    // И заодно правкой других полей, «не заметившей» blocked, — тоже нет
    await assertFails(
      updateDoc(doc(as('blockedMaster'), 'masters/blockedMaster'), {
        blocked: false,
        city: 'казань',
      }),
    );
  });

  test('отстранённый мастер по-прежнему правит обычные поля анкеты', async () => {
    await assertSucceeds(
      updateDoc(doc(as('blockedMaster'), 'masters/blockedMaster'), { city: 'казань' }),
    );
  });

  // Пустой профиль считался бы «не заблокирован» — заблокированный не должен
  // мочь удалить его и завести чистый
  test('заблокированный клиент не удалит свой профиль, отстранённый мастер — анкету', async () => {
    await assertFails(deleteDoc(doc(as('blockedClient'), 'users/blockedClient')));
    await assertFails(deleteDoc(doc(as('blockedMaster'), 'masters/blockedMaster')));
  });

  test('нельзя завести профиль сразу с полем блокировки', async () => {
    await assertFails(
      setDoc(doc(as('client2'), 'users/client2'), { name: 'Хитрец', blocked: false }),
    );
  });

  // Симметрично клиенту: анкету мастера тоже нельзя родить сразу с флагом.
  // Берём uid без засеянной анкеты, иначе setDoc пошёл бы по пути update.
  test('нельзя завести анкету мастера сразу с полем блокировки', async () => {
    await assertFails(
      setDoc(doc(as('client2'), 'masters/client2'), { name: 'Хитрец', skills: [], blocked: false }),
    );
  });
});

describe('Фото заявки', () => {
  test('клиент прикладывает фото к свежей заявке', async () => {
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'orders/open'), {
        photoUrl: storageUrl('photo.jpg'),
      }),
    );
  });

  test('второй раз фото не подменить', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/open'), { photoUrl: 'https://a/1.jpg' });
    });
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/open'), {
        photoUrl: storageUrl('other.jpg'),
      }),
    );
  });

  test('после выбора мастера фото не подменить', async () => {
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), {
        photoUrl: storageUrl('other.jpg'),
      }),
    );
  });

  test('мастер чужое фото не приложит', async () => {
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/open'), {
        photoUrl: storageUrl('other.jpg'),
      }),
    );
  });
});

describe('Кто видит заявку', () => {
  test('мастер видит открытую заявку', async () => {
    await assertSucceeds(getDoc(doc(as('master2'), 'orders/open')));
  });

  test('пользователь без анкеты мастера не видит ничего чужого', async () => {
    await assertFails(getDoc(doc(as('stranger'), 'orders/open')));
  });

  test('без входа заявка не видна', async () => {
    await assertFails(getDoc(doc(anon(), 'orders/open')));
  });

  test('после выбора исполнителя заявка скрыта от остальных мастеров', async () => {
    await assertFails(getDoc(doc(as('master2'), 'orders/working')));
  });

  test('выбранный мастер свою заявку видит', async () => {
    await assertSucceeds(getDoc(doc(as('master1'), 'orders/working')));
  });

  // Модератор разбирает споры и закрывает зависшие сделки — ему нужен
  // полный контекст. Это осознанный разворот прежнего решения «админ не
  // видит заявок», зафиксированный в ARCHITECTURE.md.
  test('модератор читает любую заявку и список по статусу', async () => {
    await assertSucceeds(getDoc(doc(as('admin1'), 'orders/working')));
    await assertSucceeds(
      getDocs(query(collection(as('admin1'), 'orders'), where('status', '==', 'В работе'))),
    );
  });

  test('писать в заявку модератор не может — закрытие только через сервер', async () => {
    await assertFails(updateDoc(doc(as('admin1'), 'orders/working'), { status: 'Отменена' }));
    await assertFails(
      updateDoc(doc(as('admin1'), 'orders/open'), {
        closedByAdmin: true,
        adminCloseReason: 'спор',
      }),
    );
  });
});

describe('Предложения мастеров', () => {
  // Модератору предложения нужны в карточке заявки при разборе спора
  test('модератор видит предложение по заявке, чужой мастер — нет', async () => {
    await assertSucceeds(getDoc(doc(as('admin1'), 'orders/open/offers/master1')));
    await assertFails(getDoc(doc(as('master2'), 'orders/open/offers/master1')));
  });

  test('мастер присылает своё предложение', async () => {
    await assertSucceeds(
      setDoc(
        doc(as('master2'), 'orders/open/offers/master2'),
        offer({
          masterId: 'master2',
          masterName: 'Пётр',
          price: 3000,
        }),
      ),
    );
  });

  // Имя уходит клиенту в заголовок пуша и в заявку — только из анкеты
  test('в legacy-заявке мастер тоже представляется только именем из анкеты', async () => {
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/legacy'), {
        masterName: 'Поддержка domio',
        price: 1500,
        priceStatus: 'offered',
      }),
    );
    await assertSucceeds(
      updateDoc(doc(as('master1'), 'orders/legacy'), {
        masterName: 'Иван',
        price: 1500,
        priceStatus: 'offered',
      }),
    );
  });

  test('имя в предложении — из анкеты, перечень полей закрытый', async () => {
    await assertFails(
      setDoc(
        doc(as('master2'), 'orders/open/offers/master2'),
        offer({ masterId: 'master2', masterName: 'Поддержка domio' }),
      ),
    );
    await assertFails(
      setDoc(doc(as('master1'), 'orders/open/offers/master1'), offer({ telegram: '@x' })),
    );
    await assertFails(
      setDoc(
        doc(as('master1'), 'orders/open/offers/master1'),
        offer({ orderTitle: 'x'.repeat(201) }),
      ),
    );
  });

  // Запрос по группе коллекций доказывает правилам только равенство полей
  test('свои предложения по всем заявкам мастер собирает одним запросом', async () => {
    await assertSucceeds(
      getDocs(query(collectionGroup(as('master1'), 'offers'), where('masterId', '==', 'master1'))),
    );
    await assertFails(
      getDocs(query(collectionGroup(as('master1'), 'offers'), where('masterId', '==', 'master2'))),
    );
    await assertFails(getDocs(query(collectionGroup(as('master1'), 'offers'))));
  });

  test('на собственную заявку мастер цену не называет', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'orders/own-by-master1'), order({ clientId: 'master1' }));
    });
    await assertFails(setDoc(doc(as('master1'), 'orders/own-by-master1/offers/master1'), offer()));
  });

  test('нельзя писать в чужое предложение', async () => {
    await assertFails(
      setDoc(
        doc(as('master2'), 'orders/open/offers/master1'),
        offer({
          price: 100,
        }),
      ),
    );
  });

  test('нельзя подписать своё предложение чужим uid', async () => {
    await assertFails(
      setDoc(
        doc(as('master2'), 'orders/open/offers/master2'),
        offer({
          masterId: 'master1',
        }),
      ),
    );
  });

  test('не мастер предложить цену не может', async () => {
    await assertFails(
      setDoc(
        doc(as('stranger'), 'orders/open/offers/stranger'),
        offer({
          masterId: 'stranger',
        }),
      ),
    );
  });

  test('цена должна быть положительным числом', async () => {
    for (const price of [0, -100, '3500']) {
      await assertFails(
        setDoc(
          doc(as('master2'), 'orders/open/offers/master2'),
          offer({
            masterId: 'master2',
            price,
          }),
        ),
      );
    }
  });

  test('предложение нельзя прислать сразу принятым', async () => {
    await assertFails(
      setDoc(
        doc(as('master2'), 'orders/open/offers/master2'),
        offer({
          masterId: 'master2',
          status: 'accepted',
        }),
      ),
    );
  });

  test('к заявке с уже выбранным мастером предложение не прикрепить', async () => {
    await assertFails(
      setDoc(
        doc(as('master2'), 'orders/working/offers/master2'),
        offer({
          masterId: 'master2',
        }),
      ),
    );
  });

  test('чужие предложения мастеру не видны — цены конкурентов закрыты', async () => {
    await assertFails(getDoc(doc(as('master2'), 'orders/open/offers/master1')));
  });

  test('своё предложение мастер видит', async () => {
    await assertSucceeds(getDoc(doc(as('master1'), 'orders/open/offers/master1')));
  });

  test('клиент видит все предложения по своей заявке', async () => {
    await assertSucceeds(getDoc(doc(as('client1'), 'orders/open/offers/master1')));
  });

  test('мастер может отозвать своё предложение', async () => {
    await assertSucceeds(deleteDoc(doc(as('master1'), 'orders/open/offers/master1')));
  });

  test('чужое предложение удалить нельзя', async () => {
    await assertFails(deleteDoc(doc(as('master2'), 'orders/open/offers/master1')));
  });
});

describe('Выбор мастера клиентом', () => {
  // Так это делает приложение: заявка и предложение помечаются одним пакетом
  const pick = (db, orderId, masterId, patch = {}) => {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', orderId), {
      masterId,
      masterName: 'Иван',
      agreedPrice: 3500,
      status: 'В работе',
      ...patch,
    });
    batch.update(doc(db, 'orders', orderId, 'offers', masterId), { status: 'accepted' });
    return batch.commit();
  };

  test('клиент выбирает мастера из присланных предложений', async () => {
    await assertSucceeds(pick(as('client1'), 'open', 'master1'));
  });

  test('нельзя согласовать цену, отличную от предложенной', async () => {
    await assertFails(pick(as('client1'), 'open', 'master1', { agreedPrice: 100 }));
  });

  test('нельзя назначить мастера, который ничего не предлагал', async () => {
    await assertFails(pick(as('client1'), 'open', 'master2'));
  });

  test('мастер не может назначить себя сам', async () => {
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/open'), {
        masterId: 'master1',
        agreedPrice: 3500,
        status: 'В работе',
      }),
    );
  });

  test('посторонний клиент выбрать мастера не может', async () => {
    await assertFails(pick(as('client2'), 'open', 'master1'));
  });

  test('на заявке с мастером выбор повторить нельзя', async () => {
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), {
        masterId: 'master2',
        agreedPrice: 3500,
        status: 'В работе',
      }),
    );
  });
});

describe('Что клиент менять не вправе', () => {
  test('не может переписать адрес, название или имя мастера', async () => {
    await assertFails(updateDoc(doc(as('client1'), 'orders/open'), { address: 'другой' }));
    await assertFails(updateDoc(doc(as('client1'), 'orders/open'), { title: 'другое' }));
    await assertFails(updateDoc(doc(as('client1'), 'orders/working'), { masterName: 'Никто' }));
  });

  test('не может закрыть заявку в обход мастера', async () => {
    await assertFails(updateDoc(doc(as('client1'), 'orders/working'), { status: 'Завершена' }));
  });

  test('чужую заявку не видит и не меняет', async () => {
    await assertFails(getDoc(doc(as('client2'), 'orders/open')));
    await assertFails(updateDoc(doc(as('client2'), 'orders/open'), { status: 'Отменена' }));
  });

  test('может отменить свою незакрытую заявку', async () => {
    await assertSucceeds(updateDoc(doc(as('client1'), 'orders/open'), { status: 'Отменена' }));
    await assertSucceeds(updateDoc(doc(as('client1'), 'orders/working'), { status: 'Отменена' }));
  });

  // Телефоны сторон пишет только сервер после выбора мастера. Ни одна из
  // сторон дописать их не может: у клиента и мастера перечни разрешённых
  // полей закрыты, и номера в них не входят.
  test('телефоны сторон не дописать ни клиенту, ни мастеру', async () => {
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/open'), { masterPhone: '+79990000000' }),
    );
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), { clientPhone: '+79990000000' }),
    );
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), { clientPhone: '+79990000000' }),
    );
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), { masterPhone: '+79990000000' }),
    );
  });

  // Просьба показать заявку прошлому мастеру ставится один раз при создании:
  // менять её задним числом значило бы дёргать мастеров именными пушами
  test('просьбу о прошлом мастере после создания не поменять', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'orders/repeat'), order({ preferredMasterId: 'master1' }));
    });
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/repeat'), { preferredMasterId: 'master2' }),
    );
  });
});

describe('Завершение работы', () => {
  test('мастер отмечает работу выполненной', async () => {
    await assertSucceeds(
      updateDoc(doc(as('master1'), 'orders/working'), {
        status: 'Ждёт подтверждения',
      }),
    );
  });

  test('мастер не может подтвердить работу за клиента', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), { status: 'Ждёт подтверждения' });
    });
    await assertFails(updateDoc(doc(as('master1'), 'orders/working'), { status: 'Завершена' }));
  });

  test('мастер не может поднять себе согласованную цену', async () => {
    await assertFails(updateDoc(doc(as('master1'), 'orders/working'), { agreedPrice: 9000 }));
  });

  test('клиент подтверждает выполнение', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), { status: 'Ждёт подтверждения' });
    });
    await assertSucceeds(updateDoc(doc(as('client1'), 'orders/working'), { status: 'Завершена' }));
  });

  // Ложное «выполнено» не должно запирать клиента: работу можно вернуть
  test('клиент возвращает работу мастеру, если она не сделана', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), { status: 'Ждёт подтверждения' });
    });
    await assertSucceeds(updateDoc(doc(as('client1'), 'orders/working'), { status: 'В работе' }));
  });

  test('вернуть в работу можно только с приёмки, только клиенту и с той же ценой', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), { status: 'Ждёт подтверждения' });
    });
    await assertFails(updateDoc(doc(as('master1'), 'orders/working'), { status: 'В работе' }));
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), { status: 'В работе', agreedPrice: 100 }),
    );
    await assertFails(updateDoc(doc(as('client1'), 'orders/finished'), { status: 'В работе' }));
  });

  // По completedAt мастер видит доход по месяцам. Дата пишется вместе с
  // подтверждением и только серверным временем — иначе историю заработка
  // можно было бы рисовать задним числом.
  test('подтверждение может записать дату завершения серверным временем', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), { status: 'Ждёт подтверждения' });
    });
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'orders/working'), {
        status: 'Завершена',
        completedAt: serverTimestamp(),
      }),
    );
  });

  test('произвольную дату завершения подставить нельзя', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), { status: 'Ждёт подтверждения' });
    });
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), {
        status: 'Завершена',
        completedAt: new Date('2020-01-01T00:00:00Z'),
      }),
    );
  });

  test('дату завершения нельзя дописать вне подтверждения', async () => {
    // У завершённой заявки — вместе с отметкой об отзыве
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/finished'), {
        reviewed: true,
        completedAt: serverTimestamp(),
      }),
    );
    // И мастеру при сдаче работы — тоже
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), {
        status: 'Ждёт подтверждения',
        completedAt: serverTimestamp(),
      }),
    );
  });
});

describe('Расчёт между сторонами', () => {
  // Деньги идут мимо сервиса; в заявке о них только отметки. Правила
  // держат три вещи: способ выбирает клиент и только после выбора мастера,
  // обе отметки ставятся один раз серверным временем и не снимаются, а
  // условия оплаты мастера в заявку кладёт только сервер.
  const settled = async (patch) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), patch);
    });
  };

  test('клиент выбирает способ у заявки с мастером и может передумать', async () => {
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'orders/working'), { paymentMethod: 'transfer' }),
    );
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'orders/working'), { paymentMethod: 'cash' }),
    );
  });

  test('способ — из двух; до выбора мастера и мастером не выбирается', async () => {
    await assertFails(updateDoc(doc(as('client1'), 'orders/working'), { paymentMethod: 'card' }));
    await assertFails(updateDoc(doc(as('client1'), 'orders/open'), { paymentMethod: 'cash' }));
    await assertFails(updateDoc(doc(as('master1'), 'orders/working'), { paymentMethod: 'cash' }));
  });

  // Выбор способа и выбор мастера — одно нажатие, если приложение так решит
  test('способ можно выбрать вместе с мастером', async () => {
    const db = as('client1');
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders/open'), {
      masterId: 'master1',
      masterName: 'Иван',
      agreedPrice: 3500,
      agreedAt: serverTimestamp(),
      status: 'В работе',
      paymentMethod: 'cash',
    });
    batch.update(doc(db, 'orders/open/offers/master1'), { status: 'accepted' });
    await assertSucceeds(batch.commit());
  });

  test('«оплатил» — после выбора способа, один раз, серверным временем', async () => {
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), { paidAt: serverTimestamp() }),
    );
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'orders/working'), {
        paymentMethod: 'cash',
        paidAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), { paidAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(doc(as('client1'), 'orders/working'), { paidAt: null }));
  });

  test('произвольную дату оплаты не подставить', async () => {
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), {
        paymentMethod: 'cash',
        paidAt: new Date('2020-01-01T00:00:00Z'),
      }),
    );
  });

  test('после отметки способ не меняется', async () => {
    await settled({ paymentMethod: 'cash', paidAt: new Date() });
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), { paymentMethod: 'transfer' }),
    );
  });

  test('оплату можно отметить вместе с подтверждением работы', async () => {
    await settled({ status: 'Ждёт подтверждения', paymentMethod: 'transfer' });
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'orders/working'), {
        status: 'Завершена',
        completedAt: serverTimestamp(),
        paidAt: serverTimestamp(),
      }),
    );
  });

  test('мастер подтверждает получение — один раз, и только назначенный', async () => {
    await assertSucceeds(
      updateDoc(doc(as('master1'), 'orders/working'), { paymentReceivedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), { paymentReceivedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(as('master2'), 'orders/blockedWork'), {
        paymentReceivedAt: serverTimestamp(),
      }),
    );
  });

  test('клиент не отмечает получение за мастера, мастер не подставляет дату', async () => {
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), { paymentReceivedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), {
        paymentReceivedAt: new Date('2020-01-01T00:00:00Z'),
      }),
    );
  });

  test('на отменённой заявке расчёт не отмечают', async () => {
    await settled({ status: 'Отменена', paymentMethod: 'cash' });
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), { paidAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), { paymentReceivedAt: serverTimestamp() }),
    );
  });

  // Условия оплаты мастера — копия закрытой подколлекции; кладёт её сервер
  test('банки и наличные мастера в заявку пишет только сервер', async () => {
    await assertFails(updateDoc(doc(as('client1'), 'orders/working'), { masterBanks: ['sber'] }));
    await assertFails(updateDoc(doc(as('master1'), 'orders/working'), { masterAcceptsCash: true }));
    await assertFails(
      setDoc(doc(as('client1'), 'orders/withTerms'), order({ masterBanks: ['sber'] })),
    );
    await assertFails(
      setDoc(doc(as('client1'), 'orders/prepaid'), order({ paidAt: serverTimestamp() })),
    );
  });
});

describe('Отказ мастера от заявки', () => {
  // Снять себя с заявки мастер не может — это делает сервер по отметке,
  // и правила пускают только саму отметку, только от назначенного мастера
  test('назначенный мастер ставит отметку об отказе серверным временем', async () => {
    await assertSucceeds(
      updateDoc(doc(as('master1'), 'orders/working'), { masterDeclinedAt: serverTimestamp() }),
    );
  });

  test('после отметки клиента об оплате отказаться нельзя', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), {
        paymentMethod: 'transfer',
        paidAt: new Date(),
      });
    });
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), { masterDeclinedAt: serverTimestamp() }),
    );
  });

  test('произвольное время и попутные поля не проходят', async () => {
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), {
        masterDeclinedAt: new Date('2020-01-01T00:00:00Z'),
      }),
    );
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), {
        masterDeclinedAt: serverTimestamp(),
        status: 'Поиск мастера',
      }),
    );
  });

  test('отказаться может только назначенный мастер и только от работы в процессе', async () => {
    await assertFails(
      updateDoc(doc(as('master2'), 'orders/working'), { masterDeclinedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), { masterDeclinedAt: serverTimestamp() }),
    );
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), { status: 'Ждёт подтверждения' });
    });
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), { masterDeclinedAt: serverTimestamp() }),
    );
  });

  test('второй раз отметку не поставить, при создании не подсунуть', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), { masterDeclinedAt: new Date() });
    });
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/working'), { masterDeclinedAt: serverTimestamp() }),
    );
    await assertFails(
      setDoc(
        doc(as('client1'), 'orders/declined-new'),
        order({ masterDeclinedAt: serverTimestamp() }),
      ),
    );
  });
});

describe('Отзывы и рейтинг', () => {
  const review = (patch = {}) => ({
    orderId: 'finished',
    clientId: 'client1',
    clientName: 'Дмитрий',
    stars: 5,
    text: 'Всё сделал быстро',
    ...patch,
  });

  test('клиент оценивает завершённую работу', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'masters/master1/reviews/finished'), review()));
  });

  test('отзыв к незавершённой заявке не принимается', async () => {
    await assertFails(
      setDoc(
        doc(as('client1'), 'masters/master1/reviews/working'),
        review({
          orderId: 'working',
        }),
      ),
    );
  });

  test('нельзя оценить чужую работу', async () => {
    await assertFails(
      setDoc(
        doc(as('client2'), 'masters/master1/reviews/finished'),
        review({
          clientId: 'client2',
        }),
      ),
    );
  });

  test('нельзя оценить мастера, который эту заявку не делал', async () => {
    await assertFails(setDoc(doc(as('client1'), 'masters/master2/reviews/finished'), review()));
  });

  test('оценка вне 1..5 не принимается', async () => {
    for (const stars of [0, 6, 4.5, '5']) {
      await assertFails(
        setDoc(doc(as('client1'), 'masters/master1/reviews/finished'), review({ stars })),
      );
    }
  });

  test('отзыв нельзя переписать или удалить задним числом', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'masters/master1/reviews/finished'), review()));
    await assertFails(
      updateDoc(doc(as('client1'), 'masters/master1/reviews/finished'), { stars: 1 }),
    );
    await assertFails(deleteDoc(doc(as('client1'), 'masters/master1/reviews/finished')));
  });

  test('мастер не может подделать себе рейтинг', async () => {
    await assertFails(updateDoc(doc(as('master1'), 'masters/master1'), { rating: 5 }));
    await assertFails(updateDoc(doc(as('master1'), 'masters/master1'), { reviewsCount: 999 }));
    await assertFails(
      setDoc(doc(as('newbie'), 'masters/newbie'), {
        name: 'Новичок',
        skills: [],
        rating: 5,
      }),
    );
  });

  test('мастер не может накрутить себе счётчик заказов', async () => {
    await assertFails(updateDoc(doc(as('master1'), 'masters/master1'), { completedOrders: 100 }));
    await assertFails(
      setDoc(doc(as('newbie'), 'masters/newbie'), {
        name: 'Новичок',
        skills: [],
        completedOrders: 100,
      }),
    );
  });

  test('обычные поля анкеты мастер меняет свободно', async () => {
    await assertSucceeds(
      updateDoc(doc(as('master1'), 'masters/master1'), {
        city: 'казань',
        skills: ['сантехника'],
      }),
    );
  });

  // Профиль, который видит клиент у предложения: фамилия, стаж, образование.
  // Всё со слов мастера — проверять нечем, но и вреда от них нет.
  test('в анкете нет ни лишних полей, ни романов, ни выдуманного образования', async () => {
    await assertFails(updateDoc(doc(as('master1'), 'masters/master1'), { telegram: '@x' }));
    await assertFails(updateDoc(doc(as('master1'), 'masters/master1'), { name: 'x'.repeat(101) }));
    await assertFails(updateDoc(doc(as('master1'), 'masters/master1'), { education: 'академик' }));
    await assertFails(
      updateDoc(doc(as('master1'), 'masters/master1'), {
        cities: Array.from({ length: 21 }, (_, i) => `город${i}`),
      }),
    );
  });

  test('фамилию, стаж и образование мастер пишет сам', async () => {
    await assertSucceeds(
      updateDoc(doc(as('master1'), 'masters/master1'), {
        lastName: 'Петров',
        experienceYears: 7,
        education: 'среднее специальное',
      }),
    );
  });

  test('отметку «отзыв оставлен» ставит только клиент и только раз', async () => {
    await assertSucceeds(updateDoc(doc(as('client1'), 'orders/finished'), { reviewed: true }));
    await assertFails(updateDoc(doc(as('master1'), 'orders/finished'), { reviewed: true }));
  });

  // Пометку скрытия ставит только сервер по решению модератора: отзыв,
  // рождённый сразу скрытым, обошёл бы и модерацию, и пересчёт рейтинга
  test('пометку скрытия нельзя подсунуть при создании отзыва', async () => {
    await assertFails(
      setDoc(doc(as('client1'), 'masters/master1/reviews/finished'), review({ hidden: false })),
    );
  });

  // Карточка пользователя в модерации и экспорт данных: свои отзывы по всем
  // мастерам собирают модератор и сам автор, посторонний — нет
  test('отзывы клиента по всем мастерам: автор и модератор — да, чужой — нет', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'masters/master1/reviews/finished'), review()));
    await assertSucceeds(
      getDocs(query(collectionGroup(as('admin1'), 'reviews'), where('clientId', '==', 'client1'))),
    );
    await assertSucceeds(
      getDocs(query(collectionGroup(as('client1'), 'reviews'), where('clientId', '==', 'client1'))),
    );
    await assertFails(
      getDocs(query(collectionGroup(as('master1'), 'reviews'), where('clientId', '==', 'client1'))),
    );
  });
});

describe('Переписка по заявке', () => {
  const message = (senderId, text = 'Здравствуйте') => ({
    senderId,
    text,
    time: '14:32',
    createdAt: new Date(),
  });

  test('клиент и выбранный мастер переписываются', async () => {
    await assertSucceeds(
      addDoc(collection(as('client1'), 'orders/working/messages'), message('client1')),
    );
    await assertSucceeds(
      addDoc(collection(as('master1'), 'orders/working/messages'), message('master1')),
    );
  });

  test('мастер с непринятым предложением в чат не попадает', async () => {
    await assertFails(
      addDoc(collection(as('master1'), 'orders/open/messages'), message('master1')),
    );
  });

  test('посторонний не пишет и не читает', async () => {
    await assertFails(
      addDoc(collection(as('master2'), 'orders/working/messages'), message('master2')),
    );
    await assertFails(getDoc(doc(as('master2'), 'orders/working/messages/any')));
  });

  test('в отменённую заявку не пишут — сделки больше нет', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/working'), { status: 'Отменена' });
    });
    await assertFails(
      addDoc(collection(as('client1'), 'orders/working/messages'), message('client1')),
    );
  });

  test('заблокированный клиентом мастер в чат не пишет', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/client1'), {
        name: 'Дмитрий',
        blockedMasters: ['master1'],
      });
    });
    await assertFails(
      addDoc(collection(as('master1'), 'orders/working/messages'), message('master1')),
    );
    await assertSucceeds(
      addDoc(collection(as('client1'), 'orders/working/messages'), message('client1')),
    );
  });

  // Заявка вернулась в поиск и ушла другому мастеру: переписка с прежним
  // новому не принадлежит — он читает только с момента своего назначения
  test('новый мастер не видит переписку с прежним', async () => {
    const assignedAt = new Date('2026-09-10T10:00:00Z');
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(
        doc(db, 'orders/reassigned'),
        order({
          masterId: 'master2',
          masterName: 'Пётр',
          status: 'В работе',
          agreedAt: assignedAt,
        }),
      );
      await setDoc(doc(db, 'orders/reassigned/messages/old'), {
        senderId: 'master1',
        text: 'мой телефон +7 928 000-11-22',
        time: '10:00',
        createdAt: new Date('2026-09-09T10:00:00Z'),
      });
      await setDoc(doc(db, 'orders/reassigned/messages/fresh'), {
        senderId: 'client1',
        text: 'когда приедете?',
        time: '11:00',
        createdAt: new Date('2026-09-11T10:00:00Z'),
      });
    });
    const messages = (uid) => collection(as(uid), 'orders/reassigned/messages');
    await assertSucceeds(
      getDocs(
        query(messages('master2'), where('createdAt', '>=', assignedAt), orderBy('createdAt')),
      ),
    );
    await assertFails(getDocs(query(messages('master2'), orderBy('createdAt'))));
    await assertFails(getDoc(doc(as('master2'), 'orders/reassigned/messages/old')));
    await assertSucceeds(getDoc(doc(as('master2'), 'orders/reassigned/messages/fresh')));
    // Клиент и модератор читают всё
    await assertSucceeds(getDocs(query(messages('client1'), orderBy('createdAt'))));
    await assertSucceeds(getDocs(query(messages('admin1'), orderBy('createdAt'))));
  });

  test('нельзя отправить сообщение от чужого имени', async () => {
    await assertFails(
      addDoc(collection(as('master1'), 'orders/working/messages'), message('client1')),
    );
  });

  test('пустое и гигантское сообщение не проходят', async () => {
    await assertFails(
      addDoc(collection(as('client1'), 'orders/working/messages'), message('client1', '')),
    );
    await assertFails(
      addDoc(
        collection(as('client1'), 'orders/working/messages'),
        message('client1', 'а'.repeat(2001)),
      ),
    );
  });

  const IMAGE = storageUrl('orders%2Fworking%2Fchat%2Fa.jpg');

  test('фото без текста проходит с обеих сторон', async () => {
    await assertSucceeds(
      addDoc(collection(as('client1'), 'orders/working/messages'), {
        ...message('client1', ''),
        imageUrl: IMAGE,
      }),
    );
    await assertSucceeds(
      addDoc(collection(as('master1'), 'orders/working/messages'), {
        ...message('master1', ''),
        imageUrl: IMAGE,
      }),
    );
  });

  // Не-https в imageUrl открыло бы дорогу javascript:-ссылкам в чужом чате
  test('картинка бывает только https-ссылкой разумной длины', async () => {
    await assertFails(
      addDoc(collection(as('client1'), 'orders/working/messages'), {
        ...message('client1', ''),
        imageUrl: 'javascript:alert(1)',
      }),
    );
    await assertFails(
      addDoc(collection(as('client1'), 'orders/working/messages'), {
        ...message('client1', 'текст есть'),
        imageUrl: 12345,
      }),
    );
    await assertFails(
      addDoc(collection(as('client1'), 'orders/working/messages'), {
        ...message('client1', ''),
        imageUrl: 'https://' + 'a'.repeat(2050),
      }),
    );
    // Чужой хост не пройдёт даже по https
    await assertFails(
      addDoc(collection(as('client1'), 'orders/working/messages'), {
        ...message('client1', ''),
        imageUrl: 'https://example.com/pic.jpg',
      }),
    );
  });

  test('посторонний не отправит фото даже с валидной ссылкой', async () => {
    await assertFails(
      addDoc(collection(as('master2'), 'orders/working/messages'), {
        ...message('master2', ''),
        imageUrl: IMAGE,
      }),
    );
  });

  // Разбор спора — это чтение диалога; голос в чужой сделке модератору
  // не принадлежит
  test('модератор читает переписку, но не пишет в неё', async () => {
    await assertSucceeds(getDocs(collection(as('admin1'), 'orders/working/messages')));
    await assertFails(
      addDoc(collection(as('admin1'), 'orders/working/messages'), message('admin1')),
    );
  });
});

describe('Заявки, созданные до появления offers', () => {
  test('клиент принимает цену, названную по старой схеме', async () => {
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'orders/legacy'), {
        priceStatus: 'accepted',
        agreedPrice: 3500,
        status: 'В работе',
      }),
    );
  });

  test('принять сумму, которой не называли, всё так же нельзя', async () => {
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/legacy'), {
        priceStatus: 'accepted',
        agreedPrice: 100,
        status: 'В работе',
      }),
    );
  });

  test('клиент отклоняет цену, заявка остаётся живой', async () => {
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'orders/legacy'), {
        priceStatus: 'declined',
      }),
    );
  });

  test('свой мастер пересматривает цену', async () => {
    await assertSucceeds(
      updateDoc(doc(as('master1'), 'orders/legacy'), {
        price: 3000,
        priceStatus: 'offered',
      }),
    );
  });

  test('чужой мастер в старую заявку не лезет', async () => {
    await assertFails(
      updateDoc(doc(as('master2'), 'orders/legacy'), {
        price: 3000,
        priceStatus: 'offered',
      }),
    );
  });
});

describe('Проверка мастера', () => {
  test('непроверенный мастер не видит заявок и не может предложить цену', async () => {
    await assertFails(getDoc(doc(as('newbie'), 'orders/open')));
    await assertFails(
      setDoc(
        doc(as('newbie'), 'orders/open/offers/newbie'),
        offer({
          masterId: 'newbie',
          masterName: 'Новичок',
        }),
      ),
    );
  });

  test('проверенный мастер видит и предлагает', async () => {
    await assertSucceeds(getDoc(doc(as('master2'), 'orders/open')));
    await assertSucceeds(
      setDoc(
        doc(as('master2'), 'orders/open/offers/master2'),
        offer({
          masterId: 'master2',
          masterName: 'Пётр',
          price: 3000,
        }),
      ),
    );
  });

  test('мастер не может объявить себя проверенным', async () => {
    await assertFails(updateDoc(doc(as('newbie'), 'masters/newbie'), { verified: true }));
  });

  test('роль модератора из приложения не выдать', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'admins/newbie'), { self: true }));
    await assertFails(setDoc(doc(as('admin1'), 'admins/newbie'), { granted: true }));
  });

  test('чужой список модераторов не прочитать', async () => {
    await assertFails(getDoc(doc(as('newbie'), 'admins/admin1')));
    await assertSucceeds(getDoc(doc(as('admin1'), 'admins/admin1')));
  });
});

describe('Реквизиты мастера', () => {
  // Расчёты идут мимо сервиса, но список банков и согласие на наличные —
  // данные мастера: их видят он сам и модератор, а клиент — только копию,
  // которую сервер положит в выбранную заявку.
  test('видят только владелец и модератор', async () => {
    await assertSucceeds(getDoc(doc(as('master1'), 'masters/master1/payment/details')));
    await assertSucceeds(getDoc(doc(as('admin1'), 'masters/master1/payment/details')));
    await assertFails(getDoc(doc(as('client1'), 'masters/master1/payment/details')));
    await assertFails(getDoc(doc(as('master2'), 'masters/master1/payment/details')));
  });

  test('мастер заводит и правит свои реквизиты', async () => {
    await assertSucceeds(
      setDoc(doc(as('master2'), 'masters/master2/payment/details'), {
        banks: ['vtb'],
        acceptsCash: false,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(as('master2'), 'masters/master2/payment/details'), {
        banks: ['vtb', 'alfa'],
        acceptsCash: true,
      }),
    );
  });

  // Банки — закрытый список, тот же, что в приложении: свободный текст
  // клиенту в приложении банка не пригодится, а номера карт сервису не нужны
  test('чужой банк, номер карты и лишние поля не пройдут', async () => {
    await assertFails(
      setDoc(doc(as('master2'), 'masters/master2/payment/details'), {
        banks: ['sber', 'банк-у-дома'],
        acceptsCash: true,
      }),
    );
    await assertFails(
      setDoc(doc(as('master2'), 'masters/master2/payment/details'), {
        banks: 'sber',
        acceptsCash: true,
      }),
    );
    await assertFails(
      setDoc(doc(as('master2'), 'masters/master2/payment/details'), {
        banks: ['sber'],
        acceptsCash: 'да',
      }),
    );
    await assertFails(
      setDoc(doc(as('master2'), 'masters/master2/payment/details'), {
        banks: ['sber'],
        acceptsCash: true,
        cardNumber: '2200 0000 0000 0000',
      }),
    );
    await assertFails(
      setDoc(doc(as('master2'), 'masters/master2/payment/details'), {
        banks: ['sber'],
        acceptsCash: true,
        updatedAt: new Date('2020-01-01T00:00:00Z'),
      }),
    );
  });

  test('чужие реквизиты не переписать и не удалить', async () => {
    await assertFails(
      setDoc(doc(as('master2'), 'masters/master1/payment/details'), {
        banks: ['vtb'],
        acceptsCash: true,
      }),
    );
    await assertFails(deleteDoc(doc(as('master2'), 'masters/master1/payment/details')));
    await assertFails(deleteDoc(doc(as('admin1'), 'masters/master1/payment/details')));
  });

  test('владелец удаляет свои реквизиты — часть удаления аккаунта', async () => {
    await assertSucceeds(deleteDoc(doc(as('master1'), 'masters/master1/payment/details')));
  });
});

describe('Заявка на проверку', () => {
  test('мастер заводит черновик', async () => {
    await assertSucceeds(
      setDoc(doc(as('fresh'), 'masters/fresh/verification/application'), {
        phone: '79995554433',
        about: 'Могу всё',
        photoUrl: null,
        status: 'draft',
      }),
    );
  });

  // Лишний документ «на проверке» — пуш всем модераторам и строка в очереди,
  // которую нечем закрыть
  test('документ анкеты только один — application', async () => {
    await assertFails(
      setDoc(doc(as('newbie'), 'masters/newbie/verification/extra'), {
        phone: '79991234567',
        about: '',
        photoUrl: null,
        status: 'draft',
      }),
    );
  });

  test('телефон — только цифры, снимок — только из нашего хранилища', async () => {
    await assertFails(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        phone: '+7 (999) 123-45-67',
      }),
    );
    await assertFails(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        photoUrl: 'https://example.com/face.jpg',
        biometricConsent: '2026-08-06',
      }),
    );
  });

  test('нельзя создать заявку сразу на проверке', async () => {
    await assertFails(
      setDoc(doc(as('fresh'), 'masters/fresh/verification/application'), {
        phone: '79995554433',
        about: '',
        photoUrl: storageUrl('f.jpg'),
        status: 'pending',
      }),
    );
  });

  // Вердикт пишет только модератор: подсунуть себе «проверен» ни при
  // создании, ни правкой черновика нельзя
  test('нельзя подсунуть себе решение модератора', async () => {
    await assertFails(
      setDoc(doc(as('fresh'), 'masters/fresh/verification/application'), {
        phone: '79995554433',
        status: 'draft',
        reviewedBy: 'fresh',
        reviewedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        reviewedBy: 'newbie',
      }),
    );
  });

  test('без фотографии на проверку не отправить', async () => {
    await assertFails(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        status: 'pending',
      }),
    );
  });

  test('с фотографией — отправляется', async () => {
    await assertSucceeds(
      updateDoc(doc(as('ready'), 'masters/ready/verification/application'), {
        status: 'pending',
      }),
    );
  });

  // Фото и согласие на него — всё, что нужно правилам; остальное решает
  // модератор, который смотрит анкету и звонит по телефону
  test('с фото и согласием заявка отправляется, решает модератор', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'masters/nocard/verification/application'), {
        phone: '79993334455',
        about: '',
        photoUrl: storageUrl('f.jpg'),
        biometricConsent: '2026-08-06',
        status: 'draft',
      });
    });
    await assertSucceeds(
      updateDoc(doc(as('nocard'), 'masters/nocard/verification/application'), {
        status: 'pending',
      }),
    );
  });

  test('свой вердикт мастер вынести не может', async () => {
    await assertFails(
      updateDoc(doc(as('waiting'), 'masters/waiting/verification/application'), {
        status: 'approved',
      }),
    );
  });

  test('пока заявка на проверке, править её нельзя', async () => {
    await assertFails(
      updateDoc(doc(as('waiting'), 'masters/waiting/verification/application'), {
        phone: '70000000000',
      }),
    );
  });

  test('чужую заявку не прочитать', async () => {
    await assertFails(getDoc(doc(as('master1'), 'masters/waiting/verification/application')));
    await assertSucceeds(getDoc(doc(as('waiting'), 'masters/waiting/verification/application')));
  });
});

describe('Правки одобренной анкеты', () => {
  const app = (uid) => doc(as(uid), 'masters/master1/verification/application');

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'masters/master1/verification/application'), {
        phone: '79280001122',
        about: 'Электрик',
        photoUrl: storageUrl('face3.jpg'),
        biometricConsent: '2026-08-21',
        status: 'approved',
      });
    });
  });

  test('«о себе» меняется без повторной проверки', async () => {
    await assertSucceeds(updateDoc(app('master1'), { about: 'Электрик, стаж 10 лет' }));
  });

  // На телефон из анкеты клиенты переводят оплату — подменить его тихо нельзя
  test('телефон и фото — только вместе с повторной отправкой на проверку', async () => {
    await assertFails(updateDoc(app('master1'), { phone: '79280009999' }));
    await assertFails(updateDoc(app('master1'), { photoUrl: storageUrl('new.jpg') }));
    await assertSucceeds(
      updateDoc(app('master1'), {
        phone: '79280009999',
        status: 'pending',
        appliedAt: serverTimestamp(),
      }),
    );
  });

  test('повторная отправка без фотографии не проходит', async () => {
    await assertFails(
      updateDoc(app('master1'), { phone: '79280009999', photoUrl: null, status: 'pending' }),
    );
  });

  test('вместе с повторной отправкой мастер снимает себе допуск одним пакетом', async () => {
    const me = as('master1');
    const batch = writeBatch(me);
    batch.update(doc(me, 'masters/master1/verification/application'), {
      photoUrl: storageUrl('new.jpg'),
      status: 'pending',
      appliedAt: serverTimestamp(),
    });
    batch.update(doc(me, 'masters/master1'), { verified: false });
    await assertSucceeds(batch.commit());
  });

  // Отзыв согласия у проверенного: снимок и согласие уходят вместе,
  // анкета возвращается в черновик — а не отклоняется правилами после того,
  // как файл уже удалён
  test('проверенный мастер отзывает согласие на фотографию', async () => {
    // Снять только согласие, оставив снимок, нельзя
    await assertFails(updateDoc(app('master1'), { biometricConsent: null, status: 'draft' }));
    await assertSucceeds(
      updateDoc(app('master1'), { photoUrl: null, biometricConsent: null, status: 'draft' }),
    );
  });

  test('ожидающий проверки мастер отзывает согласие — анкета уходит в черновик', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'masters/pendingMaster'), {
        name: 'Руслан',
        cities: ['грозный'],
        skills: ['электрика'],
      });
      await setDoc(doc(ctx.firestore(), 'masters/pendingMaster/verification/application'), {
        phone: '79990001122',
        about: '',
        photoUrl: storageUrl('verification%2FpendingMaster%2Fface.jpg'),
        biometricConsent: '2026-08-06',
        status: 'pending',
        appliedAt: new Date(),
      });
    });
    const ref = doc(as('pendingMaster'), 'masters/pendingMaster/verification/application');
    // Правкой других полей из очереди не выйти
    await assertFails(updateDoc(ref, { about: 'x', status: 'draft' }));
    await assertSucceeds(
      updateDoc(ref, { photoUrl: null, biometricConsent: null, status: 'draft' }),
    );
  });

  test('вердикт себе не подсунуть, чужую анкету не тронуть', async () => {
    await assertFails(
      updateDoc(app('master1'), { about: 'x', status: 'approved', reviewedBy: 'master1' }),
    );
    await assertFails(updateDoc(app('master2'), { about: 'x' }));
  });
});

describe('Согласие на фотографию лица', () => {
  test('без согласия фотографию не записать', async () => {
    await assertFails(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        photoUrl: storageUrl('face.jpg'),
      }),
    );
  });

  test('с согласием — записывается', async () => {
    await assertSucceeds(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        photoUrl: storageUrl('face.jpg'),
        biometricConsent: '2026-08-06',
      }),
    );
  });

  test('согласие нельзя убрать, оставив фотографию', async () => {
    await assertFails(
      updateDoc(doc(as('ready'), 'masters/ready/verification/application'), {
        biometricConsent: null,
      }),
    );
  });

  test('отзыв согласия вместе с удалением фотографии проходит', async () => {
    await assertSucceeds(
      updateDoc(doc(as('ready'), 'masters/ready/verification/application'), {
        photoUrl: null,
        biometricConsent: null,
        status: 'draft',
      }),
    );
  });

  test('мастер может снять с себя допуск, но не выдать', async () => {
    await assertSucceeds(updateDoc(doc(as('master1'), 'masters/master1'), { verified: false }));
    await assertFails(updateDoc(doc(as('newbie'), 'masters/newbie'), { verified: true }));
  });
});

describe('Решение модератора', () => {
  // Так это делает экран модерации: доступ и вердикт одним пакетом
  const decide = (db, uid, approved, reason = null) => {
    const batch = writeBatch(db);
    if (approved) batch.update(doc(db, 'masters', uid), { verified: true });
    batch.update(doc(db, 'masters', uid, 'verification', 'application'), {
      status: approved ? 'approved' : 'rejected',
      rejectionReason: reason,
      reviewedAt: new Date(),
      reviewedBy: 'admin1',
    });
    return batch.commit();
  };

  test('модератор допускает мастера', async () => {
    await assertSucceeds(decide(as('admin1'), 'waiting', true));
  });

  test('модератор отказывает с причиной', async () => {
    await assertSucceeds(decide(as('admin1'), 'waiting', false, 'Фото не читается'));
  });

  test('обычный пользователь решение вынести не может', async () => {
    await assertFails(decide(as('master1'), 'waiting', true));
    await assertFails(decide(as('waiting'), 'waiting', true));
  });

  test('модератор не переписывает саму анкету', async () => {
    await assertFails(updateDoc(doc(as('admin1'), 'masters/waiting'), { name: 'Другое имя' }));
    await assertFails(
      updateDoc(doc(as('admin1'), 'masters/waiting/verification/application'), {
        status: 'approved',
        phone: '70000000000',
      }),
    );
  });

  test('модератор не трогает рейтинг', async () => {
    await assertFails(updateDoc(doc(as('admin1'), 'masters/master1'), { rating: 5 }));
  });

  test('модератор читает очередь', async () => {
    await assertSucceeds(getDoc(doc(as('admin1'), 'masters/waiting/verification/application')));
  });

  test('вердикт выносится только по заявке на проверке', async () => {
    await assertFails(decide(as('admin1'), 'newbie', true));
  });
});

describe('Заявка на удаление аккаунта', () => {
  const request = (patch = {}) => ({
    requestedAt: serverTimestamp(),
    status: 'pending',
    ...patch,
  });

  test('человек просит удалить свой аккаунт', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'deletions/client1'), request()));
  });

  test('чужой аккаунт удалить не попросишь', async () => {
    await assertFails(setDoc(doc(as('client2'), 'deletions/client1'), request()));
  });

  test('нельзя подсунуть готовый этап или отметку о завершении', async () => {
    await assertFails(setDoc(doc(as('client1'), 'deletions/client1'), request({ stage: 'done' })));
    await assertFails(
      setDoc(
        doc(as('client1'), 'deletions/client1'),
        request({
          completedAt: serverTimestamp(),
        }),
      ),
    );
  });

  // Заявка, созданная сразу «выполненной», не попала бы в выборку сверки —
  // и удаление тихо не состоялось бы
  test('нельзя создать заявку сразу завершённой', async () => {
    await assertFails(
      setDoc(
        doc(as('client1'), 'deletions/client1'),
        request({
          status: 'done',
        }),
      ),
    );
  });

  test('время просьбы нельзя подделать', async () => {
    await assertFails(
      setDoc(doc(as('client1'), 'deletions/client1'), {
        requestedAt: new Date('2020-01-01'),
        status: 'pending',
      }),
    );
  });

  // Прогресс ведёт только функция: если бы его правил клиент, он мог бы
  // объявить удаление завершённым, не дав ему начаться
  test('прогресс и отмену клиент не пишет', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'deletions/client1'), { stage: 'orders' });
    });
    await assertFails(updateDoc(doc(as('client1'), 'deletions/client1'), { stage: 'done' }));
    await assertFails(deleteDoc(doc(as('client1'), 'deletions/client1')));
  });

  test('свою заявку видно, чужую нет', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'deletions/client1'), { stage: 'orders' });
    });
    await assertSucceeds(getDoc(doc(as('client1'), 'deletions/client1')));
    await assertFails(getDoc(doc(as('client2'), 'deletions/client1')));
  });
});

describe('Журнал действий', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit/e1'), {
        action: 'order.created',
        actorType: 'user',
        actorUid: 'client1',
        subjectType: 'order',
        subjectId: 'open',
        correlationId: 'test',
        details: {},
      });
    });
  });

  test('модератор читает журнал', async () => {
    await assertSucceeds(getDoc(doc(as('admin1'), 'audit/e1')));
  });

  test('обычный пользователь журнал не читает', async () => {
    await assertFails(getDoc(doc(as('client1'), 'audit/e1')));
    await assertFails(getDoc(doc(as('master1'), 'audit/e1')));
    await assertFails(getDoc(doc(anon(), 'audit/e1')));
  });

  // Смысл журнала в том, что запись нельзя ни подделать, ни стереть.
  // Модератор здесь не исключение: он — тот, чьи решения журнал и фиксирует.
  test('писать в журнал не может никто, включая модератора', async () => {
    await assertFails(
      setDoc(doc(as('admin1'), 'audit/fake'), {
        action: 'master.approved',
        actorType: 'system',
      }),
    );
    await assertFails(setDoc(doc(as('client1'), 'audit/fake'), { action: 'order.created' }));
    await assertFails(updateDoc(doc(as('admin1'), 'audit/e1'), { action: 'order.cancelled' }));
    await assertFails(deleteDoc(doc(as('admin1'), 'audit/e1')));
  });
});

describe('Сводка по заявкам', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stats/orders'), {
        completed: 12,
        sum: 36000,
        buckets: { 2500: 5, 3000: 7 },
      });
    });
  });

  test('модератор читает сводку', async () => {
    await assertSucceeds(getDoc(doc(as('admin1'), 'stats/orders')));
  });

  // Проверенный мастер сверяет с медианой свой средний чек. Персональных
  // данных в сводке нет — только гистограмма цен и счётчики.
  test('проверенный мастер читает сводку цен', async () => {
    await assertSucceeds(getDoc(doc(as('master1'), 'stats/orders')));
  });

  // Клиенту сводка не нужна, а непроверенная анкета не даёт ничего —
  // как и с лентой заявок
  test('клиент, непроверенный мастер и аноним сводку не читают', async () => {
    await assertFails(getDoc(doc(as('client1'), 'stats/orders')));
    await assertFails(getDoc(doc(as('newbie'), 'stats/orders')));
    await assertFails(getDoc(doc(anon(), 'stats/orders')));
  });

  // Мастеру открыт ровно один документ — сводка цен. Появись в stats
  // что-то ещё, оно останется закрытым, как и было.
  test('другие документы статистики мастеру не видны', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stats/other'), { secret: 1 });
    });
    await assertFails(getDoc(doc(as('master1'), 'stats/other')));
    await assertSucceeds(getDoc(doc(as('admin1'), 'stats/other')));
  });

  // По этим числам решают, какой брать процент. Возможность их накрутить
  // означала бы возможность влиять на ставку.
  test('писать сводку не может никто, включая модератора', async () => {
    await assertFails(setDoc(doc(as('admin1'), 'stats/orders'), { completed: 999 }));
    await assertFails(updateDoc(doc(as('admin1'), 'stats/orders'), { completed: 999 }));
    await assertFails(updateDoc(doc(as('master1'), 'stats/orders'), { completed: 999 }));
    await assertFails(deleteDoc(doc(as('admin1'), 'stats/orders')));
  });
});

describe('Коды входа по СМС', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'phoneCodes/abc123'), {
        codeHash: 'deadbeef',
        attempts: 0,
        sends: 1,
      });
    });
  });

  // Код приходит в СМС, а не из базы. Возможность прочитать документ означала
  // бы вход в чужой аккаунт без телефона в руках.
  test('коды не читает никто, включая модератора', async () => {
    await assertFails(getDoc(doc(as('client1'), 'phoneCodes/abc123')));
    await assertFails(getDoc(doc(as('admin1'), 'phoneCodes/abc123')));
    await assertFails(getDoc(doc(anon(), 'phoneCodes/abc123')));
  });

  // Запись означала бы подмену кода своим: счётчики попыток и хэш пишет
  // только сервер
  test('писать и удалять коды не может никто', async () => {
    await assertFails(setDoc(doc(as('client1'), 'phoneCodes/abc123'), { codeHash: 'мой' }));
    await assertFails(updateDoc(doc(as('admin1'), 'phoneCodes/abc123'), { attempts: 0 }));
    await assertFails(deleteDoc(doc(as('client1'), 'phoneCodes/abc123')));
    await assertFails(setDoc(doc(anon(), 'phoneCodes/new'), { codeHash: 'x' }));
  });
});

describe('Профиль пользователя', () => {
  test('владелец читает и пишет свой профиль', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'users/client1'), { name: 'Дмитрий' }));
    await assertSucceeds(getDoc(doc(as('client1'), 'users/client1')));
  });

  test('чужой профиль недоступен', async () => {
    await assertFails(getDoc(doc(as('client2'), 'users/client1')));
    await assertFails(setDoc(doc(as('client2'), 'users/client1'), { name: 'Взлом' }));
  });

  // Чужой номер в профиле выдавал бы человека за другого в поиске модератора;
  // списки не растут бесконечно — каждый пуш читает все токены
  test('чужой телефон и раздутые списки в профиль не записать', async () => {
    await assertFails(
      setDoc(doc(as('client1'), 'users/client1'), { name: 'Дмитрий', phone: '+79990000000' }),
    );
    await assertFails(
      setDoc(doc(as('client1'), 'users/client1'), {
        name: 'Дмитрий',
        pushTokens: Array.from({ length: 11 }, (_, i) => `ExponentPushToken[${i}]`),
      }),
    );
    await assertFails(setDoc(doc(as('client1'), 'users/client1'), { name: 'x'.repeat(101) }));
  });

  test('чужая переписка с поддержкой недоступна', async () => {
    await assertFails(getDoc(doc(as('client2'), 'users/client1/threads/support')));
  });

  test('свой профиль и анкету можно удалить — это часть удаления аккаунта', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'users/client1'), { name: 'Дмитрий' }));
    await assertSucceeds(deleteDoc(doc(as('client1'), 'users/client1')));
    await assertSucceeds(deleteDoc(doc(as('master1'), 'masters/master1')));
  });

  test('чужую анкету удалить нельзя', async () => {
    await assertFails(deleteDoc(doc(as('master2'), 'masters/master1')));
  });

  // Модератору профиль нужен целиком: карточка пользователя, флаг
  // блокировки, телефон для поиска. Писать он в него не может ничего.
  test('модератор читает чужой профиль, но не пишет в него', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'users/client1'), { name: 'Дмитрий' }));
    await assertSucceeds(getDoc(doc(as('admin1'), 'users/client1')));
    await assertFails(updateDoc(doc(as('admin1'), 'users/client1'), { name: 'Другое имя' }));
    await assertFails(updateDoc(doc(as('admin1'), 'users/blockedClient'), { blocked: false }));
  });
});

describe('Поддержка и модератор', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users/client1/threads/support'), {
        name: 'Поддержка',
        icon: '🛟',
        kind: 'support',
        unread: false,
        lastText: 'Не приходит код',
        lastFrom: 'user',
      });
      await setDoc(doc(db, 'users/client1/threads/support/messages/m1'), {
        from: 'user',
        text: 'Не приходит код',
        time: '12:00',
      });
      // Личный тред без kind — модератору не принадлежит
      await setDoc(doc(db, 'users/client1/threads/diary'), { name: 'Заметки' });
      await setDoc(doc(db, 'users/client1/threads/diary/messages/m1'), {
        from: 'user',
        text: 'личное',
        time: '12:01',
      });
    });
  });

  // Список обращений — запрос по группе коллекций. Фильтр по kind обязателен:
  // без него запрос зацепил бы личные треды, и правила отклоняют его целиком.
  test('модератор собирает обращения только с фильтром по kind', async () => {
    await assertSucceeds(
      getDocs(query(collectionGroup(as('admin1'), 'threads'), where('kind', '==', 'support'))),
    );
    await assertFails(getDocs(query(collectionGroup(as('admin1'), 'threads'))));
  });

  test('посторонним список обращений закрыт даже с фильтром', async () => {
    await assertFails(
      getDocs(query(collectionGroup(as('master1'), 'threads'), where('kind', '==', 'support'))),
    );
  });

  test('модератор читает переписку поддержки и отвечает от её лица', async () => {
    await assertSucceeds(getDoc(doc(as('admin1'), 'users/client1/threads/support/messages/m1')));
    await assertSucceeds(
      addDoc(collection(as('admin1'), 'users/client1/threads/support/messages'), {
        from: 'master',
        text: 'Проверили: код уходит, посмотрите папку «Спам».',
        time: '12:05',
        createdAt: serverTimestamp(),
      }),
    );
  });

  test('ответить от лица клиента модератор не может', async () => {
    await assertFails(
      addDoc(collection(as('admin1'), 'users/client1/threads/support/messages'), {
        from: 'user',
        text: 'Сам себе напишу',
        time: '12:06',
      }),
    );
  });

  test('написанное в поддержку не правится и не удаляется модератором', async () => {
    await assertFails(
      updateDoc(doc(as('admin1'), 'users/client1/threads/support/messages/m1'), {
        text: 'Другой текст',
      }),
    );
    await assertFails(deleteDoc(doc(as('admin1'), 'users/client1/threads/support/messages/m1')));
  });

  test('модератор помечает тред, но не переименовывает его', async () => {
    await assertSucceeds(
      updateDoc(doc(as('admin1'), 'users/client1/threads/support'), {
        unread: true,
        lastText: 'Проверили: код уходит',
        lastFrom: 'master',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as('admin1'), 'users/client1/threads/support'), { name: 'Реклама' }),
    );
  });

  // Доступ дан треду поддержки, а не поддереву пользователя: остальные
  // треды закрыты от модератора так же, как от любого постороннего.
  // (Сам документ профиля модератор теперь читает — это отдельное правило
  // с отдельными тестами в «Профиле пользователя».)
  test('личные треды пользователя модератору недоступны', async () => {
    await assertFails(getDoc(doc(as('admin1'), 'users/client1/threads/diary')));
    await assertFails(getDoc(doc(as('admin1'), 'users/client1/threads/diary/messages/m1')));
  });

  // Рабочий статус обращения: список значений закрыт, произвольная строка
  // сломала бы фильтры в разделе модерации
  test('модератор ставит статус обращения только из списка', async () => {
    await assertSucceeds(
      updateDoc(doc(as('admin1'), 'users/client1/threads/support'), {
        supportStatus: 'в работе',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as('admin1'), 'users/client1/threads/support'), {
        supportStatus: 'потерялось',
      }),
    );
  });
});

describe('Жалобы на отзывы', () => {
  const complaint = (patch = {}) => ({
    byUid: 'master1',
    subjectType: 'review',
    masterId: 'master1',
    orderId: 'finished2',
    reviewClientId: 'client1',
    text: 'Отзыв не о моей работе',
    status: 'новая',
    createdAt: serverTimestamp(),
    ...patch,
  });

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'complaints/c1'), {
        byUid: 'master1',
        subjectType: 'review',
        masterId: 'master1',
        orderId: 'finished',
        reviewClientId: 'client1',
        text: 'Отзыв не о моей работе',
        status: 'новая',
        createdAt: new Date(),
      });
    });
  });

  test('мастер жалуется на отзыв о себе', async () => {
    await assertSucceeds(addDoc(collection(as('master1'), 'complaints'), complaint()));
  });

  test('от чужого имени жалоба не подаётся', async () => {
    await assertFails(addDoc(collection(as('master2'), 'complaints'), complaint()));
  });

  // Вердикт выносит только сервер: жалоба, рождённая сразу решённой,
  // прошла бы мимо модератора и мимо журнала
  test('жалобу нельзя подать сразу решённой', async () => {
    await assertFails(
      addDoc(collection(as('master1'), 'complaints'), complaint({ status: 'решена' })),
    );
    await assertFails(
      addDoc(collection(as('master1'), 'complaints'), complaint({ resolvedBy: 'master1' })),
    );
  });

  test('пустая и гигантская жалоба не проходят', async () => {
    await assertFails(addDoc(collection(as('master1'), 'complaints'), complaint({ text: '' })));
    await assertFails(
      addDoc(collection(as('master1'), 'complaints'), complaint({ text: 'ж'.repeat(1001) })),
    );
  });

  // Свои жалобы автор видит только запросом с фильтром по byUid — правила
  // проверяются против запроса, а не результатов
  test('автор видит свои жалобы, чужие и без фильтра — нет', async () => {
    await assertSucceeds(
      getDocs(query(collection(as('master1'), 'complaints'), where('byUid', '==', 'master1'))),
    );
    await assertFails(
      getDocs(query(collection(as('master2'), 'complaints'), where('byUid', '==', 'master1'))),
    );
    await assertFails(getDocs(collection(as('master1'), 'complaints')));
  });

  test('модератор читает все жалобы', async () => {
    await assertSucceeds(getDoc(doc(as('admin1'), 'complaints/c1')));
    await assertSucceeds(getDocs(collection(as('admin1'), 'complaints')));
  });

  test('вердикт руками не ставит никто, включая модератора', async () => {
    await assertFails(updateDoc(doc(as('master1'), 'complaints/c1'), { status: 'решена' }));
    await assertFails(updateDoc(doc(as('admin1'), 'complaints/c1'), { status: 'решена' }));
    await assertFails(deleteDoc(doc(as('admin1'), 'complaints/c1')));
  });

  test('на чужой отзыв мастер не жалуется', async () => {
    await assertFails(
      addDoc(collection(as('master2'), 'complaints'), complaint({ byUid: 'master2' })),
    );
  });

  // Жалоба без отзыва — способ спамить модераторов и привязывать чужой uid
  test('жалоба только на существующий отзыв и на его автора', async () => {
    await assertFails(
      addDoc(collection(as('master1'), 'complaints'), complaint({ orderId: 'open' })),
    );
    await assertFails(
      addDoc(collection(as('master1'), 'complaints'), complaint({ reviewClientId: 'client2' })),
    );
  });

  // Клиент жалуется на мастера своей заявки или на его сообщение в её чате
  const clientComplaint = (patch = {}) => ({
    byUid: 'client1',
    subjectType: 'master',
    masterId: 'master1',
    orderId: 'finished',
    text: 'Пришёл не вовремя и нагрубил',
    status: 'новая',
    createdAt: serverTimestamp(),
    ...patch,
  });

  test('клиент жалуется на мастера своей заявки и на его сообщение', async () => {
    await assertSucceeds(addDoc(collection(as('client1'), 'complaints'), clientComplaint()));
    await assertSucceeds(
      addDoc(
        collection(as('client1'), 'complaints'),
        clientComplaint({ subjectType: 'message', messageId: 'm1' }),
      ),
    );
  });

  test('на мастера, с которым не имел дела, пожаловаться нельзя', async () => {
    // не тот мастер, заявка без мастера, не клиент, сообщение без id
    await assertFails(
      addDoc(collection(as('client1'), 'complaints'), clientComplaint({ masterId: 'master2' })),
    );
    await assertFails(
      addDoc(collection(as('client1'), 'complaints'), clientComplaint({ orderId: 'open' })),
    );
    await assertFails(
      addDoc(collection(as('master2'), 'complaints'), clientComplaint({ byUid: 'master2' })),
    );
    await assertFails(
      addDoc(collection(as('client1'), 'complaints'), clientComplaint({ subjectType: 'message' })),
    );
  });
});

// Список заблокированных мастеров ведёт сам клиент в своём профиле; правила
// предложений заглядывают в него, сервер — при рассылке о новой заявке
describe('Блокировка мастера клиентом', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/client1'), {
        name: 'Дмитрий',
        blockedMasters: ['master2'],
      });
    });
  });

  test('заблокированный клиентом мастер не присылает предложение, остальные — да', async () => {
    await assertFails(
      setDoc(
        doc(as('master2'), 'orders/open/offers/master2'),
        offer({ masterId: 'master2', masterName: 'Пётр' }),
      ),
    );
    await assertSucceeds(setDoc(doc(as('master1'), 'orders/open/offers/master1'), offer()));
  });

  test('список ведёт только сам клиент', async () => {
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'users/client1'), { blockedMasters: ['master2', 'master1'] }),
    );
    await assertFails(updateDoc(doc(as('master2'), 'users/client1'), { blockedMasters: [] }));
  });
});

// Приёмочный сценарий целиком, теми же записями, что делает приложение:
// анкета → отправка на проверку → одобрение пакетом из двух документов →
// лента открылась. Отдельные правила проверены выше; здесь — что цепочка
// сходится, а не «сломано между тестами».
describe('Сквозной сценарий допуска', () => {
  test('мастер подал анкету → модератор одобрил → мастер видит ленту', async () => {
    const master = as('applicant');
    await assertSucceeds(
      setDoc(doc(master, 'masters/applicant'), {
        name: 'Новый мастер',
        city: 'москва',
        skills: ['электрика'],
      }),
    );
    await assertSucceeds(
      setDoc(doc(master, 'masters/applicant/verification/application'), {
        phone: '79993334455',
        about: 'Электрик, свой инструмент',
        photoUrl: storageUrl('face3.jpg'),
        biometricConsent: '2026-08-29',
        status: 'draft',
      }),
    );
    await assertSucceeds(
      updateDoc(doc(master, 'masters/applicant/verification/application'), {
        status: 'pending',
        appliedAt: serverTimestamp(),
      }),
    );

    // До одобрения лента закрыта
    await assertFails(getDoc(doc(as('applicant'), 'orders/open')));

    // Модератор видит очередь и одобряет тем же пакетом, что AdminState.decide
    await assertSucceeds(
      getDocs(
        query(collectionGroup(as('admin1'), 'verification'), where('status', '==', 'pending')),
      ),
    );
    const adminDb = as('admin1');
    const verdict = writeBatch(adminDb);
    verdict.update(doc(adminDb, 'masters/applicant'), { verified: true });
    verdict.update(doc(adminDb, 'masters/applicant/verification/application'), {
      status: 'approved',
      rejectionReason: null,
      reviewedAt: serverTimestamp(),
      reviewedBy: 'admin1',
    });
    await assertSucceeds(verdict.commit());

    // Лента открылась
    await assertSucceeds(getDoc(doc(as('applicant'), 'orders/open')));
  });
});
