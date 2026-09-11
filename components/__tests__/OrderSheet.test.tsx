import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { OrderSheet } from '../OrderSheet';
import type { Order } from '../../screens/OrdersScreen';

// Расчёт идёт мимо сервиса, и всё, чем сервис здесь помогает, — правильно
// показать, куда платить, и не дать «оплатил» уйти случайным касанием.
// Таймеры настоящие: поддельные конфликтуют с асинхронной очисткой RNTL 14.

const ORDER: Order = {
  id: 'o1',
  title: 'Не работает розетка',
  date: '06.09.2026',
  status: 'Завершена',
  masterId: 'm1',
  masterName: 'Иван',
  masterPhone: '+79280001122',
  masterBanks: ['sber', 'tbank'],
  masterAcceptsCash: true,
  agreedPrice: 3500,
  reviewed: true,
};

const noop = () => {};
// Взведённая кнопка глуха первые 400 мс — ждём с запасом
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function renderSheet(
  order: Order,
  handlers: Partial<{
    onChoose: jest.Mock;
    onMarkPaid: jest.Mock;
    onConfirmDone: jest.Mock;
    onReturnToWork: jest.Mock;
    onReportMaster: jest.Mock;
    onBlockMaster: jest.Mock;
    masterBlocked: boolean;
  }> = {},
) {
  return render(
    <OrderSheet
      order={order}
      onClose={noop}
      onCancel={noop}
      onConfirmDone={handlers.onConfirmDone ?? noop}
      onReturnToWork={handlers.onReturnToWork ?? noop}
      onReportMaster={handlers.onReportMaster ?? (async () => true)}
      onBlockMaster={handlers.onBlockMaster ?? noop}
      masterBlocked={handlers.masterBlocked ?? false}
      onChoosePaymentMethod={handlers.onChoose ?? noop}
      onMarkPaid={handlers.onMarkPaid ?? noop}
      onChat={noop}
      onAcceptOffer={noop}
      onSubmitReview={noop}
      onAcceptPrice={noop}
      onDeclinePrice={noop}
    />,
  );
}

describe('оплата напрямую', () => {
  test('без способа — выбор из двух и никакой кнопки «оплатил»', async () => {
    const onChoose = jest.fn();
    const view = await renderSheet(ORDER, { onChoose });

    expect(view.queryByText('Я оплатил')).toBeNull();
    await fireEvent.press(view.getByText('Переводом'));
    expect(onChoose).toHaveBeenCalledWith('transfer');
  });

  test('перевод: номер, банки, имя получателя и предупреждение', async () => {
    const view = await renderSheet({ ...ORDER, paymentMethod: 'transfer' });

    expect(view.getByText('+7 928 000-11-22')).toBeTruthy();
    expect(view.getByText(/Сбербанк, Т-Банк/)).toBeTruthy();
    expect(view.getByText(/имя получателя.*Иван/)).toBeTruthy();
    expect(view.getByText(/не участвует в расчётах/)).toBeTruthy();
  });

  test('мастер без наличных — выбора «наличными» нет', async () => {
    const view = await renderSheet({ ...ORDER, masterAcceptsCash: false });

    expect(view.queryByText('Наличными')).toBeNull();
    expect(view.getByText('Переводом')).toBeTruthy();
  });

  test('«оплатил» уходит только со второго касания', async () => {
    const onMarkPaid = jest.fn();
    const view = await renderSheet({ ...ORDER, paymentMethod: 'cash' }, { onMarkPaid });

    await fireEvent.press(view.getByText('Я оплатил'));
    expect(onMarkPaid).not.toHaveBeenCalled();
    expect(view.getByText(/Точно\? Отметить оплату/)).toBeTruthy();

    await pause(450);
    await fireEvent.press(view.getByText(/Точно\? Отметить оплату/));
    expect(onMarkPaid).toHaveBeenCalledTimes(1);
  });

  test('после отметок — состояние вместо кнопок, способ заперт', async () => {
    const onChoose = jest.fn();
    const view = await renderSheet(
      {
        ...ORDER,
        paymentMethod: 'transfer',
        paidMs: new Date(2026, 8, 6, 12).getTime(),
        paymentReceivedMs: new Date(2026, 8, 7, 12).getTime(),
      },
      { onChoose },
    );

    expect(view.getByText(/Вы отметили оплату 06\.09\.2026/)).toBeTruthy();
    expect(view.getByText(/Мастер подтвердил получение/)).toBeTruthy();
    expect(view.queryByText('Я оплатил')).toBeNull();
    // Чипы остаются на месте, но передумать уже нельзя
    await fireEvent.press(view.getByText('Наличными'));
    expect(onChoose).not.toHaveBeenCalled();
  });

  test('пока мастер не выбран, блока оплаты нет', async () => {
    const view = await renderSheet({
      ...ORDER,
      status: 'Поиск мастера',
      masterId: null,
      masterName: null,
      agreedPrice: null,
    });

    expect(view.queryByText(/^Оплата/)).toBeNull();
  });
});

