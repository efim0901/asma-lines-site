/**
 * ASMA Lines — слой хранения данных.
 *
 * Основное хранилище: Cloudflare D1 (SQLite) через биндинг DB.
 * Если биндинг не настроен, используется legacy-режим чтения из внешнего
 * JSON-бина — но запись в него ОТКЛЮЧЕНА по умолчанию, потому что этот
 * URL был публичным и позволял любому читать и перезаписывать базу заявок.
 *
 * Что читать дальше: DEPLOY-CLOUDFLARE.md, раздел «Хранилище D1».
 */

import { ConfigError, sanitizeNotes } from './core.js';
import { normalizeStoredLead } from './validation.js';

export const SCHEMA_VERSION = 2;

/** URL прежнего публичного хранилища. Только для разовой миграции данных. */
export const LEGACY_STORE_URL = 'https://json.extendsclass.com/bin/becdbda';

/**
 * Таблицы браузерного входа: сессии и одноразовые коды.
 * Вынесены отдельным списком: тот же набор нужен хранилищу внутри
 * `_worker.js`, чтобы определение таблиц жило в одном месте.
 */
export const SESSION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    telegram_id TEXT,
    username TEXT,
    name TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    user_agent TEXT,
    ip TEXT,
    place TEXT,
    revoked INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(telegram_id)',
  `CREATE TABLE IF NOT EXISTS login_codes (
    code TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    confirmed_at TEXT,
    used_at TEXT,
    telegram_id TEXT,
    username TEXT,
    name TEXT,
    ip TEXT,
    user_agent TEXT,
    place TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_login_codes_token ON login_codes(token_hash)'
];

/**
 * Методы сессий и кодов входа берутся из D1Store: их копирует на себя
 * хранилище внутри Worker'а, чтобы две реализации не разошлись.
 */
export const SESSION_METHOD_NAMES = [
  'saveLoginCode',
  'getLoginCode',
  'getLoginCodeByToken',
  'countLoginCodes',
  'confirmLoginCode',
  'consumeLoginCode',
  'deleteLoginCode',
  'deleteExpiredLoginCodes',
  'createSession',
  'getSession',
  'touchSession',
  'revokeSession',
  'revokeUserSessions',
  'countActiveSessions',
  'deleteExpiredSessions'
];

/**
 * Добавляет классу-хранилищу методы браузерного входа.
 * Обёртка заодно готовит схему: в Worker'е таблицы создаются лениво при
 * первом обращении, а код входа может быть самым первым запросом.
 */
export function withLoginSupport(StoreClass) {
  for (const name of SESSION_METHOD_NAMES) {
    const method = D1Store.prototype[name];
    StoreClass.prototype[name] = async function runWithSchema(...args) {
      if (typeof this.ensureSchema === 'function') await this.ensureSchema();
      return method.apply(this, args);
    };
  }
  return StoreClass;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  lead_number TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  type TEXT,
  category TEXT,
  name TEXT,
  company TEXT,
  contact TEXT,
  contact_raw TEXT,
  email TEXT,
  from_city TEXT,
  to_city TEXT,
  route TEXT,
  distance TEXT,
  distance_km REAL,
  vehicle TEXT,
  weight TEXT,
  weight_tons REAL,
  volume TEXT,
  volume_m3 REAL,
  price TEXT,
  price_value INTEGER,
  price_breakdown TEXT,
  comment TEXT,
  cargo TEXT,
  loading INTEGER DEFAULT 0,
  source TEXT,
  assigned_to TEXT,
  priority TEXT DEFAULT 'normal',
  dispatcher TEXT,
  direction TEXT,
  topic TEXT,
  preferred_channel TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_number ON leads(lead_number DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

CREATE TABLE IF NOT EXISTS deleted_leads (
  id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  deleted_by TEXT
);

CREATE TABLE IF NOT EXISTS access_users (
  id TEXT PRIMARY KEY,
  telegram_id TEXT,
  username TEXT,
  name TEXT,
  role TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_username ON access_users(username);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT,
  role TEXT,
  telegram_id TEXT,
  created_at TEXT NOT NULL
);

/* Таблицы браузерного входа — общий список SESSION_SCHEMA_STATEMENTS. */
${SESSION_SCHEMA_STATEMENTS.join(';\n')};

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

const LEAD_COLUMNS = [
  'id', 'lead_number', 'status', 'type', 'category', 'name', 'company', 'contact', 'contact_raw',
  'email', 'from_city', 'to_city', 'route', 'distance', 'distance_km', 'vehicle', 'weight',
  'weight_tons', 'volume', 'volume_m3', 'price', 'price_value', 'price_breakdown', 'comment',
  'cargo', 'loading', 'source', 'assigned_to', 'priority', 'dispatcher', 'direction', 'topic',
  'preferred_channel', 'notes', 'created_at', 'updated_at'
];

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Преобразует строку БД в объект заявки. */
export function rowToLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    leadNumber: row.lead_number || '',
    status: row.status || 'new',
    type: row.type || 'cargo',
    category: row.category || 'Перевозка груза',
    name: row.name || '',
    company: row.company || '',
    contact: row.contact || '',
    contactRaw: row.contact_raw || '',
    email: row.email || '',
    fromCity: row.from_city || '',
    toCity: row.to_city || '',
    route: row.route || '',
    distance: row.distance || '',
    distanceKm: row.distance_km ?? null,
    vehicle: row.vehicle || '',
    weight: row.weight || '',
    weightTons: row.weight_tons ?? null,
    volume: row.volume || '',
    volumeM3: row.volume_m3 ?? null,
    price: row.price || '',
    priceValue: row.price_value ?? null,
    priceBreakdown: parseJson(row.price_breakdown, []),
    comment: row.comment || '',
    cargo: row.cargo || 'standard',
    loading: Boolean(row.loading),
    source: row.source || '',
    assignedTo: row.assigned_to ?? null,
    priority: row.priority || 'normal',
    dispatcher: row.dispatcher || '',
    direction: row.direction || '',
    topic: row.topic || '',
    preferredChannel: row.preferred_channel || '',
    notes: parseJson(row.notes, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Преобразует объект заявки в параметры для SQL. */
/** Строка login_codes → запись кода входа. */
export function rowToLoginCode(row) {
  if (!row) return null;
  return {
    code: row.code,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at || null,
    usedAt: row.used_at || null,
    telegramId: row.telegram_id || null,
    username: row.username || null,
    name: row.name || null,
    ip: row.ip || '',
    userAgent: row.user_agent || '',
    place: row.place || ''
  };
}

/** Строка sessions → запись сессии. */
export function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    telegramId: row.telegram_id || '',
    username: row.username || '',
    name: row.name || '',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    userAgent: row.user_agent || '',
    ip: row.ip || '',
    place: row.place || '',
    revoked: Boolean(row.revoked)
  };
}

export function leadToParams(lead) {
  return [
    lead.id,
    lead.leadNumber ?? null,
    lead.status || 'new',
    lead.type || 'cargo',
    lead.category || '',
    lead.name || '',
    lead.company || '',
    lead.contact || '',
    lead.contactRaw || '',
    lead.email || '',
    lead.fromCity || '',
    lead.toCity || '',
    lead.route || '',
    lead.distance || '',
    lead.distanceKm ?? null,
    lead.vehicle || '',
    lead.weight || '',
    lead.weightTons ?? null,
    lead.volume || '',
    lead.volumeM3 ?? null,
    lead.price || '',
    lead.priceValue ?? null,
    JSON.stringify(lead.priceBreakdown || []),
    lead.comment || '',
    lead.cargo || 'standard',
    lead.loading ? 1 : 0,
    lead.source || '',
    lead.assignedTo ?? null,
    lead.priority || 'normal',
    lead.dispatcher || '',
    lead.direction || '',
    lead.topic || '',
    lead.preferredChannel || '',
    JSON.stringify(sanitizeNotes(lead.notes)),
    lead.createdAt || new Date().toISOString(),
    lead.updatedAt || lead.createdAt || new Date().toISOString()
  ];
}

/**
 * Хранилище на Cloudflare D1.
 */
export class D1Store {
  constructor(db) {
    this.db = db;
    this.kind = 'd1';
    this.writable = true;
  }

  static async create(db) {
    const store = new D1Store(db);
    await store.ensureSchema();
    return store;
  }

  async ensureSchema() {
    const statements = SCHEMA_SQL.split(';')
      .map(part => part.trim())
      .filter(Boolean);
    await this.db.batch(statements.map(sql => this.db.prepare(sql)));
    const current = await this.getMeta('schema_version');
    if (!current) await this.setMeta('schema_version', String(SCHEMA_VERSION));
  }

  async getMeta(key) {
    const row = await this.db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
    return row ? row.value : null;
  }

  async setMeta(key, value) {
    await this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(key, String(value))
      .run();
  }

  async loadAll() {
    const [leadsResult, tombstonesResult, usersResult] = await Promise.all([
      this.db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all(),
      this.db.prepare('SELECT id FROM deleted_leads').all(),
      this.db.prepare('SELECT * FROM access_users ORDER BY added_at ASC').all()
    ]);

    return {
      schemaVersion: SCHEMA_VERSION,
      leads: (leadsResult.results || []).map(rowToLead).filter(Boolean),
      deletedIds: (tombstonesResult.results || []).map(row => row.id),
      authorizedUsers: (usersResult.results || []).map(row => ({
        id: row.telegram_id || row.id,
        username: row.username || null,
        name: row.name || '',
        role: row.role || 'Диспетчер',
        isAdmin: Boolean(row.is_admin),
        addedAt: row.added_at
      }))
    };
  }

  async getLead(id) {
    const row = await this.db.prepare('SELECT * FROM leads WHERE id = ?').bind(String(id)).first();
    return rowToLead(row);
  }

  /** Атомарно выдаёт следующий номер заявки. */
  async nextLeadNumber() {
    await this.db
      .prepare("INSERT INTO counters (name, value) VALUES ('lead_number', 100) ON CONFLICT(name) DO NOTHING")
      .run();
    await this.db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'lead_number'").run();
    const row = await this.db.prepare("SELECT value FROM counters WHERE name = 'lead_number'").first();
    return String(row?.value ?? '');
  }

  async insertLead(lead) {
    const placeholders = LEAD_COLUMNS.map(() => '?').join(', ');
    await this.db
      .prepare(`INSERT INTO leads (${LEAD_COLUMNS.join(', ')}) VALUES (${placeholders})`)
      .bind(...leadToParams(lead))
      .run();
    return lead;
  }

  /** Обновляет только разрешённые поля. Возвращает обновлённую заявку или null. */
  async updateLead(id, patch) {
    const allowed = {
      status: 'status',
      assignedTo: 'assigned_to',
      priority: 'priority',
      notes: 'notes',
      comment: 'comment',
      dispatcher: 'dispatcher',
      direction: 'direction',
      topic: 'topic',
      preferredChannel: 'preferred_channel',
      company: 'company',
      contactName: 'name'
    };

    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(allowed)) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) {
        sets.push(`${column} = ?`);
        values.push(field === 'notes' ? JSON.stringify(sanitizeNotes(patch[field])) : (patch[field] ?? null));
      }
    }
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(String(id));

    const result = await this.db
      .prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    if (!result.meta || result.meta.changes === 0) return null;
    return this.getLead(id);
  }

  /** Мягкое удаление: заявка уезжает в tombstone-таблицу. */
  async deleteLead(id, deletedBy = null) {
    const lead = await this.getLead(id);
    if (!lead) return false;
    await this.db.batch([
      this.db
        .prepare('INSERT INTO deleted_leads (id, deleted_at, deleted_by) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(String(id), new Date().toISOString(), deletedBy),
      this.db.prepare('DELETE FROM leads WHERE id = ?').bind(String(id))
    ]);
    return true;
  }

  /* ------------------- Сессии и коды входа ------------------- */

  async saveLoginCode(record) {
    await this.db
      .prepare(
        `INSERT INTO login_codes (code, token_hash, created_at, expires_at, ip, user_agent, place)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET token_hash = excluded.token_hash,
           created_at = excluded.created_at, expires_at = excluded.expires_at,
           ip = excluded.ip, user_agent = excluded.user_agent, place = excluded.place,
           confirmed_at = NULL, used_at = NULL, telegram_id = NULL, username = NULL, name = NULL`
      )
      .bind(
        String(record.code),
        String(record.tokenHash),
        String(record.createdAt),
        String(record.expiresAt),
        String(record.ip || ''),
        String(record.userAgent || ''),
        String(record.place || '')
      )
      .run();
    return true;
  }

  async getLoginCode(code) {
    const row = await this.db.prepare('SELECT * FROM login_codes WHERE code = ?').bind(String(code)).first();
    return rowToLoginCode(row);
  }

  async getLoginCodeByToken(tokenHash) {
    const row = await this.db
      .prepare('SELECT * FROM login_codes WHERE token_hash = ? ORDER BY created_at DESC LIMIT 1')
      .bind(String(tokenHash))
      .first();
    return rowToLoginCode(row);
  }

  async countLoginCodes(ip, sinceIso) {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS total FROM login_codes WHERE ip = ? AND created_at >= ?')
      .bind(String(ip), String(sinceIso))
      .first();
    return Number(row?.total || 0);
  }

  async confirmLoginCode(code, { telegramId, username, name, at }) {
    const result = await this.db
      .prepare(
        `UPDATE login_codes SET confirmed_at = ?, telegram_id = ?, username = ?, name = ?
         WHERE code = ? AND used_at IS NULL AND confirmed_at IS NULL`
      )
      .bind(String(at), String(telegramId || ''), String(username || ''), String(name || ''), String(code))
      .run();
    return Number(result?.meta?.changes || 0) > 0;
  }

  /** Гасит код ровно один раз: два параллельных запроса не выдадут две сессии. */
  async consumeLoginCode(code, tokenHash, usedAt) {
    const result = await this.db
      .prepare(
        `UPDATE login_codes SET used_at = ?
         WHERE code = ? AND token_hash = ? AND used_at IS NULL AND confirmed_at IS NOT NULL`
      )
      .bind(String(usedAt), String(code), String(tokenHash))
      .run();
    return Number(result?.meta?.changes || 0) > 0;
  }

  async deleteLoginCode(code) {
    await this.db.prepare('DELETE FROM login_codes WHERE code = ?').bind(String(code)).run();
    return true;
  }

  async deleteExpiredLoginCodes(beforeIso) {
    await this.db.prepare('DELETE FROM login_codes WHERE created_at < ?').bind(String(beforeIso)).run();
    return true;
  }

  async createSession(record) {
    await this.db
      .prepare(
        `INSERT INTO sessions (id, telegram_id, username, name, created_at, expires_at, last_seen_at, user_agent, ip, place, revoked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .bind(
        String(record.id),
        String(record.telegramId || ''),
        String(record.username || ''),
        String(record.name || ''),
        String(record.createdAt),
        String(record.expiresAt),
        String(record.lastSeenAt),
        String(record.userAgent || ''),
        String(record.ip || ''),
        String(record.place || '')
      )
      .run();
    return true;
  }

  async getSession(id) {
    const row = await this.db.prepare('SELECT * FROM sessions WHERE id = ?').bind(String(id)).first();
    return rowToSession(row);
  }

  async touchSession(id, { lastSeenAt, expiresAt }) {
    await this.db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .bind(String(lastSeenAt), String(expiresAt), String(id))
      .run();
    return true;
  }

  async revokeSession(id) {
    await this.db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').bind(String(id)).run();
    return true;
  }

  async revokeUserSessions(telegramId) {
    const result = await this.db
      .prepare('UPDATE sessions SET revoked = 1 WHERE telegram_id = ? AND revoked = 0')
      .bind(String(telegramId))
      .run();
    return Number(result?.meta?.changes || 0);
  }

  async countActiveSessions(telegramId, nowIso) {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS total FROM sessions WHERE telegram_id = ? AND revoked = 0 AND expires_at > ?')
      .bind(String(telegramId), String(nowIso))
      .first();
    return Number(row?.total || 0);
  }

  async deleteExpiredSessions(beforeIso) {
    await this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(String(beforeIso)).run();
    return true;
  }

  async replaceUsers(users) {
    const statements = [this.db.prepare('DELETE FROM access_users')];
    for (const user of users) {
      const key = user.id ? String(user.id) : `u-${String(user.username || '').toLowerCase()}`;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO access_users (id, telegram_id, username, name, role, is_admin, added_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            key,
            user.id ? String(user.id) : null,
            user.username || null,
            user.name || '',
            user.role || 'Диспетчер',
            user.isAdmin ? 1 : 0,
            user.addedAt || new Date().toISOString()
          )
      );
    }
    await this.db.batch(statements);
  }

  async listEmployees() {
    const result = await this.db.prepare('SELECT * FROM employees ORDER BY created_at ASC').all();
    return (result.results || []).map(row => ({
      id: row.id,
      name: row.name || '',
      role: row.role || '',
      telegramId: row.telegram_id || null,
      createdAt: row.created_at
    }));
  }

  async upsertEmployee(employee) {
    await this.db
      .prepare(
        `INSERT INTO employees (id, name, role, telegram_id, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, telegram_id = excluded.telegram_id`
      )
      .bind(
        employee.id,
        employee.name || '',
        employee.role || '',
        employee.telegramId || null,
        employee.createdAt || new Date().toISOString()
      )
      .run();
    return employee;
  }

  async deleteEmployee(id) {
    const result = await this.db.prepare('DELETE FROM employees WHERE id = ?').bind(String(id)).run();
    return Boolean(result.meta && result.meta.changes > 0);
  }

  /** Разовая миграция из прежнего публичного JSON-бина. */
  async importLegacySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Пустой снапшот для импорта');

    const existing = await this.db.prepare('SELECT COUNT(*) AS count FROM leads').first();
    if (existing && Number(existing.count) > 0) {
      return { imported: 0, skipped: true, reason: 'В D1 уже есть заявки — импорт пропущен' };
    }

    let imported = 0;
    for (const rawLead of snapshot.leads || []) {
      const lead = normalizeStoredLead(rawLead);
      if (!lead) continue;
      await this.insertLead(lead);
      imported += 1;
    }

    for (const id of snapshot.deletedIds || []) {
      await this.db
        .prepare('INSERT INTO deleted_leads (id, deleted_at, deleted_by) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(String(id), new Date().toISOString(), 'legacy-import')
        .run();
    }

    if (Array.isArray(snapshot.authorizedUsers) && snapshot.authorizedUsers.length) {
      await this.replaceUsers(snapshot.authorizedUsers);
    }

    // Продолжаем нумерацию с максимального существующего номера.
    const maxRow = await this.db
      .prepare('SELECT MAX(CAST(lead_number AS INTEGER)) AS max_number FROM leads')
      .first();
    const maxNumber = Number(maxRow?.max_number || 100);
    await this.db
      .prepare("INSERT INTO counters (name, value) VALUES ('lead_number', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value")
      .bind(maxNumber)
      .run();

    await this.setMeta('legacy_import_at', new Date().toISOString());
    return { imported, skipped: false };
  }
}

