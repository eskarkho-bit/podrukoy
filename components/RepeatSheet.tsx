import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { palettes, Palette, useTheme } from '../theme';
import { AnimatedCheck } from './AnimatedCheck';
import { hapticSuccess } from './haptics';
import { PressableScale } from './PressableScale';
import { Glyph, themedIconColors } from './glyphIcons';
import { FONTS } from './typography';
import { hasObjectIcon, ObjectIcon } from './objectIcons';
import { SheetGrabber, useSheetDrag } from './sheetDrag';
import { categoryFor } from './serviceOptions';
import { newOrderId } from '../firebaseConfig';
import type { OrderDraft } from './ActionSheet';
import type { Order } from '../screens/OrdersScreen';

// Повторная заявка: та же работа, тот же адрес, два касания.
//
// Дом — хорошая витрина и медленный инструмент: постоянному клиенту незачем
// снова искать газон на изометрии и проходить три шага. Здесь всё уже
// заполнено прошлой заявкой, а если её делал мастер — можно позвать его
// первым: ему уйдёт именной пуш, но заявка остаётся открытой для всех,
// и цены по-прежнему конкурируют.

type Props = {
  order: Order;
  onClose: () => void;
  // Вызывается после «успеха» — с собранным черновиком новой заявки
  onSubmit: (draft: OrderDraft) => void;
};

