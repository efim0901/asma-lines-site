import { describe, test, assertTrue, assertEqual } from './harness.js';
import { MemoryStore, createJsonFileStore, SCHEMA_SQL, SCHEMA_VERSION } from '../_shared/store.js';
import fs from 'node:fs';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('ASMA Lines v9 — UX contracts', () => {
  test('proposal response is non-binding and token protected', () => {
    const worker = read('_worker.js');
    const html = read('proposal.html');
    const js = read('assets/proposal.js');
    assertTrue(worker.includes("url.pathname === '/api/proposal/respond'"), 'response API exists');
    assertTrue(worker.includes('getProposalLink(tokenHash)'), 'response checks hashed proposal token');
    assertTrue(worker.includes('saveProposalResponse(tokenHash'), 'response is stored once');
    assertTrue(worker.includes('responseType') && worker.includes("'changes_requested'"), 'response types are validated');
    assertTrue(html.includes('не является акцептом оферты'), 'proposal UI states non-binding meaning');
    assertTrue(js.includes('bindProposalResponse(proposalToken)'), 'token proposal wires response controls');
  });

  test('CRM board uses existing lead statuses only', () => {
    const crm = read('assets/crm-next.js');
    const html = read('crm.html');
    assertTrue(html.includes('id="kanban-board"'), 'kanban board mount exists');
    assertTrue(crm.includes('function renderKanban(rows)'), 'kanban renderer exists');
    assertTrue(crm.includes("setItem('asma-crm-view'"), 'view preference is persisted in session');
    assertTrue(crm.includes('changeLeadStatus(leadId, column.dataset.dropStatus)'), 'drop updates status through existing mutation');
  });

  test('calculator breakdown uses current pricing model and not invented fees', () => {
    const calculator = read('assets/calculator.js');
    const pricing = read('assets/pricing-client.js');
    const html = read('calculator.html');
    assertTrue(calculator.includes('quoteDetails.breakdown'), 'calculator renders quote breakdown');
    assertTrue(pricing.includes("label: 'Подача транспорта'"), 'breakdown uses current pricing components');
    assertTrue(html.includes('действующей расчётной модели ASMA Lines'), 'disclaimer about current pricing model exists');
    assertTrue(!calculator.includes('BAF') && !calculator.includes('THC'), 'no unsupported fees introduced');
  });

  test('CRM quick reorder reuses request draft without personal data', () => {
    const crm = read('assets/crm-next.js');
    assertTrue(crm.includes('function repeatLeadDraft()'), 'repeat draft action exists');
    assertTrue(crm.includes("sessionStorage.setItem('asmaRequestDraft'"), 'draft uses existing request handoff');
    assertTrue(!crm.includes('URLSearchParams({ phone'), 'no contact data added to public URL');
  });
  test('proposal responses are stored once and included in both storage schemas', async () => {
    assertEqual(SCHEMA_VERSION, 5);
    assertTrue(SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS proposal_responses'), 'shared D1 schema contains proposal responses');
    assertTrue(read('schema.sql').includes("'schema_version', '5'"), 'remote schema version is 5');
    const tokenHash = 'hash-for-test-only';
    const store = new MemoryStore({ leads: [{ id: 'lead-1', leadNumber: '101', status: 'new', createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' }], proposalLinks: [{ token_hash: tokenHash, lead_id: 'lead-1', created_at: '2026-10-30T00:00:00.000Z', expires_at: '2026-11-30T00:00:00.000Z', revoked_at: null }] });
    assertEqual(await store.getProposalResponse(tokenHash), null);
    assertEqual(await store.saveProposalResponse(tokenHash, 'lead-1', 'interested', '', '2026-10-30T12:00:00.000Z'), true);
    assertEqual(await store.saveProposalResponse(tokenHash, 'lead-1', 'changes_requested', 'другие условия', '2026-10-30T12:01:00.000Z'), false, 'a proposal link accepts only one response');
    const saved = await store.getProposalResponse(tokenHash);
    assertEqual(saved.response_type, 'interested');
    assertTrue(read('server.js').includes("app.post('/api/proposal/respond'"), 'local server exposes proposal response API');
  });

  test('bulk import preview exposes editable row fields before submission', () => {
    const bulk = read('assets/bulk-request.js');
    assertTrue(bulk.includes("input.addEventListener('change'"), 'bulk rows have editable fields');
    assertTrue(bulk.includes('validateModel(model)'), 'edited values are revalidated');
    assertTrue(bulk.includes('bulk-confirm-check'), 'user confirmation is required before batch submission');
  });

  test('local JSON store persists a proposal response across restarts', async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'asma-proposal-response-'));
    const file = path.join(dir, 'state.json');
    try {
      const first = createJsonFileStore(file, fsPromises);
      await first.createProposalLink('token-hash-test', 'lead-1', '2026-10-30T10:00:00.000Z', '2026-11-30T10:00:00.000Z');
      assertEqual(await first.saveProposalResponse('token-hash-test', 'lead-1', 'interested', '', '2026-10-30T10:05:00.000Z'), true);
      const restarted = createJsonFileStore(file, fsPromises);
      const response = await restarted.getProposalResponse('token-hash-test');
      assertEqual(response.response_type, 'interested');
      assertEqual(response.lead_id, 'lead-1');
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

});
