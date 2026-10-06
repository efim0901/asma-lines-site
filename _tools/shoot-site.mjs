/**
 * Съёмка страниц сайта в светлой и тёмной теме.
 *
 * Нужна, чтобы находить элементы, которые не адаптируются под тему:
 * глазами это видно быстрее, чем по CSS.
 *
 * Тема задаётся через localStorage до загрузки theme-init.js — для этого
 * создаётся временная копия страницы, в которую вставляется одна строка.
 * Копия делается в корне проекта, чтобы относительные пути к assets работали.
 *
 * Запуск:
 *   node _tools/shoot-site.mjs index.html            обе темы, десктоп
 *   node _tools/shoot-site.mjs index.html light       одна тема
 *   node _tools/shoot-site.mjs partners.html dark mobile
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];
const browser = BROWSERS.find((candidate) => fs.existsSync(candidate));
if (!browser) {
  console.error('Не найден Chrome/Edge — снимите скриншоты вручную.');
  process.exit(1);
}

const page = process.argv[2] || 'index.html';
const themeArg = (process.argv[3] || 'both').toLowerCase();
const viewportArg = (process.argv[4] || 'desktop').toLowerCase();

const themes = themeArg === 'both' ? ['light', 'dark'] : [themeArg];
const viewports = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1180, height: 860 },
  tablet: { width: 820, height: 1000 },
  mobile: { width: 390, height: 844 },
  // Высокое окно — чтобы одним снимком увидеть страницу целиком и найти
  // секции, которые не переключаются вместе с темой.
  full: { width: 1440, height: 7200 },
  'full-mobile': { width: 390, height: 9000 }
};

const viewport = viewports[viewportArg];
if (!viewport) {
  console.error(`Неизвестное разрешение: ${viewportArg}. Доступно: ${Object.keys(viewports).join(', ')}`);
  process.exit(1);
}

const sourcePath = path.join(root, page);
if (!fs.existsSync(sourcePath)) {
  console.error(`Нет файла ${sourcePath}`);
  process.exit(1);
}

const outDir = path.join(root, '_shots');
fs.mkdirSync(outDir, { recursive: true });

const source = fs.readFileSync(sourcePath, 'utf8');
const base = page.replace(/\.html$/, '');

for (const theme of themes) {
  // Вставляем установку темы перед theme-init.js, иначе она перезапишет выбор.
  const injection = `<script>try{localStorage.setItem('asma-theme','${theme}')}catch(e){}</script>`;
  const marker = /<head>/i;
  if (!marker.test(source)) {
    console.error(`${page}: нет <head>, некуда вставить выбор темы`);
    process.exit(1);
  }
  const patched = source.replace(marker, `<head>\n${injection}`);

  const tempName = `._shot-${base}-${theme}.html`;
  const tempPath = path.join(root, tempName);
  fs.writeFileSync(tempPath, patched, 'utf8');

  const output = path.join(outDir, `${base}-${theme}-${viewportArg}.png`);
  if (fs.existsSync(output)) fs.unlinkSync(output);

  try {
    const fileUrl = `file:///${tempPath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`;
    execFileSync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--window-size=${viewport.width},${viewport.height}`,
        '--virtual-time-budget=5000',
        `--screenshot=${output}`,
        fileUrl
      ],
      { stdio: 'ignore' }
    );
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }

  if (!fs.existsSync(output)) {
    console.error(`  ✖ ${theme}: снять не удалось`);
    process.exitCode = 1;
    continue;
  }
  const size = Math.round(fs.statSync(output).size / 1024);
  console.log(`  ${theme.padEnd(5)} ${viewport.width}×${viewport.height}  ${size} КБ → _shots/${path.basename(output)}`);
}