export function RepeatSheet({ order, onClose, onSubmit }: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  const [comment, setComment] = useState(order.comment ?? '');
  // Прошлый мастер зовётся по умолчанию: раз работу подтвердили, им довольны
  const canCallMaster = !!order.masterId && !!order.masterName;
  const [callMaster, setCallMaster] = useState(canCallMaster);
  const [done, setDone] = useState(false);
  const submitted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Идентификатор будущей заявки один на всю жизнь шторки: повторное нажатие
  // перезапишет ту же заявку, а не создаст вторую
  const [draftId] = useState(newOrderId);

  const { gesture, cardStyle } = useSheetDrag(onClose, !done);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Без объекта и вида работы повторять нечего — кнопка в OrderSheet
  // прячется раньше, это лишь страховка от прямого вызова
  const objectId = order.objectId;
  const serviceLabel = order.serviceLabel;
  if (!objectId || !serviceLabel) return null;

  const submit = () => {
    if (submitted.current) return;
    submitted.current = true;

    hapticSuccess();
    setDone(true);
    timer.current = setTimeout(() => {
      onSubmit({
        id: draftId,
        title: order.title,
        comment: comment.trim(),
        // Фото прошлой поломки к новой не прикладываем: оно про тот случай
        photoUri: null,
        category: categoryFor(objectId),
        objectId,
        serviceLabel,
        address: order.address,
        preferredMasterId: callMaster && order.masterId ? order.masterId : null,
      });
    }, 1200);
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      <Animated.View
        entering={FadeIn.duration(260)}
        exiting={FadeOut.duration(220)}
        style={StyleSheet.absoluteFill}
      >
        <BlurView
          intensity={26}
          tint={mode === 'dark' ? 'dark' : 'light'}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          style={[StyleSheet.absoluteFill, styles.dim]}
          onPress={done ? undefined : onClose}
        />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <Animated.View
          entering={SlideInDown.springify().damping(19).stiffness(150).mass(1)}
          exiting={SlideOutDown.duration(280)}
          layout={LinearTransition.springify().damping(20).stiffness(170)}
          style={[styles.card, cardStyle]}
        >
          <SheetGrabber gesture={gesture} />

          <Animated.View entering={FadeIn.delay(90).duration(280)} style={styles.header}>
            <View style={styles.iconCircle}>
              {hasObjectIcon(objectId) ? (
                <ObjectIcon
                  id={objectId}
                  size={28}
                  colors={{ stroke: t.accent, fill: t.accentSoft, glass: t.blue }}
                />
              ) : (
                <Glyph glyph="🔄" size={22} colors={themedIconColors(t)} />
              )}
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>{order.title}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                Повторная заявка{order.address ? ` · ${order.address}` : ''}
              </Text>
            </View>
          </Animated.View>

          {done ? (
            <Animated.View
              entering={ZoomIn.springify().damping(14).stiffness(180)}
              style={styles.doneWrap}
            >
              <View style={styles.checkCircle}>
                <AnimatedCheck size={30} color={t.accent} />
              </View>
              <Text style={styles.doneTitle}>Заявка создана</Text>
              <Text style={styles.doneSub}>
                {callMaster && order.masterName
                  ? `${order.masterName} узнает о ней первым`
                  : 'Мастера вашего города уже видят её'}
              </Text>
            </Animated.View>
          ) : (
            <>
              {canCallMaster && (
                <Animated.View entering={FadeInDown.delay(120).duration(300)}>
                  <View style={styles.masterRow}>
                    <View style={styles.masterIconWrap}>
                      <Glyph glyph="🧑‍🔧" size={18} colors={themedIconColors(t)} />
                    </View>
                    <View style={styles.masterText}>
                      <Text style={styles.masterTitle}>Позвать {order.masterName}</Text>
                      <Text style={styles.masterSub}>
                        Прошлый мастер узнает о заявке первым. Выбирать всё равно вам.
                      </Text>
                    </View>
                    <Switch
                      value={callMaster}
                      onValueChange={setCallMaster}
                      trackColor={{ false: t.toggleOff, true: t.accent }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                </Animated.View>
              )}

              <Animated.View entering={FadeInDown.delay(160).duration(300)}>
                <TextInput
                  style={styles.commentInput}
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Что нужно сделать в этот раз…"
                  placeholderTextColor={t.textMuted}
                  multiline
                />
              </Animated.View>

              <Animated.View entering={FadeInDown.delay(200).duration(300)}>
                <PressableScale style={styles.submit} onPress={submit}>
                  <Text style={styles.submitText}>Отправить заявку</Text>
                </PressableScale>
                <Text style={styles.privacyHint}>
                  Адрес и описание увидят проверенные мастера вашего города — так они смогут назвать
                  цену
                </Text>
              </Animated.View>
            </>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: { justifyContent: 'flex-end' },
    dim: { backgroundColor: t.dim },
    card: {
      margin: 12,
      borderRadius: 28,
      backgroundColor: t.card,
      padding: 20,
      paddingBottom: 26,
      shadowColor: t.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    headerText: { flex: 1 },
    iconCircle: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: t.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontSize: 17, fontFamily: FONTS.heading, color: t.text },
    subtitle: { fontSize: 12, color: t.textMuted, fontWeight: '600', marginTop: 2 },
    masterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: t.soft,
      borderWidth: 1,
      borderColor: t.accentBorder,
      marginBottom: 9,
    },
    masterIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: t.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    masterText: { flex: 1 },
    masterTitle: { fontWeight: '700', fontSize: 13.5, color: t.text },
    masterSub: {
      fontSize: 11,
      fontWeight: '600',
      color: t.textMuted,
      marginTop: 2,
      lineHeight: 15,
    },
    commentInput: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.inputBg,
      padding: 13,
      minHeight: 76,
      textAlignVertical: 'top',
      fontSize: 13.5,
      color: t.text,
      fontWeight: '600',
      marginBottom: 9,
    },
    submit: {
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: t.accent,
      alignItems: 'center',
    },
    submitText: { fontWeight: '700', fontSize: 14.5, color: t.onAccent, textAlign: 'center' },
    privacyHint: {
      fontSize: 11,
      fontWeight: '600',
      color: t.textMuted,
      textAlign: 'center',
      lineHeight: 15,
      marginTop: 8,
      paddingHorizontal: 6,
    },
    doneWrap: { alignItems: 'center', paddingVertical: 18 },
    checkCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    doneTitle: { fontSize: 16, fontWeight: '800', color: t.text },
    doneSub: { fontSize: 12.5, color: t.textMuted, fontWeight: '600', marginTop: 3 },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
