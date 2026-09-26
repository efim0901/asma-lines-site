import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const DELETED_LEADS_FILE = path.join(DATA_DIR, 'deleted_leads.json');
const ACCESS_USERS_FILE = path.join(DATA_DIR, 'access_users.json');
const EMPLOYEES_FILE = path.join(DATA_DIR, 'employees.json');

const MASTER_ADMIN_USERNAME = 'plombit';
const MASTER_ADMIN_ID = '1014012851';

function sanitizeUsers(users) {
  if (!Array.isArray(users)) users = [];
  const list = [...users];
  const hasMaster = list.some(u => 
    (u.username && u.username.toLowerCase() === MASTER_ADMIN_USERNAME) ||
    (u.id && String(u.id) === MASTER_ADMIN_ID)
  );
  if (!hasMaster) {
    list.unshift({
      id: '1014012851',
      username: 'plombit',
      name: 'Иван Ефимович',
      role: 'Главный администратор',
      isAdmin: true,
      addedAt: '2026-09-17T10:00:00.000Z'
    });
  } else {
    list.forEach(u => {
      if ((u.username && u.username.toLowerCase() === MASTER_ADMIN_USERNAME) ||
          (u.id && String(u.id) === MASTER_ADMIN_ID)) {
        u.isAdmin = true;
      }
    });
  }
  return list;
}

function checkUserAdmin(tgUser) {
  if (!tgUser) return false;
  const username = (tgUser.username || '').toLowerCase().replace(/^@/, '');
  const id = String(tgUser.id || '');
  return username === MASTER_ADMIN_USERNAME || id === MASTER_ADMIN_ID;
}

function extractTgUserFromReq(req) {
  const initDataStr = req.headers['x-telegram-init-data'];
  if (!initDataStr) return null;
  try {
    const params = new URLSearchParams(initDataStr);
    const userRaw = params.get('user');
    if (!userRaw) return null;
    return JSON.parse(userRaw);
  } catch (e) {
    return null;
  }
}

function isReqAuthorized(req, authorizedUsers = []) {
  const user = extractTgUserFromReq(req);
  if (!user) return false;
  const username = (user.username || '').toLowerCase().replace(/^@/, '');
  const id = String(user.id || '');
  if (username === MASTER_ADMIN_USERNAME || id === MASTER_ADMIN_ID) return true;
  return (authorizedUsers || []).some(u => {
    const uName = (u.username || '').toLowerCase().replace(/^@/, '');
    const uId = String(u.id || '');
    return (uName && uName === username) || (uId && uId === id);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function readJsonFile(file, fallback = []) {
  try {
    const raw = await fs.promises.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

async function writeJsonFile(file, data) {
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write file:', file, err.message);
  }
}

const app = express();
const PORT = 3000;

// Middleware for parsing JSON bodies
app.use(express.json());

// In-memory caches for fast responses
const geocodeCache = new Map();
const routeCache = new Map();
const tileCache = new Map();

// Map tile proxy endpoint (no API keys, no external client calls, full road network)
app.get('/api/tile/:z/:x/:y.png', async (req, res) => {
  const { z, x, y } = req.params;
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) {
    const cached = tileCache.get(key);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(cached);
  }
  try {
    const servers = ['a', 'b', 'c'];
    const s = servers[(parseInt(x, 10) + parseInt(y, 10)) % 3];
    const tileUrl = `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
    const response = await fetch(tileUrl, {
      headers: {
        'User-Agent': 'ASMALines-Logistics/1.0 (info@asmalines.by)'
      }
    });
    if (!response.ok) return res.status(404).send('Not found');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (tileCache.size > 1500) {
      const oldKeys = Array.from(tileCache.keys()).slice(0, 400);
      for (const k of oldKeys) tileCache.delete(k);
    }
    tileCache.set(key, buffer);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.send(buffer);
  } catch (err) {
    res.status(502).send('Tile fetch error');
  }
});

// Geocoding endpoint with Yandex Geocoder API
const YANDEX_GEOCODER_KEY = '2b03b76a-d572-4352-a42a-ccbee8ea4dfd';

app.get('/api/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query' });
  const key = q.toLowerCase();
  if (geocodeCache.has(key)) {
    return res.json(geocodeCache.get(key));
  }
  
  // 1. Try Yandex Geocoder API
  try {
    const yandexUrl = `https://geocode-maps.yandex.ru/1.x/?apikey=${YANDEX_GEOCODER_KEY}&geocode=${encodeURIComponent(q + ', Беларусь')}&format=json&results=1`;
    const response = await fetch(yandexUrl);
    if (response.ok) {
      const data = await response.json();
      const feature = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
      if (feature && feature.Point && feature.Point.pos) {
        const [lonStr, latStr] = feature.Point.pos.split(' ');
        const place = {
          lat: parseFloat(latStr),
          lon: parseFloat(lonStr),
          name: feature.name || q.split(',')[0].trim()
        };
        geocodeCache.set(key, place);
        return res.json(place);
      }
    }
  } catch (err) {
    console.warn('Yandex Geocode API fetch failed, falling back to OSM:', err.message);
  }

  // 2. Fallback to OpenStreetMap Nominatim
  try {
    const fetchUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=by&accept-language=ru&q=${encodeURIComponent(q)}`;
    const response = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'ASMALines-Logistics/1.0 (info@asmalines.by)' }
    });
    if (!response.ok) return res.json(null);
    const rows = await response.json();
    const row = rows && rows[0];
    const place = row ? {
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      name: (row.display_name || q).split(',')[0].trim()
    } : null;
    geocodeCache.set(key, place);
    res.json(place);
  } catch (err) {
    console.error('Geocode error:', err.message);
    res.json(null);
  }
});

// Routing endpoint
app.get('/api/route', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Missing from/to coordinates' });
  const key = `${from}|${to}`;
  if (routeCache.has(key)) {
    return res.json(routeCache.get(key));
  }
  try {
    const fetchUrl = `https://router.project-osrm.org/route/v1/driving/${encodeURIComponent(from)};${encodeURIComponent(to)}?overview=full&geometries=geojson`;
    const response = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'ASMALines-Logistics/1.0 (info@asmalines.by)' }
    });
    if (!response.ok) throw new Error(`OSRM status ${response.status}`);
    const data = await response.json();
    const route = data.routes && data.routes[0];
    if (!route) throw new Error('No route found');
    const result = {
      km: route.distance / 1000,
      coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      approx: false
    };
    routeCache.set(key, result);
    res.json(result);
  } catch (err) {
    console.error('Route error:', err.message);
    res.status(502).json({ error: 'Routing failed' });
  }
});

