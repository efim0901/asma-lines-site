/**
 * ASMA Lines — Cloudflare Worker (production entry point).
 *
 * Общий код (доступ, браузерный вход, QR) берётся из `_shared/*`: и Worker,
 * и локальный сервер, и тесты используют одни модули, поэтому две
 * реализации не разойдутся. Wrangler собирает их в бандл, а `.assetsignore`
 * не даёт отдать эти файлы как статику.
 *
 * Что исправлено по сравнению с прежней версией:
 *  - нет захардкоженных секретов (токен бота, chat_id, id админа, PIN-коды);
 *  - нет обхода авторизации (`plombit`, `2026`, любые `asma_sess_*`);
 *  - данные хранятся в D1, а не в публичном внешнем JSON-бине;
 *  - вебхук Telegram проверяется по секрету;
 *  - роуты карты, геокодинга, маршрута и CRUD заявок больше не отдают 404;
 *  - цена пересчитывается на сервере, значение из запроса игнорируется;
 *  - CORS ограничен списком доменов, добавлены rate-limit и /api/health.
 *
 * Инструкция по настройке: DEPLOY-CLOUDFLARE.md
 */

import {
  SESSION_COOKIE,
  authenticateOperator,
  cancelLoginCode,
  checkCsrf,
  clearedSessionCookieHeader,
  confirmLoginCode,
  describeDevice,
  describePlace,
  formatLoginCode,
  formatLoginTime,
  hashToken,
  loginConfirmText,
  loginState,
  logoutSession,
  normalizeLoginCode,
  parseCookies,
  readHeaderValue,
  sessionCookieHeader,
  startLogin
} from './_shared/sessions.js';
import { qrSvg } from './_shared/qr.js';
import { SESSION_SCHEMA_STATEMENTS, withLoginSupport } from './_shared/store.js';
import {
  ValidationError,
  AuthError,
  ConfigError,
  escapeHtml,
  clampText,
  normalizeBelarusPhone,
  isValidStatus,
  LEAD_STATUSES,
  LEAD_STATUS_NAMES,
  sanitizeNotes
} from './_shared/core.js';
import {
  RATES,
  WEIGHT_TIERS,
  LIMITS as PRICE_LIMITS,
  vehicleForWeight,
  calculatePrice
} from './_shared/pricing.js';
import {
  LEAD_LIMITS,
  parseRouteDetails,
  normalizeContact,
  normalizeLead
} from './_shared/validation.js';
import {
  buildLeadMessage
} from './_shared/notify.js';
import {
  readAccessConfig,
  isUserAuthorized,
  isUserAdmin,
  verifyWebhookSecret,
  createDocTicket,
  verifyDocTicket,
  callTelegramApi,
  timingSafeEqual
} from './_shared/telegram.js';

/* Имя бота для ссылки входа: в Cloudflare задаётся TELEGRAM_BOT_USERNAME. */
const DEFAULT_BOT_USERNAME = 'asmalinesbot';

/**
 * Авторизация запроса к диспетчерской. Работают два входа:
 *  - Telegram WebApp присылает подписанный initData (телефон),
 *  - браузер — сессионную cookie, выданную по коду через бота (ПК).
 * Для запросов с cookie дополнительно проверяются источник и заголовок
 * X-Requested-With (защита от CSRF).
 */
function requireOperator(request, data, store, config) {
  return authenticateOperator({
    headers: request.headers,
    method: request.method,
    url: request.url,
    data,
    store,
    config
  });
}

async function requireUser(request, data, store, config) {
  return (await requireOperator(request, data, store, config)).user;
}

async function requireAdmin(request, data, store, config) {
  const user = await requireUser(request, data, store, config);
  if (!isUserAdmin(user, data.authorizedUsers, config)) {
    throw new AuthError('Действие доступно только администратору', 403);
  }
  return user;
}

/** Бот сообщает оператору о новом браузерном входе — неожиданный вход виден. */
async function notifyLogin(user, { config, userAgent, place }) {
  if (!config.botToken || !user?.id) return;
  try {
    await callTelegramApi(config, 'sendMessage', {
      chat_id: String(user.id),
      parse_mode: 'HTML',
      text:
        '🔓 <b>Вход в диспетчерскую с компьютера</b>\n' +
        '───────────────────────\n' +
        `Устройство: ${escapeHtml(describeDevice(userAgent))}\n` +
        `Место: ${escapeHtml(place || 'неизвестно')}\n` +
        `Время: ${escapeHtml(formatLoginTime(new Date().toISOString()))}\n\n` +
        'Если это не вы — отправьте /logout: все входы закроются.'
    });
  } catch (error) {
    console.error('login notify failed:', error.message);
  }
}

/** Ссылка на бота с кодом входа — её же кодирует QR на экране входа. */
function loginDeepLink(code, env = {}) {
  const username = String(env.TELEGRAM_BOT_USERNAME || DEFAULT_BOT_USERNAME).replace(/^@/, '');
  return `https://t.me/${username}?start=login_${normalizeLoginCode(code)}`;
}

/* ================================================================== */
/* ХРАНИЛИЩЕ: D1                                                      */
/* ================================================================== */

const SCHEMA_VERSION = 2;
const LEGACY_STORE_URL = 'https://json.extendsclass.com/bin/becdbda';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY, lead_number TEXT, status TEXT NOT NULL DEFAULT 'new', type TEXT, category TEXT,
    name TEXT, company TEXT, contact TEXT, contact_raw TEXT, email TEXT, from_city TEXT, to_city TEXT,
    route TEXT, distance TEXT, distance_km REAL, vehicle TEXT, weight TEXT, weight_tons REAL,
    volume TEXT, volume_m3 REAL, price TEXT, price_value INTEGER, price_breakdown TEXT, comment TEXT,
    cargo TEXT, loading INTEGER DEFAULT 0, source TEXT, assigned_to TEXT, priority TEXT DEFAULT 'normal',
    dispatcher TEXT, direction TEXT, topic TEXT, preferred_channel TEXT, notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_leads_number ON leads(lead_number DESC)',
  'CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)',
  'CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC)',
  `CREATE TABLE IF NOT EXISTS deleted_leads (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, deleted_by TEXT)`,
  `CREATE TABLE IF NOT EXISTS access_users (
    id TEXT PRIMARY KEY, telegram_id TEXT, username TEXT, name TEXT, role TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_access_username ON access_users(username)',
  `CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY, name TEXT, role TEXT, telegram_id TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  // Таблицы браузерного входа — из общего списка, чтобы определения не расходились.
  ...SESSION_SCHEMA_STATEMENTS
];

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

