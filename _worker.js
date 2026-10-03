/**
 * ASMA Lines — Cloudflare Worker (production entry point).
 *
 * Файл СОЗНАТЕЛЬНО самодостаточный: никаких импортов из соседних каталогов.
 * Так деплой не зависит от того, как Pages-сборщик разрешает модули вне assets,
 * и не требует шага сборки.
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

/* ================================================================== */
/* БАЗОВЫЕ УТИЛИТЫ                                                    */
/* ================================================================== */

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field || null;
    this.status = 400;
  }
}

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.status = 500;
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampText(value, maxLength) {
  const str = String(value ?? '');
  return str.length <= maxLength ? str : str.slice(0, maxLength);
}

function normalizeBelarusPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let local = null;
  if (digits.length === 12 && digits.startsWith('375')) local = digits.slice(3);
  else if (digits.length === 11 && digits.startsWith('80')) local = digits.slice(2);
  else if (digits.length === 9) local = digits;
  if (!local || !/^(17|25|29|33|44)\d{7}$/.test(local)) return null;
  return `+375${local}`;
}

function isValidEmail(raw) {
  return Boolean(raw) && /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(String(raw).trim());
}

function normalizeContact(raw, allowTelegramHandle = false) {
  const phone = normalizeBelarusPhone(raw);
  if (phone) return phone;
  if (allowTelegramHandle) {
    const handle = String(raw || '').trim();
    if (/^@?[A-Za-z0-9_]{4,32}$/.test(handle)) return handle.startsWith('@') ? handle : `@${handle}`;
  }
  return null;
}

const LEAD_STATUSES = ['new', 'processing', 'transit', 'completed', 'cancelled'];
const LEAD_STATUS_NAMES = {
  new: 'Новая заявка',
  processing: 'В работе / Звонок',
  calculation: 'Поиск авто / Расчёт',
  in_transit: 'В рейсе / Исполнение',
  transit: 'В рейсе / Исполнение',
  completed: 'Завершено / Оплачено',
  cancelled: 'Отказ / Архив'
};
const isValidStatus = status => LEAD_STATUSES.includes(String(status || ''));

/* ================================================================== */
/* ТАРИФЫ И РАСЧЁТ СТОИМОСТИ (единственный источник правды)           */
/* ================================================================== */

const RATES = Object.freeze({
  base: 85,
  perKm: 1.65,
  perTonne: 18,
  fragile: 1.12,
  temperature: 1.28,
  loading: 45,
  minimum: 150,
  roadCoefficient: 1.28
});

const CARGO_MULTIPLIERS = { standard: 1, fragile: RATES.fragile, temperature: RATES.temperature };
const CARGO_LABELS = { standard: 'Обычный груз', fragile: 'Хрупкий груз', temperature: 'Терморежим' };

/** Тарифные ступени. Раньше калькулятор прыгал с 5 т сразу на 20 т. */
const WEIGHT_TIERS = [
  { maxWeight: 0.8, label: 'До 800 кг', vehicle: 'Каблук / фургон' },
  { maxWeight: 2.5, label: 'До 2.5 т', vehicle: 'Газель' },
  { maxWeight: 6, label: 'До 6 т', vehicle: 'Изотерм 6 т' },
  { maxWeight: 10, label: 'До 10 т', vehicle: 'Тент 10 т' },
  { maxWeight: 20, label: 'До 20 т', vehicle: 'Тент 20 т' },
  { maxWeight: 40, label: 'До 40 т', vehicle: 'Еврофура 40 т' }
];

const PRICE_LIMITS = { minDistanceKm: 1, maxDistanceKm: 2500, minWeightT: 0.05, maxWeightT: 40 };

function vehicleForWeight(weightTons) {
  const weight = Number(weightTons) || 0;
  for (const tier of WEIGHT_TIERS) if (weight <= tier.maxWeight) return tier;
  return WEIGHT_TIERS[WEIGHT_TIERS.length - 1];
}

