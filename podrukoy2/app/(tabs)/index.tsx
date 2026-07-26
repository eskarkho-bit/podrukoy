import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ComponentProps, useRef, useState } from 'react';
import { Animated, Platform, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

import garageImage from '@/assets/images/3d/garage.png';
import gardenImage from '@/assets/images/3d/garden.png';
import houseImage from '@/assets/images/3d/house.png';
import { useOrders } from '@/components/orders-context';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

// Своя картинка для каждой области — меняется с плавной анимацией
const areaImages: Record<string, number> = {
  Дом: houseImage,
  Двор: gardenImage,
  Гараж: garageImage,
};

const areas: { label: string; icon: IconName }[] = [
  { label: 'Дом', icon: 'home-outline' },
  { label: 'Двор', icon: 'tree-outline' },
  { label: 'Гараж', icon: 'garage' },
];

export default function HomeScreen() {
  const router = useRouter();
  const [area, setArea] = useState('Дом');
  // displayArea — что показано на картинке; отстаёт от area на время анимации
  const [displayArea, setDisplayArea] = useState('Дом');
  const { orders } = useOrders();

  // 1 — картинка видна полностью, 0 — скрыта (для плавной смены)
  const imageAnim = useRef(new Animated.Value(1)).current;

  const changeArea = (label: string) => {
    if (label === area) return;
    setArea(label);
    // Плавно прячем старую картинку, меняем её и так же плавно показываем новую
    Animated.timing(imageAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      setDisplayArea(label);
      Animated.timing(imageAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    });
  };

  return (
    <ScrollView style={styles.container}>
      {/* Шапка: название дома слева, колокольчик уведомлений справа */}
      <View style={styles.headerRow}>
        <Text style={styles.header}>Мой дом ▾</Text>
        <TouchableOpacity style={styles.bellBtn}>
          <Ionicons name="notifications-outline" size={20} color="#1C221A" />
        </TouchableOpacity>
      </View>

      {/* Карточка с картинкой области — нажатие открывает разрез дома */}
      <TouchableOpacity style={styles.houseCard} onPress={() => router.push('/rooms')}>
        <Animated.View
          style={{
            opacity: imageAnim,
            transform: [
              { scale: imageAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
            ],
          }}
        >
          <Image source={areaImages[displayArea]} style={styles.houseImage} contentFit="contain" />
        </Animated.View>
        <Text style={styles.houseCaption}>ул. Ленина, 24 · {area}</Text>
        <View style={styles.ctaPill}>
          <Text style={styles.ctaPillText}>Оформить заказ →</Text>
        </View>
      </TouchableOpacity>

      {/* Три области: Дом / Двор / Гараж */}
      <View style={styles.areasRow}>
        {areas.map((item) => {
          const selected = area === item.label;
          return (
            <TouchableOpacity
              key={item.label}
              style={[styles.areaBtn, selected && styles.areaBtnSelected]}
              onPress={() => changeArea(item.label)}
            >
              <MaterialCommunityIcons
                name={item.icon}
                size={22}
                color={selected ? '#fff' : '#96A08F'}
              />
              <Text style={[styles.areaText, selected && styles.areaTextSelected]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Недавние заказы</Text>
        {orders.length > 0 && (
          <TouchableOpacity onPress={() => router.push('/orders')}>
            <Text style={styles.sectionLink}>Смотреть все</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Заказы появляются только по факту оформления */}
      {orders.length === 0 && (
        <View style={styles.emptyCard}>
          <MaterialCommunityIcons name="clipboard-text-outline" size={28} color="#96A08F" />
          <Text style={styles.emptyTitle}>Заказов пока нет</Text>
          <Text style={styles.emptyText}>Нажмите на дом, чтобы оформить первый</Text>
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
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
  },
  header: { fontSize: 24, fontWeight: '800', color: '#1C221A' },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  houseCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 18, alignItems: 'center',
    marginBottom: 16, overflow: 'hidden', ...shadow,
  },
  houseImage: { width: 260, height: 180 },
  houseCaption: { color: '#96A08F', fontWeight: '600', fontSize: 13, marginTop: 6 },
  ctaPill: {
    backgroundColor: '#5E7A56', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9,
    marginTop: 12,
  },
  ctaPillText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  areasRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  areaBtn: {
    flex: 1, backgroundColor: '#fff', borderRadius: 18, paddingVertical: 14,
    alignItems: 'center', gap: 6, ...shadow,
  },
  areaBtnSelected: { backgroundColor: '#5E7A56' },
  areaText: { fontWeight: '700', fontSize: 12.5, color: '#96A08F' },
  areaTextSelected: { color: '#fff' },
  sectionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1C221A' },
  sectionLink: { fontSize: 12.5, fontWeight: '600', color: '#96A08F' },
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