function rowToLead(row) {
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

function leadToParams(lead) {
  return [
    lead.id, lead.leadNumber ?? null, lead.status || 'new', lead.type || 'cargo', lead.category || '',
    lead.name || '', lead.company || '', lead.contact || '', lead.contactRaw || '', lead.email || '',
    lead.fromCity || '', lead.toCity || '', lead.route || '', lead.distance || '', lead.distanceKm ?? null,
    lead.vehicle || '', lead.weight || '', lead.weightTons ?? null, lead.volume || '', lead.volumeM3 ?? null,
    lead.price || '', lead.priceValue ?? null, JSON.stringify(lead.priceBreakdown || []), lead.comment || '',
    lead.cargo || 'standard', lead.loading ? 1 : 0, lead.source || '', lead.assignedTo ?? null,
    lead.priority || 'normal', lead.dispatcher || '', lead.direction || '', lead.topic || '',
    lead.preferredChannel || '', JSON.stringify(sanitizeNotes(lead.notes)),
    lead.createdAt || new Date().toISOString(), lead.updatedAt || lead.createdAt || new Date().toISOString()
  ];
}

/** Хранилище на D1. */
class D1Store {
  constructor(db) {
    this.db = db;
    this.kind = 'd1';
    this.writable = true;
    this.schemaReady = false;
  }

  async ensureSchema() {
    if (this.schemaReady) return;
    await this.db.batch(SCHEMA_STATEMENTS.map(sql => this.db.prepare(sql)));
    await this.db
      .prepare("INSERT INTO counters (name, value) VALUES ('lead_number', 100) ON CONFLICT(name) DO NOTHING")
      .run();
    this.schemaReady = true;
  }

  async loadAll() {
    await this.ensureSchema();
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
    await this.ensureSchema();
    const row = await this.db.prepare('SELECT * FROM leads WHERE id = ?').bind(String(id)).first();
    return rowToLead(row);
  }

  /** Атомарная выдача номера: UPDATE ... value = value + 1. */
  async nextLeadNumber() {
    await this.ensureSchema();
    await this.db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'lead_number'").run();
    const row = await this.db.prepare("SELECT value FROM counters WHERE name = 'lead_number'").first();
    return String(row?.value ?? '');
  }

  async insertLead(lead) {
    await this.ensureSchema();
    const placeholders = LEAD_COLUMNS.map(() => '?').join(', ');
    await this.db
      .prepare(`INSERT INTO leads (${LEAD_COLUMNS.join(', ')}) VALUES (${placeholders})`)
      .bind(...leadToParams(lead))
      .run();
    return lead;
  }

  /** Обновляет ТОЛЬКО разрешённые поля — защита от mass assignment. */
  async updateLead(id, patch) {
    await this.ensureSchema();
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
      company: 'company'
    };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(allowed)) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, field)) {
        sets.push(`${column} = ?`);
        values.push(field === 'notes' ? JSON.stringify(sanitizeNotes(patch[field])) : (patch[field] ?? null));
      }
    }
    if (!sets.length) return this.getLead(id);
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(String(id));
    const result = await this.db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
    if (result.meta && result.meta.changes === 0) return null;
    return this.getLead(id);
  }

  async deleteLead(id, deletedBy = null) {
    await this.ensureSchema();
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

  async replaceUsers(users) {
    await this.ensureSchema();
    const statements = [this.db.prepare('DELETE FROM access_users')];
    for (const user of users) {
      const telegramId = user.id ? String(user.id) : null;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO access_users (id, telegram_id, username, name, role, is_admin, added_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            telegramId || `u-${String(user.username || '').toLowerCase()}`,
            telegramId,
            user.username || null,
            clampText(user.name || '', 100),
            clampText(user.role || 'Диспетчер', 60),
            user.isAdmin ? 1 : 0,
            user.addedAt || new Date().toISOString()
          )
      );
    }
    await this.db.batch(statements);
  }

  async listEmployees() {
    await this.ensureSchema();
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
    await this.ensureSchema();
    await this.db
      .prepare(
        `INSERT INTO employees (id, name, role, telegram_id, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, telegram_id = excluded.telegram_id`
      )
      .bind(employee.id, employee.name, employee.role, employee.telegramId, employee.createdAt)
      .run();
    return employee;
  }

  async deleteEmployee(id) {
    await this.ensureSchema();
    const result = await this.db.prepare('DELETE FROM employees WHERE id = ?').bind(String(id)).run();
    return Boolean(result.meta && result.meta.changes > 0);
  }

  /** Разовая миграция из прежнего публичного JSON-бина. */
  async importLegacySnapshot(snapshot) {
    await this.ensureSchema();
    if (!snapshot || typeof snapshot !== 'object') throw new ValidationError('Пустой снапшот');
    const existing = await this.db.prepare('SELECT COUNT(*) AS count FROM leads').first();
    if (existing && Number(existing.count) > 0) {
      return { imported: 0, skipped: true, reason: 'В D1 уже есть заявки — импорт пропущен' };
    }
    let imported = 0;
    for (const raw of snapshot.leads || []) {
      if (!raw || typeof raw !== 'object') continue;
      await this.insertLead({
        ...raw,
        id: String(raw.id || `lead-${crypto.randomUUID()}`),
        leadNumber: raw.leadNumber !== undefined ? String(raw.leadNumber) : '',
        status: raw.status || 'new',
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
      });
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
    const maxRow = await this.db.prepare('SELECT MAX(CAST(lead_number AS INTEGER)) AS max_number FROM leads').first();
    await this.db
      .prepare("UPDATE counters SET value = ? WHERE name = 'lead_number'")
      .bind(Number(maxRow?.max_number || 100))
      .run();
    return { imported, skipped: false };
  }
}

/** Хранилище только для чтения поверх старого бина: пока D1 не настроен, сайт жив. */
class LegacyReadOnlyStore {
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
      leads: Array.isArray(json.leads) ? json.leads : [],
      deletedIds: Array.isArray(json.deletedIds) ? json.deletedIds : [],
      authorizedUsers: Array.isArray(json.authorizedUsers) ? json.authorizedUsers : []
    };
  }

  async listEmployees() {
    return [];
  }

  _readOnly() {
    throw new ConfigError('Запись недоступна: не настроен биндинг D1 (переменная DB). См. DEPLOY-CLOUDFLARE.md');
  }

  async nextLeadNumber() {
    return this._readOnly();
  }
  async insertLead() {
    return this._readOnly();
  }
  async updateLead() {
    return this._readOnly();
  }
  async deleteLead() {
    return this._readOnly();
  }
  async replaceUsers() {
    return this._readOnly();
  }
  async upsertEmployee() {
    return this._readOnly();
  }
  async deleteEmployee() {
    return this._readOnly();
  }
}

/* Методы сессий и кодов входа те же, что в _shared/store.js: копируем их
   на локальный класс, чтобы не поддерживать две реализации входа. */
withLoginSupport(D1Store);

async function createStore(env = {}) {
  if (env.DB && typeof env.DB.prepare === 'function') return new D1Store(env.DB);
  if (env.STORE && typeof env.STORE.loadAll === 'function') return env.STORE;
  return new LegacyReadOnlyStore(env.LEGACY_STORE_URL || LEGACY_STORE_URL);
}

/* ================================================================== */
/* ГЕО: ГЕОКОДИНГ, МАРШРУТ, ТАЙЛЫ                                      */
/* ================================================================== */

const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = 'ASMALines-Logistics/1.0 (+https://asma-lines-site.firws.workers.dev; info@asmalines.by)';

class BoundedCache {
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }
  get(key) {
    return this.map.get(key);
  }
  set(key, value) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
    return value;
  }
}

const geocodeCache = new BoundedCache(1000);
const routeCache = new BoundedCache(500);
const tileCache = new BoundedCache(300);

const fetchWithTimeout = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

