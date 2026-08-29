import { fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  JobList,
  ProfileTab,
  type MasterProfile,
  type MasterReview,
} from '../../screens/MasterScreen';

// Жалобы на отзывы и отстранение — сторона мастера. Проверяется контракт
// с сервером: жалоба не уходит пустой, после отправки кнопка исчезает,
// а отстранённый видит причину вместо молчаливо пустой ленты.

const PROFILE: MasterProfile = {
  name: 'Иван',
  lastName: 'Петров',
  cities: [],
  skills: [],
  experienceYears: null,
  education: null,
  verified: true,
  blocked: false,
  rating: 4.8,
  reviewsCount: 1,
  completedOrders: 3,
};

const REVIEW: MasterReview = {
  id: 'order1',
  clientId: 'client1',
  clientName: 'Дмитрий',
  stars: 1,
  text: 'Ужасно',
  createdMs: Date.now(),
};

const noop = () => {};

function renderProfileTab(onComplain: (review: MasterReview, text: string) => Promise<boolean>) {
  return render(
    <ProfileTab
      email="master@example.com"
      profile={PROFILE}
      reviews={[REVIEW]}
      onEdit={noop}
      onLogout={noop}
      onClose={noop}
      onComplain={onComplain}
    />,
  );
}

describe('жалоба на отзыв', () => {
  test('пустая жалоба не отправляется', async () => {
    const onComplain = jest.fn(async () => true);
    const view = await renderProfileTab(onComplain);

    await fireEvent.press(view.getByText('Пожаловаться'));
    await fireEvent.press(view.getByText('Отправить'));

    expect(onComplain).not.toHaveBeenCalled();
  });

  test('отправленная жалоба помечается и кнопка исчезает', async () => {
    const onComplain = jest.fn(async () => true);
    const view = await renderProfileTab(onComplain);

    await fireEvent.press(view.getByText('Пожаловаться'));
    await fireEvent.changeText(
      view.getByPlaceholderText('Что не так с этим отзывом'),
      'Отзыв не о моей работе',
    );
    await fireEvent.press(view.getByText('Отправить'));

    expect(onComplain).toHaveBeenCalledWith(REVIEW, 'Отзыв не о моей работе');
    await waitFor(() => expect(view.getByText(/Жалоба отправлена/)).toBeTruthy());
    expect(view.queryByText('Пожаловаться')).toBeNull();
  });

  // Сервер отказал (нет связи, нет входа) — форма остаётся, текст не пропал
  test('при отказе сервера форма не закрывается', async () => {
    const onComplain = jest.fn(async () => false);
    const view = await renderProfileTab(onComplain);

    await fireEvent.press(view.getByText('Пожаловаться'));
    await fireEvent.changeText(view.getByPlaceholderText('Что не так с этим отзывом'), 'Текст');
    await fireEvent.press(view.getByText('Отправить'));

    await waitFor(() => expect(onComplain).toHaveBeenCalled());
    expect(view.queryByText(/Жалоба отправлена/)).toBeNull();
    expect(view.getByPlaceholderText('Что не так с этим отзывом')).toBeTruthy();
  });
});

describe('отстранённый мастер', () => {
  test('видит в ленте причину, а не молчаливую пустоту', async () => {
    const view = await render(
      <JobList
        email="master@example.com"
        profile={{ ...PROFILE, blocked: true }}
        blockedReason="Жалобы клиентов"
        jobs={[]}
        typingJobId={null}
        onOpenJob={noop}
        onClose={noop}
        onEditProfile={noop}
      />,
    );

    expect(view.getByText('Доступ к заявкам приостановлен')).toBeTruthy();
    expect(view.getByText('Жалобы клиентов')).toBeTruthy();
  });

  test('без блокировки баннера нет', async () => {
    const view = await render(
      <JobList
        email="master@example.com"
        profile={PROFILE}
        blockedReason={null}
        jobs={[]}
        typingJobId={null}
        onOpenJob={noop}
        onClose={noop}
        onEditProfile={noop}
      />,
    );

    expect(view.queryByText('Доступ к заявкам приостановлен')).toBeNull();
  });
});
