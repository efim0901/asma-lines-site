/**
 * ASMA Lines — локальный Node-сервер для разработки.
 *
 * ВАЖНО: продакшн крутится на Cloudflare (_worker.js). Этот сервер нужен,
 * чтобы проверять сайт и API локально: он реализует тот же контракт API,
 * использует те же модули из _shared/* и те же переменные окружения.
 *
 * Запуск:  npm run dev      (переменные читаются из .dev.vars)
 *
 * Отличия от продакшна:
 *  - данные лежат в data/app-state.json (атомарная запись), а не в D1;
 *  - нет Cloudflare-специфичных вещей (env.ASSETS и т.п.).
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

import { escapeHtml, ValidationError, AuthError, ConfigError, isValidStatus, LEAD_STATUS_NAMES } from './_shared/core.js';
import { normalizeLead } from './_shared/validation.js';
import { createJsonFileStore, LEGACY_STORE_URL } from './_shared/store.js';
import { buildLeadMessage, buildLeadPlainText } from './_shared/notify.js';
import { geocode, route, fetchTile, setTelegramWebhook } from './_shared/geo.js';
import {
  readAccessConfig,
  requireUser,
  requireAdmin,
  isUserAdmin,
  isUserAuthorized,
  verifyWebhookSecret,
  createDocTicket,
  verifyDocTicket,
  callTelegramApi
} from './_shared/telegram.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'app-state.json');

/* ------------------------------------------------------------------ */
/* Переменные окружения: .dev.vars + process.env                      */
/* ------------------------------------------------------------------ */

function loadDevVars() {
  const envFile = path.join(__dirname, '.dev.vars');
  if (!fs.existsSync(envFile)) return;
  const content = fs.readFileSync(envFile, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDevVars();

const ENV = process.env;
const PORT = Number(ENV.PORT) || 3000;

let accessConfig;
try {
  accessConfig = readAccessConfig(ENV);
} catch (error) {
  console.error('\n✖ Ошибка конфигурации:', error.message);
  console.error('  Создайте файл .dev.vars на основе .dev.vars.example\n');
  process.exit(1);
}

if (!accessConfig.botToken) {
  console.warn('⚠ TELEGRAM_BOT_TOKEN не задан — уведомления в Telegram и вебхук работать не будут.');
}

const store = createJsonFileStore(STATE_FILE, fs.promises);

/* ------------------------------------------------------------------ */
/* Ограничение частоты запросов                                       */
/* ------------------------------------------------------------------ */

const rateBuckets = new Map();

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true };
}

function rateLimitMiddleware(name, limit, windowMs) {
  return (req, res, next) => {
    const result = rateLimit(`${name}:${req.ip}`, limit, windowMs);
    if (!result.ok) {
      res.set('Retry-After', String(result.retryAfter));
      return res.status(429).json({ ok: false, error: 'Слишком много запросов. Попробуйте позже.' });
    }
    next();
  };
}

/* ------------------------------------------------------------------ */
/* Приложение                                                         */
/* ------------------------------------------------------------------ */

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));

/** Единый обработчик ошибок: валидация → 400, авторизация → 401/403, конфиг → 500. */
function handleError(res, error) {
  if (error instanceof ValidationError) {
    return res.status(400).json({ ok: false, success: false, error: error.message, field: error.field });
  }
  if (error instanceof AuthError) {
    return res.status(error.status).json({ ok: false, success: false, error: error.message });
  }
  if (error instanceof ConfigError) {
    return res.status(500).json({ ok: false, success: false, error: error.message });
  }
  console.error('API error:', error);
  return res.status(500).json({ ok: false, success: false, error: 'Внутренняя ошибка сервера' });
}

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch(error => handleError(res, error));
}

/* ------------------------------------------------------------------ */
/* Уведомления                                                        */
/* ------------------------------------------------------------------ */

function smtpConfigured() {
  return Boolean(ENV.SMTP_HOST && ENV.SMTP_USER && ENV.SMTP_PASS && ENV.LEAD_EMAIL_TO);
}