async function geocode(query, env = {}) {
  const q = clampText(String(query || '').trim(), 120);
  if (!q) return null;
  const cacheKey = q.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const apiKey = env.YANDEX_MAPS_API_KEY || env.YANDEX_GEOCODER_KEY || '';
  if (apiKey) {
    try {
      const response = await fetchWithTimeout(
        `https://geocode-maps.yandex.ru/1.x/?apikey=${encodeURIComponent(apiKey)}` +
          `&geocode=${encodeURIComponent(`${q}, Беларусь`)}&format=json&results=1`
      );
      if (response.ok) {
        const data = await response.json();
        const feature = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
        if (feature?.Point?.pos) {
          const [lonStr, latStr] = feature.Point.pos.split(' ');
          const place = {
            lat: Number.parseFloat(latStr),
            lon: Number.parseFloat(lonStr),
            name: feature.name || q.split(',')[0].trim()
          };
          if (Number.isFinite(place.lat) && Number.isFinite(place.lon)) return geocodeCache.set(cacheKey, place);
        }
      }
    } catch {
      /* уходим в фолбэк */
    }
  }

  try {
    const response = await fetchWithTimeout(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=by' +
        `&accept-language=ru&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': USER_AGENT } }
    );
    if (!response.ok) return geocodeCache.set(cacheKey, null);
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const place = row
      ? {
          lat: Number.parseFloat(row.lat),
          lon: Number.parseFloat(row.lon),
          name: String(row.display_name || q).split(',')[0].trim()
        }
      : null;
    return geocodeCache.set(cacheKey, place);
  } catch {
    return null;
  }
}

async function route(from, to) {
  const cacheKey = `${from}|${to}`;
  const cached = routeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const response = await fetchWithTimeout(
      `https://router.project-osrm.org/route/v1/driving/${encodeURIComponent(from)};` +
        `${encodeURIComponent(to)}?overview=full&geometries=geojson`,
      { headers: { 'User-Agent': USER_AGENT } }
    );
    if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
    const data = await response.json();
    const routeData = data?.routes?.[0];
    if (!routeData) throw new Error('OSRM не вернул маршрут');
    return routeCache.set(cacheKey, {
      km: routeData.distance / 1000,
      coords: routeData.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      approx: false
    });
  } catch (error) {
    throw new Error(`Не удалось построить маршрут: ${error.message}`);
  }
}

const TILE_SUBDOMAINS = ['a', 'b', 'c'];

async function fetchTile(z, x, y) {
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);
  const max = 2 ** zi;
  if (![zi, xi, yi].every(Number.isInteger) || zi < 0 || zi > 19 || xi < 0 || xi >= max || yi < 0 || yi >= max) {
    return null;
  }
  const cacheKey = `${zi}/${xi}/${yi}`;
  const cached = tileCache.get(cacheKey);
  if (cached) return cached;

  const subdomain = TILE_SUBDOMAINS[(xi + yi) % TILE_SUBDOMAINS.length];
  const response = await fetchWithTimeout(`https://${subdomain}.tile.openstreetmap.org/${zi}/${xi}/${yi}.png`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) return null;
  return tileCache.set(cacheKey, await response.arrayBuffer());
}

async function setTelegramWebhook(webhookUrl, env = {}) {
  const botToken = String(env.TELEGRAM_BOT_TOKEN || '');
  if (!botToken) throw new ConfigError('TELEGRAM_BOT_TOKEN не задан — регистрация вебхука невозможна');
  // callback_query нужен для кнопок подтверждения входа в браузерную версию.
  const body = { url: webhookUrl, allowed_updates: ['message', 'channel_post', 'callback_query'] };
  if (env.TELEGRAM_WEBHOOK_SECRET) body.secret_token = String(env.TELEGRAM_WEBHOOK_SECRET);
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(`setWebhook failed: ${data.description || response.status}`);
  }
  return { ...data.result, secretConfigured: Boolean(env.TELEGRAM_WEBHOOK_SECRET) };
}

/* ================================================================== */
/* HTTP-СЛОЙ                                                          */
/* ================================================================== */

/**
 * CORS: по умолчанию разрешаем собственный origin запроса, поэтому переезд на
 * другой домен не требует правки кода. Список ALLOWED_ORIGINS нужен только
 * если API должны вызывать сторонние сайты.
 */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data, X-Requested-With'
  };

  if (!origin) return headers; // запрос самого сайта — Origin не приходит

  const ownOrigin = new URL(request.url).origin;
  const allowList = configured.length ? configured : [ownOrigin];
  if (allowList.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      // Правила из `_headers` к ответам, которые формирует Worker, не применяются,
      // поэтому закрываем индексацию прямо здесь.
      'X-Robots-Tag': 'noindex, nofollow',
      ...extraHeaders
    }
  });
}

function errorResponse(error, extraHeaders = {}) {
  // Классы ошибок сравниваем по имени, а не через instanceof: часть проверок
  // живёт в `_shared/*`, и instanceof с локальными классами давал бы 500
  // вместо честных 401/403/400.
  const name = error?.name || '';
  const status =
    name === 'ValidationError' ? 400
      : name === 'AuthError' ? (Number.isInteger(error?.status) ? error.status : 401)
        : name === 'ConfigError' ? 500
          : 500;
  const body = { ok: false, success: false, error: error?.message || 'Внутренняя ошибка сервера' };
  if (error?.field) body.field = error.field;
  if (status === 500) console.error('API error:', error?.stack || error);
  return jsonResponse(body, status, extraHeaders);
}

/* ================================================================== */
/* ЗАГОЛОВКИ ДЛЯ СТАТИКИ                                              */
/* ================================================================== */

/*
 * Почему заголовки заданы здесь, а не только в `_headers`.
 *
 * По документации Cloudflare правила из `_headers` НЕ применяются к ответам,
 * которые формирует код Worker:
 * https://developers.cloudflare.com/workers/static-assets/headers/
 *
 * А этот Worker перехватывает все не-API пути и сам вызывает
 * `env.ASSETS.fetch()`. Из-за этого правило для `/crm.html` не срабатывало,
 * и страница диспетчерской уходила с `frame-ancestors 'none'` — то есть
 * встраивание в Telegram Web было запрещено, хотя задумано обратное.
 *
 * Значения совпадают с `_headers`, чтобы поведение осталось прежним.
 * Заголовки ставятся через `set`, поэтому дублирования не будет.
 */

const CSP_DEFAULT = "default-src 'self'; script-src 'self' https://telegram.org https://api-maps.yandex.ru https://yandex.st https://suggest-maps.yandex.ru 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://*.maps.yandex.net https://api-maps.yandex.ru https://yandex.st https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://server.arcgisonline.com https://*.basemaps.cartocdn.com; connect-src 'self' https://api-maps.yandex.ru https://suggest-maps.yandex.ru https://*.maps.yandex.net https://nominatim.openstreetmap.org https://router.project-osrm.org https://*.tile.openstreetmap.org; frame-src 'self' https://api-maps.yandex.ru; child-src 'self' https://api-maps.yandex.ru blob:; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests";

// Для диспетчерской разрешаем встраивание: Mini App открывается во фрейме
// на web.telegram.org. Список источников уже, чем у обычных страниц.
const CSP_CRM = "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org 'self'; upgrade-insecure-requests";

