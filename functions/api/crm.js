// Cloudflare Pages Worker for CRM operations (/api/crm)

const DEFAULT_EMPLOYEES = [
  {
    id: "emp-1",
    name: "Иван Ефимович",
    role: "Руководитель / Старший диспетчер",
    phone: "+375 (29) 123-45-01",
    telegram: "@ivan_asma",
    color: "#1d4ed8",
    active: true
  },
  {
    id: "emp-2",
    name: "Ольга Смирнова",
    role: "Диспетчер-логист",
    phone: "+375 (29) 234-56-02",
    telegram: "@olga_dispatch",
    color: "#0d9488",
    active: true
  },
  {
    id: "emp-3",
    name: "Дмитрий Прокопенко",
    role: "Диспетчер по междугороду",
    phone: "+375 (29) 345-67-03",
    telegram: "@dmitry_logist",
    color: "#d97706",
    active: true
  },
  {
    id: "emp-4",
    name: "Александр Ковалёв",
    role: "Водитель-экспедитор (МАЗ 10т)",
    phone: "+375 (29) 456-78-04",
    telegram: "@kovalev_trans",
    color: "#64748b",
    active: true
  }
];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    if (request.method === 'GET') {
      // In Cloudflare Workers, return default template structure
      // The frontend crm.js merges this with its local persistent indexedDB / localStorage cache
      return new Response(JSON.stringify({
        success: true,
        source: 'cloudflare_worker',
        employees: DEFAULT_EMPLOYEES
      }), { headers: corsHeaders });
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      return new Response(JSON.stringify({
        success: true,
        received: true,
        data: body
      }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