function calculatePrice(input = {}) {
  const distanceKm = Number(input.distanceKm);
  const weightTons = Number(input.weightTons);
  if (!Number.isFinite(distanceKm) || distanceKm < PRICE_LIMITS.minDistanceKm || distanceKm > PRICE_LIMITS.maxDistanceKm) {
    throw new RangeError(`distanceKm должен быть числом от ${PRICE_LIMITS.minDistanceKm} до ${PRICE_LIMITS.maxDistanceKm}`);
  }
  if (!Number.isFinite(weightTons) || weightTons < PRICE_LIMITS.minWeightT || weightTons > PRICE_LIMITS.maxWeightT) {
    throw new RangeError(`weightTons должен быть числом от ${PRICE_LIMITS.minWeightT} до ${PRICE_LIMITS.maxWeightT}`);
  }

  const cargoKey = CARGO_MULTIPLIERS[input.cargo] !== undefined ? input.cargo : 'standard';
  const multiplier = CARGO_MULTIPLIERS[cargoKey];

  const basePart = RATES.base;
  const kmPart = distanceKm * RATES.perKm;
  const tonnePart = weightTons * RATES.perTonne;
  let total = basePart + kmPart + tonnePart;

  const breakdown = [
    { label: 'Подача транспорта', value: basePart },
    { label: `Пробег ${Math.round(distanceKm)} км`, value: kmPart },
    { label: `Тоннаж ${weightTons} т`, value: tonnePart }
  ];

  if (multiplier !== 1) {
    const before = total;
    total *= multiplier;
    breakdown.push({ label: CARGO_LABELS[cargoKey], value: total - before });
  }
  if (input.loading) {
    total += RATES.loading;
    breakdown.push({ label: 'Погрузка / экспедирование', value: RATES.loading });
  }
  if (total < RATES.minimum) {
    breakdown.push({ label: 'Минимальная стоимость рейса', value: RATES.minimum - total });
    total = RATES.minimum;
  }

  return {
    total: Math.round(total),
    breakdown: breakdown.map(row => ({ label: row.label, value: Math.round(row.value) })),
    vehicle: vehicleForWeight(weightTons).vehicle
  };
}

/* ================================================================== */
/* ВАЛИДАЦИЯ ЗАЯВОК                                                   */
/* ================================================================== */

const LEAD_LIMITS = { nameMin: 2, nameMax: 80, commentMax: 2000, cityMax: 60, routeMax: 160, emailMax: 120, sourceMax: 60 };

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Приводит число к значению, понимая пробелы и запятые как разделители
 * разрядов: «1 200» → 1200, «335» → 335.
 */
