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
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

// Префикс demo- гарантирует, что обращения никогда не уйдут в настоящий проект
const PROJECT_ID = 'demo-podrukoy';

let env;

/** Firestore от имени конкретного пользователя. */
const as = (uid) => env.authenticatedContext(uid).firestore();

/** Firestore без входа. */
const anon = () => env.unauthenticatedContext().firestore();

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
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
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
    // Заявка, готовая к отправке: есть и фото, и карта
    await setDoc(doc(db, 'masters/ready/verification/application'), {
      phone: '79990000000',
      about: 'Сантехник',
      photoUrl: 'https://example.com/face.jpg',
      biometricConsent: '2026-08-06',
      cardLast4: '4242',
      cardBrand: 'MasterCard',
      cardBindingId: 'pm_test_1',
      status: 'draft',
    });
    // Заявка на рассмотрении
    await setDoc(doc(db, 'masters/waiting'), { name: 'Ожидающий', city: 'москва', skills: [] });
    await setDoc(doc(db, 'masters/waiting/verification/application'), {
      phone: '79991112233',
      about: '',
      photoUrl: 'https://example.com/face2.jpg',
      cardLast4: '1111',
      cardBindingId: 'pm_test_2',
      status: 'pending',
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
    await setDoc(doc(db, 'orders/legacy'), legacyOrder());
  });
});

describe('Создание заявки', () => {
  test('своя заявка создаётся', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'orders/new1'), order()));
  });

  test('нельзя создать заявку от чужого имени', async () => {
    await assertFails(setDoc(doc(as('client1'), 'orders/new2'), order({ clientId: 'client2' })));
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
});

describe('Фото заявки', () => {
  test('клиент прикладывает фото к свежей заявке', async () => {
    await assertSucceeds(
      updateDoc(doc(as('client1'), 'orders/open'), {
        photoUrl: 'https://example.com/photo.jpg',
      }),
    );
  });

  test('второй раз фото не подменить', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'orders/open'), { photoUrl: 'https://a/1.jpg' });
    });
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/open'), {
        photoUrl: 'https://example.com/other.jpg',
      }),
    );
  });

  test('после выбора мастера фото не подменить', async () => {
    await assertFails(
      updateDoc(doc(as('client1'), 'orders/working'), {
        photoUrl: 'https://example.com/other.jpg',
      }),
    );
  });

  test('мастер чужое фото не приложит', async () => {
    await assertFails(
      updateDoc(doc(as('master1'), 'orders/open'), {
        photoUrl: 'https://example.com/other.jpg',
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
});

describe('Предложения мастеров', () => {
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

  test('обычные поля анкеты мастер меняет свободно', async () => {
    await assertSucceeds(
      updateDoc(doc(as('master1'), 'masters/master1'), {
        city: 'казань',
        skills: ['сантехника'],
      }),
    );
  });

  test('отметку «отзыв оставлен» ставит только клиент и только раз', async () => {
    await assertSucceeds(updateDoc(doc(as('client1'), 'orders/finished'), { reviewed: true }));
    await assertFails(updateDoc(doc(as('master1'), 'orders/finished'), { reviewed: true }));
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

  test('нельзя создать заявку сразу на проверке', async () => {
    await assertFails(
      setDoc(doc(as('fresh'), 'masters/fresh/verification/application'), {
        phone: '79995554433',
        about: '',
        photoUrl: 'https://example.com/f.jpg',
        status: 'pending',
      }),
    );
  });

  test('нельзя подсунуть себе привязку карты', async () => {
    await assertFails(
      setDoc(doc(as('fresh'), 'masters/fresh/verification/application'), {
        phone: '79995554433',
        status: 'draft',
        cardBindingId: 'pm_fake',
        cardLast4: '0000',
      }),
    );
    await assertFails(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        cardBindingId: 'pm_fake',
      }),
    );
  });

  // Счётчик попыток привязки — защита от спама платежами у провайдера.
  // Если бы мастер мог его обнулять, защиты бы не было.
  test('нельзя переписать счётчик попыток привязки', async () => {
    await assertFails(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        bindingAttempts: 0,
      }),
    );
    await assertFails(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        lastBindingAt: null,
      }),
    );
    await assertFails(
      setDoc(doc(as('fresh'), 'masters/fresh/verification/application'), {
        phone: '79995554433',
        status: 'draft',
        bindingAttempts: 0,
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

  // Карта обязательна, но требовать её здесь нельзя: пока не настроен
  // платёжный провайдер, привязать её невозможно, и заявка стала бы
  // неотправляемой. Решение остаётся за модератором — он видит статус карты.
  test('без карты заявка отправляется, решает модератор', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'masters/nocard/verification/application'), {
        phone: '79993334455',
        about: '',
        photoUrl: 'https://example.com/f.jpg',
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

describe('Согласие на фотографию лица', () => {
  test('без согласия фотографию не записать', async () => {
    await assertFails(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        photoUrl: 'https://example.com/face.jpg',
      }),
    );
  });

  test('с согласием — записывается', async () => {
    await assertSucceeds(
      updateDoc(doc(as('newbie'), 'masters/newbie/verification/application'), {
        photoUrl: 'https://example.com/face.jpg',
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

  // Сводка нужна модератору вместо доступа к заявкам, а не в дополнение
  // к нему. Мастеру и клиенту она не нужна вовсе.
  test('остальные сводку не читают', async () => {
    await assertFails(getDoc(doc(as('client1'), 'stats/orders')));
    await assertFails(getDoc(doc(as('master1'), 'stats/orders')));
    await assertFails(getDoc(doc(anon(), 'stats/orders')));
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

describe('Профиль пользователя', () => {
  test('владелец читает и пишет свой профиль', async () => {
    await assertSucceeds(setDoc(doc(as('client1'), 'users/client1'), { name: 'Дмитрий' }));
    await assertSucceeds(getDoc(doc(as('client1'), 'users/client1')));
  });

  test('чужой профиль недоступен', async () => {
    await assertFails(getDoc(doc(as('client2'), 'users/client1')));
    await assertFails(setDoc(doc(as('client2'), 'users/client1'), { name: 'Взлом' }));
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
});
