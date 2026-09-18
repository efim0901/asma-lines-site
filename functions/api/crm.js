// Cloudflare Pages Worker for CRM operations (/api/crm)
const CLOUD_STORE_URL = 'https://json.extendsclass.com/bin/becdbda';
const DEFAULT_TELEGRAM_BOT_TOKEN = '8808722578:AAEYNIMN8P7LG8IYtUOsytw6yWO1bEBLlLI';
const DEFAULT_MASTER_ADMIN_USERNAME = 'plombit';
const DEFAULT_MASTER_ADMIN_ID = '1014012851';

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

async function checkCrmAccess(request, env, storeData) {
  const botToken = env?.TELEGRAM_BOT_TOKEN || DEFAULT_TELEGRAM_BOT_TOKEN;
  const initData = request.headers.get('X-Telegram-Init-Data') ||
                   request.headers.get('X-TG-Init-Data') ||
                   (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

  const url = new URL(request.url);
  const host = url.hostname;
  const isDevHost = host === 'localhost' || host.includes('ais-dev-') || host.includes('ais-pre-');

  if (initData) {
    const authResult = await verifyTelegramInitData(initData, botToken);
    if (!authResult.valid) {
      return { authorized: false, status: 401, error: `Доступ запрещён: подпись Telegram недействительна (${authResult.reason})` };
    }

    const tgUser = authResult.user;
    if (!tgUser) {
      return { authorized: false, status: 401, error: 'Доступ запрещён: отсутствуют данные пользователя Telegram' };
    }

    const tgUsername = (tgUser.username || '').toLowerCase().replace(/^@/, '');
    const tgId = String(tgUser.id || '');

    const masterUsername = (env?.MASTER_ADMIN_USERNAME || DEFAULT_MASTER_ADMIN_USERNAME).toLowerCase().replace(/^@/, '');
    const masterId = String(env?.MASTER_ADMIN_ID || DEFAULT_MASTER_ADMIN_ID);

    const isMaster = tgUsername === masterUsername || tgId === masterId;
    const usersList = Array.isArray(storeData?.authorizedUsers) ? storeData.authorizedUsers : [];

    const isAuthorized = isMaster || usersList.some(u =>
      (u.username && u.username.toLowerCase() === tgUsername) ||
      (u.id && String(u.id) === tgId)
    );

    if (!isAuthorized) {
      return { authorized: false, status: 403, error: `Доступ ограничен: пользователь @${tgUsername || tgId} отсутствует в списке сотрудников` };
    }

    return { authorized: true, user: tgUser, isMaster };
  }

  // Allow preview / dev mode if initData not supplied
  if (isDevHost) {
    return { authorized: true, isDevBypass: true };
  }

  return { authorized: false, status: 401, error: 'Доступ запрещён: требуется запуск через Telegram Mini App с валидной подписью' };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Init-Data, X-TG-Init-Data',
      }
    });
  }

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Init-Data, X-TG-Init-Data'
  };

  try {
    // Load current cloud store data to check access against authorizedUsers
    let storeData = { leads: [], deletedIds: [], authorizedUsers: [] };
    try {
      const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
      if (storeRes.ok) storeData = await storeRes.json();
    } catch (err) {}

    // Security Gate: Verify Telegram InitData & Authorized Users
    const access = await checkCrmAccess(request, env, storeData);
    if (!access.authorized) {
      return new Response(JSON.stringify({ error: access.error }), {
        status: access.status || 401,
        headers: corsHeaders
      });
    }

    // 1. GET - Return leads
    if (request.method === 'GET') {
      let leads = Array.isArray(storeData.leads) ? storeData.leads : [];
      let deletedIds = Array.isArray(storeData.deletedIds) ? storeData.deletedIds : [];
      const delSet = new Set(deletedIds);
      leads = leads.filter(l => !delSet.has(l.id));

      return new Response(JSON.stringify({
        success: true,
        leads: leads,
        deletedIds: deletedIds,
        authorizedUsers: storeData.authorizedUsers || [],
        user: access.user || {
          name: "Иван",
          username: "plombit"
        }
      }), { headers: corsHeaders });
    }

    // 2. POST / PUT / PATCH - Update or Create lead
    if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT') {
      const body = await request.json().catch(() => ({}));
      const action = body.action || (url.pathname.includes('status') ? 'update_status' : (url.pathname.includes('note') ? 'add_note' : 'upsert'));

      if (!Array.isArray(storeData.leads)) storeData.leads = [];
      if (!Array.isArray(storeData.deletedIds)) storeData.deletedIds = [];
      if (!Array.isArray(storeData.authorizedUsers)) storeData.authorizedUsers = [];

      const operatorName = access.user?.first_name || access.user?.username || 'Диспетчер';

      if (action === 'sync' && Array.isArray(body.leads)) {
        storeData.leads = body.leads;
        if (Array.isArray(body.deletedIds)) storeData.deletedIds = body.deletedIds;
        if (Array.isArray(body.authorizedUsers) && body.authorizedUsers.length > 0) {
          storeData.authorizedUsers = body.authorizedUsers;
        }
      } else if (action === 'update_status' && body.leadId) {
        const lead = storeData.leads.find(l => l.id === body.leadId);
        if (lead) {
          lead.status = body.status;
          if (!lead.notes) lead.notes = [];
          lead.notes.unshift({
            id: 'n-' + Date.now(),
            author: operatorName,
            text: `Статус изменён на: ${body.statusLabel || body.status}`,
            time: new Date().toISOString()
          });
        }
      } else if (action === 'add_note' && body.leadId) {
        const lead = storeData.leads.find(l => l.id === body.leadId);
        if (lead) {
          if (!lead.notes) lead.notes = [];
          lead.notes.unshift({
            id: 'n-' + Date.now(),
            author: body.author || operatorName,
            text: body.text || '',
            time: new Date().toISOString()
          });
        }
      } else if (action === 'create_lead') {
        const newLead = {
          id: 'lead-' + Date.now(),
          leadNumber: String(storeData.leads.length + 101),
          type: body.type || 'cargo',
          category: body.type === 'cargo' ? 'Перевозка груза' : (body.type === 'contact' ? 'Обратная связь' : 'Сотрудничество'),
          status: 'new',
          createdAt: new Date().toISOString(),
          name: body.name || 'Клиент',
          contact: body.contact || '',
          email: body.email || '',
          route: (body.fromCity && body.toCity) ? `${body.fromCity} → ${body.toCity}` : (body.route || 'Маршрут по запросу'),
          distance: body.distance || '',
          vehicle: body.vehicle || '',
          weight: body.weight || '',
          volume: body.volume || '',
          price: body.price || '',
          comment: body.comment || '',
          dispatcher: operatorName,
          notes: [
            {
              id: 'n-' + Date.now(),
              author: operatorName,
              text: 'Создано вручную диспетчером',
              time: new Date().toISOString()
            }
          ],
          source: 'manual_crm'
        };
        storeData.leads.unshift(newLead);
      } else if (action === 'delete_lead' && body.leadId) {
        storeData.leads = storeData.leads.filter(l => l.id !== body.leadId);
      } else if (body.leadId && body.lead) {
        const idx = storeData.leads.findIndex(l => l.id === body.leadId);
        if (idx >= 0) {
          storeData.leads[idx] = { ...storeData.leads[idx], ...body.lead };
        }
      }

      // Save back to cloud store
      await fetch(CLOUD_STORE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storeData)
      });

      return new Response(JSON.stringify({ success: true, leads: storeData.leads }), { headers: corsHeaders });
    }

    // 3. DELETE - Delete lead
    if (request.method === 'DELETE') {
      const urlParts = url.pathname.split('/');
      const leadId = urlParts[urlParts.length - 1];

      if (Array.isArray(storeData.leads)) {
        storeData.leads = storeData.leads.filter(l => l.id !== leadId);
        await fetch(CLOUD_STORE_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(storeData)
        });
      }

      return new Response(JSON.stringify({ success: true, leads: storeData.leads }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
