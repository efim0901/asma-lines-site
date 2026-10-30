(() => {
  'use strict';
  const form = document.getElementById('materials-checklist'); if (!form) return;
  const ids = ['mat-from','mat-to','mat-date','mat-cargo-name','mat-weight','mat-volume','mat-comment'];
  const checks = [...document.querySelectorAll('[data-check]')];
  const progress = document.getElementById('checklist-progress');
  function update() {
    const done = checks.filter((item) => item.checked).length;
    progress.textContent = `${done} из ${checks.length}`;
    const map = [['mat-from','mat-to'],['mat-date'],['mat-cargo-name'],['mat-weight'],['mat-volume'],['mat-comment']];
    map.forEach((fields, index) => { const values = fields.map((id) => document.getElementById(id)?.value.trim()).filter(Boolean); if (values.length) checks[index]?.setAttribute('data-autocomplete','true'); else checks[index]?.removeAttribute('data-autocomplete'); });
  }
  form.addEventListener('input', update); form.addEventListener('change', update);
  document.getElementById('materials-to-request')?.addEventListener('click', () => {
    const value = (id) => document.getElementById(id)?.value.trim() || '';
    const draft = { fromCity:value('mat-from'), toCity:value('mat-to'), readyDate:value('mat-date'), cargoName:value('mat-cargo-name'), weight:value('mat-weight'), volume:value('mat-volume'), comment:value('mat-comment') };
    sessionStorage.setItem('asmaRequestDraft', JSON.stringify(draft)); location.href = 'request';
  });
  document.getElementById('materials-print')?.addEventListener('click', () => window.print());
  document.getElementById('materials-reset')?.addEventListener('click', () => { form.reset(); checks.forEach((item) => item.checked = false); update(); });
  update();
})();
