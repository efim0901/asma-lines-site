/**
 * Смоук-тест авторизованного CRM-потока.
 *
 * Подписывает initData тем же алгоритмом, что и Telegram, и проходит
 * реальные запросы к локальному серверу: список заявок, смена статуса,
 * заметка, выдача доступа, печать документа.
 *
 * Запуск: node _tools/smoke-crm.mjs [baseUrl] [botToken] [adminId]
 */

import crypto from 'node:crypto';

const baseUrl = process.argv[2] || 'http://localhost:3199';
const botToken = process.argv[3] || '111111:TESTTOKENFORLOCALSMOKE';
const adminId = process.argv[4] || '1014012851';

/** Формирует initData с корректной подписью (алгоритм Telegram Web Apps). */
function signInitData(user, token) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAA',
    user: JSON.stringify(user)
  });
  const dataCheckString = Array.from(params.keys())
    .sort()
    .map((key) => `${key}=${params.get(key)}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const admin = { id: Number(adminId), first_name: 'Иван', last_name: 'Ефимович', username: 'plombit' };
const adminInit = signInitData(admin, botToken);
const strangerInit = signInitData({ id: 999999, first_name: 'Чужак', username: 'stranger' }, botToken);

let failures = 0;

async function call(path, options = {}, initData = adminInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(initData ? { 'x-telegram-init-data': initData } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 120);
  }
  return { status: response.status, body };
}

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log(`Смоук-тест CRM: ${baseUrl}\n`);

console.log('1. Посторонний пользователь');
const stranger = await call('/api/crm', {}, strangerInit);
check('отклонён с 403', stranger.status === 403, `получено ${stranger.status}`);

console.log('2. Подпись недействительна');
const forged = await call('/api/crm', {}, 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef');
check('отклонён с 401', forged.status === 401, `получено ${forged.status}`);

console.log('3. Администратор читает список');
const list = await call('/api/crm');
check('статус 200', list.status === 200, `получено ${list.status}`);
check('есть массив заявок', Array.isArray(list.body?.leads), JSON.stringify(list.body).slice(0, 120));
check('isAdmin = true', list.body?.isAdmin === true);
check('вернулось имя оператора', Boolean(list.body?.user?.name), JSON.stringify(list.body?.user));

const lead = list.body?.leads?.[0];

if (lead) {
  console.log('4. Смена статуса');
  const before = lead.status;
  const target = before === 'transit' ? 'processing' : 'transit';
  const updated = await call('/api/crm', {
    method: 'POST',
    body: JSON.stringify({ action: 'update_status', leadId: lead.id, status: target })
  });
  check('статус 200', updated.status === 200, `получено ${updated.status}`);
  const changed = updated.body?.leads?.find((item) => item.id === lead.id);
  check(`статус изменён на ${target}`, changed?.status === target, `остался ${changed?.status}`);
  check('добавлена запись в аудит', Array.isArray(changed?.notes) && changed.notes.length >= (lead.notes?.length || 0));

  console.log('5. Недопустимый статус отклоняется');
  const bad = await call('/api/crm', {
    method: 'POST',
    body: JSON.stringify({ action: 'update_status', leadId: lead.id, status: 'взломан' })
  });
  check('отклонён с 400', bad.status === 400, `получено ${bad.status}`);

  console.log('6. Попытка подменить служебные поля');
  const tamper = await call('/api/crm', {
    method: 'POST',
    body: JSON.stringify({
      action: 'update_status',
      leadId: lead.id,
      status: 'processing',
      priceValue: 1,
      leadNumber: '1',
      id: 'подменённый'
    })
  });
  const afterTamper = tamper.body?.leads?.find((item) => item.id === lead.id);
  check('id заявки не изменился', afterTamper?.id === lead.id, `стал ${afterTamper?.id}`);
  check('номер заявки не изменился', afterTamper?.leadNumber === lead.leadNumber, `стал ${afterTamper?.leadNumber}`);
  check('цена не подменена', afterTamper?.priceValue === lead.priceValue, `стала ${afterTamper?.priceValue}`);

  console.log('7. Заметка');
  const note = await call('/api/crm', {
    method: 'POST',
    body: JSON.stringify({ action: 'add_note', leadId: lead.id, note: 'Смоук-тест заметки' })
  });
  check('статус 200', note.status === 200, `получено ${note.status}`);
  const withNote = note.body?.leads?.find((item) => item.id === lead.id);
  check('заметка добавлена', withNote?.notes?.[0]?.text === 'Смоук-тест заметки', JSON.stringify(withNote?.notes?.[0]));

  console.log('8. Тикет на печать документа');
  const ticket = await call('/api/crm/doc-ticket', {
    method: 'POST',
    body: JSON.stringify({ leadId: lead.id })
  });
  check('тикет выдан', typeof ticket.body?.ticket === 'string' && ticket.body.ticket.length > 20);

  console.log('9. Печать по тикету (без initData)');
  const doc = await call(
    '/api/crm/doc-data',
    { method: 'POST', body: JSON.stringify({ leadId: lead.id, ticket: ticket.body?.ticket }) },
    null
  );
  check('документ отдан по тикету', doc.status === 200 && doc.body?.lead?.id === lead.id, `статус ${doc.status}`);

  console.log('10. Подделанный тикет');
  const forgedTicket = `${(ticket.body?.ticket || '').slice(0, -4)}AAAA`;
  const docBad = await call(
    '/api/crm/doc-data',
    { method: 'POST', body: JSON.stringify({ leadId: lead.id, ticket: forgedTicket }) },
    null
  );
  check('отклонён', docBad.status === 401, `получено ${docBad.status}`);
} else {
  console.log('  ⚠ заявок нет — шаги 4-10 пропущены (отправьте заявку через /api/lead)');
}

console.log('11. Выдача доступа диспетчеру');
const added = await call('/api/crm/access', {
  method: 'POST',
  body: JSON.stringify({ action: 'add', user: { username: 'smoke_tester', name: 'Смоук Тестер' } })
});
check('доступ выдан', added.status === 200 && added.body?.users?.some((u) => u.username === 'smoke_tester'), `статус ${added.status}`);

console.log('12. Новый диспетчер видит заявки');
const dispatcherInit = signInitData({ id: 555001, first_name: 'Смоук', username: 'smoke_tester' }, botToken);
const asDispatcher = await call('/api/crm', {}, dispatcherInit);
check('чтение разрешено', asDispatcher.status === 200, `статус ${asDispatcher.status}`);
check('но не админ', asDispatcher.body?.isAdmin === false);

console.log('13. Диспетчер не может выдавать доступ');
const denied = await call(
  '/api/crm/access',
  { method: 'POST', body: JSON.stringify({ action: 'add', user: { username: 'hacker_user' } }) },
  dispatcherInit
);
check('отклонено с 403', denied.status === 403, `получено ${denied.status}`);

console.log('14. Отзыв доступа');
const removed = await call('/api/crm/access', {
  method: 'POST',
  body: JSON.stringify({ action: 'remove', target: 'smoke_tester' })
});
check('доступ отозван', removed.status === 200 && !removed.body?.users?.some((u) => u.username === 'smoke_tester'));

console.log('15. Мастера нельзя удалить');
const keepMaster = await call('/api/crm/access', {
  method: 'POST',
  body: JSON.stringify({ action: 'remove', target: 'plombit' })
});
check('отклонено с 400', keepMaster.status === 400, `получено ${keepMaster.status}`);

console.log(`\n${failures === 0 ? 'Все проверки пройдены ✅' : `Провалено проверок: ${failures}`}`);

/*
 * Не вызываем process.exit() сразу: fetch оставляет keep-alive соединения,
 * и в Node на Windows принудительный выход в этот момент роняет процесс
 * (assertion в libuv). Даём циклу событий завершиться самому, а на случай
 * зависших сокетов оставляем аварийный таймаут.
 */
process.exitCode = failures === 0 ? 0 : 1;
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 3000).unref();

