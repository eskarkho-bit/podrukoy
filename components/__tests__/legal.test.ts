import {
  consentsCurrent,
  currentConsents,
  LEGAL_DOCS,
  REQUIRED_DOCS,
  rememberConsent,
  takePendingConsent,
} from '../legal';

// Согласия — единственное основание обрабатывать данные. Ошибка здесь не
// техническая: она означает обработку без согласия либо, наоборот, вечный
// блокирующий экран у человека, который согласие дал.

describe('consentsCurrent', () => {
  test('действующие редакции принимаются', () => {
    expect(consentsCurrent(currentConsents())).toBe(true);
  });

  test('пусто и null — согласия нет', () => {
    expect(consentsCurrent(null)).toBe(false);
    expect(consentsCurrent(undefined)).toBe(false);
    expect(consentsCurrent({})).toBe(false);
  });

  test('половина документов не считается согласием', () => {
    expect(consentsCurrent({ terms: LEGAL_DOCS.terms.version })).toBe(false);
    expect(consentsCurrent({ privacy: LEGAL_DOCS.privacy.version })).toBe(false);
  });

  // Ради этого механизм и существует: сменилась редакция — согласие
  // спрашивается заново, а не считается данным задним числом
  test('устаревшая редакция требует нового согласия', () => {
    expect(
      consentsCurrent({
        ...currentConsents(),
        privacy: '2020-01-01',
      }),
    ).toBe(false);
  });

  test('согласие на биометрию не заменяет обязательные документы', () => {
    expect(consentsCurrent({ biometrics: LEGAL_DOCS.biometrics.version })).toBe(false);
  });
});

describe('документы', () => {
  test('обязательные — соглашение и политика, биометрия отдельно', () => {
    expect(REQUIRED_DOCS).toEqual(['terms', 'privacy']);
    expect(REQUIRED_DOCS).not.toContain('biometrics');
  });

  test('у каждого есть версия, заголовок и непустой текст', () => {
    Object.values(LEGAL_DOCS).forEach((doc) => {
      expect(doc.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.body.length).toBeGreaterThan(200);
    });
  });

  // Тексты — заготовки, и места для реквизитов оператора обязаны быть
  // заметны. Когда юрист их заполнит, тест придётся поменять — это
  // напоминание, а не придирка.
  test('места для реквизитов ещё не заполнены', () => {
    const filled = Object.values(LEGAL_DOCS).filter((doc) => !doc.body.includes('['));
    expect(filled).toEqual([]);
  });
});

describe('передача согласия между экранами', () => {
  test('запомненное отдаётся один раз', () => {
    rememberConsent({ terms: '2026-01-01' });
    expect(takePendingConsent()).toEqual({ terms: '2026-01-01' });
    // Второй раз — уже пусто: иначе согласие прилипло бы к следующему
    // аккаунту, зарегистрированному на том же устройстве
    expect(takePendingConsent()).toBeNull();
  });

  test('без запоминания отдаёт null', () => {
    takePendingConsent();
    expect(takePendingConsent()).toBeNull();
  });
});
