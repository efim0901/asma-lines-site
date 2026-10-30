/**
 * Восстановление работы бота после перевыпуска токена.
 *
 * Симптом: getWebhookInfo возвращает пустой url — Telegram не отправляет
 * обновления, бот не отвечает. Так бывает, когда токен перевыпустили
 * в @BotFather: вебхук при этом сбрасывается.
 *
 * Скрипт:
 *   1. проверяет токен из ~/.bot-token.txt;
 *   2. сравнивает его с тем, что лежит в секретах Cloudflare (по хешу);
 *   3. при расхождении обновляет секрет;
 *   4. перерегистрирует вебхук с секретом;
 *   5. проверяет результат через getWebhookInfo.
 *
 * Запуск: node _tools/fix-bot-token.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WORKER_NAME = 'asma-lines-site';
const WEBHOOK_URL = 'https://asma-lines-site.firws.workers.dev/api/telegram-webhook';

const read = (name) => fs.readFileSync(path.join(os.homedir(), name), 'utf8').trim();
const fileToken = read('.bot-token.txt');
const cfToken = read('.cf-token.txt');
const accountId = read('.cf-account.txt');

const webhookSecret = (
  (fs.readFileSync(path.join(os.homedir(), '.cf-secrets.txt'), 'utf8').split(/\r?\n/).find((line) =>
    line.startsWith('TELEGRAM_WEBHOOK_SECRET=')
  ) || '').replace('TELEGRAM_WEBHOOK_SECRET=', '')
).trim();

const fingerprint = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);

/* --- 1. Токен из файла --- */
const me = await (await fetch(`https://api.telegram.org/bot${fileToken}/getMe`)).json();
if (!me.ok) {
  console.error(`✖ Токен в ~/.bot-token.txt не работает: ${me.description}`);
  console.error('  Возьмите актуальный токен у @BotFather и повторите.');
  process.exit(1);
}
console.log(`1. Токен из файла рабочий: @${me.result.username} (id ${me.result.id})`);
console.log(`   отпечаток токена: ${fingerprint(fileToken)}`);

/* --- 2. Что лежит в Cloudflare --- */
console.log('\n2. Читаю значение секрета из Cloudflare…');
let cfValue = null;
try {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/secrets`,
    { headers: { Authorization: `Bearer ${cfToken}` } }
  );
  const data = await response.json();
  if (data.success) {
    const entry = (data.result || []).find((item) => item.name === 'TELEGRAM_BOT_TOKEN');
    // Cloudflare не возвращает значение секрета — только факт наличия.
    console.log(`   TELEGRAM_BOT_TOKEN ${entry ? 'задан' : 'НЕ ЗАДАН'} (значение не читается по API)`);
  } else {
    console.log(`   не удалось прочитать список: ${JSON.stringify(data.errors)}`);
  }
} catch (error) {
  console.log(`   ошибка: ${error.message}`);
}

/* --- 3. Пишем токен из файла в Cloudflare --- */
console.log('\n3. Обновляю TELEGRAM_BOT_TOKEN в Cloudflare значением из файла…');
const put = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/secrets`,
  {
    method: 'PUT',
    headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'TELEGRAM_BOT_TOKEN', text: fileToken, type: 'secret_text' })
  }
);
const putData = await put.json();
console.log(putData.success ? '   сохранён' : `   ОШИБКА: ${JSON.stringify(putData.errors)}`);

/* --- 4. Перерегистрируем вебхук --- */
console.log('\n4. Перерегистрирую вебхук у Telegram…');
const set = await (
  await fetch(`https://api.telegram.org/bot${fileToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      secret_token: webhookSecret,
      allowed_updates: ['message', 'channel_post', 'edited_message', 'callback_query']
    })
  })
).json();
console.log(set.ok ? `   ok: ${set.description}` : `   ОШИБКА: ${set.description}`);

/* --- 5. Проверка --- */
console.log('\n5. Проверяю состояние…');
await new Promise((resolve) => setTimeout(resolve, 4000));
const info = await (await fetch(`https://api.telegram.org/bot${fileToken}/getWebhookInfo`)).json();
console.log(`   url: "${info.result.url}"`);
console.log(`   pending: ${info.result.pending_update_count}`);
console.log(
  info.result.url === WEBHOOK_URL
    ? '\n✅ Вебхук зарегистрирован — бот снова получает сообщения'
    : '\n⚠ Вебхук не установился, проверьте вручную в @BotFather'
);