/** Письмо о заявке (раньше nodemailer импортировался, но письма не отправлялись). */
async function sendLeadEmail(lead) {
  if (!smtpConfigured()) return { sent: false, reason: 'SMTP не настроен' };
  const transporter = nodemailer.createTransport({
    host: ENV.SMTP_HOST,
    port: Number(ENV.SMTP_PORT) || 587,
    secure: String(ENV.SMTP_SECURE) === 'true',
    auth: { user: ENV.SMTP_USER, pass: ENV.SMTP_PASS }
  });
  const subject =
    lead.type === 'partner'
      ? `🤝 Заявка на партнёрство: ${lead.company || lead.name}`
      : `🚛 Заявка № ${lead.leadNumber}: ${lead.route || 'обратная связь'}`;
  await transporter.sendMail({
    from: ENV.SMTP_FROM || ENV.SMTP_USER,
    to: ENV.LEAD_EMAIL_TO,
    replyTo: lead.email || undefined,
    subject,
    text: buildLeadPlainText(lead)
  });
  return { sent: true };
}

async function notifyLead(lead) {
  if (accessConfig.botToken && accessConfig.chatId) {
    try {
      await callTelegramApi(accessConfig, 'sendMessage', {
        chat_id: accessConfig.chatId,
        text: buildLeadMessage(lead),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (error) {
      console.error('Telegram notify failed:', error.message);
    }
  }
  try {
    const result = await sendLeadEmail(lead);
    if (!result.sent) console.log(`E-mail не отправлен: ${result.reason}`);
  } catch (error) {
    console.error('E-mail notify failed:', error.message);
  }
}

/* ------------------------------------------------------------------ */
/* API: заявки                                                        */
/* ------------------------------------------------------------------ */

app.post(
  '/api/lead',
  rateLimitMiddleware('lead', 10, 60_000),
  asyncRoute(async (req, res) => {
    const lead = normalizeLead(req.body, { allowTelegramHandle: false });
    lead.id = `lead-${crypto.randomUUID()}`;
    lead.leadNumber = await store.nextLeadNumber();
    lead.status = 'new';
    lead.createdAt = new Date().toISOString();
    lead.updatedAt = lead.createdAt;
    lead.notes = [
      {
        id: `n-${crypto.randomUUID()}`,
        author: 'Система',
        text: `Заявка с сайта (${lead.source})`,
        time: lead.createdAt
      }
    ];

    await store.insertLead(lead);
    notifyLead(lead).catch(() => {});

    res.json({
      ok: true,
      success: true,
      message: 'Заявка успешно принята',
      leadId: lead.id,
      leadNumber: lead.leadNumber
    });
  })
);

/* ------------------------------------------------------------------ */
/* API: CRM                                                           */
/* ------------------------------------------------------------------ */

app.get(
  ['/api/crm', '/api/crm/data'],
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    const user = await requireUser(req.headers, data, accessConfig);
    res.json({
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
      isAdmin: isUserAdmin(user, data.authorizedUsers, accessConfig)
    });
  })
);

app.post(
  '/api/crm',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    const user = await requireUser(req.headers, data, accessConfig);
    const action = String(req.body?.action || '');
    const operatorName =
      [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Диспетчер';

    if (action === 'create') {
      const lead = normalizeLead(req.body.lead || {}, { allowTelegramHandle: true });
      lead.id = `lead-${crypto.randomUUID()}`;
      lead.leadNumber = await store.nextLeadNumber();
      lead.status = isValidStatus(req.body.lead?.status) ? req.body.lead.status : 'new';
      lead.source = lead.source || 'crm_manual';
      lead.createdAt = new Date().toISOString();
      lead.updatedAt = lead.createdAt;
      lead.notes = [
        { id: `n-${crypto.randomUUID()}`, author: operatorName, text: 'Заявка создана вручную в CRM', time: lead.createdAt }
      ];
      await store.insertLead(lead);
    } else if (action === 'update_status') {
      const status = String(req.body.status || '');
      if (!isValidStatus(status)) throw new ValidationError('Недопустимый статус заявки', 'status');
      const current = await store.getLead(String(req.body.leadId || ''));
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
      const text = String(req.body.note || '').trim().slice(0, 2000);
      if (!text) throw new ValidationError('Текст заметки пуст', 'note');
      const current = await store.getLead(String(req.body.leadId || ''));
      if (!current) throw new ValidationError('Заявка не найдена', 'leadId');
      const notes = [
        { id: `n-${crypto.randomUUID()}`, author: operatorName, text, time: new Date().toISOString() },
        ...(current.notes || [])
      ].slice(0, 500);
      await store.updateLead(current.id, { notes });
    } else if (action === 'delete') {
      await store.deleteLead(String(req.body.leadId || ''), String(user.id || ''));
    } else if (action === 'assign') {
      await store.updateLead(String(req.body.leadId || ''), { assignedTo: req.body.assignedTo ?? null });
    } else {
      throw new ValidationError('Неизвестное действие', 'action');
    }

    const updated = await store.loadAll();
    res.json({ ok: true, success: true, leads: updated.leads, authorizedUsers: updated.authorizedUsers });
  })
);

