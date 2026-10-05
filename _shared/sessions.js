/**
 * ASMA Lines — браузерный вход в диспетчерскую.
 *
 * Зачем: на компьютере WebApp тесный (окно внутри Telegram, без вкладок и
 * привычного масштаба), поэтому ПК-версию открывают как обычный сайт.
 * Телефон остаётся в Telegram — там личность подтверждает сам Telegram.
 *
 * Как устроен вход:
 *  1. Браузер просит код: `POST /api/login/start` → 6 цифр и секретный
 *     токен опроса (в базе лежит только хеш токена).
 *  2. Диспетчер открывает бота и подтверждает вход кнопкой (или командой
 *     `/login 482-173`) — показаны устройство и город.
 *  3. Браузер опрашивает `/api/login/status`; после подтверждения получает
 *     сессионную cookie на 30 дней.
 *
 * Что защищает вход:
 *  - код одноразовый и живёт 5 минут, не больше 10 кодов на адрес в час;
 *  - подтвердить код может только аккаунт из списка доступа;
 *  - в базе хранится sha256-хеш токена, а не сам токен;
 *  - cookie `HttpOnly; Secure; SameSite=Lax`;
 *  - запросы с cookie принимаются только со своего источника и с заголовком
 *    `X-Requested-With: asma-crm` (защита от CSRF);
 *  - `/logout` в боте отзывает все сессии сотрудника, отзыв доступа в CRM
 *    убивает сессии автоматически.
 */

import { AuthError } from './core.js';
import { extractTelegramUser, isUserAuthorized } from './telegram.js';

export const SESSION_COOKIE = 'asma_session';
/** Сессия живёт 30 дней и продлевается при активности. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Продлевать не чаще, чем раз в 12 часов: лишние записи в базу не нужны. */
export const SESSION_TOUCH_MS = 12 * 60 * 60 * 1000;
/** Код входа живёт 5 минут. */
export const CODE_TTL_MS = 5 * 60 * 1000;
/** Не больше 10 кодов на один адрес в час. */
export const CODES_PER_IP_LIMIT = 10;
export const CODES_PER_IP_WINDOW_MS = 60 * 60 * 1000;
/** Заголовок, который обязан присылать клиент при запросах с cookie. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'asma-crm';

const encoder = new TextEncoder();
const toIso = (ms) => new Date(ms).toISOString();

/** Заголовок из любого представления: Fetch Headers, объект Express, Map. */
export function readHeaderValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const lower = name.toLowerCase();
  if (typeof headers === 'object') return headers[lower] || headers[name] || '';
  return '';
}

