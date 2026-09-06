import { type BankId, bankLabel, banksFrom } from './banks';

// Расчёты между клиентом и мастером идут напрямую: наличными при встрече
// либо переводом по СБП на телефон мастера. Сервис денег не касается — он
// лишь показывает клиенту, как мастер принимает оплату, и даёт обеим
// сторонам отметить, что расчёт состоялся. Ни удержать, ни вернуть деньги
// сервис не может, и интерфейс не должен создавать такого впечатления.
//
// Телефон для перевода — тот же, что сервер кладёт в заявку для звонка:
// его видел модератор при проверке, и подменить его на чужой мастер не
// может. Поэтому у мастера здесь настраиваются только банки и наличные.

export type PaymentMethod = 'cash' | 'transfer';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'transfer'];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Наличными',
  transfer: 'Переводом',
};

/** Как мастер принимает оплату. Живёт в masters/{uid}/payment/details. */
export type PaymentDetails = {
  banks: BankId[];
  acceptsCash: boolean;
};

export const EMPTY_PAYMENT_DETAILS: PaymentDetails = { banks: [], acceptsCash: true };

/** Документ есть — читаем; документа нет — null: мастер ещё не настраивал. */
export function paymentDetailsFrom(
  data: Record<string, unknown> | undefined,
): PaymentDetails | null {
  if (!data) return null;
  return {
    banks: banksFrom(data.banks),
    acceptsCash: data.acceptsCash !== false,
  };
}

export function paymentMethodFrom(value: unknown): PaymentMethod | null {
  return PAYMENT_METHODS.includes(value as PaymentMethod) ? (value as PaymentMethod) : null;
}

/** Что сервер скопировал в заявку при выборе мастера. null — не указано. */
export type OrderPaymentTerms = {
  masterBanks?: BankId[] | null;
  masterAcceptsCash?: boolean | null;
};

/**
 * Какие способы предложить клиенту.
 *
 * Мастер, ничего не настроивший, принимает как угодно: перевод по номеру
 * телефона работает и без списка банков, а наличные — тем более. Явный
 * отказ от наличных убирает их из выбора; пустой список банков при явно
 * настроенных реквизитах убирает перевод.
 */
export function availableMethods(terms: OrderPaymentTerms): PaymentMethod[] {
  const configured = terms.masterBanks != null || terms.masterAcceptsCash != null;
  if (!configured) return [...PAYMENT_METHODS];
  const out: PaymentMethod[] = [];
  if (terms.masterAcceptsCash !== false) out.push('cash');
  if ((terms.masterBanks ?? []).length > 0) out.push('transfer');
  // Мастер закрыл всё разом — значит, ошибся в настройке; клиенту всё равно
  // надо как-то платить
  return out.length ? out : [...PAYMENT_METHODS];
}

/** Перечень банков подписью: «Сбербанк, Т-Банк». */
export function banksLine(banks: readonly string[] | null | undefined): string {
  return (banks ?? []).map(bankLabel).join(', ');
}

/** +79991234567 → +7 999 123-45-67; всё остальное — как есть. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 11) return phone;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
}

// Одна фраза на все экраны, где речь о деньгах. Юридически важная: сервис не
// должен выглядеть гарантом сделки — он им не является.
export const PAYMENT_NOTICE =
  'Платите после приёмки работы. domio не участвует в расчётах и не возвращает деньги.';
