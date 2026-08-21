import { Redirect } from 'expo-router';
import { OrdersScreen, Order } from '../screens/OrdersScreen';

// Витрина для маркетинговых материалов: экран заказов с подставными данными,
// без входа и без Firestore. Живёт только в dev-сборке: в проде вымышленные
// мастера с рейтингами выглядели бы как настоящие — это и повод для отказа
// в App Review, и ровно те «выдуманные отзывы», от которых защищаются
// юридические документы. Данные выдуманы, совпадения имён случайны.

const DEMO_ORDERS: Order[] = [
  {
    id: 'demo-1',
    title: 'Смеситель на кухне',
    date: '21.08.2026',
    status: 'Поиск мастера',
    comment: 'Течёт из-под гайки, нужна замена',
    photoUri: null,
    address: 'ул. Мира, 24',
    masterId: null,
    masterName: null,
    agreedPrice: null,
    reviewed: false,
    price: null,
    priceStatus: 'none',
    offers: [
      {
        masterId: 'demo-m1',
        masterName: 'Адам',
        lastName: 'Исаев',
        price: 3100,
        comment: 'Заменю сегодня, смеситель привезу с собой',
        status: 'pending',
        rating: 4.9,
        reviewsCount: 27,
        experienceYears: 12,
        education: 'Среднее специальное',
        completedOrders: 84,
      },
      {
        masterId: 'demo-m2',
        masterName: 'Магомед',
        lastName: 'Эльмурзаев',
        price: 4200,
        comment: 'Могу завтра утром, гарантия на работу',
        status: 'pending',
        rating: 4.8,
        reviewsCount: 41,
        experienceYears: 9,
        education: 'Среднее специальное',
        completedOrders: 112,
      },
      {
        masterId: 'demo-m3',
        masterName: 'Ахмед',
        lastName: 'Межидов',
        price: 5500,
        comment: 'Сделаю под ключ, с заменой подводки',
        status: 'pending',
        rating: 5,
        reviewsCount: 12,
        experienceYears: 15,
        education: 'Высшее техническое',
        completedOrders: 56,
      },
    ],
  },
  {
    id: 'demo-2',
    title: 'Розетка в спальне',
    date: '14.08.2026',
    status: 'В работе',
    photoUri: null,
    address: 'ул. Мира, 24',
    masterId: 'demo-m2',
    masterName: 'Магомед',
    agreedPrice: 1500,
    reviewed: false,
    price: null,
    priceStatus: 'none',
  },
  {
    id: 'demo-3',
    title: 'Сборка шкафа',
    date: '02.08.2026',
    status: 'Завершена',
    photoUri: null,
    address: 'ул. Мира, 24',
    masterId: 'demo-m1',
    masterName: 'Адам',
    agreedPrice: 2800,
    reviewed: true,
    price: null,
    priceStatus: 'none',
  },
];

const noop = () => {};

export default function DemoRoute() {
  if (!__DEV__) return <Redirect href="/login" />;
  return (
    <OrdersScreen
      orders={DEMO_ORDERS}
      addresses={['ул. Мира, 24']}
      activeAddress="ул. Мира, 24"
      onSelectAddress={noop}
      onAddAddress={noop}
      onCreateOrder={noop}
      onCancelOrder={noop}
      onConfirmOrder={noop}
      onAcceptOffer={noop}
      onSubmitReview={noop}
      onAcceptPrice={noop}
      onDeclinePrice={noop}
      onOpenOrderChat={noop}
    />
  );
}
