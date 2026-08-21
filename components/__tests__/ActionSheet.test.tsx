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
  return view;
}

describe('ActionSheet', () => {
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