export function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** sha256 в hex: в базе хранятся только хеши токенов. */
export async function hashToken(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Код входа: шесть цифр, первая не ноль. */
export function generateLoginCode() {
  const buffer = new Uint8Array(6);
  crypto.getRandomValues(buffer);
  let code = String(1 + (buffer[0] % 9));
  for (let i = 1; i < 6; i += 1) code += String(buffer[i] % 10);
  return code;
}

/** «482-173» → «482173»; всё, что не шесть цифр, — пустая строка. */
export function normalizeLoginCode(input) {
  const digits = String(input || '').replace(/\D+/g, '');
  return digits.length === 6 ? digits : '';
}

export function formatLoginCode(code) {
  const digits = normalizeLoginCode(code);
  return digits ? `${digits.slice(0, 3)}-${digits.slice(3)}` : '';
}

export function parseCookies(header) {
  const result = {};
  for (const chunk of String(header || '').split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    const name = chunk.slice(0, index).trim();
    if (!name) continue;
    const raw = chunk.slice(index + 1).trim();
    try {
      result[name] = decodeURIComponent(raw);
    } catch {
      result[name] = raw;
    }
  }
  return result;
}

export function sessionCookieHeader(token, { maxAgeMs = SESSION_TTL_MS } = {}) {
  return (
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; ` +
    `Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; Secure; SameSite=Lax`
  );
}

export function clearedSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** «Chrome · Windows» — понятное человеку описание устройства. */
export function describeDevice(userAgent = '') {
  const ua = String(userAgent);
  const browser = /YaBrowser|Yowser/.test(ua) ? 'Яндекс.Браузер'
    : /Edg\//.test(ua) ? 'Edge'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Firefox\//.test(ua) ? 'Firefox'
            : /Safari\//.test(ua) ? 'Safari'
              : 'браузер';
  const system = /Windows/.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Android/.test(ua) ? 'Android'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : '';
  return system ? `${browser} · ${system}` : browser;
}

/** Город входа из данных Cloudflare (в локальной разработке их нет). */
export function describePlace(cf) {
  if (!cf) return '';
  const city = String(cf.city || '').trim();
  const country = String(cf.country || '').trim();
  if (city && country) return `${city}, ${country}`;
  return city || country || '';
}

export function formatLoginTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toISOString();
  }
}

/** Имя оператора из объекта пользователя Telegram. */
export function telegramUserName(user) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ');
  return name || user?.username || 'Диспетчер';
}

/* ------------------------------------------------------------------ */
/* Сценарий входа                                                     */
/* ------------------------------------------------------------------ */

/**
 * Шаг 1. Выдаёт одноразовый код входа и секретный токен опроса.
 * Токен нужен, чтобы статус мог опрашивать только тот, кто начал вход:
 * сам по себе шестизначный код перебором угадать можно, токен — нет.
 */
export async function startLogin({ store, ip = '', userAgent = '', place = '', now = Date.now() }) {
  const since = toIso(now - CODES_PER_IP_WINDOW_MS);
  const recent = await store.countLoginCodes(ip, since);
  if (recent >= CODES_PER_IP_LIMIT) {
    throw new AuthError('Слишком много попыток входа с этого адреса. Попробуйте через час.', 429);
  }
  // Заодно подчищаем давно истёкшие коды, чтобы таблица не росла.
  await store.deleteExpiredLoginCodes(toIso(now - CODE_TTL_MS * 4));

  let code = '';
  for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
    const candidate = generateLoginCode();
    const existing = await store.getLoginCode(candidate);
    if (!existing || new Date(existing.expiresAt).getTime() <= now) code = candidate;
  }
  if (!code) throw new AuthError('Не удалось выдать код входа — повторите попытку', 503);

  const token = randomToken();
  await store.saveLoginCode({
    code,
    tokenHash: await hashToken(token),
    createdAt: toIso(now),
    expiresAt: toIso(now + CODE_TTL_MS),
    confirmedAt: null,
    usedAt: null,
    telegramId: null,
    username: null,
    name: null,
    ip,
    userAgent,
    place
  });

  return { code, token, expiresAt: toIso(now + CODE_TTL_MS) };
}

/**
 * Шаг 3. Опрос статуса. Если код подтверждён — выдаёт сессию.
 * Возможные статусы: unknown | pending | confirmed | expired | used.
 */
export async function loginState({ store, token, ip = '', userAgent = '', place = '', now = Date.now() }) {
  const tokenHash = await hashToken(token);
  const record = await store.getLoginCodeByToken(tokenHash);
  if (!record) return { status: 'unknown' };
  if (record.usedAt) return { status: 'used' };

  const expired = new Date(record.expiresAt).getTime() <= now;
  if (!record.confirmedAt) return { status: expired ? 'expired' : 'pending' };
  if (expired) return { status: 'expired' };

  const consumed = await store.consumeLoginCode(record.code, tokenHash, toIso(now));
  if (!consumed) return { status: 'used' };

  const sessionToken = randomToken();
  await store.createSession({
    id: await hashToken(sessionToken),
    telegramId: record.telegramId || '',
    username: record.username || '',
    name: record.name || '',
    createdAt: toIso(now),
    expiresAt: toIso(now + SESSION_TTL_MS),
    lastSeenAt: toIso(now),
    userAgent: userAgent || record.userAgent || '',
    ip: ip || record.ip || '',
    place: place || record.place || '',
    revoked: false
  });

  return {
    status: 'confirmed',
    token: sessionToken,
    code: record.code,
    user: { id: record.telegramId || '', username: record.username || '', name: record.name || '' }
  };
}

/** Шаг 2. Подтверждение в боте. Возвращает причину отказа, если что-то не так. */
export async function confirmLoginCode({ store, code, user, now = Date.now() }) {
  const normalized = normalizeLoginCode(code);
  if (!normalized) return { ok: false, reason: 'invalid' };

  const record = await store.getLoginCode(normalized);
  if (!record) return { ok: false, reason: 'not-found' };
  if (record.usedAt) return { ok: false, reason: 'used' };
  if (new Date(record.expiresAt).getTime() <= now) return { ok: false, reason: 'expired' };
  if (record.confirmedAt) return { ok: false, reason: 'already-confirmed', record };

  const saved = await store.confirmLoginCode(normalized, {
    telegramId: String(user?.id || ''),
    username: String(user?.username || ''),
    name: telegramUserName(user),
    at: toIso(now)
  });
  return saved ? { ok: true, record: { ...record, confirmedAt: toIso(now) } } : { ok: false, reason: 'race' };
}

/** Кнопка «Это не я»: код гасим, чтобы им не воспользовались. */
export async function cancelLoginCode({ store, code }) {
  const normalized = normalizeLoginCode(code);
  if (!normalized) return { ok: false, reason: 'invalid' };
  const record = await store.getLoginCode(normalized);
  if (!record) return { ok: false, reason: 'not-found' };
  if (record.usedAt) return { ok: false, reason: 'used' };
  await store.deleteLoginCode(normalized);
  return { ok: true };
}

/** Текст подтверждения в боте: код, устройство, место и время. */
export function loginConfirmText(record) {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  return (
    '🔐 <b>Вход в диспетчерскую</b>\n' +
    '───────────────────────\n' +
    `Код: <code>${formatLoginCode(record.code)}</code>\n` +
    `Устройство: ${escape(describeDevice(record.userAgent))}\n` +
    `Место: ${escape(record.place || 'неизвестно')}\n` +
    `Время: ${escape(formatLoginTime(record.createdAt))}\n\n` +
    'Если это вы — подтвердите вход кнопкой ниже. Если нет — нажмите «Это не я».'
  );
}

/* ------------------------------------------------------------------ */
/* Проверка запросов                                                  */
/* ------------------------------------------------------------------ */

/**
 * Защита от CSRF для запросов с cookie: нужен свой источник и заголовок
 * X-Requested-With. Без cookie (WebApp присылает подписанный initData)
 * такая защита не требуется — подделать заголовок со стороны сайта нельзя.
 */
export function checkCsrf({ method, headers, url }) {
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
  if (safeMethod) return { ok: true };

  if (readHeaderValue(headers, CSRF_HEADER) !== CSRF_VALUE) {
    return { ok: false, reason: 'Нет заголовка X-Requested-With: asma-crm' };
  }
  const origin = readHeaderValue(headers, 'origin');
  let expected = '';
  try {
    expected = new URL(url).origin;
  } catch {
    expected = '';
  }
  if (!origin || !expected || origin !== expected) {
    return { ok: false, reason: 'Источник запроса не совпадает с адресом диспетчерской' };
  }
  return { ok: true };
}

/**
 * Определяет оператора: сначала подписанный initData (WebApp), затем
 * сессионная cookie (браузер). Возвращает { user, via }.
 */
export async function authenticateOperator({ headers, method, url, data, store, config, now = Date.now() }) {
  const telegramUser = await extractTelegramUser(headers, config);
  if (telegramUser) {
    if (!isUserAuthorized(telegramUser, data.authorizedUsers, config)) {
      throw new AuthError('Ваш аккаунт не найден в списке доступа ASMA Lines', 403);
    }
    return { user: telegramUser, via: 'telegram' };
  }

  const token = parseCookies(readHeaderValue(headers, 'cookie'))[SESSION_COOKIE];
  if (!token) {
    throw new AuthError('Требуется вход: откройте диспетчерскую в Telegram или войдите по коду', 401);
  }

  const csrf = checkCsrf({ method, headers, url });
  if (!csrf.ok) throw new AuthError(`Запрос отклонён: ${csrf.reason}`, 403);

  const id = await hashToken(token);
  const session = await store.getSession(id);
  if (!session) throw new AuthError('Сессия не найдена — войдите заново', 401);
  if (session.revoked) throw new AuthError('Сессия закрыта — войдите заново', 401);
  if (new Date(session.expiresAt).getTime() <= now) {
    await store.revokeSession(id);
    throw new AuthError('Сессия истекла — войдите заново', 401);
  }

  const user = { id: session.telegramId, username: session.username, first_name: session.name };
  if (!isUserAuthorized(user, data.authorizedUsers, config)) {
    // Доступ отозвали — сессию больше не пускаем.
    await store.revokeSession(id);
    throw new AuthError('Доступ к диспетчерской отозван', 403);
  }

  const sliding = now - new Date(session.lastSeenAt).getTime() > SESSION_TOUCH_MS;
  if (sliding) {
    await store.touchSession(id, { lastSeenAt: toIso(now), expiresAt: toIso(now + SESSION_TTL_MS) });
  }

  return { user, via: 'cookie', token, session, sliding };
}

/** Выход из браузерной сессии. */
export async function logoutSession({ store, token }) {
  if (!token) return { ok: true, revoked: false };
  const id = await hashToken(token);
  const session = await store.getSession(id);
  if (!session) return { ok: true, revoked: false };
  await store.revokeSession(id);
  return { ok: true, revoked: true };
}
