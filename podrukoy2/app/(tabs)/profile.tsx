import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ComponentProps } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

// Пункты меню профиля — как в блоке «Почему это удобно» на макете
const menu: { label: string; icon: IconName }[] = [
  { label: 'Мои адреса', icon: 'map-marker-outline' },
  { label: 'Способы оплаты', icon: 'credit-card-outline' },
  { label: 'История работ', icon: 'history' },
  { label: 'Настройки', icon: 'cog-outline' },
];

export default function ProfileScreen() {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Профиль</Text>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>ДВ</Text>
        </View>
        <Text style={styles.name}>Дмитрий</Text>
        <Text style={styles.address}>ул. Ленина, 24</Text>
      </View>

      {menu.map((item, i) => (
        <TouchableOpacity key={i} style={styles.menuItem}>
          <View style={styles.menuIconCircle}>
            <MaterialCommunityIcons name={item.icon} size={18} color="#5E7A56" />
          </View>
          <Text style={styles.menuLabel}>{item.label}</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#A6AFA1" />
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.logoutBtn}>
        <Text style={styles.logoutText}>Выйти</Text>
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
  header: { fontSize: 24, fontWeight: '800', marginBottom: 18, color: '#1C221A' },
  profileCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 26, alignItems: 'center',
    marginBottom: 18, ...shadow,
  },
  avatar: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: '#E5EEDF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  avatarText: { color: '#5E7A56', fontWeight: '800', fontSize: 20 },
  name: { fontWeight: '800', fontSize: 17, color: '#1C221A' },
  address: { color: '#96A08F', fontSize: 12.5, marginTop: 3 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 10, ...shadow,
  },
  menuIconCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#F3F5EF',
    alignItems: 'center', justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontWeight: '700', fontSize: 13.5, color: '#1C221A' },
  logoutBtn: { alignItems: 'center', padding: 14, marginTop: 6 },
  logoutText: { color: '#C05B5B', fontWeight: '700', fontSize: 13.5 },
});
