/**
 * Тесты браузерного входа в диспетчерскую.
 *
 * Проверяем не только счастливый путь, но и защиту: одноразовость кода,
 * ограничение выдачи кодов, срок жизни, отзыв сессий, CSRF и разбор cookie.
 * Работает всё на MemoryStore — та же логика, что в Worker'е и локальном
 * сервере, потому что модуль _shared/sessions.js общий.
 */

import { describe, test, assertEqual, assertTrue, assertFalse, assertThrows, assertRejects } from './harness.js';
import { MemoryStore } from '../_shared/store.js';
import {
  CODE_TTL_MS,
  CODES_PER_IP_LIMIT,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  authenticateOperator,
  cancelLoginCode,
  checkCsrf,
  clearedSessionCookieHeader,
  confirmLoginCode,
  describeDevice,
  describePlace,
  formatLoginCode,
  generateLoginCode,
  hashToken,
  loginState,
  logoutSession,
  normalizeLoginCode,
  parseCookies,
  sessionCookieHeader,
  startLogin
} from '../_shared/sessions.js';

const ADMIN = { id: '1014012851', username: 'plombit', first_name: 'Иван', last_name: 'Ефимович' };
const CONFIG = { masterAdminUsername: 'plombit', masterAdminId: '1014012851', botToken: 'test-token', chatId: '' };
const DEVICE = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const seedStore = () => new MemoryStore({
  authorizedUsers: [{ id: ADMIN.id, username: ADMIN.username, name: 'Иван Ефимович', role: 'Администратор', isAdmin: true }]
});

/** Заголовки запроса из браузера: cookie + защитные заголовки. */
const browserHeaders = (token, extra = {}) => ({
  cookie: `${SESSION_COOKIE}=${token}`,
  'x-requested-with': 'asma-crm',
  origin: 'https://crm.example.com',
  ...extra
});

describe('Код входа', () => {
  test('шесть цифр, форматирование и разбор', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateLoginCode();
      assertTrue(/^[1-9]\d{5}$/.test(code), `Неверный код: ${code}`);
    }
    assertEqual(formatLoginCode('482173'), '482-173');
    assertEqual(normalizeLoginCode('482-173'), '482173');
    assertEqual(normalizeLoginCode(' /login 482 173 '), '482173');
    assertEqual(normalizeLoginCode('48217'), '');
    assertEqual(normalizeLoginCode('4821739'), '');
    assertEqual(normalizeLoginCode('abcdef'), '');
  });

  test('хеш токена устойчив и не совпадает у разных токенов', async () => {
    const first = await hashToken('token-a');
    assertEqual(first, await hashToken('token-a'));
    assertTrue(first !== await hashToken('token-b'));
    assertEqual(first.length, 64);
  });

  test('выдача кода ограничена по адресу', async () => {
    const store = seedStore();
    const ip = '203.0.113.7';
    for (let i = 0; i < CODES_PER_IP_LIMIT; i += 1) {
      await startLogin({ store, ip, userAgent: DEVICE });
    }
    await assertRejects(
      () => startLogin({ store, ip, userAgent: DEVICE }),
      'Ожидался отказ после лимита кодов на адрес'
    );
    // Другой адрес не страдает от чужого лимита.
    await startLogin({ store, ip: '198.51.100.9', userAgent: DEVICE });
  });

  test('подтверждение только один раз и только до истечения срока', async () => {
    const store = seedStore();
    const started = await startLogin({ store, ip: '203.0.113.7', userAgent: DEVICE, place: 'Минск, BY' });

    const first = await confirmLoginCode({ store, code: started.code, user: ADMIN });
    assertTrue(first.ok, `Не подтвердилось: ${first.reason}`);
    const again = await confirmLoginCode({ store, code: started.code, user: ADMIN });
    assertEqual(again.reason, 'already-confirmed');

    const missing = await confirmLoginCode({ store, code: '000000', user: ADMIN });
    assertEqual(missing.reason, 'not-found');

    // Просроченный код не принимается.
    const old = await startLogin({ store, ip: '203.0.113.7', userAgent: DEVICE });
    const later = Date.now() + CODE_TTL_MS + 1000;
    const expired = await confirmLoginCode({ store, code: old.code, user: ADMIN, now: later });
    assertEqual(expired.reason, 'expired');
    const state = await loginState({ store, token: old.token, now: later });
    assertEqual(state.status, 'expired');
  });

  test('«Это не я» гасит код', async () => {
    const store = seedStore();
    const started = await startLogin({ store, ip: '203.0.113.7', userAgent: DEVICE });
    assertTrue((await cancelLoginCode({ store, code: started.code })).ok);
    assertEqual(await store.getLoginCode(started.code), null);
  });
});

