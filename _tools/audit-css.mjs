/**
 * Сколько CSS можно выбросить.
 *
 * Ищет правила, все селекторы которых ссылаются только на классы, отсутствующие
 * и в разметке, и в скриптах. Динамические имена (собранные из строк) сюда
 * не попадают, поэтому результат — нижняя оценка, а не приговор.
 *
 * Запуск: node _tools/audit-css.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const htmlFiles = fs.readdirSync(root).filter((n) => n.endsWith('.html'));
const scriptFiles = fs.readdirSync(path.join(root, 'assets'))
  .filter((n) => n.endsWith('.js'))
  .map((n) => `assets/${n}`);

const usedText = [
  ...htmlFiles.map(read),
  ...scriptFiles.map(read),
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
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  return rules;
}

for (const file of ['assets/style.css', 'assets/crm-next.css']) {
  const css = read(file);
  const rules = splitRules(css);

  let deadRules = 0;
  let deadBytes = 0;
  let deadLines = 0;
  const deadNames = new Set();

  for (const rule of rules) {
    const open = rule.indexOf('{');
    if (open === -1) continue;
    const selector = rule.slice(0, open).trim();
    if (!selector || selector.startsWith('@')) continue;   // @media разбираем как есть

    const classes = [...selector.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)].map((m) => m[1]);
    if (!classes.length) continue;
    if (classes.some(isUsed)) continue;                     // хотя бы один класс живой

    deadRules += 1;
    deadBytes += Buffer.byteLength(rule);
    deadLines += rule.split('\n').length;
    for (const cls of classes) deadNames.add(cls);
  }

  const totalKb = Buffer.byteLength(css) / 1024;
  console.log(`\n${file}`);
  console.log(`  всего: ${totalKb.toFixed(0)} КБ, ${css.split('\n').length} строк, ${rules.length} правил`);
  console.log(`  мёртвых правил: ${deadRules} (${(deadBytes / 1024).toFixed(0)} КБ, ${deadLines} строк)`);
  console.log(`  задействовано классов: ${deadNames.size}`);
  console.log(`  примеры: ${[...deadNames].slice(0, 24).join(', ')}`);

  // Какие блоки CSS целиком принадлежат мёртвому компоненту
  const groups = new Map();
  for (const name of deadNames) {
    const prefix = name.includes('__') ? name.split('__')[0] : name.split('-')[0];
    groups.set(prefix, (groups.get(prefix) || 0) + 1);
  }
  const top = [...groups].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  крупные группы: ${top.map(([n, c]) => `${n} (${c})`).join(', ')}`);
}
