export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { name, phone, email, contact, fromCity, toCity, distance, vehicle, weight, volume, price, comment, message, route_details, source } = body;

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
      source: source || 'Форма сайта (Cloudflare)'
    };

    const isPartner = source === 'website_partners' || Boolean(body.company);
    const isCargoOrder = !isPartner && Boolean(
      (fromCity && toCity) ||
      (route_details && route_details.length > 3) ||
      source === 'calculator_modal' ||
      source === 'website_calculator' ||
      (distance && vehicle) ||
      price
    );

    const routeStr = (fromCity && toCity) ? `${fromCity} → ${toCity}` : (route_details || '');
    const nowStr = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' });
    const escapeHtml = (str) => str ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

    let textHtml = '';
    let emailSubject = '';

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

    } else if (isPartner) {
      // 2. ЗАЯВКА НА СОТРУДНИЧЕСТВО (ПАРТНЕРЫ)
      textHtml = `🤝 <b>ЗАЯВКА НА СОТРУДНИЧЕСТВО (ПАРТНЁРЫ)</b>\n`;
      textHtml += `───────────────────────\n`;
      if (body.company) textHtml += `🏢 <b>Компания:</b> ${escapeHtml(body.company)}\n`;
      textHtml += `👤 <b>Контактное лицо:</b> ${escapeHtml(body.contact_name || leadData.name)}\n`;
      textHtml += `📞 <b>Контакты:</b> ${escapeHtml(leadData.contact)}\n`;
      if (body.direction) textHtml += `🚛 <b>Направление / Автопарк:</b> ${escapeHtml(body.direction)}\n`;
      if (leadData.comment && leadData.comment !== '—') {
        textHtml += `\n💬 <b>Сообщение:</b>\n${escapeHtml(leadData.comment)}\n`;
      }
      textHtml += `───────────────────────\n`;
      textHtml += `⏱ <b>Время:</b> ${nowStr} (Минск)\n`;
      textHtml += `🌐 <b>Источник:</b> Раздел «Партнёрам» (Сайт ASMA Lines)`;
      emailSubject = `🤝 СОТРУДНИЧЕСТВО: ${body.company || leadData.name} (${leadData.contact})`;

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
    }

    // 1. Send to Telegram
    const botToken = context.env.TELEGRAM_BOT_TOKEN || '8808722578:AAEiNdtl3ut-oYBIrCFOFZYPy1vnYVd9VMY';
    const chatId = context.env.TELEGRAM_CHAT_ID || '-5230752915';

    if (botToken && chatId) {
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: textHtml,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '📋 Открыть заявку в CRM',
                    url: 'https://asma-lines-site.efimovich-w.workers.dev/crm.html'
                  }
                ]
              ]
            }
          })
        });
      } catch (tgErr) {
        console.warn('Telegram notification failed:', tgErr.message);
      }
    }

    // 2. Persist lead into CRM Cloud Store (accessible by Telegram Web App)
    try {
      const storeRes = await fetch('https://json.extendsclass.com/bin/becdbda?_t=' + Date.now(), { cache: 'no-store' });
      let storeData = { leads: [], deletedIds: [] };
      if (storeRes.ok) {
        storeData = await storeRes.json();
      }
      if (!Array.isArray(storeData.leads)) storeData.leads = [];
      if (!Array.isArray(storeData.deletedIds)) storeData.deletedIds = [];

      const delSet = new Set(storeData.deletedIds);
      storeData.leads = storeData.leads.filter(l => !delSet.has(l.id));

      const maxNum = storeData.leads.reduce((max, l) => {
        const num = parseInt(l.leadNumber, 10);
        return !isNaN(num) && num > max ? num : max;
      }, 100);

      const newLeadObj = {
        id: 'lead-' + Date.now(),
        leadNumber: String(maxNum + 1),
        type: isPartner ? 'partner' : (isCargoOrder ? 'cargo' : 'contact'),
        category: isPartner ? 'Сотрудничество' : (isCargoOrder ? 'Перевозка груза' : 'Обратная связь'),
        status: 'new',
        createdAt: new Date().toISOString(),
        name: leadData.name,
        contact: leadData.contact,
        email: leadData.email,
        route: routeStr || 'Маршрут по запросу',
        distance: leadData.distance || '',
        vehicle: leadData.vehicle || '',
        weight: leadData.weight || '',
        volume: leadData.volume || '',
        price: leadData.price || '',
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

      storeData.leads.unshift(newLeadObj);

      await fetch('https://json.extendsclass.com/bin/becdbda', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storeData)
      });
    } catch (dbErr) {
      console.warn('CRM cloud store sync error:', dbErr.message);
    }

    // 2. Send to PlanFix Webhook if PLANFIX_WEBHOOK_URL is configured
    const planfixUrl = context.env.PLANFIX_WEBHOOK_URL || context.env.PLANFIX_FORM_URL;
    if (planfixUrl) {
      await fetch(planfixUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadData)
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Заявка успешно принята' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
