import { useAppState, SUPPORT_THREAD_ID } from '../../components/AppState';
import { ProfileScreen } from '../../screens/ProfileScreen';

export default function ProfileRoute() {
  const s = useAppState();

  return (
    <ProfileScreen
      name={s.userName}
      onChangeName={s.setUserName}
      email={s.userEmail}
      address={s.activeAddress}
      city={s.city}
      onChangeCity={s.setCity}
      ordersTotal={s.orders.length}
      ordersActive={s.ordersActive}
      onContactSupport={() => s.openChat(SUPPORT_THREAD_ID)}
      onOpenMaster={() => s.setMasterOpen(true)}
      isAdmin={s.isAdmin}
      onOpenAdmin={() => s.setAdminOpen(true)}
      onLogout={s.logout}
      onDeleteAccount={s.deleteAccount}
    />
  );
}
