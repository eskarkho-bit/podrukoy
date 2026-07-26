import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ComponentProps, ReactNode, createContext, useContext, useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from '@/firebaseConfig';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type Order = {
  id: string;
  title: string;
  date: string;
  status: string;
  icon: IconName;
  // Детали заявки — сохраняются в Firestore, на карточках пока не показываются
  category?: string;
  description?: string;
  comment?: string;
  access?: string;
  quantity?: number;
  price?: number;
};

export type NewOrder = Omit<Order, 'id'>;

// Заказы живут в Firestore (коллекция «orders»): оформили заказ на одном
// экране — он сразу виден на главной, во вкладке «Заказы» и на других устройствах
const OrdersContext = createContext<{
  orders: Order[];
  addOrder: (order: NewOrder) => Promise<void>;
}>({ orders: [], addOrder: async () => {} });

export function OrdersProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<Order[]>([]);

  // Живая подписка: список обновляется сам, свои записи появляются мгновенно —
  // ещё до подтверждения сервера (latency compensation)
  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as NewOrder) })));
      },
      (err) => {
        console.warn('Не удалось загрузить заказы из Firestore:', err);
      },
    );
    return unsubscribe;
  }, []);

  const addOrder = async (order: NewOrder) => {
    await addDoc(collection(db, 'orders'), { ...order, createdAt: serverTimestamp() });
  };

  return <OrdersContext.Provider value={{ orders, addOrder }}>{children}</OrdersContext.Provider>;
}

export const useOrders = () => useContext(OrdersContext);