/**
 * Хранилище только для чтения поверх прежнего внешнего JSON-бина.
 * Используется, пока D1 не настроен, чтобы сайт не падал. Запись запрещена.
 */
export class LegacyReadOnlyStore {
  constructor(url = LEGACY_STORE_URL) {
    this.url = url;
    this.kind = 'legacy-readonly';
    this.writable = false;
  }

  async loadAll() {
    const response = await fetch(`${this.url}?_t=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Legacy store HTTP ${response.status}`);
    const json = await response.json();
    return {
      schemaVersion: 1,
      leads: (json.leads || []).map(normalizeStoredLead).filter(Boolean),
      deletedIds: json.deletedIds || [],
      authorizedUsers: json.authorizedUsers || []
    };
  }

  async listEmployees() {
    return [];
  }

  async nextLeadNumber() {
    throw new ConfigError(
      'Запись заявок недоступна: не настроен биндинг D1. См. DEPLOY-CLOUDFLARE.md'
    );
  }

  async insertLead() {
    throw new ConfigError('Запись заявок недоступна: не настроен биндинг D1 (переменная DB)');
  }

  async updateLead() {
    throw new ConfigError('Изменение заявок недоступно: не настроен биндинг D1 (переменная DB)');
  }

  async deleteLead() {
    throw new ConfigError('Удаление заявок недоступно: не настроен биндинг D1 (переменная DB)');
  }

