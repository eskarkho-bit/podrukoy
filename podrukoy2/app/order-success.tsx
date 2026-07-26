import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

import { IconName } from '@/components/orders-context';

// Этапы заказа; done — уже пройденные
const steps: { label: string; icon: IconName; done: boolean }[] = [
  { label: 'Заказ отправлен', icon: 'send', done: true },
  { label: 'Подбираем специалиста', icon: 'account-search-outline', done: true },
  { label: 'Специалист найден', icon: 'account-check-outline', done: false },
  { label: 'Специалист в пути', icon: 'truck-fast-outline', done: false },
  { label: 'Выполнение заказа', icon: 'hammer-wrench', done: false },
  { label: 'Заказ выполнен', icon: 'check-circle-outline', done: false },
];

export default function OrderSuccessScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.checkCircle}>
        <MaterialCommunityIcons name="check" size={36} color="#fff" />
      </View>

      <Text style={styles.title}>Ваш заказ принят!</Text>
      <Text style={styles.subtitle}>
        Мы подбираем подходящего{'\n'}специалиста рядом с вами
      </Text>

      <View style={styles.timelineCard}>
        {steps.map((step, i) => (
          <View key={i} style={styles.stepRow}>
            {/* Кружок с иконкой + вертикальная линия до следующего шага */}
            <View style={styles.stepLeft}>
              <View style={[styles.stepCircle, step.done && styles.stepCircleDone]}>
                <MaterialCommunityIcons
                  name={step.icon}
                  size={16}
                  color={step.done ? '#fff' : '#96A08F'}
                />
              </View>
              {i < steps.length - 1 && (
                <View style={[styles.stepLine, step.done && steps[i + 1].done && styles.stepLineDone]} />
              )}
            </View>
            <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]}>{step.label}</Text>
          </View>
        ))}
      </View>

      {/* replace — чтобы кнопкой «назад» нельзя было вернуться в форму заказа */}
      <TouchableOpacity style={styles.homeBtn} onPress={() => router.replace('/')}>
        <Text style={styles.homeBtnText}>Вернуться на главную</Text>
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
  container: { flex: 1, backgroundColor: '#F3F5EF' },
  content: { padding: 20, paddingTop: 80, paddingBottom: 40, alignItems: 'center' },
  checkCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#5E7A56',
    alignItems: 'center', justifyContent: 'center', marginBottom: 18, ...shadow,
  },
  title: { fontSize: 23, fontWeight: '800', textAlign: 'center', marginBottom: 10, color: '#1C221A' },
  subtitle: {
    textAlign: 'center', color: '#96A08F', fontSize: 13.5, lineHeight: 20, marginBottom: 26,
  },
  timelineCard: {
    backgroundColor: '#fff', borderRadius: 22, paddingVertical: 22, paddingHorizontal: 26,
    alignSelf: 'stretch', marginBottom: 26, ...shadow,
  },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start' },
  stepLeft: { alignItems: 'center', marginRight: 14 },
  stepCircle: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F5EF',
    alignItems: 'center', justifyContent: 'center',
  },
  stepCircleDone: { backgroundColor: '#5E7A56' },
  stepLine: { width: 2, height: 24, backgroundColor: '#E8ECE3', marginVertical: 3 },
  stepLineDone: { backgroundColor: '#5E7A56' },
  stepLabel: { fontSize: 13.5, fontWeight: '600', color: '#96A08F', paddingTop: 7 },
  stepLabelDone: { color: '#1C221A', fontWeight: '700' },
  homeBtn: {
    backgroundColor: '#5E7A56', borderRadius: 18, padding: 17, alignItems: 'center',
    alignSelf: 'stretch', ...shadow,
  },
  homeBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
