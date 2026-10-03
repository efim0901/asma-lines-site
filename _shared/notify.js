/**
 * ASMA Lines — форматирование уведомлений о заявках для Telegram.
 * Раньше HTML-шаблон был скопирован в server.js и _worker.js и уже разошёлся.
 */

import { escapeHtml } from './core.js';

function row(label, value) {
  return value ? `${label}: <b>${escapeHtml(value)}</b>\n` : '';
}

/** Собирает HTML-сообщение для Telegram. */
export function buildLeadMessage(lead) {
  const isPartner = lead.type === 'partner';
  const header = isPartner
    ? '🤝 <b>ЗАЯВКА НА ПАРТНЁРСТВО (ASMA LINES)</b>'
    : '🚛 <b>ЗАЯВКА НА ПЕРЕВОЗКУ ГРУЗА (ASMA LINES)</b>';

  let text = `${header}\n`;
  if (lead.leadNumber) text += `№ <b>${escapeHtml(lead.leadNumber)}</b>\n`;
  text += '➖➖➖➖➖➖➖➖➖➖\n';

  text += row('👤 Контакт', lead.name);
  if (lead.company) text += row('🏢 Компания', lead.company);
  text += row('📞 Телефон', lead.contact);
  text += row('✉️ E-mail', lead.email);
  text += row('🗺 Маршрут', lead.route);
  text += row('📏 Дистанция', lead.distance);
  text += row('⚖️ Вес', lead.weight);
  text += row('📦 Объём', lead.volume);
  text += row('🚚 Транспорт', lead.vehicle);
  text += row('💰 Ставка', lead.price);
  if (lead.priceNotice) text += `⚠️ ${escapeHtml(lead.priceNotice)}\n`;
  text += row('📝 Комментарий', lead.comment);
  text += `🔗 Источник: ${escapeHtml(lead.source || 'сайт')}\n`;
  text += `🕒 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}`;

  return text;
}

/** Собирает текстовую (plain) версию — для логов и e-mail. */
export function buildLeadPlainText(lead) {
  return buildLeadMessage(lead)
    .replace(/<\/?b>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Уведомление клиенту о смене статуса (для будущих интеграций). */
export function buildStatusMessage(lead, statusName) {
  return (
    `📦 Заявка № <b>${escapeHtml(lead.leadNumber || '—')}</b>\n` +
    `Новый статус: <b>${escapeHtml(statusName)}</b>\n` +
    `Маршрут: ${escapeHtml(lead.route || '—')}`
  );
}