/* REST CRUD по заявкам (совместимо с прежними роутами Express) */

app.post(
  '/api/crm/lead',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    const user = await requireUser(req.headers, data, accessConfig);
    const lead = normalizeLead(req.body, { allowTelegramHandle: true });
    lead.id = `lead-${crypto.randomUUID()}`;
    lead.leadNumber = await store.nextLeadNumber();
    lead.status = 'new';
    lead.createdAt = new Date().toISOString();
    lead.updatedAt = lead.createdAt;
    lead.notes = [];
    await store.insertLead(lead);
    res.json({ ok: true, success: true, lead, operator: user.username });
  })
);

app.patch(
  '/api/crm/lead/:id',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    await requireUser(req.headers, data, accessConfig);
    const lead = await store.updateLead(req.params.id, req.body || {});
    if (!lead) return res.status(404).json({ ok: false, error: 'Заявка не найдена' });
    res.json({ ok: true, success: true, lead });
  })
);

app.delete(
  '/api/crm/lead/:id',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    const user = await requireUser(req.headers, data, accessConfig);
    const removed = await store.deleteLead(req.params.id, String(user.id || ''));
    if (!removed) return res.status(404).json({ ok: false, error: 'Заявка не найдена' });
    res.json({ ok: true, success: true });
  })
);

app.post(
  '/api/crm/lead/:id/note',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    const user = await requireUser(req.headers, data, accessConfig);
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) throw new ValidationError('Текст заметки пуст', 'text');
    const current = await store.getLead(req.params.id);
    if (!current) return res.status(404).json({ ok: false, error: 'Заявка не найдена' });
    const note = {
      id: `n-${crypto.randomUUID()}`,
      author: String(req.body?.author || user.username || 'Диспетчер').slice(0, 80),
      text,
      time: new Date().toISOString()
    };
    const notes = [note, ...(current.notes || [])].slice(0, 500);
    const lead = await store.updateLead(current.id, { notes });
    res.json({ ok: true, success: true, note, lead });
  })
);

/* ------------------------------------------------------------------ */
/* API: управление доступом и сотрудники                              */
/* ------------------------------------------------------------------ */

app.get(
  '/api/crm/access',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    await requireUser(req.headers, data, accessConfig);
    res.json({ ok: true, success: true, users: data.authorizedUsers });
  })
);

app.post(
  '/api/crm/access',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    await requireAdmin(req.headers, data, accessConfig);
    const action = String(req.body?.action || '');

    if (action === 'add') {
      const rawUsername = String(req.body?.user?.username || '').replace(/^@/, '').trim();
      const rawId = req.body?.user?.id ? String(req.body.user.id).trim() : '';
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
          name: String(req.body?.user?.name || rawUsername || rawId).slice(0, 100),
          role: String(req.body?.user?.role || 'Диспетчер').slice(0, 60),
          isAdmin: false,
          addedAt: new Date().toISOString()
        }
      ]);
    } else if (action === 'remove') {
      const target = String(req.body?.target || '').replace(/^@/, '').toLowerCase().trim();
      if (!target) throw new ValidationError('Не указан пользователь для удаления', 'target');
      if (target === accessConfig.masterAdminUsername || target === accessConfig.masterAdminId) {
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
    res.json({ ok: true, success: true, users: updated.authorizedUsers });
  })
);

