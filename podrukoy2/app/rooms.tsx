import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Platform, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

import bathImage from '@/assets/images/3d/bath.png';
import doorImage from '@/assets/images/3d/door.png';
import heatingImage from '@/assets/images/3d/heating.png';
import kitchenImage from '@/assets/images/3d/kitchen.png';
import lightImage from '@/assets/images/3d/light.png';
import roomsImage from '@/assets/images/3d/rooms.png';
import socketImage from '@/assets/images/3d/socket.png';
import switchImage from '@/assets/images/3d/switch.png';
import toolboxImage from '@/assets/images/3d/toolbox.png';
import windowImage from '@/assets/images/3d/window.png';

const categories = [
  { id: 'light', label: 'Свет', image: lightImage },
  { id: 'sockets', label: 'Розетки', image: socketImage },
  { id: 'switches', label: 'Выключатели', image: switchImage },
  { id: 'bathroom', label: 'Ванная', image: bathImage },
  { id: 'kitchen', label: 'Кухня', image: kitchenImage },
  { id: 'heating', label: 'Отопление', image: heatingImage },
  { id: 'doors', label: 'Двери', image: doorImage },
  { id: 'windows', label: 'Окна', image: windowImage },
  { id: 'other', label: 'Другое', image: toolboxImage },
];

export default function RoomsScreen() {
  const router = useRouter();

  // Разрез дома плавно проявляется при открытии экрана —
  // получается красивый переход «дом снаружи → дом изнутри»
  const heroAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(heroAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [heroAnim]);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.topbar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Что случилось?</Text>
      </View>

      <Animated.View
        style={[
          styles.heroCard,
          {
            opacity: heroAnim,
            transform: [
              { scale: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            ],
          },
        ]}
      >
        <Image source={roomsImage} style={styles.heroImage} contentFit="contain" />
        <Text style={styles.heroCaption}>Выберите комнату или систему</Text>
      </Animated.View>

      <View style={styles.grid}>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={styles.catBtn}
            onPress={() =>
              router.push({ pathname: '/services', params: { categoryId: cat.id, categoryLabel: cat.label } })
            }
          >
            <Image source={cat.image} style={styles.catImage} contentFit="contain" />
            <Text style={styles.catLabel}>{cat.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
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
  heroCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 16, alignItems: 'center',
    marginBottom: 16, overflow: 'hidden', ...shadow,
  },
  heroImage: { width: 250, height: 200, borderRadius: 16 },
  heroCaption: { color: '#96A08F', fontWeight: '600', fontSize: 12.5, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  catBtn: {
    width: '31%',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    ...shadow,
  },
  catImage: { width: 44, height: 44 },
  catLabel: { fontWeight: '700', fontSize: 12, color: '#1C221A' },
});
