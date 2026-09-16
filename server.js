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

  if (botToken && chatId) {
    try {
      const text = `🚛 <b>Новая заявка с сайта ASMA Lines</b>\n\n` +
        `👤 <b>Клиент:</b> ${escapeHtml(leadData.name)}\n` +
        `📞 <b>Контакты:</b> ${escapeHtml(leadData.contact)}\n` +
        (leadData.email ? `📧 <b>Email:</b> ${escapeHtml(leadData.email)}\n` : '') +
        `📍 <b>Маршрут:</b> ${escapeHtml(leadData.route)}\n` +
        (leadData.distance ? `📏 <b>Расстояние:</b> ${escapeHtml(leadData.distance)}\n` : '') +
        (leadData.vehicle ? `🚚 <b>Транспорт:</b> ${escapeHtml(leadData.vehicle)}\n` : '') +
        (leadData.weight ? `📦 <b>Вес:</b> ${escapeHtml(leadData.weight)}\n` : '') +
        (leadData.volume ? `📦 <b>Объём:</b> ${escapeHtml(leadData.volume)}\n` : '') +
        (leadData.price ? `💰 <b>Расчёт:</b> ${escapeHtml(leadData.price)}\n` : '') +
        `💬 <b>Комментарий:</b> ${escapeHtml(leadData.comment)}\n` +
        `🌐 <b>Источник:</b> ${escapeHtml(leadData.source)}`;

      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
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

      const emailSubject = `Новая заявка: ${leadData.name} (${leadData.route})`;
      const emailBody = `Новая заявка с сайта ASMA Lines:\n\n` +
        `Имя: ${leadData.name}\n` +
        `Телефон/Контакты: ${leadData.contact}\n` +
        (leadData.email ? `Email: ${leadData.email}\n` : '') +
        `Маршрут: ${leadData.route}\n` +
        (leadData.distance ? `Расстояние: ${leadData.distance}\n` : '') +
        (leadData.vehicle ? `Транспорт: ${leadData.vehicle}\n` : '') +
        (leadData.weight ? `Вес: ${leadData.weight}\n` : '') +
        (leadData.volume ? `Объём: ${leadData.volume}\n` : '') +
        (leadData.price ? `Стоимость: ${leadData.price}\n` : '') +
        `Комментарий: ${leadData.comment}\n` +
        `Источник: ${leadData.source}\n`;

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