app.get(
  '/api/crm/employees',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    await requireUser(req.headers, data, accessConfig);
    res.json({ ok: true, success: true, employees: await store.listEmployees() });
  })
);

app.post(
  '/api/crm/employee',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    await requireAdmin(req.headers, data, accessConfig);
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (name.length < 2) throw new ValidationError('Укажите имя сотрудника', 'name');
    const employee = {
      id: req.body?.id ? String(req.body.id) : `emp-${crypto.randomUUID()}`,
      name,
      role: String(req.body?.role || 'Диспетчер').slice(0, 60),
      telegramId: req.body?.telegramId ? String(req.body.telegramId) : null,
      createdAt: new Date().toISOString()
    };
    await store.upsertEmployee(employee);
    res.json({ ok: true, success: true, employee });
  })
);

app.delete(
  '/api/crm/employee/:id',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    await requireAdmin(req.headers, data, accessConfig);
    const removed = await store.deleteEmployee(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Сотрудник не найден' });
    res.json({ ok: true, success: true });
  })
);

/* ------------------------------------------------------------------ */
/* API: документы                                                     */
/* ------------------------------------------------------------------ */

app.post(
  '/api/crm/doc-ticket',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    const user = await requireUser(req.headers, data, accessConfig);
    const ticket = await createDocTicket(req.body?.leadId, user, accessConfig);
    res.json({ ok: true, success: true, ticket });
  })
);

app.post(
  '/api/crm/doc-data',
  asyncRoute(async (req, res) => {
    const data = await store.loadAll();
    let operator = null;
    try {
      operator = await requireUser(req.headers, data, accessConfig);
    } catch {
      const ticket = await verifyDocTicket(req.body?.ticket, data, accessConfig);
      if (ticket) operator = { id: ticket.username, username: ticket.username, first_name: ticket.operatorName };
    }
    if (!operator) throw new AuthError('Требуется авторизация или действующий тикет');
    const leadId = String(req.body?.leadId || '');
    const lead = leadId ? await store.getLead(leadId) : null;
    res.json({
      ok: true,
      success: true,
      lead,
      leads: data.leads,
      operator: { name: operator.first_name || operator.username || 'Диспетчер' }
    });
  })
);

/* ------------------------------------------------------------------ */
/* API: гео                                                           */
/* ------------------------------------------------------------------ */

app.get(
  '/api/geocode',
  rateLimitMiddleware('geo', 60, 60_000),
  asyncRoute(async (req, res) => {
    const place = await geocode(req.query.q, ENV);
    if (!place) return res.status(404).json({ ok: false, error: 'Адрес не найден' });
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(place);
  })
);

app.get(
  '/api/route',
  rateLimitMiddleware('route', 60, 60_000),
  asyncRoute(async (req, res) => {
    const { from, to } = req.query;
    const coordPattern = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;
    if (!coordPattern.test(String(from || '')) || !coordPattern.test(String(to || ''))) {
      throw new ValidationError('Ожидаются координаты вида lon,lat в параметрах from и to');
    }
    const result = await route(String(from), String(to));
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(result);
  })
);

app.get(
  '/api/tile/:z/:x/:y.png',
  asyncRoute(async (req, res) => {
    const tile = await fetchTile(req.params.z, req.params.x, req.params.y);
    if (!tile) return res.status(404).send('Not found');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(Buffer.from(tile));
  })
);

/* ------------------------------------------------------------------ */
/* API: Telegram                                                      */
/* ------------------------------------------------------------------ */

app.get('/api/telegram-webhook', (req, res) => {
  res.json({
    ok: true,
    status: 'online',
    service: 'asma-lines-telegram-webhook',
    storage: store.kind,
    configuredBotToken: Boolean(accessConfig.botToken),
    configuredChatId: Boolean(accessConfig.chatId),
    webhookSecretEnforced: Boolean(ENV.TELEGRAM_WEBHOOK_SECRET)
  });
});

app.post(
  '/api/telegram-webhook',
  asyncRoute(async (req, res) => {
    const secret = verifyWebhookSecret(req.get('x-telegram-bot-api-secret-token'), ENV);
    if (!secret.ok) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    await handleBotUpdate(req.body || {});
    res.json({ ok: true });
  })
);

