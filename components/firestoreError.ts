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
      return 'Нет связи с сервером. Проверьте интернет';
    // Хранилище отвечает по-разному в зависимости от того, откуда его зовут:
    // из браузера запрос к несуществующему бакету упирается в CORS, повторы
    // заканчиваются, и это выглядит как обрыв сети. Отсюда и оговорка —
    // отправлять человека проверять роутер, когда Storage просто не подключён,
    // мы уже пробовали.
    case 'storage/retry-limit-exceeded':
      return 'Файл не загрузился: нет связи либо в проекте не подключён Cloud Storage';
    case 'storage/unknown':
    case 'storage/bucket-not-found':
    case 'storage/project-not-found':
      return 'Хранилище файлов недоступно — похоже, Cloud Storage не подключён в Firebase';
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
