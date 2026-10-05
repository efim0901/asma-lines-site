/**
 * Разовая утилита: og:image переводится с SVG на PNG.
 *
 * Facebook, X (Twitter) и LinkedIn не рендерят SVG, поэтому превью ссылки
 * было пустым. Дополнительно проставляются og:image:width/height —
 * без них часть краулеров не показывает большое превью.
 *
 * Запуск: node _tools/fix-og-image.mjs
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
  'privacy.html'
];

const PNG_PATH = 'assets/img/og-cover.png';
const log = [];

for (const page of pages) {
  const file = path.join(root, page);
  if (!fs.existsSync(file)) {
    log.push(`${page}: файл не найден — пропущен`);
    continue;
  }

  const before = fs.readFileSync(file, 'utf8');
  let content = before;

  // 1. Заменяем путь к обложке (с любым ?v=... и в http/https вариантах).
  content = content.replace(
    /(property="og:image"\s+content=")[^"]*og-cover\.svg[^"]*(")/g,
    `$1https://asmalines.by/${PNG_PATH}$2`
  );
  content = content.replace(
    /(content=")[^"]*og-cover\.svg[^"]*("\s+property="og:image")/g,
    `$1https://asmalines.by/${PNG_PATH}$2`
  );

  // 2. Добавляем og:image:type, если его ещё нет (width/height уже проставлены).
  if (!content.includes('og:image:type')) {
    content = content.replace(
      /(<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>)/,
      '$1\n  <meta property="og:image:type" content="image/png">'
    );
  }

  // 3. Twitter-карточка должна быть summary_large_image для широкого превью.
  content = content.replace(
    /(<meta\s+name="twitter:card"\s+content=")summary(")/,
    '$1summary_large_image$2'
  );

  if (content !== before) {
    fs.writeFileSync(file, content, 'utf8');
    log.push(`${page}: обновлён og:image`);
  } else {
    log.push(`${page}: без изменений`);
  }
}

console.log(log.join('\n'));
