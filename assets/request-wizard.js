(() => {
  'use strict';
  const form = document.getElementById('request-wizard');
  if (!form) return;
  const $ = (id) => document.getElementById(id);
  const steps = [...form.querySelectorAll('.wizard-step')];
  const stepper = $('wizard-stepper');
  const back = $('wizard-back');
  const next = $('wizard-next');
  const submit = $('wizard-submit');
  const actions = $('request-actions');
  const error = $('request-error');
  const success = $('request-success');
  const fields = {
    fromCity: $('req-from'), toCity: $('req-to'), readyDate: $('req-date'), distance: $('req-distance'),
    cargoName: $('req-cargo-name'), cargo: $('req-cargo'), weight: $('req-weight'), volume: $('req-volume'),
    vehicle: $('req-vehicle'), loading: $('req-loading'), comment: $('req-comment'), name: $('req-name'),
    company: $('req-company'), phone: $('req-phone'), email: $('req-email')
  };
  let current = 0;
  let recommendedVehicle = '';
  const text = (value) => String(value ?? '').trim();
  const safeNumber = (value) => text(value) === '' ? undefined : Number(value);
  const dateMin = new Date(); dateMin.setMinutes(dateMin.getMinutes() - dateMin.getTimezoneOffset());
  fields.readyDate.min = dateMin.toISOString().slice(0, 10);

  function showError(message) { error.textContent = message; error.hidden = false; }
  function clearError() { error.hidden = true; error.textContent = ''; }
  function applyDraft() {
    let draft;
    try { draft = JSON.parse(sessionStorage.getItem('asmaRequestDraft') || sessionStorage.getItem('asmaCalcDraft') || 'null'); } catch { draft = null; }
    if (!draft || typeof draft !== 'object') return;
    const aliases = { fromCity: ['fromCity', 'from'], toCity: ['toCity', 'to'], readyDate: ['readyDate', 'date'], distance: ['distance', 'distanceKm', 'km'], cargoName: ['cargoName'], cargo: ['cargo'], weight: ['weight', 'weightTons'], volume: ['volume', 'volumeM3'], vehicle: ['vehicle'], loading: ['loading'], comment: ['comment'] };
    Object.entries(aliases).forEach(([key, keys]) => {
      const field = fields[key]; if (!field || field.value) return;
      const sourceKey = keys.find((item) => draft[item] !== undefined && draft[item] !== null && String(draft[item]) !== '');
      if (!sourceKey) return;
      let value = draft[sourceKey];
      if (key === 'loading') value = value === true || value === 'true' || value === '1' ? 'true' : 'false';
      if (key === 'cargo' && !['standard', 'fragile', 'temperature'].includes(value)) value = 'standard';
      field.value = String(value);
    });
    if (draft.vehicle && ![...fields.vehicle.options].some((option) => option.value === draft.vehicle || option.text === draft.vehicle)) fields.vehicle.value = '';
    sessionStorage.removeItem('asmaRequestDraft');
    recommend();
  }
  function payload() {
    const output = {};
    Object.entries(fields).forEach(([key, field]) => { if (field) output[key] = text(field.value); });
    output.distance = safeNumber(fields.distance.value);
    output.weight = safeNumber(fields.weight.value);
    output.volume = safeNumber(fields.volume.value);
    output.loading = fields.loading.value === 'true';
    output.unknownParams = $('req-unknown-params').checked;
    return output;
  }
  function recommend() {
    const weight = safeNumber(fields.weight.value);
    const box = $('vehicle-recommendation');
    if (!weight || weight < .05 || weight > 40) { box.hidden = true; recommendedVehicle = ''; return; }
    const tiers = (window.ASMA_PRICING?.WEIGHT_TIERS || []).map((tier) => ({ max: Number(tier.maxWeight), label: String(tier.vehicle || ''), note: String(tier.label || '') }));
    const item = tiers.find((tier) => weight <= tier.max);
    if (!item) { box.hidden = true; return; }
    recommendedVehicle = item.label;
    $('vehicle-recommendation-title').textContent = item.label;
    $('vehicle-recommendation-note').textContent = `${item.note}. Это предварительный подбор по весу; габариты, тип груза и фактическая доступность требуют отдельного подтверждения.`;
    box.hidden = false;
  }
  $('use-recommended-vehicle').addEventListener('click', () => { if (recommendedVehicle) fields.vehicle.value = recommendedVehicle; });
  fields.weight.addEventListener('input', recommend);
  fields.cargo.addEventListener('change', recommend);
  fields.volume.addEventListener('input', recommend);

  function setStep(index) {
    current = Math.max(0, Math.min(2, index));
    steps.forEach((section, i) => { section.hidden = i !== current; });
    [...stepper.children].forEach((item, i) => { if (i === current) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
    $('wizard-counter').textContent = `Шаг ${current + 1} из 3`;
    back.disabled = current === 0;
    next.hidden = current === 2;
    submit.hidden = current !== 2;
    if (current === 2) renderSummary();
    clearError();
  }
  function validateStep() {
    if (current === 0) {
      for (const field of [fields.fromCity, fields.toCity]) {
        if (text(field.value).length < 2) { field.focus(); showError('Укажите город отправления и город назначения.'); return false; }
      }
      if (fields.readyDate.value && fields.readyDate.value < dateMin.toISOString().slice(0,10)) { fields.readyDate.focus(); showError('Дата готовности не может быть в прошлом.'); return false; }
      const distance = safeNumber(fields.distance.value);
      if (distance !== undefined && (!Number.isFinite(distance) || distance < 1 || distance > 2500)) { fields.distance.focus(); showError('Расстояние должно быть от 1 до 2500 км или оставьте поле пустым.'); return false; }
    }
    if (current === 1) {
      const weight = safeNumber(fields.weight.value), volume = safeNumber(fields.volume.value);
      if (weight !== undefined && (!Number.isFinite(weight) || weight < .05 || weight > 40)) { fields.weight.focus(); showError('Вес должен быть в диапазоне 0,05–40 т или оставьте поле пустым.'); return false; }
      if (volume !== undefined && (!Number.isFinite(volume) || volume < .1 || volume > 120)) { fields.volume.focus(); showError('Объём должен быть в диапазоне 0,1–120 м³ или оставьте поле пустым.'); return false; }
    }
    return true;
  }
  function renderSummary() {
    const data = payload();
    const rows = [['Маршрут', `${data.fromCity} → ${data.toCity}`], ['Дата готовности', data.readyDate || 'Не указана'], ['Груз', data.cargoName || 'Не указан'], ['Вес', data.weight === undefined ? 'Уточняется' : `${data.weight} т`], ['Объём', data.volume === undefined ? 'Уточняется' : `${data.volume} м³`], ['Транспорт', data.vehicle || 'Подбор после уточнения'], ['Комментарий', data.comment || 'Нет']];
    $('request-summary-content').replaceChildren(...rows.flatMap(([label, value]) => { const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = value; return [dt, dd]; }));
  }
  next.addEventListener('click', () => { if (validateStep()) setStep(current + 1); });
  back.addEventListener('click', () => setStep(current - 1));
  form.addEventListener('keydown', (event) => { if (event.key === 'Enter' && current < 2 && event.target.tagName !== 'TEXTAREA' && event.target.tagName !== 'BUTTON') { event.preventDefault(); next.click(); } });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); clearError();
    if (!validateStep()) return;
    const data = payload();
    if (text(fields.name.value).length < 2) { fields.name.focus(); showError('Укажите контактное лицо.'); return; }
    const digits = text(fields.phone.value).replace(/\D/g, '');
    if (!(digits.length === 12 && digits.startsWith('375') || digits.length === 9 && digits.startsWith('29') || digits.length === 9 && digits.startsWith('25') || digits.length === 9 && digits.startsWith('33') || digits.length === 9 && digits.startsWith('44'))) { fields.phone.focus(); showError('Укажите действительный белорусский номер телефона.'); return; }
    if (fields.email.value && !fields.email.validity.valid) { fields.email.focus(); showError('Проверьте адрес электронной почты.'); return; }
    if (!$('req-consent').checked) { $('req-consent').focus(); showError('Подтвердите согласие на обработку данных.'); return; }
    const body = {
      name: text(fields.name.value), company: text(fields.company.value), phone: text(fields.phone.value), email: text(fields.email.value),
      fromCity: data.fromCity, toCity: data.toCity, readyDate: data.readyDate || undefined,
      distance: data.distance, weight: data.weight, volume: data.volume, cargo: data.cargo,
      vehicle: text(fields.vehicle.value), loading: data.loading,
      comment: [text(fields.cargoName.value) ? `Наименование груза: ${text(fields.cargoName.value)}` : '', text(fields.comment.value), data.unknownParams ? 'Параметры груза требуют уточнения клиентом.' : ''].filter(Boolean).join('\n'), source: 'website_smart_request'
    };
    const unknown = data.unknownParams;
    if (unknown) { delete body.weight; delete body.volume; }
    const originalText = submit.textContent; submit.disabled = true; submit.textContent = 'Отправляем…'; next.disabled = true; back.disabled = true;
    try {
      const response = await fetch('/api/lead', { method:'POST', headers:{'Content-Type':'application/json','X-Requested-With':'asma-site'}, body:JSON.stringify(body), credentials:'same-origin', cache:'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Не удалось отправить заявку. Проверьте соединение и повторите попытку.');
      $('request-success-text').textContent = `Номер заявки: ${result.leadNumber || 'присвоен'}. Сохраните номер для обращения. Представитель ASMA Lines свяжется с вами по указанным контактам после обработки заявки.`;
      success.hidden = false; actions.hidden = true; steps.forEach((section) => { section.hidden = true; }); stepper.hidden = true;
      form.querySelectorAll('input,select,textarea').forEach((field) => { field.disabled = true; });
    } catch (err) { showError(err.message || 'Заявка не отправлена. Попробуйте ещё раз.'); }
    finally { submit.disabled = false; submit.textContent = originalText; next.disabled = false; back.disabled = current === 0; }
  });
  applyDraft(); setStep(0);
})();
