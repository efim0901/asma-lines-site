/**
 * Разовая утилита: переезд на реальный адрес публикации.
 *
 * Сайт опубликован на https://asma-lines-site.firws.workers.dev, а в разметке
 * везде был указан asmalines.by, которого не существует. Из-за этого:
 *   - кнопка «Открыть CRM» в Telegram-боте вела на нерабочий адрес;
 *   - canonical / og:url / twitter:image / sitemap / robots — на чужой домен;
 *   - ALLOWED_ORIGINS в Worker не содержал реального домена.
 *
 * Здесь же доводится до конца перевод обложки: twitter:image и JSON-LD всё
 * ещё ссылались на og-cover.svg, который соцсети не рендерят.
 *
 * Адреса вида hello@asmalines.by НЕ трогаем: заменяем все вхождения хоста,
 * кроме тех, что стоят сразу после «@» (то есть почты).
 *
 * Запуск: node _tools/switch-domain.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OLD_HOST = 'asmalines.by';
const NEW_HOST = 'asma-lines-site.firws.workers.dev';

const targets = fs.readdirSync(root).filter((name) => /\.(html|xml|txt|js|md|toml)$/.test(name));
for (const dir of ['_shared', 'assets']) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full)) {
    if (/\.(js|md|css)$/.test(name)) targets.push(path.join(dir, name));
  }
}

const log = [];
const escaped = OLD_HOST.replace(/\./g, '\\.');

/** Заменяет хост везде, КРОМЕ почты: смотрим на символ перед вхождением. */
function replaceHost(content) {
  return content.replace(new RegExp(`(^|[^@\\w.])${escaped}`, 'g'), `$1${NEW_HOST}`);
}

for (const relative of targets) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8');
  let content = replaceHost(before);

  // Обложка: SVG не поддерживается соцсетями, доводим до png.
  content = content.split('og-cover.svg').join('og-cover.png');

  if (content === before) continue;
  fs.writeFileSync(file, content, 'utf8');

  const emailsBefore = (before.match(new RegExp(`@${escaped}`, 'g')) || []).length;
  const emailsAfter = (content.match(new RegExp(`@${escaped}`, 'g')) || []).length;
  log.push(`${relative}: заменено хостов, почта сохранена (${emailsBefore} → ${emailsAfter})`);
}

console.log(log.length ? log.join('\n') : 'нечего менять');

/* Контроль: ссылок на старый домен и на SVG-обложку быть не должно. */
const problems = [];
const mailKept = [];
for (const relative of targets) {
  const content = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const match of content.matchAll(new RegExp(`[^@\\w.]${escaped}`, 'g'))) {
    problems.push(`${relative}: хост без замены (${match[0].trim()})`);
  }
  for (const match of content.matchAll(/og-cover\.svg/g)) {
    problems.push(`${relative}: осталась ссылка на og-cover.svg`);
  }
  for (const match of content.matchAll(new RegExp(`[\\w.]+@${escaped}`, 'g'))) {
    mailKept.push(match[0]);
  }
}

console.log(
  problems.length
    ? `\nОСТАЛОСЬ ИСПРАВИТЬ:\n  ${problems.join('\n  ')}`
    : `\nСсылок на ${OLD_HOST} и og-cover.svg не осталось ✅`
);
console.log(`Почтовые адреса сохранены: ${[...new Set(mailKept)].sort().join(', ')}`);
