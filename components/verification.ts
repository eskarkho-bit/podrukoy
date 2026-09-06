// Проверка мастера. Пока она не пройдена, заявок он не видит: в них лежат
// имя, адрес и фотография жилья клиента, и отдавать это любому, кто нажал
// «стать мастером», нельзя. Правила доступа проверяют флаг verified,
// который ставит только модератор.
//
// Проверяются две вещи: снимок лица, сделанный камерой при заполнении, и
// телефон, по которому модератор может позвонить. Привязка банковской карты
// через платёжного провайдера была третьей и ушла вместе с провайдером:
// расчёты идут мимо сервиса, и карта ему больше не нужна ни как
// подтверждение личности, ни как адрес выплат.

export type VerificationStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export type Application = {
  phone: string;
  about: string;
  // Снимок лица — Storage, читают только мастер и модератор
  photoUrl: string | null;
  status: VerificationStatus;
  rejectionReason: string | null;
  // Причина отстранения. Лежит здесь, а не в мировой анкете: её видят
  // только сам мастер и модератор. Пишет только сервер.
  blockedReason: string | null;
  // Редакция согласия на обработку фотографии лица. Пусто — снимать нельзя:
  // это отдельное согласие, а не часть общего.
  biometricConsent: string | null;
};

export const EMPTY_APPLICATION: Application = {
  phone: '',
  about: '',
  photoUrl: null,
  status: 'draft',
  rejectionReason: null,
  blockedReason: null,
  biometricConsent: null,
};

// Поля старых заявок (маска карты, токен провайдера, состояние привязки)
// здесь не читаются: документ мог их сохранить, экрану они не нужны.
export function applicationFrom(data: Record<string, unknown> | undefined): Application {
  if (!data) return EMPTY_APPLICATION;
  const status = data.status;
  return {
    phone: typeof data.phone === 'string' ? data.phone : '',
    about: typeof data.about === 'string' ? data.about : '',
    photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : null,
    status:
      status === 'pending' || status === 'approved' || status === 'rejected' ? status : 'draft',
    rejectionReason: typeof data.rejectionReason === 'string' ? data.rejectionReason : null,
    blockedReason: typeof data.blockedReason === 'string' ? data.blockedReason : null,
    biometricConsent: typeof data.biometricConsent === 'string' ? data.biometricConsent : null,
  };
}

/** Телефон в виде, пригодном для звонка: только цифры, 11 знаков. */
export function phoneValid(phone: string): boolean {
  return /^\d{11}$/.test(phone.replace(/\D/g, ''));
}
