import { fireEvent, render } from '@testing-library/react-native';
import { SettlementRow, type Job } from '../../screens/MasterScreen';

// «Оплату получил» — единственный след расчёта со стороны мастера, и он
// необратим: уходит только со второго касания, а после — только надпись.
// Таймеры настоящие: поддельные конфликтуют с асинхронной очисткой RNTL 14.

const JOB: Job = {
  id: 'j1',
  title: 'Розетка',
  client: 'Дмитрий',
  address: '',
  clientPhone: null,
  paymentMethod: 'transfer',
  paidMs: new Date(2026, 8, 6, 12).getTime(),
  paymentReceivedMs: null,
  date: '',
  desc: '',
  status: 'done',
  price: 3500,
  createdMs: null,
  completedMs: null,
  legacy: false,
  unread: false,
  messages: [],
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('расчёт у мастера', () => {
  test('видит способ клиента и его отметку; «получил» — со второго касания', async () => {
    const onReceived = jest.fn();
    const view = await render(<SettlementRow job={JOB} onReceived={onReceived} />);

    expect(view.getByText(/Клиент платит переводом · отметил оплату 06\.09\.2026/)).toBeTruthy();

    await fireEvent.press(view.getByText('Оплату получил'));
    expect(onReceived).not.toHaveBeenCalled();

    await pause(450);
    await fireEvent.press(view.getByText(/Точно\? Отметить получение/));
    expect(onReceived).toHaveBeenCalledTimes(1);
  });

  test('после подтверждения кнопки нет', async () => {
    const view = await render(
      <SettlementRow
        job={{ ...JOB, paymentReceivedMs: new Date(2026, 8, 7, 12).getTime() }}
        onReceived={jest.fn()}
      />,
    );

    expect(view.getByText(/Оплата получена 07\.09\.2026/)).toBeTruthy();
    expect(view.queryByText('Оплату получил')).toBeNull();
  });

  test('клиент ещё ничего не выбрал — честная подпись', async () => {
    const view = await render(
      <SettlementRow job={{ ...JOB, paymentMethod: null, paidMs: null }} onReceived={jest.fn()} />,
    );

    expect(view.getByText('Клиент ещё не выбрал способ оплаты')).toBeTruthy();
  });
});
