/**
 * Разовая утилита: подписи для навигационных лендмарков.
 *
 * На каждой странице два <nav> без aria-label, поэтому скринридер
 * объявлял «навигация» дважды без пояснений.
 *
 * Запуск: node _tools/fix-nav-labels.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = [
  'index.html',
  'about.html',
  'services.html',
  'partners.html',
  'calculator.html',
  'contacts.html',
  'faq.html',
  'privacy.html',
  'proposal.html',
  'crm.html',
  'order-doc.html'
];

const log = [];

for (const page of pages) {
  const file = path.join(root, page);
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  const before = content;

  let navIndex = 0;
  content = content.replace(/<nav(\s[^>]*)?>/g, (match, attrs = '') => {
    if (/aria-label/.test(attrs)) return match;
    navIndex += 1;
    const label = navIndex === 1 ? 'Основная навигация' : 'Навигация в подвале';
    return `<nav${attrs} aria-label="${label}">`;
  });

  if (content !== before) {
    fs.writeFileSync(file, content, 'utf8');
    log.push(`${page}: подписано nav — ${navIndex}`);
  } else {
    log.push(`${page}: без изменений`);
  }
}

console.log(log.join('\n'));
