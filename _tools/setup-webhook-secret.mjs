/**
 * Разовая настройка секретов вебхука Telegram.
 *
 * 1. генерирует TELEGRAM_WEBHOOK_SECRET и SETUP_TOKEN;
 * 2. регистрирует вебхук у Telegram С секретом (иначе подделать запрос может любой);
 * 3. сохраняет оба секрета в Cloudflare Worker;
 * 4. проверяет, что подпись действительно требуется.
 *
 * Секреты кладутся в C:\Users\efimo\.cf-secrets.txt (вне репозитория).
 *
 * Запуск: node _tools/setup-webhook-secret.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WORKER_NAME = 'asma-lines-site';
const WORKER_URL = 'https://asma-lines-site.firws.workers.dev';
const WEBHOOK_URL = `${WORKER_URL}/api/telegram-webhook`;

const read = (name) => fs.readFileSync(path.join(os.homedir(), name), 'utf8').trim();
const botToken = read('.bot-token.txt');
const cfToken = read('.cf-token.txt');
const accountId = read('.cf-account.txt');

/** Telegram разрешает в secret_token только A-Za-z0-9_- */
const makeSecret = () => crypto.randomBytes(32).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);

const webhookSecret = makeSecret();
const setupToken = makeSecret();
console.log(`Секреты сгенерированы: webhook=${webhookSecret.length} симв., setup=${setupToken.length} симв.`);

/* --- 1. Регистрация вебхука с секретом --- */
console.log('\nРегистрирую вебхук у Telegram с секретом…');
const setResult = await (
  await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      secret_token: webhookSecret,
      allowed_updates: ['message', 'channel_post', 'edited_message', 'callback_query']
    })
  })
).json();

if (!setResult.ok) {
  console.error('Не удалось зарегистрировать вебхук:', setResult.description);
  process.exit(1);
}
console.log(`  ok: ${setResult.description}`);

/* --- 2. Запись секретов в Cloudflare --- */
console.log('\nСохраняю секреты в Cloudflare Worker…');
for (const [name, value] of [
  ['TELEGRAM_WEBHOOK_SECRET', webhookSecret],
  ['SETUP_TOKEN', setupToken]
]) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}/secrets`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, text: value, type: 'secret_text' })
    }
  );
  const data = await response.json();
  if (!data.success) {
    console.error(`  ${name}: ОШИБКА ${JSON.stringify(data.errors)}`);
    process.exit(1);
  }
  console.log(`  ${name}: сохранён`);
}

/* --- 3. Файл с секретами (вне репозитория) --- */
const secretsFile = path.join(os.homedir(), '.cf-secrets.txt');
fs.writeFileSync(
  secretsFile,
  `# Секреты ASMA Lines — вне репозитория. Не коммитить.\nTELEGRAM_WEBHOOK_SECRET=${webhookSecret}\nSETUP_TOKEN=${setupToken}\n`,
  'utf8'
);
console.log(`\nСекреты выписаны в ${secretsFile}`);

/* --- 4. Проверка, что подпись требуется --- */
console.log('\nЖду применения (секретам нужно ~5–15 секунд)…');
let enforced = false;
for (let attempt = 1; attempt <= 8; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ update_id: 1, message: { chat: { id: 1 }, text: '/ping' } })
  });
  const status = response.status;
  console.log(`  попытка ${attempt}: подделка без секрета → HTTP ${status}`);
  if (status === 401) {
    enforced = true;
    break;
  }
}

console.log(
  enforced
    ? '\n✅ Проверка секрета включена: запросы без заголовка отбиваются с 401'
    : '\n⚠ Секрет сохранён, но проверка ещё не применилась — возможно, нужен передеплой'
);
