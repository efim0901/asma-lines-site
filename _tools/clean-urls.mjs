/**
 * Приведение внутренних ссылок к «чистым» адресам Cloudflare.
 *
 * Что происходит сейчас. Cloudflare нормализует адреса страниц
 * (html_handling = auto-trailing-slash), поэтому:
 *
 *   /about        → 200 сразу
 *   /about.html   → 307 на /about
 *   /index        → 307 на /
 *   /index.html   → 307 на /
 *
 * То есть каждая внутренняя ссылка с `.html` — лишний круг до сервера,
 * а canonical, og:url и sitemap указывают не на конечный адрес, а на
 * перенаправление. Проверено запросами к боевому сайту.
 *
 * Что делает скрипт:
 *   href="about.html"                                  → href="about"
 *   href="index.html"                                  → href="./"
 *   href="calculator.html?from=Минск"                  → href="calculator?from=Минск"
 *   https://<хост>/about.html                          → https://<хост>/about
 *   https://<хост>/index.html                          → https://<хост>/
 *   <loc>…</loc> в sitemap.xml                         → то же без .html
 *
 * Запуск:
 *   node _tools/clean-urls.mjs            # показать, что изменится
 *   node _tools/clean-urls.mjs --apply    # применить
 *   node _tools/clean-urls.mjs --check    # проверить, что .html-ссылок не осталось
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const checkOnly = process.argv.includes('--check');

const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
const sitemapPath = path.join(root, 'sitemap.xml');

/** Имя страницы → адрес без расширения. У главной адрес — корень. */
const target = new Map();
for (const page of htmlFiles) {
  target.set(page, page === 'index.html' ? '' : page.replace(/\.html$/, ''));
}

function rewrite(text) {
  let out = text;

  // 1. Абсолютные адреса (canonical, og:url, twitter:url, sitemap, @id в JSON-LD).
  out = out.replace(/(https?:\/\/[^\s"'<>,]*\/)([A-Za-z0-9_-]+)\.html(?=["'<\s?,#]|$)/g,
    (match, prefix, name) => {
      const page = `${name}.html`;
      if (!target.has(page)) return match;
      const rest = target.get(page);
      return rest ? `${prefix}${rest}` : prefix;
    });

  // 2. Ссылки от корня — на случай, если такие появятся.
  out = out.replace(/href="\/([A-Za-z0-9_-]+)\.html(?=["?#])/g, (match, name) => {
    const page = `${name}.html`;
    if (!target.has(page)) return match;
    const rest = target.get(page);
    return `href="/${rest}"`;
  });

  // 3. Относительные ссылки — основной случай.
  out = out.replace(/href="([A-Za-z0-9_-]+)\.html(?=["?#])/g, (match, name) => {
    const page = `${name}.html`;
    if (!target.has(page)) return match;
    const rest = target.get(page);
    return `href="${rest || './'}"`;
  });

  return out;
}

const files = [...htmlFiles, 'sitemap.xml'].filter((name) => fs.existsSync(path.join(root, name)));
let changed = 0;
let leftover = 0;
const report = [];

for (const name of files) {
  const file = path.join(root, name);
  const before = fs.readFileSync(file, 'utf8');
  const after = rewrite(before);
  const remaining = [...after.matchAll(/\.html(?=["?#\s<]|$)/g)].length;
  leftover += remaining;

  if (before === after) continue;
  const count = (before.match(/\.html(?=["?#\s<]|$)/g) || []).length - remaining;
  report.push(`  ${name}: ${count} адрес(ов)`);
  if (apply) fs.writeFileSync(file, after, 'utf8');
  changed += 1;
}

if (checkOnly) {
  if (leftover) {
    console.log(`✖ Осталось адресов с .html: ${leftover}. Выполните: node _tools/clean-urls.mjs --apply`);
    process.exit(1);
  }
  console.log('Адреса страниц чистые: расширения .html во внутренних ссылках нет ✅');
  process.exit(0);
}

if (!changed) {
  console.log(`Ссылок с .html не найдено (проверено файлов: ${files.length}).`);
  process.exit(leftover ? 1 : 0);
}

console.log(apply ? 'Приведено к чистым адресам:' : 'Будет приведено к чистым адресам:');
for (const line of report) console.log(line);
console.log(`\nФайлов затронуто: ${changed}.`);
if (!apply) console.log('Применить: node _tools/clean-urls.mjs --apply');
