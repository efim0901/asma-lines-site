/**
 * Подключение иллюстраций-сцен к теме.
 *
 * Задача: у каждой сцены два файла — тёмный (assets/img/NAME.svg) и светлый
 * (assets/img/light/NAME.svg). Нужно показать нужный в зависимости от темы.
 *
 * Почему не через инлайновые переменные: URL внутри var() разрешается
 * относительно ТАБЛИЦЫ СТИЛЕЙ, а не документа, поэтому `assets/img/x.svg`
 * превращался в `/assets/assets/img/x.svg` и давал 404. А путь от корня
 * (/assets/...) ломается при локальном просмотре через file://.
 * Поэтому правила живут здесь, в style.css, и пути в них относительные —
 * они одинаково работают и на сайте, и локально.
 *
 * Версия в ссылке — первые 8 символов sha256 содержимого файла. Так кэш
 * (у /assets/* стоит immutable на год) не отдаст старую картинку после
 * правки: изменился файл — изменился URL. Руками версию поднимать не нужно.
 *
 *   node _tools/wire-scenes.mjs           # разметка → data-scene, CSS перегенерируется
 *   node _tools/wire-scenes.mjs --check   # только проверка (для npm run check)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylePath = path.join(root, 'assets', 'style.css');
const checkOnly = process.argv.includes('--check');

const START = '/* scenes:start — блок создаётся _tools/wire-scenes.mjs, не правьте руками */';
const END = '/* scenes:end */';

const htmlPages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));

/* ---------- 1. Разметка: инлайновые переменные → data-scene ---------- */

// Имя сцены — без расширения и без версии: hero-truck, не hero-truck.svg?v=…
const inlineStyle = /style="--scene-dark:url\('(?:\.\.\/)?\/?assets\/img\/([^'"?]+?)(?:\.svg)?(?:\?[^']*)?'\);--scene-light:url\('[^']*'\)"/g;
// На случай повторного запуска: расширение могло попасть в значение ранее.
const sceneValue = /data-scene="([^"]+?)\.svg"/g;

let markupChanged = 0;
for (const page of htmlPages) {
  const file = path.join(root, page);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(inlineStyle, (match, name) => `data-scene="${name}"`).replace(sceneValue, 'data-scene="$1"');
  if (after === before) continue;
  if (!checkOnly) fs.writeFileSync(file, after, 'utf8');
  markupChanged += 1;
}

/* ---------- 2. Собираем список сцен ---------- */

const scenes = new Map(); // name → { page, cls }
const classPattern = /class="([^"]*?)"\s+data-scene="([^"]+)"/g;

for (const page of htmlPages) {
  const content = fs.readFileSync(path.join(root, page), 'utf8');
  for (const match of content.matchAll(classPattern)) {
    const classes = match[1].split(/\s+/).filter((c) => /__bg$|^service-thumb$/.test(c));
    const cls = classes[0] || 'hero-photo__bg';
    if (!scenes.has(match[2])) scenes.set(match[2], { page, cls });
    else if (scenes.get(match[2]).cls !== cls) scenes.get(match[2]).cls = cls;
  }
}

if (scenes.size === 0) {
  console.error('Не найдено ни одного data-scene — сначала выполните шаг 1 без --check');
  process.exit(1);
}

/* ---------- 3. Версия = хеш содержимого ---------- */

function assetVersion(relative) {
  const file = path.join(root, 'assets', 'img', relative);
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
}

/* ---------- 4. Генерируем CSS ---------- */

const lines = [START];
const missing = [];

for (const [name, info] of [...scenes].sort((a, b) => a[0].localeCompare(b[0]))) {
  const darkVersion = assetVersion(`${name}.svg`);
  const lightVersion = assetVersion(`light/${name}.svg`);
  if (!darkVersion) missing.push(`assets/img/${name}.svg`);
  if (!lightVersion) missing.push(`assets/img/light/${name}.svg`);

  const darkSelectors = ['.hero-photo__bg', '.photo-band__bg', '.service-thumb']
    .map((cls) => `${cls}[data-scene='${name}']`);
  const lightSelectors = darkSelectors.map((selector) => `[data-theme='light'] ${selector}`);

  if (darkVersion) {
    lines.push(`${darkSelectors.join(',\n')} { background-image: url('img/${name}.svg?v=${darkVersion}'); }`);
  }
  if (lightVersion) {
    // Внимание: путь считается от assets/style.css, поэтому нужен префикс img/.
    lines.push(`${lightSelectors.join(',\n')} { background-image: url('img/light/${name}.svg?v=${lightVersion}'); }`);
  }
}
lines.push(END);
const block = lines.join('\n');

if (missing.length) {
  console.log('\nНЕТ ФАЙЛОВ ИЛЛЮСТРАЦИЙ:');
  for (const item of missing) console.log(`  ✖ ${item}`);
}

/* ---------- 5. Вставляем или проверяем ---------- */

const style = fs.readFileSync(stylePath, 'utf8');
const hasBlock = style.includes(START) && style.includes(END);

if (checkOnly) {
  if (!hasBlock) {
    console.log('✖ В style.css нет блока сцен — выполните: node _tools/wire-scenes.mjs');
    process.exit(1);
  }
  const existing = style.slice(style.indexOf(START), style.indexOf(END) + END.length);
  if (existing !== block) {
    console.log('✖ Блок сцен в style.css устарел (изменились картинки или разметка).');
    console.log('  Выполните: node _tools/wire-scenes.mjs');
    process.exit(1);
  }
  if (markupChanged) {
    console.log(`✖ Осталась старая разметка сцен на страницах: ${markupChanged}.`);
    console.log('  Выполните: node _tools/wire-scenes.mjs');
    process.exit(1);
  }
  console.log(`Сцены в порядке: ${scenes.size} иллюстраций, обе темы ✅`);
  process.exit(missing.length ? 1 : 0);
}

let updated;
if (hasBlock) {
  const from = style.indexOf(START);
  const to = style.indexOf(END) + END.length;
  updated = style.slice(0, from) + block + style.slice(to);
} else {
  updated = `${style.trimEnd()}\n\n${block}\n`;
}

fs.writeFileSync(stylePath, updated, 'utf8');

console.log(`Сцен подключено: ${scenes.size}`);
for (const [name, info] of [...scenes].sort((a, b) => a[0].localeCompare(b[0]))) {
  const dark = assetVersion(`${name}.svg`) || '—';
  const light = assetVersion(`light/${name}.svg`) || '—';
  console.log(`  ${name.padEnd(20)} тёмная v=${dark}  светлая v=${light}`);
}
console.log(`\nРазметка обновлена на ${markupChanged} страницах, блок вписан в assets/style.css`);
