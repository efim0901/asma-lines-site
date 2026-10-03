/**
 * Тесты безопасности: то, что было сломано, не должно вернуться.
 *
 * Часть проверок — статические: они читают исходники и ищут повторное
 * появление захардкоженных секретов и обхода авторизации.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, assertEqual, assertTrue, assertFalse, assertRejects } from './harness.js';
import {
  isUserAuthorized,
  isUserAdmin,
  verifyWebhookSecret,
  createDocTicket,
  verifyDocTicket,
  readAccessConfig,
  verifyTelegramWebAppData,
  extractTelegramUser,
  requireUser
} from '../_shared/telegram.js';
import { __testables as worker } from '../_worker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Убирает комментарии перед статическим анализом.
 * Иначе тест ловит собственные пояснения вида «прежний обход asma_sess_ удалён».
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(line => line.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
    .join('\n');
}

const workerSource = stripComments(readFileSync(path.join(root, '_worker.js'), 'utf8'));
const serverSource = stripComments(readFileSync(path.join(root, 'server.js'), 'utf8'));

const config = { masterAdminUsername: 'plombit', masterAdminId: '1014012851', botToken: 'test-token', chatId: '-100' };

/** Список доступа, общий для нескольких наборов тестов. */
const accessUsers = [
  { id: '555', username: 'dispatcher', name: 'Диспетчер', isAdmin: false },
  { id: null, username: 'chief', name: 'Старший', isAdmin: true }
];

