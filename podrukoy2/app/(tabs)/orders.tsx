import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

import { useOrders } from '@/components/orders-context';

export default function OrdersScreen() {
  const { orders } = useOrders();

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Мои заказы</Text>

      {/* Заказы появляются только по факту оформления */}
      {orders.length === 0 && (
        <View style={styles.emptyCard}>
          <MaterialCommunityIcons name="clipboard-text-outline" size={28} color="#96A08F" />
          <Text style={styles.emptyTitle}>Заказов пока нет</Text>
          <Text style={styles.emptyText}>Оформите первый заказ с главного экрана</Text>
        </View>
      )}

      {orders.map((order) => (
        <View key={order.id} style={styles.orderItem}>
          <View style={styles.orderIconCircle}>
            <MaterialCommunityIcons name={order.icon} size={18} color="#5E7A56" />
          </View>
          <View style={styles.orderInfo}>
            <Text style={styles.orderTitle}>{order.title}</Text>
            <Text style={styles.orderDate}>{order.date}</Text>
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{order.status}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const shadow = {
  shadowColor: '#2A3624',
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F5EF', padding: 20, paddingTop: 64 },
  header: { fontSize: 24, fontWeight: '800', marginBottom: 18, color: '#1C221A' },
  emptyCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 28, alignItems: 'center', gap: 6,
    ...shadow,
  },
  emptyTitle: { fontWeight: '700', fontSize: 14, color: '#1C221A', marginTop: 4 },
  emptyText: { color: '#96A08F', fontSize: 12.5 },
  orderItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 10, ...shadow,
  },
  orderIconCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#E5EEDF',
    alignItems: 'center', justifyContent: 'center',
  },
  orderInfo: { flex: 1 },
  orderTitle: { fontWeight: '700', fontSize: 13.5, color: '#1C221A' },
  orderDate: { color: '#96A08F', fontSize: 11.5, marginTop: 2 },
  statusPill: {
    backgroundColor: '#F5EBDD', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  statusPillText: { color: '#C98A3D', fontWeight: '700', fontSize: 11 },
});
