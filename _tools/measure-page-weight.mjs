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

/* Сцены: какой файл реально отдаёт CSS и сколько он весит.
   Считать по расширению .svg нельзя — четыре тяжёлые сцены отдаются
   растром WebP (см. _tools/make-webp-scenes.py), и браузер грузит его. */
const sceneFiles = {}; // имя сцены → { dark, light } — пути относительно корня
for (const statement of read('assets/style.css').split('}')) {
  const scene = statement.match(/data-scene='([^']+)'/);
  const url = statement.match(/url\('(img\/[^'?]+)/);
  if (!scene || !url) continue;
  const isLight = /\[data-theme='light'\]/.test(statement);
  sceneFiles[scene[1]] ??= {};
  sceneFiles[scene[1]][isLight ? 'light' : 'dark'] = `assets/${url[1]}`;
}

const scenes = {}; // имя сцены → вес файла текущей (тёмной) темы
for (const [name, files] of Object.entries(sceneFiles)) {
  const dark = files.dark || files.light;
  if (dark) scenes[name] = size(dark);
}

const pages = fs.readdirSync(root).filter((n) => n.endsWith('.html'));
const rows = [];

for (const page of pages) {
  const text = read(page);
  const loaded = new Map();

  // Фоны, подключённые блоками сцен
  for (const match of text.matchAll(/data-scene="([^"]+)"/g)) {
    const key = match[1];
    const file = sceneFiles[key]?.dark || sceneFiles[key]?.light;
    loaded.set(file || `сцена ${key}`, { bytes: scenes[key] || 0, via: 'фон' });
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