describe('Секреты не должны возвращаться в код', () => {
  test('в исходниках нет токенов Telegram', () => {
    // Токен бота выглядит как <digits>:<35 символов base64url>.
    const tokenPattern = /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/;
    assertFalse(tokenPattern.test(workerSource), 'В _worker.js найден токен Telegram');
    assertFalse(tokenPattern.test(serverSource), 'В server.js найден токен Telegram');
  });

  test('в исходниках нет прежнего публичного хранилища как места записи', () => {
    // URL может упоминаться только для разовой миграции, но не как рабочее хранилище.
    assertTrue(
      !/CLOUD_STORE_URL/.test(workerSource),
      'Worker не должен писать в публичный внешний бин'
    );
  });

  test('в исходниках нет ключа Yandex Geocoder', () => {
    assertFalse(/YANDEX_GEOCODER_KEY\s*=\s*['"]/.test(serverSource), 'Ключ геокодера должен приходить из окружения');
    assertFalse(/YANDEX_GEOCODER_KEY\s*=\s*['"]/.test(workerSource));
  });
});

describe('Обход авторизации удалён', () => {
  test('нет списка магических сессий и префикса asma_sess_', () => {
    for (const [name, source] of [['server.js', serverSource], ['_worker.js', workerSource]]) {
      assertFalse(/VALID_OPERATOR_SESSIONS/.test(source), `${name}: найден VALID_OPERATOR_SESSIONS`);
      assertFalse(/asma_sess_/.test(source), `${name}: найден обход через asma_sess_`);
      assertFalse(/x-crm-session/.test(source), `${name}: найден заголовок x-crm-session`);
    }
  });

  test('нет PIN-кодов для входа', () => {
    assertFalse(/asma_crm_login|pin\s*===\s*['"]2026/.test(workerSource), 'Найдена проверка PIN-кода');
    assertFalse(/validPins/.test(workerSource), 'Найден список PIN-кодов');
  });

  test('нет литерального ключа подписи тикетов', () => {
    assertFalse(/asma_lines_secret_key/.test(serverSource), 'server.js: найден фолбэк-ключ тикета');
    assertFalse(/asma_lines_secret_key/.test(workerSource), '_worker.js: найден фолбэк-ключ тикета');
  });
});

describe('Проверка прав доступа', () => {
  const users = accessUsers;

  test('главный администратор проходит всегда', () => {
    assertTrue(isUserAuthorized({ id: '1014012851' }, users, config));
    assertTrue(isUserAuthorized({ username: 'plombit' }, users, config));
  });

  test('обычный диспетчер из списка проходит, посторонний — нет', () => {
    assertTrue(isUserAuthorized({ id: '555' }, users, config));
    assertTrue(isUserAuthorized({ username: 'dispatcher' }, users, config));
    assertFalse(isUserAuthorized({ id: '999', username: 'stranger' }, users, config));
  });

  test('пустой пользователь не авторизован', () => {
    assertFalse(isUserAuthorized(null, users, config));
    assertFalse(isUserAuthorized({}, users, config));
  });

  test('админские права только у мастера и isAdmin-записей', () => {
    assertTrue(isUserAdmin({ id: '1014012851' }, users, config));
    assertTrue(isUserAdmin({ username: 'chief' }, users, config));
    assertFalse(isUserAdmin({ id: '555' }, users, config), 'обычный диспетчер не админ');
    assertFalse(isUserAdmin({ id: '999' }, users, config));
  });
});

describe('Секрет вебхука', () => {
  test('пока секрет не задан — проверка не enforced', () => {
    assertEqual(verifyWebhookSecret('что угодно', {}), { ok: true, enforced: false });
  });

  test('с заданным секретом неверный заголовок отклоняется', () => {
    const env = { TELEGRAM_WEBHOOK_SECRET: 's3cret-value' };
    assertEqual(verifyWebhookSecret('s3cret-value', env), { ok: true, enforced: true });
    assertEqual(verifyWebhookSecret('wrong', env).ok, false);
    assertEqual(verifyWebhookSecret('', env).ok, false);
    assertEqual(verifyWebhookSecret(undefined, env).ok, false);
  });

  test('поведение совпадает в Worker и общем модуле', () => {
    const env = { TELEGRAM_WEBHOOK_SECRET: 'abc123' };
    assertEqual(worker.verifyWebhookSecret('abc123', env), verifyWebhookSecret('abc123', env));
    assertEqual(worker.verifyWebhookSecret('nope', env), verifyWebhookSecret('nope', env));
  });
});

describe('Тикеты документов', () => {
  const store = { authorizedUsers: accessUsers };

  test('тикет нельзя создать без токена бота', async () => {
    await assertRejects(() => createDocTicket('lead-1', { id: '1014012851' }, { botToken: '' }));
  });

  test('подписанный тикет проверяется', async () => {
    const ticket = await createDocTicket('lead-1', { id: '1014012851', username: 'plombit' }, config);
    const verified = await verifyDocTicket(ticket, store, config);
    assertTrue(verified !== null, 'тикет должен проходить проверку');
    assertEqual(verified.leadId, 'lead-1');
  });

  test('подделанный тикет отклоняется', async () => {
    const ticket = await createDocTicket('lead-1', { id: '1014012851' }, config);
    const payload = JSON.parse(Buffer.from(ticket.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    payload.leadId = 'lead-999';
    const forged = Buffer.from(JSON.stringify(payload)).toString('base64url');
    assertEqual(await verifyDocTicket(forged, store, config), null, 'изменённый leadId должен ломать подпись');
  });

  test('тикет с чужим ключом не проходит', async () => {
    const ticket = await createDocTicket('lead-1', { id: '1014012851' }, config);
    const otherConfig = { ...config, botToken: 'другой-токен' };
    assertEqual(await verifyDocTicket(ticket, store, otherConfig), null);
  });

  test('просроченный тикет не проходит', async () => {
    const ticket = await createDocTicket('lead-1', { id: '1014012851' }, config);
    const payload = JSON.parse(Buffer.from(ticket.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    payload.exp = Date.now() - 1000;
    // Подпись остаётся от старого exp, поэтому проверка отклонит тикет.
    const expired = Buffer.from(JSON.stringify(payload)).toString('base64url');
    assertEqual(await verifyDocTicket(expired, store, config), null);
  });
});

describe('Чтение заголовка initData', () => {
  /**
   * Регрессия: extractTelegramUser вызывал headers.get(), но Express передаёт
   * обычный объект req.headers, где .get нет. Из-за этого авторизация молча
   * не работала ни в одном роуте, требующем requireUser.
   */
  const signedInit = async (token) => {
    const crypto = await import('node:crypto');
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'AAA',
      user: JSON.stringify({ id: '1014012851', username: 'plombit' })
    });
    const dataCheckString = Array.from(params.keys())
      .sort()
      .map((key) => `${key}=${params.get(key)}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
    return params.toString();
  };

  test('работает с объектом req.headers (Express)', async () => {
    const initData = await signedInit(config.botToken);
    const user = await extractTelegramUser({ 'x-telegram-init-data': initData }, config);
    assertTrue(user !== null, 'объект заголовков должен распознаваться');
    assertEqual(String(user.id), '1014012851');
  });

  test('работает с Headers (Cloudflare Worker)', async () => {
    const initData = await signedInit(config.botToken);
    const user = await extractTelegramUser(new Headers({ 'x-telegram-init-data': initData }), config);
    assertTrue(user !== null, 'Headers должен распознаваться');
    assertEqual(String(user.id), '1014012851');
  });

  test('requireUser пропускает авторизованного пользователя', async () => {
    const initData = await signedInit(config.botToken);
    const user = await requireUser({ 'x-telegram-init-data': initData }, { authorizedUsers: accessUsers }, config);
    assertEqual(String(user.id), '1014012851');
  });

  test('requireUser отклоняет постороннего', async () => {
    const outsiderConfig = { ...config, botToken: 'test-token' };
    const crypto = await import('node:crypto');
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'AAA',
      user: JSON.stringify({ id: '777777', username: 'stranger' })
    });
    const dataCheckString = Array.from(params.keys())
      .sort()
      .map((key) => `${key}=${params.get(key)}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(outsiderConfig.botToken).digest();
    params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));

    await assertRejects(
      () => requireUser({ 'x-telegram-init-data': params.toString() }, { authorizedUsers: accessUsers }, outsiderConfig),
      'посторонний не должен проходить'
    );
  });

  test('пустые заголовки не проходят', async () => {
    assertEqual(await extractTelegramUser({}, config), null);
    assertEqual(await extractTelegramUser(null, config), null);
    assertEqual(await extractTelegramUser(new Headers(), config), null);
  });
});

describe('Проверка initData', () => {
  test('пустые данные не проходят', async () => {
    assertEqual(await verifyTelegramWebAppData('', 'token'), null);
    assertEqual(await verifyTelegramWebAppData('user=%7B%7D', ''), null);
  });

  test('данные без подписи не проходят', async () => {
    assertEqual(await verifyTelegramWebAppData('auth_date=1&user=%7B%22id%22%3A1%7D', 'token'), null);
  });

  test('подпись, посчитанная неверным токеном, не проходит', async () => {
    const forged = 'auth_date=' + Math.floor(Date.now() / 1000) + '&user=%7B%22id%22%3A1%7D&hash=deadbeef';
    assertEqual(await verifyTelegramWebAppData(forged, 'token'), null);
  });
});

describe('Конфигурация доступа', () => {
  test('падает понятной ошибкой без MASTER_ADMIN_*', () => {
    let message = '';
    try {
      readAccessConfig({});
    } catch (error) {
      message = error.message;
    }
    assertTrue(/MASTER_ADMIN/.test(message), `ожидалась подсказка про MASTER_ADMIN, получено: ${message}`);
  });

  test('читает значения из окружения', () => {
    const parsed = readAccessConfig({
      MASTER_ADMIN_USERNAME: '@Plombit',
      MASTER_ADMIN_ID: '1014012851',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_CHAT_ID: '-100'
    });
    assertEqual(parsed.masterAdminUsername, 'plombit');
    assertEqual(parsed.masterAdminId, '1014012851');
    assertEqual(parsed.botToken, 'token');
  });
});
