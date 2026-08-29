import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initTestApp, wipe } from './helpers';
import { runDeletion } from '../deletion';

// Удаление аккаунта. Раньше весь обход шёл с телефона семью подряд идущими
// операциями без транзакции: сбой посередине оставлял наполовину удалённый
// аккаунт. Проверяется именно это — что обрыв на любом этапе не страшен.

initTestApp();
const db = getFirestore();

const UID = 'client-del';

async function seed() {
  await db.doc(`users/${UID}`).set({ name: 'Дмитрий', city: 'грозный' });
  await db.doc(`users/${UID}/threads/support`).set({ name: 'Поддержка' });
  await db.doc(`users/${UID}/threads/support/messages/m1`).set({ text: 'привет' });

  await db.doc('orders/open-one').set({
    clientId: UID,
    clientName: 'Дмитрий',
    address: 'ул. Ленина, 24',
    comment: 'искрит',
    photoUrl: 'https://example.com/p.jpg',
    status: 'Поиск мастера',
  });
  await db.doc('orders/done-one').set({
    clientId: UID,
    clientName: 'Дмитрий',
    address: 'ул. Ленина, 24',
    clientPhone: '+79991234567',
    status: 'Завершена',
  });

  await db.doc(`masters/${UID}`).set({ name: 'Дмитрий', verified: true });
  await db.doc(`masters/${UID}/verification/application`).set({ phone: '79991234567' });

  // Жалобы: своя должна умереть с аккаунтом, чужая на его отзыв — остаться
  await db.doc('complaints/mine').set({
    byUid: UID,
    subjectType: 'review',
    masterId: 'кто-то',
    orderId: 'o-x',
    text: 'несправедливый отзыв',
    status: 'новая',
    createdAt: new Date(),
  });
  await db.doc('complaints/foreign').set({
    byUid: 'другой-мастер',
    subjectType: 'review',
    masterId: 'другой-мастер',
    orderId: 'o-y',
    reviewClientId: UID,
    text: 'жалоба на его отзыв',
    status: 'новая',
    createdAt: new Date(),
  });

  await db.doc(`deletions/${UID}`).set({ status: 'pending', requestedAt: new Date() });
}

beforeEach(async () => {
  await wipe('users', 'orders', 'masters', 'deletions', 'complaints', 'audit');
  await seed();
});

describe('полное удаление', () => {
  test('личные данные исчезают', async () => {
    await runDeletion(UID, 'test');

    expect((await db.doc(`users/${UID}`).get()).exists).toBe(false);
    expect((await db.doc(`masters/${UID}`).get()).exists).toBe(false);
    expect((await db.doc(`masters/${UID}/verification/application`).get()).exists).toBe(false);
    // Подколлекции Firestore сам не удаляет — обход обязан их достать
    expect((await db.doc(`users/${UID}/threads/support/messages/m1`).get()).exists).toBe(false);
  });

  // Заявки общие с мастером и служат историей расчётов, поэтому не удаляются.
  // Но имя, адрес, комментарий и фото — персональные данные, и они уходят.
  test('заявки остаются, но обезличиваются', async () => {
    await runDeletion(UID, 'test');

    const done = await db.doc('orders/done-one').get();
    expect(done.exists).toBe(true);
    expect(done.get('clientName')).toBe('Удалённый аккаунт');
    expect(done.get('address')).toBe('');
    expect(done.get('photoUrl')).toBeNull();
    // Телефон, разделённый с мастером при выборе, — тоже персональные данные
    expect(done.get('clientPhone')).toBeNull();
    expect(done.get('anonymizedAt')).toBeTruthy();
  });

  test('незакрытые заявки отменяются — мастеру некуда ехать', async () => {
    await runDeletion(UID, 'test');

    expect((await db.doc('orders/open-one').get()).get('status')).toBe('Отменена');
    // Завершённую трогать незачем: работа сделана и оплачена
    expect((await db.doc('orders/done-one').get()).get('status')).toBe('Завершена');
  });

  test('заявка помечается выполненной', async () => {
    await runDeletion(UID, 'test');

    const request = await db.doc(`deletions/${UID}`).get();
    expect(request.get('status')).toBe('done');
    expect(request.get('stage')).toBe('done');
    expect(request.get('completedAt')).toBeTruthy();
  });

  // Текст жалобы — свободный текст автора, он умирает вместе с аккаунтом.
  // Чужая жалоба принадлежит пожаловавшемуся и остаётся.
  test('жалобы автора умирают с аккаунтом, чужие остаются', async () => {
    await runDeletion(UID, 'test');

    expect((await db.doc('complaints/mine').get()).exists).toBe(false);
    expect((await db.doc('complaints/foreign').get()).exists).toBe(true);
  });

  test('обрыв на этапе жалоб возобновляется с него', async () => {
    await db.doc(`deletions/${UID}`).set({ stage: 'complaints' }, { merge: true });
    await runDeletion(UID, 'test');

    expect((await db.doc('complaints/mine').get()).exists).toBe(false);
    expect((await db.doc(`deletions/${UID}`).get()).get('status')).toBe('done');
  });

  test('аккаунт в Auth удаляется', async () => {
    await getAuth().createUser({ uid: UID, email: 'del@example.ru', password: 'secret123' });

    await runDeletion(UID, 'test');

    await expect(getAuth().getUser(UID)).rejects.toMatchObject({ code: 'auth/user-not-found' });
  });

  // Клиент удаляет свой аккаунт сам, а функция доделывает остальное. Если
  // аккаунта уже нет, это не ошибка, а нормальный ход событий.
  test('отсутствующий аккаунт в Auth не ломает удаление', async () => {
    await expect(runDeletion(UID, 'test')).resolves.toBeUndefined();
    expect((await db.doc(`deletions/${UID}`).get()).get('status')).toBe('done');
  });
});

