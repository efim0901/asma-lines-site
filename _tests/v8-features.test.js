/** Contract tests for ASMA Lines v8 feature wiring. These do not replace browser/API tests. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, assertEqual, assertTrue } from './harness.js';
import { rowToLead, leadToParams, SCHEMA_VERSION } from '../_shared/store.js';
import { __testables as worker } from '../_worker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

describe('ASMA Lines v8 — contract', () => {
  test('schema version and lead SQL parameters remain aligned', () => {
    assertEqual(SCHEMA_VERSION, 5);
    const lead = { id:'v8-test', leadNumber:'101', status:'new', type:'cargo', name:'Test', contact:'+375291234567', readyDate:'2026-11-05', nextAction:'Позвонить клиенту', nextActionAt:'2026-11-05T10:00:00.000Z', nextActionNote:'Уточнить условия', nextActionState:'active', createdAt:'2026-10-28T00:00:00.000Z', updatedAt:'2026-10-28T00:00:00.000Z', notes:[] };
    assertEqual(worker.leadToParams(lead).length, leadToParams(lead).length, 'Worker/shared SQL mapping length diverged');
    assertTrue(read('schema.sql').includes("'schema_version', '5'"), 'schema.sql must record schema version 5');
  });

  test('D1 row mapping includes next action fields and ready date', () => {
    const lead = rowToLead({ id:'x', lead_number:'101', status:'new', ready_date:'2026-11-05', next_action:'Позвонить клиенту', next_action_at:'2026-11-05T10:00:00.000Z', next_action_note:'Уточнить', next_action_state:'active', created_at:'2026-10-28T00:00:00.000Z', updated_at:'2026-10-28T00:00:00.000Z' });
    assertEqual(lead.readyDate, '2026-11-05');
    assertEqual(lead.nextAction, 'Позвонить клиенту');
    assertEqual(lead.nextActionState, 'active');
  });

  test('required pages, endpoints, and operational routes exist', () => {
    for (const page of ['request.html','materials.html','bulk-request.html','tracking.html','proposal.html']) assertTrue(fs.existsSync(path.join(root,page)), `missing ${page}`);
    const workerSource = read('_worker.js');
    for (const route of ['/api/leads/batch','/api/crm/tracking-link','/api/crm/proposal-link','/api/tracking','/api/proposal','/api/quote']) assertTrue(workerSource.includes(route), `missing API route ${route}`);
  });

  test('local Node server exposes the v8 API contract as well as Worker', () => {
    const server = read('server.js');
    for (const route of ["'/api/quote'", "'/api/tracking'", "'/api/proposal'", "'/api/leads/batch'", "'/api/crm/tracking-link'", "'/api/crm/proposal-link'"]) assertTrue(server.includes(route), `local server missing ${route}`);
    for (const action of ['set_next_action', 'complete_next_action', 'clear_next_action']) assertTrue(server.includes(action), `local server missing CRM action ${action}`);
  });

  test('public tracking response is deliberately limited and uncached', () => {
    const source = read('_worker.js');
    const start = source.indexOf("if (url.pathname === '/api/tracking'");
    const end = source.indexOf("if (url.pathname === '/api/", start + 20);
    const block = source.slice(start, end > start ? end : start + 5000);
    assertTrue(block.includes("'Cache-Control': 'no-store'"), 'tracking should not be cached');
    assertTrue(block.includes('fromCity') && block.includes('toCity') && block.includes('status'), 'safe summary fields missing');
    for (const forbidden of ['contact:', 'email:', 'priceValue:', 'notes:']) assertTrue(!block.includes(forbidden), `tracking leaked ${forbidden}`);
  });

  test('bulk template is blank and uses header row only', () => {
    const template = read('assets/templates/asma-bulk-template.csv').replace(/^\uFEFF/, '').trim();
    const lines = template.split(/\r?\n/);
    assertEqual(lines.length, 1, 'template must not contain a demo shipment that could be submitted accidentally');
    assertTrue(lines[0].includes('Город отправления;Город назначения'), 'template should use semicolon delimiter for common spreadsheet locale');
  });
});
