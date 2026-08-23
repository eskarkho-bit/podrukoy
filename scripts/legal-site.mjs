// Собирает веб-страницы документов из components/legal.ts.
//
// App Store требует публичный URL политики конфиденциальности — текста
// внутри приложения недостаточно. Держать вторую копию текста в HTML значило
// бы разъехаться с приложением при первой же правке, поэтому страница
// генерируется из того же файла, который показывает приложение.
//
// legal.ts — TypeScript, из node его не импортировать; вместо транспиляции
// тексты вынимаются из исходника по его известной структуре. Меняется
// структура LegalDoc — меняется и этот скрипт (упадёт с понятной ошибкой,
// а не соберёт пустую страницу).
//
// Запуск: node scripts/legal-site.mjs  → пишет legal-site/*.html
// Выкатка: firebase deploy --only hosting

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'components', 'legal.ts'), 'utf8');

// Константы-подстановки: реквизиты оператора и контакт. Без якорей строк:
// когда реквизиты станут длиннее printWidth, prettier перенесёт значение на
// следующую строку, и привязанный к одной строке шаблон перестал бы находить их
const consts = {};
for (const m of source.matchAll(/const (OPERATOR|CONTACT) =\s*'([^']*)';/g)) {
  consts[m[1]] = m[2];
}
if (!consts.OPERATOR || !consts.CONTACT) {
  throw new Error('Не нашёл OPERATOR/CONTACT в legal.ts — структура файла изменилась?');
}

// Сами документы: id, заголовок, версия и тело-шаблон
const docs = [
  ...source.matchAll(
    /const \w+: LegalDoc = \{\s*id: '(\w+)',\s*title: '([^']*)',\s*summary: '([^']*)',\s*version: '([^']*)',\s*body: `([\s\S]*?)`,\s*\};/g,
  ),
].map(([, id, title, , version, body]) => ({
  id,
  title,
  version,
  // Замена функцией: строка-замена трактовала бы $-последовательности в
  // реквизитах как ссылки на группы и молча исказила бы текст
  body: body
    .replaceAll('${OPERATOR}', () => consts.OPERATOR)
    .replaceAll('${CONTACT}', () => consts.CONTACT),
}));
if (docs.length !== 3) {
  throw new Error(`Ожидал 3 документа, нашёл ${docs.length} — структура legal.ts изменилась?`);
}

// Обе проверки — про «упасть, а не опубликовать не то»:
// 1) новая константа-подстановка, о которой скрипт не знает, ушла бы в
//    страницу литеральным «${NAME}»;
// 2) квадратные скобки — незаполненные реквизиты и пометки для юриста,
//    публиковать такое нельзя. Заодно это делает полный firebase deploy
//    безопасным: predeploy хостинга упадёт громко, а не выложит черновики.
//    Локальный предпросмотр черновиков: ALLOW_DRAFT_LEGAL=1 node scripts/legal-site.mjs
for (const doc of docs) {
  if (doc.body.includes('${')) {
    throw new Error(`В «${doc.title}» осталась неизвестная подстановка \${…} — дополните скрипт`);
  }
  if (doc.body.includes('[') && !process.env.ALLOW_DRAFT_LEGAL) {
    throw new Error(
      `В «${doc.title}» остались [ЗАГЛУШКИ] — документы ещё черновики, публиковать их нельзя`,
    );
  }
}

const escapeHtml = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Ссылки установки для страницы /get. Пустая строка означает «площадки ещё
// нет»: кнопка рисуется неактивной, а сборка не падает — QR на визитках
// печатается раньше, чем появятся сами ссылки, и адрес страницы должен жить
// дольше любой из них. Появилась ссылка — вписали и передеплоили хостинг,
// визитки перепечатывать не нужно.
const STORE_LINKS = {
  // TestFlight-ссылка внешнего тестирования; после релиза — страница App Store
  ios: '',
  // Прямая ссылка на APK (артефакт EAS) либо страница RuStore
  android: '',
};

