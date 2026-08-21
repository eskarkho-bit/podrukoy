import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initTestApp, wipe } from './helpers';
import { confirmLoginCode, phoneCodeDocId, sendLoginCode } from '../phoneAuth';

// Вход по СМС — это дверь в аккаунт. Проверяется не «работает ли счастливый
// путь», а то, что дверь нельзя открыть без телефона в руках: подбор кода,
// повторное использование, просроченный код, вход по чужому свободному номеру.

initTestApp();
const db = getFirestore();

// ---------- поддельный СМС-провайдер ----------

type SentSms = { to: string; msg: string };

/** Подменяет fetch к SMS.RU и запоминает отправленное — включая сам код. */
function fakeSmsProvider(opts: { fail?: boolean } = {}) {
  const sent: SentSms[] = [];

  global.fetch = jest.fn(async (_url: any, init: any) => {
    const params = new URLSearchParams(String(init?.body ?? ''));
    const to = params.get('to') ?? '';
    const msg = params.get('msg') ?? '';
    sent.push({ to, msg });
    const json = opts.fail
      ? { status: 'ERROR', status_code: 202 }
      : { status: 'OK', sms: { [to]: { status: 'OK', status_code: 100 } } };
    return { ok: true, status: 200, json: async () => json } as any;
  }) as any;

  return {
    sent,
    // Код нигде не хранится в открытом виде — единственный способ узнать его
    // в тесте тот же, что у человека: прочитать СМС
    lastCode: () => sent[sent.length - 1]?.msg.match(/\d{6}/)?.[0] ?? '',
  };
}

/** uid из custom-токена: полезная нагрузка JWT, подпись тут не важна. */
function uidOf(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  return payload.uid;
}

const codeDoc = (phone: string) => db.doc(`phoneCodes/${phoneCodeDocId(phone)}`);

// Каждому тесту — свой номер: состояние кодов и аккаунтов не пересекается
let seq = 0;
const freshPhone = () => `+7999000${String(seq++).padStart(4, '0')}`;

beforeEach(async () => {
  process.env.SMSRU_API_ID = 'test-key';
  await wipe('phoneCodes', 'audit');
});

afterAll(() => {
  delete process.env.SMSRU_API_ID;
});

describe('отправка кода', () => {
  test('код уходит по СМС, в базе — только хэши', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();

    const result = await sendLoginCode(phone);

    expect(result).toEqual({ configured: true, cooldownSec: 60 });
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0].to).toBe(phone.replace('+', ''));
    expect(sms.lastCode()).toMatch(/^\d{6}$/);

    const saved = await codeDoc(phone).get();
    expect(saved.exists).toBe(true);
    // Ни номера, ни кода в открытом виде — утечка коллекции не даёт войти.
    // Состав полей перечислен явно: лишнее поле здесь может оказаться только
    // персональными данными.
    expect(Object.keys(saved.data()!).sort()).toEqual([
      'attempts',
      'codeHash',
      'expiresAt',
      'lastSentAt',
      'sends',
      'windowStartAt',
    ]);
    expect(saved.get('codeHash')).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.get('codeHash')).not.toBe(sms.lastCode());
  });

  test('повторный запрос раньше минуты отклоняется', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();

    await sendLoginCode(phone);
    await expect(sendLoginCode(phone)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(sms.sent).toHaveLength(1);
  });

  test('лимит отправок в окне исчерпывается', async () => {
    const phone = freshPhone();
    fakeSmsProvider();

    await sendLoginCode(phone);
    // Кулдаун и счётчик выставляем руками: ждать час в тесте нельзя
    await codeDoc(phone).set(
      { sends: 5, lastSentAt: Timestamp.fromMillis(Date.now() - 120_000) },
      { merge: true },
    );

    await expect(sendLoginCode(phone)).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  test('сбой провайдера снимает кулдаун — человек может повторить сразу', async () => {
    const phone = freshPhone();
    fakeSmsProvider({ fail: true });

    await expect(sendLoginCode(phone)).rejects.toMatchObject({ code: 'unavailable' });

    fakeSmsProvider();
    await expect(sendLoginCode(phone)).resolves.toMatchObject({ configured: true });
  });

  test('без ключа провайдера — честное «не настроено», СМС не уходит', async () => {
    delete process.env.SMSRU_API_ID;
    const sms = fakeSmsProvider();

    await expect(sendLoginCode(freshPhone())).resolves.toEqual({ configured: false });
    expect(sms.sent).toHaveLength(0);
  });

  test('не мобильный номер отклоняется до всяких СМС', async () => {
    const sms = fakeSmsProvider();
    await expect(sendLoginCode('+74950000000')).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(sendLoginCode('89990001122')).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(sms.sent).toHaveLength(0);
  });
});

