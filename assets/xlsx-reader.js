/* Small dependency-free XLSX reader for trusted browser-side parsing of values only.
   It does not execute formulas, macros, external links or embedded objects. */
(() => {
  'use strict';
  const decoder = new TextDecoder('utf-8');
  function u16(view, offset) { return view.getUint16(offset, true); }
  function u32(view, offset) { return view.getUint32(offset, true); }
  function findEnd(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= start; i -= 1) if (u32(view, i) === 0x06054b50) return i;
    throw new Error('Не удалось прочитать структуру XLSX. Сохраните файл как обычный .xlsx и повторите загрузку.');
  }
  function normalizePath(base, target) {
    const parts = (target.startsWith('/') ? target.slice(1) : `${base}/${target}`).split('/');
    const out = [];
    for (const part of parts) { if (!part || part === '.') continue; if (part === '..') out.pop(); else out.push(part); }
    return out.join('/');
  }
  async function inflate(data, method, maxOutputBytes) {
    if (method === 0) {
      if (data.length > maxOutputBytes) throw new Error('В XLSX слишком много распакованных данных. Сократите книгу до 50 строк и повторите загрузку.');
      return data;
    }
    if (method !== 8) throw new Error('Этот тип сжатия XLSX не поддерживается. Откройте книгу и сохраните её как .xlsx.');
    if (typeof DecompressionStream !== 'function') throw new Error('Браузер не поддерживает безопасное чтение XLSX. Используйте CSV-шаблон или обновите браузер.');
    let stream;
    try { stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch { throw new Error('Не удалось распаковать XLSX. Попробуйте пересохранить файл в Excel или загрузить CSV.'); }
    const reader = stream.getReader(); const chunks = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxOutputBytes) { await reader.cancel().catch(() => {}); throw new Error('В XLSX слишком много распакованных данных. Сократите книгу до 50 строк и повторите загрузку.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const output = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  }
  async function unzip(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findEnd(bytes);
    const count = u16(view, end + 10), centralOffset = u32(view, end + 16);
    if (count > 3000) throw new Error('В книге слишком много файловых частей. Сохраните в новый XLSX.');
    const files = new Map(); let pos = centralOffset; let totalExpanded = 0;
    const maxPartExpanded = 12 * 1024 * 1024, maxTotalExpanded = 24 * 1024 * 1024;
    for (let i=0; i<count; i+=1) {
      if (u32(view,pos)!==0x02014b50) throw new Error('Повреждённая структура XLSX.');
      const method=u16(view,pos+10), compressed=u32(view,pos+20), uncompressed=u32(view,pos+24), nameLength=u16(view,pos+28), extraLength=u16(view,pos+30), commentLength=u16(view,pos+32), localOffset=u32(view,pos+42);
      const name=decoder.decode(bytes.slice(pos+46,pos+46+nameLength)); pos += 46+nameLength+extraLength+commentLength;
      if (!name || name.endsWith('/') || name.startsWith('../') || name.includes('/../') || name.startsWith('/')) continue;
      if (uncompressed > maxPartExpanded || totalExpanded + uncompressed > maxTotalExpanded) throw new Error('В XLSX слишком много распакованных данных. Сократите книгу до одного листа и 50 строк.');
      if (u32(view,localOffset)!==0x04034b50) throw new Error('Повреждённый файл внутри XLSX.');
      const localNameLength=u16(view,localOffset+26), localExtraLength=u16(view,localOffset+28), dataStart=localOffset+30+localNameLength+localExtraLength;
      if (dataStart + compressed > bytes.length) throw new Error('Размер части XLSX некорректен.');
      const output = await inflate(bytes.slice(dataStart,dataStart+compressed),method,Math.min(maxPartExpanded, maxTotalExpanded-totalExpanded));
      totalExpanded += output.length;
      files.set(name, output);
    }
    return files;
  }
  function xml(files, path) {
    const bytes=files.get(path); if (!bytes) return null;
    const doc=new DOMParser().parseFromString(decoder.decode(bytes),'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Не удалось прочитать XML внутри XLSX.');
    return doc;
  }
  function colIndex(reference) {
    const letters=String(reference||'').match(/^[A-Z]+/i)?.[0]?.toUpperCase()||''; let n=0;
    for (const char of letters) n=n*26+char.charCodeAt(0)-64; return Math.max(0,n-1);
  }
  async function read(file) {
    const files=await unzip(file);
    const workbook=xml(files,'xl/workbook.xml');
    if (!workbook) throw new Error('В файле не найдена книга Excel. Используйте обычный .xlsx или CSV.');
    const relDoc=xml(files,'xl/_rels/workbook.xml.rels');
    const relationships=new Map();
    relDoc?.querySelectorAll('Relationship').forEach((rel)=>relationships.set(rel.getAttribute('Id'),normalizePath('xl',rel.getAttribute('Target')||'')));
    const sharedDoc=xml(files,'xl/sharedStrings.xml');
    const shared=(sharedDoc ? [...sharedDoc.querySelectorAll('si')].map((si)=>[...si.querySelectorAll('t')].map((node)=>node.textContent||'').join('')) : []);
    const sheets=[...workbook.querySelectorAll('sheets > sheet')].map((node)=>({name:node.getAttribute('name')||'Лист',path:relationships.get(node.getAttribute('r:id'))})).filter((sheet)=>sheet.path && files.has(sheet.path));
    if (!sheets.length) throw new Error('В XLSX не найден лист с данными.');
    const parsed=sheets.map((sheet)=>{
      const doc=xml(files,sheet.path); if (!doc) return {name:sheet.name,rows:[]};
      const sparse=[];
      const sheetRows = [...doc.querySelectorAll('sheetData > row')];
      if (sheetRows.length > 51) throw new Error('В листе Excel больше 50 строк данных. Разделите книгу на части до 50 перевозок.');
      sheetRows.forEach((rowNode)=>{
        const row=[];
        rowNode.querySelectorAll('c').forEach((cell)=>{
          const ref=cell.getAttribute('r')||''; const index=colIndex(ref); if(index >= 80) throw new Error('В листе слишком много столбцов. Оставьте не более 80 столбцов.'); const formula=cell.querySelector('f');
          if (formula) { row[index]='[ФОРМУЛА НЕ ПОДДЕРЖИВАЕТСЯ]'; return; }
          const type=cell.getAttribute('t'); let value='';
          if (type==='inlineStr') value=[...cell.querySelectorAll('is t')].map((n)=>n.textContent||'').join('');
          else { const v=cell.querySelector('v'); value=v?.textContent||''; if (type==='s') value=shared[Number(value)] ?? ''; else if (type==='b') value=value==='1'?'TRUE':'FALSE'; }
          row[index]=String(value);
        });
        sparse.push(row);
      });
      const max=sparse.reduce((n,row)=>Math.max(n,row.length),0);
      return {name:sheet.name,rows:sparse.map((row)=>Array.from({length:max},(_,i)=>row[i]??''))};
    });
    return {sheets:parsed};
  }
  window.ASMAXLSX={read};
})();
