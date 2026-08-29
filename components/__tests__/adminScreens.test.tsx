import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AdminTabs, SupportChat, SupportStatusChips } from '../../screens/AdminScreen';
import { DashboardBlock } from '../../screens/admin/DashboardBlock';
import { OrderAdminCard, OrderFilters } from '../../screens/admin/OrdersTab';
import { UserCard } from '../../screens/admin/PeopleTab';
import { ComplaintCard } from '../../screens/admin/ComplaintsSection';
import { AuditList } from '../../screens/admin/AuditLayer';
import type {
  AdminOrderCard,
  AdminUserCard,
  AuditEntry,
  Complaint,
  DashboardData,
  OrdersFilter,
} from '../AdminState';

// Презентационные части админки. Правила и функции держат безопасность,
// а здесь проверяется то, что стоит между модератором и ошибочным нажатием:
// принудительное закрытие — в два шага, блокировка и скрытие отзыва не
// уходят без причины, дашборд без данных честно молчит.

const noop = () => {};

describe('AdminTabs', () => {
  test('переключает вкладки', async () => {
    const onSelect = jest.fn();
    const view = await render(
      <AdminTabs active="summary" onSelect={onSelect} mastersDot={false} supportDot={false} />,
    );

    await fireEvent.press(view.getByLabelText('Заявки'));

    expect(onSelect).toHaveBeenCalledWith('orders');
  });
});

describe('DashboardBlock', () => {
  const DASHBOARD: DashboardData = {
    days: [{ date: '2026-08-28', created: 3, completed: 1 }],
    weeks: [{ start: '2026-08-24', created: 5, completed: 2 }],
    conversion30d: { total: 10, picked: 4 },
    activeMasters: 7,
    timeToFirstOffer7d: { avgMinutes: 45, withOffers: 3, withoutOffers: 1 },
    updatedMs: null,
  };

  test('показывает посчитанные сервером числа', async () => {
    const view = await render(<DashboardBlock dashboard={DASHBOARD} />);

    expect(view.getByText('7')).toBeTruthy(); // активные мастера
    expect(view.getByText('40%')).toBeTruthy(); // конверсия 4 из 10
    expect(view.getByText('≈ 45 мин')).toBeTruthy();
  });

  // Ноль вместо «нет данных» выглядел бы как настоящее измерение
  test('без документа честно говорит, что считать нечем', async () => {
    const view = await render(<DashboardBlock dashboard={null} />);
    expect(view.getByText(/Появится после первого ночного пересчёта/)).toBeTruthy();
  });
});

describe('OrderFilters', () => {
  const EMPTY: OrdersFilter = { status: null, category: null, days: 30 };

  test('чип статуса ставит и снимает фильтр', async () => {
    const onChange = jest.fn();
    const view = await render(<OrderFilters filter={EMPTY} onChange={onChange} />);

    await fireEvent.press(view.getByText('В работе'));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, status: 'В работе' });

    onChange.mockClear();
    await view.rerender(
      <OrderFilters filter={{ ...EMPTY, status: 'В работе' }} onChange={onChange} />,
    );
    await fireEvent.press(view.getByText('В работе'));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, status: null });
  });
});

describe('OrderAdminCard', () => {
  const CARD: AdminOrderCard = {
    order: {
      id: 'o1',
      title: 'Не работает розетка',
      status: 'В работе',
      clientId: 'c1',
      clientName: 'Дмитрий',
      masterId: 'm1',
      masterName: 'Иван',
      city: 'грозный',
      category: 'электрика',
      address: 'ул. Ленина, 24',
      comment: 'Искрит',
      photoUrl: null,
      agreedPrice: 3000,
      createdMs: Date.now(),
      completedMs: null,
      closedByAdmin: false,
      adminCloseReason: null,
    },
    offers: [],
    messages: [],
  };

  // Принудительное закрытие необратимо, поэтому в два шага: сначала выбор
  // исхода, потом обязательная причина
  test('закрытие требует второго шага и причины', async () => {
    const onClose = jest.fn();
    const view = await render(
      <OrderAdminCard card={CARD} busy={false} onClose={onClose} onShowHistory={noop} />,
    );

    await fireEvent.press(view.getByText('Отменить принудительно'));
    // Причина пуста — кнопка не срабатывает
    await fireEvent.press(view.getByText('Отменить заявку'));
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.changeText(
      view.getByPlaceholderText('Причина — её увидят обе стороны'),
      'Мастер не приехал',
    );
    await fireEvent.press(view.getByText('Отменить заявку'));
    expect(onClose).toHaveBeenCalledWith('Отменена', 'Мастер не приехал');
  });

  test('закрытая заявка не предлагает закрытие снова', async () => {
    const view = await render(
      <OrderAdminCard
        card={{ ...CARD, order: { ...CARD.order, status: 'Отменена', closedByAdmin: true } }}
        busy={false}
        onClose={noop}
        onShowHistory={noop}
      />,
    );
    expect(view.queryByText('Отменить принудительно')).toBeNull();
    expect(view.getByText(/Закрыта модерацией/)).toBeTruthy();
  });
});