describe('Выдача сессии', () => {
  test('до подтверждения статус pending, после — confirmed и cookie', async () => {
    const store = seedStore();
    const started = await startLogin({ store, ip: '203.0.113.7', userAgent: DEVICE, place: 'Минск, BY' });

    assertEqual((await loginState({ store, token: started.token })).status, 'pending');
    await confirmLoginCode({ store, code: started.code, user: ADMIN });

    const issued = await loginState({ store, token: started.token, ip: '203.0.113.7', userAgent: DEVICE });
    assertEqual(issued.status, 'confirmed');
    assertTrue(typeof issued.token === 'string' && issued.token.length > 20);
    assertEqual(issued.user.name, 'Иван Ефимович');

    // Код одноразовый: второй опрос сессии не выдаёт.
    assertEqual((await loginState({ store, token: started.token })).status, 'used');

    const session = await store.getSession(await hashToken(issued.token));
    assertEqual(session.telegramId, ADMIN.id);
    assertEqual(session.revoked, false);
    assertTrue(new Date(session.expiresAt).getTime() > Date.now() + SESSION_TTL_MS - 60000);
  });

  test('чужим токеном опроса сессию не получить', async () => {
    const store = seedStore();
    const started = await startLogin({ store, ip: '203.0.113.7', userAgent: DEVICE });
    await confirmLoginCode({ store, code: started.code, user: ADMIN });
    assertEqual((await loginState({ store, token: 'чужой-токен' })).status, 'unknown');
    assertEqual((await loginState({ store, token: started.token })).status, 'confirmed');
  });
});

