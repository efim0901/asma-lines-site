(() => {
  'use strict';
  const fileInput=document.getElementById('bulk-file'); if(!fileInput)return;
  const $=(id)=>document.getElementById(id);
  const maxBytes=5*1024*1024, maxRows=50;
  const fields=[
    {key:'fromCity',label:'Город отправления',required:true,aliases:['город отправления','откуда','погрузка','город загрузки','fromcity','from']},
    {key:'toCity',label:'Город назначения',required:true,aliases:['город назначения','куда','выгрузка','город выгрузки','tocity','to']},
    {key:'readyDate',label:'Дата готовности',aliases:['дата готовности','дата','дата загрузки','readydate']},
    {key:'cargoName',label:'Наименование груза',aliases:['наименование груза','груз','наименование','cargo']},
    {key:'weight',label:'Вес, т',aliases:['вес','вес т','вес тонн','weight']},
    {key:'volume',label:'Объём, м³',aliases:['объём','объем','объём м³','объем м3','объём м3','volume']},
    {key:'cargo',label:'Тип груза',aliases:['тип груза','категория груза','cargo type']},
    {key:'loading',label:'Погрузка нужна',aliases:['погрузка нужна','нужна погрузка','погрузка','loading']},
    {key:'vehicle',label:'Тип транспорта',aliases:['тип транспорта','транспорт','vehicle']},
    {key:'comment',label:'Комментарий',aliases:['комментарий','примечание','дополнительно','comment']}
  ];
  let rawRows=[],headers=[],mapping={},rowModels=[],sourceFile='';
  function showError(message){$('bulk-error').textContent=message;$('bulk-error').hidden=false;}
  function clearError(){$('bulk-error').hidden=true;$('bulk-error').textContent='';}
  function normalizeHeader(value){return String(value||'').trim().toLocaleLowerCase('ru').replace(/[.,:;()\[\]_\-]/g,' ').replace(/\s+/g,' ');}
  function parseCsv(text){
    text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;const firstLine=text.split(/\r?\n/,1)[0]||'';const commaCount=(firstLine.match(/,/g)||[]).length;const semicolonCount=(firstLine.match(/;/g)||[]).length;const delimiter=semicolonCount>commaCount?';':',';
    for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"'){quoted=false;}else{cell+=ch;}}else if(ch==='"'&&cell===''){quoted=true;}else if(ch===delimiter){row.push(cell);cell='';}else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else{cell+=ch;}}
    if(quoted)throw new Error('В CSV обнаружена незакрытая кавычка. Проверьте файл и повторите загрузку.');
    if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
    const filtered=rows.filter((line)=>line.some((value)=>String(value||'').trim()));
    if(filtered.length>1000)throw new Error('В CSV слишком много строк. Оставьте не более 50 перевозок и повторите загрузку.');
    if(filtered.some((line)=>line.length>80))throw new Error('В CSV слишком много столбцов. Оставьте не более 80 столбцов.');
    if(filtered.some((line)=>line.some((value)=>String(value||'').length>5000)))throw new Error('Одна из ячеек CSV превышает 5000 символов. Сократите текст и повторите загрузку.');
    return filtered;
  }
  function headerGuess(head){
    const clean=normalizeHeader(head);
    // Exact header matches take precedence; broad aliases like «погрузка» must
    // never steal a column named «Погрузка нужна» from the loading field.
    for(const field of fields){if(field.aliases.some((alias)=>clean===normalizeHeader(alias)))return field.key;}
    const aliases=fields.flatMap((field)=>field.aliases.filter((alias)=>normalizeHeader(alias).length>=8).map((alias)=>({field:field.key,alias:normalizeHeader(alias)}))).sort((a,b)=>b.alias.length-a.alias.length);
    for(const item of aliases){if(clean.includes(item.alias))return item.field;}
    return '';
  }
  function setMapping(){mapping={};fields.forEach((field)=>{mapping[field.key]=headers.findIndex((header)=>headerGuess(header)===field.key);});renderMapping();renderRows();}
  function renderMapping(){const box=$('bulk-mapping-fields');box.replaceChildren();for(const field of fields){const label=document.createElement('label');label.className='tool-field';const title=document.createElement('span');title.textContent=field.label+(field.required?' *':'');const select=document.createElement('select');select.dataset.map=field.key;const none=document.createElement('option');none.value='-1';none.textContent='Не сопоставлять';select.append(none);headers.forEach((header,index)=>{const opt=document.createElement('option');opt.value=String(index);opt.textContent=`${index+1}. ${String(header||`Столбец ${index+1}`).slice(0,70)}`;select.append(opt);});select.value=String(mapping[field.key]??-1);select.addEventListener('change',()=>{mapping[field.key]=Number(select.value);renderRows();});label.append(title,select);box.append(label);}
    $('bulk-mapping').hidden=false;
  }
  function normalizeCargo(raw){const s=String(raw||'').toLocaleLowerCase('ru').trim();if(!s||/обыч|стандарт|general|standard/.test(s))return'standard';if(/хруп|fragile/.test(s))return'fragile';if(/темпера|реф|изотерм|temperature|cold|заморож/.test(s))return'temperature';return'__invalid__';}
  function normalizeLoading(raw){const s=String(raw||'').toLocaleLowerCase('ru').trim();if(!s||/^(нет|no|false|0|не нужна|не требуется)$/.test(s))return false;if(/^(да|yes|true|1|требуется|нужна|нужно)$/.test(s))return true;return '__invalid__';}
  function dateIso(raw){const s=String(raw||'').trim();if(!s)return'';if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const m=s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);if(m)return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;const n=Number(s);if(Number.isFinite(n)&&n>20000&&n<80000){const d=new Date(Date.UTC(1899,11,30)+n*86400000);return d.toISOString().slice(0,10);}return s;}
  function valueFrom(row,key){const index=mapping[key];return index===undefined||index<0?'':String(row[index]??'').trim();}
  function validateModel(obj){
    const errors=[];
    if(String(obj.fromCity||'').trim().length<2)errors.push('Укажите город отправления');
    if(String(obj.toCity||'').trim().length<2)errors.push('Укажите город назначения');
    if(String(obj.fromCity||'').length>60||String(obj.toCity||'').length>60)errors.push('Название города — максимум 60 символов');
    if(String(obj.cargoName||'').length>180)errors.push('Наименование груза слишком длинное');
    if(String(obj.comment||'').length>1500)errors.push('Комментарий должен быть не длиннее 1500 символов');
    if(obj.readyDate){const m=obj.readyDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);const d=m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3])):null;if(!m||!d||d.getUTCFullYear()!==+m[1]||d.getUTCMonth()!==+m[2]-1||d.getUTCDate()!==+m[3])errors.push('Укажите существующую дату в формате ГГГГ-ММ-ДД');}
    if(obj.weight&&(!Number.isFinite(Number(obj.weight))||Number(obj.weight)<.05||Number(obj.weight)>40))errors.push('Вес должен быть 0,05–40 т');
    if(obj.volume&&(!Number.isFinite(Number(obj.volume))||Number(obj.volume)<.1||Number(obj.volume)>120))errors.push('Объём должен быть 0,1–120 м³');
    if(obj.cargo==='__invalid__')errors.push('Неизвестный тип груза. Выберите обычный, хрупкий или температурный.');
    if(obj.loading==='__invalid__')errors.push('В колонке «Погрузка нужна» укажите да или нет.');
    if(obj.formulaError)errors.push('В формулах нужно заменить формулу готовым значением');
    obj.errors=errors;return errors;
  }
  function convert(row,rowNumber){const obj={rowNumber,fromCity:valueFrom(row,'fromCity'),toCity:valueFrom(row,'toCity'),readyDate:dateIso(valueFrom(row,'readyDate')),cargoName:valueFrom(row,'cargoName'),weight:valueFrom(row,'weight').replace(/\s/g,'').replace(',','.'),volume:valueFrom(row,'volume').replace(/\s/g,'').replace(',','.'),cargo:normalizeCargo(valueFrom(row,'cargo')),loading:normalizeLoading(valueFrom(row,'loading')),vehicle:valueFrom(row,'vehicle'),comment:valueFrom(row,'comment'),selected:true,formulaError:row.some((v)=>String(v).includes('[ФОРМУЛА НЕ ПОДДЕРЖИВАЕТСЯ]')),errors:[]};validateModel(obj);return obj;}

  function renderRows(){const body=$('bulk-preview-body');rowModels=rawRows.slice(1).filter((row)=>row.some((v)=>String(v||'').trim())).map((row,i)=>convert(row,i+2));if(rowModels.length>maxRows)rowModels=rowModels.slice(0,maxRows);body.replaceChildren();rowModels.forEach((model,index)=>{const tr=document.createElement('tr');const td=(text)=>{const cell=document.createElement('td');cell.textContent=text;tr.append(cell);return cell;};const toggleCell=document.createElement('td');const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=model.selected;toggle.disabled=model.errors.length>0;toggle.setAttribute('aria-label',`Включить строку ${model.rowNumber}`);toggle.addEventListener('change',()=>{model.selected=toggle.checked;updatePreviewSummary();});toggleCell.append(toggle);tr.append(toggleCell);td(String(model.rowNumber));
      const columns=[['fromCity','text'],['toCity','text'],['readyDate','date'],['cargoName','text'],['weight','number'],['volume','number'],['cargo','select'],['loading','select'],['vehicle','text'],['comment','text']];
      columns.forEach(([key,type])=>{const cell=document.createElement('td');let input;if(type==='select'){input=document.createElement('select');const opts=key==='cargo'?[['standard','Обычный'],['fragile','Хрупкий'],['temperature','Температурный']]:[['false','Нет'],['true','Да']];if(model[key]==='__invalid__')opts.unshift(['__invalid__','Уточнить значение']);opts.forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;input.append(o);});input.value=key==='cargo'?model[key]:String(model[key]);}else{input=document.createElement('input');input.type=type;input.value=model[key]||'';input.maxLength=key==='comment'?1500:180;if(type==='number'){input.step=key==='weight'?'.05':'.1';input.min=key==='weight'?'.05':'.1';input.max=key==='weight'?40:120;}if(type==='date')input.min=new Date().toISOString().slice(0,10);}input.addEventListener('change',()=>{model[key]=input.value;if(key==='loading')model[key]=input.value==='true';const idx=mapping[key];if(idx>=0)rawRows[index+1][idx]=input.value;validateModel(model);renderRowStatus(tr,model);toggle.disabled=model.errors.length>0;if(toggle.disabled){toggle.checked=false;model.selected=false;}updatePreviewSummary();});cell.append(input);tr.append(cell);});
      const status=document.createElement('td');status.className='bulk-row-status';tr.append(status);renderRowStatus(tr,model);body.append(tr);});$('bulk-preview-wrap').hidden=false;updatePreviewSummary();}
  function renderRowStatus(tr,model){const status=tr.querySelector('.bulk-row-status');if(!status)return;status.textContent=model.errors.length?model.errors.join('; '):'Данные выглядят корректно';status.className=`bulk-row-status ${model.errors.length?'bulk-row-error':'bulk-row-valid'}`;}
  function updatePreviewSummary(){const valid=rowModels.filter((row)=>!row.errors.length);const selected=valid.filter((row)=>row.selected);$('bulk-preview-summary').textContent=`Строк: ${rowModels.length}. Корректных: ${valid.length}. Выбрано: ${selected.length}. С ошибками: ${rowModels.length-valid.length}.`;$('bulk-submit').disabled=!selected.length||!$('bulk-confirm-check').checked||!$('bulk-contact-form').reportValidity();}
  async function loadFile(file){clearError();$('bulk-result').hidden=true;if(!file)return;if(file.size>maxBytes){showError('Файл больше 5 МБ. Уменьшите файл или разделите его на несколько загрузок.');return;}const name=file.name.toLocaleLowerCase('ru');if(!name.endsWith('.csv')&&!name.endsWith('.xlsx')){showError('Поддерживаются только .xlsx и .csv. Файлы с макросами не принимаются.');return;}sourceFile=file.name;$('bulk-file-name').textContent=`${file.name} · ${(file.size/1024).toFixed(0)} КБ`;try{let rows;if(name.endsWith('.csv')){rows=parseCsv(await file.text());$('bulk-sheet-picker-wrap').hidden=true;}else{if(!window.ASMAXLSX)throw new Error('Не загрузился модуль чтения XLSX. Обновите страницу и попробуйте ещё раз.');const book=await window.ASMAXLSX.read(file);const picker=$('bulk-sheet-picker');picker.replaceChildren();book.sheets.forEach((sheet,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=sheet.name;picker.append(option);});picker.onchange=()=>{const sheet=book.sheets[Number(picker.value)];applyRows(sheet?.rows||[]);};$('bulk-sheet-picker-wrap').hidden=book.sheets.length<2;rows=book.sheets[0].rows;}applyRows(rows);}catch(err){showError(err.message||'Не удалось прочитать файл. Попробуйте CSV-шаблон.');}}
  function applyRows(rows){if(!Array.isArray(rows)||rows.length<2){showError('В файле нужны заголовки столбцов и хотя бы одна строка перевозки.');return;}if(rows.length-1>maxRows){showError(`Найдено больше ${maxRows} строк. Разделите файл и загрузите части отдельно.`);return;}rawRows=rows;headers=(rows[0]||[]).map((v,i)=>String(v??'').trim()||`Столбец ${i+1}`);setMapping();$('bulk-preview-wrap').hidden=false;}
  $('bulk-sheet-picker').addEventListener('change',()=>{});
  fileInput.addEventListener('change',()=>loadFile(fileInput.files?.[0]));
  const drop=$('bulk-drop');drop.addEventListener('dragover',(event)=>{event.preventDefault();drop.classList.add('is-dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('is-dragging'));drop.addEventListener('drop',(event)=>{event.preventDefault();drop.classList.remove('is-dragging');const file=event.dataTransfer?.files?.[0];if(file)loadFile(file);});
  $('bulk-confirm-check').addEventListener('change',updatePreviewSummary);$('bulk-contact-form').addEventListener('input',updatePreviewSummary);
  $('bulk-recheck').addEventListener('click',()=>{rowModels.forEach((row,index)=>{validateModel(row);const tr=$('bulk-preview-body').children[index];if(tr){renderRowStatus(tr,row);const cb=tr.querySelector('input[type=checkbox]');if(cb){cb.disabled=row.errors.length>0;if(cb.disabled){cb.checked=false;row.selected=false;}}}});updatePreviewSummary();});
  async function idempotencyKeyFor(payload){
    const bytes=new TextEncoder().encode(JSON.stringify(payload));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const payloadHash=Array.from(new Uint8Array(digest)).map((n)=>n.toString(16).padStart(2,'0')).join('');
    const storageKey='asmaBulkImportRetry';
    let saved=null;
    try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
    if(saved&&saved.payloadHash===payloadHash&&/^[A-Za-z0-9_-]{20,120}$/.test(saved.key||''))return saved.key;
    const random=new Uint8Array(24);crypto.getRandomValues(random);
    const key=`bulk-${Array.from(random).map((n)=>n.toString(16).padStart(2,'0')).join('')}`;
    try{sessionStorage.setItem(storageKey,JSON.stringify({payloadHash,key}));}catch{}
    return key;
  }
  $('bulk-submit').addEventListener('click',async()=>{
    clearError();const contactForm=$('bulk-contact-form');if(!contactForm.reportValidity())return;if(!$('bulk-confirm-check').checked){showError('Подтвердите проверку выбранных строк.');return;}const selected=rowModels.filter((row)=>row.selected&&!row.errors.length);if(!selected.length){showError('Выберите хотя бы одну корректную строку.');return;}
    const contact=Object.fromEntries(new FormData(contactForm).entries());if(!contactForm.querySelector('[name=consent]').checked){showError('Подтвердите согласие на обработку данных.');return;}delete contact.consent;
    const button=$('bulk-submit');button.disabled=true;button.textContent='Создаём заявки…';
    const rows=selected.map(({rowNumber,fromCity,toCity,readyDate,cargoName,weight,volume,cargo,loading,vehicle,comment})=>({rowNumber,fromCity,toCity,readyDate,weight:weight||undefined,volume:volume||undefined,cargo,loading,vehicle,comment:[cargoName?`Наименование груза: ${cargoName}`:'',comment].filter(Boolean).join('\n'),source:'website_excel_import'}));
    const requestPayload={contact,rows};
    try{const key=await idempotencyKeyFor(requestPayload);const response=await fetch('/api/leads/batch',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'asma-site'},body:JSON.stringify({idempotencyKey:key,...requestPayload}),credentials:'same-origin',cache:'no-store'});const result=await response.json().catch(()=>({}));if(!response.ok||!result.ok)throw new Error(result.error||'Не удалось обработать пакет. Попробуйте позже.');
      const box=$('bulk-result');box.replaceChildren();const title=document.createElement('h3');title.textContent='Результат загрузки';const p=document.createElement('p');p.textContent=`Создано заявок: ${result.created||0}. Ошибок: ${result.failed||0}.`;box.append(title,p);const list=document.createElement('ul');(result.results||[]).forEach((item)=>{const li=document.createElement('li');li.textContent=item.ok?`Строка ${item.rowNumber}: заявка №${item.leadNumber} создана`:`Строка ${item.rowNumber}: ${item.error||'не удалось создать'}`;list.append(li);});box.append(list);box.hidden=false;
      if(result.created){try{sessionStorage.removeItem('asmaBulkImportRetry');}catch{}button.textContent='Пакет обработан';$('bulk-confirm-check').checked=false;$('bulk-preview-summary').textContent='Пакет обработан. Для нового импорта выберите новый файл и проверьте строки.';}
    }catch(err){showError(err.message||'Не удалось создать заявки. Проверьте соединение. Не перезагружайте страницу сразу: повтор может попасть в обработку.');}finally{if(!$('bulk-result').hidden&&button.textContent==='Пакет обработан'){}else{button.textContent='Создать выбранные заявки';updatePreviewSummary();}}
  });
})();
