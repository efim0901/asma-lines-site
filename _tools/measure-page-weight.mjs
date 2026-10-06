/**
 * Сколько картинок реально скачивает браузер на каждой странице.
 *
 * Отличие от прошлого подсчёта: og:image, favicon и apple-touch-icon
 * браузер при загрузке страницы НЕ грузит — это метаданные для соцсетей
 * и иконки. Здесь считаются только те картинки, которые попадают
 * на страницу: фоны из CSS (блок сцен и инлайновые стили) и теги <img>.
 *
 * Запуск: node _tools/measure-page-weight.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const size = (rel) => {
  const full = path.join(root, rel);
  return fs.existsSync(full) ? fs.statSync(full).size : 0;
};

/* Сцены и их светлые версии: браузер берёт одну по активной теме. */
const scenes = {};
for (const name of fs.readdirSync(path.join(root, 'assets/img')).filter((f) => f.endsWith('.svg'))) {
  const key = name.replace(/\.svg$/, '');
  scenes[key] = size(`assets/img/${name}`);
}

const pages = fs.readdirSync(root).filter((n) => n.endsWith('.html'));
const rows = [];

for (const page of pages) {
  const text = read(page);
  const loaded = new Map();

  // Фоны, подключённые блоками сцен
  for (const match of text.matchAll(/data-scene="([^"]+)"/g)) {
    const key = match[1];
    loaded.set(key, { bytes: scenes[key] || 0, via: 'фон' });
  }
  // Инлайновые фоны и <img src>
  for (const match of text.matchAll(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/g)) {
    const rel = match[1].replace(/^\//, '').replace(/\?.*$/, '');
    if (rel.startsWith('assets/')) loaded.set(rel, { bytes: size(rel), via: 'фон' });
  }
  for (const match of text.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    const rel = match[1].replace(/^\//, '').replace(/\?.*$/, '').split('#')[0];
    if (rel.startsWith('assets/')) loaded.set(rel, { bytes: size(rel), via: 'img' });
  }

  const total = [...loaded.values()].reduce((sum, item) => sum + item.bytes, 0);
  rows.push({ page, count: loaded.size, total, loaded });
}

rows.sort((a, b) => b.total - a.total);

console.log('Сколько картинок скачивает браузер (одна тема):\n');
for (const row of rows) {
  console.log(`  ${row.page.padEnd(18)} ${String(row.count).padStart(2)} шт.  ${String(Math.round(row.total / 1024)).padStart(5)} КБ`);
}

console.log('\nСамые тяжёлые картинки и где они используются:');
const byFile = new Map();
for (const row of rows) {
  for (const [file, info] of row.loaded) {
    if (!byFile.has(file)) byFile.set(file, { bytes: info.bytes, pages: new Set() });
    byFile.get(file).pages.add(row.page);
  }
}
[...byFile]
  .sort((a, b) => b[1].bytes - a[1].bytes)
  .slice(0, 10)
  .forEach(([file, info]) => {
    console.log(`  ${String(Math.round(info.bytes / 1024)).padStart(4)} КБ  ${file.padEnd(34)} ${[...info.pages].join(', ')}`);
  });

const totalBytes = byFile.size
  ? [...byFile.values()].reduce((sum, info) => sum + info.bytes, 0)
  : 0;
console.log(`\nВсего на страницах: ${(totalBytes / 1024).toFixed(0)} КБ; файлов: ${byFile.size}`);
