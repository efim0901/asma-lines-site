/* КП строится только из серверного расчёта или авторизованных данных CRM. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const statusNode = $('proposal-status');
  const fmt = (n) => `${Math.round(Number(n)||0).toLocaleString('ru-RU')} BYN`;
  const text = (v) => String(v ?? '').trim();
  function status(message, isError = false) { if (!statusNode) return; statusNode.hidden = !message; statusNode.textContent = message; statusNode.dataset.kind = isError ? 'error' : 'info'; }
  function dateLabel(date = new Date()) { return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}).format(date); }
  function setLine(id, value) { const node=$(id); if(node) node.textContent=value; }
  function extractCargoName(comment) { const match=String(comment||'').match(/^Наименование груза:\s*([^\r\n]{1,180})/im); return match ? match[1].trim() : ''; }
  function renderBreakdown(quote) {
    const body=$('proposal-breakdown'); if(!body) return;
    body.replaceChildren();
    const rows=Array.isArray(quote.breakdown)?quote.breakdown:[];
    rows.forEach((item)=>{const tr=document.createElement('tr');const label=document.createElement('td');label.textContent=text(item.label)||'Статья расчёта';const rate=document.createElement('td');rate.className='tar';rate.textContent='—';const amount=document.createElement('td');amount.className='tar';amount.textContent=fmt(item.value);tr.append(label,rate,amount);body.append(tr);});
    const totalRow=document.createElement('tr');totalRow.className='kp-total-row';const totalName=document.createElement('td');totalName.colSpan=2;totalName.textContent='ИТОГО ОРИЕНТИРОВОЧНО';const total=document.createElement('td');total.className='tar';total.id='t-total';total.textContent=fmt(quote.total);totalRow.append(totalName,total);body.append(totalRow);
  }
  function showProposalResponse(existing) {
    const panel = $('proposal-response');
    if (!panel) return;
    panel.hidden = false;
    const statusLine = $('proposal-response-status');
    const buttons = panel.querySelectorAll('[data-proposal-response]');
    if (existing) {
      const labels = { interested: 'Вы подтвердили интерес к предложению.', changes_requested: 'Вы запросили корректировки предложения.' };
      if (statusLine) { statusLine.hidden = false; statusLine.textContent = `${labels[existing.response_type || existing.responseType] || 'Ответ уже получен.'} Менеджер получил информацию для дальнейшего согласования.`; }
      buttons.forEach((button) => { button.disabled = true; });
      const comment = $('proposal-response-comment');
      if (comment) { comment.disabled = true; comment.value = existing.comment || ''; }
    }
  }

  function bindProposalResponse(token) {
    const panel = $('proposal-response');
    if (!panel || !token) return;
    panel.querySelectorAll('[data-proposal-response]').forEach((button) => button.addEventListener('click', async () => {
      const responseType = button.dataset.proposalResponse;
      const comment = text($('proposal-response-comment')?.value).slice(0, 1000);
      const statusLine = $('proposal-response-status');
      if (responseType === 'changes_requested' && !comment) {
        if (statusLine) { statusLine.hidden = false; statusLine.textContent = 'Кратко опишите, что нужно уточнить или изменить.'; }
        $('proposal-response-comment')?.focus();
        return;
      }
      panel.querySelectorAll('[data-proposal-response]').forEach((item) => { item.disabled = true; });
      if (statusLine) { statusLine.hidden = false; statusLine.textContent = 'Отправляем ответ…'; }
      try {
        const result = await api('/api/proposal/respond', { method: 'POST', headers: { 'X-Requested-With': 'asma-site' }, body: JSON.stringify({ token, responseType, comment }) });
        if (!result.saved) throw new Error('Ответ не подтверждён сервером.');
        if (statusLine) statusLine.textContent = responseType === 'interested' ? 'Спасибо! Ваш интерес передан менеджеру для дальнейшего согласования.' : 'Спасибо! Запрос на корректировки передан менеджеру.';
        const input = $('proposal-response-comment'); if (input) input.disabled = true;
      } catch (error) {
        if (statusLine) statusLine.textContent = error.message || 'Не удалось отправить ответ. Попробуйте ещё раз.';
        panel.querySelectorAll('[data-proposal-response]').forEach((item) => { item.disabled = false; });
      }
    }));
  }

  function renderQuote({from,to,distance,weight,cargo,loading,quote,leadNumber,readyDate,cargoName,volume,vehicle,company,contact}) {
    const serial=String(leadNumber||'').replace(/[^0-9A-Za-z-]/g,'').slice(-12);
    const generatedAt=new Date();
    setLine('doc-num',serial?`КП по заявке № ASMA-${generatedAt.getFullYear()}-${serial}`:`Предварительный расчёт · ${generatedAt.toLocaleDateString('ru-RU')}`);
    setLine('doc-date',`Дата формирования: ${dateLabel()}`);
    setLine('route-text',from&&to?`${from} → ${to}`:'Маршрут требует уточнения');
    setLine('distance-text',distance?`Расстояние для расчёта: ${distance} км`:'Расстояние: требует уточнения');
    setLine('cargo-weight',weight?`Вес груза: ${weight} т`:'Вес груза: требует уточнения');
    const cargoLabel={standard:'Обычный груз',fragile:'Хрупкий груз',temperature:'Температурный режим'}[cargo]||'Тип груза: уточняется';
    setLine('cargo-type',[cargoLabel,cargoName?`груз: ${cargoName}`:'',volume?`объём ${volume} м³`:'',vehicle||quote?.vehicle||'',loading?'погрузка по запросу':''].filter(Boolean).join(' · '));
    setLine('client-text',company||contact||'Клиент не указан');
    if(quote){renderBreakdown(quote);status('Предварительный расчёт сформирован сервером. Итоговая стоимость и условия подтверждаются после уточнения параметров перевозки.');}
    else {const tbody=$('proposal-breakdown');tbody?.replaceChildren();const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=3;td.textContent='Стоимость требует уточнения: недостаточно подтверждённых параметров для расчёта.';tr.append(td);tbody?.append(tr);status('Недостаточно данных для расчёта. Не отправляйте этот документ как подтверждённую ставку.',true);}
    if(params.get('autoprint')==='1'&&quote)setTimeout(()=>window.print(),350);
  }
  async function api(path, options={}) {
    const initData=window.Telegram?.WebApp?.initData || sessionStorage.getItem('asma_crm_tg_init_data') || '';
    const response=await fetch(path,{...options,headers:{'Content-Type':'application/json','X-Requested-With':'asma-crm',...(initData?{'X-Telegram-Init-Data':initData}:{}),...(options.headers||{})},credentials:'same-origin',cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw new Error(data.error||`Не удалось получить данные (${response.status})`);
    return data;
  }
  async function fetchServerQuote({distance,weight,cargo,loading,volume}) {
    if(!(Number(distance)>=1&&Number(distance)<=2500&&Number(weight)>=.05&&Number(weight)<=40))return null;
    const result=await api('/api/quote',{method:'POST',headers:{'X-Requested-With':'asma-site'},body:JSON.stringify({distanceKm:Number(distance),weightTons:Number(weight),cargo,loading:Boolean(loading),volumeM3:volume?Number(volume):undefined})});
    return result.quote||null;
  }
  async function run() {
    document.querySelectorAll('.no-print-bar [data-action="print"]').forEach((b)=>b.addEventListener('click',()=>window.print()));
    const proposalToken=params.get('token');
    if(proposalToken){
      try {
        status('Получаем защищённое предложение…');
        const data=await api(`/api/proposal?token=${encodeURIComponent(proposalToken)}`,{headers:{'X-Requested-With':'asma-site'}});
        const item=data.proposal||{};
        renderQuote({from:item.fromCity||'',to:item.toCity||'',distance:item.distanceKm,weight:item.weightTons,cargo:item.cargo,loading:item.loading,quote:item.quote||null,leadNumber:item.number,readyDate:item.readyDate,cargoName:item.cargoName,volume:item.volumeM3,vehicle:item.vehicle,company:item.company,contact:''});
        showProposalResponse(item.response || null);
        bindProposalResponse(proposalToken);
      } catch(error) {
        status(error.message||'Ссылка на предложение недействительна или больше не действует.',true);
        renderQuote({from:'',to:'',quote:null});
      }
      return;
    }
    const leadId=params.get('leadId');
    if(leadId){
      try {
        status('Получаем сохранённые параметры заявки…');
        const data=await api(`/api/crm/lead/${encodeURIComponent(leadId)}`,{headers:{'X-Requested-With':'asma-crm'}});
        const lead=data.lead||{};
        let quote=null;
        if(Number.isFinite(Number(lead.priceValue))&&Number(lead.priceValue)>0){quote={total:Number(lead.priceValue),breakdown:Array.isArray(lead.priceBreakdown)?lead.priceBreakdown:[],vehicle:lead.vehicle||''};}
        else quote=await fetchServerQuote({distance:lead.distanceKm,weight:lead.weightTons,cargo:lead.cargo,loading:lead.loading,volume:lead.volumeM3});
        renderQuote({from:lead.fromCity||'',to:lead.toCity||'',distance:lead.distanceKm,weight:lead.weightTons,cargo:lead.cargo,loading:lead.loading,quote,leadNumber:lead.leadNumber,readyDate:lead.readyDate,cargoName:extractCargoName(lead.comment),volume:lead.volumeM3,vehicle:lead.vehicle,company:lead.company,contact:lead.contact});
      } catch(error){status(`${error.message}. Откройте КП из авторизованной диспетчерской.`,true);renderQuote({from:'',to:'',quote:null});}
      return;
    }
    const from=text(params.get('from')),to=text(params.get('to'));
    const distance=Number(params.get('km')||params.get('distance'));
    const weight=Number(params.get('weight'));
    const cargo=['standard','fragile','temperature'].includes(params.get('cargo'))?params.get('cargo'):'standard';
    const loading=['1','true'].includes(params.get('loading'));
    const volume=Number(params.get('volume'))||undefined;
    try {
      let quote=null;
      if(from&&to&&distance&&weight)quote=await fetchServerQuote({distance,weight,cargo,loading,volume});
      renderQuote({from,to,distance,weight,cargo,loading,quote,volume,vehicle:''});
    } catch(error){status(error.message||'Не удалось сформировать предварительный расчёт.',true);renderQuote({from,to,distance,weight,cargo,loading,quote:null,volume});}
  }
  run().catch((error)=>status(error.message||'Не удалось подготовить КП.',true));
  document.querySelectorAll('[data-action="close-window"]').forEach((button)=>button.addEventListener('click',()=>window.close()));
})();