app.post(
  '/api/setup-webhook',
  asyncRoute(async (req, res) => {
    const setupToken = String(ENV.SETUP_TOKEN || '');
    if (!setupToken) {
      throw new ConfigError('Роут отключён: задайте SETUP_TOKEN в .dev.vars, чтобы пользоваться им.');
    }
    const provided = req.get('x-setup-token') || req.query.token || '';
    if (provided !== setupToken) throw new AuthError('Неверный SETUP_TOKEN', 403);
    const webhookUrl = ENV.TELEGRAM_WEBHOOK_URL || `${req.protocol}://${req.get('host')}/api/telegram-webhook`;
    const result = await setTelegramWebhook(webhookUrl, ENV);
    res.json({ ok: true, success: true, webhookUrl, ...result });
  })
);

/* ------------------------------------------------------------------ */
/* Обработка команд бота (локально)                                   */
/* ------------------------------------------------------------------ */

async function handleBotUpdate(update) {
  const message = update.message || update.channel_post || update.edited_message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const from = message.from || message.chat || {};
  const senderId = String(from.id || '');
  const senderUsername = String(from.username || '');
  const text = String(message.text).trim().replace(/@\w+bot/i, '').trim();

  const data = await store.loadAll();
  const pseudoUser = { id: senderId, username: senderUsername };
  const authorized = isUserAuthorized(pseudoUser, data.authorizedUsers, accessConfig);
  const admin = isUserAdmin(pseudoUser, data.authorizedUsers, accessConfig);
  const crmUrl = ENV.CRM_APP_URL || `http://localhost:${PORT}/crm.html`;

  const send = async (body, extra = {}) => {
    if (!accessConfig.botToken) return;
    try {
      await callTelegramApi(accessConfig, 'sendMessage', { chat_id: chatId, text: body, parse_mode: 'HTML', ...extra });
    } catch (error) {
      console.error('sendMessage failed:', error.message);
    }
  };

  const button = { reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть CRM', web_app: { url: crmUrl } }]] } };

  if (text.startsWith('/start') || text.startsWith('/crm') || text.startsWith('/help')) {
    if (!authorized) {
      return send(`⛔ Доступ ограничен.\nВаш Telegram ID: <code>${escapeHtml(senderId)}</code>\nПередайте его администратору.`);
    }
    return send(`🚛 <b>Диспетчерская ASMA Lines</b>\n\nЗдравствуйте! Откройте рабочее место кнопкой ниже.`, button);
  }

  if (text.startsWith('/users') || text.startsWith('/list')) {
    if (!authorized) return send('⛔ У вас нет доступа к этой команде.');
    let listText = '👥 <b>Список доступа</b>\n';
    if (!data.authorizedUsers.length) listText += '<i>Список пуст.</i>';
    data.authorizedUsers.forEach((user, index) => {
      listText += `${index + 1}. <b>${escapeHtml(user.name || 'Сотрудник')}</b> (${user.username ? '@' + escapeHtml(user.username) : 'ID: ' + escapeHtml(user.id)})\n`;
    });
    return send(listText);
  }

  if (text.startsWith('/add')) {
    if (!admin) return send('⛔ Только главный администратор может добавлять пользователей.');
    const parts = text.split(/\s+/).slice(1);
    if (!parts.length) return send('ℹ️ Формат: <code>/add @username Имя</code> или <code>/add 123456789 Имя</code>');
    const rawTarget = parts[0].replace(/^@/, '');
    const isId = /^\d+$/.test(rawTarget);
    const record = {
      id: isId ? rawTarget : null,
      username: isId ? null : rawTarget,
      name: parts.slice(1).join(' ') || rawTarget,
      role: 'Диспетчер',
      isAdmin: false,
      addedAt: new Date().toISOString()
    };
    const exists = data.authorizedUsers.some(
      entry =>
        (record.username && String(entry.username || '').toLowerCase() === record.username.toLowerCase()) ||
        (record.id && String(entry.id || '') === record.id)
    );
    if (exists) return send(`⚠️ <b>${escapeHtml(rawTarget)}</b> уже в списке доступа.`);
    await store.replaceUsers([...data.authorizedUsers, record]);
    return send(`✅ Доступ предоставлен: <b>${escapeHtml(rawTarget)}</b>`);
  }

  if (text.startsWith('/remove') || text.startsWith('/del')) {
    if (!admin) return send('⛔ Только главный администратор может отзывать доступ.');
    const parts = text.split(/\s+/).slice(1);
    if (!parts.length) return send('ℹ️ Формат: <code>/remove @username</code>');
    const target = parts[0].replace(/^@/, '').toLowerCase();
    const filtered = data.authorizedUsers.filter(
      entry => String(entry.username || '').toLowerCase() !== target && String(entry.id || '') !== target
    );
    if (filtered.length === data.authorizedUsers.length) return send(`❓ <b>${escapeHtml(parts[0])}</b> не найден.`);
    await store.replaceUsers(filtered);
    return send(`🗑 Доступ для <b>${escapeHtml(parts[0])}</b> отозван.`);
  }
}

/* ------------------------------------------------------------------ */
/* Служебные роуты                                                    */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    storage: store.kind,
    writable: store.writable,
    botTokenConfigured: Boolean(accessConfig.botToken),
    smtpConfigured: smtpConfigured(),
    time: new Date().toISOString()
  });
});

