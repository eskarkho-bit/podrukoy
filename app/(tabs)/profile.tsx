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
      ordersTotal={s.orders.length}
      ordersActive={s.ordersActive}
      onContactSupport={() => s.openChat(SUPPORT_THREAD_ID)}
      onOpenMaster={() => s.setMasterOpen(true)}
    />
  );
}
