import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { initTestApp, wipe } from './helpers';
import {
  requireAdmin,
  closeOrder,
  setUserBlocked,
  setMasterBlocked,
  setReviewHidden,
  resolveComplaint,
  findUserByPhone,
} from '../adminActions';

// Действия модератора. Правила Firestore здесь не участвуют — Admin SDK их
// обходит, — поэтому каждая проверка прав и каждый инвариант держится кодом
// функций, и проверяется именно код: не-админа отбивает requireAdmin, повтор
// вызова не делает второго побочного шага, причины не утекают ни в мировые
// документы, ни в журнал.

initTestApp();
const db = getFirestore();

const ADMIN = 'admin-actions';
const MASTER = 'master-adm';
const CLIENT = 'client-adm';

const asRequest = (uid: string | null) =>
  ({ auth: uid ? { uid } : undefined, data: {} }) as unknown as CallableRequest<unknown>;

const actions = async () => (await db.collection('audit').get()).docs.map((d) => d.get('action'));

beforeEach(async () => {
  await wipe('admins', 'users', 'masters', 'orders', 'complaints', 'audit');
  await db.doc(`admins/${ADMIN}`).set({ addedAt: '2026-08-29' });
  await db.doc(`users/${CLIENT}`).set({ name: 'Дмитрий', phone: '+79991234567' });
  await db.doc(`masters/${MASTER}`).set({ name: 'Иван', verified: true });
  await db
    .doc(`masters/${MASTER}/verification/application`)
    .set({ phone: '79280001122', status: 'approved' });
});