  async replaceUsers() {
    throw new ConfigError('Управление доступами недоступно: не настроен биндинг D1 (переменная DB)');
  }

  /* Вход в браузере невозможен без базы: сессии должны переживать перезапуск. */

  async saveLoginCode() {
    throw new ConfigError('Вход по коду недоступен: не настроен биндинг D1 (переменная DB)');
  }

  async getLoginCode() {
    return null;
  }

  async getLoginCodeByToken() {
    return null;
  }

  async countLoginCodes() {
    return 0;
  }

  async confirmLoginCode() {
    return false;
  }

  async consumeLoginCode() {
    return false;
  }

  async deleteLoginCode() {
    return false;
  }

  async deleteExpiredLoginCodes() {
    return 0;
  }

  async createSession() {
    throw new ConfigError('Вход в браузере недоступен: не настроен биндинг D1 (переменная DB)');
  }

  async getSession() {
    return null;
  }

  async touchSession() {
    return false;
  }

  async revokeSession() {
    return false;
  }

  async revokeUserSessions() {
    return 0;
  }

  async countActiveSessions() {
    return 0;
  }

  async deleteExpiredSessions() {
    return false;
  }

  async upsertEmployee() {
    throw new ConfigError('Сотрудники недоступны: не настроен биндинг D1 (переменная DB)');
  }