// API route for lead submissions from contact/partner/calculator forms
app.post('/api/lead', async (req, res) => {
  const { name, phone, email, contact, fromCity, toCity, distance, vehicle, weight, volume, price, comment, message, route_details, source } = req.body;
  
  // Parse fallback details from route_details string if provided (e.g. "Гомель -> Витебск, 335km, 10t, est 818 BYN")
  let parsedDist = distance;
  let parsedWeight = weight;
  let parsedPrice = price;

  if (route_details && typeof route_details === 'string') {
    const kmMatch = route_details.match(/(\d+)\s*km/i);
    const tMatch = route_details.match(/(\d+)\s*t/i);
    const priceMatch = route_details.match(/est\s*(\d+)\s*BYN/i);
    if (!parsedDist && kmMatch) parsedDist = kmMatch[1];
    if (!parsedWeight && tMatch) parsedWeight = tMatch[1];
    if (!parsedPrice && priceMatch) parsedPrice = priceMatch[1];
  }

  const leadData = {
    name: name || 'Не указано',
    contact: phone || contact || 'Не указан',
    email: email || '',
    route: (fromCity && toCity) ? `${fromCity} → ${toCity}` : (route_details || 'Маршрут по запросу'),
    distance: parsedDist ? (String(parsedDist).includes('км') ? parsedDist : `${parsedDist} км`) : '',
    vehicle: vehicle || '',
    weight: parsedWeight ? (String(parsedWeight).includes('т') ? parsedWeight : `${parsedWeight} т`) : '',
    volume: volume ? (String(volume).includes('м³') ? volume : `${volume} м³`) : '',
    price: parsedPrice ? (String(parsedPrice).includes('BYN') ? parsedPrice : `${parsedPrice} BYN`) : '',
    comment: comment || message || '—',
    source: source || 'Форма сайта'
  };

  console.log('Lead submission received:', leadData);

  // Send Telegram notification
  const defaultBotToken = '8808722578:AAEiNdtl3ut-oYBIrCFOFZYPy1vnYVd9VMY';
  const defaultChatId = '-5230752915';
  const botToken = process.env.TELEGRAM_BOT_TOKEN || defaultBotToken;
  let chatId = process.env.TELEGRAM_CHAT_ID || global.lastTelegramChatId || defaultChatId;

  // Auto-detect chat_id if not explicitly set
  if (botToken && !chatId) {
    try {
      const updatesRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
      const updatesData = await updatesRes.json();
      if (updatesData.ok && updatesData.result && updatesData.result.length > 0) {
        const lastUpdate = updatesData.result[updatesData.result.length - 1];
        const detectedChat = lastUpdate.channel_post?.chat || lastUpdate.message?.chat || lastUpdate.my_chat_member?.chat;
        if (detectedChat && detectedChat.id) {
          chatId = detectedChat.id;
          global.lastTelegramChatId = chatId;
          console.log('Auto-detected Telegram Chat ID:', chatId);
        }
      }
    } catch (e) {
      console.warn('Telegram chat_id auto-detection failed:', e.message);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const isPartner = leadData.source === 'website_partners' || Boolean(req.body.company);
  const isCargoOrder = !isPartner && Boolean(
    (req.body.fromCity && req.body.toCity) ||
    (leadData.route && leadData.route !== 'Маршрут по запросу') ||
    leadData.source === 'calculator_modal' ||
    leadData.source === 'website_calculator' ||
    (leadData.distance && leadData.vehicle) ||
    leadData.price
  );

  const routeStr = (req.body.fromCity && req.body.toCity) ? `${req.body.fromCity} → ${req.body.toCity}` : (leadData.route !== 'Маршрут по запросу' ? leadData.route : '');
  const nowStr = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' });

  let textHtml = '';
  let emailSubject = '';
  let emailBody = '';

  if (isCargoOrder) {
    // 1. ЗАЯВКА НА ПЕРЕВОЗКУ ГРУЗА
    textHtml = `🚛 <b>ЗАЯВКА НА ПЕРЕВОЗКУ ГРУЗА (ASMA LINES)</b>\n`;
    textHtml += `───────────────────────\n`;
    textHtml += `👤 <b>Клиент / Компания:</b> ${escapeHtml(leadData.name)}\n`;
    textHtml += `📞 <b>Контакты:</b> ${escapeHtml(leadData.contact)}\n`;
    if (leadData.email) textHtml += `📧 <b>Email:</b> ${escapeHtml(leadData.email)}\n`;

    textHtml += `\n📦 <b>УСЛОВИЯ И ДЕТАЛИ РЕЙСА:</b>\n`;
    if (routeStr) textHtml += `📍 <b>Маршрут:</b> ${escapeHtml(routeStr)}\n`;
    if (leadData.distance) textHtml += `📏 <b>Расстояние:</b> ${escapeHtml(leadData.distance)}\n`;
    if (leadData.vehicle) textHtml += `🚚 <b>Транспорт:</b> ${escapeHtml(leadData.vehicle)}\n`;
    if (leadData.weight) textHtml += `⚖️ <b>Вес груза:</b> ${escapeHtml(leadData.weight)}\n`;
    if (leadData.volume) textHtml += `📦 <b>Объём:</b> ${escapeHtml(leadData.volume)}\n`;
    if (leadData.price) textHtml += `💰 <b>Предварительный расчёт:</b> ${escapeHtml(leadData.price)}\n`;

    if (leadData.comment && leadData.comment !== '—') {
      textHtml += `\n💬 <b>Комментарий заказчика:</b>\n${escapeHtml(leadData.comment)}\n`;
    }

    textHtml += `───────────────────────\n`;
    textHtml += `⏱ <b>Время:</b> ${nowStr} (Минск)\n`;
    textHtml += `🌐 <b>Источник:</b> Калькулятор перевозки (Сайт ASMA Lines)`;

    emailSubject = `🚛 ЗАЯВКА НА ПЕРЕВОЗКУ: ${leadData.name} (${routeStr ? routeStr + ', ' : ''}${leadData.contact})`;
    emailBody = `ЗАЯВКА НА ПЕРЕВОЗКУ ГРУЗА (ASMA Lines)\n` +
      `--------------------------------------\n` +
      `Клиент: ${leadData.name}\n` +
      `Контакты: ${leadData.contact}\n` +
      (leadData.email ? `Email: ${leadData.email}\n` : '') +
      `Маршрут: ${routeStr || 'Уточняется'}\n` +
      (leadData.distance ? `Расстояние: ${leadData.distance}\n` : '') +
      (leadData.vehicle ? `Транспорт: ${leadData.vehicle}\n` : '') +
      (leadData.weight ? `Вес груза: ${leadData.weight}\n` : '') +
      (leadData.volume ? `Объём груза: ${leadData.volume}\n` : '') +
      (leadData.price ? `Предварительный расчёт: ${leadData.price}\n` : '') +
      `Комментарий: ${leadData.comment}\n` +
      `Время отправки: ${nowStr}\n` +
      `Источник: Калькулятор перевозки\n`;

  } else if (isPartner) {
    // 2. ЗАЯВКА НА СОТРУДНИЧЕСТВО (ПАРТНЕРЫ)
    textHtml = `🤝 <b>ЗАЯВКА НА СОТРУДНИЧЕСТВО (ПАРТНЁРЫ)</b>\n`;
    textHtml += `───────────────────────\n`;
    if (req.body.company) textHtml += `🏢 <b>Компания:</b> ${escapeHtml(req.body.company)}\n`;
    textHtml += `👤 <b>Контактное лицо:</b> ${escapeHtml(req.body.contact_name || leadData.name)}\n`;
    textHtml += `📞 <b>Контакты:</b> ${escapeHtml(leadData.contact)}\n`;
    if (req.body.direction) textHtml += `🚛 <b>Направление / Автопарк:</b> ${escapeHtml(req.body.direction)}\n`;
    if (leadData.comment && leadData.comment !== '—') {
      textHtml += `\n💬 <b>Сообщение:</b>\n${escapeHtml(leadData.comment)}\n`;
    }
    textHtml += `───────────────────────\n`;
    textHtml += `⏱ <b>Время:</b> ${nowStr} (Минск)\n`;
    textHtml += `🌐 <b>Источник:</b> Раздел «Партнёрам» (Сайт ASMA Lines)`;

    emailSubject = `🤝 СОТРУДНИЧЕСТВО: ${req.body.company || leadData.name} (${leadData.contact})`;
    emailBody = `ЗАЯВКА НА СОТРУДНИЧЕСТВО (ПАРТНЕРЫ)\n` +
      `--------------------------------------\n` +
      (req.body.company ? `Компания: ${req.body.company}\n` : '') +
      `Контактное лицо: ${req.body.contact_name || leadData.name}\n` +
      `Контакты: ${leadData.contact}\n` +
      (req.body.direction ? `Направление/Парк: ${req.body.direction}\n` : '') +
      `Сообщение: ${leadData.comment}\n` +
      `Время: ${nowStr}\n`;

  } else {
    // 3. ЗАЯВКА НА ОБРАТНУЮ СВЯЗЬ (КОНТАКТЫ / КОНСУЛЬТАЦИЯ)
    textHtml = `📩 <b>ЗАЯВКА НА ОБРАТНУЮ СВЯЗЬ</b>\n`;
    textHtml += `───────────────────────\n`;
    textHtml += `👤 <b>Имя / Клиент:</b> ${escapeHtml(leadData.name)}\n`;
    textHtml += `📞 <b>Контакты:</b> ${escapeHtml(leadData.contact)}\n`;
    if (leadData.email) textHtml += `📧 <b>Email:</b> ${escapeHtml(leadData.email)}\n`;

    textHtml += `\n💬 <b>Текст обращения / Вопрос:</b>\n`;
    textHtml += `${escapeHtml(leadData.comment && leadData.comment !== '—' ? leadData.comment : 'Заказ обратного звонка / консультации')}\n`;

    textHtml += `───────────────────────\n`;
    textHtml += `⏱ <b>Время:</b> ${nowStr} (Минск)\n`;
    textHtml += `🌐 <b>Источник:</b> Форма обратной связи (Контакты, ASMA Lines)`;

    emailSubject = `📩 ОБРАТНАЯ СВЯЗЬ: ${leadData.name} (${leadData.contact})`;
    emailBody = `ЗАЯВКА НА ОБРАТНУЮ СВЯЗЬ (ASMA Lines)\n` +
      `--------------------------------------\n` +
      `Имя / Клиент: ${leadData.name}\n` +
      `Контакты: ${leadData.contact}\n` +
      (leadData.email ? `Email: ${leadData.email}\n` : '') +
      `Текст обращения: ${leadData.comment}\n` +
      `Время отправки: ${nowStr}\n` +
      `Источник: Форма обратной связи (Контакты)\n`;
  }

  // Save to CRM Database (data/leads.json)
  let savedLead = null;
  try {
    const leads = await readJsonFile(LEADS_FILE, []);
    const maxNum = leads.reduce((max, l) => {
      const num = parseInt(l.leadNumber, 10);
      return !isNaN(num) && num > max ? num : max;
    }, 100);
    const newNum = String(maxNum + 1);

    savedLead = {
      id: 'lead-' + Date.now(),
      leadNumber: newNum,
      type: isPartner ? 'partner' : (isCargoOrder ? 'cargo' : 'contact'),
      category: isPartner ? 'Заявка на сотрудничество' : (isCargoOrder ? 'Заявка на перевозку груза' : 'Заявка на обратную связь'),
      status: 'new',
      createdAt: new Date().toISOString(),
      name: leadData.name,
      contact: leadData.contact,
      email: leadData.email,
      fromCity: req.body.fromCity || '',
      toCity: req.body.toCity || '',
      route: routeStr || (leadData.route !== 'Маршрут по запросу' ? leadData.route : 'По согласованию'),
      distance: leadData.distance || '',
      vehicle: leadData.vehicle || '',
      weight: leadData.weight || '',
      volume: leadData.volume || '',
      price: leadData.price || '',
      comment: leadData.comment !== '—' ? leadData.comment : '',
      assignedTo: null,
      priority: isCargoOrder ? 'high' : 'normal',
      notes: [
        {
          id: 'n-' + Date.now(),
          author: 'Система',
          text: `Заявка поступила с сайта: ${leadData.source}`,
          time: new Date().toISOString()
        }
      ],
      source: leadData.source
    };

    leads.unshift(savedLead);
    await writeJsonFile(LEADS_FILE, leads);

    try {
      await fetch(CRM_STORAGE_BIN, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads })
      });
    } catch (binErr) {}
  } catch (dbErr) {
    console.error('Failed to persist lead in CRM database:', dbErr.message);
  }

  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || 'http';
  const crmUrl = `${protocol}://${host}/crm.html`;
  const botUsername = process.env.TELEGRAM_USERNAME || 'asmalinesbot';

  if (botToken && chatId) {
    try {
      const isPrivateChat = Number(chatId) > 0;
      const tgBotUrl = `https://t.me/${botUsername}?start=crm`;

      const inlineKeyboard = [];
      if (isPrivateChat) {
        inlineKeyboard.push([
          {
            text: '🚀 Открыть CRM в Telegram',
            web_app: { url: crmUrl }
          }
        ]);
      } else {
        inlineKeyboard.push([
          {
            text: '🚀 Открыть CRM в Telegram',
            url: tgBotUrl
          }
        ]);
      }

      const tgPayload = {
        chat_id: chatId,
        text: textHtml,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      };

      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tgPayload)
      });
      const tgData = await tgRes.json();
      console.log('Telegram lead notification result:', tgData);
    } catch (err) {
      console.error('Telegram notification error:', err.message);
    }
  } else {
    console.log('Telegram bot active, waiting for bot to be added to channel/chat to obtain Chat ID');
  }

  // Send PlanFix Webhook if PLANFIX_WEBHOOK_URL is set
  const planfixUrl = process.env.PLANFIX_WEBHOOK_URL;
  if (planfixUrl) {
    try {
      await fetch(planfixUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadData)
      });
      console.log('Lead successfully sent to PlanFix webhook');
    } catch (err) {
      console.error('PlanFix webhook error:', err.message);
    }
  }

  // Send PlanFix Task Email (Plomba@asma.planfix.com)
  const planfixEmail = process.env.PLANFIX_EMAIL || 'Plomba@asma.planfix.com';
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER || 'efiv737@gmail.com';
  const smtpPass = process.env.SMTP_PASS || 'pxvfrohlssilipvg';

  if (smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
        tls: { rejectUnauthorized: false }
      });

      await transporter.sendMail({
        from: `"ASMA Lines" <${smtpUser}>`,
        to: planfixEmail,
        subject: emailSubject,
        text: emailBody
      });
      console.log(`Lead email task successfully dispatched to PlanFix (${planfixEmail})`);
    } catch (err) {
      if (err.message.includes('535') || err.message.includes('Username and Password not accepted')) {
        console.error('PlanFix email dispatch error: Gmail требует "Пароль приложения" (App Password) вместо обычного пароля от аккаунта.');
      } else {
        console.error('PlanFix email dispatch error:', err.message);
      }
    }
  }

  res.json({
    success: true,
    message: 'Заявка успешно принята',
    leadId: savedLead ? savedLead.id : null,
    leadNumber: savedLead ? savedLead.leadNumber : null
  });
});

