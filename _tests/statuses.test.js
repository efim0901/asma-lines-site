/**
 * Согласованность справочников статусов заявки.
 *
 * Раньше в _shared/core.js было два расходящихся списка: разрешённые статусы
 * не содержали `calculation` и `in_transit`, а подписи к ним — содержали.
 * Из-за этого `isValidStatus('in_transit')` возвращал false, хотя подпись
 * для такого значения выглядела рабочей.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, assertEqual, assertTrue, assertFalse } from './harness.js';
import { LEAD_STATUSES, LEAD_STATUS_NAMES, LEGACY_STATUS_ALIASES, isValidStatus } from '../_shared/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crmSource = fs.readFileSync(path.join(root, 'assets', 'crm-next.js'), 'utf8');

describe('статусы заявки', () => {
  test('подписи есть ровно у разрешённых статусов', () => {
    assertEqual(Object.keys(LEAD_STATUS_NAMES).sort(), [...LEAD_STATUSES].sort(),
      'ключи LEAD_STATUS_NAMES разошлись с LEAD_STATUSES');
  });

  test('у каждого статуса непустая подпись', () => {
    for (const status of LEAD_STATUSES) {
      assertTrue(String(LEAD_STATUS_NAMES[status] || '').trim().length > 0,
        `нет подписи для статуса ${status}`);
    }
  });

  test('устаревшие значения не считаются допустимыми', () => {
    for (const legacy of Object.keys(LEGACY_STATUS_ALIASES)) {
      assertFalse(isValidStatus(legacy), `устаревшее значение ${legacy} признано допустимым`);
      assertTrue(LEAD_STATUSES.includes(LEGACY_STATUS_ALIASES[legacy]),
        `устаревшее значение ${legacy} ведёт не в разрешённый статус`);
    }
  });

  test('устаревшие значения приводятся к каноническим в интерфейсе CRM', () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_STATUS_ALIASES)) {
      const rule = new RegExp(`status === '${legacy}'[^;]*return '${canonical}'`);
      assertTrue(rule.test(crmSource),
        `в assets/crm-next.js нет приведения ${legacy} → ${canonical}`);
    }
  });

  test('допустимые статусы проходят проверку, мусор — нет', () => {
    for (const status of LEAD_STATUSES) assertTrue(isValidStatus(status), `отвергнут статус ${status}`);
    for (const junk of ['', null, undefined, 'transit ', 'Транзит', 'new;drop']) {
      assertFalse(isValidStatus(junk), `принят недопустимый статус ${JSON.stringify(junk)}`);
    }
  });
});
