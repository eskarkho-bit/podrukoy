// Сторож против «правила поменяли, выкатить забыли».
//
// Firebase CLI не умеет показывать задеплоенные правила, поэтому сверяем не с
// сервером, а с отпечатком последней выкатки: `npm run rules:deploy` записывает
// хеши файлов в .rules-deployed.json, `npm run rules:check` сравнивает их с
// текущими. Это не доказывает, что на сервере лежит именно этот текст, — но
// ловит тот случай, ради которого написано: правила правили, деплой не делали.
//
// Использование:
//   node scripts/rules-state.mjs check    — сравнить (падает при расхождении)
//   node scripts/rules-state.mjs record   — запомнить после успешного деплоя

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILES = ['firestore.rules', 'storage.rules', 'firestore.indexes.json'];
const STATE = '.rules-deployed.json';

const hashes = () => Object.fromEntries(FILES.map((f) => [
  f,
  createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16),
]));

const mode = process.argv[2];

if (mode === 'record') {
  writeFileSync(STATE, `${JSON.stringify({ at: new Date().toISOString(), ...hashes() }, null, 2)}\n`);
  console.log('Отпечаток правил записан.');
  process.exit(0);
}

if (mode !== 'check') {
  console.error('Укажите режим: check или record');
  process.exit(2);
}

if (!existsSync(STATE)) {
  console.error(`Нет ${STATE}: правила ни разу не выкатывались этим скриптом.`);
  console.error('Выполните: npm run rules:deploy');
  process.exit(1);
}

const recorded = JSON.parse(readFileSync(STATE, 'utf8'));
const current = hashes();
const stale = FILES.filter((f) => recorded[f] !== current[f]);

if (stale.length) {
  console.error('Эти файлы изменились после последней выкатки:');
  stale.forEach((f) => console.error(`  — ${f}`));
  console.error('\nПравила в боевом проекте старше кода. Выполните: npm run rules:deploy');
  process.exit(1);
}

console.log(`Правила совпадают с выкаченными ${recorded.at}.`);