describe('возобновление после сбоя', () => {
  // Ради этого всё и переписывалось: повтор продолжает с места обрыва,
  // а не начинает заново
  test.each(['orders', 'threads', 'verification', 'master', 'profile', 'auth'])(
    'обрыв на этапе «%s» — повтор доводит до конца',
    async (stage) => {
      await db.doc(`deletions/${UID}`).set({ stage }, { merge: true });

      await runDeletion(UID, 'test');

      expect((await db.doc(`deletions/${UID}`).get()).get('status')).toBe('done');
    },
  );

  // Пропуск пройденного — не оплошность, а смысл этапов. Если обрыв случился
  // на удалении аккаунта, профиль к тому моменту уже удалён, и трогать его
  // второй раз незачем.
  test('этап «auth» не возвращается к профилю', async () => {
    await db.doc(`deletions/${UID}`).set({ stage: 'auth' }, { merge: true });

    await runDeletion(UID, 'test');

    // Профиль остался — потому что в настоящей жизни его уже не было бы
    expect((await db.doc(`users/${UID}`).get()).exists).toBe(true);
    expect((await db.doc(`deletions/${UID}`).get()).get('status')).toBe('done');
  });

  test('пройденные этапы не выполняются заново', async () => {
    // Обрыв случился после заявок: обезличивание уже прошло, и повтор не
    // должен трогать их снова
    await db.doc('orders/done-one').set({ clientName: 'уже обезличено' }, { merge: true });
    await db.doc(`deletions/${UID}`).set({ stage: 'threads' }, { merge: true });

    await runDeletion(UID, 'test');

    expect((await db.doc('orders/done-one').get()).get('clientName')).toBe('уже обезличено');
  });

  test('повторный запуск завершённого удаления ничего не делает', async () => {
    await runDeletion(UID, 'test');
    const after = (await db.doc(`deletions/${UID}`).get()).get('completedAt');

    await runDeletion(UID, 'test');

    expect((await db.doc(`deletions/${UID}`).get()).get('completedAt')).toEqual(after);
  });

  test('без заявки на удаление ничего не происходит', async () => {
    await db.doc(`deletions/${UID}`).delete();

    await runDeletion(UID, 'test');

    expect((await db.doc(`users/${UID}`).get()).exists).toBe(true);
  });
});

describe('журнал', () => {
  test('этапы и завершение записаны', async () => {
    await runDeletion(UID, 'corr-del');

    const entries = await db.collection('audit').where('correlationId', '==', 'corr-del').get();
    const actions = entries.docs.map((d) => d.get('action'));
    expect(actions).toContain('account.deletion_stage');
    expect(actions).toContain('order.anonymized');
    expect(actions).toContain('account.deleted');
  });

  // Журнал переживает удаление аккаунта. Имя или адрес в нём обошли бы
  // само удаление данных.
  test('в журнале нет имени и адреса', async () => {
    await runDeletion(UID, 'corr-del2');

    const entries = await db.collection('audit').where('correlationId', '==', 'corr-del2').get();
    entries.docs.forEach((d) => {
      const details = JSON.stringify(d.get('details') ?? {});
      expect(details).not.toContain('Дмитрий');
      expect(details).not.toContain('Ленина');
    });
  });
});
