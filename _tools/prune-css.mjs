/**
 * Удаление мёртвого CSS из assets/style.css.
 *
 * Мёртвым считается правило, у которого ВСЕ классы в селекторе не встречаются
 * ни в разметке, ни в скриптах (та же проверка, что в _tools/audit-css.mjs).
 * Правило, где хотя бы один класс живой, не трогается — даже если остальные
 * мертвы. Правила без классов (теги, идентификаторы, @media) не трогаются
 * вовсе, поэтому содержимое медиазапросов остаётся как есть.
 *
 * Динамические имена классов (`'route-' + type`) инструмент увидеть не может,
 * поэтому его вывод — нижняя оценка мёртвого кода. Перед удалением стоит
 * сверить список и сравнить снимки страниц до/после:
 *
 *   node _tools/prune-css.mjs                 # показать, что будет удалено
 *   node _tools/prune-css.mjs --apply         # удалить
 *   node _tools/prune-css.mjs --list > ...    # сохранить список для проверки
 *
 * После правки CSS нужен `npm run assets:fix`: у /assets/* стоит immutable-кэш.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const apply = process.argv.includes('--apply');
const file = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : 'assets/style.css';

const htmlFiles = fs.readdirSync(root).filter((n) => n.endsWith('.html'));
const scriptFiles = fs.readdirSync(path.join(root, 'assets'))
  .filter((n) => n.endsWith('.js'))
  .map((n) => `assets/${n}`);

// _shared/ — бизнес-логика Worker и бота. Разметку она не рисует, но
// проверять её дешевле, чем потом ловить удалённое живое правило.
const sharedFiles = fs.existsSync(path.join(root, '_shared'))
  ? fs.readdirSync(path.join(root, '_shared')).filter((n) => n.endsWith('.js')).map((n) => `_shared/${n}`)
  : [];

const usedText = [
  ...htmlFiles.map(read),
  ...scriptFiles.map(read),
  ...sharedFiles.map(read),
  read('_worker.js'),
  read('server.js')
].join('\n');

function isUsed(cls) {
  return new RegExp(`(^|[^\\w-])${cls.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(usedText);
}

/** Разбирает CSS на правила верхнего уровня, сохраняя исходный текст. */
function splitRules(css) {
  const rules = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  // Хвост после последнего правила (например, закрывающий комментарий блока
  // сцен `/* scenes:end */`) — это тоже часть файла, терять его нельзя.
  if (start < css.length) rules.push(css.slice(start));
  return rules;
}

const css = read(file);
const rules = splitRules(css);
const keep = [];
const removed = [];

for (const rule of rules) {
  const open = rule.indexOf('{');
  if (open === -1) {
    keep.push(rule);
    continue;
  }
  const selector = rule.slice(0, open).trim();
  // @media и прочие at-правила не разбираем: их содержимое остаётся целиком.
  if (!selector || selector.startsWith('@')) {
    keep.push(rule);
    continue;
  }
  const classes = [...selector.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((m) => m[1]);
  if (!classes.length || classes.some(isUsed)) {
    keep.push(rule);
    continue;
  }
  removed.push({ selector: selector.replace(/\s+/g, ' '), rule });
}

const removedBytes = removed.reduce((sum, item) => sum + Buffer.byteLength(item.rule), 0);
const removedLines = removed.reduce((sum, item) => sum + item.rule.split('\n').length, 0);

console.log(`${file}`);
console.log(`  всего: ${(Buffer.byteLength(css) / 1024).toFixed(0)} КБ, ` +
  `${css.split('\n').length} строк, ${rules.length} правил`);

if (!removed.length) {
  console.log('  мёртвых правил не найдено ✅');
  process.exit(0);
}

console.log(`  мёртвых правил: ${removed.length} (${(removedBytes / 1024).toFixed(0)} КБ, ${removedLines} строк)\n`);
for (const item of removed) console.log(`  − ${item.selector}`);

if (!apply) {
  console.log('\nЭто только список. Чтобы удалить: node _tools/prune-css.mjs --apply');
  console.log('Перед удалением снимите страницы обеих тем: node _tools/shoot-site.mjs <страница> both full');
  process.exit(0);
}

const next = keep.join('');
fs.writeFileSync(path.join(root, file), next, 'utf8');
console.log(`\nУдалено ${removed.length} правил (${(removedBytes / 1024).toFixed(0)} КБ).`);
console.log(`Файл: ${(Buffer.byteLength(css) / 1024).toFixed(0)} → ${(Buffer.byteLength(next) / 1024).toFixed(0)} КБ.`);
console.log('Дальше: npm run assets:fix и npm run check.');