/** Переносит на ответ статики заголовки, которые раньше задавал `_headers`. */
function withStaticHeaders(response, pathname) {
  const headers = new Headers(response.headers);

  /*
   * Cloudflare нормализует адреса страниц: запрос `/crm.html` приходит в Worker
   * как `/crm` (html_handling = auto-trailing-slash, значение по умолчанию).
   * Из-за этого не срабатывало сравнение с '/crm.html' — и точно так же не
   * срабатывали правила для конкретных путей в `_headers`. Сравниваем адрес
   * без расширения, тогда работают обе формы записи.
   */
  const page = pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');

  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('Content-Security-Policy', CSP_DEFAULT);

  if (page === '/crm') {
    headers.set('Content-Security-Policy', CSP_CRM);
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('Cache-Control', 'no-store');
  } else if (page === '/order-doc' || page === '/proposal') {
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Cache-Control', 'no-store');
  } else if (pathname.startsWith('/assets/brand/') || pathname === '/favicon.ico') {
    headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  } else if (pathname.startsWith('/assets/')) {
    // Эти файлы версионируются через ?v=, поэтому кэш можно держать год.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function readJson(request, maxBytes = 128 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new ValidationError('Слишком большой запрос');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Некорректный JSON в теле запроса');
  }
}

const rateBuckets = new Map();

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    if (rateBuckets.size > 5000) rateBuckets.clear();
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count > limit) return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  return { ok: true };
}

const clientKey = request =>
  request.headers.get('CF-Connecting-IP') ||
  request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
  'unknown';

async function notifyLead(lead, config) {
  if (!config.botToken || !config.chatId) return;
  try {
    await callTelegramApi(config, 'sendMessage', {
      chat_id: config.chatId,
      text: buildLeadMessage(lead),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error('Telegram notify failed:', error.message);
  }
}

/* ================================================================== */
/* КОМАНДЫ БОТА                                                       */
/* ================================================================== */

async function handleBotUpdate(update, { store, config, crmAppUrl }) {
  const chatId =
    update.message?.chat?.id ||
    update.channel_post?.chat?.id ||
    update.edited_message?.chat?.id ||
    update.callback_query?.message?.chat?.id;
  const send = async (text, extra = {}) => {
    if (!config.botToken || !chatId) return;
    try {
      await callTelegramApi(config, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
    } catch (error) {
      console.error('sendMessage failed:', error.message);
    }
  };

  /* Кнопки подтверждения входа (inline-клавиатура в боте). */
  if (update.callback_query) {
    const query = update.callback_query;
    const from = query.from || {};
    const answer = async (text) => {
      if (!config.botToken) return undefined;
      try {
        await callTelegramApi(config, 'answerCallbackQuery', { callback_query_id: query.id, text: text || undefined });
      } catch {
        /* некритично */
      }
      return undefined;
    };
    const editText = async (text) => {
      if (!config.botToken || !chatId || !query.message?.message_id) return;
      try {
        await callTelegramApi(config, 'editMessageText', {
          chat_id: chatId,
          message_id: query.message.message_id,
          text,
          parse_mode: 'HTML'
        });
      } catch (error) {
        console.error('editMessageText failed:', error.message);
      }
    };

    const match = String(query.data || '').match(/^login:(ok|no):(\d{6})$/);
    if (!match) return answer('');

    const callerData = await store.loadAll();
    if (!isUserAuthorized({ id: from.id, username: from.username }, callerData.authorizedUsers, config)) {
      return answer('У вас нет доступа к диспетчерской');
    }

    if (match[1] === 'no') {
      await cancelLoginCode({ store, code: match[2] });
      await answer('Вход отменён');
      await editText('⛔ <b>Вход отменён</b>\n\nЕсли это были не вы — сообщите администратору и отправьте /logout.');
      return undefined;
    }

    const confirmed = await confirmLoginCode({ store, code: match[2], user: from });
    if (!confirmed.ok) {
      const reasons = {
        invalid: 'Код не распознан — начните вход заново в браузере.',
        'not-found': 'Код не найден — обновите страницу входа и получите новый.',
        used: 'Этот код уже использован.',
        expired: 'Код истёк (живёт 5 минут) — получите новый на странице входа.',
        'already-confirmed': 'Код уже подтверждён — вернитесь в браузер.'
      };
      await answer(reasons[confirmed.reason] || 'Не удалось подтвердить вход');
      return undefined;
    }

    await answer('Вход подтверждён');
    await editText('✅ <b>Вход подтверждён</b>\n\nВернитесь в браузер — диспетчерская откроется сама.');
    return undefined;
  }

  const message = update.message || update.channel_post || update.edited_message;
  if (!message?.text) return;

  const from = message.from || message.chat || {};
  const senderId = String(from.id || '');
  const senderUsername = String(from.username || '').replace(/^@/, '');
  const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || senderUsername || 'Диспетчер';
  const text = String(message.text).trim().replace(/@\w+bot/i, '').trim();

  const storeData = await store.loadAll();
  const pseudoUser = { id: senderId, username: senderUsername };
  const authorized = isUserAuthorized(pseudoUser, storeData.authorizedUsers, config);
  const admin = isUserAdmin(pseudoUser, storeData.authorizedUsers, config);
  const crmButton = { reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть CRM', web_app: { url: crmAppUrl } }]] } };

  if (text.startsWith('/test') || text.startsWith('/ping')) {
    return send(
      `⚡ <b>Диагностика бота ASMA Lines</b>\n` +
        `───────────────────────\n` +
        `✅ <b>Статус:</b> Worker работает на Cloudflare\n` +
        `🔑 <b>Токен:</b> ${config.botToken ? 'настроен' : 'ОТСУТСТВУЕТ'}\n` +
        `🗄 <b>Хранилище:</b> ${store.kind}\n` +
        `👤 <b>Профиль:</b> @${escapeHtml(senderUsername || 'нет юзернейма')} (ID: <code>${escapeHtml(senderId)}</code>)\n` +
        `🛡 <b>Доступ:</b> ${authorized ? 'разрешён ✅' : 'ограничен ⛔'}\n` +
        `👑 <b>Администратор:</b> ${admin ? 'да ⭐' : 'нет'}\n` +
        `🌐 <b>CRM:</b> <code>${escapeHtml(crmAppUrl)}</code>\n` +
        `⏱ <b>Время:</b> ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}`
    );
  }

  /* Вход в браузерную версию: ссылка /start login_482173 или команда /login 482-173. */
  const startLoginMatch = text.match(/^\/start\s+login_(\d{3}-?\d{3})$/i);
  const loginCommandMatch = text.match(/^\/login(?:\s+(.+))?$/i);
  if (startLoginMatch || loginCommandMatch) {
    if (!authorized) {
      return send(
        `⛔ <b>Доступ ограничен</b>\n\n` +
          `Ваш профиль (@${escapeHtml(senderUsername || 'нет юзернейма')}, ID: <code>${escapeHtml(senderId)}</code>) ` +
          'не найден в списке диспетчеров ASMA Lines.'
      );
    }
    const code = normalizeLoginCode(startLoginMatch ? startLoginMatch[1] : loginCommandMatch[1] || '');
    if (!code) {
      return send(
        'ℹ️ <b>Вход с компьютера</b>\n\nОткройте диспетчерскую в браузере — на экране входа будет код.\n' +
          'Подтвердить его можно так: <code>/login 482-173</code>'
      );
    }
    const record = await store.getLoginCode(code);
    if (!record) return send('❓ Код не найден. Обновите страницу входа в браузере и получите новый.');
    if (record.usedAt) return send('⚠️ Этот код уже использован. Обновите страницу входа.');
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      return send('⌛️ Код истёк — он живёт 5 минут. Обновите страницу входа и получите новый.');
    }
    if (record.confirmedAt) return send('✅ Этот код уже подтверждён — вернитесь в браузер.');
    return send(loginConfirmText(record), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Подтвердить вход', callback_data: `login:ok:${code}` }],
          [{ text: '⛔ Это не я', callback_data: `login:no:${code}` }]
        ]
      }
    });
  }

  if (text.startsWith('/logout')) {
    if (!authorized) return send('⛔ У вас нет доступа к этой команде.');
    const revoked = await store.revokeUserSessions(senderId);
    return send(
      revoked
        ? `🔒 <b>Сессии закрыты</b>\n\nОтозвано входов: ${revoked}. Чтобы войти снова, подтвердите новый код в боте.`
        : '🔒 <b>Активных браузерных сессий нет</b>'
    );
  }

  if (['/start', '/crm', '/app', '/help'].some(cmd => text.startsWith(cmd)) || text.toLowerCase() === 'диспетчерская') {
    if (!authorized) {
      return send(
        `⛔ <b>Доступ ограничен</b>\n\n` +
          `Ваш профиль (@${escapeHtml(senderUsername || 'нет юзернейма')}, ID: <code>${escapeHtml(senderId)}</code>) ` +
          `не найден в списке диспетчеров ASMA Lines.\n\nПередайте администратору этот ID для получения доступа.`
      );
    }
    let reply =
      `🚛 <b>Диспетчерская ASMA Lines</b>\n\n` +
      `Здравствуйте, <b>${escapeHtml(senderName)}</b>!\n` +
      `Система управления заявками готова к работе.\n\n` +
      `💻 <b>С компьютера:</b> откройте диспетчерскую в браузере и подтвердите вход кодом (команда /login).`;
    if (admin) {
      reply += `\n\n👑 <b>Управление доступом:</b>\n• <code>/add @username Имя</code>\n• <code>/remove @username</code>\n• <code>/users</code>\n• <code>/test</code>`;
    }
    return send(reply, crmButton);
  }

  if (text.startsWith('/users') || text.startsWith('/access') || text.startsWith('/list')) {
    if (!authorized) return send('⛔ У вас нет доступа к этой команде.');
    let listText = '👥 <b>Список доступа к диспетчерской ASMA Lines</b>\n───────────────────────\n';
    if (!storeData.authorizedUsers.length) {
      listText += '<i>Список пуст. Доступ есть только у главного администратора.</i>\n';
    }
    storeData.authorizedUsers.forEach((user, index) => {
      const label = user.username ? `@${escapeHtml(user.username)}` : `ID: ${escapeHtml(user.id)}`;
      listText += `${index + 1}. <b>${escapeHtml(user.name || 'Сотрудник')}</b> (${label})\n   Роль: ${escapeHtml(user.role || 'Диспетчер')}${user.isAdmin ? ' ⭐' : ''}\n\n`;
    });
    listText += `<i>Всего: ${storeData.authorizedUsers.length}</i>`;
    return send(listText);
  }

  if (text.startsWith('/add')) {
    if (!admin) return send('⛔ Добавлять пользователей может только главный администратор.');
    const parts = text.split(/\s+/).slice(1);
    if (!parts.length) {
      return send('ℹ️ <b>Формат:</b>\n<code>/add @username Имя</code>\nили\n<code>/add 123456789 Имя</code>');
    }
    const rawTarget = parts[0].replace(/^@/, '').trim();
    const isId = /^\d+$/.test(rawTarget);
    const username = isId ? null : rawTarget;
    const id = isId ? rawTarget : null;
    const name = parts.slice(1).join(' ') || rawTarget;

    const exists = storeData.authorizedUsers.some(
      user =>
        (username && String(user.username || '').toLowerCase() === username.toLowerCase()) ||
        (id && String(user.id || '') === id)
    );
    if (exists) return send(`⚠️ <b>${escapeHtml(rawTarget)}</b> уже в списке доступа.`);

    await store.replaceUsers([
      ...storeData.authorizedUsers,
      {
        id,
        username,
        name: clampText(name, 100),
        role: 'Диспетчер',
        isAdmin: false,
        addedAt: new Date().toISOString()
      }
    ]);
    return send(
      `✅ <b>Доступ предоставлен</b>\n\n👤 ${username ? '@' + escapeHtml(username) : 'ID ' + escapeHtml(id)}\n🏷 ${escapeHtml(name)}\n\nСотрудник может открыть диспетчерскую командой /start.`
    );
  }

  if (text.startsWith('/remove') || text.startsWith('/del')) {
    if (!admin) return send('⛔ Отзывать доступ может только главный администратор.');
    const parts = text.split(/\s+/).slice(1);
    if (!parts.length) return send('ℹ️ <b>Формат:</b>\n<code>/remove @username</code>');
    const target = parts[0].replace(/^@/, '').toLowerCase().trim();
    const filtered = storeData.authorizedUsers.filter(user => {
      const userUsername = String(user.username || '').toLowerCase().replace(/^@/, '');
      return userUsername !== target && String(user.id || '') !== target;
    });
    if (filtered.length === storeData.authorizedUsers.length) {
      return send(`❓ <b>${escapeHtml(parts[0])}</b> не найден в списке доступа.`);
    }
    await store.replaceUsers(filtered);
    return send(`🗑 Доступ для <b>${escapeHtml(parts[0])}</b> отозван.`);
  }

  if (message.chat?.type === 'private') {
    return send('🚛 <b>Диспетчерская ASMA Lines</b>\n\nОткройте рабочее место кнопкой ниже или введите /start', crmButton);
  }
}

