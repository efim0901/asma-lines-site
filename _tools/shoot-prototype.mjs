/**
 * Съёмка скриншотов прототипов интерфейса.
 *
 * Нужен, чтобы после правок макета быстро получить картинки для Figma
 * или для показа заказчику. Использует headless Chrome из системы.
 *
 * Запуск: node _tools/shoot-prototype.mjs [имя-файла.html]
 *
 * Каждый макет снимается в трёх разрешениях (1440, 1180, 390). Для
 * crm-v2.html дополнительно снимаются состояния с открытой карточкой
 * заявки — она открывается по хэшу #detail.
 *
 * Chrome запускается с временным профилем: если этим не управлять,
 * headless-запуск молча падает, когда у пользователя уже открыт браузер.
 *
 * Отдельная тонкость: окно уже ~500px Chrome не отдаёт, поэтому узкие
 * макеты снимаются через iframe нужной ширины — иначе страница получает
 * не ту ширину, медиазапросы срабатывают неправильно, а снимок обрезан.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

/** Дополнительные состояния макета, которые открываются хэшем URL. */
const EXTRA_SHOTS = {
  'crm-v2.html': [
    { suffix: 'laptop-detail', width: 1180, height: 860, hash: '#detail', note: 'ноутбук: карточка выдвинута поверх списка' },
    { suffix: 'mobile-detail', width: 390, height: 844, hash: '#detail', note: 'телефон: карточка-шторка' }
  ]
};

// URL локального файла: пробелы в пути кодируем.
const fileUrl = `file:///${source.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`;

// Временный профиль Chrome: чтобы запуск не зависел от уже открытого браузера.
// В некоторых окружениях TMP указывает на ещё не созданный каталог — создаём его.
const tmpRoot = os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(tmpRoot, 'asma-shot-'));

/** Окно уже ~500 px Chrome не открывает: макет получил бы чужую ширину. */
const MIN_WINDOW_WIDTH = 500;

function shoot(viewport, output) {
  if (fs.existsSync(output)) fs.unlinkSync(output);

  let url = fileUrl + (viewport.hash || '');
  if (viewport.width < MIN_WINDOW_WIDTH) {
    // Узкий макет оборачиваем в iframe нужной ширины: внутри фрейма
    // медиазапросы считают корректную ширину, а снимок = область фрейма.
    const wrapperPath = path.join(profileDir, `wrapper-${viewport.suffix}.html`);
    fs.writeFileSync(
      wrapperPath,
      `<!doctype html><html><head><meta charset="utf-8"><style>
        html, body { margin: 0; padding: 0; background: #fff; }
        iframe { display: block; border: 0; width: ${viewport.width}px; height: ${viewport.height}px; }
      </style></head><body><iframe src="${url}"></iframe></body></html>`
    );
    url = `file:///${wrapperPath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`;
  }

  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--force-device-scale-factor=1',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${viewport.width},${viewport.height}`,
      '--virtual-time-budget=5000',
      `--screenshot=${output}`,
      url
    ],
    { stdio: 'ignore' }
  );

  if (!fs.existsSync(output)) {
    console.error(`  ✖ ${viewport.suffix}: не удалось снять`);
    process.exitCode = 1;
    return;
  }
  const size = Math.round(fs.statSync(output).size / 1024);
  console.log(`  ${viewport.suffix.padEnd(14)} ${viewport.width}×${viewport.height}  ${size} КБ  — ${viewport.note}`);
}

try {
  for (const viewport of viewports) {
    shoot(viewport, path.join(prototypeDir, `${base}-${viewport.suffix}.png`));
  }
  for (const viewport of EXTRA_SHOTS[target] || []) {
    shoot(viewport, path.join(prototypeDir, `${base}-${viewport.suffix}.png`));
  }
} finally {
  fs.rmSync(profileDir, { recursive: true, force: true });
}

console.log(`\nГотово. Картинки в ${prototypeDir}`);