// ==================== CRM API ROUTES & SYNCHRONIZED STORAGE ====================
const CRM_STORAGE_BIN = 'https://json.extendsclass.com/bin/becdbda';

async function getCloudStorage() {
  let storeData = { leads: [], deletedIds: [], authorizedUsers: [] };
  try {
    const storeRes = await fetch(CRM_STORAGE_BIN + '?_t=' + Date.now(), { cache: 'no-store' });
    if (storeRes.ok) {
      const json = await storeRes.json();
      if (json && typeof json === 'object') {
        storeData.leads = Array.isArray(json.leads) ? json.leads : [];
        storeData.deletedIds = Array.isArray(json.deletedIds) ? json.deletedIds : [];
        storeData.authorizedUsers = Array.isArray(json.authorizedUsers) ? json.authorizedUsers : [];
      }
    }
  } catch (e) {
    console.warn('getCloudStorage warning:', e.message);
  }

  if (storeData.leads.length === 0) {
    const localLeads = await readJsonFile(LEADS_FILE, []);
    if (localLeads.length > 0) storeData.leads = localLeads;
  }
  if (storeData.deletedIds.length === 0) {
    const localDel = await readJsonFile(DELETED_LEADS_FILE, []);
    if (localDel.length > 0) storeData.deletedIds = localDel;
  }
  if (storeData.authorizedUsers.length === 0) {
    const localUsers = await readJsonFile(ACCESS_USERS_FILE, []);
    if (localUsers.length > 0) storeData.authorizedUsers = localUsers;
  }

  storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers);

  if (storeData.deletedIds.length > 0) {
    const delSet = new Set(storeData.deletedIds);
    storeData.leads = storeData.leads.filter(l => !delSet.has(l.id));
  }

  return storeData;
}

