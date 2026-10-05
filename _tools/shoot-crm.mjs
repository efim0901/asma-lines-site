/**
 * Скриншоты боевой диспетчерской (crm.html) без Telegram и без сервера.
 *
 * Зачем: чтобы посмотреть, как выглядит рабочий интерфейс, не заходя в бота
 * и не поднимая локальный сервер. Скрипт берёт настоящий crm.html, подставляет
 * заглушку Telegram WebApp и заглушку API с демонстрационными заявками —
 * вся вёрстка, стили и скрипты при этом настоящие.
 *
 * Запуск: node _tools/shoot-crm.mjs
 *
 * Результат: _prototypes/crm-new-*.png (1440, 1180 и 390 плюс состояния
 * с открытой карточкой заявки). Каталог _prototypes не публикуется.
 *
 * Особенности, из-за которых скрипт выглядит сложнее, чем «снять страницу»:
 *  - Chrome не открывает окно уже ~500px, поэтому узкие кадры снимаются
 *    через iframe нужной ширины (иначе медиазапросы врут);
 *  - запуск идёт с временным профилем: если у пользователя уже открыт Chrome,
 *    headless-режим с общим профилем молча падает.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { qrSvg } from '../_shared/qr.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '_prototypes');
fs.mkdirSync(outDir, { recursive: true });

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

const fileUri = (file) => 'file:///' + file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');

/* Демонстрационные заявки. Поля совпадают с реальной схемой D1, поэтому
   карточка и таблица рисуются ровно так же, как с боевыми данными. */
/* Экран входа: QR рисуем тем же модулем, что и сервер, — видно настоящий код. */
const DEMO_QR_SVG = JSON.stringify(qrSvg('https://t.me/asmalinesbot?start=login_482173', { scale: 6, margin: 2 }));

