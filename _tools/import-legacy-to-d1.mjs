/**
 * Разовая миграция: заявки и список доступа из прежнего публичного JSON-бина в D1.
 *
 * Встроенный роут /api/admin/import-legacy требует SETUP_TOKEN, которого в
 * секретах нет, поэтому переносим напрямую через Cloudflare API — это тот же
 * результат, но без лишних зависимостей.
 *
 * Что делает:
 *   1. скачивает снапшот из бина и сохраняет резервную копию;
 *   2. добавляет отсутствующих пользователей доступа (мастера не дублирует);
 *   3. вставляет заявки, которых ещё нет в D1 (по id);
 *   4. добавляет tombstone-записи удалённых заявок;
 *   5. поднимает счётчик номеров, чтобы новые заявки не столкнулись со старыми.
 *
 * Запуск: node _tools/import-legacy-to-d1.mjs [--apply]
 * Без --apply только показывает план, ничего не меняя.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SOURCE_URL = 'https://json.extendsclass.com/bin/becdbda';
const DB_ID = '1acb05be-5bf6-4efc-bd11-41ff0509fb0e';
const apply = process.argv.includes('--apply');

const tokenFile = path.join(os.homedir(), '.cf-token.txt');
const accountFile = path.join(os.homedir(), '.cf-account.txt');
const token = fs.readFileSync(tokenFile, 'utf8').trim();
const account = fs.readFileSync(accountFile, 'utf8').trim();

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DB_ID}/query`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function d1(sql, params = []) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(params.length ? { sql, params } : { sql })
  });
  const data = await response.json();
  if (!data.success) throw new Error(`D1: ${JSON.stringify(data.errors)}`);
  return data.result?.[0]?.results ?? [];
}

/* --- 1. Снапшот --- */
console.log('Скачиваю снапшот из прежнего хранилища…');
const snapshot = await (await fetch(SOURCE_URL, { cache: 'no-store' })).json();
const backup = path.join(os.homedir(), `legacy-backup-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(backup, JSON.stringify(snapshot, null, 2), 'utf8');
console.log(`  заявок: ${snapshot.leads?.length ?? 0}, удалённых: ${snapshot.deletedIds?.length ?? 0}, пользователей: ${snapshot.authorizedUsers?.length ?? 0}`);
console.log(`  резервная копия: ${backup}`);

const clean = (value) => (value === null || value === undefined ? '' : String(value));

/* --- 2. Пользователи доступа --- */
const existingUsers = await d1('SELECT telegram_id, username, is_admin FROM access_users');
console.log(`\nПользователей в D1 сейчас: ${existingUsers.length}`);
for (const user of existingUsers) {
  console.log(`  ${user.username || user.telegram_id} (admin=${user.is_admin})`);
}

const seenTelegramIds = new Set(existingUsers.map((u) => String(u.telegram_id || '')).filter(Boolean));
const seenUsernames = new Set(existingUsers.map((u) => String(u.username || '').toLowerCase()).filter(Boolean));

const usersToAdd = [];
for (const user of snapshot.authorizedUsers || []) {
  const telegramId = user.id ? String(user.id) : '';
  const username = clean(user.username);
  if (telegramId && seenTelegramIds.has(telegramId)) continue;
  if (!telegramId && username && seenUsernames.has(username.toLowerCase())) continue;
  // Мастер-администратор задаётся переменными окружения, дублировать его в таблице не нужно.
  if (username.toLowerCase() === 'plombit') continue;
  usersToAdd.push({
    key: telegramId || `u-${username.toLowerCase()}`,
    telegramId: telegramId || null,
    username: username || null,
    name: clean(user.name) || username || telegramId,
    role: clean(user.role) || 'Диспетчер',
    isAdmin: user.isAdmin ? 1 : 0,
    addedAt: clean(user.addedAt) || new Date().toISOString()
  });
}
console.log(`К добавлению пользователей: ${usersToAdd.length}`);
for (const user of usersToAdd) console.log(`  + ${user.name} (@${user.username || '-'}, id=${user.telegramId || '-'})`);

/* --- 3. Заявки --- */
const existingLeads = await d1('SELECT id FROM leads');
const existingIds = new Set(existingLeads.map((row) => row.id));
console.log(`\nЗаявок в D1 сейчас: ${existingLeads.length}`);

const COLUMNS = [
  'id', 'lead_number', 'status', 'type', 'category', 'name', 'company', 'contact', 'contact_raw',
  'email', 'from_city', 'to_city', 'route', 'distance', 'distance_km', 'vehicle', 'weight',
  'weight_tons', 'volume', 'volume_m3', 'price', 'price_value', 'price_breakdown', 'comment',
  'cargo', 'loading', 'source', 'assigned_to', 'priority', 'dispatcher', 'direction', 'topic',
  'preferred_channel', 'notes', 'created_at', 'updated_at'
];

const leadsToAdd = (snapshot.leads || []).filter((lead) => lead?.id && !existingIds.has(lead.id));
console.log(`К добавлению заявок: ${leadsToAdd.length}`);
for (const lead of leadsToAdd) {
  console.log(`  + №${lead.leadNumber} ${lead.name} (${lead.route})`);
}

const numberPattern = (value) => {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

/* --- 4. Удалённые --- */
const existingTombstones = await d1('SELECT id FROM deleted_leads');
const tombstoneIds = new Set(existingTombstones.map((row) => row.id));
const tombstonesToAdd = (snapshot.deletedIds || []).map(String).filter((id) => !tombstoneIds.has(id));
console.log(`К добавлению tombstone-записей: ${tombstonesToAdd.length}`);

if (!apply) {
  console.log('\nЭто был предпросмотр. Запустите с --apply, чтобы применить.');
  process.exit(0);
}

/* --- Применение --- */
console.log('\nПрименяю…');

for (const user of usersToAdd) {
  await d1(
    `INSERT INTO access_users (id, telegram_id, username, name, role, is_admin, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    [user.key, user.telegramId, user.username, user.name, user.role, user.isAdmin, user.addedAt]
  );
  console.log(`  пользователь добавлен: ${user.name}`);
}

