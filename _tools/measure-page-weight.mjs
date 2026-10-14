/**
 * Сколько картинок реально скачивает браузер на каждой странице.
 *
 * Отличие от прошлого подсчёта: og:image, favicon и apple-touch-icon
 * браузер при загрузке страницы НЕ грузит — это метаданные для соцсетей
 * и иконки. Здесь считаются только те картинки, которые попадают
 * на страницу: теги <img>, preload картинок, инлайновые фоны и url() из
 * подключённых к странице CSS-файлов.
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

const pages = fs.readdirSync(root).filter((n) => n.endsWith('.html'));
const rows = [];
const clean = (ref) => ref.replace(/^\//, '').replace(/[?#].*$/, '');
const isLocalImage = (rel) => rel.startsWith('assets/') && /\.(svg|png|jpe?g|webp|gif|ico)$/i.test(rel);

for (const page of pages) {
  const text = read(page);
  const loaded = new Map();
  const add = (rel, via) => {
    if (isLocalImage(rel) && !loaded.has(rel)) loaded.set(rel, { bytes: size(rel), via });
  };

  for (const match of text.matchAll(/<img[^>]+src="([^"]+)"/g)) add(clean(match[1]), 'img');
  for (const match of text.matchAll(/<link[^>]+rel="preload"[^>]+as="image"[^>]*>/g)) {
    const href = match[0].match(/href="([^"]+)"/);
    if (href) add(clean(href[1]), 'preload');
  }
  for (const match of text.matchAll(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/g)) add(clean(match[1]), 'фон');

  // url() внутри CSS, который подключён именно к этой странице (пути — от самого CSS-файла).
  for (const link of text.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)[^"]*"/g)) {
    const cssRel = clean(link[1]);
    if (!cssRel.startsWith('assets/') || !fs.existsSync(path.join(root, cssRel))) continue;
    const cssDir = path.posix.dirname(cssRel);
    for (const url of read(cssRel).matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
      const ref = url[1];
      if (/^(data:|https?:|#)/.test(ref)) continue;
      add(ref.startsWith('/') ? clean(ref) : path.posix.normalize(`${cssDir}/${clean(ref)}`), 'css');
    }
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
