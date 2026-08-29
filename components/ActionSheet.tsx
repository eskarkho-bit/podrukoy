import { useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeInRight,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { palettes, Palette, useTheme } from '../theme';
import { AnimatedCheck } from './AnimatedCheck';
import { hapticSuccess } from './haptics';
import { PressableScale } from './PressableScale';
import { Glyph, themedIconColors } from './glyphIcons';
import { FONTS } from './typography';
import { hasObjectIcon, ObjectIcon } from './objectIcons';
import { SheetGrabber, useSheetDrag } from './sheetDrag';
import { categoryFor, flowFor, OTHER_LABEL, ServiceType, type Category } from './serviceOptions';
import { newOrderId } from '../firebaseConfig';
import type { SceneObject } from './HouseScene';

export type OrderDraft = {
  // Идентификатор выдаётся при открытии шторки и не меняется до её закрытия.
  // Благодаря этому повторная отправка перезапишет ту же заявку, а не создаст
  // вторую — см. newOrderId().
  id: string;
  title: string;
  comment: string;
  photoUri: string | null;
  // Специальность выводится из объекта дома: клиент её не выбирает, но по ней
  // заявка находит мастеров нужного профиля
  category: Category;
  // Объект дома и вид работы — по ним сервер узнаёт повторяемые услуги
  // (стрижка газона, заточка) и напоминает, когда подойдёт срок. Заголовок
  // для этого не годится: он собран для человека, а не для сравнения.
  objectId: string;
  serviceLabel: string;
  // Повторная заявка приходит с адресом прошлой; без поля берётся активный
  // адрес профиля — путь обычной шторки не меняется
  address?: string;
  // Просьба показать заявку прошлому мастеру первым — ему уйдёт именной пуш
  preferredMasterId?: string | null;
};

type Props = {
  object: SceneObject;
  address: string;
  onClose: () => void;
  // Вызывается после «успеха»: передаём наверх собранную заявку
  onComplete: (draft: OrderDraft) => void;
};

// Шаги мастера: что случилось → уточнение → экран заявки (фото + описание) → готово
type Step = 'type' | 'sub' | 'form' | 'done';

// Нижняя шторка-мастер: фон размывается, карточка поднимается пружиной,
// шаги сменяются лёгким сдвигом — вперёд справа, назад слева.
export function ActionSheet({ object, address, onClose, onComplete }: Props) {
  const { mode, colors: t } = useTheme();
  const styles = themed[mode];
  // Считается заранее: внутри flow.map имя t занято типом работы
  const iconColors = themedIconColors(t);
  const [step, setStep] = useState<Step>('type');
  const [serviceType, setServiceType] = useState<ServiceType | null>(null);
  const [serviceSub, setServiceSub] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // Фото и описание спрятаны за кнопкой «Оставить комментарий»: большинству
  // хватает выбранных пунктов, и форма не встречает их пустыми полями
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Направление последнего перехода — от него зависит, откуда «въезжает» новый шаг
  const [dir, setDir] = useState<'forward' | 'back'>('forward');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Заявка отправлена — второй раз не отправляем
  const submitted = useRef(false);
  // Идентификатор будущей заявки, один на всю жизнь шторки
  const [draftId] = useState(newOrderId);

  const flow = flowFor(object.id);

  // На пути «Другое» описание — суть заявки, без него мастер не поймёт, что
  // случилось: там поле открыто сразу, без кнопки. И уже введённое не должно
  // уходить в заявку невидимым, поэтому непустой комментарий или фото
  // держат блок открытым.
  const detailsForced = serviceType?.subs.length === 0 || serviceSub === OTHER_LABEL;
  const showDetails = detailsForced || detailsOpen || comment.trim() !== '' || photoUri != null;

  // Пока показываем «Заявка создана», шторка закрывается сама — забирать её
  // из-под руки пользователя в этот момент нечестно, поэтому жест выключен
  const { gesture, cardStyle } = useSheetDrag(onClose, step !== 'done');

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const goForward = (next: Step) => {
    setDir('forward');
    setStep(next);
  };

  const goBack = () => {
    setDir('back');
    // При уходе с формы блок сворачивается — на другом пути он не должен
    // встречать открытым. Введённое не теряется: непустой комментарий или
    // фото раскроют его снова, см. showDetails.
    setDetailsOpen(false);
    // «Другое» приходит в форму без шага уточнения — назад ведём тем же путём
    if (step === 'form' && serviceType && serviceType.subs.length > 0) {
      setStep('sub');
    } else {
      setServiceSub(null);
      setStep('type');
    }
  };

  const pickType = (t: ServiceType) => {
    setServiceType(t);
    goForward(t.subs.length > 0 ? 'sub' : 'form');
  };

  const pickSub = (s: string) => {
    setServiceSub(s);
    goForward('form');
  };

  const addPhoto = async (source: 'camera' | 'library') => {
    try {
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch {
      // Камера недоступна (например, в браузере без разрешения) — тихо предлагаем галерею
      if (source === 'camera') addPhoto('library');
    }
  };

  const submit = () => {
    // Два быстрых нажатия успевают пройти до перерисовки, потому что setState
    // асинхронен, — и планировали два таймера, то есть две заявки. Флаг
    // синхронный, поэтому ловит и это.
    if (submitted.current) return;
    submitted.current = true;

    hapticSuccess();
    goForward('done');
    // Даём «галочке» отыграть, затем закрываем и создаём заявку
    timer.current = setTimeout(() => {
      onComplete({
        id: draftId,
        // У пути через «Другое» уточнения нет — пустые части не попадают в заголовок
        title: [object.title, serviceType?.label, serviceSub].filter(Boolean).join(' · '),
        comment: comment.trim(),
        photoUri,
        category: categoryFor(object.id),
        objectId: object.id,
        serviceLabel: serviceType?.label ?? OTHER_LABEL,
      });
    }, 1400);
  };

  const enterAnim = (i = 0) =>
    (dir === 'forward' ? FadeInRight : FadeInLeft).delay(60 + i * 55).duration(300);

  const stepTitle =
    step === 'type'
      ? 'Что случилось?'
      : step === 'sub'
        ? (serviceType?.label ?? '')
        : 'Опишите задачу';

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      {/* Затемнение и блюр появляются мягко, тап по фону закрывает шторку */}
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
          onPress={step === 'done' ? undefined : onClose}
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
            {/* Стрелка назад появляется, когда есть куда возвращаться */}
            {step === 'sub' || step === 'form' ? (
              <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
                <PressableScale style={styles.backBtn} onPress={goBack}>
                  <Text style={styles.backBtnText}>‹</Text>
                </PressableScale>
              </Animated.View>
            ) : (
              <View style={styles.iconCircle}>
                {hasObjectIcon(object.id) ? (
                  // Цвета иконки — из темы: кружок шторки в тёмной теме тёмный,
                  // и зелень сцены на нём потерялась бы
                  <ObjectIcon
                    id={object.id}
                    size={28}
                    colors={{ stroke: t.accent, fill: t.accentSoft, glass: t.blue }}
                  />
                ) : (
                  <Text style={styles.icon}>{object.icon}</Text>
                )}
              </View>
            )}
            <View style={styles.headerText}>
              <Text style={styles.title}>{object.title}</Text>
              {/* «Хлебные крошки» пути: копятся по мере выбора */}
              <Text style={styles.subtitle} numberOfLines={1}>
                {step === 'type'
                  ? `${object.place} · ${address}`
                  : [serviceType?.label, serviceSub].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </Animated.View>

          {step === 'done' ? (
            <Animated.View
              entering={ZoomIn.springify().damping(14).stiffness(180)}
              style={styles.doneWrap}
            >
              <View style={styles.checkCircle}>
                <AnimatedCheck size={30} color={t.accent} />
              </View>
              <Text style={styles.doneTitle}>Заявка создана</Text>
              <Text style={styles.doneSub}>Мастер скоро свяжется с вами</Text>
            </Animated.View>
          ) : (
            // key по шагу: старый контент растворяется, новый въезжает по направлению
            <Animated.View key={step} exiting={FadeOut.duration(140)}>
              <Animated.Text entering={enterAnim(0)} style={styles.stepTitle}>
                {stepTitle}
              </Animated.Text>

              {step === 'type' &&
                flow.map((t, i) => (
                  <Animated.View key={t.label} entering={enterAnim(i + 1)}>
                    <PressableScale style={styles.option} onPress={() => pickType(t)}>
                      <View style={styles.optionIconWrap}>
                        <Glyph
                          glyph={t.icon}
                          size={18}
                          colors={iconColors}
                          textStyle={styles.optionIcon}
                        />
                      </View>
                      <Text style={styles.optionText}>{t.label}</Text>
                      <Text style={styles.chevron}>›</Text>
                    </PressableScale>
                  </Animated.View>
                ))}

              {step === 'sub' &&
                serviceType?.subs.map((s, i) => (
                  <Animated.View key={s} entering={enterAnim(i + 1)}>
                    <PressableScale style={styles.option} onPress={() => pickSub(s)}>
                      <Text style={[styles.optionText, styles.optionTextNoIcon]}>{s}</Text>
                      <Text style={styles.chevron}>›</Text>
                    </PressableScale>
                  </Animated.View>
                ))}

              {step === 'form' && !showDetails && (
                <Animated.View entering={enterAnim(1)}>
                  <PressableScale style={styles.detailsBtn} onPress={() => setDetailsOpen(true)}>
                    <Glyph glyph="💬" size={22} colors={iconColors} style={styles.photoBtnIcon} />
                    <Text style={styles.photoBtnText}>Оставить комментарий</Text>
                  </PressableScale>
                </Animated.View>
              )}

              {step === 'form' && showDetails && (
                <>
                  {/* Фото: превью с возможностью убрать — или две кнопки добавления */}
                  <Animated.View entering={enterAnim(1)}>
                    {photoUri ? (
                      <View style={styles.photoWrap}>
                        <Image source={{ uri: photoUri }} style={styles.photo} />
                        <PressableScale
                          style={styles.photoRemove}
                          onPress={() => setPhotoUri(null)}
                        >
                          <Text style={styles.photoRemoveText}>✕</Text>
                        </PressableScale>
                      </View>
                    ) : (
                      <View style={styles.photoRow}>
                        <PressableScale style={styles.photoBtn} onPress={() => addPhoto('camera')}>
                          <Glyph
                            glyph="📷"
                            size={24}
                            colors={iconColors}
                            style={styles.photoBtnIcon}
                          />
                          <Text style={styles.photoBtnText}>Сфотографировать</Text>
                        </PressableScale>
                        <PressableScale style={styles.photoBtn} onPress={() => addPhoto('library')}>
                          <Glyph
                            glyph="🖼️"
                            size={24}
                            colors={iconColors}
                            style={styles.photoBtnIcon}
                          />
                          <Text style={styles.photoBtnText}>Из галереи</Text>
                        </PressableScale>
                      </View>
                    )}
                  </Animated.View>

                  <Animated.View entering={enterAnim(2)}>
                    <TextInput
                      style={styles.commentInput}
                      value={comment}
                      onChangeText={setComment}
                      placeholder="Расскажите, что конкретно нужно сделать…"
                      placeholderTextColor={t.textMuted}
                      multiline
                    />
                  </Animated.View>
                </>
              )}

              {step === 'form' && (
                <Animated.View entering={enterAnim(showDetails ? 3 : 2)}>
                  <PressableScale style={[styles.option, styles.submit]} onPress={submit}>
                    <Text style={styles.submitText}>Отправить заявку</Text>
                  </PressableScale>
                  {/* Информированность по 152-ФЗ: человек должен видеть,
                      кому уйдут адрес и фото, в момент действия, а не
                      только в политике конфиденциальности */}
                  <Text style={styles.privacyHint}>
                    Адрес, описание и фото увидят проверенные мастера вашего города — так они смогут
                    назвать цену
                  </Text>
                </Animated.View>
              )}
            </Animated.View>
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
    icon: { fontSize: 22 },
    backBtn: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: t.chip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backBtnText: { fontSize: 24, color: t.accent, fontWeight: '700', marginTop: -2 },
    title: { fontSize: 17, fontFamily: FONTS.heading, color: t.text },
    subtitle: { fontSize: 12, color: t.textMuted, fontWeight: '600', marginTop: 2 },
    stepTitle: { fontSize: 13, fontWeight: '800', color: t.textSoft, marginBottom: 10 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
      marginBottom: 9,
    },
    optionIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: t.chip,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 11,
    },
    optionIcon: { fontSize: 15 },
    optionText: { flex: 1, fontWeight: '700', fontSize: 14.5, color: t.text },
    optionTextNoIcon: { paddingVertical: 2 },
    chevron: { fontSize: 18, color: t.textMuted, fontWeight: '600' },
    detailsBtn: {
      alignItems: 'center',
      borderRadius: 16,
      paddingVertical: 14,
      backgroundColor: t.soft,
      borderWidth: 1,
      borderColor: t.border,
      borderStyle: 'dashed',
      marginBottom: 9,
    },
    photoRow: { flexDirection: 'row', gap: 9, marginBottom: 9 },
    photoBtn: {
      flex: 1,
      alignItems: 'center',
      borderRadius: 16,
      paddingVertical: 14,
      backgroundColor: t.soft,
      borderWidth: 1,
      borderColor: t.border,
      borderStyle: 'dashed',
    },
    photoBtnIcon: { fontSize: 20, marginBottom: 4 },
    photoBtnText: { fontWeight: '700', fontSize: 11.5, color: t.accent },
    photoWrap: { marginBottom: 9 },
    photo: { width: '100%', height: 150, borderRadius: 16, backgroundColor: t.chip },
    photoRemove: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: t.overlay,
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoRemoveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
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
    submit: { backgroundColor: t.accent, borderColor: t.accent, justifyContent: 'center' },
    submitText: {
      fontWeight: '700',
      fontSize: 14.5,
      color: t.onAccent,
      textAlign: 'center',
      flex: 1,
    },
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
    check: { fontSize: 26, color: t.accent, fontWeight: '800' },
    doneTitle: { fontSize: 16, fontWeight: '800', color: t.text },
    doneSub: { fontSize: 12.5, color: t.textMuted, fontWeight: '600', marginTop: 3 },
  });

const themed = { light: makeStyles(palettes.light), dark: makeStyles(palettes.dark) };