async function saveCloudStorage(storeData) {
  if (!storeData) return;
  storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers);

  if (Array.isArray(storeData.deletedIds) && storeData.deletedIds.length > 0) {
    const delSet = new Set(storeData.deletedIds);
    if (Array.isArray(storeData.leads)) {
      storeData.leads = storeData.leads.filter(l => !delSet.has(l.id));
    }
  }

  if (Array.isArray(storeData.leads)) await writeJsonFile(LEADS_FILE, storeData.leads);
  if (Array.isArray(storeData.deletedIds)) await writeJsonFile(DELETED_LEADS_FILE, storeData.deletedIds);
  if (Array.isArray(storeData.authorizedUsers)) await writeJsonFile(ACCESS_USERS_FILE, storeData.authorizedUsers);

  try {
    await fetch(CRM_STORAGE_BIN, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(storeData)
    });
  } catch (e) {
    console.warn('saveCloudStorage PUT warning:', e.message);
  }

  return storeData;
}

// GET /api/crm and /api/crm/data
app.get(['/api/crm', '/api/crm/data'], async (req, res) => {
  try {
    const store = await getCloudStorage();
    if (!isReqAuthorized(req, store.authorizedUsers)) {
      return res.status(401).json({
        error: 'Доступ запрещён: требуется авторизация через официальный Telegram-бот ASMA Lines'
      });
    }

    res.json({
      success: true,
      leads: store.leads,
      deletedIds: store.deletedIds,
      authorizedUsers: store.authorizedUsers
    });
  } catch (err) {
    res.status(500).json({ error: 'CRM data retrieval failed: ' + err.message });
  }
});

