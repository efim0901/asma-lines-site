// Cloudflare Pages Worker for CRM operations (/api/crm)
const CLOUD_STORE_URL = 'https://json.extendsclass.com/bin/becdbda';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    // 1. GET - Return leads and active user (Ivan only)
    if (request.method === 'GET') {
      let leads = [];
      let deletedIds = [];
      try {
        const storeRes = await fetch(CLOUD_STORE_URL);
        if (storeRes.ok) {
          const storeData = await storeRes.json();
          if (Array.isArray(storeData.deletedIds)) deletedIds = storeData.deletedIds;
          if (Array.isArray(storeData.leads)) {
            const delSet = new Set(deletedIds);
            leads = storeData.leads.filter(l => !delSet.has(l.id));
          }
        }
      } catch (err) {
        console.warn('Failed to fetch from cloud store:', err.message);
      }

      return new Response(JSON.stringify({
        success: true,
        leads: leads,
        deletedIds: deletedIds,
        user: {
          name: "Иван",
          role: "Диспетчер",
          username: "plombit"
        }
      }), { headers: corsHeaders });
    }

    // 2. POST / PUT / PATCH - Update or Create lead
    if (request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT') {
      const body = await request.json().catch(() => ({}));
      const action = body.action || (url.pathname.includes('status') ? 'update_status' : (url.pathname.includes('note') ? 'add_note' : 'upsert'));

      let storeData = { leads: [], deletedIds: [], authorizedUsers: [] };
      try {
        const storeRes = await fetch(CLOUD_STORE_URL + '?_t=' + Date.now(), { cache: 'no-store' });
        if (storeRes.ok) storeData = await storeRes.json();
      } catch (err) {}
      if (!Array.isArray(storeData.leads)) storeData.leads = [];
      if (!Array.isArray(storeData.deletedIds)) storeData.deletedIds = [];
      if (!Array.isArray(storeData.authorizedUsers)) storeData.authorizedUsers = [];

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
            author: 'Иван',
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
            author: body.author || 'Иван',
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
          dispatcher: 'Иван',
          notes: [
            {
              id: 'n-' + Date.now(),
              author: 'Иван',
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
        // Direct lead update
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

      let storeData = { leads: [] };
      try {
        const storeRes = await fetch(CLOUD_STORE_URL);
        if (storeRes.ok) storeData = await storeRes.json();
      } catch (err) {}
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
