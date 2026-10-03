/**
 * ASMA Lines — Telegram Web App авторизация и работа с Bot API.
 *
 * Ключевое отличие от прежней реализации: секретов в коде больше нет,
 * подпись initData проверяется всегда, а «магические» сессионные токены
 * (`plombit`, `2026`, `asma_sess_*`) полностью удалены.
 */

import { AuthError, ConfigError } from './core.js';

/** initData старше этого времени не принимается (защита от replay-атак). */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

const encoder = new TextEncoder();

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** HMAC-SHA256 с ключом-строкой; работает и в workerd, и в Node 18+. */
async function hmacSha256Hex(keySource, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    typeof keySource === 'string' ? encoder.encode(keySource) : keySource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(signature);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Проверяет подпись Telegram Web App initData.
 * @returns {Promise<object|null>} объект user или null, если подпись неверна.
 */
export async function verifyTelegramWebAppData(initDataStr, botToken) {
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

    const secretKey = await hmacSha256Hex('WebAppData', botToken);
    const secretKeyBytes = Uint8Array.from(secretKey.match(/.{2}/g).map(byte => parseInt(byte, 16)));
    const calculated = await hmacSha256Hex(secretKeyBytes, dataCheckString);

    if (!timingSafeEqual(calculated, hash.toLowerCase())) return null;

    // Защита от повторного использования перехваченного initData.
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate) return null;
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > INIT_DATA_MAX_AGE_SECONDS || ageSeconds < -300) return null;

    const userRaw = params.get('user');
    if (!userRaw) return null;
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

/**
 * Разбирает настройки доступа из окружения.
 * Никаких захардкоженных username/id: всё задаётся через переменные.
 */
export function readAccessConfig(env = {}) {
  const masterAdminUsername = String(env.MASTER_ADMIN_USERNAME || '').toLowerCase().replace(/^@/, '');
  const masterAdminId = env.MASTER_ADMIN_ID ? String(env.MASTER_ADMIN_ID) : '';
  if (!masterAdminUsername && !masterAdminId) {
    throw new ConfigError(
      'Не задан MASTER_ADMIN_USERNAME или MASTER_ADMIN_ID. ' +
        'Укажите их в переменных окружения Cloudflare (Settings → Variables and Secrets).'
    );
  }
  return {
    masterAdminUsername,
    masterAdminId,
    botToken: String(env.TELEGRAM_BOT_TOKEN || ''),
    chatId: env.TELEGRAM_CHAT_ID ? String(env.TELEGRAM_CHAT_ID) : ''
  };
}

export function isMasterUser(tgUser, { masterAdminUsername, masterAdminId }) {
  if (!tgUser) return false;
  const username = String(tgUser.username || '').toLowerCase().replace(/^@/, '');
  const id = String(tgUser.id || '');
  return Boolean(
    (masterAdminUsername && username === masterAdminUsername) || (masterAdminId && id === masterAdminId)
  );
}