for (const lead of leadsToAdd) {
  const now = new Date().toISOString();
  const values = [
    lead.id,
    clean(lead.leadNumber) || null,
    clean(lead.status) || 'new',
    clean(lead.type) || 'cargo',
    clean(lead.category),
    clean(lead.name),
    clean(lead.company),
    clean(lead.contact),
    clean(lead.contactName),
    clean(lead.email),
    clean(lead.fromCity),
    clean(lead.toCity),
    clean(lead.route),
    clean(lead.distance),
    numberPattern(lead.distance),
    clean(lead.vehicle),
    clean(lead.weight),
    numberPattern(lead.weight),
    clean(lead.volume),
    numberPattern(lead.volume),
    clean(lead.price),
    numberPattern(String(lead.price ?? '').replace(/[^\d.,]/g, '')),
    JSON.stringify([]),
    clean(lead.comment),
    clean(lead.cargo) || 'standard',
    lead.loading ? 1 : 0,
    clean(lead.source),
    lead.assignedTo ? String(lead.assignedTo) : null,
    clean(lead.priority) || 'normal',
    clean(lead.dispatcher),
    clean(lead.direction),
    clean(lead.topic),
    clean(lead.preferredChannel),
    JSON.stringify(lead.notes || []),
    clean(lead.createdAt) || now,
    clean(lead.updatedAt) || clean(lead.createdAt) || now
  ];
  const placeholders = COLUMNS.map(() => '?').join(', ');
  await d1(`INSERT INTO leads (${COLUMNS.join(', ')}) VALUES (${placeholders})`, values);
  console.log(`  заявка добавлена: №${lead.leadNumber}`);
}

for (const id of tombstonesToAdd) {
  await d1(
    'INSERT INTO deleted_leads (id, deleted_at, deleted_by) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
    [id, new Date().toISOString(), 'legacy-import']
  );
}
console.log(`  tombstone-записей добавлено: ${tombstonesToAdd.length}`);

/* --- 5. Счётчик номеров --- */
const maxRow = await d1("SELECT MAX(CAST(lead_number AS INTEGER)) AS max_number FROM leads WHERE lead_number GLOB '[0-9]*'");
const maxNumber = Number(maxRow[0]?.max_number || 100);
await d1("UPDATE counters SET value = ? WHERE name = 'lead_number'", [maxNumber]);
console.log(`  счётчик номеров поднят до ${maxNumber} — следующая заявка получит №${maxNumber + 1}`);

const finalCount = await d1('SELECT COUNT(*) AS count FROM leads');
console.log(`\nГотово. Заявок в D1: ${finalCount[0].count}`);
