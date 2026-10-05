/**
 * Диспетчерская ASMA Lines — клиентская логика.
 *
 * Интерфейс: разделы (фильтры) → плотный список заявок → карточка заявки.
 * Работает в двух режимах: Telegram WebApp (личность подтверждает initData)
 * и обычный браузер (сессионная cookie, выдаётся по коду через бота).
 * Данные — те же, что были в старой версии: /api/crm, /api/crm/access,
 * /api/crm/doc-ticket. Никаких «пустых» экранов: если раздел есть в меню,
 * он работает.
 */
(() => {
  'use strict';

  const API_TIMEOUT = 15000;
  /** Опрос раз в 30 секунд: 10 секунд грели базу чаще, чем нужно. */
  const POLL_INTERVAL = 30000;
  /** Заявка без ответа дольше двух часов помечается предупреждением. */
  const OVERDUE_MS = 2 * 60 * 60 * 1000;
  const NARROW_QUERY = '(max-width: 1180px)';

  const STATUS = {
    new: 'Новая',
    processing: 'В работе',
    transit: 'В рейсе',
    completed: 'Завершена',
    cancelled: 'Отменена'
  };
  const STEPS = ['new', 'processing', 'transit', 'completed'];
  const SOURCE_LABELS = {
    crm_manual: 'вручную в CRM',
    calculator: 'калькулятор',
    calculator_modal: 'калькулятор',
    site: 'сайт',
    website: 'сайт',
    telegram: 'Telegram',
    bot: 'Telegram',
    partners: 'партнёры',
    phone: 'телефон'
  };

  const tg = window.Telegram?.WebApp;
  const state = {
    leads: [],
    users: [],
    filter: 'all',
    query: '',
    user: null,
    isAdmin: false,
    authorized: false,
    selectedId: null,
    selected: null,
    tab: 'info',
    loadPromise: null,
    timer: null,
    listSignature: '',
    detailSignature: '',
    // Способ входа: telegram (WebApp) или cookie (браузер).
    via: '',
    loginToken: '',
    loginPoll: null,
    loginTimer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const root = $('#crm-app');
  const list = $('#lead-list');
  const scrim = $('#scrim');
  const detailEmpty = $('#detail-empty');
  const detailInner = $('#detail-inner');
  const toastNode = $('#toast');
  const statusNode = $('#connection-status');
  const diagLog = $('#diag-output-console');
  const diagCount = $('#diag-leads-count');
  const profileSheet = $('#profile-sheet');
  const narrow = window.matchMedia(NARROW_QUERY);
  let toastTimer;
  let searchTimer;

  /* ------------------------------ Утилиты ------------------------------ */

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
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
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
      return new Promise((resolve) => tg.showConfirm(message, (result) => resolve(Boolean(result))));
    }
    return Promise.resolve(window.confirm(message));
  }

  function plural(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function telHref(value) {
    const digits = String(value || '').replace(/[^\d+]/g, '');
    return digits.replace(/\D/g, '').length >= 6 ? `tel:${digits}` : '';
  }

  /** Ссылка на чат в Telegram — только если контакт сам является аккаунтом
      (@username или ссылка t.me). Из телефона t.me-ссылку не собираем:
      такой адрес не открывает чат. */
  function telegramHref(value) {
    const text = String(value || '').trim();
    const handle = text.match(/^@([A-Za-z0-9_]{4,32})$/);
    if (handle) return `https://t.me/${handle[1]}`;
    if (/^https?:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_]+$/.test(text)) return text;
    return '';
  }

  function normalizedStatus(status) {
    if (status === 'in_transit') return 'transit';
    if (status === 'calculation') return 'processing';
    if (status === 'cancelled' || status === 'archived') return 'cancelled';
    return STATUS[status] ? status : 'new';
  }

  function sourceLabel(lead) {
    const source = String(lead.source || '').trim();
    return SOURCE_LABELS[source] || (source ? source.replace(/[_-]+/g, ' ') : 'не указан');
  }

  function formatAge(ms) {
    const minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      const rest = minutes % 60;
      return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
    }
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? `${days} д ${restHours} ч` : `${days} д`;
  }

  function ageInfo(lead) {
    const status = normalizedStatus(lead.status);
    const created = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
    if (!created) return { text: '—', overdue: false };
    if (status === 'completed') return { text: 'закрыта', overdue: false };
    if (status === 'cancelled') return { text: 'отменена', overdue: false };
    const age = Date.now() - created;
    return { text: formatAge(age), overdue: age > OVERDUE_MS };
  }

  function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  function formatFeedTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
      ? `сегодня, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
      : date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  /* -------------------------------- API -------------------------------- */

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'asma-crm',
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
    statusNode.dataset.state = connected ? 'online' : 'offline';
    statusNode.innerHTML = '';
    const dot = document.createElement('i');
    statusNode.append(dot, message);
  }

  /* ------------------------------ Загрузка ------------------------------ */

  async function refresh(showMessage = false) {
    if (state.loadPromise) return state.loadPromise;
    root.classList.add('is-loading');
    diagnostic('Загрузка заявок…');
    state.loadPromise = (async () => {
      try {
        const data = await api('/api/crm');
        state.leads = Array.isArray(data.leads) ? data.leads : [];
        state.users = Array.isArray(data.authorizedUsers) ? data.authorizedUsers : [];
        state.user = data.user || state.user;
        state.isAdmin = Boolean(data.isAdmin);
        state.authorized = true;
        diagnostic(`Синхронизировано заявок: ${state.leads.length}`, 'success');
        $('#crm-loading').hidden = true;
        $('#crm-offline').hidden = true;
        $('#crm-gate').hidden = true;
        setConnection(true, 'Синхронизировано');
        // Способ входа нужен до отрисовки: от него зависит кнопка «Выйти».
        state.via = data.via || (tg?.initData ? 'telegram' : 'cookie');
        syncSelection();
        render(true);
        autoSelectFirst();
        if (showMessage) showToast('Заявки обновлены');
        return true;
      } catch (error) {
        diagnostic(`Ошибка загрузки: ${error.message}`, 'error');
        setConnection(false, error.status === 401 || error.status === 403 ? 'Нет доступа' : 'Нет связи с базой');
        if (error.status === 401 || error.status === 403) {
          // 403 — доступ не выдан (гейт), 401 — сессии нет (экран входа или ошибка initData в TG).
          if (error.status === 403 || tg?.initData) {
            showGate(error.message || (error.status === 401 ? 'Сессия в Telegram истекла — закройте и откройте диспетчерскую заново.' : ''));
          }
          return false;
        }
        if (!state.authorized) {
          $('#crm-loading').hidden = true;
          root.hidden = true;
          $('#crm-offline').hidden = false;
        }
        if (showMessage) showToast(error.message, true);
      } finally {
        root.classList.remove('is-loading');
        state.loadPromise = null;
      }
    })();
    return state.loadPromise;
  }

  function showGate(message) {
    stopLoginFlow();
    $('#crm-loading').hidden = true;
    $('#crm-offline').hidden = true;
    $('#crm-login').hidden = true;
    $('#crm-gate').hidden = false;
    root.hidden = true;
    $('#gate-message').textContent = message || 'Откройте диспетчерскую через Telegram-бот ASMA Lines.';
  }

  /* ------------------------ Вход с компьютера ------------------------- */

  /**
   * Браузер без сессии: показываем код и QR, ждём подтверждения в боте.
   * Пароля нет — вход подтверждает сам Telegram-аккаунт из списка доступа.
   */
  function showLogin() {
    stopLoginFlow();
    root.hidden = true;
    $('#crm-loading').hidden = true;
    $('#crm-offline').hidden = true;
    $('#crm-gate').hidden = true;
    $('#crm-login').hidden = false;
    startLoginFlow();
  }

  async function startLoginFlow() {
    stopLoginFlow();
    const statusNode = $('#login-status');
    const codeNode = $('#login-code');
    const qrNode = $('#login-qr');
    codeNode.textContent = '—';
    qrNode.hidden = true;
    qrNode.removeAttribute('src');
    statusNode.dataset.state = '';
    statusNode.textContent = 'Готовим код…';
    $('#login-timer').textContent = '';

    try {
      const data = await api('/api/login/start', { method: 'POST', body: JSON.stringify({}) });
      state.loginToken = data.token;
      codeNode.textContent = data.code;
      $('#login-hint-code').textContent = `/login ${data.code}`;
      if (data.deepLink) $('#login-open').href = data.deepLink;

      const qrUrl = new URL('/api/login/qr', location.origin);
      qrUrl.searchParams.set('token', data.token);
      qrNode.src = qrUrl.toString();
      qrNode.hidden = false;

      const expiresAt = new Date(data.expiresAt).getTime();
      statusNode.textContent = 'Ждём подтверждения в Telegram…';
      state.loginTimer = setInterval(() => {
        const left = Math.max(0, expiresAt - Date.now());
        const minutes = Math.floor(left / 60000);
        const seconds = Math.floor((left % 60000) / 1000);
        $('#login-timer').textContent = left > 0
          ? `действует ${minutes}:${String(seconds).padStart(2, '0')}`
          : 'код истёк';
      }, 500);
      state.loginPoll = setInterval(pollLogin, 2500);
      diagnostic('Выдан код входа для браузерной версии');
    } catch (error) {
      statusNode.dataset.state = 'error';
      statusNode.textContent = error.message;
    }
  }

  async function pollLogin() {
    if (!state.loginToken) return;
    try {
      const data = await api(`/api/login/status?token=${encodeURIComponent(state.loginToken)}`);
      if (data.status === 'confirmed') {
        stopLoginFlow();
        const statusNode = $('#login-status');
        statusNode.dataset.state = 'ok';
        statusNode.textContent = 'Вход подтверждён — открываем диспетчерскую…';
        diagnostic('Вход подтверждён в боте', 'success');
        setTimeout(() => location.reload(), 600);
        return;
      }
      if (['expired', 'used', 'unknown'].includes(data.status)) {
        stopLoginFlow();
        const statusNode = $('#login-status');
        statusNode.dataset.state = 'error';
        statusNode.textContent = 'Код больше не действует — нажмите «Новый код».';
      }
    } catch {
      /* сеть моргнула — следующий опрос повторит */
    }
  }

  function stopLoginFlow() {
    clearInterval(state.loginPoll);
    clearInterval(state.loginTimer);
    state.loginPoll = null;
    state.loginTimer = null;
    state.loginToken = '';
  }

  /** На широком экране карточка живёт рядом со списком: пустой блок справа
      выглядит поломкой, поэтому сразу показываем первую заявку очереди. */
  function autoSelectFirst() {
    if (state.selectedId || narrow.matches) return;
    const first = visibleLeads()[0];
    if (first) selectLead(first.id, false);
  }

  function syncSelection() {
    if (!state.selectedId) {
      state.selected = null;
      return;
    }
    state.selected = state.leads.find((lead) => lead.id === state.selectedId) || null;
    if (!state.selected) state.selectedId = null;
  }

  async function mutate(payload, successMessage) {
    try {
      const result = await api('/api/crm', { method: 'POST', body: JSON.stringify(payload) });
      if (Array.isArray(result.leads)) state.leads = result.leads;
      if (Array.isArray(result.authorizedUsers)) state.users = result.authorizedUsers;
      syncSelection();
      setConnection(true, 'Синхронизировано');
      render(true);
      showToast(successMessage);
      return true;
    } catch (error) {
      setConnection(false, 'Изменение не сохранено');
      showToast(error.message, true);
      await refresh();
      return false;
    }
  }

  /* ------------------------------- Выборка ------------------------------ */

  function counts() {
    const result = { all: state.leads.length };
    for (const status of Object.keys(STATUS)) result[status] = 0;
    for (const lead of state.leads) {
      const status = normalizedStatus(lead.status);
      result[status] = (result[status] || 0) + 1;
    }
    return result;
  }

  function visibleLeads() {
    const needle = state.query.trim().toLocaleLowerCase('ru');
    return state.leads
      .filter((lead) => {
        const status = normalizedStatus(lead.status);
        if (state.filter !== 'all' && state.filter !== status) return false;
        if (!needle) return true;
        const text = [
          lead.leadNumber, lead.name, lead.company, lead.contact, lead.email,
          lead.route, lead.fromCity, lead.toCity, lead.distance, lead.vehicle,
          lead.weight, lead.comment, lead.dispatcher, sourceLabel(lead)
        ].join(' ').toLocaleLowerCase('ru');
        return text.includes(needle);
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  function overdueLeads() {
    return state.leads
      .map((lead) => ({ lead, age: ageInfo(lead) }))
      .filter((item) => item.age.overdue && ['new', 'processing'].includes(normalizedStatus(item.lead.status)))
      .sort((a, b) => new Date(a.lead.createdAt || 0) - new Date(b.lead.createdAt || 0));
  }

  /* ------------------------------- Отрисовка ---------------------------- */

  function render(force = false) {
    renderCounts();
    renderList(force);
    renderDetail(force);
    renderOperator();
  }

  function renderCounts() {
    const values = counts();
    diagCount.textContent = `${values.all} ${plural(values.all, 'заявка', 'заявки', 'заявок')}`;
    document.querySelectorAll('[data-count]').forEach((node) => {
      node.textContent = values[node.dataset.count] ?? 0;
    });
    document.querySelectorAll('#mobile-filters .chips__item').forEach((node) => {
      const count = node.querySelector('span');
      if (count) count.textContent = values[node.dataset.filter] ?? 0;
    });
    renderAlert();
  }

  function renderAlert() {
    const node = $('#side-alert');
    const items = overdueLeads();
    if (!items.length) {
      node.hidden = true;
      return;
    }
    const title = `${items.length} ${plural(items.length, 'заявка ждёт', 'заявки ждут', 'заявок ждут')} ответа`;
    const list = items.slice(0, 3).map(({ lead, age }) => `№${escapeHtml(lead.leadNumber || '—')} — ${escapeHtml(age.text)}`);
    node.innerHTML = `<b>⚠ ${title}</b>${list.join(', ')}${items.length > 3 ? ` и ещё ${items.length - 3}` : ''}`;
    node.hidden = false;
  }

  function rowHtml(lead) {
    const status = normalizedStatus(lead.status);
    const client = lead.name || lead.company || 'Без имени';
    const company = lead.company && lead.company !== client ? lead.company : '';
    const sub = [company, lead.contact].filter(Boolean).join(' · ');
    const route = lead.route || [lead.fromCity, lead.toCity].filter(Boolean).join(' → ');
    const specs = [lead.distance, lead.weight, lead.cargo].filter(Boolean).join(' · ');
    const age = ageInfo(lead);
    const tel = telHref(lead.contact);
    const selected = state.selectedId === lead.id;
    return `<article class="row" role="listitem" tabindex="0" data-id="${escapeHtml(lead.id)}" aria-selected="${selected}">
      <div class="row__head">
        <div class="row__num">№${escapeHtml(lead.leadNumber || '—')}<small>${escapeHtml(sourceLabel(lead))}</small></div>
        <div class="row__status"><span class="chip" data-status="${status}"><i></i>${STATUS[status]}</span></div>
      </div>
      <div class="row__client"><b>${escapeHtml(client)}</b><span>${escapeHtml(sub || 'контакт не указан')}</span></div>
      <div class="row__lower">
        <div class="row__route">${escapeHtml(route || 'маршрут не указан')}<span>${escapeHtml(specs)}</span></div>
        <div class="row__price">${escapeHtml(lead.price || '—')}</div>
      </div>
      <div class="row__dispatcher"><b class="${lead.dispatcher ? '' : 'is-empty'}" title="${escapeHtml(lead.dispatcher || 'Диспетчер не назначен')}">${escapeHtml(lead.dispatcher || 'не назначен')}</b></div>
      <div class="row__age"><span class="age ${age.overdue ? 'age--overdue' : ''}">${escapeHtml(age.text)}</span></div>
      <div class="row__quick">
        ${tel ? `<a class="call" href="${tel}" title="Позвонить" aria-label="Позвонить: ${escapeHtml(client)}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h3.5l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.7 1.5C11.4 19.9 4.1 12.6 3.5 5.7A1.5 1.5 0 0 1 5 4Z"></path></svg></a>` : ''}
        <button class="open" type="button" data-open aria-label="Открыть карточку">›</button>
      </div>
    </article>`;
  }

  function renderList(force = false) {
    const rows = visibleLeads();
    const signature = `${state.filter}|${state.query}|${rows.map((lead) => `${lead.id}:${lead.updatedAt || lead.createdAt || ''}:${lead.status}:${lead.dispatcher || ''}`).join(',')}`;
    if (!force && signature === state.listSignature) {
      markSelectedRow();
      return;
    }
    state.listSignature = signature;
    list.innerHTML = rows.map(rowHtml).join('');
    $('#empty-state').hidden = rows.length > 0;
  }

  function markSelectedRow() {
    list.querySelectorAll('.row').forEach((row) => {
      row.setAttribute('aria-selected', String(row.dataset.id === state.selectedId));
    });
  }

  function stepState(status, step) {
    if (status === 'cancelled') return '';
    const index = STEPS.indexOf(status);
    const position = STEPS.indexOf(step);
    if (index < 0) return '';
    if (position < index) return 'done';
    return position === index ? 'current' : '';
  }

  function factsHtml(lead) {
    const client = lead.name || lead.company || 'Без имени';
    const tel = telHref(lead.contact);
    const telegram = telegramHref(lead.contact);
    const route = lead.route || [lead.fromCity, lead.toCity].filter(Boolean).join(' → ');
    const rows = [
      ['Клиент', escapeHtml(client) + (lead.company && lead.company !== client ? ` · ${escapeHtml(lead.company)}` : '')],
      ['Телефон', tel
        ? `<a href="${tel}">${escapeHtml(lead.contact)}</a>`
        : `<span class="is-empty">${escapeHtml(lead.contact || 'не указан')}</span>`],
      telegram ? ['Telegram', `<a href="${telegram}" target="_blank" rel="noopener">${escapeHtml(lead.contact)}</a>`] : null,
      ['Email', lead.email ? `<a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>` : '<span class="is-empty">не указан</span>'],
      ['Маршрут', escapeHtml(route || 'не указан')],
      ['Расстояние', escapeHtml(lead.distance || 'не рассчитано')],
      ['Груз', escapeHtml([lead.weight, lead.cargo].filter(Boolean).join(' · ') || 'не указан')],
      ['Транспорт', escapeHtml(lead.vehicle || 'не выбран')],
      ['Ставка', escapeHtml(lead.price || 'не рассчитана')],
      ['Источник', escapeHtml(sourceLabel(lead))],
      ['Диспетчер', lead.dispatcher ? escapeHtml(lead.dispatcher) : '<span class="is-empty">не назначен</span>'],
      ['Создана', escapeHtml(formatDateTime(lead.createdAt) || '—')]
    ].filter(Boolean);
    const comment = lead.comment
      ? `<div class="fact"><dt>Комментарий</dt><dd>${escapeHtml(lead.comment)}</dd></div>`
      : '';
    return `<dl class="facts">${rows.map(([term, value]) => `<div class="fact"><dt>${term}</dt><dd>${value}</dd></div>`).join('')}${comment}</dl>`;
  }

  function feedHtml(lead) {
    const notes = Array.isArray(lead.notes) ? lead.notes.slice(0, 40) : [];
    if (!notes.length) {
      return '<p style="color:var(--muted);font-size:12px">Записей пока нет: история появится после первой заметки или смены статуса.</p>';
    }
    return `<ul class="feed">${notes.map((note) => `
      <li ${/Статус изменён/i.test(note.text || '') ? 'data-kind="status"' : ''}>
        <div class="feed__meta"><b>${escapeHtml(note.author || 'Система')}</b><time>${escapeHtml(formatFeedTime(note.time))}</time></div>
        <p>${escapeHtml(note.text || '')}</p>
      </li>`).join('')}</ul>`;
  }

  function detailHtml(lead) {
    const status = normalizedStatus(lead.status);
    const client = lead.name || lead.company || 'Без имени';
    const tel = telHref(lead.contact);
    const telegram = telegramHref(lead.contact);
    const mine = state.user?.name && lead.dispatcher && lead.dispatcher === state.user.name;
    const canClaim = !lead.dispatcher && ['new', 'processing'].includes(status);
    const canCancel = !['completed', 'cancelled'].includes(status);
    const subtitle = `Заявка №${escapeHtml(lead.leadNumber || '—')} · ${escapeHtml(sourceLabel(lead))} · создана ${escapeHtml(formatDateTime(lead.createdAt) || '—')}`;
    const tabs = [
      ['info', 'Заявка'],
      ['feed', 'История'],
      ['docs', 'Документы']
    ];
    return `
      <div class="detail__head">
        <div class="detail__title">
          <div>
            <h2>${escapeHtml(client)}</h2>
            <p>${subtitle}</p>
          </div>
          <button class="detail__close" type="button" data-action="close" aria-label="Закрыть карточку">✕</button>
        </div>
        <div class="steps" role="group" aria-label="Этапы заявки">
          ${STEPS.map((step) => `<button class="step" type="button" data-status="${step}" data-state="${stepState(status, step)}"><span class="step__bar"></span><span class="step__label">${STATUS[step]}</span></button>`).join('')}
        </div>
        ${status === 'cancelled' ? '<p class="detail__note" data-kind="cancelled">Заявка отменена — вернуть её в работу можно кнопкой этапа выше.</p>' : ''}
        ${mine ? '<p class="detail__note">Веду эту заявку я</p>' : ''}
      </div>
      <div class="tabs" role="tablist">
        ${tabs.map(([id, label]) => `<button class="tab" type="button" role="tab" data-tab="${id}" aria-selected="${String(state.tab === id)}">${label}</button>`).join('')}
      </div>
      <div class="detail__body">
        <div class="panel" data-panel="info" ${state.tab === 'info' ? '' : 'hidden'}>
          ${factsHtml(lead)}
          <div class="section-title">Действия</div>
          <div class="actions">
            ${tel ? `<a class="btn" href="${tel}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h3.5l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.7 1.5C11.4 19.9 4.1 12.6 3.5 5.7A1.5 1.5 0 0 1 5 4Z"></path></svg>Позвонить</a>` : ''}
            ${telegram ? `<a class="btn" href="${telegram}" target="_blank" rel="noopener">Написать</a>` : ''}
            ${canClaim ? '<button class="btn" type="button" data-action="claim">Взять в работу</button>' : ''}
            ${canCancel ? '<button class="btn" type="button" data-action="cancel">Отменить</button>' : ''}
            <button class="btn btn--wide" type="button" data-action="document">Договор-заявка</button>
            <button class="btn btn--wide btn--danger" type="button" data-action="delete">Удалить заявку</button>
          </div>
        </div>
        <div class="panel" data-panel="feed" ${state.tab === 'feed' ? '' : 'hidden'}>
          ${feedHtml(lead)}
          <form class="note-form" id="note-form">
            <textarea name="note" maxlength="1200" placeholder="Добавить заметку по заявке" aria-label="Новая заметка"></textarea>
            <button class="btn btn--primary" type="submit">Сохранить заметку</button>
          </form>
        </div>
        <div class="panel" data-panel="docs" ${state.tab === 'docs' ? '' : 'hidden'}>
          <dl class="facts">
            <div class="fact"><dt>Договор-заявка</dt><dd>формируется из данных заявки, клиент получает ссылку в Telegram</dd></div>
          </dl>
          <div class="section-title">Создать</div>
          <div class="actions">
            <button class="btn btn--wide" type="button" data-action="document">Открыть договор-заявку</button>
          </div>
        </div>
      </div>`;
  }

  function renderDetail(force = false) {
    const lead = state.selected;
    if (!lead) {
      state.detailSignature = '';
      detailEmpty.hidden = false;
      detailInner.hidden = true;
      detailInner.innerHTML = '';
      return;
    }
    const signature = `${lead.id}|${lead.status}|${lead.dispatcher || ''}|${(lead.notes || []).length}|${lead.updatedAt || ''}|${state.tab}`;
    if (!force && signature === state.detailSignature) return;
    state.detailSignature = signature;
    detailEmpty.hidden = true;
    detailInner.hidden = false;
    detailInner.innerHTML = detailHtml(lead);
  }

  function renderOperator() {
    const name = state.user?.name || state.user?.username || 'Диспетчер';
    const role = state.isAdmin ? 'администратор' : 'диспетчер';
    const initials = name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'A';
    $('#operator-name').textContent = name;
    $('#operator-role').textContent = role;
    $('#user-avatar').textContent = initials;
    $('#profile-name').textContent = name;
    $('#profile-role').textContent = `${role} · ${tg?.initData ? 'Telegram WebApp' : 'браузер'}`;
    $('#profile-avatar').textContent = initials;
    $('#btn-access').hidden = !state.isAdmin;
    $('#btn-profile-access').hidden = !state.isAdmin;
    // «Выйти» показываем только браузерному входу: в Telegram сессии нет.
    $('#btn-profile-logout').hidden = state.via !== 'cookie';
  }

  /* --------------------------- Выбор и карточка ------------------------- */

  function selectLead(id, open = true) {
    if (state.selectedId === id) {
      if (open) openDetail();
      return;
    }
    state.selectedId = id;
    state.selected = state.leads.find((lead) => lead.id === id) || null;
    state.tab = 'info';
    state.detailSignature = '';
    markSelectedRow();
    renderDetail(true);
    if (open) openDetail();
  }

  function clearSelection() {
    state.selectedId = null;
    state.selected = null;
    state.detailSignature = '';
    markSelectedRow();
    renderDetail(true);
    closeDetail();
  }

  function openDetail() {
    if (!narrow.matches || !state.selected) return;
    document.body.dataset.detail = 'open';
    scrim.hidden = false;
    tg?.BackButton?.show();
  }

  function closeDetail() {
    delete document.body.dataset.detail;
    scrim.hidden = true;
    tg?.BackButton?.hide();
    closeSheets();
  }

  function closeSheets() {
    profileSheet.hidden = true;
  }

  /* ------------------------------ Действия ------------------------------ */

  async function setStatus(status, extra = {}) {
    const lead = state.selected;
    if (!lead || normalizedStatus(lead.status) === status) return;
    await mutate({ action: 'update_status', leadId: lead.id, status, ...extra }, `Статус: ${STATUS[status]}`);
  }

  async function claimLead() {
    const lead = state.selected;
    if (!lead) return;
    const name = state.user?.name || state.user?.username;
    const status = normalizedStatus(lead.status);
    const payload = {
      action: 'update_status',
      leadId: lead.id,
      status: status === 'new' ? 'processing' : status,
      dispatcher: name || ''
    };
    await mutate(payload, 'Заявка закреплена за вами');
  }

  async function deleteLead() {
    const lead = state.selected;
    if (!lead) return;
    if (!await confirmAction(`Удалить заявку №${lead.leadNumber || ''}? Действие необратимо.`)) return;
    const removed = await mutate({ action: 'delete', leadId: lead.id }, 'Заявка удалена');
    if (removed) clearSelection();
  }

  async function openDocument() {
    const lead = state.selected;
    if (!lead) return;
    try {
      const result = await api('/api/crm/doc-ticket', { method: 'POST', body: JSON.stringify({ leadId: lead.id }) });
      const url = new URL('/order-doc.html', location.origin);
      url.searchParams.set('id', lead.id);
      url.searchParams.set('lead', lead.leadNumber || '');
      url.searchParams.set('ticket', result.ticket);
      try { sessionStorage.setItem('asma_crm_tg_init_data', tg?.initData || ''); } catch (_) { /* приватный режим */ }
      if (tg?.openLink) tg.openLink(url.toString());
      else window.open(url.toString(), '_blank', 'noopener');
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function submitNote(form) {
    const text = new FormData(form).get('note')?.toString().trim();
    if (!text) {
      showToast('Заметка пустая', true);
      return;
    }
    const lead = state.selected;
    if (!lead) return;
    const saved = await mutate({ action: 'add_note', leadId: lead.id, note: text }, 'Заметка сохранена');
    if (saved) {
      form.reset();
      setNoteDirty(false);
      renderDetail(true);
    }
  }

  /* --------------------------- Доступ и профиль ------------------------- */

  async function openAccess() {
    try {
      const data = await api('/api/crm/access');
      state.users = Array.isArray(data.users) ? data.users : [];
      $('#access-list').innerHTML = state.users.map((user) => `
        <li>
          <span><b>${escapeHtml(user.name || 'Диспетчер')}</b><small>${escapeHtml(user.username ? `@${user.username}` : String(user.id || ''))}</small></span>
          ${user.isAdmin ? '<em>администратор</em>' : `<button class="btn btn--icon btn--danger" type="button" data-remove="${escapeHtml(user.username || user.id)}" aria-label="Отозвать доступ">✕</button>`}
        </li>`).join('');
      closeSheets();
      $('#access-dialog').showModal();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  /* ------------------------- Telegram: интеграция ----------------------- */

  function setNoteDirty(dirty) {
    if (!tg?.enableClosingConfirmation) return;
    try {
      if (dirty) tg.enableClosingConfirmation();
      else tg.disableClosingConfirmation();
    } catch (_) { /* старая версия Telegram */ }
  }

  function syncTgChrome() {
    if (!tg) return;
    try {
      tg.setHeaderColor?.('#fffdfc');
      tg.setBackgroundColor?.('#f6f3ef');
      tg.disableVerticalSwipes?.();
    } catch (_) { /* метод появился в новых версиях Telegram */ }
  }

  /* ------------------------------ События ------------------------------- */

  function setFilter(filter) {
    state.filter = filter;
    $('#nav').querySelectorAll('[data-filter]').forEach((node) => {
      node.setAttribute('aria-current', String(node.dataset.filter === filter));
    });
    $('#mobile-filters').querySelectorAll('[data-filter]').forEach((node) => {
      node.setAttribute('aria-pressed', String(node.dataset.filter === filter));
    });
    renderList(true);
  }

  function bindEvents() {
    $('#nav').addEventListener('click', (event) => {
      const item = event.target.closest('[data-filter]');
      if (item) setFilter(item.dataset.filter);
    });
    $('#mobile-filters').addEventListener('click', (event) => {
      const item = event.target.closest('[data-filter]');
      if (item) setFilter(item.dataset.filter);
    });

    $('#search').addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      const value = event.target.value;
      searchTimer = setTimeout(() => {
        state.query = value;
        renderList(true);
      }, 160);
    });

    $('#btn-refresh').addEventListener('click', () => refresh(true));
    $('#btn-retry').addEventListener('click', () => refresh(true));
    $('#btn-new').addEventListener('click', () => $('#lead-dialog').showModal());
    $('#btn-access').addEventListener('click', openAccess);
    $('#btn-profile-access').addEventListener('click', openAccess);
    $('#btn-profile-refresh').addEventListener('click', () => { closeSheets(); refresh(true); });
    $('#login-restart').addEventListener('click', startLoginFlow);
    $('#btn-profile-logout').addEventListener('click', async () => {
      closeSheets();
      try {
        await api('/api/logout', { method: 'POST', body: JSON.stringify({}) });
        diagnostic('Сессия закрыта', 'success');
      } catch (error) {
        diagnostic(`Выход: ${error.message}`, 'error');
      }
      location.reload();
    });
    $('#btn-profile-diagnostics').addEventListener('click', () => {
      closeSheets();
      const panel = $('#diagnostic-panel');
      document.body.dataset.diag = 'open';
      panel.open = true;
      if (!narrow.matches) panel.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
    // Закрыли журнал — возвращаем угол на телефоне.
    $('#diagnostic-panel').addEventListener('toggle', (event) => {
      if (!event.target.open) delete document.body.dataset.diag;
    });

    $('#nav-queue').addEventListener('click', () => {
      closeSheets();
      document.querySelector('.rows')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#nav-new').addEventListener('click', () => $('#lead-dialog').showModal());
    $('#nav-profile').addEventListener('click', () => {
      profileSheet.hidden = !profileSheet.hidden;
    });
    document.querySelectorAll('[data-sheet-close]').forEach((button) => {
      button.addEventListener('click', closeSheets);
    });
    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => button.closest('dialog').close());
    });

    list.addEventListener('click', (event) => {
      const row = event.target.closest('.row');
      if (!row) return;
      selectLead(row.dataset.id, !event.target.closest('.row__quick a'));
    });
    list.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('.row');
      if (!row) return;
      event.preventDefault();
      selectLead(row.dataset.id);
    });

    detailInner.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-tab]');
      if (tab) {
        state.tab = tab.dataset.tab;
        detailInner.querySelectorAll('[data-tab]').forEach((node) => node.setAttribute('aria-selected', String(node === tab)));
        detailInner.querySelectorAll('[data-panel]').forEach((panel) => {
          panel.hidden = panel.dataset.panel !== state.tab;
        });
        return;
      }
      const step = event.target.closest('.step');
      if (step) {
        setStatus(step.dataset.status);
        return;
      }
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'close') clearSelection();
      if (action.dataset.action === 'claim') claimLead();
      if (action.dataset.action === 'document') openDocument();
      if (action.dataset.action === 'delete') deleteLead();
      if (action.dataset.action === 'cancel') setStatus('cancelled');
    });

    detailInner.addEventListener('input', (event) => {
      if (event.target.matches('#note-form textarea')) setNoteDirty(Boolean(event.target.value.trim()));
    });
    detailInner.addEventListener('submit', (event) => {
      if (event.target.matches('#note-form')) {
        event.preventDefault();
        submitNote(event.target);
      }
    });

    scrim.addEventListener('click', closeDetail);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!profileSheet.hidden) closeSheets();
      else if (state.selected) clearSelection();
    });
    narrow.addEventListener('change', (event) => {
      if (!event.matches) closeDetail();
    });

    $('#lead-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form));
      const lead = {
        ...data,
        type: data.route || data.vehicle || data.weight ? 'cargo' : 'contact',
        category: data.route || data.vehicle ? 'Перевозка груза' : 'Обратная связь',
        status: 'new',
        source: 'crm_manual'
      };
      if (await mutate({ action: 'create', lead }, 'Заявка создана')) {
        form.reset();
        $('#lead-dialog').close();
        setFilter('new');
      }
    });

    $('#access-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const user = Object.fromEntries(new FormData(form));
        const result = await api('/api/crm/access', { method: 'POST', body: JSON.stringify({ action: 'add', user }) });
        state.users = result.users || state.users;
        form.reset();
        await openAccess();
        showToast('Доступ предоставлен');
      } catch (error) {
        showToast(error.message, true);
      }
    });
    $('#access-list').addEventListener('click', async (event) => {
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

  /* ------------------------------- Старт -------------------------------- */

  async function start() {
    bindEvents();
    syncTgChrome();
    if (tg) {
      tg.ready();
      tg.expand();
      tg.BackButton?.onClick(() => closeDetail());
    }
    const telegramUser = tg?.initDataUnsafe?.user;
    if (telegramUser) {
      state.user = {
        ...telegramUser,
        name: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') || telegramUser.username
      };
    }
    renderOperator();

    if (!tg?.initData) {
      // Браузер: пробуем сессионную cookie, иначе показываем вход по коду.
      const authorized = await refresh();
      if (authorized) startAutoRefresh();
      else if ($('#crm-login').hidden) showLogin();
      return;
    }

    const authorized = await refresh();
    if (!authorized) return;
    startAutoRefresh();
  }

  function startAutoRefresh() {
    state.timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_INTERVAL);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh();
    });
    document.addEventListener('click', (event) => {
      if (!profileSheet.hidden && !event.target.closest('#profile-sheet') && !event.target.closest('#nav-profile')) closeSheets();
    });
  }

  start();
})();
