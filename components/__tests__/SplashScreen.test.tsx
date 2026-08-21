import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SplashScreen } from '../SplashScreen';

// Анимации в тестах не проигрываются (reanimated подменён моком), поэтому
// проверяется каркас: бренд на месте, пропуск по тапу доводит до onDone.

describe('SplashScreen', () => {
  test('показывает знак и название', async () => {
    const view = await render(<SplashScreen ready={false} onDone={jest.fn()} />);
    view.getByText('DOMIO');
    view.getByText('МАСТЕР ПО ДОМУ');
  });

  test('название заменяется через пропсы — бренд не зашит', async () => {
    const view = await render(
      <SplashScreen ready={false} onDone={jest.fn()} title="ACME" subtitle="СЕРВИС" />,
    );
    view.getByText('ACME');
    expect(view.queryByText('DOMIO')).toBeNull();
  });

  test('тап пропускает заставку и доводит до onDone', async () => {
    const onDone = jest.fn();
    const view = await render(<SplashScreen ready onDone={onDone} />);
    await fireEvent.press(view.getByLabelText('Пропустить заставку'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  test('пока приложение не готово, тап не открывает недорешённый экран', async () => {
    const onDone = jest.fn();
    const view = await render(<SplashScreen ready={false} onDone={onDone} />);
    await fireEvent.press(view.getByLabelText('Пропустить заставку'));
    // Дать сработать всему отложенному: onDone не должен позваться вообще
    await new Promise((r) => setTimeout(r, 50));
    expect(onDone).not.toHaveBeenCalled();
  });
});