describe('проверка кода', () => {
  test('верный код при регистрации создаёт аккаунт с этим номером', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();
    await sendLoginCode(phone);

    const { token, created } = await confirmLoginCode(phone, sms.lastCode(), true);

    expect(created).toBe(true);
    const user = await getAuth().getUser(uidOf(token));
    expect(user.phoneNumber).toBe(phone);
  });

  test('повторный вход находит тот же аккаунт, а не заводит второй', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();

    await sendLoginCode(phone);
    const first = await confirmLoginCode(phone, sms.lastCode(), true);

    // Кулдаун мешает второму запросу — снимаем его руками
    await sendLoginCode(phone).catch(() => {});
    await codeDoc(phone).set({ lastSentAt: null }, { merge: true });
    await sendLoginCode(phone);
    const second = await confirmLoginCode(phone, sms.lastCode(), false);

    expect(second.created).toBe(false);
    expect(uidOf(second.token)).toBe(uidOf(first.token));
  });

  test('вход по незарегистрированному номеру не создаёт аккаунт молча', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();
    await sendLoginCode(phone);

    await expect(confirmLoginCode(phone, sms.lastCode(), false)).rejects.toMatchObject({
      code: 'not-found',
    });
    // Аккаунта нет: согласие на обработку данных никто не давал
    await expect(getAuth().getUserByPhoneNumber(phone)).rejects.toMatchObject({
      code: 'auth/user-not-found',
    });
  });

  test('код одноразовый: после входа он сожжён', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();
    await sendLoginCode(phone);
    const code = sms.lastCode();

    await confirmLoginCode(phone, code, true);

    await expect(confirmLoginCode(phone, code, true)).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
  });

  test('пять неверных попыток сжигают код — подбор бессмыслен', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();
    await sendLoginCode(phone);
    const wrong = sms.lastCode() === '000000' ? '000001' : '000000';

    for (let i = 0; i < 5; i++) {
      await expect(confirmLoginCode(phone, wrong, true)).rejects.toMatchObject({
        code: 'invalid-argument',
      });
    }
    // Шестая попытка упирается уже не в «неверный код», а в сожжённый документ —
    // даже верный код больше не подошёл бы
    await expect(confirmLoginCode(phone, sms.lastCode(), true)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    await expect(confirmLoginCode(phone, sms.lastCode(), true)).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
  });

  test('просроченный код отклоняется', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();
    await sendLoginCode(phone);
    await codeDoc(phone).set(
      { expiresAt: Timestamp.fromMillis(Date.now() - 1000) },
      { merge: true },
    );

    await expect(confirmLoginCode(phone, sms.lastCode(), true)).rejects.toMatchObject({
      code: 'deadline-exceeded',
    });
  });
});

describe('журнал', () => {
  test('вход записан, но ни номера, ни кода в журнале нет', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();
    await sendLoginCode(phone);
    await confirmLoginCode(phone, sms.lastCode(), true);

    const entries = await db.collection('audit').get();
    const actions = entries.docs.map((d) => d.get('action'));
    expect(actions).toContain('phone.code_sent');
    expect(actions).toContain('phone.registered');

    // Журнал переживает удаление аккаунта — номер телефона в нём был бы
    // обходом собственного же удаления данных
    const dump = JSON.stringify(entries.docs.map((d) => d.data()));
    expect(dump).not.toContain(phone.slice(1));
    // Детали пусты по построению: код и номер туда не попадают вовсе
    entries.docs.forEach((d) => expect(d.get('details')).toEqual({}));
  });
});
