import { logger } from 'firebase-functions';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// Отправка пушей через Expo. Токены у нас экспошные (ExponentPushToken[...]),
// поэтому идём в сервис Expo, а не напрямую в FCM/APNs: иначе пришлось бы
// возиться с сертификатами обеих платформ.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Expo принимает не больше 100 сообщений за запрос
const CHUNK = 100;

export type PushTarget = { href: string };

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: PushTarget;
  sound: 'default';
};

type ExpoTicket = {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

/** Токены устройств пользователя. Их может быть несколько — телефон и планшет. */
async function tokensFor(uids: string[]): Promise<Map<string, string[]>> {
  const db = getFirestore();
  const unique = [...new Set(uids)].filter(Boolean);
  if (!unique.length) return new Map();

  const snaps = await db.getAll(...unique.map((uid) => db.doc(`users/${uid}`)));
  const result = new Map<string, string[]>();
  snaps.forEach((snap) => {
    const list = snap.get('pushTokens');
    if (Array.isArray(list) && list.length) result.set(snap.id, list as string[]);
  });
  return result;
}

/**
 * Убирает токены, которые Expo признал недействительными: приложение удалили
 * или переустановили. Без этого список токенов растёт вечно, и каждая отправка
 * становится дороже.
 */
async function dropDeadTokens(owners: Map<string, string>, dead: string[]) {
  if (!dead.length) return;
  const db = getFirestore();
  const byUid = new Map<string, string[]>();
  dead.forEach((token) => {
    const uid = owners.get(token);
    if (!uid) return;
    byUid.set(uid, [...(byUid.get(uid) ?? []), token]);
  });

  await Promise.all([...byUid].map(([uid, tokens]) =>
    db.doc(`users/${uid}`)
      .update({ pushTokens: FieldValue.arrayRemove(...tokens) })
      .catch((e) => logger.warn('Не удалось убрать мёртвый токен', { uid, e }))));
}

/** Отправляет одно уведомление всем устройствам перечисленных пользователей. */
export async function pushTo(
  uids: string[],
  title: string,
  body: string,
  target: PushTarget,
): Promise<void> {
  const tokens = await tokensFor(uids);
  if (!tokens.size) return;

  // Кто чей токен — понадобится, если Expo сообщит, что токен мёртв
  const owner = new Map<string, string>();
  const messages: ExpoMessage[] = [];
  tokens.forEach((list, uid) => {
    list.forEach((to) => {
      owner.set(to, uid);
      messages.push({ to, title, body, data: target, sound: 'default' });
    });
  });

  const dead: string[] = [];

  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        logger.warn('Expo push ответил ошибкой', { status: res.status });
        continue;
      }
      const json = (await res.json()) as { data?: ExpoTicket[] };
      (json.data ?? []).forEach((ticket, idx) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          dead.push(chunk[idx].to);
        }
      });
    } catch (e) {
      // Уведомление — не то, ради чего стоит ронять триггер: заявка уже создана
      logger.warn('Не удалось отправить пуш', e);
    }
  }

  await dropDeadTokens(owner, dead);
}
