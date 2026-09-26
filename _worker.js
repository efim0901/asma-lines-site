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

async function verifyTelegramWebAppDataWorker(initDataStr, botToken) {
  if (!initDataStr) return null;
  try {
    const params = new URLSearchParams(initDataStr);
    const hash = params.get('hash');
    if (!hash) return null;

    if (botToken) {
      params.delete('hash');
      const dataCheckArr = [];
      const keys = Array.from(params.keys()).sort();
      for (const k of keys) {
        dataCheckArr.push(`${k}=${params.get(k)}`);
      }
      const dataCheckString = dataCheckArr.join('\n');

      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode('WebAppData'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const secretKeyBuffer = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(botToken));
      
      const hmacKey = await crypto.subtle.importKey(
        'raw',
        secretKeyBuffer,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(dataCheckString));
      const hashArray = Array.from(new Uint8Array(signature));
      const calculatedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      if (calculatedHash.toLowerCase() !== hash.toLowerCase()) {
        console.warn('Worker Telegram initData signature mismatch');
        return null;
      }
    }

    const userRaw = params.get('user');
    if (!userRaw) return null;
    return JSON.parse(userRaw);
  } catch (e) {
    return null;
  }
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


const BRAND_ASSETS = {
  '/favicon.ico': { base64: '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', type: 'image/x-icon' },
  '/assets/brand/favicon.ico': { base64: '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', type: 'image/x-icon' },
  '/apple-touch-icon.png': { base64: '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', type: 'image/png' },
  '/assets/brand/apple-touch-icon.png': { base64: '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', type: 'image/png' },
  '/assets/brand/favicon-16x16.png': { base64: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAABq0lEQVQ4jZ2TyytEURzHz19yr2cphxjKDgsLrxg7j6UNMfeOySN5N5lCZmgoUyjySGjKs5EFDYs7YzFu4zEZMoiEKBE2X92jYWHumCx+dTq/7+9zfr/T70sIIUTgEgt1PHXpOPou8BThQtEo2lqOFpBgsfBHkVqIPNUSgU90qwn6i0sxITSgJ7ckNISjElFr2xCvwaXXi4+3F5y63BCjk0MB3oja63ZjDy7kfbw+PTLITENbSB0JdVkXl4qALGO+1Yg9+xID+N1u6GOS0UQzIEYlhQcsdppw4/OxMSzaCsgbm9idmsNsUzta07LCd1AXm4JzjwcO6wjGqvVYNVtxsLUNx7ANx84dlg8LmDY0w7Vgx4kkYaVvEIF9GePVetxfBNgoix0mdYAhXgPn5DRufMewVdbg+eEOE2Ijy0kLdga4OjhEfUL6b0B9QjqOnE48XF/BrC3H7ZkfnnXHt9CsLcP7yzODLPdafgO6MvMwWiXCmJ2P7pwidm7RZH4Llc9zWG1YHxjCmmXoB6CLYP9V42uR1Fc5AoBEFFf9G8DTfOZIBuGoFKmdFW2w+BNvTP76yX7G0wAAAABJRU5ErkJggg==', type: 'image/png' },
  '/assets/brand/favicon-32x32.png': { base64: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAADdUlEQVRYhcVX7UtTYRS/f0QJfbkDEyt3mxObEoplgWgQgVb4QYg+BAbdqflSippOoaQIzbA3LGfuRW2+RJQWlo7NdOpUcjpfp06dTldOJ1YfPHGfuavrOsqr2x44H+7Z85zf7/ye8xx2MGzbSvTl+QhxopDEiV6Sw7UJOQTsh6FYOKEVcogCCgPbaSXhxy+ROLGyX6AuyeDECokHXGSACznEhrvBt9kGTSLRl+fjicwZhhNW0o9/EKPu3OPgW7Uhogj0sTl8JywK1BIZqF5LkSkrqiD1SPBuVdBiQg6xyoZAd8Nb+P1zzcneFz/edUFibMDzwqJgaXqKQcA48A3Sjp7YVSyMDQGNoh4BLi+YnEms26DpUZl7CeSGngWzwYAAlZVShhIzgzpIDwhxH4HOzexn9XoE1N3QyLiKppIy9xDIEUSCedKevVoiRz5RRDRTBZ0O0o4J0O+3eSfhbtQFSPbl7Z1Au7wGAViM06gQHf6uersK1iUzjHdpQKNohAoyDZpLn4I4KQNS/IL2rkB28ClYmBhHQP1NzYxXoVE0gFIsgZZn5TDYpoTWV5WQLTi9f1fQLqtG4LbvS1AafxX5qMYjy8gBvUqFANXSaliankRZDymV8KVcvD8EMvnhYBodQQSG1e3o+939ErDMzcBXeS3IbuWC2TAOc/ohKI5LgDFNF9o7PzYKWfzwvRNQiiWw9sOymakYrItmMI0MQ1nCNWh5/hJ+rdtgqr8fHpyPR81oe0GqqmR7I5DqHwxjnRr48LAUFicnUNDON3WoJnStbejbNKxHquSEngGzwb7HYYuTBsgJiWRPID0gBClAZUlZfWERelqGHu1mN5wHUcQ5en9HrYLRFzpqFOwIZAsiYaK7BwWhwOWZeUgRvUpNBy+/nsLsFX+pQD1bUUTM7gjci45FFe0IIs3Itr/5uq3Op5bV7Hh2JxU0dfX/TyA/IgYss0b68KcnL5C/Oiuf9lHSu6rwopg4WFu2OKswa4SSy1f+TSDFLwhUEjkMfG5FRlVx8uFAyAwMg76mj7Sfeuuu1KO6oGl0FIw6nZPNDg6ye4ZCNxrmdQKkN/4ROwwnrBSBXi8S0FJXUOC9K+Dme3Ew4S7fPOR/AE1H1Jjk6dHsBocb6zQfIhI4YfVE5gxwmoQf/yA1LpEcbg/bgcWFrdpjcvNp2TfXH7nZ+twxYrDFAAAAAElFTkSuQmCC', type: 'image/png' },
  '/assets/brand/asma-mark.svg': { content: "<svg width=\"300\" height=\"300\" viewBox=\"265 112 950 950\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n  <style>\n    .mark-path { fill: #1B1A18; stroke: #1B1A18; }\n    @media (prefers-color-scheme: dark) {\n      .mark-path { fill: #FAF8F5; stroke: #FAF8F5; }\n    }\n  </style>\n  <path class=\"mark-path\" d=\"M726.5 313.5L815.5 492L959 446L842 213H704.5L489.5 650.5L605 590L726.5 313.5Z\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n  <path class=\"mark-path\" d=\"M960.503 779L880.503 619.5L995.503 516.5C995.503 516.5 1126.28 769.5 1137.5 790C1148.72 810.5 1167.5 815 1167.5 815V832H950.003V824L960.503 815V779Z\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n  <path class=\"mark-path\" d=\"M333 831.001C508.001 619.001 766.003 514 1115.5 418.501C937.825 517.278 802.78 601.969 678.003 831.001L546.503 831.001C715.873 584.129 871.188 520.433 1115.5 418.501C835.185 517.888 633.18 608.872 470.003 831.001L333 831.001Z\"/>\n</svg>\n", type: 'image/svg+xml; charset=utf-8' },
  '/assets/brand/asma-mark-light.svg': { content: "<svg width=\"300\" height=\"300\" viewBox=\"265 112 950 950\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n  <path d=\"M726.5 313.5L815.5 492L959 446L842 213H704.5L489.5 650.5L605 590L726.5 313.5Z\" fill=\"#1B1A18\" stroke=\"#1B1A18\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n  <path d=\"M960.503 779L880.503 619.5L995.503 516.5C995.503 516.5 1126.28 769.5 1137.5 790C1148.72 810.5 1167.5 815 1167.5 815V832H950.003V824L960.503 815V779Z\" fill=\"#1B1A18\" stroke=\"#1B1A18\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n  <path d=\"M333 831.001C508.001 619.001 766.003 514 1115.5 418.501C937.825 517.278 802.78 601.969 678.003 831.001L546.503 831.001C715.873 584.129 871.188 520.433 1115.5 418.501C835.185 517.888 633.18 608.872 470.003 831.001L333 831.001Z\" fill=\"#1B1A18\"/>\n</svg>\n", type: 'image/svg+xml; charset=utf-8' },
  '/assets/brand/asma-mark-dark.svg': { content: "<svg width=\"300\" height=\"300\" viewBox=\"265 112 950 950\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n  <path d=\"M726.5 313.5L815.5 492L959 446L842 213H704.5L489.5 650.5L605 590L726.5 313.5Z\" fill=\"#FAF8F5\" stroke=\"#FAF8F5\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n  <path d=\"M960.503 779L880.503 619.5L995.503 516.5C995.503 516.5 1126.28 769.5 1137.5 790C1148.72 810.5 1167.5 815 1167.5 815V832H950.003V824L960.503 815V779Z\" fill=\"#FAF8F5\" stroke=\"#FAF8F5\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n  <path d=\"M333 831.001C508.001 619.001 766.003 514 1115.5 418.501C937.825 517.278 802.78 601.969 678.003 831.001L546.503 831.001C715.873 584.129 871.188 520.433 1115.5 418.501C835.185 517.888 633.18 608.872 470.003 831.001L333 831.001Z\" fill=\"#FAF8F5\"/>\n</svg>\n", type: 'image/svg+xml; charset=utf-8' },
  '/assets/brand/asma-logo-light.svg': { content: "<svg width=\"1000\" height=\"1000\" viewBox=\"0 0 1000 1000\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n  <!-- ASMA Emblem Top -->\n  <g transform=\"translate(500, 275) scale(0.72) translate(-750, -522)\" fill=\"#1B1A18\">\n    <path d=\"M726.5 313.5L815.5 492L959 446L842 213H704.5L489.5 650.5L605 590L726.5 313.5Z\" stroke=\"#1B1A18\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n    <path d=\"M960.503 779L880.503 619.5L995.503 516.5C995.503 516.5 1126.28 769.5 1137.5 790C1148.72 810.5 1167.5 815 1167.5 815V832H950.003V824L960.503 815V779Z\" stroke=\"#1B1A18\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n    <path d=\"M333 831.001C508.001 619.001 766.003 514 1115.5 418.501C937.825 517.278 802.78 601.969 678.003 831.001L546.503 831.001C715.873 584.129 871.188 520.433 1115.5 418.501C835.185 517.888 633.18 608.872 470.003 831.001L333 831.001Z\"/>\n  </g>\n\n  <!-- Wordmark Middle (ASMA) -->\n  <text x=\"500\" y=\"732\" text-anchor=\"middle\" font-family=\"'Playfair Display', 'Rockwell', 'Georgia', 'Times New Roman', serif\" font-size=\"184\" font-weight=\"900\" fill=\"#1B1A18\" letter-spacing=\"6\">ASMA</text>\n\n  <!-- Subtitle Bottom (— LINES —) -->\n  <g stroke=\"#1B1A18\" stroke-width=\"7\" stroke-linecap=\"square\">\n    <line x1=\"160\" y1=\"818\" x2=\"350\" y2=\"818\"/>\n    <line x1=\"650\" y1=\"818\" x2=\"840\" y2=\"818\"/>\n  </g>\n  <text x=\"506\" y=\"834\" text-anchor=\"middle\" font-family=\"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif\" font-size=\"62\" font-weight=\"800\" fill=\"#1B1A18\" letter-spacing=\"20\">LINES</text>\n</svg>\n", type: 'image/svg+xml; charset=utf-8' },
  '/assets/brand/asma-logo-dark.svg': { content: "<svg width=\"1000\" height=\"1000\" viewBox=\"0 0 1000 1000\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n  <!-- ASMA Emblem Top -->\n  <g transform=\"translate(500, 275) scale(0.72) translate(-750, -522)\" fill=\"#FAF8F5\">\n    <path d=\"M726.5 313.5L815.5 492L959 446L842 213H704.5L489.5 650.5L605 590L726.5 313.5Z\" stroke=\"#FAF8F5\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n    <path d=\"M960.503 779L880.503 619.5L995.503 516.5C995.503 516.5 1126.28 769.5 1137.5 790C1148.72 810.5 1167.5 815 1167.5 815V832H950.003V824L960.503 815V779Z\" stroke=\"#FAF8F5\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n    <path d=\"M333 831.001C508.001 619.001 766.003 514 1115.5 418.501C937.825 517.278 802.78 601.969 678.003 831.001L546.503 831.001C715.873 584.129 871.188 520.433 1115.5 418.501C835.185 517.888 633.18 608.872 470.003 831.001L333 831.001Z\"/>\n  </g>\n\n  <!-- Wordmark Middle (ASMA) -->\n  <text x=\"500\" y=\"732\" text-anchor=\"middle\" font-family=\"'Playfair Display', 'Rockwell', 'Georgia', 'Times New Roman', serif\" font-size=\"184\" font-weight=\"900\" fill=\"#FAF8F5\" letter-spacing=\"6\">ASMA</text>\n\n  <!-- Subtitle Bottom (— LINES —) -->\n  <g stroke=\"#FAF8F5\" stroke-width=\"7\" stroke-linecap=\"square\">\n    <line x1=\"160\" y1=\"818\" x2=\"350\" y2=\"818\"/>\n    <line x1=\"650\" y1=\"818\" x2=\"840\" y2=\"818\"/>\n  </g>\n  <text x=\"506\" y=\"834\" text-anchor=\"middle\" font-family=\"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif\" font-size=\"62\" font-weight=\"800\" fill=\"#FAF8F5\" letter-spacing=\"20\">LINES</text>\n</svg>\n", type: 'image/svg+xml; charset=utf-8' },
  '/assets/brand/Полная2 светлая тема.svg': { content: "<svg width=\"1000\" height=\"1000\" viewBox=\"0 0 1000 1000\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n  <!-- ASMA Emblem Top -->\n  <g transform=\"translate(500, 275) scale(0.72) translate(-750, -522)\" fill=\"#1B1A18\">\n    <path d=\"M726.5 313.5L815.5 492L959 446L842 213H704.5L489.5 650.5L605 590L726.5 313.5Z\" stroke=\"#1B1A18\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n    <path d=\"M960.503 779L880.503 619.5L995.503 516.5C995.503 516.5 1126.28 769.5 1137.5 790C1148.72 810.5 1167.5 815 1167.5 815V832H950.003V824L960.503 815V779Z\" stroke=\"#1B1A18\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n    <path d=\"M333 831.001C508.001 619.001 766.003 514 1115.5 418.501C937.825 517.278 802.78 601.969 678.003 831.001L546.503 831.001C715.873 584.129 871.188 520.433 1115.5 418.501C835.185 517.888 633.18 608.872 470.003 831.001L333 831.001Z\"/>\n  </g>\n\n  <!-- Wordmark Middle (ASMA) -->\n  <text x=\"500\" y=\"732\" text-anchor=\"middle\" font-family=\"'Playfair Display', 'Rockwell', 'Georgia', 'Times New Roman', serif\" font-size=\"184\" font-weight=\"900\" fill=\"#1B1A18\" letter-spacing=\"6\">ASMA</text>\n\n  <!-- Subtitle Bottom (— LINES —) -->\n  <g stroke=\"#1B1A18\" stroke-width=\"7\" stroke-linecap=\"square\">\n    <line x1=\"160\" y1=\"818\" x2=\"350\" y2=\"818\"/>\n    <line x1=\"650\" y1=\"818\" x2=\"840\" y2=\"818\"/>\n  </g>\n  <text x=\"506\" y=\"834\" text-anchor=\"middle\" font-family=\"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif\" font-size=\"62\" font-weight=\"800\" fill=\"#1B1A18\" letter-spacing=\"20\">LINES</text>\n</svg>\n", type: 'image/svg+xml; charset=utf-8' },
  '/assets/brand/Полная2 темная тема.svg': { content: "<svg width=\"1000\" height=\"1000\" viewBox=\"0 0 1000 1000\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n  <!-- ASMA Emblem Top -->\n  <g transform=\"translate(500, 275) scale(0.72) translate(-750, -522)\" fill=\"#FAF8F5\">\n    <path d=\"M726.5 313.5L815.5 492L959 446L842 213H704.5L489.5 650.5L605 590L726.5 313.5Z\" stroke=\"#FAF8F5\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n    <path d=\"M960.503 779L880.503 619.5L995.503 516.5C995.503 516.5 1126.28 769.5 1137.5 790C1148.72 810.5 1167.5 815 1167.5 815V832H950.003V824L960.503 815V779Z\" stroke=\"#FAF8F5\" stroke-width=\"16\" stroke-linejoin=\"round\"/>\n    <path d=\"M333 831.001C508.001 619.001 766.003 514 1115.5 418.501C937.825 517.278 802.78 601.969 678.003 831.001L546.503 831.001C715.873 584.129 871.188 520.433 1115.5 418.501C835.185 517.888 633.18 608.872 470.003 831.001L333 831.001Z\"/>\n  </g>\n\n  <!-- Wordmark Middle (ASMA) -->\n  <text x=\"500\" y=\"732\" text-anchor=\"middle\" font-family=\"'Playfair Display', 'Rockwell', 'Georgia', 'Times New Roman', serif\" font-size=\"184\" font-weight=\"900\" fill=\"#FAF8F5\" letter-spacing=\"6\">ASMA</text>\n\n  <!-- Subtitle Bottom (— LINES —) -->\n  <g stroke=\"#FAF8F5\" stroke-width=\"7\" stroke-linecap=\"square\">\n    <line x1=\"160\" y1=\"818\" x2=\"350\" y2=\"818\"/>\n    <line x1=\"650\" y1=\"818\" x2=\"840\" y2=\"818\"/>\n  </g>\n  <text x=\"506\" y=\"834\" text-anchor=\"middle\" font-family=\"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif\" font-size=\"62\" font-weight=\"800\" fill=\"#FAF8F5\" letter-spacing=\"20\">LINES</text>\n</svg>\n", type: 'image/svg+xml; charset=utf-8' }
};

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

    // Brand assets, logos & favicon direct handlers (prevents 404 even if asset bucket is stale/syncing)
    const pathname = url.pathname;
    const decodedPathname = decodeURIComponent(pathname);
    const brandAsset = BRAND_ASSETS[pathname] || BRAND_ASSETS[decodedPathname];
    if (brandAsset) {
      if (brandAsset.base64) {
        const binary = Uint8Array.from(atob(brandAsset.base64), c => c.charCodeAt(0));
        return new Response(binary, {
          status: 200,
          headers: {
            'Content-Type': brandAsset.type,
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            ...corsHeaders
          }
        });
      } else {
        return new Response(brandAsset.content, {
          status: 200,
          headers: {
            'Content-Type': brandAsset.type,
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            ...corsHeaders
          }
        });
      }
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
        const initDataStr = request.headers.get('x-telegram-init-data') || '';
        const tgUser = await verifyTelegramWebAppDataWorker(initDataStr, botToken);

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

          authorizedUsers = sanitizeUsers(authorizedUsers, masterAdminUsername, masterAdminId);

          if (!checkUserAuthorized(authorizedUsers, tgUser, masterAdminUsername, masterAdminId)) {
            return jsonResponse({ error: 'Доступ запрещён: требуется авторизация через Telegram-бот ASMA Lines' }, 401);
          }

          return jsonResponse({
            success: true,
            leads,
            deletedIds,
            authorizedUsers,
            user: { name: tgUser?.first_name || 'Диспетчер', username: tgUser?.username || 'plombit', role: 'Диспетчер' }
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

          storeData.authorizedUsers = sanitizeUsers(storeData.authorizedUsers, masterAdminUsername, masterAdminId);

          if (!checkUserAuthorized(storeData.authorizedUsers, tgUser, masterAdminUsername, masterAdminId)) {
            return jsonResponse({ error: 'Доступ запрещён: требуется авторизация через Telegram-бот ASMA Lines' }, 401);
          }

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