// Мастер сказал «сделано». Подтвердить — одно касание; вернуть в работу —
// два: возврат меняет статус у другого человека.
describe('приёмка работы', () => {
  const AWAITING: Order = { ...ORDER, status: 'Ждёт подтверждения', reviewed: false };

  test('подтверждение уходит с первого касания', async () => {
    const onConfirmDone = jest.fn();
    const view = await renderSheet(AWAITING, { onConfirmDone });

    await fireEvent.press(view.getByText(/Работа выполнена — подтвердить/));
    expect(onConfirmDone).toHaveBeenCalledTimes(1);
  });

  test('«ещё не готово» — только со второго касания', async () => {
    const onReturnToWork = jest.fn();
    const view = await renderSheet(AWAITING, { onReturnToWork });

    await fireEvent.press(view.getByText(/Ещё не готово/));
    expect(onReturnToWork).not.toHaveBeenCalled();
    expect(view.getByText(/Точно вернуть мастеру/)).toBeTruthy();

    await pause(450);
    await fireEvent.press(view.getByText(/Точно вернуть мастеру/));
    expect(onReturnToWork).toHaveBeenCalledTimes(1);
  });

  test('вне приёмки кнопок подтверждения и возврата нет', async () => {
    const view = await renderSheet({ ...ORDER, status: 'В работе' });

    expect(view.queryByText(/подтвердить/)).toBeNull();
    expect(view.queryByText(/Ещё не готово/)).toBeNull();
  });
});

// Жалоба и блокировка — на мастера заявки. Жалоба уходит только с текстом,
// блокировка — со второго касания; у заблокированного вместо кнопки состояние.
describe('жалоба и блокировка мастера', () => {
  test('жалоба уходит с текстом и сменяется отметкой', async () => {
    const onReportMaster = jest.fn(async () => true);
    const view = await renderSheet(ORDER, { onReportMaster });

    await fireEvent.press(view.getByText('Пожаловаться на мастера'));
    const input = view.getByPlaceholderText(/Что случилось/);
    await fireEvent.changeText(input, 'Пришёл не вовремя');
    await fireEvent.press(view.getByText('Отправить жалобу'));

    await waitFor(() => expect(onReportMaster).toHaveBeenCalledWith('Пришёл не вовремя'));
    await waitFor(() => expect(view.getByText('Жалоба отправлена')).toBeTruthy());
  });

  test('блокировка — только со второго касания', async () => {
    const onBlockMaster = jest.fn();
    const view = await renderSheet(ORDER, { onBlockMaster });

    await fireEvent.press(view.getByText('Заблокировать мастера'));
    expect(onBlockMaster).not.toHaveBeenCalled();
    await pause(450);
    await fireEvent.press(view.getByText('Точно заблокировать?'));
    expect(onBlockMaster).toHaveBeenCalledTimes(1);
  });

  test('заблокированный мастер — состояние вместо кнопки; пока мастера нет — ничего', async () => {
    const blockedView = await renderSheet(ORDER, { masterBlocked: true });
    expect(blockedView.getByText('Мастер заблокирован')).toBeTruthy();
    expect(blockedView.queryByText('Заблокировать мастера')).toBeNull();

    const openView = await renderSheet({
      ...ORDER,
      status: 'Поиск мастера',
      masterId: null,
      masterName: null,
      agreedPrice: null,
    });
    expect(openView.queryByText('Пожаловаться на мастера')).toBeNull();
  });
});
