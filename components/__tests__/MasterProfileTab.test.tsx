import { fireEvent, render } from '@testing-library/react-native';
import { FOUNDER_EMAIL } from '../founder';
import { PaymentSettings, ProfileTab, type MasterProfile } from '../../screens/MasterScreen';

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
      payment={null}
      phone="79991234567"
      onSavePayment={noop}
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

// Способы оплаты сохраняются каждым касанием: то, что уходит в базу, должно
// быть ровно тем, что мастер видит выбранным
describe('способы оплаты', () => {
  test('без настроек клиенту обещают оба способа, касание банка сохраняет список', async () => {
    const onSave = jest.fn();
    const view = await render(
      <PaymentSettings payment={null} phone="79991234567" onSave={onSave} />,
    );

    expect(view.getByText(/и наличные, и перевод/)).toBeTruthy();
    // Номер для переводов — тот же, что в анкете, показан читаемо
    expect(view.getByText(/\+7 999 123-45-67/)).toBeTruthy();

    await fireEvent.press(view.getByText('Т-Банк'));
    expect(onSave).toHaveBeenCalledWith({ banks: ['tbank'], acceptsCash: true });
  });

  test('наличные выключаются одним касанием, банк снимается повторным', async () => {
    const onSave = jest.fn();
    const view = await render(
      <PaymentSettings
        payment={{ banks: ['sber', 'tbank'], acceptsCash: true }}
        phone=""
        onSave={onSave}
      />,
    );

    await fireEvent.press(view.getByText(/Принимаю наличные/));
    expect(onSave).toHaveBeenCalledWith({ banks: ['sber', 'tbank'], acceptsCash: false });

    await fireEvent.press(view.getByText('Сбербанк'));
    expect(onSave).toHaveBeenLastCalledWith({ banks: ['tbank'], acceptsCash: true });
  });
});
