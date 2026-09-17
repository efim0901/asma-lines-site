// Cloudflare Pages Function: /api/crm/access
const CLOUD_STORE_URL = 'https://json.extendsclass.com/bin/becdbda';
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

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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

    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        success: true,
        users: storeData.authorizedUsers
      }), { headers: corsHeaders });
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { action, user, target, requestedBy } = body;

      const reqUser = (requestedBy?.username || '').toLowerCase().replace(/^@/, '');
      const reqId = String(requestedBy?.id || '');

      const isAdmin = requestedBy?.isAdmin ||
                      reqUser === masterAdminUsername ||
                      reqId === masterAdminId;

      if (!isAdmin) {
        return new Response(JSON.stringify({ error: `Доступ запрещён: требуется роль администратора (@${masterAdminUsername})` }), {
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
