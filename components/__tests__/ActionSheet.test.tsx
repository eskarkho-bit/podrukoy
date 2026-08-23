import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { ActionSheet } from '../ActionSheet';
import type { SceneObject } from '../HouseScene';

// Двойное нажатие на «Отправить заявку» создавало два заказа: setState
// асинхронен, поэтому оба нажатия успевали пройти до перерисовки и планировали
// по таймеру каждое. Здесь это проверяется на уровне поведения, а не наличия
// флага в коде.
//
// Почему тестов два, а проверок много.
// Шторка выдерживает сколько угодно монтирований, но после двух доведённых до
// конца сценариев следующий рендер приходит пустым: экран «готово» проигрывает
// анимацию, а мок reanimated её не сворачивает. Разбираться в моке анимаций
// дороже, чем оно стоит, поэтому проверки собраны в два прогона вместо
// четырёх. Если тесты начнут падать после добавления третьего — причина эта.
//
// Таймеры настоящие: поддельные конфликтуют с асинхронной очисткой RNTL 14.

const OBJECT: SceneObject = {
  id: 'socket',
  title: 'Розетка',
  icon: '🔌',
  place: 'Спальня',
  x: 0,
  y: 0,
};

// Пауза на анимацию галочки в самой шторке — 1400 мс, ждём с запасом
const WAIT = { timeout: 4000 };

async function openForm(onComplete: jest.Mock): Promise<RenderResult> {
  const view = await render(
    <ActionSheet
      object={OBJECT}
      address="ул. Ленина, 24"
      onClose={() => {}}
      onComplete={onComplete}
    />,
  );
  // Шаг 1 — что случилось, шаг 2 — уточнение, шаг 3 — форма заявки
  await fireEvent.press(view.getByText('Не работает'));
  await fireEvent.press(view.getByText('Искрит'));
  // Фото и описание спрятаны за кнопкой — тестам формы нужен открытый блок
  await fireEvent.press(view.getByText('Оставить комментарий'));
  return view;
}

describe('ActionSheet', () => {
  // Не доводит сценарий до «готово» — поэтому стоит до двух отправляющих
  // тестов и не расходует их лимит на анимацию галочки (см. шапку файла)
  test('«Другое» с любого шага ведёт сразу к описанию и фото', async () => {
    const view = await render(
      <ActionSheet
        object={OBJECT}
        address="ул. Ленина, 24"
        onClose={() => {}}
        onComplete={jest.fn()}
      />,
    );

    // С первого шага: без уточнений, сразу экран заявки
    await fireEvent.press(view.getByText('Другое'));
    expect(view.getByText('Опишите задачу')).toBeTruthy();
    expect(view.getByPlaceholderText(/Расскажите/i)).toBeTruthy();

    // Назад ведёт на первый шаг, а не на пропущенные уточнения
    await fireEvent.press(view.getByText('‹'));
    expect(view.getByText('Что случилось?')).toBeTruthy();

    // И внутри категории «Другое» тоже выводит к форме
    await fireEvent.press(view.getByText('Не работает'));
    await fireEvent.press(view.getByText('Другое'));
    expect(view.getByText('Опишите задачу')).toBeTruthy();
    // На пути «Другое» описание — суть заявки: поле открыто без кнопки
    expect(view.getByPlaceholderText(/Расскажите/i)).toBeTruthy();
    expect(view.queryByText('Оставить комментарий')).toBeNull();
  });

  // Тоже не доходит до «готово» — потому стоит до отправляющих тестов
  test('на обычном пути фото и описание открываются кнопкой', async () => {
    const view = await render(
      <ActionSheet
        object={OBJECT}
        address="ул. Ленина, 24"
        onClose={() => {}}
        onComplete={jest.fn()}
      />,
    );
    await fireEvent.press(view.getByText('Не работает'));
    await fireEvent.press(view.getByText('Искрит'));

    // Сначала только кнопка и отправка — полей нет
    expect(view.queryByPlaceholderText(/Расскажите/i)).toBeNull();
    expect(view.queryByText('Сфотографировать')).toBeNull();
    expect(view.getByText(/Отправить заявку/)).toBeTruthy();

    await fireEvent.press(view.getByText('Оставить комментарий'));
    expect(view.getByPlaceholderText(/Расскажите/i)).toBeTruthy();
    expect(view.getByText('Сфотографировать')).toBeTruthy();
  });

  test('обычная отправка даёт одну заявку с полным содержимым', async () => {
    const onComplete = jest.fn();
    const view = await openForm(onComplete);

    await fireEvent.changeText(view.getByPlaceholderText(/Расскажите/i), '  искрит и пахнет  ');
    await fireEvent.press(view.getByText(/Отправить заявку/));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), WAIT);

    const draft = onComplete.mock.calls[0][0];
    // Идентификатор выдаётся заранее — на нём держится идемпотентность записи
    expect(draft.id).toBeTruthy();
    // Специальность выводится из объекта дома, клиент её не выбирает
    expect(draft.category).toBe('электрика');
    expect(draft.title).toContain('Розетка');
    expect(draft.title).toContain('Искрит');
    // Пробелы по краям комментария не должны доезжать до базы
    expect(draft.comment).toBe('искрит и пахнет');
  });

  test('три нажатия подряд всё равно дают одну заявку', async () => {
    const onComplete = jest.fn();
    const view = await openForm(onComplete);

    const submit = view.getByText(/Отправить заявку/);
    // Без перерисовки между нажатиями — ровно как палец на телефоне
    await Promise.all([fireEvent.press(submit), fireEvent.press(submit), fireEvent.press(submit)]);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), WAIT);
  });
});
