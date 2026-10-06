/**
 * Ревизия ассетов и CSS: что используется, а что осталось мёртвым грузом.
 *
 * Проверяет:
 *   1. файлы в assets/, на которые нигде нет ссылок;
 *   2. CSS-классы, которых нет ни в одной странице;
 *   3. дубликаты файлов (одинаковое содержимое в разных местах);
 *   4. вес страниц: сколько картинок и скриптов тянет каждая.
 *
 * Запуск: node _tools/audit-assets.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const htmlFiles = fs.readdirSync(root).filter((n) => n.endsWith('.html'));

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/* ---------- 1. Что подключено ---------- */

const sources = [
  ...htmlFiles.map((f) => ({ name: f, text: read(f) })),
  ...walk('assets').filter((f) => /\.(js|css)$/.test(f)).map((f) => ({ name: `assets/${f}`, text: read(`assets/${f}`) })),
  { name: '_worker.js', text: read('_worker.js') },
  { name: 'server.js', text: read('server.js') }
];

const referenced = new Set();
for (const source of sources) {
  for (const match of source.text.matchAll(/(?:assets\/|\.\.\/|\.\/)([A-Za-z0-9_./-]+\.(?:svg|png|jpe?g|webp|ico|css|js))/g)) {
    referenced.add(match[1].replace(/^\.\//, ''));
  }
  // Ссылки вида url('img/...') внутри style.css
  for (const match of source.text.matchAll(/url\(['"]?(?:\.\.\/)?(img\/[A-Za-z0-9_./-]+\.(?:svg|png|jpe?g|webp))/g)) {
    referenced.add(match[1]);
  }
}

const onDisk = walk('assets');
const unused = onDisk.filter((file) => {
  if (file.startsWith('vendor/')) return false;      // вендорные библиотеки проверяем отдельно
  const short = file.replace(/^/, '');
  const variants = [short, `assets/${short}`, path.posix.basename(short)];
  return !variants.some((v) => referenced.has(v));
});

console.log('=== 1. Файлы в assets/, на которые нет ссылок ===');
if (!unused.length) console.log('  таких нет ✅');
for (const file of unused) {
  const size = Math.round(fs.statSync(path.join(root, 'assets', file)).size / 1024);
  console.log(`  ${file}  (${size} КБ)`);
}

/* ---------- 2. Мёртвые CSS-классы ---------- */

const css = read('assets/style.css') + read('assets/crm-next.css');
const cssClasses = new Set();
for (const match of css.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) cssClasses.add(match[1]);

const htmlText = htmlFiles.map((f) => read(f)).join('\n');
const jsText = [...walk('assets').filter((f) => f.endsWith('.js'))].map((f) => read(`assets/${f}`)).join('\n');
const usedText = `${htmlText}\n${jsText}`;

const deadClasses = [...cssClasses].filter((cls) => {
  const pattern = new RegExp(`(^|[^\\w-])${cls.replace(/[-]/g, '\\-')}([^\\w-]|$)`);
  return !pattern.test(usedText);
});

console.log(`\n=== 2. CSS-классы, которых нет в разметке и скриптах: ${deadClasses.length} ===`);
console.log(`  ${deadClasses.slice(0, 60).join(', ')}${deadClasses.length > 60 ? ' …' : ''}`);

/* ---------- 3. Дубликаты по содержимому ---------- */

const byHash = new Map();
for (const file of [...onDisk, ...fs.readdirSync(root).filter((n) => /\.(ico|png|svg)$/.test(n))]) {
  const full = file.startsWith('assets') || file.startsWith('brand') ? path.join(root, 'assets', file) : path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 12);
  if (!byHash.has(hash)) byHash.set(hash, []);
  byHash.get(hash).push(file);
}

console.log('\n=== 3. Файлы с одинаковым содержимым ===');
let duplicates = 0;
for (const [, files] of byHash) {
  if (files.length < 2) continue;
  duplicates += 1;
  console.log(`  ${files.join('  ==  ')}`);
}
if (!duplicates) console.log('  дубликатов нет ✅');

/* ---------- 4. Вес страниц ---------- */

console.log('\n=== 4. Сколько тянет каждая страница ===');
for (const page of htmlFiles.sort()) {
  const text = read(page);
  let images = 0;
  let bytes = 0;

  const add = (rel) => {
    const candidates = [path.join(root, rel), path.join(root, 'assets', rel), path.join(root, rel.replace(/^assets\//, ''))];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        bytes += fs.statSync(candidate).size;
        return true;
      }
    }
    return false;
  };

  for (const match of text.matchAll(/["'(]([^"')]*?(?:assets\/|\/assets\/)([A-Za-z0-9_./-]+\.(?:svg|png|jpe?g|webp)))/g)) {
    images += 1;
    add(`assets/${match[2]}`);
  }
  // Картинки, подставленные из style.css (блок сцен)
  for (const cls of ['hero-photo__bg', 'photo-band__bg', 'service-thumb']) {
    if (!text.includes(cls)) continue;
    for (const match of text.matchAll(new RegExp(`class="[^"]*${cls}[^"]*"\\s+data-scene="([^"]+)"`, 'g'))) {
      images += 1;
      add(`assets/img/${match[1]}.svg`);
    }
  }

  const scripts = [...text.matchAll(/src="([^"]*assets\/[^"]+\.js)/g)].length;
  const styles = [...text.matchAll(/href="([^"]*assets\/[^"]+\.css)/g)].length;
  console.log(`  ${page.padEnd(18)} картинок ${String(images).padStart(2)}, скриптов ${scripts}, стилей ${styles}, картинки ≈ ${Math.round(bytes / 1024)} КБ`);
}
