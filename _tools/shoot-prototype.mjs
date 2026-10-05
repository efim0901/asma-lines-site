/**
 * Съёмка скриншотов прототипов интерфейса в трёх разрешениях.
 *
 * Нужен, чтобы после правок макета быстро получить картинки для Figma
 * или для показа заказчику. Использует headless Chrome из системы.
 *
 * Запуск: node _tools/shoot-prototype.mjs [имя-файла.html]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prototypeDir = path.join(root, '_prototypes');

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

const browser = BROWSERS.find((candidate) => fs.existsSync(candidate));
if (!browser) {
  console.error('Не найден Chrome или Edge. Установите браузер либо соберите скриншоты вручную.');
  process.exit(1);
}
console.log(`Браузер: ${browser}`);

const target = process.argv[2] || 'crm-v2.html';
const source = path.join(prototypeDir, target);
if (!fs.existsSync(source)) {
  console.error(`Нет файла ${source}`);
  process.exit(1);
}

/** Имя картинки выводим из имени макета: crm-v2.html → crm-v2-desktop.png */
const base = target.replace(/\.html$/, '');

const viewports = [
  { suffix: 'desktop', width: 1440, height: 900, note: 'основной сценарий' },
  { suffix: 'laptop', width: 1180, height: 860, note: 'ноутбук' },
  { suffix: 'mobile', width: 390, height: 844, note: 'телефон' }
];

// Первый аргумент — URL. Для локального файла пробелы в пути кодируем.
const fileUrl = `file:///${source.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`;

for (const viewport of viewports) {
  const output = path.join(prototypeDir, `${base}-${viewport.suffix}.png`);
  if (fs.existsSync(output)) fs.unlinkSync(output);

  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${viewport.width},${viewport.height}`,
      '--virtual-time-budget=4000',
      `--screenshot=${output}`,
      fileUrl
    ],
    { stdio: 'ignore' }
  );

  if (!fs.existsSync(output)) {
    console.error(`  ✖ ${viewport.suffix}: не удалось снять`);
    process.exitCode = 1;
    continue;
  }
  const size = Math.round(fs.statSync(output).size / 1024);
  console.log(`  ${viewport.suffix.padEnd(8)} ${viewport.width}×${viewport.height}  ${size} КБ  — ${viewport.note}`);
}

console.log(`\nГотово. Картинки в ${prototypeDir}`);
