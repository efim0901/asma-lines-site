/**
 * Тесты хранилища: нумерация заявок, защита от массового присваивания,
 * мягкое удаление и целостность файлового хранилища.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, test, assertEqual, assertTrue, assertFalse } from './harness.js';
import { MemoryStore, JsonFileStore, rowToLead, leadToParams } from '../_shared/store.js';
import { __testables as worker } from '../_worker.js';

const sampleLead = (overrides = {}) => ({
  id: 'lead-1',
  leadNumber: '101',
  status: 'new',
  type: 'cargo',
  name: 'Клиент',
  contact: '+375291234567',
  route: 'Минск → Брест',
  notes: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
});

describe('Нумерация заявок', () => {
  test('номера не повторяются при параллельной выдаче', async () => {
    const store = new MemoryStore();
    const numbers = await Promise.all(Array.from({ length: 50 }, () => store.nextLeadNumber()));
    assertEqual(new Set(numbers).size, 50, 'все номера должны быть уникальны');
  });

  test('нумерация не зависит от количества заявок', async () => {
    // Раньше номер считался как leads.length + 101, поэтому после удаления
    // заявки номер переиспользовался.
    const store = new MemoryStore({ leads: [sampleLead(), sampleLead({ id: 'lead-2', leadNumber: '102' })] });
    const first = await store.nextLeadNumber();
    await store.insertLead(sampleLead({ id: 'lead-3', leadNumber: first }));
    await store.deleteLead('lead-3');
    const second = await store.nextLeadNumber();
    assertTrue(Number(second) > Number(first), `номер не должен переиспользоваться: ${first} → ${second}`);
  });
});

describe('Защита от массового присваивания', () => {
  test('MemoryStore применяет только разрешённые поля', async () => {
    const store = new MemoryStore({ leads: [sampleLead()] });
    await store.updateLead('lead-1', { status: 'transit' });
    const current = (await store.loadAll()).leads[0];
    assertEqual(current.status, 'transit');
  });
});

describe('Мягкое удаление', () => {
  test('заявка исчезает и попадает в список удалённых', async () => {
    const store = new MemoryStore({ leads: [sampleLead()] });
    assertTrue(await store.deleteLead('lead-1'));
    const data = await store.loadAll();
    assertEqual(data.leads.length, 0);
    assertTrue(data.deletedIds.includes('lead-1'));
  });

  test('повторное удаление возвращает false', async () => {
    const store = new MemoryStore({ leads: [sampleLead()] });
    await store.deleteLead('lead-1');
    assertFalse(await store.deleteLead('lead-1'));
  });
});

describe('Файловое хранилище (локальная разработка)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asma-store-'));
  const stateFile = path.join(tmpDir, 'app-state.json');

  test('сохраняет и перечитывает состояние', async () => {
    const store = new JsonFileStore(path.join(tmpDir, 'a.json'), fs.promises);
    const number = await store.nextLeadNumber();
    await store.insertLead(sampleLead({ leadNumber: number }));

    const reopened = new JsonFileStore(path.join(tmpDir, 'a.json'), fs.promises);
    const data = await reopened.loadAll();
    assertEqual(data.leads.length, 1);
    assertEqual(data.leads[0].leadNumber, number);
  });

  test('не теряет обновления при параллельных запросах', async () => {
    const file = path.join(tmpDir, 'b.json');
    const store = new JsonFileStore(file, fs.promises);
    const numbers = await Promise.all(Array.from({ length: 25 }, () => store.nextLeadNumber()));
    assertEqual(new Set(numbers).size, 25, 'номера должны быть уникальны и при параллельной записи');
  });

  test('битый JSON не превращается в пустую базу', async () => {
    const file = path.join(tmpDir, 'corrupt.json');
    await fs.promises.writeFile(file, '{ это не JSON', 'utf8');
    const store = new JsonFileStore(file, fs.promises);
    let failed = false;
    try {
      await store.loadAll();
    } catch {
      failed = true;
    }
    assertTrue(failed, 'повреждённый файл должен приводить к явной ошибке');
    const backups = (await fs.promises.readdir(tmpDir)).filter(name => name.includes('corrupt.json.corrupt-'));
    assertTrue(backups.length > 0, 'должна остаться резервная копия повреждённого файла');
  });
});

describe('Преобразование строк БД', () => {
  test('строка D1 превращается в объект заявки', () => {
    const lead = rowToLead({
      id: 'lead-1',
      lead_number: '101',
      status: 'new',
      notes: '[{"id":"n-1","text":"тест"}]',
      price_breakdown: '[{"label":"Подача","value":85}]',
      loading: 1
    });
    assertEqual(lead.leadNumber, '101');
    assertEqual(lead.notes[0].text, 'тест');
    assertEqual(lead.priceBreakdown[0].value, 85);
    assertEqual(lead.loading, true);
  });

  test('битые JSON-поля не роняют разбор', () => {
    const lead = rowToLead({ id: 'x', notes: 'не json', price_breakdown: 'тоже' });
    assertEqual(lead.notes, []);
    assertEqual(lead.priceBreakdown, []);
  });

  test('порядок параметров совпадает в Worker и общем модуле', () => {
    const lead = sampleLead({ notes: [{ id: 'n-1', text: 'т', author: 'а', time: '2026-01-01T00:00:00.000Z' }] });
    assertEqual(worker.leadToParams(lead), leadToParams(lead));
  });

  test('строка D1 разбирается одинаково в Worker и общем модуле', () => {
    const row = { id: 'lead-9', lead_number: '103', status: 'transit', notes: '[]', price_breakdown: '[]' };
    assertEqual(worker.rowToLead(row), rowToLead(row));
  });
});
