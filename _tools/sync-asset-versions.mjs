/**
 * Контроль версий ассетов по хешу содержимого.
 *
 * Зачем: в _headers для /assets/* стоит `max-age=31536000, immutable`.
 * Браузер запомнит файл на год, поэтому после ЛЮБОЙ правки ассета нужно
 * менять ?v= в разметке — иначе вернувшиеся посетители получат старую версию.
 *
 * Сравнивать даты правки нельзя: mtime меняется при обычном копировании
 * проекта. Поэтому в _tools/asset-versions.json хранится хеш содержимого
 * каждого ассета на момент последней смены версии.
 *
 *   node _tools/sync-asset-versions.mjs          # только проверка
 *   node _tools/sync-asset-versions.mjs --fix    # поднять ?v= до сегодня
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, '_tools', 'asset-versions.json');
const fix = process.argv.includes('--fix');

function todayStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/**
 * Версия для ассета с учётом того, что правок за день бывает несколько.
 *
 * Раньше версия была просто датой, и вторая правка за сутки не меняла ?v= —
 * браузер отдавал старый файл из кэша (для /assets/* стоит immutable на год).
 * Поэтому при совпадении с текущей версией добавляется буквенный суффикс:
 * 20261006 → 20261006b → 20261006c.
 */
function nextStamp(currentVersion, manifest) {
  const base = todayStamp();
  if (currentVersion !== base) return base;

  const used = new Set(
    Object.values(manifest)
      .map((entry) => entry && entry.version)
      .filter((version) => typeof version === 'string' && version.startsWith(base))
  );
  for (const letter of 'bcdefghijklmnopqrstuvwxyz') {
    const candidate = `${base}${letter}`;
    if (!used.has(candidate)) return candidate;
  }
  // Крайний случай: суффиксы кончились — добавляем метку времени.
  return `${base}${Date.now().toString(36).slice(-4)}`;
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith('.html'));

/** asset → множество страниц, где он подключён, и текущая версия в разметке. */
const usage = new Map();

for (const page of htmlFiles) {
  const content = fs.readFileSync(path.join(root, page), 'utf8');
  const pattern = /assets\/([A-Za-z0-9/._-]+\.(?:js|css))\?v=([A-Za-z0-9_-]+)/g;
  for (const match of content.matchAll(pattern)) {
    if (match[1].startsWith('vendor/')) continue;
    if (!usage.has(match[1])) usage.set(match[1], { pages: new Set(), versions: new Set() });
    usage.get(match[1]).pages.add(page);
    usage.get(match[1]).versions.add(match[2]);
  }
}

/** Ассеты без ?v= — отдельная проблема: они тоже залипнут в кэше. */
const withoutVersion = [];
for (const page of htmlFiles) {
  const content = fs.readFileSync(path.join(root, page), 'utf8');
  const pattern = /assets\/([A-Za-z0-9/._-]+\.(?:js|css))(?!\?v=)(?![A-Za-z0-9._/-])/g;
  for (const match of content.matchAll(pattern)) {
    if (match[1].startsWith('vendor/')) continue;
    withoutVersion.push(`${page}: assets/${match[1]} подключён без ?v=`);
  }
}

const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const nextManifest = { ...manifest };

const changed = [];
const multipleVersions = [];
const missingFiles = [];

for (const [asset, info] of usage) {
  const file = path.join(root, 'assets', asset);
  if (!fs.existsSync(file)) {
    missingFiles.push(`assets/${asset} (подключён на ${[...info.pages].join(', ')})`);
    continue;
  }

  if (info.versions.size > 1) {
    multipleVersions.push(`assets/${asset}: разные версии на страницах — ${[...info.versions].join(', ')}`);
  }

  const version = [...info.versions][0];
  const hash = hashFile(file);
  const recorded = manifest[asset];

  if (!recorded) {
    // Первый запуск: фиксируем текущее состояние как исходное.
    nextManifest[asset] = { version, hash };
    console.log(`  зафиксировано ${asset} → v=${version}`);
    continue;
  }

  if (recorded.hash !== hash && recorded.version === version) {
    changed.push({ asset, version, pages: [...info.pages] });
  }
  nextManifest[asset] = { version, hash };
}

console.log(`Проверено ассетов: ${usage.size}`);

if (missingFiles.length) {
  console.log('\nФАЙЛЫ НЕ НАЙДЕНЫ (будут 404 в продакшне):');
  for (const item of missingFiles) console.log(`  ✖ ${item}`);
}
if (withoutVersion.length) {
  console.log('\nПОДКЛЮЧЕНО БЕЗ ?v= (залипнет в кэше на год при правке):');
  for (const item of withoutVersion) console.log(`  ⚠ ${item}`);
}
if (multipleVersions.length) {
  console.log('\nРАЗНЫЕ ВЕРСИИ В РАЗМЕТКЕ:');
  for (const item of multipleVersions) console.log(`  ⚠ ${item}`);
}

if (!changed.length) {
  console.log('\nИзменённых ассетов без смены версии не найдено ✅');
  if (fix) fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
  process.exit(missingFiles.length || withoutVersion.length || multipleVersions.length ? 1 : 0);
}

console.log('\nСОДЕРЖИМОЕ ИЗМЕНИЛОСЬ, А ВЕРСИЯ — НЕТ:');
for (const item of changed) {
  console.log(`  ⚠ ${item.asset} (v=${item.version}; подключён на ${item.pages.join(', ')})`);
}

if (!fix) {
  console.log('\nЗапустите с --fix, чтобы поднять ?v= до сегодняшней даты.');
  process.exit(1);
}

const assetsToBump = changed.map((item) => item.asset);

// У каждого ассета может быть своя версия: если правка уже была сегодня,
// дата та же, и нужен суффикс (20261006b), иначе ?v= не изменится.
const stamps = new Map();
for (const item of changed) {
  stamps.set(item.asset, nextStamp(item.version, nextManifest));
}

console.log('\nПроставляю версии:');
for (const asset of assetsToBump) {
  console.log(`  ${asset}: ${changed.find((i) => i.asset === asset).version} → ${stamps.get(asset)}`);
}

for (const page of htmlFiles) {
  const file = path.join(root, page);
  let content = fs.readFileSync(file, 'utf8');
  const before = content;
  for (const asset of assetsToBump) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.replace(
      new RegExp(`(assets/${escaped})\\?v=[A-Za-z0-9_-]+`, 'g'),
      `$1?v=${stamps.get(asset)}`
    );
  }
  if (content !== before) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`  обновлён ${page}`);
  }
}

// Обновляем манифест: новая версия + новый хеш.
for (const asset of assetsToBump) {
  nextManifest[asset] = { version: stamps.get(asset), hash: hashFile(path.join(root, 'assets', asset)) };
}
fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
console.log('\nГотово: манифест обновлён, запустите проверку без --fix для контроля.');
process.exit(missingFiles.length || withoutVersion.length || multipleVersions.length ? 1 : 0);
