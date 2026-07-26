import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

import { IconName } from '@/components/orders-context';

type Service = { title: string; desc: string; price: number; icon: IconName };

const servicesByCategory: Record<string, Service[]> = {
  light: [
    { title: 'Починить розетку', desc: 'Не работает розетка', price: 1500, icon: 'power-socket-eu' },
    { title: 'Заменить выключатель', desc: 'Искрит или не работает', price: 1200, icon: 'light-switch' },
    { title: 'Повесить люстру', desc: 'Установить новый светильник', price: 2500, icon: 'ceiling-light' },
    { title: 'Добавить розетку', desc: 'Установить дополнительную', price: 2800, icon: 'power-plug-outline' },
    { title: 'Провести проводку', desc: 'Новая проводка', price: 8000, icon: 'flash-outline' },
  ],
  sockets: [
    { title: 'Почистить розетку', desc: 'Плохой контакт', price: 900, icon: 'power-socket-eu' },
    { title: 'Заменить розетку', desc: 'Треснула или искрит', price: 1400, icon: 'power-plug-outline' },
  ],
  switches: [
    { title: 'Заменить выключатель', desc: 'Искрит или не работает', price: 1200, icon: 'light-switch' },
    { title: 'Установить диммер', desc: 'Регулятор яркости света', price: 1800, icon: 'tune-vertical' },
  ],
  bathroom: [
    { title: 'Устранить течь', desc: 'Капает или течёт вода', price: 1800, icon: 'water' },
    { title: 'Заменить смеситель', desc: 'Старый или сломан', price: 2200, icon: 'water-pump' },
    { title: 'Прочистить засор', desc: 'Медленно уходит вода', price: 1500, icon: 'pipe' },
  ],
  kitchen: [
    { title: 'Подключить технику', desc: 'Плита, вытяжка, посудомойка', price: 2000, icon: 'stove' },
    { title: 'Заменить смеситель', desc: 'Старый или сломан', price: 2200, icon: 'water-pump' },
    { title: 'Устранить засор', desc: 'В раковине или трубе', price: 1500, icon: 'pipe' },
  ],
  heating: [
    { title: 'Настроить батарею', desc: 'Не греет или течёт', price: 1700, icon: 'radiator' },
    { title: 'Спустить воздух', desc: 'Завоздушивание системы', price: 800, icon: 'weather-windy' },
  ],
  doors: [
    { title: 'Отрегулировать дверь', desc: 'Провисла или скрипит', price: 1300, icon: 'door' },
    { title: 'Заменить замок', desc: 'Плохо закрывается', price: 1600, icon: 'lock-outline' },
  ],
  windows: [
    { title: 'Отрегулировать окно', desc: 'Не закрывается плотно', price: 1300, icon: 'window-closed-variant' },
    { title: 'Заменить уплотнитель', desc: 'Продувает или сквозняк', price: 1100, icon: 'window-open-variant' },
  ],
  other: [{ title: 'Своя проблема', desc: 'Опишите ниже', price: 1500, icon: 'pencil-outline' }],
};

import bathImage from '@/assets/images/3d/bath.png';
import doorImage from '@/assets/images/3d/door.png';
import heatingImage from '@/assets/images/3d/heating.png';
import heroLightImage from '@/assets/images/3d/hero-light.png';
import kitchenImage from '@/assets/images/3d/kitchen.png';
import socketImage from '@/assets/images/3d/socket.png';
import switchImage from '@/assets/images/3d/switch.png';
import toolboxImage from '@/assets/images/3d/toolbox.png';
import windowImage from '@/assets/images/3d/window.png';

// Большая 3D-картинка категории, как лампочка на макете
const heroImages: Record<string, number> = {
  light: heroLightImage,
  sockets: socketImage,
  switches: switchImage,
  bathroom: bathImage,
  kitchen: kitchenImage,
  heating: heatingImage,
  doors: doorImage,
  windows: windowImage,
  other: toolboxImage,
};

export default function ServicesScreen() {
  const router = useRouter();
  const { categoryId, categoryLabel } = useLocalSearchParams<{ categoryId: string; categoryLabel: string }>();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const list = servicesByCategory[categoryId] || [];

  // По кнопке «Далее» передаём выбранную услугу на экран оформления заказа
  const goNext = () => {
    if (selectedIndex === null) return;
    const service = list[selectedIndex];
    router.push({
      pathname: '/order',
      params: {
        title: service.title,
        desc: service.desc,
        price: String(service.price),
        icon: service.icon,
        categoryLabel,
      },
    });
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.topbar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.header}>{categoryLabel}</Text>
      </View>

      <View style={styles.hero}>
        <Image source={heroImages[categoryId]} style={styles.heroImage} contentFit="contain" />
      </View>

      {list.map((item, i) => (
        <TouchableOpacity
          key={i}
          style={[styles.item, selectedIndex === i && styles.itemSelected]}
          onPress={() => setSelectedIndex(i)}
        >
          <View style={styles.itemIconCircle}>
            <MaterialCommunityIcons name={item.icon} size={18} color="#5E7A56" />
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemDesc}>{item.desc}</Text>
          </View>
          <Text style={styles.itemPrice}>от {item.price} ₽</Text>
        </TouchableOpacity>
      ))}

      {list.length === 0 && (
        <Text style={styles.empty}>Для этой категории пока нет услуг — добавим позже.</Text>
      )}

      <TouchableOpacity
        style={[styles.nextBtn, selectedIndex === null && styles.nextBtnDisabled]}
        disabled={selectedIndex === null}
        onPress={goNext}
      >
        <Text style={styles.nextBtnText}>Далее</Text>
      </TouchableOpacity>
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
  topbar: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', marginRight: 12, ...shadow,
  },
  backArrow: { fontSize: 16, fontWeight: '700', color: '#1C221A' },
  header: { fontSize: 22, fontWeight: '800', color: '#1C221A' },
  hero: { alignItems: 'center', marginBottom: 20 },
  heroImage: { width: 130, height: 130 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: 'transparent', ...shadow,
  },
  itemSelected: { borderColor: '#5E7A56', backgroundColor: '#E5EEDF' },
  itemIconCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#F3F5EF',
    alignItems: 'center', justifyContent: 'center',
  },
  itemInfo: { flex: 1 },
  itemTitle: { fontWeight: '700', fontSize: 14, color: '#1C221A' },
  itemDesc: { color: '#96A08F', fontSize: 12, marginTop: 3 },
  itemPrice: { color: '#5E7A56', fontWeight: '800', fontSize: 12.5 },
  empty: { textAlign: 'center', color: '#96A08F', marginTop: 30 },
  nextBtn: {
    backgroundColor: '#5E7A56', borderRadius: 18, padding: 17, alignItems: 'center',
    marginTop: 10, marginBottom: 30, ...shadow,
  },
  nextBtnDisabled: { backgroundColor: '#C6D0BF' },
  nextBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
