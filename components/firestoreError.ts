// Человеческий текст по коду ошибки Firestore.
//
// Появился после того, как отказ по правам доступа показывался как «проверьте
// связь»: человек проверял интернет, а дело было в незадеплоенных правилах.
// Сообщение об ошибке обязано вести к причине, иначе оно хуже, чем ничего.

export function firestoreErrorCode(e: unknown): string {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
}

export function firestoreErrorText(e: unknown, fallback: string): string {
  switch (firestoreErrorCode(e)) {
    case 'permission-denied':
    case 'storage/unauthorized':
      // Самая частая причина — правила в проекте старше кода
      return (
        'Недостаточно прав. Похоже, правила доступа Firebase не обновлены ' +
        '— нужен firebase deploy'
      );
    case 'unauthenticated':
      return 'Сессия истекла — войдите заново';
    case 'unavailable':
    case 'storage/retry-limit-exceeded':
      return 'Нет связи с сервером. Проверьте интернет';
    case 'resource-exhausted':
      return 'Слишком много запросов. Попробуйте через несколько минут';
    case 'failed-precondition':
      // Обычно это отсутствующий составной индекс
      return 'Запрос не выполнен: в Firebase не хватает индекса';
    case 'storage/quota-exceeded':
      return 'Хранилище переполнено';
    default:
      return fallback;
  }
}
