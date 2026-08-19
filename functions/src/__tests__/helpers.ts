import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Общая обвязка тестов функций.
//
// Настоящий Firestore (эмулятор) и поддельный банк. Именно в таком сочетании:
// поведение базы — то, ради чего эти тесты и написаны, а поход к провайдеру
// в тестах невозможен и не нужен.

/** Тот же демо-проект, что и в тестах правил: в настоящий он не ходит. */
export const PROJECT_ID = 'demo-podrukoy';

export function initTestApp() {
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  return getFirestore();
}

/** Полностью очищает коллекцию между тестами. */
export async function wipe(...paths: string[]) {
  const db = getFirestore();
  for (const path of paths) {
    const snap = await db.collection(path).get();
    await Promise.all(snap.docs.map((d) => db.recursiveDelete(d.ref)));
  }
}

// ---------- поддельный банк ----------

export type FakeCall = {
  path: string;
  method: string;
  idempotenceKey: string | null;
  body: any;
};

/**
 * Подменяет fetch и запоминает все обращения.
 *
 * Ключ идемпотентности сохраняется отдельно: на нём держится защита от
 * повторного возврата, и проверять его надо явно.
 */
export function fakeProvider(handler: (path: string, body: any) => {
  ok?: boolean;
  status?: number;
  json: any;
}) {
  const calls: FakeCall[] = [];

  global.fetch = jest.fn(async (url: any, init: any) => {
    const path = String(url).replace('https://api.yookassa.ru/v3', '');
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({
      path,
      method: init?.method ?? 'GET',
      idempotenceKey: init?.headers?.['Idempotence-Key'] ?? null,
      body,
    });
    const res = handler(path, body);
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: async () => res.json,
    } as any;
  }) as any;

  return {
    calls,
    of: (fragment: string) => calls.filter((c) => c.path.includes(fragment)),
  };
}

/** Ответ провайдера об успешном платеже за привязку. */
export const succeededPayment = (uid: string, paymentId = 'pay_1') => ({
  id: paymentId,
  status: 'succeeded',
  metadata: { uid, purpose: 'master-verification' },
  payment_method: {
    id: 'pm_saved_1',
    card: { last4: '4242', card_type: 'MasterCard' },
  },
});

export function withProviderKeys() {
  process.env.YOOKASSA_SHOP_ID = 'test-shop';
  process.env.YOOKASSA_SECRET_KEY = 'test-key';
}

export function withoutProviderKeys() {
  delete process.env.YOOKASSA_SHOP_ID;
  delete process.env.YOOKASSA_SECRET_KEY;
}
