(() => {
  'use strict';

  const API_TIMEOUT = 15000;
  const STATUS = {
    new: 'Новая',
    processing: 'В работе',
    transit: 'В рейсе',
    completed: 'Завершена',
    cancelled: 'Отменена'
  };
  const tg = window.Telegram?.WebApp;
  const state = {
    leads: [],
    users: [],
    filter: 'new',
    query: '',
    user: null,
    isAdmin: false,
    authorized: false,
    loading: false,
    loadPromise: null,
    timer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const root = $('#crm-app');
  const list = $('#lead-list');
  const toastNode = $('#toast');
  const statusNode = $('#connection-status');
  const diagLog = $('#diag-output-console');
  const diagCount = $('#diag-leads-count');
  let toastTimer;

  function diagnostic(message, kind = 'info') {
    const time = new Date().toLocaleTimeString('ru-RU');
    console[kind === 'error' ? 'error' : 'info'](`[CRM] ${message}`);
    if (!diagLog) return;
    const line = document.createElement('div');
    line.dataset.kind = kind;
    line.textContent = `[${time}] ${message}`;
    diagLog.append(line);
    while (diagLog.childElementCount > 80) diagLog.firstElementChild.remove();
    const container = diagLog.parentElement;
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function showToast(message, error = false) {
    toastNode.textContent = message;
    toastNode.dataset.kind = error ? 'error' : 'success';
    toastNode.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastNode.classList.remove('is-visible'), 2600);
  }

  function confirmAction(message) {
    if (tg?.showConfirm) {
      return new Promise(resolve => tg.showConfirm(message, result => resolve(Boolean(result))));
    }
    return Promise.resolve(window.confirm(message));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': tg?.initData || '',
        ...(options.headers || {})
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Ошибка сервера (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setConnection(connected, message) {
    statusNode.textContent = message;
    statusNode.dataset.state = connected ? 'online' : 'offline';
  }
  function normalizedStatus(status) {
    if (status === 'in_transit') return 'transit';
    if (status === 'calculation') return 'processing';
    if (status === 'cancelled' || status === 'archived') return 'cancelled';
    return STATUS[status] ? status : 'new';
  }

  async function refresh(showMessage = false) {
    if (state.loadPromise) return state.loadPromise;
    state.loading = true;
    diagnostic('Загрузка заявок…');
    root.classList.add('is-loading');
    state.loadPromise = (async () => {
      try {
        const data = await api('/api/crm?_t=' + Date.now());
        state.leads = Array.isArray(data.leads) ? data.leads : [];
        state.users = Array.isArray(data.authorizedUsers) ? data.authorizedUsers : [];
        state.user = data.user || state.user;
        state.authorized = true;
        diagnostic(`Синхронизировано заявок: ${state.leads.length}`, 'success');
        $('#crm-loading').hidden = true;
        $('#crm-offline').hidden = true;
        $('#crm-gate').hidden = true;
        setConnection(true, 'Синхронизировано');
        render();
        if (showMessage) showToast('Заявки обновлены');
      } catch (error) {
        diagnostic(`Ошибка загрузки: ${error.message}`, 'error');
        setConnection(false, error.status === 401 ? 'Нет доступа' : 'Нет связи с базой');
        if (error.status === 401 || error.status === 403) {
          showGate(error.message);
          return;
        }
        if (!state.authorized) {
          $('#crm-loading').hidden = true;
          $('#crm-content').hidden = true;
          $('#crm-offline').hidden = false;
        }
        if (showMessage) showToast(error.message, true);
      } finally {
        state.loading = false;
        root.classList.remove('is-loading');
        state.loadPromise = null;
      }
    })();
    return state.loadPromise;
  }

  function showGate(message) {
    $('#crm-loading').hidden = true;
    $('#crm-offline').hidden = true;
    $('#crm-gate').hidden = false;
    $('#crm-content').hidden = true;
    $('#top-actions').hidden = true;
    $('#gate-message').textContent = message || 'Откройте диспетчерскую через Telegram-бот ASMA Lines.';
  }

  function counts() {
    return Object.keys(STATUS).reduce((result, status) => {
      result[status] = state.leads.filter(lead => normalizedStatus(lead.status || 'new') === status).length;
      return result;
    }, { all: state.leads.length });
  }

  function renderStats() {
    const values = counts();
    diagCount.textContent = `${values.all} заявок`;
    document.querySelectorAll('[data-count]').forEach(node => {
      node.textContent = values[node.dataset.count] ?? 0;
    });
  }

  function visibleLeads() {
    const needle = state.query.trim().toLocaleLowerCase('ru');
    return state.leads.filter(lead => {
      const status = normalizedStatus(lead.status || 'new');
      const matchesStatus = state.filter === 'all' || state.filter === status;
      const text = [lead.leadNumber, lead.name, lead.company, lead.contactName, lead.contact, lead.email, lead.route, lead.direction, lead.comment, lead.source]
        .join(' ').toLocaleLowerCase('ru');
      return matchesStatus && (!needle || text.includes(needle));
    });
  }

  function leadCard(lead, index) {
    const id = escapeHtml(lead.id);
    const status = lead.status || 'new';
    const note = Array.isArray(lead.notes) ? lead.notes[0] : null;
    const created = lead.createdAt ? new Date(lead.createdAt).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    return `<article class="lead-row" style="--row-index:${index}">
      <div class="lead-mark"><span>#${escapeHtml(lead.leadNumber || '—')}</span><i data-status="${escapeHtml(status)}"></i></div>
      <div class="lead-main">
        <div class="lead-heading"><h2>${escapeHtml(lead.name || 'Без имени')}</h2><time>${escapeHtml(created)}</time></div>
        <div class="lead-meta">${lead.company ? `<span>${escapeHtml(lead.company)}</span>` : ''}<a href="tel:${escapeHtml((lead.contact || '').replace(/[^+\d]/g, ''))}">${escapeHtml(lead.contact || 'Контакт не указан')}</a>${lead.email ? `<span>${escapeHtml(lead.email)}</span>` : ''}</div>
        <p class="lead-route">${escapeHtml(lead.route || 'Маршрут не указан')}</p>
        <div class="lead-specs">${lead.vehicle ? `<span>${escapeHtml(lead.vehicle)}</span>` : ''}${lead.weight ? `<span>${escapeHtml(lead.weight)}</span>` : ''}${lead.distance ? `<span>${escapeHtml(lead.distance)}</span>` : ''}${lead.price ? `<strong>${escapeHtml(lead.price)}</strong>` : ''}</div>
        ${lead.comment ? `<p class="lead-comment">${escapeHtml(lead.comment)}</p>` : ''}
        ${note ? `<p class="last-note"><b>${escapeHtml(note.author || 'Заметка')}:</b> ${escapeHtml(note.text)}</p>` : ''}
      </div>
      <div class="lead-actions">
        <label class="sr-only" for="status-${id}">Статус заявки ${escapeHtml(lead.leadNumber)}</label>
        <select id="status-${id}" data-action="status" data-id="${id}" aria-label="Статус заявки #${escapeHtml(lead.leadNumber)}">${Object.entries(STATUS).map(([value, label]) => `<option value="${value}" ${status === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <button class="button button--small" type="button" data-action="document" data-id="${id}">Документ</button>
        <details class="note-box"><summary title="Добавить заметку" aria-label="Добавить заметку">Заметка</summary><form data-action="note" data-id="${id}"><textarea name="note" maxlength="1200" placeholder="Заметка по заявке" required></textarea><button class="button button--small" type="submit">Сохранить</button></form></details>
        <button class="icon-button danger" type="button" data-action="delete" data-id="${id}" aria-label="Удалить заявку #${escapeHtml(lead.leadNumber)}" title="Удалить заявку">×</button>
      </div>
    </article>`;
  }

  function render() {
    renderStats();
    const rows = visibleLeads();
    list.innerHTML = rows.map(leadCard).join('');
    $('#empty-state').hidden = rows.length > 0;
    $('#lead-count').textContent = `${rows.length} ${rows.length === 1 ? 'заявка' : 'заявок'}`;
    $('#crm-content').hidden = false;
    $('#top-actions').hidden = false;
    $('#btn-access').hidden = !state.isAdmin;
    if (state.user?.name) $('#operator-name').textContent = state.user.name;
  }

  async function mutate(payload, successMessage) {
    try {
      const result = await api('/api/crm', { method: 'POST', body: JSON.stringify(payload) });
      if (Array.isArray(result.leads)) state.leads = result.leads;
      if (Array.isArray(result.authorizedUsers)) state.users = result.authorizedUsers;
      render();
      setConnection(true, 'Синхронизировано');
      showToast(successMessage);
      return true;
    } catch (error) {
      setConnection(false, 'Изменение не сохранено');
      showToast(error.message, true);
      await refresh();
      return false;
    }
  }

  async function openAccess() {
    try {
      const data = await api('/api/crm/access');
      state.users = Array.isArray(data.users) ? data.users : [];
      $('#access-list').innerHTML = state.users.map(user => `<li><span><b>${escapeHtml(user.name || 'Диспетчер')}</b><small>${escapeHtml(user.username ? '@' + user.username : user.id)}</small></span>${user.isAdmin ? '<em>Администратор</em>' : `<button class="icon-button danger" data-remove="${escapeHtml(user.username || user.id)}" aria-label="Удалить доступ">×</button>`}</li>`).join('');
      $('#access-dialog').showModal();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function bindEvents() {
    $('#status-filters').addEventListener('click', event => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      state.filter = button.dataset.filter;
      $('#status-filters').querySelectorAll('[data-filter]').forEach(node => node.setAttribute('aria-pressed', String(node === button)));
      render();
    });
    $('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
    $('#btn-refresh').addEventListener('click', () => refresh(true));
    $('#btn-retry').addEventListener('click', () => refresh(true));
    $('#btn-new').addEventListener('click', () => $('#lead-dialog').showModal());
    $('#btn-access').addEventListener('click', openAccess);
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

    $('#lead-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      const lead = {
        ...data,
        type: data.route || data.vehicle || data.weight ? 'cargo' : 'contact',
        category: data.route || data.vehicle ? 'Перевозка груза' : 'Обратная связь',
        status: 'new',
        source: 'crm_manual',
        notes: [{ id: `n-${Date.now()}`, author: state.user?.name || 'Диспетчер', text: 'Заявка создана вручную в CRM', time: new Date().toISOString() }]
      };
      if (await mutate({ action: 'create', lead }, 'Заявка создана')) {
        form.reset();
        $('#lead-dialog').close();
        state.filter = 'new';
        render();
      }
    });

    list.addEventListener('change', async event => {
      if (event.target.matches('[data-action="status"]')) {
        await mutate({ action: 'update_status', leadId: event.target.dataset.id, status: event.target.value }, 'Статус обновлён');
      }
    });
    list.addEventListener('submit', async event => {
      const form = event.target.closest('[data-action="note"]');
      if (!form) return;
      event.preventDefault();
      const note = new FormData(form).get('note').trim();
      if (note && await mutate({ action: 'add_note', leadId: form.dataset.id, note }, 'Заметка сохранена')) {
        const details = form.closest('details');
        if (details) details.open = false;
      }
    });
    list.addEventListener('click', async event => {
      const docButton = event.target.closest('[data-action="document"]');
      if (docButton) {
        const lead = state.leads.find(item => item.id === docButton.dataset.id);
        if (!lead) return;
        try {
          const result = await api('/api/crm/doc-ticket', {
            method: 'POST',
            body: JSON.stringify({ leadId: lead.id })
          });
          const leadNumber = lead.leadNumber || String(lead.id).replace(/\D/g, '').slice(-3) || '101';
          const url = new URL('/order-doc.html', location.origin);
          url.searchParams.set('id', lead.id);
          url.searchParams.set('lead', leadNumber);
          url.searchParams.set('ticket', result.ticket);
          try { sessionStorage.setItem('asma_crm_tg_init_data', tg?.initData || ''); } catch (_) {}
          if (tg?.openLink) tg.openLink(url.toString());
          else window.open(url.toString(), '_blank', 'noopener');
        } catch (error) {
          showToast(error.message, true);
        }
        return;
      }
      const button = event.target.closest('[data-action="delete"]');
      if (!button) return;
      const lead = state.leads.find(item => item.id === button.dataset.id);
      if (lead && await confirmAction(`Удалить заявку #${lead.leadNumber || ''}?`)) {
        await mutate({ action: 'delete', leadId: lead.id }, 'Заявка удалена');
      }
    });

    $('#access-form').addEventListener('submit', async event => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      try {
        const user = Object.fromEntries(formData);
        const result = await api('/api/crm/access', { method: 'POST', body: JSON.stringify({ action: 'add', user }) });
        state.users = result.users || state.users;
        event.currentTarget.reset();
        await openAccess();
        showToast('Доступ предоставлен');
      } catch (error) {
        showToast(error.message, true);
      }
    });
    $('#access-list').addEventListener('click', async event => {
      const button = event.target.closest('[data-remove]');
      if (!button || !await confirmAction(`Отозвать доступ у ${button.dataset.remove}?`)) return;
      try {
        await api('/api/crm/access', { method: 'POST', body: JSON.stringify({ action: 'remove', target: button.dataset.remove }) });
        await openAccess();
        showToast('Доступ отозван');
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  async function start() {
    tg?.ready();
    tg?.expand();
    const user = tg?.initDataUnsafe?.user;
    state.user = user ? { ...user, name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username } : null;
    state.isAdmin = String(user?.id || '') === '1014012851';
    bindEvents();
    if (!tg?.initData) {
      showGate('Откройте диспетчерскую через @asmalinesbot, чтобы подтвердить доступ.');
      return;
    }
    await refresh();
    state.timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 10000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh();
    });
  }

  start();
})();