// GET & POST /api/crm/access
app.get('/api/crm/access', async (req, res) => {
  try {
    const store = await getCloudStorage();
    res.json({
      success: true,
      users: store.authorizedUsers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crm/access', async (req, res) => {
  try {
    const { action, user, target, requestedBy } = req.body;
    if (!checkUserAdmin(requestedBy)) {
      return res.status(403).json({ error: 'Доступ запрещён: только @plombit может управлять списком' });
    }

    const store = await getCloudStorage();
    let users = store.authorizedUsers;

    if (action === 'add' && user) {
      const rawUser = (user.username || '').replace(/^@/, '').trim();
      const rawId = user.id ? String(user.id).trim() : '';
      const name = (user.name || rawUser || rawId || 'Диспетчер').trim();
      const role = (user.role || 'Диспетчер').trim();

      if (!rawUser && !rawId) {
        return res.status(400).json({ error: 'Укажите username или Telegram ID' });
      }

      const exists = users.some(u => 
        (rawUser && u.username && u.username.toLowerCase() === rawUser.toLowerCase()) ||
        (rawId && u.id && String(u.id) === rawId)
      );

      if (exists) {
        return res.status(400).json({ error: 'Пользователь уже есть в списке доступа' });
      }

      users.push({
        id: rawId || null,
        username: rawUser || null,
        name,
        role,
        isAdmin: false,
        addedAt: new Date().toISOString()
      });
    } else if (action === 'remove' && target) {
      const cleanTarget = String(target).replace(/^@/, '').toLowerCase().trim();
      if (cleanTarget === MASTER_ADMIN_USERNAME || cleanTarget === MASTER_ADMIN_ID) {
        return res.status(400).json({ error: 'Нельзя удалить главного администратора' });
      }
      users = users.filter(u => {
        const uName = (u.username || '').toLowerCase().replace(/^@/, '');
        const uId = String(u.id || '');
        return uName !== cleanTarget && uId !== cleanTarget;
      });
    }

    store.authorizedUsers = sanitizeUsers(users);
    await saveCloudStorage(store);

    res.json({ success: true, users: store.authorizedUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm - update leads list or sync from WebApp
app.post('/api/crm', async (req, res) => {
  try {
    const store = await getCloudStorage();
    if (!isReqAuthorized(req, store.authorizedUsers)) {
      return res.status(401).json({ error: 'Доступ запрещён: требуется авторизация через Telegram' });
    }

    const { leads, deletedIds, action, leadId, authorizedUsers } = req.body;

    if (Array.isArray(deletedIds)) {
      store.deletedIds = Array.from(new Set([...store.deletedIds, ...deletedIds]));
    }

    if (action === 'delete' && leadId) {
      if (!store.deletedIds.includes(leadId)) store.deletedIds.push(leadId);
      store.leads = store.leads.filter(l => l.id !== leadId);
    }

    if (Array.isArray(leads)) {
      store.leads = leads;
    }

    if (Array.isArray(authorizedUsers) && authorizedUsers.length > 0) {
      // Merge authorized users preserving existing
      authorizedUsers.forEach(au => {
        const exists = store.authorizedUsers.some(u =>
          (au.username && u.username && u.username.toLowerCase() === au.username.toLowerCase()) ||
          (au.id && u.id && String(u.id) === String(au.id))
        );
        if (!exists) store.authorizedUsers.push(au);
      });
      store.authorizedUsers = sanitizeUsers(store.authorizedUsers);
    }

    await saveCloudStorage(store);

    res.json({ success: true, leads: store.leads, deletedIds: store.deletedIds, authorizedUsers: store.authorizedUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/lead - manual lead creation by dispatcher
app.post('/api/crm/lead', async (req, res) => {
  try {
    const store = await getCloudStorage();
    const maxNum = store.leads.reduce((max, l) => {
      const num = parseInt(l.leadNumber, 10);
      return !isNaN(num) && num > max ? num : max;
    }, 100);
    const newNum = String(maxNum + 1);

    const newLead = {
      id: 'lead-' + Date.now(),
      leadNumber: newNum,
      type: req.body.type || 'cargo',
      category: req.body.category || (req.body.type === 'contact' ? 'Заявка на обратную связь' : 'Заявка на перевозку груза'),
      status: req.body.status || 'new',
      createdAt: new Date().toISOString(),
      name: req.body.name || 'Без имени',
      contact: req.body.contact || 'Не указан',
      email: req.body.email || '',
      fromCity: req.body.fromCity || '',
      toCity: req.body.toCity || '',
      route: req.body.route || (req.body.fromCity && req.body.toCity ? `${req.body.fromCity} → ${req.body.toCity}` : 'По согласованию'),
      distance: req.body.distance || '',
      vehicle: req.body.vehicle || '',
      weight: req.body.weight || '',
      volume: req.body.volume || '',
      price: req.body.price || '',
      comment: req.body.comment || '',
      assignedTo: req.body.assignedTo || null,
      priority: req.body.priority || 'normal',
      notes: [
        {
          id: 'n-' + Date.now(),
          author: req.body.creatorName || 'Диспетчер',
          text: 'Заявка создана вручную в CRM',
          time: new Date().toISOString()
        }
      ],
      source: 'crm_manual'
    };

    store.leads.unshift(newLead);
    await saveCloudStorage(store);

    res.json({ success: true, lead: newLead });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create lead: ' + err.message });
  }
});

// DELETE /api/crm/lead/:id - delete lead permanently
app.delete('/api/crm/lead/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const store = await getCloudStorage();
    if (!store.deletedIds.includes(id)) {
      store.deletedIds.push(id);
    }
    store.leads = store.leads.filter(l => l.id !== id);
    await saveCloudStorage(store);

    res.json({ success: true, message: 'Заявка удалена навсегда' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete lead: ' + err.message });
  }
});

// PATCH /api/crm/lead/:id - update lead status, assigned dispatcher, priority or details
app.patch('/api/crm/lead/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const leads = await readJsonFile(LEADS_FILE, []);
    const index = leads.findIndex(l => l.id === id);
    if (index === -1) return res.status(404).json({ error: 'Lead not found' });

    const currentLead = leads[index];
    const previousStatus = currentLead.status;
    const previousAssigned = currentLead.assignedTo;

    const updatedLead = {
      ...currentLead,
      ...req.body,
      id: currentLead.id,
      leadNumber: currentLead.leadNumber
    };

    // Auto-append audit note if status changed
    if (req.body.status && req.body.status !== previousStatus) {
      const statusNames = {
        new: 'Новая заявка',
        processing: 'В работе / Звонок',
        calculation: 'Поиск авто / Расчёт',
        in_transit: 'В рейсе / Исполнение',
        completed: 'Завершено / Оплачено',
        cancelled: 'Отказ / Архив'
      };
      updatedLead.notes = updatedLead.notes || [];
      updatedLead.notes.unshift({
        id: 'n-' + Date.now(),
        author: req.body.editorName || 'Диспетчер',
        text: `Статус изменён: «${statusNames[req.body.status] || req.body.status}»`,
        time: new Date().toISOString()
      });
    }

    // Auto-append audit note if employee assigned
    if (req.body.assignedTo !== undefined && req.body.assignedTo !== previousAssigned) {
      const employees = await readJsonFile(EMPLOYEES_FILE, []);
      const emp = employees.find(e => e.id === req.body.assignedTo);
      const empName = emp ? emp.name : 'Не назначен';
      updatedLead.notes = updatedLead.notes || [];
      updatedLead.notes.unshift({
        id: 'n-' + Date.now(),
        author: req.body.editorName || 'Диспетчер',
        text: `Ответственный сотрудник назначен: ${empName}`,
        time: new Date().toISOString()
      });
    }

    leads[index] = updatedLead;
    await writeJsonFile(LEADS_FILE, leads);
    res.json({ success: true, lead: updatedLead });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update lead: ' + err.message });
  }
});

// POST /api/crm/lead/:id/note - add a dispatcher note/comment
app.post('/api/crm/lead/:id/note', async (req, res) => {
  try {
    const { id } = req.params;
    const { text, author } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Note text is required' });

    const leads = await readJsonFile(LEADS_FILE, []);
    const index = leads.findIndex(l => l.id === id);
    if (index === -1) return res.status(404).json({ error: 'Lead not found' });

    const newNote = {
      id: 'n-' + Date.now(),
      author: author || 'Диспетчер',
      text: text.trim(),
      time: new Date().toISOString()
    };

    leads[index].notes = leads[index].notes || [];
    leads[index].notes.unshift(newNote);
    await writeJsonFile(LEADS_FILE, leads);

    res.json({ success: true, note: newNote, lead: leads[index] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add note: ' + err.message });
  }
});

// DELETE /api/crm/lead/:id - delete lead permanently
app.delete('/api/crm/lead/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let leads = await readJsonFile(LEADS_FILE, []);
    leads = leads.filter(l => l.id !== id);
    await writeJsonFile(LEADS_FILE, leads);

    try {
      await fetch(CRM_STORAGE_BIN, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads })
      });
    } catch (e) {}

    res.json({ success: true, message: 'Заявка удалена навсегда' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete lead: ' + err.message });
  }
});

// GET /api/crm/employees - get employee list
app.get('/api/crm/employees', async (req, res) => {
  try {
    const employees = await readJsonFile(EMPLOYEES_FILE, []);
    res.json({ success: true, employees });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/employee - add new employee (dispatcher, driver, logistics manager)
app.post('/api/crm/employee', async (req, res) => {
  try {
    const { name, role, phone, telegram, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Имя сотрудника обязательно' });

    const employees = await readJsonFile(EMPLOYEES_FILE, []);
    const colors = ['#1d4ed8', '#0d9488', '#d97706', '#b91c1c', '#7c3aed', '#059669', '#64748b'];
    const chosenColor = color || colors[employees.length % colors.length];

    const newEmp = {
      id: 'emp-' + Date.now(),
      name: name.trim(),
      role: role ? role.trim() : 'Диспетчер',
      phone: phone ? phone.trim() : '',
      telegram: telegram ? telegram.trim() : '',
      color: chosenColor,
      active: true,
      createdAt: new Date().toISOString()
    };

    employees.push(newEmp);
    await writeJsonFile(EMPLOYEES_FILE, employees);
    res.json({ success: true, employee: newEmp });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add employee: ' + err.message });
  }
});

// DELETE /api/crm/employee/:id - delete employee
app.delete('/api/crm/employee/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let employees = await readJsonFile(EMPLOYEES_FILE, []);
    employees = employees.filter(e => e.id !== id);
    await writeJsonFile(EMPLOYEES_FILE, employees);
    res.json({ success: true, message: 'Сотрудник удален' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete employee: ' + err.message });
  }
});

// ==================== TELEGRAM BOT COMMAND PROCESSOR & WEBHOOK ====================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8808722578:AAEiNdtl3ut-oYBIrCFOFZYPy1vnYVd9VMY';
const CRM_WEBAPP_URL = 'https://asma-lines-site.firws.workers.dev/crm.html';

async function sendTelegramMessage(chatId, textHtml, extra = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: textHtml,
        parse_mode: 'HTML',
        ...extra
      })
    });
    return await res.json();
  } catch (err) {
    console.error('sendTelegramMessage error:', err.message);
    return null;
  }
}

async function handleTelegramBotMessage(message) {
  if (!message || !message.text) return;

  try {
    const chatId = message.chat.id;
    const from = message.from || message.chat || {};
    const rawText = (message.text || '').trim();
    const text = rawText.replace(/@\w+bot/i, '').trim();
    const senderUsername = (from.username || '').replace(/^@/, '');
    const senderId = String(from.id || '');
    const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || senderUsername || 'Диспетчер';

    console.log(`Telegram Bot Command received from @${senderUsername || senderId}: "${text}"`);

    // Load current authorized users
    let storeData = { authorizedUsers: [], leads: [], deletedIds: [] };
    let localUsers = await readJsonFile(ACCESS_USERS_FILE, []);
    try {
      const storeRes = await fetch(CRM_STORAGE_BIN + '?_t=' + Date.now(), { cache: 'no-store' });
      if (storeRes.ok) storeData = await storeRes.json();
    } catch (e) {
      console.warn('CRM storage bin fetch warning:', e.message);
    }

    if (Array.isArray(storeData.authorizedUsers) && storeData.authorizedUsers.length > 0) {
      localUsers = storeData.authorizedUsers;
    }
    localUsers = sanitizeUsers(localUsers);
    storeData.authorizedUsers = localUsers;

    const isAdmin = checkUserAdmin(from) || localUsers.some(u => {
      const uName = (u.username || '').toLowerCase().replace(/^@/, '');
      const uId = String(u.id || '');
      return ((uName && uName === senderUsername.toLowerCase()) || (uId && uId === senderId)) && u.isAdmin;
    });

    const isAuthorized = isAdmin || localUsers.some(u => {
      const uName = (u.username || '').toLowerCase().replace(/^@/, '');
      const uId = String(u.id || '');
      return (uName && uName === senderUsername.toLowerCase()) || (uId && uId === senderId);
    });

    // 1. /start, /crm, /app, /help, 'диспетчерская'
    if (text.startsWith('/start') || text.startsWith('/crm') || text.startsWith('/app') || text.startsWith('/help') || text.toLowerCase() === 'диспетчерская') {
      if (!isAuthorized) {
        await sendTelegramMessage(
          chatId,
          `⛔ <b>Доступ ограничен</b>\n\n` +
          `Ваш профиль Telegram (@${escapeHtml(senderUsername) || 'нет юзернейма'}, ID: <code>${senderId}</code>) не найден в списке диспетчеров ASMA Lines.\n\n` +
          `Для получения доступа обратитесь к главному администратору: @plombit`
        );
        return;
      }

      let reply = `🚛 <b>Диспетчерская ASMA Lines</b>\n\n` +
        `Здравствуйте, <b>${escapeHtml(senderName)}</b>!\n` +
        `Система управления заявками и рейсами готова к работе.\n\n` +
        `Нажмите кнопку ниже, чтобы открыть рабочее место:`;

      if (isAdmin) {
        reply += `\n\n👑 <b>Команды управления доступом:</b>\n` +
          `• <code>/add @username Имя</code> — добавить диспетчера\n` +
          `• <code>/remove @username</code> — отозвать доступ\n` +
          `• <code>/users</code> — список сотрудников\n\n` +
          `<i>Также вы можете управлять списком доступа прямо в интерфейсе CRM.</i>`;
      }

      await sendTelegramMessage(chatId, reply, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🚀 Открыть Диспетчерскую CRM',
                web_app: { url: CRM_WEBAPP_URL }
              }
            ]
          ]
        }
      });
      return;
    }

    // 2. /users, /access, /list, /members
    if (text.startsWith('/users') || text.startsWith('/access') || text.startsWith('/list') || text.startsWith('/members')) {
      if (!isAuthorized) {
        await sendTelegramMessage(chatId, `⛔ У вас нет доступа к этой команде.`);
        return;
      }

      let listText = `👥 <b>Список доступа к CRM ASMA Lines:</b>\n───────────────────────\n`;
      localUsers.forEach((u, i) => {
        const uLabel = u.username ? `@${escapeHtml(u.username)}` : `ID: ${escapeHtml(u.id)}`;
        listText += `${i + 1}. <b>${escapeHtml(u.name || 'Сотрудник')}</b> (${uLabel})\n   Роль: ${escapeHtml(u.role || 'Диспетчер')}${u.isAdmin ? ' ⭐ (Владелец)' : ''}\n\n`;
      });
      listText += `<i>Всего пользователей: ${localUsers.length}</i>`;

      await sendTelegramMessage(chatId, listText, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🚀 Открыть CRM',
                web_app: { url: CRM_WEBAPP_URL }
              }
            ]
          ]
        }
      });
      return;
    }

    // 3. /add
    if (text.startsWith('/add')) {
      if (!isAdmin) {
        await sendTelegramMessage(chatId, `⛔ Только главный администратор (@plombit) может добавлять пользователей.`);
        return;
      }

      const parts = text.split(/\s+/).slice(1);
      if (parts.length === 0) {
        await sendTelegramMessage(
          chatId,
          `ℹ️ <b>Формат команды:</b>\n<code>/add @username Имя [Роль]</code>\nили:\n<code>/add 123456789 Имя [Роль]</code>\n\nПример:\n<code>/add @dmitry Дмитрий Логист</code>`
        );
        return;
      }

      const rawTarget = parts[0].replace(/^@/, '').trim();
      const isId = /^\d+$/.test(rawTarget);
      const username = isId ? null : rawTarget;
      const id = isId ? rawTarget : null;

      let restWords = parts.slice(1);
      let role = 'Диспетчер';
      if (restWords.length > 1) {
        const lastWord = restWords[restWords.length - 1].toLowerCase();
        if (['логист', 'диспетчер', 'старший диспетчер', 'водитель', 'менеджер', 'админ', 'администратор'].includes(lastWord)) {
          role = restWords.pop();
          role = role.charAt(0).toUpperCase() + role.slice(1);
        }
      }
      const restName = restWords.join(' ') || rawTarget;

      const exists = localUsers.some(u =>
        (username && u.username && u.username.toLowerCase() === username.toLowerCase()) ||
        (id && u.id && String(u.id) === id)
      );

      if (exists) {
        await sendTelegramMessage(chatId, `⚠️ Пользователь <b>${escapeHtml(rawTarget)}</b> уже есть в списке доступа.`);
        return;
      }

      localUsers.push({
        id,
        username,
        name: restName,
        role,
        isAdmin: false,
        addedAt: new Date().toISOString()
      });

      storeData.authorizedUsers = sanitizeUsers(localUsers);
      await saveCloudStorage(storeData);

      await sendTelegramMessage(
        chatId,
        `✅ <b>Доступ успешно предоставлен!</b>\n\n` +
        `👤 Пользователь: <b>${username ? '@' + escapeHtml(username) : 'ID ' + escapeHtml(id)}</b>\n` +
        `🏷 Имя: <b>${escapeHtml(restName)}</b>\n` +
        `💼 Роль: <b>${escapeHtml(role)}</b>\n\n` +
        `Сотрудник теперь может открыть диспетчерскую через бот @asmalinesbot.`
      );
      return;
    }

    // 4. /remove, /del
    if (text.startsWith('/remove') || text.startsWith('/del')) {
      if (!isAdmin) {
        await sendTelegramMessage(chatId, `⛔ Только главный администратор (@plombit) может удалять пользователей.`);
        return;
      }

      const parts = text.split(/\s+/).slice(1);
      if (parts.length === 0) {
        await sendTelegramMessage(chatId, `ℹ️ <b>Формат команды:</b>\n<code>/remove @username</code> или <code>/remove ID</code>`);
        return;
      }

      const cleanTarget = parts[0].replace(/^@/, '').toLowerCase().trim();
      if (cleanTarget === MASTER_ADMIN_USERNAME || cleanTarget === MASTER_ADMIN_ID) {
        await sendTelegramMessage(chatId, `⚠️ Нельзя отозвать доступ у главного администратора.`);
        return;
      }

      const beforeLen = localUsers.length;
      localUsers = localUsers.filter(u => {
        const uName = (u.username || '').toLowerCase().replace(/^@/, '');
        const uId = String(u.id || '');
        return uName !== cleanTarget && uId !== cleanTarget;
      });

      if (localUsers.length === beforeLen) {
        await sendTelegramMessage(chatId, `❓ Пользователь <b>${escapeHtml(parts[0])}</b> не найден в списке доступа.`);
        return;
      }

      storeData.authorizedUsers = sanitizeUsers(localUsers);
      await saveCloudStorage(storeData);

      await sendTelegramMessage(chatId, `🗑 Доступ для <b>${escapeHtml(parts[0])}</b> успешно отозван.`);
      return;
    }
  } catch (err) {
    console.error('handleTelegramBotMessage error:', err);
  }
}

