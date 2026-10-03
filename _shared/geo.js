/**
 * ASMA Lines — геокодинг, маршрутизация и проксирование тайлов карты.
 * Общий модуль: раньше эти роуты были реализованы только в server.js,
 * поэтому на Cloudflare карта и расчёт маршрута не работали (404).
 */

import { ConfigError } from './core.js';

const REQUEST_TIMEOUT_MS = 10000;

/** Простой кэш с ограничением размера (работает и в workerd, и в Node). */
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

  get size() {
    return this.map.size;
  }
}

const geocodeCache = new BoundedCache(1000);
const routeCache = new BoundedCache(500);
const tileCache = new BoundedCache(300);

const USER_AGENT = 'ASMALines-Logistics/1.0 (+https://asmalines.by; info@asmalines.by)';

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/**
 * Геокодинг: сначала Yandex (если задан ключ), затем OpenStreetMap Nominatim.
 * @returns {Promise<{lat:number, lon:number, name:string}|null>}
 */
export async function geocode(query, env = {}) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return null;

  const cacheKey = q.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const apiKey = env.YANDEX_GEOCODER_KEY || '';

  if (apiKey) {
    try {
      const url =
        `https://geocode-maps.yandex.ru/1.x/?apikey=${encodeURIComponent(apiKey)}` +
        `&geocode=${encodeURIComponent(`${q}, Беларусь`)}&format=json&results=1`;
      const response = await fetchWithTimeout(url);
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
          if (Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
            return geocodeCache.set(cacheKey, place);
          }
        }
      }
    } catch {
      // Тихо уходим в фолбэк на Nominatim.
    }
  }

  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=by' +
      `&accept-language=ru&q=${encodeURIComponent(q)}`;
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });
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

/** Маршрут по дорогам через публичный OSRM. */
export async function route(from, to) {
  const cacheKey = `${from}|${to}`;
  const cached = routeCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url =
    `https://router.project-osrm.org/route/v1/driving/${encodeURIComponent(from)};` +
    `${encodeURIComponent(to)}?overview=full&geometries=geojson`;

  try {
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
    const data = await response.json();
    const routeData = data?.routes?.[0];
    if (!routeData) throw new Error('OSRM не вернул маршрут');
    const result = {
      km: routeData.distance / 1000,
      coords: routeData.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      approx: false
    };
    return routeCache.set(cacheKey, result);
  } catch (err) {
    throw new Error(`Не удалось построить маршрут: ${err.message}`);
  }
}

const TILE_SUBDOMAINS = ['a', 'b', 'c'];

function isValidTileCoord(z, x, y) {
  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(y);
  if (![zi, xi, yi].every(Number.isInteger)) return false;
  if (zi < 0 || zi > 19) return false;
  const max = 2 ** zi;
  return xi >= 0 && xi < max && yi >= 0 && yi < max;
}

/**
 * Проксирование тайлов OpenStreetMap.
 * Прокси нужен, чтобы не светить клиентские запросы и держать кэш на edge.
 */
export async function fetchTile(z, x, y) {
  if (!isValidTileCoord(z, x, y)) return null;

  const cacheKey = `${z}/${x}/${y}`;
  const cached = tileCache.get(cacheKey);
  if (cached) return cached;

  const subdomain = TILE_SUBDOMAINS[(Number(x) + Number(y)) % TILE_SUBDOMAINS.length];
  const response = await fetchWithTimeout(`https://${subdomain}.tile.openstreetmap.org/${z}/${x}/${y}.png`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) return null;

  const buffer = await response.arrayBuffer();
  return tileCache.set(cacheKey, buffer);
}

/**
 * Настройка вебхука Telegram.
 * Если TELEGRAM_WEBHOOK_SECRET задан — он передаётся Telegram'у,
 * иначе вебхук регистрируется без секрета (обратная совместимость).
 */
export async function setTelegramWebhook(webhookUrl, env = {}) {
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
