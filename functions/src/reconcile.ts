import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { audit, SYSTEM } from './audit';
import { runDeletion } from './deletion';
import { notifyMastersAbout } from './orderPush';
import { purgeExpiredMeters } from './meters';

// Сверка: доводит до конца то, что не доехало событиями.
//
// События теряются. Триггер удаления аккаунта может упасть на последнем
// повторе, заявка может остаться без единого предложения в тишине. Ни то,
// ни другое не должно требовать участия человека, поэтому раз в пятнадцать
// минут приходит эта функция и добирает хвосты.
//
// Ничего своего она не делает: вызывает те же runDeletion() и
// notifyMastersAbout(), что и события. Отдельная реализация «на случай
// сверки» неминуемо разошлась бы с основной.
//
// Раньше здесь же доводились до конца привязки карт и зависшие возвраты
// рубля; вместе с платёжным провайдером ушли и они — расчёты идут мимо
// сервиса, и денег, которые нужно было бы сверять, у него больше нет.

/** Удаление, не сдвинувшееся за это время, считаем застрявшим. */
const DELETION_STUCK_MS = 15 * 60 * 1000;

/** Заявка без единого предложения столько времени — мастеров зовут повторно. */
const ORDER_SILENT_MS = 2 * 60 * 60 * 1000;

/** Старше суток не будим: заявка, о которой молчали день, повтором не оживёт. */
const ORDER_SILENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Сколько документов берём за прогон: бюджет времени функции не резиновый. */
const BATCH = 50;

/** Прогон, начавшийся раньше, считаем упавшим и перехватываем блокировку. */
const LOCK_TTL_MS = 10 * 60 * 1000;

const LOCK = 'system/reconcile';

type Counters = {
  deletionsResumed: number;
  ordersRepushed: number;
  metersPurged: number;
  errors: number;
};

/**
 * Берёт блокировку прогона.
 *
 * Расписание может наложиться само на себя, если прогон затянулся, а два
 * параллельных прогона звали бы мастеров к одной заявке дважды. Транзакция
 * гарантирует, что блокировку возьмёт ровно один.
 */
async function acquireLock(runId: string): Promise<boolean> {
  const db = getFirestore();
  const ref = db.doc(LOCK);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const since: number = snap.get('runningSince')?.toMillis?.() ?? 0;
    if (since && Date.now() - since < LOCK_TTL_MS) return false;
    tx.set(
      ref,
      {
        runningSince: FieldValue.serverTimestamp(),
        runId,
      },
      { merge: true },
    );
    return true;
  });
}

async function releaseLock(runId: string, counters: Counters): Promise<void> {
  await getFirestore().doc(LOCK).set(
    {
      runningSince: null,
      lastRunId: runId,
      lastFinishedAt: FieldValue.serverTimestamp(),
      lastCounters: counters,
    },
    { merge: true },
  );
}

/** Удаления аккаунта, застрявшие на этапе. */
async function sweepDeletions(runId: string, counters: Counters): Promise<void> {
  const cutoff = new Date(Date.now() - DELETION_STUCK_MS);

  const stuck = await getFirestore()
    .collection('deletions')
    .where('status', '==', 'pending')
    .where('requestedAt', '<', cutoff)
    .limit(BATCH)
    .get();

  for (const d of stuck.docs) {
    try {
      await runDeletion(d.id, runId);
      counters.deletionsResumed += 1;
    } catch (e) {
      counters.errors += 1;
      logger.error('Не удалось продолжить удаление аккаунта', { uid: d.id, e });
    }
  }
}

/**
 * Заявки, оставшиеся без единого предложения: мастеров зовут второй раз.
 *
 * Это часть борьбы с холодным стартом: молчание в первые часы — главный
 * способ потерять клиента навсегда. Повтор ровно один: заявка, которую не
 * взяли и со второго зова, — сигнал модератору о дыре в покрытии, а не повод
 * бомбить мастеров каждые пятнадцать минут.
 */
async function repushSilentOrders(runId: string, counters: Counters): Promise<void> {
  const db = getFirestore();
  const now = Date.now();

  const silent = await db
    .collection('orders')
    .where('status', '==', 'Поиск мастера')
    .where('createdAt', '<', new Date(now - ORDER_SILENT_MS))
    .where('createdAt', '>', new Date(now - ORDER_SILENT_MAX_AGE_MS))
    .orderBy('createdAt', 'desc')
    .limit(BATCH)
    .get();

  for (const d of silent.docs) {
    // В запрос отметку не включить: у нетронутых заявок поля нет вовсе,
    // а по отсутствию поля Firestore не фильтрует
    if (d.get('repushedAt')) continue;

    try {
      const offers = await d.ref.collection('offers').count().get();
      if (offers.data().count > 0) continue;

      // Отметка до отправки: прогон, упавший между пушем и записью, при
      // повторе слал бы мастерам то же уведомление ещё раз. Потерять один
      // повторный зов дешевле, чем прослыть спамером.
      await d.ref.update({ repushedAt: FieldValue.serverTimestamp() });
      const notified = await notifyMastersAbout(d.data(), 'Заявка всё ещё ищет мастера');

      await audit({
        action: 'order.repushed',
        actor: SYSTEM,
        subject: { type: 'order', id: d.id },
        correlationId: runId,
        details: { mastersNotified: notified },
      });
      counters.ordersRepushed += 1;
    } catch (e) {
      counters.errors += 1;
      logger.warn('Повторный зов мастеров не удался', { orderId: d.id, e });
    }
  }
}

export const reconcile = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 540,
    // Повторять прогон незачем: следующий придёт через пятнадцать минут и
    // подберёт то же самое
    retryCount: 0,
  },
  async (event) => {
    const runId = `reconcile-${event.jobName ?? 'run'}-${Date.now()}`;

    if (!(await acquireLock(runId))) {
      await audit({
        action: 'reconcile.skipped',
        actor: SYSTEM,
        subject: { type: 'system', id: 'reconcile' },
        correlationId: runId,
        details: { reason: 'already-running' },
      });
      logger.info('Сверка пропущена: предыдущий прогон ещё идёт');
      return;
    }

    const counters: Counters = {
      deletionsResumed: 0,
      ordersRepushed: 0,
      metersPurged: 0,
      errors: 0,
    };

    await audit({
      action: 'reconcile.started',
      actor: SYSTEM,
      subject: { type: 'system', id: 'reconcile' },
      correlationId: runId,
    });

    try {
      await sweepDeletions(runId, counters);
      await repushSilentOrders(runId, counters);
      // Счётчики лимитов (meters.ts) живут, пока живо их окно, — тут они и
      // умирают: без этого коллекция росла бы на каждый вход по телефону
      counters.metersPurged += await purgeExpiredMeters(BATCH);
    } catch (e) {
      counters.errors += 1;
      logger.error('Прогон сверки прерван', e);
    } finally {
      // Блокировку снимаем в любом случае: иначе одна ошибка остановит сверку
      // на десять минут, а потом ещё и потребует ручного вмешательства
      await releaseLock(runId, counters);
    }

    await audit({
      action: 'reconcile.finished',
      actor: SYSTEM,
      subject: { type: 'system', id: 'reconcile' },
      correlationId: runId,
      details: { ...counters },
    });

    logger.info('Сверка завершена', counters);
  },
);