// Палитра — светлая тема приложения (theme.ts)
const page = (title, inner) => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — domio</title>
<style>
  body { margin: 0; background: #F2F5F0; color: #2E3A2A;
         font: 16px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 26px; line-height: 1.3; }
  .version { color: #7A857A; font-size: 14px; margin-bottom: 24px; }
  .body { white-space: pre-wrap; background: #FFFFFF; border: 1px solid #E6E9E1;
          border-radius: 16px; padding: 20px 22px; }
  a { color: #5E7A56; }
  nav { margin-bottom: 8px; font-size: 14px; }
</style>
</head>
<body><main>${inner}</main></body>
</html>
`;

const outDir = join(root, 'legal-site');
mkdirSync(outDir, { recursive: true });

for (const doc of docs) {
  writeFileSync(
    join(outDir, `${doc.id}.html`),
    page(
      doc.title,
      `<nav><a href="./">← Все документы</a></nav>
<h1>${escapeHtml(doc.title)}</h1>
<p class="version">Редакция от ${doc.version} · сервис «domio»</p>
<div class="body">${escapeHtml(doc.body)}</div>`,
    ),
  );
}

writeFileSync(
  join(outDir, 'index.html'),
  page(
    'Документы',
    `<h1>Документы сервиса «domio»</h1>
<p>Мобильное приложение для вызова мастера на дом.</p>
<ul>${docs.map((d) => `<li><a href="${d.id}.html">${escapeHtml(d.title)}</a></li>`).join('\n')}</ul>
<p class="version">Эти же тексты показываются внутри приложения; версии совпадают.</p>`,
  ),
);

// Страница установки /get — единый адрес для QR-кодов на визитках мастеров.
// Определение платформы сделано прогрессивно: без JavaScript видны обе
// кнопки, со скриптом кнопка своей платформы поднимается наверх. Автоперехода
// по ссылке нет нарочно: внезапно начавшаяся загрузка APK выглядит как
// вирус, а выбор из двух больших кнопок понятен любому.
const installButton = (href, label) =>
  href
    ? `<a class="btn" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    : `<span class="btn disabled">${escapeHtml(label)} — скоро</span>`;

mkdirSync(join(outDir, 'get'), { recursive: true });
writeFileSync(
  join(outDir, 'get', 'index.html'),
  `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Установить приложение — domio</title>
<style>
  body { margin: 0; background: #F2F5F0; color: #2E3A2A;
         font: 17px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 420px; margin: 0 auto; padding: 48px 20px 64px; text-align: center; }
  h1 { font-size: 28px; line-height: 1.3; margin-bottom: 4px; }
  .tagline { color: #5E7A56; margin: 0 0 32px; }
  .buttons { display: flex; flex-direction: column; gap: 12px; }
  .btn { display: block; padding: 16px 20px; border-radius: 16px; text-decoration: none;
         background: #5E7A56; color: #FFFFFF; font-size: 18px; font-weight: 600; }
  .btn.disabled { background: #FFFFFF; color: #7A857A; border: 1px solid #E6E9E1;
                  font-weight: 400; }
  .note { color: #7A857A; font-size: 14px; margin-top: 32px; }
  .note a { color: #5E7A56; }
</style>
</head>
<body><main>
<h1>domio</h1>
<p class="tagline">Проверенные мастера — на дом</p>
<div class="buttons">
<div id="ios">${installButton(STORE_LINKS.ios, 'Скачать для iPhone')}</div>
<div id="android">${installButton(STORE_LINKS.android, 'Скачать для Android')}</div>
</div>
<p class="note">Приложение бесплатно. Каждый мастер проходит проверку вживую.<br>
<a href="../">Документы сервиса</a></p>
<script>
  // Свою платформу — первой. Распознаётся только Android: iPadOS маскируется
  // под «Macintosh», и надёжного признака iOS нет, поэтому iPhone стоит первым
  // по умолчанию, а перестановка нужна лишь андроиду
  if (/Android/i.test(navigator.userAgent)) {
    var a = document.getElementById('android');
    a.parentNode.insertBefore(a, document.getElementById('ios'));
  }
</script>
</main></body>
</html>
`,
);

console.log(
  `Собрано: legal-site/index.html + ${docs.map((d) => d.id + '.html').join(', ')} + get/index.html`,
);
