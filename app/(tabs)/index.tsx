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
      onReturnOrder={s.returnOrderToWork}
      onReportMaster={s.reportMaster}
      onBlockMaster={s.blockMaster}
      blockedMasterIds={s.blockedMasters.map((m) => m.id)}
      onChoosePaymentMethod={s.choosePaymentMethod}
      onMarkPaid={s.markOrderPaid}
      onAcceptOffer={s.acceptOffer}
      onSubmitReview={s.submitReview}
      onAcceptPrice={s.acceptPrice}
      onDeclinePrice={s.declinePrice}
      onOpenOrderChat={s.openChat}
      onOverlayOpenChange={s.setOverlayOpen}
      covered={s.masterOpen || s.adminOpen}
      blocked={s.blocked}
      blockedReason={s.blockedReason}
      onNotice={s.showNotice}
      hasCity={!!s.city}
    />
  );
}
