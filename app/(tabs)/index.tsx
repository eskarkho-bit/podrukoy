import { useAppState, MASTER_THREAD_ID } from '../../components/AppState';
import { OrdersScreen } from '../../screens/OrdersScreen';

export default function OrdersRoute() {
  const s = useAppState();

  return (
    <OrdersScreen
      orders={s.orders}
      addresses={s.addresses}
      activeAddress={s.activeAddress}
      onSelectAddress={s.setActiveAddress}
      onAddAddress={s.addAddress}
      onCreateOrder={s.createOrder}
      onCancelOrder={s.cancelOrder}
      onConfirmOrder={s.confirmOrderDone}
      onAcceptPrice={s.acceptPrice}
      onDeclinePrice={s.declinePrice}
      onOpenMasterChat={() => s.openChat(MASTER_THREAD_ID)}
      onOverlayOpenChange={s.setOverlayOpen}
    />
  );
}
