/**
 * ASMA Lines — общие утилиты, используемые и Cloudflare Worker (_worker.js),
 * и локальным Node-сервером (server.js).
 *
 * Модуль намеренно не использует Node- или Worker-специфичные API,
 * чтобы одинаково работать в workerd и в Node.js.
 */

/** Ошибка валидации входных данных: превращается в HTTP 400, а не 500. */
export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field || null;
    this.status = 400;
  }
}

/** Ошибка конфигурации окружения: превращается в HTTP 500 с понятным текстом. */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.status = 500;
  }
}

/** Ошибка авторизации: превращается в HTTP 401/403. */
export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Приводит телефон к цифровому виду, сохраняя ведущий «+». */
export function normalizePhone(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus || digits.length > 0 ? (hasPlus ? '+' : '') + digits : '';
}

/**
 * Валидация телефона. Принимает белорусские номера в формате
 * +375XXXXXXXXX, а также 80XXXXXXXXX (внутриреспубликанский).
 * Возвращает нормализованный номер или null.
 */
export function normalizeBelarusPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  let local = null;
  if (digits.length === 12 && digits.startsWith('375')) local = digits.slice(3);
  else if (digits.length === 11 && digits.startsWith('80')) local = digits.slice(2);
  else if (digits.length === 9) local = digits;
  if (!local) return null;
  if (!/^(15|16|17|21|22|23|25|29|33|44)\d{7}$/.test(local)) return null;
  return `+375${local}`;
}

export function isValidEmail(raw) {
  if (!raw) return false;
  return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(String(raw).trim());
}

/** Обрезает строку до maxLength, не разрывая суррогатные пары. */
export function clampText(value, maxLength) {
  const str = String(value ?? '');
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength);
}

/** Криптостойкий идентификатор заявки/заметки. */
export function makeId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Разрешённые статусы заявки и порядок переходов (state machine). */
export const LEAD_STATUSES = ['new', 'processing', 'transit', 'completed', 'cancelled'];

export const LEAD_STATUS_NAMES = {
  new: 'Новая заявка',
  processing: 'В работе / Звонок',
  calculation: 'Поиск авто / Расчёт',
  in_transit: 'В рейсе / Исполнение',
  transit: 'В рейсе / Исполнение',
  completed: 'Завершено / Оплачено',
  cancelled: 'Отказ / Архив'
};

export function isValidStatus(status) {
  return LEAD_STATUSES.includes(String(status || ''));
}

/**
 * Поля заявки, которые разрешено менять клиенту CRM.
 * Всё остальное (id, leadNumber, createdAt, price и т.д.) сервер игнорирует —
 * это защита от mass assignment.
 */
export const MUTABLE_LEAD_FIELDS = [
  'status',
  'assignedTo',
  'priority',
  'notes',
  'comment',
  'dispatcher',
  'direction',
  'topic',
  'preferredChannel',
  'contactName',
  'company'
];

/** Оставляет из объекта только разрешённые к изменению поля. */
export function pickMutableLeadFields(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const field of MUTABLE_LEAD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) out[field] = patch[field];
  }
  return out;
}

/** Приводит заметки к безопасному виду (аудит-трейл нельзя подделать целиком). */
export function sanitizeNotes(notes, maxNotes = 500) {
  if (!Array.isArray(notes)) return [];
  return notes.slice(0, maxNotes).map(note => ({
    id: clampText(note?.id || makeId('n'), 64),
    author: clampText(note?.author || 'Диспетчер', 80),
    text: clampText(note?.text || '', 2000),
    time: clampText(note?.time || new Date().toISOString(), 40)
  }));
}

/** Единый формат JSON-ответа API. */
export function jsonEnvelope(data, status = 200) {
  return { status, body: data };
}
