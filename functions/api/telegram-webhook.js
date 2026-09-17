// Cloudflare Pages Function: /api/telegram-webhook
const CLOUD_STORE_URL = 'https://json.extendsclass.com/bin/becdbda';
const TELEGRAM_BOT_TOKEN = '8808722578:AAEiNdtl3ut-oYBIrCFOFZYPy1vnYVd9VMY';
const MASTER_ADMIN_USERNAME = 'plombit';
const MASTER_ADMIN_ID = '1014012851';

const DEFAULT_AUTHORIZED_USERS = [
  {
    id: '1014012851',
    username: 'plombit',
    name: 'Иван Ефимович',
    role: 'Главный администратор',
    isAdmin: true,
    addedAt: '2026-09-17T10:00:00.000Z'
  }
];

function sanitizeUsers(users) {
  if (!Array.isArray(users)) users = [];
  const list = [...users];
  const hasMaster = list.some(u => 
    (u.username && u.username.toLowerCase() === MASTER_ADMIN_USERNAME) ||
    (u.id && String(u.id) === MASTER_ADMIN_ID)
  );
  if (!hasMaster) {
    list.unshift({ ...DEFAULT_AUTHORIZED_USERS[0] });
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

function checkUserAuthorized(users, tgUser) {
  if (!tgUser) return false;
  const username = (tgUser.username || '').toLowerCase().replace(/^@/, '');
  const id = String(tgUser.id || '');
  if (username === MASTER_ADMIN_USERNAME || id === MASTER_ADMIN_ID) return true;
  return users.some(u => {
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

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (request.method === 'GET') {
    return new Response(JSON.stringify({ status: 'active', service: 'asma-lines-telegram-webhook' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const update = await request.json().catch(() => ({}));
    const message = update.message || update.channel_post || update.edited_message;
    if (!message || !message.text) {
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const chatId = message.chat.id;
    const from = message.from || message.chat || {};
    const rawText = (message.text || '').trim();
    // Normalize command (strip bot mention like /start@asmalinesbot)
    const text = rawText.replace(/@\w+bot/i, '');
    const senderUsername = (from.username || '').replace(/^@/, '');
    const senderId = String(from.id || '');
    const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || senderUsername || 'Диспетчер';

    let storeData = { authorizedUsers: [], leads: [], deletedIds: [] };
    try {
      const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
      if (storeRes.ok) storeData = await storeRes.json();
    } catch (e) {
      console.warn('Store fetch in webhook failed:', e);
    }
    storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers);

    const isAuthorized = checkUserAuthorized(storeData.authorizedUsers, from);
    const isAdmin = checkUserAdmin(from) || storeData.authorizedUsers.some(u => {
      const uName = (u.username || '').toLowerCase().replace(/^@/, '');
      const uId = String(u.id || '');
      return ((uName && uName === senderUsername.toLowerCase()) || (uId && uId === senderId)) && u.isAdmin;
    });

    const sendTg = async (msgText, extra = {}) => {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: msgText,
          parse_mode: 'HTML',
          ...extra
        })
      });
    };

    const crmAppUrl = 'https://asma-lines-site.efimovich-w.workers.dev/crm.html';

    // 1. /start, /crm, /app, /help
    if (text.startsWith('/start') || text.startsWith('/crm') || text.startsWith('/app') || text.startsWith('/help') || text.toLowerCase() === 'диспетчерская') {
      if (!isAuthorized) {
        await sendTg(
          `⛔ <b>Доступ ограничен</b>\n\n` +
          `Ваш профиль Telegram (@${senderUsername || 'нет юзернейма'}, ID: <code>${senderId}</code>) не найден в списке авторизованных сотрудников ASMA Lines.\n\n` +
          `Для получения доступа обратитесь к главному администратору: @plombit`
        );
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      let reply = `🚛 <b>Диспетчерская ASMA Lines</b>\n\n` +
        `Здравствуйте, <b>${escapeHtml(senderName)}</b>!\n` +
        `Рабочее место диспетчера готово.\n\n` +
        `Нажмите кнопку ниже для запуска CRM:`;

      if (isAdmin) {
        reply += `\n\n👑 <b>Команды администратора:</b>\n` +
          `• <code>/add @username Имя</code> — добавить диспетчера\n` +
          `• <code>/remove @username</code> — отозвать доступ\n` +
          `• <code>/users</code> — список пользователей\n\n` +
          `<i>Вы также можете управлять доступом прямо в интерфейсе CRM.</i>`;
      }

      await sendTg(reply, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🚀 Открыть Диспетчерскую CRM',
                web_app: { url: crmAppUrl }
              }
            ]
          ]
        }
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 2. /users, /access, /list
    if (text.startsWith('/users') || text.startsWith('/access') || text.startsWith('/list')) {
      if (!isAuthorized) {
        await sendTg(`⛔ У вас нет доступа к этой команде.`);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      let listText = `👥 <b>Список доступа к CRM ASMA Lines:</b>\n───────────────────────\n`;
      storeData.authorizedUsers.forEach((u, i) => {
        const uLabel = u.username ? `@${u.username}` : `ID: ${u.id}`;
        listText += `${i + 1}. <b>${escapeHtml(u.name || 'Сотрудник')}</b> (${uLabel})\n   Роль: ${escapeHtml(u.role || 'Диспетчер')}${u.isAdmin ? ' ⭐ (Владелец)' : ''}\n\n`;
      });
      listText += `<i>Всего пользователей: ${storeData.authorizedUsers.length}</i>`;

      await sendTg(listText, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🚀 Открыть CRM',
                web_app: { url: crmAppUrl }
              }
            ]
          ]
        }
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 3. /add
    if (text.startsWith('/add')) {
      if (!isAdmin) {
        await sendTg(`⛔ Только главный администратор (@plombit) может добавлять пользователей.`);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      const parts = text.split(/\s+/).slice(1);
      if (parts.length === 0) {
        await sendTg(
          `ℹ️ <b>Формат команды:</b>\n<code>/add @username Имя [Роль]</code>\nили:\n<code>/add 123456789 Имя [Роль]</code>\n\nПример:\n<code>/add @dmitry Дмитрий Логист</code>`
        );
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      const rawTarget = parts[0].replace(/^@/, '').trim();
      const isId = /^\d+$/.test(rawTarget);
      const username = isId ? null : rawTarget;
      const id = isId ? rawTarget : null;

      // Rest parameters: Name and optional role
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

      const exists = storeData.authorizedUsers.some(u =>
        (username && u.username && u.username.toLowerCase() === username.toLowerCase()) ||
        (id && u.id && String(u.id) === id)
      );

      if (exists) {
        await sendTg(`⚠️ Пользователь <b>${escapeHtml(rawTarget)}</b> уже имеет доступ.`);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      storeData.authorizedUsers.push({
        id,
        username,
        name: restName,
        role,
        isAdmin: false,
        addedAt: new Date().toISOString()
      });

      storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers);

      await fetch(CLOUD_STORE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storeData)
      });

      await sendTg(
        `✅ <b>Доступ успешно предоставлен!</b>\n\n` +
        `👤 Пользователь: <b>${username ? '@' + escapeHtml(username) : 'ID ' + escapeHtml(id)}</b>\n` +
        `🏷 Имя: <b>${escapeHtml(restName)}</b>\n` +
        `💼 Роль: <b>${escapeHtml(role)}</b>\n\n` +
        `Сотрудник теперь может открыть диспетчерскую по кнопке или командой /start.`
      );
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 4. /remove, /del
    if (text.startsWith('/remove') || text.startsWith('/del')) {
      if (!isAdmin) {
        await sendTg(`⛔ Только главный администратор (@plombit) может удалять пользователей.`);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      const parts = text.split(/\s+/).slice(1);
      if (parts.length === 0) {
        await sendTg(`ℹ️ <b>Формат команды:</b>\n<code>/remove @username</code> или <code>/remove ID</code>`);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      const cleanTarget = parts[0].replace(/^@/, '').toLowerCase().trim();
      if (cleanTarget === MASTER_ADMIN_USERNAME || cleanTarget === MASTER_ADMIN_ID) {
        await sendTg(`⚠️ Нельзя отозвать доступ у главного администратора.`);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      const beforeLen = storeData.authorizedUsers.length;
      storeData.authorizedUsers = storeData.authorizedUsers.filter(u => {
        const uName = (u.username || '').toLowerCase().replace(/^@/, '');
        const uId = String(u.id || '');
        return uName !== cleanTarget && uId !== cleanTarget;
      });

      if (storeData.authorizedUsers.length === beforeLen) {
        await sendTg(`❓ Пользователь <b>${escapeHtml(parts[0])}</b> не найден в списке доступа.`);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers);

      await fetch(CLOUD_STORE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storeData)
      });

      await sendTg(`🗑 Доступ для <b>${escapeHtml(parts[0])}</b> успешно отозван.`);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