  async deleteEmployee() {
    throw new ConfigError('Сотрудники недоступны: не настроен биндинг D1 (переменная DB)');
  }
}

/**
 * Файловое хранилище для локальной разработки (server.js).
 *
 * Устраняет прежние проблемы: запись атомарная (временный файл + rename),
 * конкурирующие read-modify-write сериализуются очередью, а повреждённый
 * JSON не «превращается» в пустую базу — файл уезжает в .bak и мы падаем громко.
 *
 * @param {string} filePath — путь к JSON-файлу состояния
 * @param {Function} fsPromises — модуль node:fs/promises (передаётся извне,
 *        чтобы модуль оставался совместим с workerd)
 */
export class JsonFileStore {
  constructor(filePath, fsPromises, seed = null) {
    this.filePath = filePath;
    this.fs = fsPromises;
    this.kind = 'json-file';
    this.writable = true;
    this.queue = Promise.resolve();
    this.state = seed || {
      schemaVersion: SCHEMA_VERSION,
      counter: 100,
      leads: [],
      deletedIds: [],
      authorizedUsers: [],
      employees: [],
      loginCodes: [],
      sessions: []
    };
    this.loaded = false;
  }

  /** Все изменяющие операции идут через эту очередь — нет потерянных обновлений. */
  withLock(task) {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * Загрузка состояния выполняется ВНЕ очереди записи: методы, которые уже
   * держат блокировку, тоже вызывают ensureLoaded(), и захват блокировки
   * внутри него приводил бы к взаимной блокировке.
   * Промис кэшируется, поэтому параллельные вызовы ждут одну загрузку.
   */
  ensureLoaded() {
    if (this.loaded) return Promise.resolve();
    if (!this.loadingPromise) {
      this.loadingPromise = (async () => {
        try {
          const raw = await this.fs.readFile(this.filePath, 'utf8');
          const parsed = JSON.parse(raw);
          this.state = {
            schemaVersion: parsed.schemaVersion || SCHEMA_VERSION,
            counter: Number(parsed.counter) || 100,
            leads: Array.isArray(parsed.leads) ? parsed.leads.map(normalizeStoredLead).filter(Boolean) : [],
            deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
            authorizedUsers: Array.isArray(parsed.authorizedUsers) ? parsed.authorizedUsers : [],
            employees: Array.isArray(parsed.employees) ? parsed.employees : [],
            loginCodes: Array.isArray(parsed.loginCodes) ? parsed.loginCodes : [],
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
          };
        } catch (error) {
          if (error.code !== 'ENOENT') {
            // Не молчим: повреждённый файл — это инцидент, а не «пустая база».
            const backup = `${this.filePath}.corrupt-${Date.now()}.bak`;
            try {
              await this.fs.rename(this.filePath, backup);
              console.error(`Повреждён ${this.filePath}, сохранён как ${backup}`);
            } catch {
              /* ignore */
            }
            this.loadingPromise = null;
            throw new Error(`Не удалось прочитать ${this.filePath}: ${error.message}`);
          }
        }
        this.loaded = true;
      })();
    }
    return this.loadingPromise;
  }

  async persist() {
    const dir = this.filePath.replace(/[\\/][^\\/]+$/, '');
    await this.fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid || 0}-${Date.now()}`;
    await this.fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    await this.fs.rename(tmp, this.filePath);
  }

  async loadAll() {
    await this.ensureLoaded();
    return {
      schemaVersion: this.state.schemaVersion,
      leads: this.state.leads.map(lead => ({ ...lead })),
      deletedIds: [...this.state.deletedIds],
      authorizedUsers: this.state.authorizedUsers.map(user => ({ ...user }))
    };
  }

  async getLead(id) {
    await this.ensureLoaded();
    const lead = this.state.leads.find(item => item.id === id);
    return lead ? { ...lead } : null;
  }

  async nextLeadNumber() {
    return this.withLock(async () => {
      await this.ensureLoaded();
      this.state.counter = (Number(this.state.counter) || 100) + 1;
      await this.persist();
      return String(this.state.counter);
    });
  }

  async insertLead(lead) {
    return this.withLock(async () => {
      await this.ensureLoaded();
      this.state.leads.unshift({ ...lead });
      await this.persist();
      return lead;
    });
  }

  async updateLead(id, patch) {
    return this.withLock(async () => {
      await this.ensureLoaded();
      const index = this.state.leads.findIndex(lead => lead.id === id);
      if (index === -1) return null;
      this.state.leads[index] = { ...this.state.leads[index], ...patch, updatedAt: new Date().toISOString() };
      await this.persist();
      return { ...this.state.leads[index] };
    });
  }

  async deleteLead(id, deletedBy = null) {
    return this.withLock(async () => {
      await this.ensureLoaded();
      const before = this.state.leads.length;
      this.state.leads = this.state.leads.filter(lead => lead.id !== id);
      if (this.state.leads.length === before) return false;
      if (!this.state.deletedIds.includes(id)) this.state.deletedIds.push(id);
      void deletedBy;
      await this.persist();
      return true;
    });
  }

  /* ------------------- Сессии и коды входа ------------------- */

  /** Общий шаблон для изменяющих операций: блокировка → правка → запись на диск. */
  async updateState(mutator) {
    return this.withLock(async () => {
      await this.ensureLoaded();
      const result = await mutator();
      await this.persist();
      return result;
    });
  }

  async saveLoginCode(record) {
    return this.updateState(() => {
      this.state.loginCodes = this.state.loginCodes.filter(item => item.code !== record.code);
      this.state.loginCodes.push({ ...record });
      return true;
    });
  }

  async getLoginCode(code) {
    await this.ensureLoaded();
    const found = this.state.loginCodes.find(item => item.code === code);
    return found ? { ...found } : null;
  }

  async getLoginCodeByToken(tokenHash) {
    await this.ensureLoaded();
    const found = [...this.state.loginCodes].reverse().find(item => item.tokenHash === tokenHash);
    return found ? { ...found } : null;
  }

  async countLoginCodes(ip, sinceIso) {
    await this.ensureLoaded();
    return this.state.loginCodes.filter(item => item.ip === ip && item.createdAt >= sinceIso).length;
  }

  async confirmLoginCode(code, { telegramId, username, name, at }) {
    return this.updateState(() => {
      const record = this.state.loginCodes.find(item => item.code === code);
      if (!record || record.usedAt || record.confirmedAt) return false;
      Object.assign(record, { confirmedAt: at, telegramId, username, name });
      return true;
    });
  }

  async consumeLoginCode(code, tokenHash, usedAt) {
    return this.updateState(() => {
      const record = this.state.loginCodes.find(item => item.code === code);
      if (!record || record.tokenHash !== tokenHash || record.usedAt || !record.confirmedAt) return false;
      record.usedAt = usedAt;
      return true;
    });
  }

  async deleteLoginCode(code) {
    return this.updateState(() => {
      this.state.loginCodes = this.state.loginCodes.filter(item => item.code !== code);
      return true;
    });
  }

  async deleteExpiredLoginCodes(beforeIso) {
    return this.updateState(() => {
      const before = this.state.loginCodes.length;
      this.state.loginCodes = this.state.loginCodes.filter(item => item.createdAt >= beforeIso);
      return before - this.state.loginCodes.length;
    });
  }

  async createSession(record) {
    return this.updateState(() => {
      this.state.sessions = this.state.sessions.filter(item => item.id !== record.id);
      this.state.sessions.push({ ...record });
      return true;
    });
  }

  async getSession(id) {
    await this.ensureLoaded();
    const found = this.state.sessions.find(item => item.id === id);
    return found ? { ...found } : null;
  }

  async touchSession(id, { lastSeenAt, expiresAt }) {
    return this.updateState(() => {
      const record = this.state.sessions.find(item => item.id === id);
      if (!record) return false;
      Object.assign(record, { lastSeenAt, expiresAt });
      return true;
    });
  }

  async revokeSession(id) {
    return this.updateState(() => {
      const record = this.state.sessions.find(item => item.id === id);
      if (record) record.revoked = true;
      return Boolean(record);
    });
  }

  async revokeUserSessions(telegramId) {
    return this.updateState(() => {
      let count = 0;
      for (const record of this.state.sessions) {
        if (record.telegramId === telegramId && !record.revoked) {
          record.revoked = true;
          count += 1;
        }
      }
      return count;
    });
  }

  async countActiveSessions(telegramId, nowIso) {
    await this.ensureLoaded();
    return this.state.sessions.filter(item => item.telegramId === telegramId && !item.revoked && item.expiresAt > nowIso).length;
  }

  async deleteExpiredSessions(beforeIso) {
    return this.updateState(() => {
      this.state.sessions = this.state.sessions.filter(item => item.expiresAt >= beforeIso);
      return true;
    });
  }

  async replaceUsers(users) {
    return this.withLock(async () => {
      await this.ensureLoaded();
      this.state.authorizedUsers = users.map(user => ({ ...user }));
      await this.persist();
    });
  }

  async listEmployees() {
    await this.ensureLoaded();
    return this.state.employees.map(employee => ({ ...employee }));
  }

  async upsertEmployee(employee) {
    return this.withLock(async () => {
      await this.ensureLoaded();
      const index = this.state.employees.findIndex(item => item.id === employee.id);
      if (index === -1) this.state.employees.push({ ...employee });
      else this.state.employees[index] = { ...employee };
      await this.persist();
      return employee;
    });
  }

  async deleteEmployee(id) {
    return this.withLock(async () => {
      await this.ensureLoaded();
      const before = this.state.employees.length;
      this.state.employees = this.state.employees.filter(employee => employee.id !== id);
      if (this.state.employees.length === before) return false;
      await this.persist();
      return true;
    });
  }

  /** Импорт данных из прежнего публичного JSON-бина. */
  async importLegacySnapshot(snapshot) {
    return this.withLock(async () => {
      await this.ensureLoaded();
      if (this.state.leads.length > 0) {
        return { imported: 0, skipped: true, reason: 'В локальном хранилище уже есть заявки' };
      }
      let imported = 0;
      for (const raw of snapshot.leads || []) {
        const lead = normalizeStoredLead(raw);
        if (!lead) continue;
        this.state.leads.push(lead);
        imported += 1;
      }
      this.state.deletedIds = Array.from(new Set([...this.state.deletedIds, ...(snapshot.deletedIds || [])]));
      if (Array.isArray(snapshot.authorizedUsers) && snapshot.authorizedUsers.length) {
        this.state.authorizedUsers = snapshot.authorizedUsers;
      }
      const maxNumber = this.state.leads.reduce((max, lead) => {
        const num = Number.parseInt(lead.leadNumber, 10);
        return Number.isFinite(num) && num > max ? num : max;
      }, 100);
      this.state.counter = maxNumber;
      await this.persist();
      return { imported, skipped: false };
    });
  }
}

/** Хранилище в памяти — для юнит-тестов. */
export class MemoryStore {
  constructor(seed = {}) {
    this.kind = 'memory';
    this.writable = true;
    this.leads = (seed.leads || []).map(normalizeStoredLead).filter(Boolean);
    this.deletedIds = seed.deletedIds || [];
    this.authorizedUsers = seed.authorizedUsers || [];
    this.employees = seed.employees || [];
    this.loginCodes = seed.loginCodes || [];
    this.sessions = seed.sessions || [];
    this.counter = 100 + this.leads.length;
  }

  async loadAll() {
    return {
      schemaVersion: SCHEMA_VERSION,
      leads: this.leads.map(lead => ({ ...lead })),
      deletedIds: [...this.deletedIds],
      authorizedUsers: this.authorizedUsers.map(user => ({ ...user }))
    };
  }

  async nextLeadNumber() {
    this.counter += 1;
    return String(this.counter);
  }

  async insertLead(lead) {
    this.leads.unshift({ ...lead });
    return lead;
  }

  async updateLead(id, patch) {
    const index = this.leads.findIndex(lead => lead.id === id);
    if (index === -1) return null;
    this.leads[index] = { ...this.leads[index], ...patch, updatedAt: new Date().toISOString() };
    return this.leads[index];
  }

  async deleteLead(id) {
    const before = this.leads.length;
    this.leads = this.leads.filter(lead => lead.id !== id);
    if (this.leads.length === before) return false;
    if (!this.deletedIds.includes(id)) this.deletedIds.push(id);
    return true;
  }

  async replaceUsers(users) {
    this.authorizedUsers = users.map(user => ({ ...user }));
  }

  /* ------------------- Сессии и коды входа ------------------- */

  async saveLoginCode(record) {
    this.loginCodes = this.loginCodes.filter(item => item.code !== record.code);
    this.loginCodes.push({ ...record });
    return true;
  }

  async getLoginCode(code) {
    const found = this.loginCodes.find(item => item.code === code);
    return found ? { ...found } : null;
  }

  async getLoginCodeByToken(tokenHash) {
    const found = [...this.loginCodes].reverse().find(item => item.tokenHash === tokenHash);
    return found ? { ...found } : null;
  }

  async countLoginCodes(ip, sinceIso) {
    return this.loginCodes.filter(item => item.ip === ip && item.createdAt >= sinceIso).length;
  }

  async confirmLoginCode(code, { telegramId, username, name, at }) {
    const record = this.loginCodes.find(item => item.code === code);
    if (!record || record.usedAt || record.confirmedAt) return false;
    Object.assign(record, { confirmedAt: at, telegramId, username, name });
    return true;
  }

  async consumeLoginCode(code, tokenHash, usedAt) {
    const record = this.loginCodes.find(item => item.code === code);
    if (!record || record.tokenHash !== tokenHash || record.usedAt || !record.confirmedAt) return false;
    record.usedAt = usedAt;
    return true;
  }

  async deleteLoginCode(code) {
    this.loginCodes = this.loginCodes.filter(item => item.code !== code);
    return true;
  }

  async deleteExpiredLoginCodes(beforeIso) {
    const before = this.loginCodes.length;
    this.loginCodes = this.loginCodes.filter(item => item.createdAt >= beforeIso);
    return before - this.loginCodes.length;
  }

  async createSession(record) {
    this.sessions = this.sessions.filter(item => item.id !== record.id);
    this.sessions.push({ ...record });
    return true;
  }

  async getSession(id) {
    const found = this.sessions.find(item => item.id === id);
    return found ? { ...found } : null;
  }

  async touchSession(id, { lastSeenAt, expiresAt }) {
    const record = this.sessions.find(item => item.id === id);
    if (!record) return false;
    Object.assign(record, { lastSeenAt, expiresAt });
    return true;
  }

  async revokeSession(id) {
    const record = this.sessions.find(item => item.id === id);
    if (record) record.revoked = true;
    return Boolean(record);
  }

  async revokeUserSessions(telegramId) {
    let count = 0;
    for (const record of this.sessions) {
      if (record.telegramId === telegramId && !record.revoked) {
        record.revoked = true;
        count += 1;
      }
    }
    return count;
  }

  async countActiveSessions(telegramId, nowIso) {
    return this.sessions.filter(item => item.telegramId === telegramId && !item.revoked && item.expiresAt > nowIso).length;
  }

  async deleteExpiredSessions(beforeIso) {
    this.sessions = this.sessions.filter(item => item.expiresAt >= beforeIso);
    return true;
  }

  async listEmployees() {
    return this.employees.map(employee => ({ ...employee }));
  }

  async upsertEmployee(employee) {
    const index = this.employees.findIndex(item => item.id === employee.id);
    if (index === -1) this.employees.push({ ...employee });
    else this.employees[index] = { ...employee };
    return employee;
  }

  async deleteEmployee(id) {
    const before = this.employees.length;
    this.employees = this.employees.filter(employee => employee.id !== id);
    return this.employees.length !== before;
  }
}

/** Выбирает хранилище по доступному окружению. */
export async function createStore(env = {}) {
  if (env.DB && typeof env.DB.prepare === 'function') {
    return D1Store.create(env.DB);
  }
  if (env.STORE && typeof env.STORE.loadAll === 'function') {
    return env.STORE;
  }
  return new LegacyReadOnlyStore(env.LEGACY_STORE_URL || LEGACY_STORE_URL);
}

/**
 * Хранилище для локальной разработки на Node: JSON-файл с атомарной записью.
 * @param {string} filePath
 * @param {object} fsPromises — модуль node:fs/promises
 */
export function createJsonFileStore(filePath, fsPromises) {
  return new JsonFileStore(filePath, fsPromises);
}
