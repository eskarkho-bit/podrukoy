import { firestoreErrorCode, firestoreErrorText } from '../firestoreError';

// Модуль появился после того, как отказ по правам доступа показывался как
// «проверьте связь»: человек проверял интернет, а дело было в незадеплоенных
// правилах. Сообщение обязано вести к причине.

const err = (code: string) => ({ code });

describe('firestoreErrorCode', () => {
  test('код достаётся, если он есть', () => {
    expect(firestoreErrorCode(err('permission-denied'))).toBe('permission-denied');
  });

  test('на всём остальном — пусто, без падения', () => {
    expect(firestoreErrorCode(null)).toBe('');
    expect(firestoreErrorCode(undefined)).toBe('');
    expect(firestoreErrorCode('строка')).toBe('');
    expect(firestoreErrorCode(new Error('без кода'))).toBe('');
  });
});

describe('firestoreErrorText', () => {
  const fallback = 'Не удалось сохранить';

  test('отказ по правам ведёт к деплою, а не к интернету', () => {
    const text = firestoreErrorText(err('permission-denied'), fallback);
    expect(text).toContain('прав');
    expect(text).toContain('deploy');
    expect(text).not.toContain('интернет');
  });

  test('отказ Storage читается так же', () => {
    expect(firestoreErrorText(err('storage/unauthorized'), fallback))
      .toBe(firestoreErrorText(err('permission-denied'), fallback));
  });

  test('нет связи — говорим про связь', () => {
    expect(firestoreErrorText(err('unavailable'), fallback)).toContain('интернет');
  });

  test('истёкшая сессия предлагает войти заново', () => {
    expect(firestoreErrorText(err('unauthenticated'), fallback)).toContain('войдите');
  });

  test('нехватка индекса названа своим именем', () => {
    expect(firestoreErrorText(err('failed-precondition'), fallback)).toContain('индекс');
  });

  test('неизвестный код отдаёт запасной текст', () => {
    expect(firestoreErrorText(err('что-то-новое'), fallback)).toBe(fallback);
    expect(firestoreErrorText(new Error('без кода'), fallback)).toBe(fallback);
    expect(firestoreErrorText(null, fallback)).toBe(fallback);
  });
});
