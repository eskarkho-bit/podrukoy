// Уровень образования мастера. Список закрытый по той же причине, что и
// специальности: свободный текст в профиле читался бы как попало («высшее»,
// «Высшее образование», «вуз»), а закрытый список показывается одинаково
// у всех и не требует модерации.
//
// Значения хранятся в masters/{uid}.education как есть — это подписи, а не
// ключи: по образованию ничего не ищется и не фильтруется.

export const EDUCATION_LEVELS = ['среднее', 'среднее специальное', 'высшее'] as const;

export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** Приводит то, что пришло из базы, к закрытому списку. Чужое — в null. */
export function educationFrom(value: unknown): EducationLevel | null {
  return EDUCATION_LEVELS.includes(value as EducationLevel) ? (value as EducationLevel) : null;
}
