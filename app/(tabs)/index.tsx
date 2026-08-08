import { useAppState } from '../../components/AppState';
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
      onAcceptOffer={s.acceptOffer}
      onSubmitReview={s.submitReview}
      onAcceptPrice={s.acceptPrice}
      onDeclinePrice={s.declinePrice}
      onOpenOrderChat={s.openChat}
      onOverlayOpenChange={s.setOverlayOpen}
    />
  );
}
