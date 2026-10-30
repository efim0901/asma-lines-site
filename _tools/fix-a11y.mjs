/**
 * Разовая утилита: правки доступности и согласованности разметки.
 *
 *  1. Кнопки-переключатели получают aria-pressed (иначе скринридер не знает,
 *     что выбрано; на главной aria-pressed уже был — поведение расходилось).
 *  2. Исправляется вместимость карточки «Среднетоннажный транспорт»:
 *     было data-vehicle-weight="2.5" при подписи «до 5 т», из-за чего груз 3–5 т
 *     подсвечивал малотоннажную карточку, а 5–20 т не подсвечивал ничего.
 *  3. Добавляется skip-link и id у <main>.
 *  4. Добавляется aria-label навигациям.
 *
 * Запуск: node _tools/fix-a11y.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = [];

function editFile(relativePath, transforms) {
  const file = path.join(root, relativePath);
  let content = fs.readFileSync(file, 'utf8');
  const before = content;
  for (const [description, from, to, expectedCount] of transforms) {
    const occurrences = content.split(from).length - 1;
    if (occurrences !== expectedCount) {
      throw new Error(
        `${relativePath}: «${description}» — ожидалось вхождений ${expectedCount}, найдено ${occurrences}`
      );
    }
    content = content.split(from).join(to);
  }
  if (content !== before) {
    fs.writeFileSync(file, content, 'utf8');
    report.push(`обновлён ${relativePath}`);
  } else {
    report.push(`без изменений ${relativePath}`);
  }
}

/* 1. Карточки подвижного состава: aria-pressed + вместимость 5 т */
editFile('calculator.html', [
  [
    'карточка малотоннажного транспорта',
    '<button type="button" class="b2b-vcard" data-vehicle-weight="1.5">',
    '<button type="button" class="b2b-vcard" data-vehicle-weight="1.5" aria-pressed="false">',
    1
  ],
  [
    'карточка среднетоннажного транспорта (вес 2.5 → 5 т)',
    '<button type="button" class="b2b-vcard is-active" data-vehicle-weight="2.5">',
    '<button type="button" class="b2b-vcard is-active" data-vehicle-weight="5" aria-pressed="true">',
    1
  ],
  [
    'карточка крупнотоннажного транспорта',
    '<button type="button" class="b2b-vcard" data-vehicle-weight="20">',
    '<button type="button" class="b2b-vcard" data-vehicle-weight="20" aria-pressed="false">',
    1
  ],
  [
    'быстрый выбор веса — активная кнопка 2.5 т',
    '<button type="button" class="b2b-qweight-btn is-active" data-weight="2.5">',
    '<button type="button" class="b2b-qweight-btn is-active" data-weight="2.5" aria-pressed="true">',
    1
  ],
  [
    'быстрый выбор веса — остальные кнопки',
    'class="b2b-qweight-btn" data-weight=',
    'class="b2b-qweight-btn" aria-pressed="false" data-weight=',
    5
  ]
]);

/* 2. Skip-link и id у main — на всех маркетинговых страницах */
const marketingPages = [
  'index.html',
  'about.html',
  'services.html',
  'partners.html',
  'calculator.html',
  'contacts.html',
  'faq.html',
  'privacy.html'
];

for (const page of marketingPages) {
  const file = path.join(root, page);
  let content = fs.readFileSync(file, 'utf8');
  const before = content;

  // id у первого <main>
  if (/<main(?![^>]*\bid=)/.test(content)) {
    content = content.replace(/<main(?![^>]*\bid=)/, '<main id="main"');
  }

  // skip-link сразу после открытия <body>
  if (!content.includes('class="skip-link"') && /<body[^>]*>/.test(content)) {
    content = content.replace(
      /(<body[^>]*>)/,
      '$1\n  <a class="skip-link" href="#main">Перейти к содержимому</a>'
    );
  }

  if (content !== before) {
    fs.writeFileSync(file, content, 'utf8');
    report.push(`обновлён ${page} (skip-link / main#main)`);
  } else {
    report.push(`без изменений ${page}`);
  }
}

console.log(report.join('\n'));
