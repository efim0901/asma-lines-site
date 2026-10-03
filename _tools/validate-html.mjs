/**
 * Проверка целостности разметки после скриптовых правок.
 *
 * Ловит то, что легко сломать массовыми заменами: незакрытые теги,
 * висячие атрибуты, забытые inline-обработчики (они ломают строгий CSP),
 * ссылки на удалённые файлы.
 *
 * Запуск: node _tools/validate-html.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));

/** Теги, которые обязаны закрываться. */
const PAIRED = ['html', 'head', 'body', 'main', 'nav', 'header', 'footer', 'section', 'article', 'div', 'form', 'dialog', 'table', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'p', 'a', 'button', 'label', 'select', 'textarea', 'style', 'script', 'title', 'h1', 'h2', 'h3', 'h4'];

/** Теги без закрывающего. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use', 'tspan']);

const problems = [];

for (const page of pages) {
  const content = fs.readFileSync(path.join(root, page), 'utf8');

  // 1. Баланс парных тегов (учитываем только открывающие/закрывающие без самозакрытия).
  for (const tag of PAIRED) {
    const open = (content.match(new RegExp(`<${tag}(?=[\\s>/])`, 'gi')) || []).length;
    const close = (content.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    if (open !== close) {
      problems.push(`${page}: <${tag}> открыт ${open} раз, закрыт ${close}`);
    }
  }

  // 2. Inline-обработчики ломают строгий CSP.
  for (const match of content.matchAll(/\son(click|load|change|input|submit|error|mouseover|focus)\s*=/gi)) {
    problems.push(`${page}: inline-обработчик ${match[0].trim()} (нарушит CSP)`);
  }

  // 3. Исполняемый инлайн-скрипт.
  for (const match of content.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/gi)) {
    if (/application\/ld\+json/i.test(match[1] || '')) continue;
    problems.push(`${page}: исполняемый inline <script${match[1] || ''}> (нарушит CSP)`);
  }

  // 4. Ссылки на локальные файлы должны существовать.
  for (const match of content.matchAll(/(?:src|href)="(?!https?:|mailto:|tel:|#|data:|\/)([^"?]+)(?:\?[^"]*)?"/g)) {
    const target = match[1];
    if (!target || target.endsWith('/')) continue;
    if (!fs.existsSync(path.join(root, target))) {
      problems.push(`${page}: ссылка на отсутствующий файл ${target}`);
    }
  }

  // 5. Пустые и заглушечные ссылки. Исключение — ссылки, которые заполняет JS
  //    (помечены data-runtime-link): у них href="#" только до инициализации.
  const deadLinks = [...content.matchAll(/<a\b[^>]*href="#"[^>]*>/g)].filter(
    (match) => !/data-runtime-link/.test(match[0])
  ).length;
  if (deadLinks) problems.push(`${page}: href="#" × ${deadLinks}`);

  // 6. Базовая структура документа.
  if (!/<html[^>]*\slang=/.test(content)) problems.push(`${page}: у <html> нет атрибута lang`);
  if (!/<meta[^>]*name="viewport"/.test(content)) problems.push(`${page}: нет meta viewport`);
  if (!/<title>[^<]+<\/title>/.test(content)) problems.push(`${page}: пустой или отсутствующий <title>`);
}

console.log(`Проверено страниц: ${pages.length}`);

if (!problems.length) {
  console.log('Разметка целая, inline-обработчиков и битых ссылок нет ✅');
  process.exit(0);
}

console.log(`\nНайдено проблем: ${problems.length}`);
for (const problem of problems) console.log(`  ✖ ${problem}`);
process.exit(1);
