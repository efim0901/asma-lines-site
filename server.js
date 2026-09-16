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
  const leadData = {
    name: name || 'Не указано',
    contact: phone || contact || 'Не указан',
    email: email || '',
    route: (fromCity && toCity) ? `${fromCity} → ${toCity}` : (route_details || 'Маршрут по запросу'),
    distance: distance ? `${distance} км` : '',
    vehicle: vehicle || '',
    weight: weight ? `${weight} т` : '',
    volume: volume ? `${volume} м³` : '',
    price: price ? `${price} BYN` : '',
    comment: comment || message || '—',
    source: source || 'Форма сайта'
  };

  console.log('Lead submission received:', leadData);

  // Send Telegram notification if BOT_TOKEN and CHAT_ID are set
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    try {
      const text = `🚛 *Новая заявка с сайта ASMA Lines*\n\n` +
        `👤 *Клиент:* ${leadData.name}\n` +
        `📞 *Контакты:* ${leadData.contact}\n` +
        (leadData.email ? `📧 *Email:* ${leadData.email}\n` : '') +
        `📍 *Маршрут:* ${leadData.route}\n` +
        (leadData.distance ? `📏 *Расстояние:* ${leadData.distance}\n` : '') +
        (leadData.vehicle ? `🚚 *Транспорт:* ${leadData.vehicle}\n` : '') +
        (leadData.weight ? `📦 *Вес:* ${leadData.weight}\n` : '') +
        (leadData.volume ? `📦 *Объём:* ${leadData.volume}\n` : '') +
        (leadData.price ? `💰 *Расчёт:* ${leadData.price}\n` : '') +
        `💬 *Комментарий:* ${leadData.comment}\n` +
        `🌐 *Источник:* ${leadData.source}`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'Markdown'
        })
      });
    } catch (err) {
      console.error('Telegram notification error:', err.message);
    }
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

  // Send PlanFix Task Email (Plomba@asma.planfix.com) if SMTP credentials configured
  const planfixEmail = process.env.PLANFIX_EMAIL || 'Plomba@asma.planfix.com';
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass }
      });

      const emailSubject = `Новая заявка: ${leadData.name} (${leadData.route})`;
      const emailBody = `Новая заявка с сайта ASMA Lines:\n\n` +
        `Имя: ${leadData.name}\n` +
        `Телефон/Контакты: ${leadData.contact}\n` +
        `Email: ${leadData.email || 'Не указан'}\n` +
        `Маршрут: ${leadData.route}\n` +
        `Расстояние: ${leadData.distance}\n` +
        `Транспорт: ${leadData.vehicle}\n` +
        `Вес: ${leadData.weight}\n` +
        `Объём: ${leadData.volume}\n` +
        `Расчёт: ${leadData.price}\n` +
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
      console.error('PlanFix email dispatch error:', err.message);
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
