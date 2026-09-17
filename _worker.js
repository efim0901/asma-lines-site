/**
 * Cloudflare Worker entry point for ASMA Lines
 * Handles /api/lead, /api/crm, and static assets via env.ASSETS
 */

const CLOUD_STORE_URL = 'https://json.extendsclass.com/bin/becdbda';
const TELEGRAM_BOT_TOKEN = '8808722578:AAEiNdtl3ut-oYBIrCFOFZYPy1vnYVd9VMY';
const TELEGRAM_CHAT_ID = '-5230752915';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Common CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, *',
    };

    // Preflight OPTIONS handler
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Helper for JSON responses
    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          ...corsHeaders,
        },
      });
    };

    // ----------------------------------------------------
    // ROUTE: /api/crm (GET / POST)
    // ----------------------------------------------------
    if (url.pathname === '/api/crm' || url.pathname === '/api/crm/data') {
      try {
        if (request.method === 'GET') {
          let leads = [];
          let deletedIds = [];

          try {
            const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
            if (storeRes.ok) {
              const storeData = await storeRes.json();
              if (Array.isArray(storeData.deletedIds)) deletedIds = storeData.deletedIds;
              if (Array.isArray(storeData.leads)) {
                const delSet = new Set(deletedIds);
                leads = storeData.leads.filter(l => !delSet.has(l.id));
              }
            }
          } catch (e) {
            console.error('Worker CRM fetch error:', e);
          }

          return jsonResponse({
            success: true,
            leads,
            deletedIds,
            user: { name: 'Иван', username: 'plombit', role: 'Диспетчер' }
          });
        }

        if (request.method === 'POST' || request.method === 'PUT') {
          const body = await request.json().catch(() => ({}));
          const action = body.action || 'sync';

          let storeData = { leads: [], deletedIds: [] };
          try {
            const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
            if (storeRes.ok) {
              storeData = await storeRes.json();
            }
          } catch (e) {}

          if (!Array.isArray(storeData.leads)) storeData.leads = [];
          if (!Array.isArray(storeData.deletedIds)) storeData.deletedIds = [];

          let delSet = new Set(storeData.deletedIds);

          if (Array.isArray(body.deletedIds)) {
            body.deletedIds.forEach(id => delSet.add(id));
          }

          if (action === 'delete' && body.leadId) {
            delSet.add(body.leadId);
            storeData.leads = storeData.leads.filter(l => l.id !== body.leadId);
          } else if (action === 'update_status' && body.leadId && body.status) {
            const l = storeData.leads.find(x => x.id === body.leadId);
            if (l) {
              l.status = body.status;
              if (!l.notes) l.notes = [];
              l.notes.unshift({
                id: 'n-' + Date.now(),
                author: 'Иван',
                text: `Статус изменён на: ${body.status}`,
                time: new Date().toISOString()
              });
            }
          } else if (action === 'add_note' && body.leadId && body.note) {
            const l = storeData.leads.find(x => x.id === body.leadId);
            if (l) {
              if (!l.notes) l.notes = [];
              l.notes.unshift({
                id: 'n-' + Date.now(),
                author: 'Иван',
                text: body.note,
                time: new Date().toISOString()
              });
            }
          } else if (Array.isArray(body.leads)) {
            // Replace leads while preserving undeleted
            storeData.leads = body.leads;
          }

          // Filter out any deleted leads permanently
          storeData.deletedIds = Array.from(delSet);
          storeData.leads = storeData.leads.filter(l => !delSet.has(l.id));

          // Save to cloud storage
          try {
            await fetch(CLOUD_STORE_URL, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(storeData)
            });
          } catch (err) {
            console.error('Worker CRM PUT error:', err);
          }

          return jsonResponse({
            success: true,
            leads: storeData.leads,
            deletedIds: storeData.deletedIds
          });
        }
      } catch (err) {
        return jsonResponse({ error: 'Worker CRM operation failed: ' + err.message }, 500);
      }
    }

    // ----------------------------------------------------
    // ROUTE: /api/lead (POST - Lead submission from site)
    // ----------------------------------------------------
    if (url.pathname === '/api/lead' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const {
          name, phone, contact, email, fromCity, toCity,
          distance, vehicle, weight, volume, price,
          comment, message, route_details, source, company
        } = body;

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

        const isPartner = source === 'website_partners' || Boolean(company);
        const isCargoOrder = !isPartner && Boolean(
          (fromCity && toCity) ||
          (route_details && route_details.length > 3) ||
          source === 'calculator_modal' ||
          source === 'website_calculator' ||
          (distance && vehicle) ||
          price
        );

        const routeStr = (fromCity && toCity) ? `${fromCity} → ${toCity}` : (route_details || 'Маршрут по запросу');

        const leadData = {
          name: name || body.contact_name || 'Не указано',
          contact: phone || contact || 'Не указан',
          email: email || '',
          route: routeStr,
          distance: parsedDist ? (String(parsedDist).includes('км') ? parsedDist : `${parsedDist} км`) : '',
          vehicle: vehicle || '',
          weight: parsedWeight ? (String(parsedWeight).includes('т') ? parsedWeight : `${parsedWeight} т`) : '',
          volume: volume ? (String(volume).includes('м³') ? volume : `${volume} м³`) : '',
          price: parsedPrice ? (String(parsedPrice).includes('BYN') ? parsedPrice : `${parsedPrice} BYN`) : '',
          comment: comment || message || '—',
          source: source || 'Форма сайта'
        };

        const escapeHtml = (str) => str ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
        const nowStr = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' });

        // 1. Build Telegram Message
        let textHtml = '';
        if (isCargoOrder) {
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
        } else if (isPartner) {
          textHtml = `🤝 <b>ЗАЯВКА НА СОТРУДНИЧЕСТВО (ПАРТНЁРЫ)</b>\n`;
          textHtml += `───────────────────────\n`;
          if (company) textHtml += `🏢 <b>Компания:</b> ${escapeHtml(company)}\n`;
          textHtml += `👤 <b>Контактное лицо:</b> ${escapeHtml(leadData.name)}\n`;
          textHtml += `📞 <b>Контакты:</b> ${escapeHtml(leadData.contact)}\n`;
          if (body.direction) textHtml += `🚛 <b>Направление:</b> ${escapeHtml(body.direction)}\n`;
          if (leadData.comment && leadData.comment !== '—') {
            textHtml += `\n💬 <b>Сообщение:</b>\n${escapeHtml(leadData.comment)}\n`;
          }
          textHtml += `───────────────────────\n`;
          textHtml += `⏱ <b>Время:</b> ${nowStr} (Минск)\n`;
          textHtml += `🌐 <b>Источник:</b> Раздел «Партнёрам»`;
        } else {
          textHtml = `📩 <b>ЗАЯВКА НА ОБРАТНУЮ СВЯЗЬ</b>\n`;
          textHtml += `───────────────────────\n`;
          textHtml += `👤 <b>Имя / Клиент:</b> ${escapeHtml(leadData.name)}\n`;
          textHtml += `📞 <b>Контакты:</b> ${escapeHtml(leadData.contact)}\n`;
          if (leadData.email) textHtml += `📧 <b>Email:</b> ${escapeHtml(leadData.email)}\n`;
          textHtml += `\n💬 <b>Текст обращения:</b>\n${escapeHtml(leadData.comment && leadData.comment !== '—' ? leadData.comment : 'Заказ обратного звонка')}\n`;
          textHtml += `───────────────────────\n`;
          textHtml += `⏱ <b>Время:</b> ${nowStr} (Минск)\n`;
          textHtml += `🌐 <b>Источник:</b> Форма контактов`;
        }

        // Send Telegram notification
        fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: textHtml,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '📋 Открыть заявку в CRM',
                    url: `${url.origin}/crm.html`
                  }
                ]
              ]
            }
          })
        }).catch(err => console.error('Worker Telegram send error:', err));

        // 2. Persist to Cloud CRM Store
        let storeData = { leads: [], deletedIds: [] };
        try {
          const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
          if (storeRes.ok) {
            storeData = await storeRes.json();
          }
        } catch (e) {}

        if (!Array.isArray(storeData.leads)) storeData.leads = [];
        if (!Array.isArray(storeData.deletedIds)) storeData.deletedIds = [];

        const delSet = new Set(storeData.deletedIds);
        storeData.leads = storeData.leads.filter(l => !delSet.has(l.id));

        const maxNum = storeData.leads.reduce((max, l) => {
          const num = parseInt(l.leadNumber, 10);
          return !isNaN(num) && num > max ? num : max;
        }, 100);

        const newLead = {
          id: 'lead-' + Date.now(),
          leadNumber: String(maxNum + 1),
          type: isPartner ? 'partner' : (isCargoOrder ? 'cargo' : 'contact'),
          category: isPartner ? 'Сотрудничество' : (isCargoOrder ? 'Перевозка груза' : 'Обратная связь'),
          status: 'new',
          createdAt: new Date().toISOString(),
          name: leadData.name,
          contact: leadData.contact,
          email: leadData.email,
          route: routeStr,
          distance: leadData.distance,
          vehicle: leadData.vehicle,
          weight: leadData.weight,
          volume: leadData.volume,
          price: leadData.price,
          comment: leadData.comment !== '—' ? leadData.comment : '',
          dispatcher: 'Иван',
          notes: [
            {
              id: 'n-' + Date.now(),
              author: 'Система',
              text: `Заявка с сайта (${leadData.source})`,
              time: new Date().toISOString()
            }
          ],
          source: leadData.source
        };

        storeData.leads.unshift(newLead);

        try {
          await fetch(CLOUD_STORE_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(storeData)
          });
        } catch (err) {
          console.error('Worker CRM save error:', err);
        }

        return jsonResponse({
          success: true,
          message: 'Заявка успешно принята',
          leadId: newLead.id,
          leadNumber: newLead.leadNumber
        });

      } catch (err) {
        return jsonResponse({ error: 'Worker Lead submission error: ' + err.message }, 500);
      }
    }

    // ----------------------------------------------------
    // STATIC ASSETS FALLBACK
    // ----------------------------------------------------
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