describe('Cookie и CSRF', () => {
  test('cookie разбирается и защищена флагами', () => {
    assertEqual(parseCookies('a=1; asma_session=abc%3D; b=2').asma_session, 'abc=');
    assertEqual(parseCookies('').asma_session, undefined);

    const header = sessionCookieHeader('token');
    assertTrue(header.includes('HttpOnly'), 'Нет HttpOnly');
    assertTrue(header.includes('Secure'), 'Нет Secure');
    assertTrue(header.includes('SameSite=Lax'), 'Нет SameSite');
    assertTrue(header.includes(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`), 'Неверный срок cookie');
    assertTrue(clearedSessionCookieHeader().includes('Max-Age=0'), 'Нет очистки cookie');
  });

  test('изменяющие запросы требуют свой источник и заголовок', () => {
    const url = 'https://crm.example.com/api/crm';
    assertTrue(checkCsrf({ method: 'GET', headers: {}, url }).ok, 'GET должен проходить');
    assertFalse(checkCsrf({ method: 'POST', headers: {}, url }).ok, 'POST без заголовка должен отклоняться');
    assertFalse(
      checkCsrf({ method: 'POST', headers: { 'x-requested-with': 'asma-crm' }, url }).ok,
      'POST без Origin должен отклоняться'
    );
    assertFalse(
      checkCsrf({
        method: 'POST',
        headers: { 'x-requested-with': 'asma-crm', origin: 'https://evil.example.com' },
        url
      }).ok,
      'Чужой Origin должен отклоняться'
    );
    assertTrue(
      checkCsrf({
        method: 'POST',
        headers: { 'x-requested-with': 'asma-crm', origin: 'https://crm.example.com' },
        url
      }).ok,
      'Свой источник с заголовком должен проходить'
    );
  });

  test('устройство и место читаются человеку', () => {
    assertEqual(describeDevice(DEVICE), 'Chrome · Windows');
    assertEqual(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/605.1'), 'Safari · iOS');
    assertEqual(describeDevice('Mozilla/5.0 (Windows NT 10.0) YaBrowser/23.9'), 'Яндекс.Браузер · Windows');
    assertEqual(describePlace({ city: 'Минск', country: 'BY' }), 'Минск, BY');
    assertEqual(describePlace(null), '');
  });
});

describe('Доступ по сессии', () => {
  test('после подтверждения cookie пускает в CRM, после выхода — нет', async () => {
    const store = seedStore();
    const data = await store.loadAll();
    const started = await startLogin({ store, ip: '203.0.113.7', userAgent: DEVICE });
    await confirmLoginCode({ store, code: started.code, user: ADMIN });
    const issued = await loginState({ store, token: started.token });
    const token = issued.token;

    // GET с cookie — источник проверять не нужно.
    const read = await authenticateOperator({
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      method: 'GET',
      url: 'https://crm.example.com/api/crm',
      data,
      store,
      config: CONFIG
    });
    assertEqual(read.via, 'cookie');
    assertEqual(read.user.id, ADMIN.id);

    // POST без защитных заголовков — отказ.
    await assertRejects(
      () => authenticateOperator({
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
        method: 'POST',
        url: 'https://crm.example.com/api/crm',
        data,
        store,
        config: CONFIG
      }),
      'POST с cookie без X-Requested-With должен отклоняться'
    );

    // POST с заголовками — проходит.
    const write = await authenticateOperator({
      headers: browserHeaders(token),
      method: 'POST',
      url: 'https://crm.example.com/api/crm',
      data,
      store,
      config: CONFIG
    });
    assertEqual(write.user.id, ADMIN.id);

    // Выход: сессия гасится, доступ пропадает.
    await logoutSession({ store, token });
    await assertRejects(
      () => authenticateOperator({
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
        method: 'GET',
        url: 'https://crm.example.com/api/crm',
        data,
        store,
        config: CONFIG
      }),
      'После выхода сессия не должна работать'
    );
  });

  test('неизвестная и истёкшая сессия отклоняются', async () => {
    const store = seedStore();
    const data = await store.loadAll();
    await assertRejects(
      () => authenticateOperator({
        headers: browserHeaders('нет-такого-токена'),
        method: 'GET',
        url: 'https://crm.example.com/api/crm',
        data,
        store,
        config: CONFIG
      }),
      'Неизвестная сессия должна отклоняться'
    );

    const started = await startLogin({ store, ip: '203.0.113.7', userAgent: DEVICE });
    await confirmLoginCode({ store, code: started.code, user: ADMIN });
    const issued = await loginState({ store, token: started.token });
    await assertRejects(
      () => authenticateOperator({
        headers: browserHeaders(issued.token),
        method: 'GET',
        url: 'https://crm.example.com/api/crm',
        data,
        store,
        config: CONFIG,
        now: Date.now() + SESSION_TTL_MS + 1000
      }),
      'Истёкшая сессия должна отклоняться'
    );
  });

  test('отзыв доступа закрывает активные сессии', async () => {
    // Обычный диспетчер (не мастер-админ): его доступ можно отозвать.
    const dispatcher = { id: '555001', username: 'dispatcher', first_name: 'Пётр', last_name: 'Сидоров' };
    const store = new MemoryStore({
      authorizedUsers: [{ id: dispatcher.id, username: dispatcher.username, name: 'Пётр Сидоров', role: 'Диспетчер' }]
    });
    const started = await startLogin({ store, ip: '203.0.113.7', userAgent: DEVICE });
    await confirmLoginCode({ store, code: started.code, user: dispatcher });
    const issued = await loginState({ store, token: started.token });

    // Администратор отозвал доступ: список пользователей пуст.
    await store.replaceUsers([]);
    const data = await store.loadAll();
    await assertRejects(
      () => authenticateOperator({
        headers: browserHeaders(issued.token),
        method: 'GET',
        url: 'https://crm.example.com/api/crm',
        data,
        store,
        config: CONFIG
      }),
      'После отзыва доступа сессия должна отклоняться'
    );
    const session = await store.getSession(await hashToken(issued.token));
    assertTrue(session.revoked, 'Сессия должна быть помечена отозванной');
  });

  test('скользящее продление раз в 12 часов', async () => {
    const store = seedStore();
    const started = await startLogin({ store, ip: '203.0.113.7', userAgent: DEVICE });
    await confirmLoginCode({ store, code: started.code, user: ADMIN });
    const issued = await loginState({ store, token: started.token });

    const later = Date.now() + 13 * 60 * 60 * 1000;
    const auth = await authenticateOperator({
      headers: browserHeaders(issued.token),
      method: 'GET',
      url: 'https://crm.example.com/api/crm',
      data: await store.loadAll(),
      store,
      config: CONFIG,
      now: later
    });
    assertTrue(auth.sliding, 'Сессия должна продлеваться после 12 часов');
    const session = await store.getSession(await hashToken(issued.token));
    assertTrue(new Date(session.expiresAt).getTime() > later + SESSION_TTL_MS - 60000, 'Срок не продлился');
  });

  test('выход отзывает все сессии сотрудника', async () => {
    const store = seedStore();
    const tokens = [];
    for (let i = 0; i < 2; i += 1) {
      const started = await startLogin({ store, ip: `203.0.113.${i + 1}`, userAgent: DEVICE });
      await confirmLoginCode({ store, code: started.code, user: ADMIN });
      const issued = await loginState({ store, token: started.token });
      tokens.push(issued.token);
    }
    const revoked = await store.revokeUserSessions(ADMIN.id);
    assertEqual(revoked, 2);
    for (const token of tokens) {
      assertTrue((await store.getSession(await hashToken(token))).revoked, 'Сессия должна быть отозвана');
    }
  });
});