// POST /api/telegram-webhook
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const update = req.body || {};
    const message = update.message || update.channel_post || update.edited_message;
    if (message) {
      await handleTelegramBotMessage(message);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).json({ ok: false, error: err.message });
  }
});

// Background Telegram Polling Loop
async function startTelegramPolling() {
  if (!BOT_TOKEN) return;

  console.log('Starting Telegram Bot Polling service for @asmalinesbot...');
  // Clear any stale webhook to allow direct getUpdates
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=false`);
  } catch (e) {
    console.warn('deleteWebhook warning:', e.message);
  }

  let offset = 0;
  while (true) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=20`, {
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message || update.channel_post || update.edited_message;
          if (msg) {
            try {
              await handleTelegramBotMessage(msg);
            } catch (msgErr) {
              console.error('Error processing single update:', msgErr);
            }
          }
        }
      } else if (!data.ok) {
        await new Promise(r => setTimeout(r, 4000));
      }
    } catch (err) {
      console.error('getUpdates fetch error:', err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// Start polling in background
startTelegramPolling().catch(err => console.error('Telegram polling error:', err));

// Serve all static files from root directory, supporting clean URLs with .html extension
app.use(express.static(__dirname, {
  extensions: ['html'],
  index: 'index.html'
}));

// Route fallback for client navigation (exclude missing asset files with extensions)
app.get('*', (req, res) => {
  if (req.path.includes('.')) {
    return res.status(404).send('Not Found');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ASMA Lines server running on http://0.0.0.0:${PORT}`);
});
