// Cloudflare Pages Function: /api/crm/access
const CLOUD_STORE_URL = 'https://json.extendsclass.com/bin/becdbda';
const DEFAULT_TELEGRAM_BOT_TOKEN = '8808722578:AAEYNIMN8P7LG8IYtUOsytw6yWO1bEBLlLI';
const DEFAULT_MASTER_ADMIN_USERNAME = 'plombit';
const DEFAULT_MASTER_ADMIN_ID = '1014012851';

const DEFAULT_AUTHORIZED_USERS = [
  {
    id: '1014012851',
    username: 'plombit',
    name: 'Иван Ефимович',
    isAdmin: true,
    addedAt: '2026-09-17T10:00:00.000Z'
  }
];

async function verifyTelegramInitData(initDataRaw, botToken) {
  if (!initDataRaw || !botToken) return { valid: false, reason: 'Missing initData or botToken' };

  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');
    if (!hash) return { valid: false, reason: 'Missing hash' };

    params.delete('hash');

    const dataCheckArr = [];
    for (const [key, value] of params.entries()) {
      dataCheckArr.push(`${key}=${value}`);
    }
    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join('\n');

    const encoder = new TextEncoder();
    
    // Step 1: secret_key = HMAC-SHA256("WebAppData", botToken)
    const webAppDataKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const secretKeyBuffer = await crypto.subtle.sign(
      'HMAC',
      webAppDataKey,
      encoder.encode(botToken)
    );

    // Step 2: calculated_hash = HMAC-SHA256(secret_key, dataCheckString)
    const secretKey = await crypto.subtle.importKey(
      'raw',
      secretKeyBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      secretKey,
      encoder.encode(dataCheckString)
    );

    const calculatedHash = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (calculatedHash.toLowerCase() !== hash.toLowerCase()) {
      return { valid: false, reason: 'HMAC signature mismatch' };
    }

    const authDate = parseInt(params.get('auth_date') || '0', 10);
    const now = Math.floor(Date.now() / 1000);
    if (authDate && (now - authDate > 86400 * 2)) {
      return { valid: false, reason: 'Telegram session expired (> 48h)' };
    }

    let user = null;
    const userStr = params.get('user');
    if (userStr) {
      try { user = JSON.parse(userStr); } catch (e) {}
    }

    return { valid: true, user, authDate };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

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

export async function onRequest(context) {
  const { request, env } = context;

  const masterAdminUsername = (env?.MASTER_ADMIN_USERNAME || DEFAULT_MASTER_ADMIN_USERNAME).toLowerCase().replace(/^@/, '');
  const masterAdminId = String(env?.MASTER_ADMIN_ID || DEFAULT_MASTER_ADMIN_ID);
  const botToken = env?.TELEGRAM_BOT_TOKEN || DEFAULT_TELEGRAM_BOT_TOKEN;

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Init-Data, X-TG-Init-Data'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let storeData = { authorizedUsers: [], leads: [], deletedIds: [] };
    try {
      const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
      if (storeRes.ok) storeData = await storeRes.json();
    } catch (e) {}

    storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers, masterAdminUsername, masterAdminId);

    // Check authorization header
    const initData = request.headers.get('X-Telegram-Init-Data') ||
                     request.headers.get('X-TG-Init-Data') ||
                     (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

    const url = new URL(request.url);
    const host = url.hostname;
    const isDevHost = host === 'localhost' || host.includes('ais-dev-') || host.includes('ais-pre-');

    let callerUser = null;
    let isMasterCaller = false;

    if (initData) {
      const authResult = await verifyTelegramInitData(initData, botToken);
      if (!authResult.valid) {
        return new Response(JSON.stringify({ error: `Доступ запрещён: подпись Telegram недействительна (${authResult.reason})` }), {
          status: 401,
          headers: corsHeaders
        });
      }
      callerUser = authResult.user;
      const callerUsername = (callerUser?.username || '').toLowerCase().replace(/^@/, '');
      const callerId = String(callerUser?.id || '');
      isMasterCaller = callerUsername === masterAdminUsername || callerId === masterAdminId;

      const isAllowed = isMasterCaller || storeData.authorizedUsers.some(u => 
        (u.username && u.username.toLowerCase() === callerUsername) ||
        (u.id && String(u.id) === callerId)
      );

      if (!isAllowed) {
        return new Response(JSON.stringify({ error: 'Доступ ограничен: ваш аккаунт отсутствует в списке разрешённых' }), {
          status: 403,
          headers: corsHeaders
        });
      }
    } else if (!isDevHost) {
      return new Response(JSON.stringify({ error: 'Доступ запрещён: требуется запуск через Telegram Mini App с валидной подписью' }), {
        status: 401,
        headers: corsHeaders
      });
    }

    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        success: true,
        users: storeData.authorizedUsers
      }), { headers: corsHeaders });
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { action, user, target } = body;

      if (initData && !isMasterCaller) {
        return new Response(JSON.stringify({ error: `Изменение доступа разрешено только главному администратору (@${masterAdminUsername})` }), {
          status: 403,
          headers: corsHeaders
        });
      }

      if (action === 'add' && user) {
        const username = user.username ? String(user.username).replace(/^@/, '').trim() : null;
        const id = user.id ? String(user.id).replace(/^@/, '').trim() : null;

        if (!username && !id) {
          return new Response(JSON.stringify({ error: 'Укажите username или ID' }), {
            status: 400,
            headers: corsHeaders
          });
        }

        const exists = storeData.authorizedUsers.some(u =>
          (username && u.username && u.username.toLowerCase() === username.toLowerCase()) ||
          (id && u.id && String(u.id) === id)
        );

        if (!exists) {
          storeData.authorizedUsers.push({
            id,
            username,
            name: user.name || (username ? `@${username}` : `ID: ${id}`),
            isAdmin: false,
            addedAt: new Date().toISOString()
          });
        }
      } else if (action === 'remove' && target) {
        const cleanTarget = String(target).replace(/^@/, '').toLowerCase().trim();
        if (cleanTarget === masterAdminUsername || cleanTarget === masterAdminId) {
          return new Response(JSON.stringify({ error: 'Нельзя удалить главного администратора' }), {
            status: 400,
            headers: corsHeaders
          });
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

      return new Response(JSON.stringify({
        success: true,
        users: storeData.authorizedUsers
      }), { headers: corsHeaders });
    }

    return new Response('Method Not Allowed', { status: 405 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
