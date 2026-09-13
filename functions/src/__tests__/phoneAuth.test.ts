import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
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
  // Основной прогон — канал СМС; звонку посвящён отдельный describe ниже
  process.env.SMSRU_CHANNEL = 'sms';
  await wipe('phoneCodes', 'audit', 'meters');
});

afterAll(() => {
  delete process.env.SMSRU_API_ID;
  delete process.env.SMSRU_CHANNEL;
});

describe('отправка кода', () => {
  test('код уходит по СМС, в базе — только хэши', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();

    const result = await sendLoginCode(phone);

    expect(result).toEqual({ configured: true, cooldownSec: 60, channel: 'sms', codeLength: 6 });
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

  // Один источник не должен выжигать баланс провайдера по списку чужих
  // номеров, а весь сервис — тратить на коды больше, чем стоит день
  test('потолок с одного адреса: отказ, бронь по номеру снимается', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();
    const ip = '203.0.113.7';
    const key = `phoneIp-${createHash('sha256').update(`ip:${ip}`).digest('hex').slice(0, 16)}`;
    await db.doc(`meters/${key}`).set({ count: 30, windowStartAt: Timestamp.now() });

    await expect(sendLoginCode(phone, ip)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: expect.stringContaining('сети'),
    });
    expect(sms.sent).toHaveLength(0);
    // Кулдаун снят: за код, который не ушёл, ждать не надо
    expect((await codeDoc(phone).get()).get('lastSentAt')).toBeNull();
    // С другого адреса тот же номер получает код
    await expect(sendLoginCode(phone, '198.51.100.1')).resolves.toMatchObject({ configured: true });
  });

  test('дневной потолок на весь сервис', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await db.doc(`meters/phoneDay-${day}`).set({ count: 300, windowStartAt: Timestamp.now() });
    const sms = fakeSmsProvider();

    await expect(sendLoginCode(freshPhone())).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: expect.stringContaining('завтра'),
    });
    expect(sms.sent).toHaveLength(0);
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

  // Пять попыток на код, потом новый код и ещё пять — так подбор шёл бы
  // бесконечно. Счёт неверных попыток переживает код.
  test('неверные попытки копятся через новые коды и запирают номер на час', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();
    await sendLoginCode(phone);
    const wrong = sms.lastCode() === '000000' ? '000001' : '000000';
    for (let i = 0; i < 3; i++) {
      await confirmLoginCode(phone, wrong, true).catch(() => {});
    }

    await codeDoc(phone).set({ lastSentAt: null }, { merge: true });
    await sendLoginCode(phone);
    expect((await codeDoc(phone).get()).get('failures')).toBe(3);
    expect((await codeDoc(phone).get()).get('attempts')).toBe(0);

    // Десять за час — и код больше не выдаётся, пока окно не пройдёт
    await codeDoc(phone).set({ failures: 10, lastSentAt: null }, { merge: true });
    await expect(sendLoginCode(phone)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: expect.stringContaining('неверных'),
    });
    await codeDoc(phone).set(
      { failWindowStartAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 60_000) },
      { merge: true },
    );
    await expect(sendLoginCode(phone)).resolves.toMatchObject({ configured: true });
  });

  // «Войти» по свободному номеру отвечает «создайте аккаунт» — и создать его
  // человек должен тем же кодом, а не новым звонком
  test('незарегистрированный номер: код не сгорает, регистрация тем же кодом проходит', async () => {
    const phone = freshPhone();
    const sms = fakeSmsProvider();
    await sendLoginCode(phone);
    const code = sms.lastCode();

    await expect(confirmLoginCode(phone, code, false)).rejects.toMatchObject({ code: 'not-found' });
    await expect(confirmLoginCode(phone, code, true)).resolves.toMatchObject({ created: true });
    // А вот теперь код сожжён
    await expect(confirmLoginCode(phone, code, true)).rejects.toMatchObject({
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
    // В деталях — самое большее канал доставки: код и номер не попадают вовсе
    entries.docs.forEach((d) => {
      const keys = Object.keys(d.get('details') ?? {});
      expect(keys.every((k) => k === 'channel')).toBe(true);
    });
  });
});

// ---------- канал «звонок» ----------
//
// Буквенного отправителя для СМС оформляют только юрлицам по договору,
// поэтому до него код доставляется звонком: провайдер сам назначает код —
// последние четыре цифры звонящего номера — и возвращает его нам.

/** Подменяет fetch к /code/call и запоминает, что назначил «провайдер». */
function fakeCallProvider(opts: { fail?: boolean; failText?: string; code?: number } = {}) {
  const calls: string[] = [];

  global.fetch = jest.fn(async (_url: any, init: any) => {
    const params = new URLSearchParams(String(init?.body ?? ''));
    calls.push(params.get('phone') ?? '');
    const json =
      opts.fail || opts.failText
        ? { status: 'ERROR', status_text: opts.failText ?? 'Неверный api_id' }
        : { status: 'OK', code: opts.code ?? 2127, call_id: 'test-1' };
    return { ok: true, status: 200, json: async () => json } as any;
  }) as any;

  return { calls };
}

describe('код звонком', () => {
  beforeEach(() => {
    delete process.env.SMSRU_CHANNEL; // звонок — канал по умолчанию
  });

  test('код от провайдера работает целиком: запрос — звонок — вход', async () => {
    const phone = freshPhone();
    const provider = fakeCallProvider({ code: 2127 });

    const result = await sendLoginCode(phone);
    expect(result).toEqual({ configured: true, cooldownSec: 60, channel: 'call', codeLength: 4 });
    expect(provider.calls).toEqual([phone.replace('+', '')]);

    const { token, created } = await confirmLoginCode(phone, '2127', true);
    expect(created).toBe(true);
    expect(uidOf(token)).toBeTruthy();
  });

  // Провайдер отдаёт код числом — ведущий ноль не должен потеряться
  test('код с ведущим нулём восстанавливается', async () => {
    const phone = freshPhone();
    fakeCallProvider({ code: 127 });

    await sendLoginCode(phone);
    await expect(confirmLoginCode(phone, '0127', true)).resolves.toMatchObject({ created: true });
  });

  test('чужие четыре цифры не подходят', async () => {
    const phone = freshPhone();
    fakeCallProvider({ code: 2127 });

    await sendLoginCode(phone);
    await expect(confirmLoginCode(phone, '0000', true)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  // У SMS.RU свой лимит звонков на номер; «попробуйте ещё раз» тут ложь —
  // человек должен услышать «позже»
  test('лимит звонков провайдера доходит как «попробуйте позже»', async () => {
    const phone = freshPhone();
    fakeCallProvider({ failText: 'Слишком много звонков на один номер (совершено: 4)' });

    await expect(sendLoginCode(phone)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: expect.stringContaining('позже'),
    });
  });

  test('сбой звонка снимает кулдаун и не сжигает прежний код', async () => {
    const phone = freshPhone();
    fakeCallProvider({ code: 2127 });
    await sendLoginCode(phone);

    // Первый код уже на руках; повторный запрос падает на провайдере —
    // но прежний код обязан остаться рабочим
    await codeDoc(phone).set(
      { lastSentAt: Timestamp.fromMillis(Date.now() - 120_000) },
      { merge: true },
    );
    fakeCallProvider({ fail: true });
    await expect(sendLoginCode(phone)).rejects.toMatchObject({ code: 'unavailable' });

    await expect(confirmLoginCode(phone, '2127', true)).resolves.toMatchObject({ created: true });
  });
});
