/**
 * Разовая утилита: подготовка к строгому Content-Security-Policy.
 *
 * 1. Убирает inline-обработчики onclick (они требуют 'unsafe-inline' в CSP)
 *    и переводит их на data-атрибуты, которые обрабатывает assets/site.js.
 * 2. Заменяет трюк с асинхронной загрузкой шрифтов через onload на обычный
 *    <link rel="stylesheet">: выигрыш незаметен, а CSP становится строгим.
 *
 * Запуск: node _tools/prepare-csp.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = [];

function update(relative, transform) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after === before) {
    log.push(`${relative}: без изменений`);
    return;
  }
  fs.writeFileSync(file, after, 'utf8');
  log.push(`${relative}: обновлён`);
}

/* 1. Шрифты: убираем onload-хак на всех страницах */
const fontHack = /<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]*)" media="print" onload="this\.media='all'">\s*\n\s*<noscript><link rel="stylesheet" href="[^"]*"><\/noscript>/g;

for (const page of fs.readdirSync(root).filter((name) => name.endsWith('.html'))) {
  update(page, (content) =>
    content.replace(fontHack, '<link rel="stylesheet" href="$1">')
  );
}

/* 2. order-doc.html: кнопки на data-атрибуты */
update('order-doc.html', (content) => {
  let next = content;
  const replacements = [
    [/onclick="setDocType\('order'\)"/g, 'data-doc-type="order"'],
    [/onclick="setDocType\('kp'\)"/g, 'data-doc-type="kp"'],
    [/onclick="setDocType\('waybill'\)"/g, 'data-doc-type="waybill"'],
    [/onclick="toggleEditMode\(\)"/g, 'data-action="toggle-edit-mode"'],
    [/onclick="copyDocumentToClipboard\(\)"/g, 'data-action="copy-document"'],
    [/onclick="window\.print\(\)"/g, 'data-action="print"']
  ];
  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement);
  }
  return next;
});

/* 3. proposal.html: печать и закрытие окна */
update('proposal.html', (content) =>
  content
    .replace(/onclick="window\.print\(\)"/g, 'data-action="print"')
    .replace(/onclick="window\.close\(\)"/g, 'data-action="close-window"')
);

/* 4. calculator.html: кнопка быстрой консультации */
update('calculator.html', (content) =>
  content.replace(
    /onclick="var b=document\.getElementById\('btn-quick-consult'\);[^"]*"/g,
    'data-action="quick-consult" data-target="btn-quick-consult"'
  )
);

console.log(log.join('\n'));

/* Контроль: inline-обработчиков и onload-хаков остаться не должно */
const offenders = [];
for (const page of fs.readdirSync(root).filter((name) => name.endsWith('.html'))) {
  const content = fs.readFileSync(path.join(root, page), 'utf8');
  for (const match of content.matchAll(/\son(click|load|change|input|submit|error)=/g)) {
    offenders.push(`${page}: ${match[0].trim()}`);
  }
}
console.log(offenders.length ? `ОСТАЛИСЬ inline-обработчики:\n  ${offenders.join('\n  ')}` : 'Inline-обработчиков не осталось ✅');
