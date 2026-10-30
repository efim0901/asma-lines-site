/**
 * Разовая утилита: тема выносится в внешний файл, затем пишется строгий CSP.
 *
 * Инлайн-скрипт темы в <head> требовал 'unsafe-inline' в script-src.
 * Выносим его в отдельный файл — head остаётся без исполняемого инлайна,
 * и Content-Security-Policy можно сделать строгим.
 * (JSON-LD блоки остаются инлайновыми: application/ld+json не исполняется
 * и под script-src не подпадает.)
 *
 * Запуск: node _tools/extract-theme-and-csp.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = [];

const themeScript = `/* ============================================================
   ASMA Lines — ранняя установка темы (до отрисовки, чтобы не мигало).
   Вынесено из inline <script> в <head>: это позволяет держать строгий
   Content-Security-Policy без 'unsafe-inline' для скриптов.
   ============================================================ */
(function applyStoredTheme() {
  try {
    var stored = localStorage.getItem('asma-theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('theme-dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.remove('theme-dark');
    }
  } catch (error) {
    /* localStorage может быть недоступен — тема просто останется светлой */
  }
})();
`;

fs.writeFileSync(path.join(root, 'assets', 'theme-init.js'), themeScript, 'utf8');
log.push('создан assets/theme-init.js');

/* Заменяем инлайн-скрипт темы на подключение внешнего файла */
for (const page of fs.readdirSync(root).filter((name) => name.endsWith('.html'))) {
  const file = path.join(root, page);
  let content = fs.readFileSync(file, 'utf8');
  const before = content;

  content = content.replace(
    /<script>\s*\(function\(\)\{try\{var t=localStorage\.getItem\('asma-theme'\)[\s\S]*?<\/script>/,
    '<script src="assets/theme-init.js?v=20261004_theme"></script>'
  );

  if (content !== before) {
    fs.writeFileSync(file, content, 'utf8');
    log.push(`${page}: тема вынесена в assets/theme-init.js`);
  }
}

/* Проверяем, что исполняемого инлайна не осталось */
const offenders = [];
for (const page of fs.readdirSync(root).filter((name) => name.endsWith('.html'))) {
  const content = fs.readFileSync(path.join(root, page), 'utf8');
  for (const match of content.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)) {
    const attributes = match[1] || '';
    // application/ld+json не исполняется и CSP не нарушает.
    if (/type="application\/ld\+json"/.test(attributes)) continue;
    offenders.push(`${page}: <script${attributes}>`);
  }
}
log.push(
  offenders.length
    ? `ОСТАЛСЯ исполняемый инлайн-скрипт:\n  ${offenders.join('\n  ')}`
    : 'Исполняемого инлайн-скрипта не осталось ✅'
);

console.log(log.join('\n'));
