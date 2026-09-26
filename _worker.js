/**
 * Cloudflare Worker entry point for ASMA Lines
 * Handles /api/lead, /api/crm, /api/telegram-webhook, and static assets via env.ASSETS
 */

const CLOUD_STORE_URL = 'https://json.extendsclass.com/bin/becdbda';
const DEFAULT_TELEGRAM_BOT_TOKEN = '8808722578:AAEYNIMN8P7LG8IYtUOsytw6yWO1bEBLlLI';
const DEFAULT_TELEGRAM_CHAT_ID = '-5230752915';
const DEFAULT_MASTER_ADMIN_USERNAME = 'plombit';
const DEFAULT_MASTER_ADMIN_ID = '1014012851';

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

function sanitizeUsers(users, masterUsername = DEFAULT_MASTER_ADMIN_USERNAME, masterId = DEFAULT_MASTER_ADMIN_ID) {
  if (!Array.isArray(users)) users = [];
  const list = [...users];
  const hasMaster = list.some(u => 
    (u.username && u.username.toLowerCase() === masterUsername.toLowerCase()) ||
    (u.id && String(u.id) === String(masterId))
  );
  if (!hasMaster) {
    list.unshift({ ...DEFAULT_AUTHORIZED_USERS[0], username: masterUsername, id: masterId });
  } else {
    list.forEach(u => {
      if ((u.username && u.username.toLowerCase() === masterUsername.toLowerCase()) ||
          (u.id && String(u.id) === String(masterId))) {
        u.isAdmin = true;
      }
    });
  }
  return list;
}

function checkUserAuthorized(users, tgUser, masterUsername = DEFAULT_MASTER_ADMIN_USERNAME, masterId = DEFAULT_MASTER_ADMIN_ID) {
  if (!tgUser) return false;
  const username = (tgUser.username || '').toLowerCase().replace(/^@/, '');
  const id = String(tgUser.id || '');
  if (username === masterUsername.toLowerCase() || id === String(masterId)) return true;
  return users.some(u => {
    const uName = (u.username || '').toLowerCase().replace(/^@/, '');
    const uId = String(u.id || '');
    return (uName && uName === username) || (uId && uId === id);
  });
}

