import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  if (botToken && chatId) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: textHtml,
          parse_mode: 'HTML'
        })
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

  res.json({ success: true, message: 'Заявка успешно принята' });
});

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
