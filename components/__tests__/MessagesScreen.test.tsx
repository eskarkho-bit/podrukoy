import { render } from '@testing-library/react-native';
import { MessagesScreen, Thread } from '../../screens/MessagesScreen';

// Экран «Сообщения». Главный сюжет — чат свежепринятой заявки: сообщений в
// нём ещё нет, в списке ему не место, но открываться по кнопке «Сообщение»
// он обязан с первого раза. Раньше пустой тред не существовал вовсе, просьба
// открыть уходила в пустоту, и кнопка срабатывала только со второго нажатия.

const noop = () => {};

const emptyThread: Thread = {
  id: 'order-1',
  name: 'Мастер Магомед',
  icon: '🧑‍🔧',
  unread: false,
  canAttach: true,
  messages: [],
};

const talkedThread: Thread = {
  id: 'order-2',
  name: 'Мастер Иса',
  icon: '🧑‍🔧',
  unread: false,
  canAttach: true,
  messages: [{ id: 'm1', from: 'master', text: 'Буду к шести', time: '14:32' }],
};

const screen = (over: Partial<Parameters<typeof MessagesScreen>[0]> = {}) => (
  <MessagesScreen
    threads={[emptyThread, talkedThread]}
    typingThreadId={null}
    openRequestId={null}
    onOpenRequestHandled={noop}
    onOpenThread={noop}
    onSendMessage={noop}
    onSendImage={async () => {}}
    onThreadOpenChange={noop}
    {...over}
  />
);

describe('MessagesScreen', () => {
  test('пустой чат в списке не показывается', async () => {
    const view = await render(screen());

    expect(view.getByText('Мастер Иса')).toBeTruthy();
    expect(view.queryByText('Мастер Магомед')).toBeNull();
  });

  test('просьба другого экрана открывает чат без сообщений с первого раза', async () => {
    const onHandled = jest.fn();
    const view = await render(
      screen({ openRequestId: 'order-1', onOpenRequestHandled: onHandled }),
    );

    // Тред пуст и в списке скрыт, но переписка открылась: имя видно в шапке
    expect(view.getByText('Мастер Магомед')).toBeTruthy();
    expect(onHandled).toHaveBeenCalled();
  });

  test('чат с сообщениями открывается по просьбе и показывает переписку', async () => {
    const view = await render(screen({ openRequestId: 'order-2' }));

    // Текст виден дважды: превью в списке и пузырь в открытой переписке —
    // одно вхождение значило бы, что чат не открылся
    expect(view.getAllByText('Буду к шести')).toHaveLength(2);
  });
});
