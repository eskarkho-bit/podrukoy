// Банки, в которые мастер принимает переводы по СБП.
//
// Список закрытый по той же причине, что и образование: свободный текст
// («сбер», «Сбербанк», «Сбер») читался бы у каждого по-своему, а клиенту в
// приложении своего банка нужно выбрать получателя из списка — там названия
// стандартные. Идентификаторы хранятся в базе как есть; тот же перечень
// продублирован в правилах Firestore (validBanks), и менять их надо вместе.
//
// Номера карт здесь нет намеренно: перевод по СБП идёт по телефону, а
// номер карты — платёжные данные, которые сервису хранить незачем.

export const BANKS = [
  { id: 'sber', label: 'Сбербанк' },
  { id: 'tbank', label: 'Т-Банк' },
  { id: 'vtb', label: 'ВТБ' },
  { id: 'alfa', label: 'Альфа-Банк' },
  { id: 'akbars', label: 'Ак Барс Банк' },
  { id: 'gazprom', label: 'Газпромбанк' },
  { id: 'raiffeisen', label: 'Райффайзен Банк' },
  { id: 'sovcom', label: 'Совкомбанк' },
  { id: 'ozon', label: 'Озон Банк' },
  { id: 'yandex', label: 'Яндекс Банк' },
  { id: 'psb', label: 'ПСБ' },
  { id: 'mts', label: 'МТС Банк' },
  { id: 'pochta', label: 'Почта Банк' },
  { id: 'rshb', label: 'Россельхозбанк' },
  { id: 'otp', label: 'ОТП Банк' },
  { id: 'uralsib', label: 'Уралсиб' },
] as const;

export type BankId = (typeof BANKS)[number]['id'];

export const BANK_IDS: readonly BankId[] = BANKS.map((b) => b.id);

/** Подпись банка по идентификатору; чужой идентификатор — как есть. */
export function bankLabel(id: string): string {
  return BANKS.find((b) => b.id === id)?.label ?? id;
}

/** Приводит то, что пришло из базы, к закрытому списку: чужое выбрасывается. */
export function banksFrom(value: unknown): BankId[] {
  if (!Array.isArray(value)) return [];
  const known = value.filter((v): v is BankId => BANK_IDS.includes(v as BankId));
  // Порядок — как в списке, а не как сохранили: так одинаково у всех
  return BANK_IDS.filter((id) => known.includes(id));
}
