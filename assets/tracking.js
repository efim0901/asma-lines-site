(() => {
  'use strict';
  const loading = document.getElementById('tracking-loading');
  const error = document.getElementById('tracking-error');
  const content = document.getElementById('tracking-content');
  if (!loading || !content) return;
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('token') || '';
  const fail = () => { loading.hidden = true; content.hidden = true; error.hidden = false; };
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) { fail(); return; }
  fetch(`/api/tracking?token=${encodeURIComponent(token)}`, { method:'GET', cache:'no-store', credentials:'omit', headers:{Accept:'application/json'} })
    .then(async (response) => { const data = await response.json().catch(() => ({})); if (!response.ok || !data.ok || !data.shipment) throw new Error('not available'); return data.shipment; })
    .then((shipment) => {
      $('tracking-number').textContent = shipment.number ? `Заявка №${shipment.number}` : 'Заявка';
      const from = String(shipment.fromCity || '').trim(), to = String(shipment.toCity || '').trim();
      $('tracking-route').textContent = from && to ? `${from} → ${to}` : from || to || 'Маршрут согласуется';
      $('tracking-status-label').textContent = shipment.status || 'Статус обновляется';
      const raw = String(shipment.status || '');
      const cancelled = raw === 'Заявка отменена';
      const stepIndex = raw === 'Заявка принята' ? 0 : raw === 'Согласование условий' ? 1 : raw === 'Перевозка в работе' ? 2 : raw === 'Доставка завершена' ? 3 : -1;
      document.querySelectorAll('.tracking-timeline__step').forEach((step, index) => {
        step.classList.toggle('is-done', stepIndex >= 0 && index < stepIndex);
        step.classList.toggle('is-current', index === stepIndex);
      });
      const cancelledNote = $('tracking-cancelled');
      if (cancelledNote) cancelledNote.hidden = !cancelled;
      const time = $('tracking-updated-at');
      const date = shipment.updatedAt ? new Date(shipment.updatedAt) : null;
      time.textContent = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(date) : 'не указано';
      time.dateTime = date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
      loading.hidden = true; error.hidden = true; content.hidden = false;
      document.title = `${$('tracking-number').textContent} — статус | ASMA Lines`;
    })
    .catch(fail);
})();
