import {
  collection,
  collectionGroup,
  getCountFromServer,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { CATEGORIES, type Category } from './serviceOptions';
import { SETTLEMENTS, settlementKey } from './cities';

// Сводка для модератора.
//
// Считаем только мастеров: заявки клиентов модератору не видны, и это
// сознательно — мы весь механизм проверки строили ради того, чтобы адрес
// видело как можно меньше людей. Статистика по заявкам появится счётчиками
// на стороне сервера, когда будут развёрнуты функции: тогда модератор увидит
// числа, не получив доступа к самим данным.
//
// Числа берутся агрегатными запросами: сервер возвращает количество, не
// выкачивая документы, — это в разы дешевле, чем считать их на телефоне.

export type Coverage = {
  /** Специальности, по которым нет ни одного проверенного мастера */
  missingCategories: Category[];
  /** Сколько населённых пунктов охвачено хотя бы одним мастером */
  coveredSettlements: number;
  totalSettlements: number;
  /** Есть ли мастер, готовый выезжать куда угодно */
  anyEverywhere: boolean;
  /** Ключи охваченных пунктов — по ним отмечаются города на экране */
  coveredKeys: string[];
};

export type AdminStats = {
  masters: number;
  verified: number;
  pending: number;
  rejected: number;
  coverage: Coverage;
};

// Читать анкеты приходится целиком: покрытие считается по массивам городов и
// специальностей, а их агрегатным запросом не получить. При сотнях мастеров
// это терпимо, при тысячах покрытие надо будет считать на сервере.
const COVERAGE_SCAN_LIMIT = 500;

const countOf = async (q: Parameters<typeof getCountFromServer>[0]) =>
  (await getCountFromServer(q)).data().count;

export async function loadAdminStats(): Promise<AdminStats> {
  const masters = collection(db, 'masters');
  const applications = collectionGroup(db, 'verification');

  const [total, verified, pending, rejected, verifiedDocs] = await Promise.all([
    countOf(query(masters)),
    countOf(query(masters, where('verified', '==', true))),
    countOf(query(applications, where('status', '==', 'pending'))),
    countOf(query(applications, where('status', '==', 'rejected'))),
    getDocs(query(masters, where('verified', '==', true), limit(COVERAGE_SCAN_LIMIT))),
  ]);

  // Пустой список городов у мастера означает «вся республика», пустой список
  // специальностей — «любые работы». Тот же смысл, что и в ленте.
  const coveredCities = new Set<string>();
  const coveredCategories = new Set<string>();
  let anyEverywhere = false;
  let anySpecialist = false;

  verifiedDocs.docs.forEach((d) => {
    const cities: string[] = Array.isArray(d.get('cities'))
      ? d.get('cities')
      : (d.get('city') ? [String(d.get('city'))] : []);
    const skills: string[] = Array.isArray(d.get('skills')) ? d.get('skills') : [];

    if (!cities.length) anyEverywhere = true;
    else cities.forEach((c) => coveredCities.add(c));

    if (!skills.length) anySpecialist = true;
    else skills.forEach((s) => coveredCategories.add(s));
  });

  return {
    masters: total,
    verified,
    pending,
    rejected,
    coverage: {
      missingCategories: anySpecialist
        ? []
        : CATEGORIES.filter((c) => !coveredCategories.has(c)),
      coveredSettlements: anyEverywhere ? SETTLEMENTS.length : coveredCities.size,
      totalSettlements: SETTLEMENTS.length,
      anyEverywhere,
      coveredKeys: [...coveredCities],
    },
  };
}

/** Города республиканского значения — по ним понятнее всего, где пусто. */
export const MAIN_CITIES = SETTLEMENTS
  .filter((s) => s.kind === 'город')
  .map((s) => ({ name: s.name, key: settlementKey(s.name) }));
