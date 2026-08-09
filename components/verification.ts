import * as WebBrowser from 'expo-web-browser';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebaseConfig';

// Проверка мастера. Пока она не пройдена, заявок он не видит: в них лежат
// имя, адрес и фотография жилья клиента, и отдавать это любому, кто нажал
// «стать мастером», нельзя. Правила доступа проверяют флаг verified,
// который ставит только модератор.

export type VerificationStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export type Application = {
  phone: string;
  about: string;
  // Снимок лица — Storage, читают только мастер и модератор
  photoUrl: string | null;
  // Карта: приложение видит лишь маску и токен провайдера. Номера карты
  // здесь нет и быть не может — он вводится на стороне банка.
  cardLast4: string | null;
  cardBrand: string | null;
  cardBindingId: string | null;
  status: VerificationStatus;
  rejectionReason: string | null;
  // Редакция согласия на обработку фотографии лица. Пусто — снимать нельзя:
  // это отдельное согласие, а не часть общего.
  biometricConsent: string | null;
  // Ход последней попытки привязки. Пишет только сервер: 'pending' держится,
  // пока банк не ответил, и снимается вебхуком либо сверкой.
  bindingState: BindingState | null;
};

/** Состояние попытки привязки карты. Совпадает с BindingState в функциях. */
export type BindingState = 'pending' | 'succeeded' | 'canceled' | 'failed';

const BINDING_STATES: BindingState[] = ['pending', 'succeeded', 'canceled', 'failed'];

export const EMPTY_APPLICATION: Application = {
  phone: '',
  about: '',
  photoUrl: null,
  cardLast4: null,
  cardBrand: null,
  cardBindingId: null,
  status: 'draft',
  rejectionReason: null,
  biometricConsent: null,
  bindingState: null,
};

export function applicationFrom(data: Record<string, unknown> | undefined): Application {
  if (!data) return EMPTY_APPLICATION;
  const status = data.status;
  return {
    phone: typeof data.phone === 'string' ? data.phone : '',
    about: typeof data.about === 'string' ? data.about : '',
    photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : null,
    cardLast4: typeof data.cardLast4 === 'string' ? data.cardLast4 : null,
    cardBrand: typeof data.cardBrand === 'string' ? data.cardBrand : null,
    cardBindingId: typeof data.cardBindingId === 'string' ? data.cardBindingId : null,
    status: status === 'pending' || status === 'approved' || status === 'rejected'
      ? status
      : 'draft',
    rejectionReason: typeof data.rejectionReason === 'string' ? data.rejectionReason : null,
    biometricConsent: typeof data.biometricConsent === 'string' ? data.biometricConsent : null,
    bindingState: BINDING_STATES.includes(data.bindingState as BindingState)
      ? (data.bindingState as BindingState)
      : null,
  };
}

/** Телефон в виде, пригодном для звонка: только цифры, 11 знаков. */
export function phoneValid(phone: string): boolean {
  return /^\d{11}$/.test(phone.replace(/\D/g, ''));
}

export type CardBindingResult =
  /** Страница банка закрылась успешно — исход подтвердит сервер */
  | 'awaiting'
  | 'cancelled'
  | 'not-configured'
  | 'already-bound'
  | 'failed';

/**
 * Привязка карты.
 *
 * Номер карты вводится на странице платёжного провайдера, а не в приложении:
 * принимать его самим означало бы хранить платёжные данные и подпадать под
 * PCI-DSS. Сюда возвращаются только маска и токен, и записывает их вебхук
 * провайдера — правила Firestore запрещают мастеру писать эти поля самому.
 *
 * Возвращает 'not-configured', пока в функциях не заданы ключи мерчанта.
 *
 * Успех здесь означает только то, что человек дошёл до конца страницы банка.
 * Привязанной карта станет, когда это подтвердит сервер — вебхуком или
 * сверкой. Считать её привязанной по факту закрытия браузера нельзя: оплата
 * могла не пройти, а «успешно» на экране при неудаче — худший вид вранья.
 */
export async function startCardBinding(): Promise<CardBindingResult> {
  try {
    const create = httpsCallable<unknown, {
      confirmationUrl?: string;
      configured?: boolean;
      alreadyBound?: boolean;
    }>(functions, 'createCardBinding');
    const { data } = await create({});

    if (data?.configured === false) return 'not-configured';
    if (data?.alreadyBound) return 'already-bound';
    if (!data?.confirmationUrl) return 'failed';

    // Возврат в приложение по схеме podrukoy:// — она объявлена в app.json
    const result = await WebBrowser.openAuthSessionAsync(
      data.confirmationUrl,
      'podrukoy://card-bound',
    );
    if (result.type !== 'success') return 'cancelled';

    return 'awaiting';
  } catch (e) {
    console.warn('Не удалось начать привязку карты:', e);
    return 'failed';
  }
}
