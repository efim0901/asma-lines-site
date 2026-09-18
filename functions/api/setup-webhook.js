// Cloudflare Pages Function: /api/setup-webhook
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const DEFAULT_BOT_TOKEN = '8808722578:AAEYNIMN8P7LG8IYtUOsytw6yWO1bEBLlLI';
  const botToken = env?.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN;
  if (!botToken) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'TELEGRAM_BOT_TOKEN не установлен в Cloudflare Secrets (Environment Variables).',
      hint: 'Добавьте TELEGRAM_BOT_TOKEN в настройках Cloudflare Pages/Worker (Settings -> Variables & Secrets).'
    }), { status: 400, headers: corsHeaders });
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

    return new Response(JSON.stringify({
      ok: true,
      message: setResult.ok ? 'Webhook успешно зарегистрирован!' : 'Ошибка регистрации Webhook в Telegram',
      bot: meResult?.result || {},
      targetWebhookUrl: webhookUrl,
      telegramSetResult: setResult,
      webhookInfo: infoResult?.result || {},
      instructions: 'Теперь отправьте боту в Telegram команду /start или /test для проверки.'
    }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Сбой подключения к Telegram API: ' + err.message
    }), { status: 500, headers: corsHeaders });
  }
}