function parseLocalizedNumber(raw) {
  const compact = String(raw || '')
    .trim()
    .replace(/(\d)[\s\u00a0](?=\d{3}\b)/g, '$1')
    .replace(/\s/g, '');
  const value = Number(compact.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** Разбирает «Гомель -> Витебск, 335km, 10t, est 1200 BYN». Старая регулярка не понимала 4+ цифр. */
function parseRouteDetails(routeDetails) {
  const out = { fromCity: '', toCity: '', distanceKm: null, weightTons: null, price: null };
  if (!routeDetails || typeof routeDetails !== 'string') return out;

  const km = routeDetails.match(/([\d][\d\s\u00a0.,]*)\s*km/i);
  if (km) out.distanceKm = parseLocalizedNumber(km[1]);

  const tons = routeDetails.match(/([\d][\d\s\u00a0.,]*)\s*t\b/i);
  if (tons) out.weightTons = parseLocalizedNumber(tons[1]);

  const price = routeDetails.match(/(?:est|от)\s*([\d][\d\s\u00a0.,]*)\s*BYN/i);
  if (price) out.price = parseLocalizedNumber(price[1]);

  const cities = routeDetails.match(/^\s*([^,>]{2,60}?)\s*(?:->|→|—|-)\s*([^,>]{2,60}?)\s*(?:,|$)/);
  if (cities) {
    out.fromCity = cities[1].trim();
    out.toCity = cities[2].trim();
  }
  return out;
}

/**
 * Валидирует и нормализует заявку.
 * Цена ВСЕГДА считается на сервере — клиентское значение поля price игнорируется.
 */
function normalizeLead(body, options = {}) {
  if (!body || typeof body !== 'object') throw new ValidationError('Тело запроса должно быть JSON-объектом');

  const routeDetails = clampText(String(body.route_details || '').trim(), LEAD_LIMITS.routeMax);
  const parsedDetails = parseRouteDetails(routeDetails);

  const name = clampText(String(body.name || body.contact_name || '').trim(), LEAD_LIMITS.nameMax);
  if (name.length < LEAD_LIMITS.nameMin) {
    throw new ValidationError(`Поле «Имя» обязательно (минимум ${LEAD_LIMITS.nameMin} символа)`, 'name');
  }

  const rawContact = body.phone || body.contact || '';
  const contact = normalizeContact(rawContact, options.allowTelegramHandle === true);
  if (!contact) {
    throw new ValidationError(
      options.allowTelegramHandle
        ? 'Укажите телефон в формате +375 (29) XXX-XX-XX или Telegram-ник вида @username'
        : 'Укажите корректный телефон в формате +375 (29) XXX-XX-XX',
      'contact'
    );
  }

  const email = clampText(String(body.email || '').trim(), LEAD_LIMITS.emailMax);
  if (email && !isValidEmail(email)) throw new ValidationError('Некорректный e-mail', 'email');

  const fromCity = clampText(String(body.fromCity || '').trim(), LEAD_LIMITS.cityMax) || parsedDetails.fromCity;
  const toCity = clampText(String(body.toCity || '').trim(), LEAD_LIMITS.cityMax) || parsedDetails.toCity;

  const distanceKm = parseNumber(body.distance) ?? parsedDetails.distanceKm;
  const weightTons = parseNumber(body.weight) ?? parsedDetails.weightTons;
  const volumeM3 = parseNumber(body.volume);

  const comment = clampText(String(body.comment || body.message || '').trim(), LEAD_LIMITS.commentMax) || '—';
  const source = clampText(String(body.source || '').trim(), LEAD_LIMITS.sourceMax) || 'Форма сайта';
  const company = clampText(String(body.company || '').trim(), LEAD_LIMITS.nameMax);
  const cargo = ['fragile', 'temperature'].includes(body.cargo) ? body.cargo : 'standard';
  const loading = body.loading === true || body.loading === 'true';
  const isPartner = source === 'website_partners' || Boolean(company);

  const wantsQuote = Boolean(
    (fromCity && toCity) || (distanceKm && weightTons) || source === 'calculator_modal' || source === 'website_calculator'
  );

  let quote = null;
  let quoteError = null;
  if (wantsQuote && !isPartner) {
    try {
      quote = calculatePrice({ distanceKm, weightTons, cargo, loading, volumeM3 });
    } catch (error) {
      quoteError = error.message;
    }
  }
  if (options.requireDistanceAndWeight && !quote && !isPartner) {
    throw new ValidationError(`Не удалось рассчитать стоимость: ${quoteError || 'укажите расстояние и вес груза'}`, 'distance');
  }

  const tier = quote ? vehicleForWeight(weightTons) : null;
  return {
    name,
    contact,
    contactRaw: clampText(String(rawContact || '').trim(), 40),
    email,
    fromCity,
    toCity,
    route: fromCity && toCity ? `${fromCity} → ${toCity}` : routeDetails || 'Маршрут по запросу',
    distance: distanceKm ? `${Math.round(distanceKm)} км` : '',
    distanceKm: distanceKm ?? null,
    vehicle: clampText(String(body.vehicle || '').trim(), 80) || tier?.vehicle || '',
    weight: weightTons ? `${weightTons} т` : '',
    weightTons: weightTons ?? null,
    volume: volumeM3 ? `${volumeM3} м³` : '',
    volumeM3: volumeM3 ?? null,
    price: quote ? `от ${quote.total} BYN` : '',
    priceValue: quote ? quote.total : null,
    priceBreakdown: quote ? quote.breakdown : [],
    priceNotice: quoteError ? 'Стоимость не рассчитана — уточните параметры груза' : '',
    comment,
    company,
    cargo,
    loading,
    source,
    isPartner,
    category: isPartner ? 'Заявка на партнёрство' : 'Перевозка груза',
    type: isPartner ? 'partner' : 'cargo'
  };
}

function sanitizeNotes(notes, maxNotes = 500) {
  if (!Array.isArray(notes)) return [];
  return notes.slice(0, maxNotes).map(note => ({
    id: clampText(note?.id || `n-${crypto.randomUUID()}`, 64),
    author: clampText(note?.author || 'Диспетчер', 80),
    text: clampText(note?.text || '', 2000),
    time: clampText(note?.time || new Date().toISOString(), 40)
  }));
}

/* ================================================================== */
/* УВЕДОМЛЕНИЯ                                                        */
/* ================================================================== */

function buildLeadMessage(lead) {
  const isPartner = lead.type === 'partner';
  const row = (label, value) => (value ? `${label}: <b>${escapeHtml(value)}</b>\n` : '');
  let text = isPartner
    ? '🤝 <b>ЗАЯВКА НА ПАРТНЁРСТВО (ASMA LINES)</b>\n'
    : '🚛 <b>ЗАЯВКА НА ПЕРЕВОЗКУ ГРУЗА (ASMA LINES)</b>\n';
  if (lead.leadNumber) text += `№ <b>${escapeHtml(lead.leadNumber)}</b>\n`;
  text += '➖➖➖➖➖➖➖➖➖➖\n';
  text += row('👤 Контакт', lead.name);
  text += row('🏢 Компания', lead.company);
  text += row('📞 Телефон', lead.contact);
  text += row('✉️ E-mail', lead.email);
  text += row('🗺 Маршрут', lead.route);
  text += row('📏 Дистанция', lead.distance);
  text += row('⚖️ Вес', lead.weight);
  text += row('📦 Объём', lead.volume);
  text += row('🚚 Транспорт', lead.vehicle);
  text += row('💰 Ставка', lead.price);
  if (lead.priceNotice) text += `⚠️ ${escapeHtml(lead.priceNotice)}\n`;
  text += row('📝 Комментарий', lead.comment);
  text += `🔗 Источник: ${escapeHtml(lead.source || 'сайт')}\n`;
  text += `🕒 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}`;
  return text;
}

/* ================================================================== */
/* TELEGRAM: ПОДПИСЬ, АВТОРИЗАЦИЯ, API                                */
/* ================================================================== */

const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;
const encoder = new TextEncoder();

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(keySource, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    typeof keySource === 'string' ? encoder.encode(keySource) : keySource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Проверка подписи Telegram Web App initData + защита от replay по auth_date. */
async function verifyTelegramWebAppData(initDataStr, botToken) {
  if (!initDataStr || !botToken) return null;
  try {
    const params = new URLSearchParams(initDataStr);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = Array.from(params.keys())
      .sort()
      .map(key => `${key}=${params.get(key)}`)
      .join('\n');

    const secretHex = await hmacSha256Hex('WebAppData', botToken);
    const secretBytes = Uint8Array.from(secretHex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
    const calculated = await hmacSha256Hex(secretBytes, dataCheckString);
    if (!timingSafeEqual(calculated, hash.toLowerCase())) return null;

    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate) return null;
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > INIT_DATA_MAX_AGE_SECONDS || ageSeconds < -300) return null;

    const userRaw = params.get('user');
    return userRaw ? JSON.parse(userRaw) : null;
  } catch {
    return null;
  }
}

function readAccessConfig(env = {}) {
  const masterAdminUsername = String(env.MASTER_ADMIN_USERNAME || '').toLowerCase().replace(/^@/, '');
  const masterAdminId = env.MASTER_ADMIN_ID ? String(env.MASTER_ADMIN_ID) : '';
  if (!masterAdminUsername && !masterAdminId) {
    throw new ConfigError(
      'Не задан MASTER_ADMIN_USERNAME или MASTER_ADMIN_ID. Укажите их в Settings → Variables and Secrets.'
    );
  }
  return {
    masterAdminUsername,
    masterAdminId,
    botToken: String(env.TELEGRAM_BOT_TOKEN || ''),
    chatId: env.TELEGRAM_CHAT_ID ? String(env.TELEGRAM_CHAT_ID) : ''
  };
}

function isMasterUser(tgUser, config) {
  if (!tgUser) return false;
  const username = String(tgUser.username || '').toLowerCase().replace(/^@/, '');
  const id = String(tgUser.id || '');
  return Boolean(
    (config.masterAdminUsername && username === config.masterAdminUsername) ||
      (config.masterAdminId && id === config.masterAdminId)
  );
}

function isUserAuthorized(tgUser, authorizedUsers = [], config = {}) {
  if (!tgUser?.id && !tgUser?.username) return false;
  if (isMasterUser(tgUser, config)) return true;
  const userId = String(tgUser.id || '');
  const username = String(tgUser.username || '').toLowerCase().replace(/^@/, '');
  return authorizedUsers.some(entry => {
    const entryId = entry?.id ? String(entry.id) : '';
    const entryUsername = String(entry?.username || '').toLowerCase().replace(/^@/, '');
    return (entryId && entryId === userId) || (entryUsername && entryUsername === username);
  });
}

function isUserAdmin(tgUser, authorizedUsers = [], config = {}) {
  if (!tgUser) return false;
  if (isMasterUser(tgUser, config)) return true;
  const userId = String(tgUser.id || '');
  const username = String(tgUser.username || '').toLowerCase().replace(/^@/, '');
  return authorizedUsers.some(entry => {
    if (!entry?.isAdmin) return false;
    const entryId = entry?.id ? String(entry.id) : '';
    const entryUsername = String(entry?.username || '').toLowerCase().replace(/^@/, '');
    return (entryId && entryId === userId) || (entryUsername && entryUsername === username);
  });
}

/**
 * Читает заголовок из любого представления: Fetch API Headers, обычный
 * объект (req.headers в Express) или Map. Без этого авторизация молча
 * ломается там, где приходит не Headers.
 */
function readHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const lower = name.toLowerCase();
  if (typeof headers === 'object') return headers[lower] || headers[name] || '';
  return '';
}

async function requireUser(headers, store, config) {
  const initData = readHeader(headers, 'x-telegram-init-data');
  const user = await verifyTelegramWebAppData(initData, config.botToken);
  if (!user) throw new AuthError('Доступ запрещён: требуется авторизация через Telegram Web App');
  if (!isUserAuthorized(user, store.authorizedUsers, config)) {
    throw new AuthError('Ваш аккаунт не найден в списке доступа ASMA Lines', 403);
  }
  return user;
}

async function requireAdmin(headers, store, config) {
  const user = await requireUser(headers, store, config);
  if (!isUserAdmin(user, store.authorizedUsers, config)) {
    throw new AuthError('Действие доступно только администратору', 403);
  }
  return user;
}

async function callTelegramApi(config, method, payload) {
  if (!config.botToken) throw new ConfigError('TELEGRAM_BOT_TOKEN не задан в секретах Cloudflare');
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(`Telegram API ${method} failed: ${data.description || response.status}`);
  }
  return data.result;
}