const DEMO = `
  const LOGIN_MODE = /(^|[?&])state=login/.test(location.search);
  const QR_SVG = ${DEMO_QR_SVG};
  window.__QR_SVG = QR_SVG;
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const LEADS = [
    { id: 'lead-104', leadNumber: '104', name: 'Дмитрий Язотченко', contact: '+375 29 305-44-36', route: 'Минск → Брест',
      distance: '350 км', weight: '2.5 т', cargo: 'до 14 м³', vehicle: 'Газель', price: '708 BYN', status: 'new',
      dispatcher: '', source: 'calculator_modal', comment: 'чтобы разгружал Прокопенко', createdAt: iso(163), updatedAt: iso(163),
      notes: [{ id: 'n1', author: 'Система', text: 'Заявка поступила с сайта (calculator_modal), ставка рассчитана сервером', time: iso(163) }] },
    { id: 'lead-105', leadNumber: '105', name: 'ООО «Белтранс-Логистик»', company: 'ООО «Белтранс-Логистик»', contact: '+375 17 200-14-58',
      route: 'Гомель → Витебск', distance: '335 км', weight: '18 т', cargo: '82 м³', vehicle: 'Тент 20 т', price: '1 240 BYN',
      status: 'new', dispatcher: '', source: 'partners', comment: 'нужен боковой доступ', createdAt: iso(58), updatedAt: iso(58), notes: [] },
    { id: 'lead-103', leadNumber: '103', name: 'Иван Ефимович', contact: '@plombit', route: 'Минск → Витебск', distance: '280 км',
      weight: '5 т', cargo: '30 м³', vehicle: 'Изотерм 6 т', price: '690 BYN', status: 'processing', dispatcher: 'Иван',
      source: 'site', comment: 'уточнить время подачи', createdAt: iso(190), updatedAt: iso(30),
      notes: [
        { id: 'n2', author: 'Иван Ефимович', text: 'Статус изменён: «В работе»', time: iso(30) },
        { id: 'n3', author: 'Иван Ефимович', text: 'Позвонил, просит подачу к 9:00.', time: iso(120) }
      ] },
    { id: 'lead-102', leadNumber: '102', name: 'Иван Ефимович', contact: '+375 29 388-61-55', route: 'Гомель → Брест', distance: '645 км',
      weight: '18 т', cargo: '86 м³', vehicle: 'Тент 20 т', price: '1 473 BYN', status: 'processing', dispatcher: 'Дима',
      source: 'calculator', comment: '', createdAt: iso(1560), updatedAt: iso(900), notes: [] },
    { id: 'lead-106', leadNumber: '106', name: 'ЧП «АгроСервис»', contact: '+375 33 412-77-90', route: 'Брест → Гродно', distance: '260 км',
      weight: '10 т', cargo: '45 м³', vehicle: 'Тент 10 т', price: '860 BYN', status: 'transit', dispatcher: 'Лля',
      source: 'phone', comment: 'водитель Сергей, +375 29 771-22-14', createdAt: iso(300), updatedAt: iso(120), notes: [] },
    { id: 'lead-101', leadNumber: '101', name: 'Тест Заказчик', contact: '+375 29 123-45-67', route: 'Минск → Брест', distance: '350 км',
      weight: '18 т', cargo: '86 м³', vehicle: 'Тент 20 т', price: '1 200 BYN', status: 'completed', dispatcher: 'Иван',
      source: 'calculator', comment: 'доставлено в срок', createdAt: iso(4300), updatedAt: iso(2000), notes: [] },
    { id: 'lead-100', leadNumber: '100', name: 'ООО «Мясокомбинат»', contact: '+375 29 640-11-08', route: 'Гомель → Могилёв', distance: '180 км',
      weight: '8 т', cargo: 'реф', vehicle: 'Рефрижератор', price: '590 BYN', status: 'cancelled', dispatcher: 'Дима',
      source: 'site', comment: 'клиент перенёс рейс', createdAt: iso(5600), updatedAt: iso(5000), notes: [] }
  ];
  const payload = {
    ok: true, success: true, leads: LEADS, deletedIds: [],
    authorizedUsers: [{ id: 1014012851, username: 'plombit', name: 'Иван Ефимович', isAdmin: true }],
    user: { id: 1014012851, username: 'plombit', name: 'Иван Ефимович' }, isAdmin: true
  };
  window.Telegram = { WebApp: {
    initData: LOGIN_MODE ? '' : 'auth_date=1&user=%7B%22id%22%3A1014012851%7D&hash=demo',
    initDataUnsafe: LOGIN_MODE ? {} : { user: { id: 1014012851, first_name: 'Иван', last_name: 'Ефимович', username: 'plombit' } },
    ready() {}, expand() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {},
    enableClosingConfirmation() {}, disableClosingConfirmation() {},
    BackButton: { show() {}, hide() {}, onClick() {} },
    openLink(url) { window.open(url, '_blank'); },
    showConfirm(message, callback) { callback(true); }
  } };
  const realFetch = window.fetch.bind(window);
  const json = (body, status = 200) => Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  );
  window.fetch = (url, options) => {
    const target = String(url);
    if (!LOGIN_MODE) {
      return target.includes('/api/crm')
        ? json(payload)
        : realFetch(url, options);
    }
    // Браузер без сессии: CRM отвечает 401, вход выдаёт код и QR.
    if (target.includes('/api/login/start')) {
      return json({
        ok: true,
        code: '482-173',
        token: 'demo-token',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        deepLink: 'https://t.me/asmalinesbot?start=login_482173'
      });
    }
    if (target.includes('/api/login/qr')) {
      return Promise.resolve(new Response(QR_SVG, { status: 200, headers: { 'content-type': 'image/svg+xml' } }));
    }
    if (target.includes('/api/login/status')) return json({ ok: true, status: 'pending' });
    if (target.includes('/api/crm')) return json({ ok: false, error: 'Требуется вход' }, 401);
    return realFetch(url, options);
  };
`;

