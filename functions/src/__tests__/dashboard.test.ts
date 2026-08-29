import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initTestApp, wipe } from './helpers';
import { runDashboard } from '../dashboard';

// Дашборд. Модератор принимает решения по этим числам — открывать ли город,
// звать ли мастеров, — поэтому проверяются сами определения метрик: границы
// суток по Москве, 48-часовая фора конверсии, семидневное окно откликов и
// то, что повторный прогон не «дорисовывает» цифры.

initTestApp();
const db = getFirestore();

// Фиксированный «сейчас» — полдень по Москве: границы суток не дрожат
const NOW = new Date('2026-08-28T09:00:00Z');

const at = (hoursAgo: number) =>
  Timestamp.fromDate(new Date(NOW.getTime() - hoursAgo * 3600 * 1000));

beforeEach(async () => {
  await wipe('orders', 'masters', 'stats', 'audit');
});

describe('runDashboard', () => {
  test('заявки раскладываются по московским дням и неделям', async () => {
    await db.doc('orders/today').set({ clientId: 'c1', status: 'Поиск мастера', createdAt: at(2) });
    await db
      .doc('orders/yesterday')
      .set({ clientId: 'c1', status: 'Завершена', createdAt: at(30), completedAt: at(20) });

    const doc = await runDashboard(NOW, 'run-1');

    expect(doc.days).toHaveLength(30);
    const today = doc.days[doc.days.length - 1];
    expect(today).toEqual({ date: '2026-08-28', created: 1, completed: 0 });
    const yesterday = doc.days[doc.days.length - 2];
    expect(yesterday).toEqual({ date: '2026-08-27', created: 1, completed: 1 });

    expect(doc.weeks).toHaveLength(12);
    // Неделя начинается с понедельника
    expect(doc.weeks[doc.weeks.length - 1].start).toBe('2026-08-24');
    expect(doc.weeks[doc.weeks.length - 1].created).toBe(2);
  });

  // Свежей заявке рано записываться в провал: мастера ещё думают
  test('конверсия не считает заявки моложе 48 часов', async () => {
    await db.doc('orders/fresh').set({ clientId: 'c', status: 'Поиск мастера', createdAt: at(5) });
    await db
      .doc('orders/picked')
      .set({ clientId: 'c', status: 'В работе', createdAt: at(100), agreedAt: at(90) });
    await db
      .doc('orders/ignored')
      .set({ clientId: 'c', status: 'Поиск мастера', createdAt: at(100) });

    const doc = await runDashboard(NOW, 'run-2');
    expect(doc.conversion30d).toEqual({ total: 2, picked: 1 });
  });

  // Заявка вовсе без предложений — сигнал хуже медленного, она считается
  // отдельно, а не портит среднее
  test('время до первого отклика и заявки без предложений', async () => {
    await db
      .doc('orders/answered')
      .set({ clientId: 'c', status: 'Поиск мастера', createdAt: at(50), firstOfferAt: at(49) });
    await db
      .doc('orders/silent')
      .set({ clientId: 'c', status: 'Поиск мастера', createdAt: at(50) });
    // Старше семи дней — вне окна метрики
    await db
      .doc('orders/old')
      .set({ clientId: 'c', status: 'Поиск мастера', createdAt: at(24 * 10) });

    const doc = await runDashboard(NOW, 'run-3');
    expect(doc.timeToFirstOffer7d).toEqual({ avgMinutes: 60, withOffers: 1, withoutOffers: 1 });
  });

  test('активные мастера — verified без blocked', async () => {
    await db.doc('masters/a').set({ verified: true });
    await db.doc('masters/b').set({ verified: true, blocked: true });
    await db.doc('masters/c').set({ verified: false });

    const doc = await runDashboard(NOW, 'run-4');
    expect(doc.activeMasters).toBe(1);
  });

  // Полный пересчёт одного документа: наложение прогонов не меняет итога,
  // поэтому замок, как у сверки, здесь не нужен
  test('повторный прогон даёт тот же документ', async () => {
    await db.doc('orders/one').set({ clientId: 'c', status: 'Поиск мастера', createdAt: at(3) });

    const first = await runDashboard(NOW, 'run-5');
    const second = await runDashboard(NOW, 'run-6');

    expect(second).toEqual(first);
    const stored = await db.doc('stats/dashboard').get();
    expect(stored.get('runId')).toBe('run-6');
    expect(stored.get('updatedAt')).toBeTruthy();
  });
});