describe('UserCard', () => {
  const CARD: AdminUserCard = {
    profile: {
      exists: true,
      name: 'Дмитрий',
      phone: '+79991234567',
      city: 'Грозный',
      blocked: false,
      blockedReason: null,
    },
    master: {
      exists: false,
      name: '',
      verified: false,
      blocked: false,
      rating: null,
      reviewsCount: 0,
      completedOrders: 0,
    },
    clientOrders: [],
    masterOrders: [],
    reviews: [],
    complaints: [],
  };

  test('блокировка не уходит без причины', async () => {
    const onBlockUser = jest.fn();
    const view = await render(
      <UserCard
        uid="u1"
        card={CARD}
        busy={false}
        onBlockUser={onBlockUser}
        onBlockMaster={noop}
        onHideReview={noop}
      />,
    );

    await fireEvent.press(view.getByText('Заблокировать клиента'));
    await fireEvent.press(view.getByText('Заблокировать'));
    expect(onBlockUser).not.toHaveBeenCalled();

    await fireEvent.changeText(
      view.getByPlaceholderText('Причина — её увидит заблокированный'),
      'Оскорбления',
    );
    await fireEvent.press(view.getByText('Заблокировать'));
    expect(onBlockUser).toHaveBeenCalledWith(true, 'Оскорбления');
  });

  test('заблокированному показывается причина и кнопка разблокировки', async () => {
    const onBlockUser = jest.fn();
    const view = await render(
      <UserCard
        uid="u1"
        card={{
          ...CARD,
          profile: { ...CARD.profile, blocked: true, blockedReason: 'Оскорбления' },
        }}
        busy={false}
        onBlockUser={onBlockUser}
        onBlockMaster={noop}
        onHideReview={noop}
      />,
    );

    expect(view.getByText(/Клиент заблокирован: Оскорбления/)).toBeTruthy();
    await fireEvent.press(view.getByText('Разблокировать клиента'));
    expect(onBlockUser).toHaveBeenCalledWith(false, '');
  });
});

describe('ComplaintCard', () => {
  const COMPLAINT: Complaint = {
    id: 'c1',
    byUid: 'master1',
    masterId: 'master1',
    orderId: 'order1',
    reviewClientId: 'client1',
    text: 'Отзыв не о моей работе',
    status: 'новая',
    createdMs: Date.now(),
  };

  test('скрытие отзыва требует причину', async () => {
    const onHide = jest.fn();
    const view = await render(
      <ComplaintCard complaint={COMPLAINT} busy={false} onHide={onHide} onDismiss={noop} />,
    );

    await fireEvent.press(view.getByText('Скрыть отзыв'));
    await fireEvent.press(view.getByText('Скрыть и закрыть жалобу'));
    expect(onHide).not.toHaveBeenCalled();

    await fireEvent.changeText(
      view.getByPlaceholderText('Причина скрытия — уйдёт мастеру'),
      'Оскорбления в тексте',
    );
    await fireEvent.press(view.getByText('Скрыть и закрыть жалобу'));
    expect(onHide).toHaveBeenCalledWith('Оскорбления в тексте');
  });

  // «Нет» без объяснения обесценило бы механизм жалоб
  test('отклонение требует записку автору', async () => {
    const onDismiss = jest.fn();
    const view = await render(
      <ComplaintCard complaint={COMPLAINT} busy={false} onHide={noop} onDismiss={onDismiss} />,
    );

    await fireEvent.press(view.getByText('Отклонить'));
    await fireEvent.changeText(
      view.getByPlaceholderText('Почему жалоба отклонена'),
      'Отзыв по делу',
    );
    await fireEvent.press(view.getAllByText('Отклонить')[0]);
    expect(onDismiss).toHaveBeenCalledWith('Отзыв по делу');
  });
});

describe('SupportChat', () => {
  test('ответ отправляется и поле очищается', async () => {
    const onSend = jest.fn(async () => true);
    const view = await render(
      <SupportChat
        uid="client1"
        status="новое"
        messages={[{ id: 'm1', from: 'user', text: 'Не приходит код', time: '12:00' }]}
        sending={false}
        onSend={onSend}
        onSetStatus={noop}
        onBack={noop}
      />,
    );

    expect(view.getByText('Не приходит код')).toBeTruthy();
    const input = view.getByPlaceholderText('Ответ клиенту…');
    await fireEvent.changeText(input, 'Проверьте папку «Спам»');
    await fireEvent.press(view.getByText('➤'));

    expect(onSend).toHaveBeenCalledWith('Проверьте папку «Спам»');
    await waitFor(() => expect(input.props.value).toBe(''));
  });

  test('статус обращения переключается чипом', async () => {
    const onSetStatus = jest.fn();
    const view = await render(
      <SupportChat
        uid="client1"
        status="новое"
        messages={[]}
        sending={false}
        onSend={async () => true}
        onSetStatus={onSetStatus}
        onBack={noop}
      />,
    );

    await fireEvent.press(view.getByLabelText('Статус: в работе'));
    expect(onSetStatus).toHaveBeenCalledWith('в работе');
  });
});

describe('SupportStatusChips', () => {
  test('фильтр ставится и снимается', async () => {
    const onChange = jest.fn();
    const view = await render(<SupportStatusChips value={null} onChange={onChange} />);
    await fireEvent.press(view.getByText('закрыто'));
    expect(onChange).toHaveBeenCalledWith('закрыто');

    onChange.mockClear();
    await view.rerender(<SupportStatusChips value="закрыто" onChange={onChange} />);
    await fireEvent.press(view.getByText('закрыто'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('AuditList', () => {
  test('действия подписаны по-русски, неизвестные — кодом', async () => {
    const entries: AuditEntry[] = [
      {
        id: 'e1',
        action: 'master.approved',
        actorType: 'admin',
        actorUid: 'admin1',
        subjectType: 'master',
        subjectId: 'master-12345678',
        atMs: Date.now(),
        details: { hasPhoto: true },
      },
      {
        id: 'e2',
        action: 'something.new',
        actorType: 'system',
        actorUid: null,
        subjectType: 'system',
        subjectId: 'x',
        atMs: null,
        details: {},
      },
    ];

    const view = await render(<AuditList entries={entries} />);
    expect(view.getByText('Анкета одобрена')).toBeTruthy();
    expect(view.getByText('something.new')).toBeTruthy();
    expect(view.getByText(/hasPhoto: true/)).toBeTruthy();
  });
});
