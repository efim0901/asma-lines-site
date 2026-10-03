/**
 * ASMA Lines — валидация и нормализация заявок.
 * Используется и Worker'ом, и Node-сервером: раньше ни одна из реализаций
 * не проверяла входные данные вообще.
 */

import {
  ValidationError,
  normalizeBelarusPhone,
  isValidEmail,
  clampText,
  makeId,
  sanitizeNotes
} from './core.js';
import { calculatePrice, LIMITS, vehicleForWeight } from './pricing.js';

export const LEAD_LIMITS = Object.freeze({
  nameMin: 2,
  nameMax: 80,
  commentMax: 2000,
  cityMax: 60,
  routeMax: 160,
  emailMax: 120,
  sourceMax: 60
});

function requiredString(value, field, { min = 1, max = 200 } = {}) {
  const str = clampText(String(value ?? '').trim(), max);
  if (str.length < min) {
    throw new ValidationError(`Поле «${field}» обязательно (минимум ${min} символа)`, field);
  }
  return str;
}

function optionalString(value, max = 200) {
  if (value === null || value === undefined) return '';
  return clampText(String(value).trim(), max);
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

/**
 * Разбирает строку вида «Гомель -> Витебск, 335km, 10t, est 818 BYN».
 * Старая регулярка `est\s*(\d+)` не понимала числа от 1000 и разделители
 * разрядов — теперь поддерживаются оба варианта.
 */
export function parseRouteDetails(routeDetails) {
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
 * Контакт клиента. На публичных формах требуем белорусский телефон,
 * в ручной заявке CRM допускаем также Telegram-ник (поле подписано
 * «Телефон или Telegram»).
 */
export function normalizeContact(raw, allowTelegramHandle = false) {
  const phone = normalizeBelarusPhone(raw);
  if (phone) return phone;

  if (allowTelegramHandle) {
    const handle = String(raw || '').trim();
    if (/^@?[A-Za-z0-9_]{4,32}$/.test(handle)) {
      return handle.startsWith('@') ? handle : `@${handle}`;
    }
  }
  return null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Валидирует и нормализует заявку с сайта.
 *
 * Возвращает объект с полями в «старом» формате (route/distance/weight/price —
 * строки для отображения и Telegram) плюс машинночитаемые distanceKm/weightTons
 * и посчитанную сервером priceBreakdown.
 *
 * @param {object} body — тело запроса
 * @param {{ allowTelegramHandle?: boolean, requireDistanceAndWeight?: boolean }} [options]
 * @throws {ValidationError}
 */
export function normalizeLead(body, options = {}) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Тело запроса должно быть JSON-объектом');
  }

  const routeDetails = optionalString(body.route_details, LEAD_LIMITS.routeMax);
  const parsedDetails = parseRouteDetails(routeDetails);

  const name = requiredString(body.name || body.contact_name, 'Имя', {
    min: LEAD_LIMITS.nameMin,
    max: LEAD_LIMITS.nameMax
  });

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

  const email = optionalString(body.email, LEAD_LIMITS.emailMax);
  if (email && !isValidEmail(email)) {
    throw new ValidationError('Некорректный e-mail', 'email');
  }

  const fromCity = optionalString(body.fromCity, LEAD_LIMITS.cityMax) || parsedDetails.fromCity;
  const toCity = optionalString(body.toCity, LEAD_LIMITS.cityMax) || parsedDetails.toCity;

  const distanceKm = parseNumber(body.distance) ?? parsedDetails.distanceKm;
  const weightTons = parseNumber(body.weight) ?? parsedDetails.weightTons;
  const volumeM3 = parseNumber(body.volume);

  const comment = clampText(optionalString(body.comment || body.message, LEAD_LIMITS.commentMax), LEAD_LIMITS.commentMax) || '—';
  const source = optionalString(body.source, LEAD_LIMITS.sourceMax) || 'Форма сайта';
  const company = optionalString(body.company, LEAD_LIMITS.nameMax);
  const cargo = ['fragile', 'temperature'].includes(body.cargo) ? body.cargo : 'standard';
  const loading = body.loading === true || body.loading === 'true';

  const isPartner = source === 'website_partners' || Boolean(company);

  // Заявка считаетcя расчётом перевозки, если есть маршрут и параметры груза.
  const wantsQuote = Boolean(
    (fromCity && toCity) ||
      (distanceKm && weightTons) ||
      source === 'calculator_modal' ||
      source === 'website_calculator'
  );

  let quote = null;
  let quoteError = null;
  if (wantsQuote && !isPartner) {
    try {
      quote = calculatePrice({ distanceKm, weightTons, cargo, loading, volumeM3 });
    } catch (err) {
      // Не роняем заявку из-за неполного расчёта — логируем и сохраняем как есть.
      quoteError = err.message;
    }
  }

  if (options.requireDistanceAndWeight && !quote && !isPartner) {
    throw new ValidationError(
      `Не удалось рассчитать стоимость: ${quoteError || 'укажите расстояние и вес груза'}`,
      'distance'
    );
  }

  const route = fromCity && toCity ? `${fromCity} → ${toCity}` : routeDetails || 'Маршрут по запросу';
  const tier = quote ? vehicleForWeight(weightTons) : null;

  return {
    name,
    contact,
    contactRaw: clampText(optionalString(rawContact, 40), 40),
    email,
    fromCity,
    toCity,
    route,
    distance: distanceKm ? `${Math.round(distanceKm)} км` : '',
    distanceKm: distanceKm ?? null,
    vehicle: optionalString(body.vehicle, 80) || tier?.vehicle || '',
    weight: weightTons ? `${weightTons} т` : '',
    weightTons: weightTons ?? null,
    volume: volumeM3 ? `${volumeM3} м³` : '',
    volumeM3: volumeM3 ?? null,
    // Цена ВСЕГДА считается на сервере. Значение из запроса игнорируется.
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

/** Приводит заявку из БД к единому виду (миграция старых записей «на лету»). */
export function normalizeStoredLead(lead) {
  if (!lead || typeof lead !== 'object') return null;
  const notes = sanitizeNotes(lead.notes);
  return {
    ...lead,
    id: String(lead.id || makeId('lead')),
    leadNumber: lead.leadNumber !== undefined && lead.leadNumber !== null ? String(lead.leadNumber) : '',
    status: lead.status || 'new',
    notes,
    assignedTo: lead.assignedTo ?? null,
    priority: lead.priority || 'normal',
    updatedAt: lead.updatedAt || lead.createdAt || new Date().toISOString()
  };
}

export { LIMITS };