function checkUserAdmin(tgUser, masterUsername = DEFAULT_MASTER_ADMIN_USERNAME, masterId = DEFAULT_MASTER_ADMIN_ID) {
  if (!tgUser) return false;
  const username = (tgUser.username || '').toLowerCase().replace(/^@/, '');
  const id = String(tgUser.id || '');
  return username === masterUsername.toLowerCase() || id === String(masterId);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Read configured secrets / environment variables with resilient defaults
    const botToken = env?.TELEGRAM_BOT_TOKEN || DEFAULT_TELEGRAM_BOT_TOKEN;
    const chatId = env?.TELEGRAM_CHAT_ID || DEFAULT_TELEGRAM_CHAT_ID;
    const masterAdminUsername = (env?.MASTER_ADMIN_USERNAME || DEFAULT_MASTER_ADMIN_USERNAME).toLowerCase().replace(/^@/, '');
    const masterAdminId = String(env?.MASTER_ADMIN_ID || DEFAULT_MASTER_ADMIN_ID);
    const crmAppUrl = env?.CRM_APP_URL || `${url.origin}/crm.html`;

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
    // ROUTE: /api/crm/access (GET / POST)
    // ----------------------------------------------------
    if (url.pathname === '/api/crm/access') {
      try {
        let storeData = { leads: [], deletedIds: [], authorizedUsers: [] };
        try {
          const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
          if (storeRes.ok) storeData = await storeRes.json();
        } catch (e) {}

        storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers, masterAdminUsername, masterAdminId);

        if (request.method === 'GET') {
          return jsonResponse({
            success: true,
            users: storeData.authorizedUsers
          });
        }

        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const { action, user, target, requestedBy } = body;

          // Only admin can modify access
          if (!checkUserAdmin(requestedBy, masterAdminUsername, masterAdminId)) {
            return jsonResponse({ error: `Доступ запрещён: только администратор (@${masterAdminUsername}) может изменять настройки доступа` }, 403);
          }

          if (action === 'add' && user) {
            const rawUser = (user.username || '').replace(/^@/, '').trim();
            const rawId = user.id ? String(user.id).trim() : '';
            const name = (user.name || rawUser || rawId || 'Диспетчер').trim();
            const role = (user.role || 'Диспетчер').trim();

            if (!rawUser && !rawId) {
              return jsonResponse({ error: 'Укажите username или Telegram ID' }, 400);
            }

            const exists = storeData.authorizedUsers.some(u => 
              (rawUser && u.username && u.username.toLowerCase() === rawUser.toLowerCase()) ||
              (rawId && u.id && String(u.id) === rawId)
            );

            if (exists) {
              return jsonResponse({ error: 'Пользователь уже есть в списке доступа' }, 400);
            }

            storeData.authorizedUsers.push({
              id: rawId || null,
              username: rawUser || null,
              name,
              role,
              isAdmin: false,
              addedAt: new Date().toISOString()
            });
          } else if (action === 'remove' && target) {
            const cleanTarget = String(target).replace(/^@/, '').toLowerCase().trim();
            if (cleanTarget === masterAdminUsername || cleanTarget === masterAdminId) {
              return jsonResponse({ error: 'Нельзя удалить главного администратора' }, 400);
            }

            storeData.authorizedUsers = storeData.authorizedUsers.filter(u => {
              const uName = (u.username || '').toLowerCase().replace(/^@/, '');
              const uId = String(u.id || '');
              return uName !== cleanTarget && uId !== cleanTarget;
            });
          }

          storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers, masterAdminUsername, masterAdminId);

          await fetch(CLOUD_STORE_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(storeData)
          });

          return jsonResponse({
            success: true,
            users: storeData.authorizedUsers
          });
        }
      } catch (err) {
        return jsonResponse({ error: 'Access management error: ' + err.message }, 500);
      }
    }

    // ----------------------------------------------------
    // ROUTE: /api/setup-webhook (GET / POST - Registers Webhook on Telegram)
    // ----------------------------------------------------
    if (url.pathname === '/api/setup-webhook') {
      if (!botToken) {
        return jsonResponse({
          ok: false,
          error: 'TELEGRAM_BOT_TOKEN не установлен в Cloudflare Secrets (Environment Variables).',
          hint: 'Установите TELEGRAM_BOT_TOKEN в настройках Cloudflare Worker (Settings -> Variables and Secrets).'
        }, 400);
      }

      const webhookUrl = `${url.origin}/api/telegram-webhook`;
      try {
        // 1. Call setWebhook
        const setRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ['message', 'edited_message', 'callback_query']
          })
        });
        const setResult = await setRes.json();

        // 2. Call getWebhookInfo
        const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
        const infoResult = await infoRes.json();

        // 3. Call getMe
        const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const meResult = await meRes.json();

        return jsonResponse({
          ok: true,
          message: setResult.ok ? 'Webhook успешно зарегистрирован!' : 'Ошибка регистрации Webhook в Telegram',
          bot: meResult?.result || {},
          targetWebhookUrl: webhookUrl,
          telegramSetResult: setResult,
          webhookInfo: infoResult?.result || {},
          instructions: 'Теперь отправьте боту в Telegram команду /start или /test для проверки.'
        });
      } catch (err) {
        return jsonResponse({
          ok: false,
          error: 'Сбой подключения к Telegram API: ' + err.message
        }, 500);
      }
    }

    // ----------------------------------------------------
    // ROUTE: /api/telegram-webhook (GET / POST - Telegram Bot Commands)
    // ----------------------------------------------------
    if (url.pathname === '/api/telegram-webhook') {
      if (request.method === 'GET') {
        return jsonResponse({
          ok: true,
          status: 'online',
          service: 'asma-lines-telegram-webhook',
          configuredBotToken: Boolean(botToken),
          configuredChatId: Boolean(chatId),
          admin: `@${masterAdminUsername}`,
          timestamp: new Date().toISOString()
        });
      }

      if (request.method === 'POST') {
        try {
          const update = await request.json().catch(() => ({}));

          // 1. Answer callback queries (inline button clicks)
          if (update.callback_query) {
            const cbId = update.callback_query.id;
            if (botToken) {
              fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: cbId })
              }).catch(() => {});
            }
          }

          const message = update.message || update.channel_post || update.edited_message;
          if (!message || !message.text) {
            return jsonResponse({ ok: true });
          }

          const msgChatId = message.chat.id;
          const from = message.from || message.chat || {};
          const rawText = (message.text || '').trim();
          // Normalize command (strip bot mention like /start@asmalinesbot)
          const text = rawText.replace(/@\w+bot/i, '').trim();
          const senderUsername = (from.username || '').replace(/^@/, '');
          const senderId = String(from.id || '');
          const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || senderUsername || 'Диспетчер';

          let storeData = { authorizedUsers: [] };
          try {
            const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
            if (storeRes.ok) storeData = await storeRes.json();
          } catch (e) {}
          storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers, masterAdminUsername, masterAdminId);

          const isAuthorized = checkUserAuthorized(storeData.authorizedUsers, from, masterAdminUsername, masterAdminId);
          const isAdmin = checkUserAdmin(from, masterAdminUsername, masterAdminId);

          const sendTg = async (msgText, extra = {}) => {
            if (!botToken) {
              console.error('TELEGRAM_BOT_TOKEN is not set in Cloudflare Secrets');
              return;
            }
            try {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: msgChatId,
                  text: msgText,
                  parse_mode: 'HTML',
                  ...extra
                })
              });
            } catch (err) {
              console.error('sendTg fetch error:', err);
            }
          };

          // Diagnostic / Test command
          if (text.startsWith('/test') || text.startsWith('/ping')) {
            await sendTg(
              `⚡ <b>Диагностика бота ASMA Lines:</b>\n` +
              `───────────────────────\n` +
              `✅ <b>Статус:</b> Бот работает в облаке Cloudflare\n` +
              `🔑 <b>Токен:</b> Настроен (${botToken ? 'присутствует' : 'ОТСУТСТВУЕТ!'})\n` +
              `👤 <b>Ваш профиль:</b> @${senderUsername || 'нет юзернейма'} (ID: <code>${senderId}</code>)\n` +
              `🛡 <b>Доступ:</b> ${isAuthorized ? 'Разрешён ✅' : 'Ограничен ⛔'}\n` +
              `👑 <b>Роль администратора:</b> ${isAdmin ? 'Да ⭐' : 'Нет'}\n` +
              `🌐 <b>Домен CRM:</b> <code>${crmAppUrl}</code>\n` +
              `⏱ <b>Время сервера:</b> ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}`
            );
            return jsonResponse({ ok: true });
          }

          // Main commands: /start, /crm, /app, /help
          if (text.startsWith('/start') || text.startsWith('/crm') || text.startsWith('/app') || text.startsWith('/help') || text.toLowerCase() === 'диспетчерская') {
            if (!isAuthorized) {
              await sendTg(
                `⛔ <b>Доступ ограничен</b>\n\n` +
                `Ваш профиль Telegram (@${senderUsername || 'нет юзернейма'}, ID: <code>${senderId}</code>) не найден в списке авторизованных диспетчеров ASMA Lines.\n\n` +
                `Для получения доступа обратитесь к главному администратору: @${masterAdminUsername}`
              );
              return jsonResponse({ ok: true });
            }

            let reply = `🚛 <b>Диспетчерская ASMA Lines</b>\n\n` +
              `Здравствуйте, <b>${escapeHtml(senderName)}</b>!\n` +
              `Система управления заявками и рейсами готова к работе.\n\n` +
              `Нажмите кнопку ниже, чтобы открыть рабочее место диспетчера:`;

            if (isAdmin) {
              reply += `\n\n👑 <b>Управление доступом через Telegram:</b>\n` +
                `• <code>/add @username Имя</code> — добавить диспетчера\n` +
                `• <code>/remove @username</code> — отозвать доступ\n` +
                `• <code>/users</code> — список пользователей с доступом\n` +
                `• <code>/test</code> — проверить статус бота\n\n` +
                `<i>Также вы можете управлять доступом прямо в интерфейсе CRM.</i>`;
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
            return jsonResponse({ ok: true });
          }

          // /users, /access, /list
          if (text.startsWith('/users') || text.startsWith('/access') || text.startsWith('/list')) {
            if (!isAuthorized) {
              await sendTg(`⛔ У вас нет доступа к этой команде.`);
              return jsonResponse({ ok: true });
            }

            let listText = `👥 <b>Список доступа к диспетчерской ASMA Lines:</b>\n───────────────────────\n`;
            storeData.authorizedUsers.forEach((u, i) => {
              const uLabel = u.username ? `@${u.username}` : `ID: ${u.id}`;
              listText += `${i + 1}. <b>${escapeHtml(u.name || 'Сотрудник')}</b> (${uLabel})\n   Роль: ${escapeHtml(u.role || 'Диспетчер')}${u.isAdmin ? ' ⭐ (Владелец)' : ''}\n\n`;
            });
            listText += `<i>Всего диспетчеров: ${storeData.authorizedUsers.length}</i>`;

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
            return jsonResponse({ ok: true });
          }

          // /add
          if (text.startsWith('/add')) {
            if (!isAdmin) {
              await sendTg(`⛔ Только главный администратор (@${masterAdminUsername}) может добавлять пользователей в список доступа.`);
              return jsonResponse({ ok: true });
            }

            const parts = text.split(/\s+/).slice(1);
            if (parts.length === 0) {
              await sendTg(
                `ℹ️ <b>Формат команды:</b>\n<code>/add @username Имя [Роль]</code>\nили:\n<code>/add 123456789 Имя [Роль]</code>\n\nПример:\n<code>/add @dmitry Дмитрий Логист</code>`
              );
              return jsonResponse({ ok: true });
            }

            const rawTarget = parts[0].replace(/^@/, '').trim();
            const isId = /^\d+$/.test(rawTarget);
            const username = isId ? null : rawTarget;
            const id = isId ? rawTarget : null;

            const restName = parts.slice(1).join(' ') || rawTarget;
            const role = 'Диспетчер';

            const exists = storeData.authorizedUsers.some(u =>
              (username && u.username && u.username.toLowerCase() === username.toLowerCase()) ||
              (id && u.id && String(u.id) === id)
            );

            if (exists) {
              await sendTg(`⚠️ Пользователь <b>${escapeHtml(rawTarget)}</b> уже есть в списке доступа.`);
              return jsonResponse({ ok: true });
            }

            storeData.authorizedUsers.push({
              id,
              username,
              name: restName,
              role,
              isAdmin: false,
              addedAt: new Date().toISOString()
            });

            storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers, masterAdminUsername, masterAdminId);

            await fetch(CLOUD_STORE_URL, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(storeData)
            });

            await sendTg(
              `✅ <b>Доступ предоставлен!</b>\n\n` +
              `👤 Пользователь: <b>${username ? '@' + escapeHtml(username) : 'ID ' + escapeHtml(id)}</b>\n` +
              `🏷 Имя: <b>${escapeHtml(restName)}</b>\n` +
              `💼 Роль: <b>${escapeHtml(role)}</b>\n\n` +
              `Теперь сотрудник может открыть диспетчерскую через бот командой /start.`
            );
            return jsonResponse({ ok: true });
          }

          // /remove, /del
          if (text.startsWith('/remove') || text.startsWith('/del')) {
            if (!isAdmin) {
              await sendTg(`⛔ Только главный администратор (@${masterAdminUsername}) может удалять пользователей.`);
              return jsonResponse({ ok: true });
            }

            const parts = text.split(/\s+/).slice(1);
            if (parts.length === 0) {
              await sendTg(`ℹ️ <b>Формат команды:</b>\n<code>/remove @username</code> или <code>/remove ID</code>`);
              return jsonResponse({ ok: true });
            }

            const cleanTarget = parts[0].replace(/^@/, '').toLowerCase().trim();
            if (cleanTarget === masterAdminUsername || cleanTarget === masterAdminId) {
              await sendTg(`⚠️ Нельзя отозвать доступ у главного администратора.`);
              return jsonResponse({ ok: true });
            }

            const beforeLen = storeData.authorizedUsers.length;
            storeData.authorizedUsers = storeData.authorizedUsers.filter(u => {
              const uName = (u.username || '').toLowerCase().replace(/^@/, '');
              const uId = String(u.id || '');
              return uName !== cleanTarget && uId !== cleanTarget;
            });

            if (storeData.authorizedUsers.length === beforeLen) {
              await sendTg(`❓ Пользователь <b>${escapeHtml(parts[0])}</b> не найден в списке доступа.`);
              return jsonResponse({ ok: true });
            }

            storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers, masterAdminUsername, masterAdminId);

            await fetch(CLOUD_STORE_URL, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(storeData)
            });

            await sendTg(`🗑 Доступ для <b>${escapeHtml(parts[0])}</b> успешно отозван.`);
            return jsonResponse({ ok: true });
          }

          // Fallback reply for any other message in private chat
          if (message.chat.type === 'private') {
            await sendTg(
              `🚛 <b>Диспетчерская ASMA Lines</b>\n\n` +
              `Чтобы открыть рабочее место CRM, нажмите кнопку ниже или введите /start`,
              {
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
              }
            );
          }

          return jsonResponse({ ok: true });
        } catch (err) {
          console.error('Webhook error:', err);
          return jsonResponse({ ok: false, error: err.message });
        }
      }
    }

    // ----------------------------------------------------
    // ROUTE: /api/crm (GET / POST)
    // ----------------------------------------------------
    if (url.pathname === '/api/crm' || url.pathname === '/api/crm/data') {
      try {
        if (request.method === 'GET') {
          let leads = [];
          let deletedIds = [];
          let authorizedUsers = [];

          try {
            const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
            if (storeRes.ok) {
              const storeData = await storeRes.json();
              if (Array.isArray(storeData.deletedIds)) deletedIds = storeData.deletedIds;
              if (Array.isArray(storeData.authorizedUsers)) authorizedUsers = storeData.authorizedUsers;
              if (Array.isArray(storeData.leads)) {
                const delSet = new Set(deletedIds);
                leads = storeData.leads.filter(l => !delSet.has(l.id));
              }
            }
          } catch (e) {
            console.error('Worker CRM fetch error:', e);
          }

          authorizedUsers = sanitizeUsers(authorizedUsers);

          return jsonResponse({
            success: true,
            leads,
            deletedIds,
            authorizedUsers,
            user: { name: 'Иван', username: 'plombit', role: 'Главный диспетчер' }
          });
        }

        if (request.method === 'POST' || request.method === 'PUT') {
          const body = await request.json().catch(() => ({}));
          const action = body.action || 'sync';

          let storeData = { leads: [], deletedIds: [], authorizedUsers: [] };
          try {
            const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
            if (storeRes.ok) {
              storeData = await storeRes.json();
            }
          } catch (e) {}

          if (!Array.isArray(storeData.leads)) storeData.leads = [];
          if (!Array.isArray(storeData.deletedIds)) storeData.deletedIds = [];
          if (!Array.isArray(storeData.authorizedUsers)) storeData.authorizedUsers = [];

          let delSet = new Set(storeData.deletedIds);

          if (Array.isArray(body.deletedIds)) {
            body.deletedIds.forEach(id => delSet.add(id));
          }

          if (Array.isArray(body.authorizedUsers) && body.authorizedUsers.length > 0) {
            body.authorizedUsers.forEach(au => {
              const exists = storeData.authorizedUsers.some(u =>
                (au.username && u.username && u.username.toLowerCase() === au.username.toLowerCase()) ||
                (au.id && u.id && String(u.id) === String(au.id))
              );
              if (!exists) storeData.authorizedUsers.push(au);
            });
          }
          storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers);

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
            deletedIds: storeData.deletedIds,
            authorizedUsers: storeData.authorizedUsers
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

        // 1. Persist to Cloud CRM Store
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

        // 2. Send Telegram notification
        if (botToken) {
          try {
            const botUsername = env?.TELEGRAM_USERNAME || 'asmalinesbot';
            const isPrivateChat = Number(chatId) > 0;
            const crmDirectUrl = `${crmAppUrl}?lead=${newLead.leadNumber}&auth=plombit`;
            const tgBotUrl = `https://t.me/${botUsername}?start=crm`;

            const inlineKeyboard = [];
            if (isPrivateChat) {
              inlineKeyboard.push([
                {
                  text: '🚀 Открыть CRM в Telegram',
                  web_app: { url: crmAppUrl }
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

            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: textHtml,
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: inlineKeyboard
                }
              })
            });
          } catch (err) {
            console.error('Worker Telegram send error:', err);
          }
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
