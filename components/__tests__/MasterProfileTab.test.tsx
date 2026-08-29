import { render } from '@testing-library/react-native';
import { FOUNDER_EMAIL } from '../founder';
import { ProfileTab, type MasterProfile } from '../../screens/MasterScreen';

// Плашка основателя привязана к почте аккаунта: показать её любому другому
// мастеру значило бы раздать чужой титул.

const PROFILE: MasterProfile = {
  name: 'Дмитрий',
  lastName: '',
  cities: [],
  skills: [],
  experienceYears: null,
  education: null,
  verified: true,
  blocked: false,
  rating: null,
  reviewsCount: 0,
  completedOrders: 0,
};

const noop = () => {};

function renderProfile(email: string) {
  return render(
    <ProfileTab
      email={email}
      profile={PROFILE}
      reviews={[]}
      onEdit={noop}
      onLogout={noop}
      onClose={noop}
      onComplain={async () => true}
    />,
  );
}

describe('плашка основателя', () => {
  test('видна на аккаунте основателя', async () => {
    const view = await renderProfile(FOUNDER_EMAIL);
    expect(view.getByText(/основатель domio/)).toBeTruthy();
  });

  test('у остальных мастеров её нет', async () => {
    const view = await renderProfile('master@example.com');
    expect(view.queryByText(/основатель domio/)).toBeNull();
    // Обычная плашка проверки при этом на месте
    expect(view.getByText(/проверенный мастер/)).toBeTruthy();
  });
});