const shell = fs.readFileSync(path.join(root, 'crm.html'), 'utf8');
const harness = shell
  .replace('<head>', `<head>\n  <base href="${fileUri(root + path.sep).replace('%5C', '/')}">`)
  .replace('<script src="assets/crm-next.js', `<script>${DEMO}</script>\n  <script src="assets/crm-next.js`)
  .replace('</body>', `<script>
    window.addEventListener('load', () => {
      const params = new URLSearchParams(location.search);
      if (params.get('state') === 'detail') setTimeout(() => document.querySelector('.row')?.click(), 600);
      if (params.get('tab')) setTimeout(() => document.querySelector('[data-tab="' + params.get('tab') + '"]')?.click(), 900);
      // Заглушка не может подменить <img src> через fetch: подставляем QR вручную.
      if (params.get('state') === 'login') {
        setTimeout(() => {
          const qr = document.getElementById('login-qr');
          if (qr && window.__QR_SVG) qr.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(window.__QR_SVG);
        }, 1200);
      }
    });
  </script>\n</body>`);

const tmpRoot = os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(tmpRoot, 'asma-crm-shot-'));

/* Стенд живёт во временном профиле: в репозитории он не нужен.
   Относительные пути к ассетам чинит <base href> на корень проекта. */
const harnessPath = path.join(profileDir, 'crm-harness.html');
fs.writeFileSync(harnessPath, harness);

const views = [
  { suffix: 'desktop', width: 1440, height: 900, query: '', note: 'ПК: список и карточка рядом' },
  { suffix: 'laptop', width: 1180, height: 860, query: '', note: 'ноутбук: две зоны' },
  { suffix: 'laptop-detail', width: 1180, height: 860, query: '?state=detail', note: 'ноутбук: карточка выдвинута' },
  { suffix: 'mobile', width: 390, height: 844, query: '', note: 'телефон: плотный список' },
  { suffix: 'mobile-detail', width: 390, height: 844, query: '?state=detail', note: 'телефон: карточка-шторка' },
  { suffix: 'mobile-history', width: 390, height: 844, query: '?state=detail&tab=feed', note: 'телефон: история заявки' },
  { suffix: 'login-desktop', width: 1440, height: 900, query: '?state=login', note: 'ПК: вход по коду и QR' },
  { suffix: 'login-mobile', width: 390, height: 844, query: '?state=login', note: 'телефон: вход по коду и QR' }
];

try {
  for (const view of views) {
    const output = path.join(outDir, `crm-new-${view.suffix}.png`);
    if (fs.existsSync(output)) fs.unlinkSync(output);
    let url = fileUri(harnessPath) + view.query;
    if (view.width < 500) {
      const wrapper = path.join(profileDir, `wrapper-${view.suffix}.html`);
      fs.writeFileSync(wrapper, `<!doctype html><html><head><meta charset="utf-8"><style>
        html, body { margin: 0; padding: 0; background: #fff; }
        iframe { display: block; border: 0; width: ${view.width}px; height: ${view.height}px; }
      </style></head><body><iframe src="${url}"></iframe></body></html>`);
      url = fileUri(wrapper);
    }
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
      '--force-device-scale-factor=1', `--user-data-dir=${profileDir}`, '--no-first-run',
      '--no-default-browser-check', `--window-size=${view.width},${view.height}`,
      '--virtual-time-budget=6000', `--screenshot=${output}`, url
    ], { stdio: 'ignore' });
    console.log(fs.existsSync(output)
      ? `  ${view.suffix.padEnd(14)} ${view.width}×${view.height}  ${Math.round(fs.statSync(output).size / 1024)} КБ  — ${view.note}`
      : `  ✖ ${view.suffix}: не удалось снять`);
  }
} finally {
  fs.rmSync(profileDir, { recursive: true, force: true });
}

console.log(`\nГотово. Картинки в ${outDir}`);