/** Секрет вебхука. Пока не задан — проверка не enforced, чтобы не сломать текущий вебхук. */
function verifyWebhookSecret(headerValue, env = {}) {
  const expected = String(env.TELEGRAM_WEBHOOK_SECRET || '');
  if (!expected) return { ok: true, enforced: false };
  return { ok: timingSafeEqual(String(headerValue || ''), expected), enforced: true };
}

function base64UrlEncode(text) {
  const bytes = encoder.encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

const DOC_TICKET_TTL_MS = 2 * 60 * 60 * 1000;

async function createDocTicket(leadId, tgUser, config) {
  if (!config.botToken) throw new ConfigError('TELEGRAM_BOT_TOKEN не задан — нельзя подписать тикет');
  const payload = {
    leadId: String(leadId || ''),
    username: String(tgUser?.username || '').toLowerCase().replace(/^@/, ''),
    userId: tgUser?.id ? String(tgUser.id) : '',
    operatorName: tgUser?.first_name
      ? `${tgUser.first_name}${tgUser.last_name ? ' ' + tgUser.last_name : ''}`
      : String(tgUser?.username || 'Диспетчер'),
    exp: Date.now() + DOC_TICKET_TTL_MS
  };
  const data = `${payload.leadId}:${payload.username}:${payload.userId}:${payload.exp}`;
  // Литеральный фолбэк-ключ 'asma_lines_secret_key' удалён: он позволял подделать тикет.
  payload.sig = await hmacSha256Hex(`asma-doc:${config.botToken}`, data);
  return base64UrlEncode(JSON.stringify(payload));
}

async function verifyDocTicket(ticketStr, store, config) {
  if (!ticketStr || !config.botToken) return null;
  try {
    const ticket = JSON.parse(base64UrlDecode(ticketStr));
    if (!ticket?.exp || Date.now() > Number(ticket.exp)) return null;
    const data = `${ticket.leadId}:${ticket.username || ''}:${ticket.userId || ''}:${ticket.exp}`;
    const expected = await hmacSha256Hex(`asma-doc:${config.botToken}`, data);
    if (!timingSafeEqual(expected, String(ticket.sig || ''))) return null;
    if (!isUserAuthorized({ id: ticket.userId, username: ticket.username }, store.authorizedUsers, config)) return null;
    return {
      leadId: ticket.leadId,
      username: ticket.username || ticket.userId,
      operatorName: ticket.operatorName || 'Авторизованный диспетчер'
    };
  } catch {
    return null;
  }
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
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`
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

async function createStore(env = {}) {
  if (env.DB && typeof env.DB.prepare === 'function') return new D1Store(env.DB);
  if (env.STORE && typeof env.STORE.loadAll === 'function') return env.STORE;
  return new LegacyReadOnlyStore(env.LEGACY_STORE_URL || LEGACY_STORE_URL);
}

/* ================================================================== */
/* ГЕО: ГЕОКОДИНГ, МАРШРУТ, ТАЙЛЫ                                      */
/* ================================================================== */

const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = 'ASMALines-Logistics/1.0 (+https://asmalines.by; info@asmalines.by)';

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

  const apiKey = env.YANDEX_GEOCODER_KEY || '';
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
  const body = { url: webhookUrl, allowed_updates: ['message', 'channel_post'] };
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

const DEFAULT_ALLOWED_ORIGINS = ['https://asmalines.by', 'https://www.asmalines.by'];

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const allowList = configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data'
  };
  // Запросы самого сайта Origin не присылают — их не ограничиваем.
  if (origin && allowList.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
  });
}

function errorResponse(error, extraHeaders = {}) {
  const status =
    error instanceof ValidationError ? 400 : error instanceof AuthError ? error.status : error instanceof ConfigError ? 500 : 500;
  const body = { ok: false, success: false, error: error?.message || 'Внутренняя ошибка сервера' };
  if (error?.field) body.field = error.field;
  if (status === 500) console.error('API error:', error?.stack || error);
  return jsonResponse(body, status, extraHeaders);
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
  const chatId = update.message?.chat?.id || update.channel_post?.chat?.id || update.edited_message?.chat?.id;
  const send = async (text, extra = {}) => {
    if (!config.botToken || !chatId) return;
    try {
      await callTelegramApi(config, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
    } catch (error) {
      console.error('sendMessage failed:', error.message);
    }
  };

  if (update.callback_query && config.botToken) {
    try {
      await callTelegramApi(config, 'answerCallbackQuery', { callback_query_id: update.callback_query.id });
    } catch {
      /* некритично */
    }
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
      `Система управления заявками готова к работе.`;
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
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
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

      /* ------------------------- CRM ---------------------------- */

      if (url.pathname === '/api/crm' || url.pathname === '/api/crm/data') {
        const data = await store.loadAll();
        const user = await requireUser(request.headers, data, config);

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
              isAdmin: isUserAdmin(user, data.authorizedUsers, config)
            },
            200,
            cors
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
            await store.updateLead(current.id, { status, notes });
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
        const user = await requireUser(request.headers, data, config);
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
          await requireUser(request.headers, data, config);
          return jsonResponse({ ok: true, success: true, users: data.authorizedUsers }, 200, cors);
        }

        if (request.method === 'POST') {
          await requireAdmin(request.headers, data, config);
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
        await requireUser(request.headers, data, config);
        if (request.method === 'GET') {
          return jsonResponse({ ok: true, success: true, employees: await store.listEmployees() }, 200, cors);
        }
        if (request.method === 'POST') {
          await requireAdmin(request.headers, data, config);
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
        await requireAdmin(request.headers, await store.loadAll(), config);
        const removed = await store.deleteEmployee(decodeURIComponent(employeeMatch[1]));
        if (!removed) return jsonResponse({ ok: false, error: 'Сотрудник не найден' }, 404, cors);
        return jsonResponse({ ok: true, success: true }, 200, cors);
      }

      /* ------------------- Тикеты документов -------------------- */

      if (url.pathname === '/api/crm/doc-ticket' && request.method === 'POST') {
        const data = await store.loadAll();
        const user = await requireUser(request.headers, data, config);
        const body = await readJson(request);
        const ticket = await createDocTicket(body.leadId, user, config);
        return jsonResponse({ ok: true, success: true, ticket }, 200, cors);
      }

      if (url.pathname === '/api/crm/doc-data' && request.method === 'POST') {
        const data = await store.loadAll();
        const body = await readJson(request);
        let operator = null;
        try {
          operator = await requireUser(request.headers, data, config);
        } catch {
          const ticket = await verifyDocTicket(body.ticket, data, config);
          if (ticket) operator = { id: ticket.username, username: ticket.username, first_name: ticket.operatorName };
        }
        if (!operator) throw new AuthError('Требуется авторизация или действующий тикет');
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
          const crmAppUrl = env.CRM_APP_URL || `${url.origin}/crm.html`;
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
