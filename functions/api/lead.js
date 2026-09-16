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

    const escapeHtml = (str) => str ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

    // 1. Send to Telegram
    const botToken = context.env.TELEGRAM_BOT_TOKEN || '8808722578:AAEiNdtl3ut-oYBIrCFOFZYPy1vnYVd9VMY';
    const chatId = context.env.TELEGRAM_CHAT_ID || '-5230752915';

    if (botToken && chatId) {
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

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
      });
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
