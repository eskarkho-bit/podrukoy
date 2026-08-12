// Сторож против «правила поменяли, выкатить забыли».
//
// Firebase CLI не умеет показывать задеплоенные правила, поэтому сверяем не с
// сервером, а с отпечатком последней выкатки: `rules:deploy` записывает хеши
// выкаченных файлов в .rules-deployed.json, `rules:check` сравнивает их с
// текущими. Это не доказывает, что на сервере лежит именно этот текст, — но
// ловит тот случай, ради которого написано: правила правили, деплой не делали.
//
// Файлы выкатываются раздельно, потому что раздельно и ломаются: Storage
// может быть не подключён в проекте, и его падение не должно отменять выкатку
// правил Firestore. Отмечается ровно то, что действительно уехало, — иначе
// отпечаток врал бы.
//
// Использование:
//   node scripts/rules-state.mjs check                    — сверить всё
//   node scripts/rules-state.mjs record <файл> [<файл>…]  — отметить выкаченное

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ALL = ['firestore.rules', 'firestore.indexes.json', 'storage.rules'];
const STATE = '.rules-deployed.json';

const hashOf = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);

const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});

const mode = process.argv[2];

if (mode === 'record') {
  const files = process.argv.slice(3);
  if (!files.length) {
    console.error('Укажите, какие файлы выкачены: record firestore.rules …');
    process.exit(2);
  }

  const state = load();
  for (const file of files) {
    if (!ALL.includes(file)) {
      console.error(`Неизвестный файл: ${file}`);
      process.exit(2);
    }
    state[file] = { hash: hashOf(file), at: new Date().toISOString() };
  }

  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`Отмечено выкаченным: ${files.join(', ')}`);
  process.exit(0);
}

if (mode !== 'check') {
  console.error('Укажите режим: check или record');
  process.exit(2);
}

const state = load();
const stale = [];
const never = [];

for (const file of ALL) {
  const recorded = state[file];
  if (!recorded) never.push(file);
  else if (recorded.hash !== hashOf(file)) stale.push(file);
}

if (never.length) {
  console.error('Ни разу не выкатывались:');
  never.forEach((f) => console.error(`  — ${f}`));
}

if (stale.length) {
  console.error('Изменились после последней выкатки:');
  stale.forEach((f) => console.error(`  — ${f} (выкачен ${state[f].at})`));
}

if (never.length || stale.length) {
  console.error('\nВ боевом проекте правила старше кода. Выкатить:');
  if (never.includes('storage.rules') || stale.includes('storage.rules')) {
    console.error('  npm run storage:deploy   (нужен подключённый Storage и тариф Blaze)');
  }
  console.error('  npm run rules:deploy');
  process.exit(1);
}

const newest = ALL.map((f) => state[f].at).sort().at(-1);
console.log(`Правила совпадают с выкаченными. Последняя выкатка: ${newest}.`);