/** Пользователь есть в списке доступа (по id или username). */
export function isUserAuthorized(tgUser, authorizedUsers = [], config = {}) {
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

/** Права администратора: мастер-аккаунт либо явный флаг isAdmin в списке. */
export function isUserAdmin(tgUser, authorizedUsers = [], config = {}) {
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
 * Читает заголовок из любого представления:
 *  - Fetch API Headers (Cloudflare Worker),
 *  - обычный объект req.headers (Express),
 *  - Map.
 * Ошибка здесь означала бы, что авторизация не работает вообще нигде.
 */
function readHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const lower = name.toLowerCase();
  if (typeof headers === 'object') {
    return headers[lower] || headers[name] || '';
  }
  return '';
}

/** Извлекает проверенного пользователя Telegram из заголовков запроса. */
export async function extractTelegramUser(headers, config) {
  const initData = readHeader(headers, 'x-telegram-init-data');
  if (!initData) return null;
  if (!config.botToken) return null;
  return verifyTelegramWebAppData(initData, config.botToken);
}

/** Требует авторизованного пользователя, иначе бросает AuthError. */
export async function requireUser(headers, store, config) {
  const user = await extractTelegramUser(headers, config);
  if (!user) {
    throw new AuthError('Доступ запрещён: требуется авторизация через Telegram Web App');
  }
  if (!isUserAuthorized(user, store.authorizedUsers, config)) {
    throw new AuthError('Ваш аккаунт не найден в списке доступа ASMA Lines', 403);
  }
  return user;
}

/** Требует администратора. */
export async function requireAdmin(headers, store, config) {
  const user = await requireUser(headers, store, config);
  if (!isUserAdmin(user, store.authorizedUsers, config)) {
    throw new AuthError('Действие доступно только администратору', 403);
  }
  return user;
}

/** Вызов Telegram Bot API. Токен обязателен — фолбэков больше нет. */
export async function callTelegramApi(config, method, payload) {
  if (!config.botToken) {
    throw new ConfigError('TELEGRAM_BOT_TOKEN не задан в секретах Cloudflare');
  }
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

/**
 * Проверяет секрет вебхука.
 * Если TELEGRAM_WEBHOOK_SECRET не задан — проверка пропускается,
 * чтобы существующий вебхук не отвалился до настройки секрета.
 */
export function verifyWebhookSecret(headerValue, env = {}) {
  const expected = String(env.TELEGRAM_WEBHOOK_SECRET || '');
  if (!expected) return { ok: true, enforced: false };
  return { ok: timingSafeEqual(String(headerValue || ''), expected), enforced: true };
}

const DOC_TICKET_TTL_MS = 2 * 60 * 60 * 1000;

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

/**
 * Подписанный тикет на печать документа.
 * Ключ подписи — производный от TELEGRAM_BOT_TOKEN; литеральный
 * фолбэк-ключ 'asma_lines_secret_key' удалён, он позволял подделать тикет.
 */
export async function createDocTicket(leadId, tgUser, config) {
  if (!config.botToken) throw new ConfigError('TELEGRAM_BOT_TOKEN не задан — нельзя подписать тикет');
  const exp = Date.now() + DOC_TICKET_TTL_MS;
  const payload = {
    leadId: String(leadId || ''),
    username: String(tgUser?.username || '').toLowerCase().replace(/^@/, ''),
    userId: tgUser?.id ? String(tgUser.id) : '',
    operatorName: tgUser?.first_name
      ? `${tgUser.first_name}${tgUser.last_name ? ' ' + tgUser.last_name : ''}`
      : String(tgUser?.username || 'Диспетчер'),
    exp
  };
  const data = `${payload.leadId}:${payload.username}:${payload.userId}:${payload.exp}`;
  payload.sig = await hmacSha256Hex(`asma-doc:${config.botToken}`, data);
  return base64UrlEncode(JSON.stringify(payload));
}

/** Проверяет тикет. Возвращает данные оператора или null. */
export async function verifyDocTicket(ticketStr, store, config) {
  if (!ticketStr || !config.botToken) return null;
  try {
    const ticket = JSON.parse(base64UrlDecode(ticketStr));
    if (!ticket?.exp || Date.now() > Number(ticket.exp)) return null;

    const data = `${ticket.leadId}:${ticket.username || ''}:${ticket.userId || ''}:${ticket.exp}`;
    const expected = await hmacSha256Hex(`asma-doc:${config.botToken}`, data);
    if (!timingSafeEqual(expected, String(ticket.sig || ''))) return null;

    const pseudoUser = { id: ticket.userId, username: ticket.username };
    if (!isUserAuthorized(pseudoUser, store.authorizedUsers, config)) return null;

    return {
      leadId: ticket.leadId,
      username: ticket.username || ticket.userId,
      operatorName: ticket.operatorName || 'Авторизованный диспетчер'
    };
  } catch {
    return null;
  }
}
