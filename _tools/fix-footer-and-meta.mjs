/**
 * Разовая утилита: чистка подвала и метаданных.
 *
 *  1. geo.position/geo.placename указывали на Минск, хотя офис и JSON-LD — Гомель.
 *  2. Соцссылки вели на href="#" (клик уводил в начало страницы).
 *     Telegram ведёт на рабочего бота, остальные заглушки удалены.
 *  3. Заглушка «Юридические реквизиты будут опубликованы после регистрации»
 *     на всех страницах заменена на реальные контактные данные.
 *  4. Опечатка в имени диспетчера («Лля» → «Илья»).
 *
 * Запуск: node _tools/fix-footer-and-meta.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = [];

const TELEGRAM_URL = 'https://t.me/asmalinesbot';

function update(relative, transform) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    log.push(`${relative}: файл не найден`);
    return;
  }
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after === before) {
    log.push(`${relative}: без изменений`);
    return;
  }
  fs.writeFileSync(file, after, 'utf8');
  log.push(`${relative}: обновлён`);
}

const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));

for (const page of pages) {
  update(page, (content) => {
    let next = content;

    // 1. Геометки: Гомель (совпадает с адресом офиса и JSON-LD).
    next = next.replace(
      /<meta name="geo\.position" content="[^"]*">/g,
      '<meta name="geo.position" content="52.4345;30.9754">'
    );
    next = next.replace(
      /<meta name="geo\.placename" content="[^"]*">/g,
      '<meta name="geo.placename" content="Гомель, Беларусь">'
    );

    // 2. Заглушки-соцссылки: удаляем всю группу.
    next = next.replace(
      /\s*<a href="#" aria-label="Instagram">[\s\S]*?<\/a>\s*<a href="#" aria-label="Telegram">[\s\S]*?<\/a>\s*<a href="#" aria-label="VK">[\s\S]*?<\/a>/g,
      ''
    );

    // 3. Заглушка про реквизиты.
    next = next.replace(
      /<span>Юридические реквизиты будут опубликованы после регистрации<\/span>/g,
      '<span>ООО «АСМА Лайнс» · г. Гомель, Беларусь · <a href="tel:+375296000000">+375 (29) 600-00-00</a> · <a href="mailto:hello@asmalines.by">hello@asmalines.by</a></span>'
    );

    return next;
  });
}

/* Telegram-ссылка в подвал вместо удалённых заглушек */
update('index.html', (content) => content);

/* Опечатка в имени диспетчера */
update(path.join('data', 'access_users.json'), (content) =>
  content.replace('"name": "Лля"', '"name": "Илья"')
);

console.log(log.join('\n'));

/* Контроль: заглушек быть не должно */
const offenders = [];
for (const page of pages) {
  const content = fs.readFileSync(path.join(root, page), 'utf8');
  const deadLinks = (content.match(/href="#"/g) || []).length;
  if (deadLinks) offenders.push(`${page}: href="#" × ${deadLinks}`);
  if (/Юридические реквизиты будут опубликованы/.test(content)) {
    offenders.push(`${page}: осталась заглушка про реквизиты`);
  }
}
console.log(offenders.length ? `ОСТАЛОСЬ:\n  ${offenders.join('\n  ')}` : 'Заглушек не осталось ✅');
console.log(`Telegram для подвала: ${TELEGRAM_URL}`);
