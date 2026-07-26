import { View, Text, ScrollView, StyleSheet } from 'react-native';

const chats = [
  {
    name: 'Сергей · электрик',
    lastMessage: 'Добрый день! Буду у вас к 15:30.',
    time: '14:02',
    initials: 'С',
  },
];

export default function MessagesScreen() {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Сообщения</Text>

      {chats.map((chat, i) => (
        <View key={i} style={styles.chatItem}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{chat.initials}</Text>
          </View>
          <View style={styles.chatInfo}>
            <Text style={styles.chatName}>{chat.name}</Text>
            <Text style={styles.chatMessage} numberOfLines={1}>{chat.lastMessage}</Text>
          </View>
          <Text style={styles.chatTime}>{chat.time}</Text>
        </View>
      ))}

      <Text style={styles.hint}>
        Здесь будут переписки с мастерами по вашим заказам
      </Text>
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
  chatItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 10, ...shadow,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#E5EEDF',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#5E7A56', fontWeight: '800', fontSize: 16 },
  chatInfo: { flex: 1 },
  chatName: { fontWeight: '700', fontSize: 13.5, color: '#1C221A' },
  chatMessage: { color: '#96A08F', fontSize: 12, marginTop: 2 },
  chatTime: { color: '#96A08F', fontSize: 11 },
  hint: { textAlign: 'center', color: '#96A08F', fontSize: 12, marginTop: 20 },
});