/* ================================================================== */
/* ОСНОВНОЙ ОБРАБОТЧИК                                                */
/* ================================================================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (!url.pathname.startsWith('/api/')) {
      if (!env.ASSETS) return new Response('Not found', { status: 404 });
      const asset = await env.ASSETS.fetch(request);
      const page = url.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
      const yandexApiKey = String(env.YANDEX_MAPS_API_KEY || env.YANDEX_GEOCODER_KEY || '').trim();
      if ((page === '/calculator' || url.pathname === '/calculator.html') && yandexApiKey && typeof HTMLRewriter !== 'undefined') {
        const rewriter = new HTMLRewriter().on('script[src*="api-maps.yandex.ru"]', {
          element(el) {
            const src = el.getAttribute('src') || '';
            if (src && !src.includes('apikey=')) {
              const sep = src.includes('?') ? '&' : '?';
              el.setAttribute('src', `${src}${sep}apikey=${encodeURIComponent(yandexApiKey)}`);
            }
          }
        });
        return withStaticHeaders(rewriter.transform(asset), url.pathname);
      }
      // Заголовки ставим здесь: `_headers` к ответам Worker не применяется.
      return withStaticHeaders(asset, url.pathname);
    }

    let config;
    let store;
    try {
      config = readAccessConfig(env);
      store = await createStore(env);
    } catch (error) {
      return errorResponse(error, cors);
    }

    try {
      /* ---------------------- Приём заявок ---------------------- */

      if (url.pathname === '/api/lead' && request.method === 'POST') {
        const limit = rateLimit(`lead:${clientKey(request)}`, 10, 60_000);
        if (!limit.ok) {
          return jsonResponse({ ok: false, error: 'Слишком много заявок. Попробуйте через минуту.' }, 429, {
            ...cors,
            'Retry-After': String(limit.retryAfter)
          });
        }
        if (!store.writable) {
          throw new ConfigError('Приём заявок временно недоступен: не настроено хранилище D1. См. DEPLOY-CLOUDFLARE.md');
        }

        const lead = normalizeLead(await readJson(request), { allowTelegramHandle: false });
        lead.id = `lead-${crypto.randomUUID()}`;
        lead.leadNumber = await store.nextLeadNumber();
        lead.status = 'new';
        lead.createdAt = new Date().toISOString();
        lead.updatedAt = lead.createdAt;
        lead.notes = [
          { id: `n-${crypto.randomUUID()}`, author: 'Система', text: `Заявка с сайта (${lead.source})`, time: lead.createdAt }
        ];

        await store.insertLead(lead);
        ctx.waitUntil(notifyLead(lead, config));

        return jsonResponse(
          { ok: true, success: true, message: 'Заявка принята', leadId: lead.id, leadNumber: lead.leadNumber },
          200,
          cors
        );
      }

      /* ---------------------- Браузерный вход ------------------- */

      if (url.pathname === '/api/login/start' && request.method === 'POST') {
        const limit = rateLimit(`login-start:${clientKey(request)}`, 20, 60_000);
        if (!limit.ok) {
          return jsonResponse({ ok: false, error: 'Слишком много запросов' }, 429, {
            ...cors,
            'Retry-After': String(limit.retryAfter)
          });
        }
        const started = await startLogin({
          store,
          ip: clientKey(request),
          userAgent: request.headers.get('user-agent') || '',
          place: describePlace(request.cf)
        });
        return jsonResponse(
          {
            ok: true,
            success: true,
            code: formatLoginCode(started.code),
            token: started.token,
            expiresAt: started.expiresAt,
            deepLink: loginDeepLink(started.code, env)
          },
          200,
          { ...cors, 'Cache-Control': 'no-store' }
        );
      }

      /* QR рисует сервер: ссылка меняется вместе с кодом, а сторонние сервисы
         для этого не нужны. Запрос идёт с секретным токеном опроса. */
      if (url.pathname === '/api/login/qr' && request.method === 'GET') {
        const token = url.searchParams.get('token') || '';
        const record = token ? await store.getLoginCodeByToken(await hashToken(token)) : null;
        const alive = record && !record.usedAt && new Date(record.expiresAt).getTime() > Date.now();
        if (!alive) {
          return new Response('QR-код недоступен', { status: 404, headers: { ...cors, 'Cache-Control': 'no-store' } });
        }
        return new Response(qrSvg(loginDeepLink(record.code, env), { scale: 6, margin: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store', ...cors }
        });
      }

      if (url.pathname === '/api/login/status' && request.method === 'GET') {
        const limit = rateLimit(`login-status:${clientKey(request)}`, 240, 60_000);
        if (!limit.ok) {
          return jsonResponse({ ok: false, error: 'Слишком много запросов' }, 429, {
            ...cors,
            'Retry-After': String(limit.retryAfter)
          });
        }
        const token = url.searchParams.get('token') || '';
        if (!token) throw new ValidationError('Не указан токен опроса', 'token');
        const state = await loginState({
          store,
          token,
          ip: clientKey(request),
          userAgent: request.headers.get('user-agent') || '',
          place: describePlace(request.cf)
        });
        const headers = { ...cors, 'Cache-Control': 'no-store' };
        if (state.status === 'confirmed') {
          headers['Set-Cookie'] = sessionCookieHeader(state.token);
          ctx.waitUntil(notifyLogin(state.user, {
            config,
            userAgent: request.headers.get('user-agent') || '',
            place: describePlace(request.cf)
          }));
        }
        return jsonResponse(
          {
            ok: true,
            success: true,
            status: state.status,
            user: state.user ? { name: state.user.name } : null
          },
          200,
          headers
        );
      }

      /* Выход не требует действующей сессии: важно лишь погасить cookie,
         поэтому проверяется только защита от CSRF. */
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        const csrf = checkCsrf({ method: request.method, headers: request.headers, url: request.url });
        if (!csrf.ok) throw new AuthError(`Запрос отклонён: ${csrf.reason}`, 403);
        const token = parseCookies(readHeaderValue(request.headers, 'cookie'))[SESSION_COOKIE] || '';
        await logoutSession({ store, token });
        return jsonResponse({ ok: true, success: true }, 200, { ...cors, 'Set-Cookie': clearedSessionCookieHeader() });
      }

      /* ------------------------- CRM ---------------------------- */

      if (url.pathname === '/api/crm' || url.pathname === '/api/crm/data') {
        const data = await store.loadAll();
        const auth = await requireOperator(request, data, store, config);
        const user = auth.user;
        // Скользящее продление: клиенту возвращаем обновлённую cookie.
        const corsWithSession =
          auth.via === 'cookie' && auth.sliding && auth.token
            ? { ...cors, 'Set-Cookie': sessionCookieHeader(auth.token) }
            : cors;

        if (request.method === 'GET') {
          return jsonResponse(
            {
              ok: true,
              success: true,
              leads: data.leads,
              deletedIds: data.deletedIds,
              authorizedUsers: data.authorizedUsers,
              user: {
                id: user.id,
                username: user.username,
                name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username
              },
              isAdmin: isUserAdmin(user, data.authorizedUsers, config),
              via: auth.via
            },
            200,
            corsWithSession
          );
        }

        if (request.method === 'POST') {
          const body = await readJson(request);
          const action = String(body.action || '');
          const operatorName =
            [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Диспетчер';

          if (action === 'create') {
            const lead = normalizeLead(body.lead || {}, { allowTelegramHandle: true });
            lead.id = `lead-${crypto.randomUUID()}`;
            lead.leadNumber = await store.nextLeadNumber();
            lead.status = isValidStatus(body.lead?.status) ? body.lead.status : 'new';
            lead.source = lead.source || 'crm_manual';
            // Заявку завёл диспетчер — он же её и ведёт (см. поле «Диспетчер» в CRM).
            lead.dispatcher = operatorName;
            lead.createdAt = new Date().toISOString();
            lead.updatedAt = lead.createdAt;
            lead.notes = [
              { id: `n-${crypto.randomUUID()}`, author: operatorName, text: 'Заявка создана вручную в CRM', time: lead.createdAt }
            ];
            await store.insertLead(lead);
          } else if (action === 'update_status') {
            const status = String(body.status || '');
            if (!isValidStatus(status)) throw new ValidationError('Недопустимый статус заявки', 'status');
            const current = await store.getLead(String(body.leadId || ''));
            if (!current) throw new ValidationError('Заявка не найдена', 'leadId');
            const notes = [
              {
                id: `n-${crypto.randomUUID()}`,
                author: operatorName,
                text: `Статус изменён: «${LEAD_STATUS_NAMES[status] || status}»`,
                time: new Date().toISOString()
              },
              ...(current.notes || [])
            ].slice(0, 500);
            const patch = { status, notes };
            // «Взять в работу»: вместе со статусом заявка закрепляется за диспетчером.
            if (body.dispatcher !== undefined) {
              patch.dispatcher = clampText(String(body.dispatcher || '').trim(), 80) || null;
            }
            await store.updateLead(current.id, patch);
          } else if (action === 'add_note') {
            const text = clampText(String(body.note || '').trim(), 2000);
            if (!text) throw new ValidationError('Текст заметки пуст', 'note');
            const current = await store.getLead(String(body.leadId || ''));
            if (!current) throw new ValidationError('Заявка не найдена', 'leadId');
            const notes = [
              { id: `n-${crypto.randomUUID()}`, author: operatorName, text, time: new Date().toISOString() },
              ...(current.notes || [])
            ].slice(0, 500);
            await store.updateLead(current.id, { notes });
          } else if (action === 'delete') {
            await store.deleteLead(String(body.leadId || ''), String(user.id || user.username || ''));
          } else if (action === 'assign') {
            await store.updateLead(String(body.leadId || ''), { assignedTo: body.assignedTo ?? null });
          } else {
            throw new ValidationError('Неизвестное действие', 'action');
          }

          const updated = await store.loadAll();
          return jsonResponse({ ok: true, success: true, leads: updated.leads, authorizedUsers: updated.authorizedUsers }, 200, cors);
        }

        return jsonResponse({ ok: false, error: 'Метод не поддерживается' }, 405, cors);
      }

      /* ------------------- Заявки: REST CRUD -------------------- */

      const leadMatch = url.pathname.match(/^\/api\/crm\/lead\/([^/]+)(\/note)?$/);
      if (leadMatch) {
        const data = await store.loadAll();
        const user = await requireUser(request, data, store, config);
        const leadId = decodeURIComponent(leadMatch[1]);

        if (leadMatch[2] && request.method === 'POST') {
          const body = await readJson(request);
          const text = clampText(String(body.text || '').trim(), 2000);
          if (!text) throw new ValidationError('Текст заметки пуст', 'text');
          const current = await store.getLead(leadId);
          if (!current) return jsonResponse({ ok: false, error: 'Заявка не найдена' }, 404, cors);
          const note = {
            id: `n-${crypto.randomUUID()}`,
            author: clampText(String(body.author || user.username || 'Диспетчер'), 80),
            text,
            time: new Date().toISOString()
          };
          const lead = await store.updateLead(leadId, { notes: [note, ...(current.notes || [])].slice(0, 500) });
          return jsonResponse({ ok: true, success: true, note, lead }, 200, cors);
        }
        if (request.method === 'PATCH') {
          const lead = await store.updateLead(leadId, await readJson(request));
          if (!lead) return jsonResponse({ ok: false, error: 'Заявка не найдена' }, 404, cors);
          return jsonResponse({ ok: true, success: true, lead }, 200, cors);
        }
        if (request.method === 'DELETE') {
          const removed = await store.deleteLead(leadId, String(user.id || user.username || ''));
          if (!removed) return jsonResponse({ ok: false, error: 'Заявка не найдена' }, 404, cors);
          return jsonResponse({ ok: true, success: true }, 200, cors);
        }
        return jsonResponse({ ok: false, error: 'Метод не поддерживается' }, 405, cors);
      }

      /* ----------------- Управление доступом -------------------- */

      if (url.pathname === '/api/crm/access') {
        const data = await store.loadAll();

        if (request.method === 'GET') {
          await requireUser(request, data, store, config);
          return jsonResponse({ ok: true, success: true, users: data.authorizedUsers }, 200, cors);
        }

        if (request.method === 'POST') {
          await requireAdmin(request, data, store, config);
          const body = await readJson(request);
          const action = String(body.action || '');

          if (action === 'add') {
            const rawUsername = String(body.user?.username || '').replace(/^@/, '').trim();
            const rawId = body.user?.id ? String(body.user.id).trim() : '';
            if (!rawUsername && !rawId) throw new ValidationError('Укажите Telegram username или ID', 'user');
            if (rawUsername && !/^[A-Za-z0-9_]{4,32}$/.test(rawUsername)) {
              throw new ValidationError('Некорректный Telegram username', 'username');
            }
            if (rawId && !/^\d{5,15}$/.test(rawId)) throw new ValidationError('Некорректный Telegram ID', 'id');

            const exists = data.authorizedUsers.some(
              entry =>
                (rawUsername && String(entry.username || '').toLowerCase() === rawUsername.toLowerCase()) ||
                (rawId && String(entry.id || '') === rawId)
            );
            if (exists) throw new ValidationError('Пользователь уже есть в списке доступа');

            await store.replaceUsers([
              ...data.authorizedUsers,
              {
                id: rawId || null,
                username: rawUsername || null,
                name: clampText(String(body.user?.name || rawUsername || rawId), 100),
                role: clampText(String(body.user?.role || 'Диспетчер'), 60),
                isAdmin: false,
                addedAt: new Date().toISOString()
              }
            ]);
          } else if (action === 'remove') {
            const target = String(body.target || '').replace(/^@/, '').toLowerCase().trim();
            if (!target) throw new ValidationError('Не указан пользователь для удаления', 'target');
            if (target === String(config.masterAdminUsername).toLowerCase() || target === String(config.masterAdminId)) {
              throw new ValidationError('Нельзя отозвать доступ у главного администратора');
            }
            await store.replaceUsers(
              data.authorizedUsers.filter(entry => {
                const entryUsername = String(entry.username || '').toLowerCase().replace(/^@/, '');
                return entryUsername !== target && String(entry.id || '') !== target;
              })
            );
          } else {
            throw new ValidationError('Неизвестное действие', 'action');
          }

          const updated = await store.loadAll();
          return jsonResponse({ ok: true, success: true, users: updated.authorizedUsers }, 200, cors);
        }

        return jsonResponse({ ok: false, error: 'Метод не поддерживается' }, 405, cors);
      }

      /* ------------------------ Сотрудники ---------------------- */

      if (url.pathname === '/api/crm/employees') {
        const data = await store.loadAll();
        await requireUser(request, data, store, config);
        if (request.method === 'GET') {
          return jsonResponse({ ok: true, success: true, employees: await store.listEmployees() }, 200, cors);
        }
        if (request.method === 'POST') {
          await requireAdmin(request, data, store, config);
          const body = await readJson(request);
          const name = clampText(String(body.name || '').trim(), 100);
          if (name.length < 2) throw new ValidationError('Укажите имя сотрудника', 'name');
          const employee = {
            id: body.id ? String(body.id) : `emp-${crypto.randomUUID()}`,
            name,
            role: clampText(String(body.role || 'Диспетчер'), 60),
            telegramId: body.telegramId ? String(body.telegramId) : null,
            createdAt: new Date().toISOString()
          };
          await store.upsertEmployee(employee);
          return jsonResponse({ ok: true, success: true, employee }, 200, cors);
        }
        return jsonResponse({ ok: false, error: 'Метод не поддерживается' }, 405, cors);
      }

      const employeeMatch = url.pathname.match(/^\/api\/crm\/employee\/([^/]+)$/);
      if (employeeMatch && request.method === 'DELETE') {
        await requireAdmin(request, await store.loadAll(), store, config);
        const removed = await store.deleteEmployee(decodeURIComponent(employeeMatch[1]));
        if (!removed) return jsonResponse({ ok: false, error: 'Сотрудник не найден' }, 404, cors);
        return jsonResponse({ ok: true, success: true }, 200, cors);
      }

      /* ------------------- Тикеты документов -------------------- */

      if (url.pathname === '/api/crm/doc-ticket' && request.method === 'POST') {
        const data = await store.loadAll();
        const user = await requireUser(request, data, store, config);
        const body = await readJson(request);
        const ticket = await createDocTicket(body.leadId, user, config);
        return jsonResponse({ ok: true, success: true, ticket }, 200, cors);
      }

      if (url.pathname === '/api/crm/doc-data' && request.method === 'POST') {
        const data = await store.loadAll();
        const body = await readJson(request);
        let operator = null;
        try {
          operator = await requireUser(request, data, store, config);
        } catch {
          const ticket = await verifyDocTicket(body.ticket, data, config);
          if (ticket) operator = { id: ticket.username, username: ticket.username, first_name: ticket.operatorName };
        }
        if (!operator) {
          // Разделяем «нет доступа» и «ссылка устарела»: диспетчеру важно
          // понимать, что документ открыт неправильно, а не что доступ отозвали.
          if (body.ticket) {
            throw new AuthError('Срок действия ссылки на документ истёк — откройте её заново из диспетчерской', 403);
          }
          throw new AuthError('Требуется авторизация через Telegram или вход в диспетчерскую', 401);
        }
        const lead = body.leadId ? await store.getLead(String(body.leadId)) : null;
        return jsonResponse(
          {
            ok: true,
            success: true,
            lead,
            leads: data.leads,
            operator: { name: operator.first_name || operator.username || 'Диспетчер' }
          },
          200,
          cors
        );
      }

      /* --------------------------- Гео -------------------------- */

      if (url.pathname === '/api/geocode' && request.method === 'GET') {
        const limit = rateLimit(`geo:${clientKey(request)}`, 60, 60_000);
        if (!limit.ok) return jsonResponse({ ok: false, error: 'Слишком много запросов' }, 429, cors);
        const place = await geocode(url.searchParams.get('q') || '', env);
        if (!place) return jsonResponse({ ok: false, error: 'Адрес не найден' }, 404, cors);
        return jsonResponse(place, 200, { ...cors, 'Cache-Control': 'public, max-age=86400' });
      }

      if (url.pathname === '/api/route' && request.method === 'GET') {
        const limit = rateLimit(`route:${clientKey(request)}`, 60, 60_000);
        if (!limit.ok) return jsonResponse({ ok: false, error: 'Слишком много запросов' }, 429, cors);
        const from = url.searchParams.get('from') || '';
        const to = url.searchParams.get('to') || '';
        const coordPattern = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;
        if (!coordPattern.test(from) || !coordPattern.test(to)) {
          throw new ValidationError('Ожидаются координаты вида lon,lat в параметрах from и to');
        }
        const result = await route(from, to);
        return jsonResponse(result, 200, { ...cors, 'Cache-Control': 'public, max-age=3600' });
      }

      const tileMatch = url.pathname.match(/^\/api\/tile\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if (tileMatch && request.method === 'GET') {
        const tile = await fetchTile(tileMatch[1], tileMatch[2], tileMatch[3]);
        if (!tile) return new Response('Not found', { status: 404, headers: cors });
        return new Response(tile, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800, immutable', ...cors }
        });
      }

      /* ---------------------- Вебхук Telegram ------------------- */

      if (url.pathname === '/api/telegram-webhook') {
        if (request.method === 'GET') {
          return jsonResponse(
            {
              ok: true,
              status: 'online',
              service: 'asma-lines-telegram-webhook',
              storage: store.kind,
              configuredBotToken: Boolean(config.botToken),
              configuredChatId: Boolean(config.chatId),
              webhookSecretEnforced: Boolean(env.TELEGRAM_WEBHOOK_SECRET)
            },
            200,
            cors
          );
        }
        if (request.method === 'POST') {
          const secret = verifyWebhookSecret(request.headers.get('x-telegram-bot-api-secret-token'), env);
          if (!secret.ok) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, cors);
          const update = await readJson(request);
          const crmAppUrl = env.CRM_APP_URL || `${url.origin}/crm`;
          // /crm.html переадресуется на /crm — используем короткий адрес.
          ctx.waitUntil(handleBotUpdate(update, { store, config, crmAppUrl }));
          return jsonResponse({ ok: true }, 200, cors);
        }
        return jsonResponse({ ok: false, error: 'Метод не поддерживается' }, 405, cors);
      }

      /* -------------------- Настройка вебхука ------------------- */

      if (url.pathname === '/api/setup-webhook') {
        const setupToken = String(env.SETUP_TOKEN || '');
        if (!setupToken) {
          throw new ConfigError('Роут отключён: задайте SETUP_TOKEN в секретах Cloudflare, чтобы пользоваться им.');
        }
        const provided = request.headers.get('x-setup-token') || url.searchParams.get('token') || '';
        if (!timingSafeEqual(provided, setupToken)) throw new AuthError('Неверный SETUP_TOKEN', 403);
        const webhookUrl = env.TELEGRAM_WEBHOOK_URL || `${url.origin}/api/telegram-webhook`;
        const result = await setTelegramWebhook(webhookUrl, env);
        return jsonResponse({ ok: true, success: true, webhookUrl, ...result }, 200, cors);
      }

      /* --------------- Импорт данных из старого бина ------------ */

      if (url.pathname === '/api/admin/import-legacy' && request.method === 'POST') {
        const setupToken = String(env.SETUP_TOKEN || '');
        if (!setupToken) throw new ConfigError('Задайте SETUP_TOKEN, чтобы пользоваться импортом.');
        const provided = request.headers.get('x-setup-token') || url.searchParams.get('token') || '';
        if (!timingSafeEqual(provided, setupToken)) throw new AuthError('Неверный SETUP_TOKEN', 403);
        if (!(store instanceof D1Store)) throw new ConfigError('Импорт доступен только при настроенном D1');
        const sourceUrl = String(env.LEGACY_STORE_URL || LEGACY_STORE_URL);
        const response = await fetch(`${sourceUrl}?_t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new ValidationError(`Источник недоступен: HTTP ${response.status}`);
        const result = await store.importLegacySnapshot(await response.json());
        return jsonResponse({ ok: true, success: true, source: sourceUrl, ...result }, 200, cors);
      }

      /* -------------------------- Прочее ------------------------ */

      if (url.pathname === '/api/health') {
        return jsonResponse(
          {
            ok: true,
            status: 'healthy',
            storage: store.kind,
            writable: store.writable,
            botTokenConfigured: Boolean(config.botToken),
            yandexMapsKeyConfigured: Boolean(env.YANDEX_MAPS_API_KEY || env.YANDEX_GEOCODER_KEY),
            time: new Date().toISOString()
          },
          200,
          cors
        );
      }

      return jsonResponse({ ok: false, error: 'Неизвестный эндпоинт' }, 404, cors);
    } catch (error) {
      return errorResponse(error, cors);
    }
  }
};

/* ================================================================== */
/* ЭКСПОРТ ДЛЯ ТЕСТОВ                                                 */
/* ================================================================== */

/**
 * Экспорты исключительно для тестов (_tests/pricing.test.js): они сверяют
 * расчёт и валидацию в Worker'е с модулями _shared/*, чтобы две реализации
 * не разошлись незаметно. На работу Worker'а не влияют.
 */
export const __testables = {
  RATES,
  WEIGHT_TIERS,
  PRICE_LIMITS,
  LEAD_LIMITS,
  LEAD_STATUSES,
  calculatePrice,
  vehicleForWeight,
  normalizeLead,
  normalizeContact,
  normalizeBelarusPhone,
  parseRouteDetails,
  escapeHtml,
  isUserAuthorized,
  isUserAdmin,
  verifyWebhookSecret,
  rowToLead,
  leadToParams
};