describe('requireAdmin', () => {
  // Admin SDK обходит правила, и эта проверка — единственный рубеж между
  // обычным пользователем и действиями модератора
  test('пускает модератора и отбивает остальных', async () => {
    expect(await requireAdmin(asRequest(ADMIN))).toBe(ADMIN);
    await expect(requireAdmin(asRequest(CLIENT))).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(requireAdmin(asRequest(null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});

describe('closeOrder', () => {
  beforeEach(async () => {
    await db.doc('orders/dispute').set({
      clientId: CLIENT,
      masterId: MASTER,
      status: 'В работе',
      agreedPrice: 3000,
      title: 'Розетка',
    });
  });

  test('спорная заявка закрывается с причиной и следом модератора', async () => {
    const res = await closeOrder(ADMIN, 'dispute', 'Отменена', 'Мастер не приехал', 'corr-1');

    expect(res.already).toBe(false);
    const order = await db.doc('orders/dispute').get();
    expect(order.get('status')).toBe('Отменена');
    expect(order.get('closedByAdmin')).toBe(true);
    expect(order.get('adminCloseReason')).toBe('Мастер не приехал');
    expect(await actions()).toContain('order.force_cancelled');
  });

  // Повтор — двойное нажатие или ретрай сети — не должен переписать ни
  // исход, ни причину, ни журнал
  test('повтор не меняет закрытую заявку', async () => {
    await closeOrder(ADMIN, 'dispute', 'Отменена', 'Мастер не приехал', 'corr-1');
    const res = await closeOrder(ADMIN, 'dispute', 'Завершена', 'Другая причина', 'corr-2');

    expect(res.already).toBe(true);
    const order = await db.doc('orders/dispute').get();
    expect(order.get('status')).toBe('Отменена');
    expect(order.get('adminCloseReason')).toBe('Мастер не приехал');
    expect((await actions()).filter((a) => String(a).startsWith('order.force'))).toHaveLength(1);
  });

  // Доход мастера по месяцам собирается по completedAt: закрытие без даты
  // выкинуло бы честно сделанную работу из его цифр
  test('исход «Завершена» ставит дату завершения', async () => {
    await closeOrder(ADMIN, 'dispute', 'Завершена', 'Работа сделана, клиент пропал', 'corr-3');
    expect((await db.doc('orders/dispute').get()).get('completedAt')).toBeTruthy();
  });

  // Причина остаётся сторонам в заявке; журнал переживает удаление аккаунта
  // и свободного текста держать не должен
  test('причина не попадает в журнал', async () => {
    await closeOrder(ADMIN, 'dispute', 'Отменена', 'Мастер нагрубил клиенту', 'corr-4');
    const entries = await db.collection('audit').get();
    entries.docs.forEach((d) => {
      expect(JSON.stringify(d.get('details') ?? {})).not.toContain('нагрубил');
    });
  });
});

describe('setUserBlocked', () => {
  test('блокировка кладёт причину в профиль, снятие очищает её', async () => {
    await setUserBlocked(ADMIN, CLIENT, true, 'Оскорбления в переписке', 'corr-5');
    let profile = await db.doc(`users/${CLIENT}`).get();
    expect(profile.get('blocked')).toBe(true);
    expect(profile.get('blockedReason')).toBe('Оскорбления в переписке');

    await setUserBlocked(ADMIN, CLIENT, false, '', 'corr-6');
    profile = await db.doc(`users/${CLIENT}`).get();
    expect(profile.get('blocked')).toBe(false);
    expect(profile.get('blockedReason')).toBeNull();
    expect(await actions()).toEqual(expect.arrayContaining(['user.blocked', 'user.unblocked']));
  });

  // Один модератор не должен уметь отключить другого: эскалация — только
  // через консоль Firebase, где список admins и заводится
  test('модератора и самого себя заблокировать нельзя', async () => {
    await db.doc('admins/second-admin').set({ addedAt: '2026-08-29' });
    await db.doc('users/second-admin').set({ name: 'Второй' });
    await expect(setUserBlocked(ADMIN, 'second-admin', true, 'спор', 'c')).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    await db.doc(`users/${ADMIN}`).set({ name: 'Сам' });
    await expect(setUserBlocked(ADMIN, ADMIN, true, 'спор', 'c')).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });
});

describe('setMasterBlocked', () => {
  beforeEach(async () => {
    await db.doc('orders/o1').set({ clientId: CLIENT, status: 'Поиск мастера' });
    await db
      .doc(`orders/o1/offers/${MASTER}`)
      .set({ masterId: MASTER, status: 'pending', price: 1000 });
    await db.doc('orders/o2').set({ clientId: CLIENT, masterId: MASTER, status: 'В работе' });
  });

  test('блокировка снимает висящие предложения, работу не трогает', async () => {
    const res = await setMasterBlocked(ADMIN, MASTER, true, 'Жалобы клиентов', 'corr-7');

    expect(res.offersDropped).toBe(1);
    expect((await db.doc(`orders/o1/offers/${MASTER}`).get()).exists).toBe(false);
    expect((await db.doc('orders/o2').get()).get('status')).toBe('В работе');
    expect((await db.doc(`masters/${MASTER}`).get()).get('blocked')).toBe(true);
  });

  // Анкету мастера читает любой авторизованный — свободному тексту
  // модератора там не место
  test('причина лежит в приватной анкете, а не в мировом документе', async () => {
    await setMasterBlocked(ADMIN, MASTER, true, 'Жалобы клиентов', 'corr-8');

    expect((await db.doc(`masters/${MASTER}`).get()).get('blockedReason')).toBeUndefined();
    const application = await db.doc(`masters/${MASTER}/verification/application`).get();
    expect(application.get('blockedReason')).toBe('Жалобы клиентов');
  });

  test('повтор блокировки безопасен: второго снятия предложений нет', async () => {
    await setMasterBlocked(ADMIN, MASTER, true, 'Жалобы', 'corr-9');
    const res = await setMasterBlocked(ADMIN, MASTER, true, 'Жалобы', 'corr-10');
    expect(res.offersDropped).toBe(0);
  });
});

describe('setReviewHidden', () => {
  beforeEach(async () => {
    await db
      .doc(`masters/${MASTER}/reviews/r1`)
      .set({ clientId: CLIENT, stars: 5, text: 'Отлично' });
    await db
      .doc(`masters/${MASTER}/reviews/r2`)
      .set({ clientId: 'client2', stars: 1, text: 'Ужасно' });
  });

  // Цифра у анкеты и видимые отзывы обязаны сходиться: «4,2 по трём» при
  // двух видимых выглядит подлогом
  test('скрытый отзыв уходит из рейтинга, возврат возвращает', async () => {
    const hidden = await setReviewHidden(ADMIN, MASTER, 'r2', true, 'Оскорбления', 'corr-11');
    expect(hidden).toEqual({ rating: 5, reviewsCount: 1 });
    const master = await db.doc(`masters/${MASTER}`).get();
    expect(master.get('rating')).toBe(5);
    expect(master.get('reviewsCount')).toBe(1);

    const restored = await setReviewHidden(ADMIN, MASTER, 'r2', false, '', 'corr-12');
    expect(restored).toEqual({ rating: 3, reviewsCount: 2 });
  });

  test('все отзывы скрыты — рейтинга нет, как у мастера без отзывов', async () => {
    await setReviewHidden(ADMIN, MASTER, 'r1', true, 'причина', 'corr-13');
    await setReviewHidden(ADMIN, MASTER, 'r2', true, 'причина', 'corr-14');

    const master = await db.doc(`masters/${MASTER}`).get();
    expect(master.get('rating')).toBeNull();
    expect(master.get('reviewsCount')).toBe(0);
  });

  test('скрыть несуществующий отзыв нельзя', async () => {
    await expect(setReviewHidden(ADMIN, MASTER, 'нет', true, 'причина', 'c')).rejects.toMatchObject(
      { code: 'not-found' },
    );
  });
});

describe('resolveComplaint', () => {
  beforeEach(async () => {
    await db.doc('complaints/c1').set({
      byUid: MASTER,
      subjectType: 'review',
      masterId: MASTER,
      orderId: 'r2',
      reviewClientId: 'client2',
      text: 'Отзыв не о моей работе',
      status: 'новая',
      createdAt: new Date(),
    });
  });

  test('вердикт записывается, повтор — no-op', async () => {
    const first = await resolveComplaint(ADMIN, 'c1', 'решена', 'Отзыв скрыт', 'corr-15');
    expect(first.already).toBe(false);

    const second = await resolveComplaint(ADMIN, 'c1', 'отклонена', null, 'corr-16');
    expect(second.already).toBe(true);

    const complaint = await db.doc('complaints/c1').get();
    expect(complaint.get('status')).toBe('решена');
    expect(complaint.get('resolvedBy')).toBe(ADMIN);
    expect((await actions()).filter((a) => a === 'complaint.resolved')).toHaveLength(1);
  });
});

describe('findUserByPhone', () => {
  test('находит клиента по профилю и мастера по анкете', async () => {
    const byProfile = await findUserByPhone(ADMIN, '+7 999 123-45-67', 'corr-17');
    expect(byProfile.map((f) => f.uid)).toContain(CLIENT);

    // Канонический телефон мастера — в анкете, одиннадцатью цифрами
    const byApplication = await findUserByPhone(ADMIN, '8 (928) 000-11-22', 'corr-18');
    const master = byApplication.find((f) => f.uid === MASTER);
    expect(master).toMatchObject({ isMaster: true, verified: true });
  });

  test('находит аккаунт, который есть только в Auth', async () => {
    try {
      await getAuth().createUser({ uid: 'phone-only', phoneNumber: '+79170000001' });
    } catch {
      // между прогонами эмулятор Auth не чистится — пользователь уже есть
    }

    const found = await findUserByPhone(ADMIN, '79170000001', 'corr-19');
    expect(found.map((f) => f.uid)).toContain('phone-only');
  });

  // Журнал переживает удаление аккаунта — номера в нём быть не должно
  test('в журнале — хэш номера, а не номер', async () => {
    await findUserByPhone(ADMIN, '+79991234567', 'corr-20');

    const entries = await db.collection('audit').where('action', '==', 'admin.user_lookup').get();
    expect(entries.size).toBe(1);
    expect(JSON.stringify(entries.docs[0].get('details'))).not.toContain('9991234567');
    expect(entries.docs[0].get('details').found).toBeGreaterThan(0);
  });

  test('кривой номер отбивается сразу', async () => {
    await expect(findUserByPhone(ADMIN, '12345', 'c')).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});
