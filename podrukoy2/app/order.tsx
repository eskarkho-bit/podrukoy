import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

import { IconName, useOrders } from '@/components/orders-context';

// Варианты доступа перебираются по нажатию на строку
const accessOptions = ['Я буду дома', 'Ключи у соседей', 'Открою по звонку'];

// Русские подписи без Intl — работает одинаково на всех платформах
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const MINUTES = [0, 15, 30, 45];

function dayLabel(d: Date, i: number) {
  if (i === 0) return 'Сегодня';
  if (i === 1) return 'Завтра';
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export default function OrderScreen() {
  const router = useRouter();
  const { title, desc, price, icon, categoryLabel } = useLocalSearchParams<{
    title: string; desc: string; price: string; icon: string; categoryLabel: string;
  }>();
  const { addOrder } = useOrders();

  const [description, setDescription] = useState(desc ?? '');
  const [quantity, setQuantity] = useState(1);
  const [accessIndex, setAccessIndex] = useState(0);
  const [comment, setComment] = useState('');

  // Выбор времени: день (неделя вперёд), час и минуты
  const [dayIndex, setDayIndex] = useState(0);
  const [hour, setHour] = useState(15);
  const [minute, setMinute] = useState(0);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        return d;
      }),
    []
  );

  const timeLabel = `${dayLabel(days[dayIndex], dayIndex)}, ${hour}:${String(minute).padStart(2, '0')}`;

  // Предварительная цена = цена услуги × количество
  const total = (Number(price) || 0) * quantity;

  // Сохраняем заказ в Firestore — он появится на главной и в «Заказах».
  // Не ждём подтверждения сервера: запись видна сразу (latency compensation),
  // а при отказе (нет прав, нет сети надолго) покажем предупреждение.
  const submit = () => {
    addOrder({
      title: title ?? 'Заказ',
      date: timeLabel,
      status: 'Ищем специалиста',
      icon: (icon as IconName) || 'toolbox-outline',
      category: categoryLabel ?? '',
      description: description.trim(),
      comment: comment.trim(),
      access: accessOptions[accessIndex],
      quantity,
      price: total,
    }).catch((err) => {
      console.warn('Не удалось сохранить заказ в Firestore:', err);
      Alert.alert('Не получилось сохранить заказ', 'Проверьте подключение и попробуйте ещё раз.');
    });
    router.push('/order-success');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.topbar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.header}>{title}</Text>
      </View>

      {/* Фото проблемы — пока заглушка с камерой */}
      <TouchableOpacity style={styles.photoCard}>
        <MaterialCommunityIcons name="camera-plus-outline" size={32} color="#96A08F" />
        <Text style={styles.photoText}>Добавить фото</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Описание проблемы</Text>
      <TextInput
        style={styles.input}
        value={description}
        onChangeText={setDescription}
        placeholder="Опишите, что случилось"
        placeholderTextColor="#96A08F"
        multiline
      />

      {/* Количество: − 1 + */}
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Количество</Text>
        <View style={styles.stepper}>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => setQuantity(Math.max(1, quantity - 1))}
          >
            <MaterialCommunityIcons name="minus" size={18} color="#1C221A" />
          </TouchableOpacity>
          <Text style={styles.stepValue}>{quantity}</Text>
          <TouchableOpacity style={styles.stepBtn} onPress={() => setQuantity(quantity + 1)}>
            <MaterialCommunityIcons name="plus" size={18} color="#1C221A" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Нажатие перебирает варианты по кругу */}
      <TouchableOpacity
        style={styles.row}
        onPress={() => setAccessIndex((accessIndex + 1) % accessOptions.length)}
      >
        <Text style={styles.rowLabel}>Доступ к объекту</Text>
        <View style={styles.rowValueWrap}>
          <Text style={styles.rowValue}>{accessOptions[accessIndex]}</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color="#96A08F" />
        </View>
      </TouchableOpacity>

      {/* Выбор дня и времени */}
      <Text style={styles.label}>Когда удобно</Text>
      <View style={styles.pickerCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipsRow}>
            {days.map((d, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.chip, dayIndex === i && styles.chipSelected]}
                onPress={() => setDayIndex(i)}
              >
                <Text style={[styles.chipText, dayIndex === i && styles.chipTextSelected]}>
                  {dayLabel(d, i)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.pickerSub}>Час</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipsRow}>
            {HOURS.map((h) => (
              <TouchableOpacity
                key={h}
                style={[styles.chip, hour === h && styles.chipSelected]}
                onPress={() => setHour(h)}
              >
                <Text style={[styles.chipText, hour === h && styles.chipTextSelected]}>{h}:00</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.pickerSub}>Минуты</Text>
        <View style={styles.chipsRow}>
          {MINUTES.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.chip, minute === m && styles.chipSelected]}
              onPress={() => setMinute(m)}
            >
              <Text style={[styles.chipText, minute === m && styles.chipTextSelected]}>
                :{String(m).padStart(2, '0')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.pickerSummary}>
          <MaterialCommunityIcons name="clock-outline" size={16} color="#5E7A56" />
          <Text style={styles.pickerSummaryText}>{timeLabel}</Text>
        </View>
      </View>

      <Text style={styles.label}>Комментарий мастеру</Text>
      <TextInput
        style={styles.input}
        value={comment}
        onChangeText={setComment}
        placeholder="Напишите, если есть пожелания"
        placeholderTextColor="#96A08F"
        multiline
      />

      <View style={styles.priceRow}>
        <Text style={styles.priceLabel}>Предварительная цена</Text>
        <Text style={styles.priceValue}>от {total} ₽</Text>
      </View>

      <TouchableOpacity style={styles.submitBtn} onPress={submit}>
        <Text style={styles.submitBtnText}>Отправить заказ</Text>
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
  header: { fontSize: 19, fontWeight: '800', flex: 1, color: '#1C221A' },
  photoCard: {
    backgroundColor: '#fff', borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 36, marginBottom: 18, gap: 6, ...shadow,
  },
  photoText: { color: '#96A08F', fontWeight: '600', fontSize: 12.5 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8, color: '#1C221A' },
  input: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, fontSize: 13.5,
    marginBottom: 16, minHeight: 48, color: '#1C221A', ...shadow,
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 16, ...shadow,
  },
  rowLabel: { fontWeight: '700', fontSize: 13, color: '#1C221A' },
  rowValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rowValue: { color: '#5E7A56', fontWeight: '600', fontSize: 12.5 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#F3F5EF',
    alignItems: 'center', justifyContent: 'center',
  },
  stepValue: { fontWeight: '800', fontSize: 14, minWidth: 18, textAlign: 'center', color: '#1C221A' },
  pickerCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 14, marginBottom: 16, ...shadow,
  },
  pickerSub: { fontSize: 11.5, fontWeight: '700', color: '#96A08F', marginTop: 12, marginBottom: 6 },
  chipsRow: { flexDirection: 'row', gap: 8 },
  chip: {
    backgroundColor: '#F3F5EF', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  chipSelected: { backgroundColor: '#5E7A56' },
  chipText: { fontWeight: '700', fontSize: 12.5, color: '#7A857A' },
  chipTextSelected: { color: '#fff' },
  pickerSummary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#E5EEDF', borderRadius: 12, paddingVertical: 9, marginTop: 14,
  },
  pickerSummaryText: { color: '#5E7A56', fontWeight: '700', fontSize: 12.5 },
  priceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8, marginBottom: 14, paddingHorizontal: 4,
  },
  priceLabel: { fontWeight: '700', fontSize: 13.5, color: '#1C221A' },
  priceValue: { fontWeight: '800', fontSize: 17, color: '#1C221A' },
  submitBtn: {
    backgroundColor: '#5E7A56', borderRadius: 18, padding: 17, alignItems: 'center',
    marginBottom: 30, ...shadow,
  },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