/** Разовая миграция данных из прежнего публичного JSON-бина. */
app.post(
  '/api/admin/import-legacy',
  asyncRoute(async (req, res) => {
    const setupToken = String(ENV.SETUP_TOKEN || '');
    if (!setupToken) throw new ConfigError('Задайте SETUP_TOKEN, чтобы пользоваться импортом.');
    if ((req.get('x-setup-token') || req.query.token || '') !== setupToken) {
      throw new AuthError('Неверный SETUP_TOKEN', 403);
    }
    const sourceUrl = String(req.body?.url || req.query.url || LEGACY_STORE_URL);
    const response = await fetch(sourceUrl, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new ValidationError(`Источник недоступен: HTTP ${response.status}`);
    const snapshot = await response.json();
    const result = await store.importLegacySnapshot(snapshot);
    res.json({ ok: true, success: true, source: sourceUrl, ...result });
  })
);

/* ------------------------------------------------------------------ */
/* Статика                                                            */
/* ------------------------------------------------------------------ */

const BLOCKED_PATHS = new Set([
  'server.js',
  '_worker.js',
  'package.json',
  'package-lock.json',
  'wrangler.toml',
  'schema.sql',
  'eslint.config.js',
  '.dev.vars',
  '.dev.vars.example',
  '.gitignore',
  '.assetsignore',
  '_headers',
  'metadata.json',
  'DEPLOY-CLOUDFLARE.md'
]);

app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'favicon.ico')));
app.get('/apple-touch-icon.png', (req, res) => res.sendFile(path.join(__dirname, 'apple-touch-icon.png')));

// Явно закрываем служебные пути и каталог с персональными данными.
app.use((req, res, next) => {
  const first = req.path.split('/').filter(Boolean)[0] || '';
  if (req.path.startsWith('/data/') || req.path.startsWith('/_shared/') || BLOCKED_PATHS.has(first)) {
    return res.status(404).send('Not Found');
  }
  next();
});

app.use(
  express.static(__dirname, {
    extensions: ['html'],
    index: 'index.html',
    dotfiles: 'deny'
  })
);

app.get('*', (req, res) => {
  if (req.path.includes('.')) return res.status(404).send('Not Found');
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ------------------------------------------------------------------ */
/* Запуск                                                             */
/* ------------------------------------------------------------------ */

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`ASMA Lines dev server: http://localhost:${PORT}`);
  console.log(`Хранилище: ${store.kind} (${STATE_FILE})`);
  console.log(`Telegram: ${accessConfig.botToken ? 'настроен' : 'НЕ настроен'} · E-mail: ${smtpConfigured() ? 'настроен' : 'не настроен'}`);
});

/** Аккуратное завершение: не обрываем запись в файл на середине. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal}: завершение работы…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

process.on('unhandledRejection', reason => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});
