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
    website_partners: 'форма партнёров',
    phone: 'телефон'
  };

  const PARTNER_ROLE_LABELS = {
    carrier: 'Перевозчик / владелец авто',
    shipper: 'Грузовладелец / заказчик',
    forwarder: 'Экспедитор / диспетчер'
  };

  const tg = window.Telegram?.WebApp;
  const state = {
    leads: [],
    users: [],
    filter: 'all',
    query: '',
    viewMode: (() => { try { return sessionStorage.getItem('asma-crm-view') === 'kanban' ? 'kanban' : 'table'; } catch { return 'table'; } })(),
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
  const board = $('#kanban-board');
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

  /**
   * Журнал системы. В разметке он скрыт и лежит внутри #crm-app: пока доступа
   * нет, приложение скрыто целиком, и журнала вместе с ним не видно — раньше
   * он стоял вне контейнера и показывал число заявок на экране входа.
   * Постоянного угла у журнала тоже нет: его открывают из профиля.
   */
  function openJournal() {
    const panel = $('#diagnostic-panel');
    if (!panel) return;
    panel.hidden = false;
    panel.open = true;
  }

  function closeJournal() {
    const panel = $('#diagnostic-panel');
    if (!panel) return;
    panel.open = false;
    panel.hidden = true;
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

  // Устаревшие значения, которые могут лежать в старых записях D1:
  // список и пояснение — LEGACY_STATUS_ALIASES в _shared/core.js.
  // Совпадение двух списков проверяет _tests/statuses.test.js.
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

  function dateTimeLocalValue(value) {
    const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
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
    closeJournal();
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
    closeJournal();
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

  function actionFilters(lead, now = new Date()) {
    const active = Boolean(lead.nextAction && lead.nextActionAt && lead.nextActionState !== 'done');
    const time = active ? new Date(lead.nextActionAt).getTime() : NaN;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
    return {
      action_today: active && Number.isFinite(time) && time >= now.getTime() && time < tomorrowStart,
      action_overdue: active && Number.isFinite(time) && time < now.getTime(),
      no_action: ['new','processing'].includes(normalizedStatus(lead.status)) && (!lead.nextAction || lead.nextActionState === 'done')
    };
  }

  function counts() {
    const result = { all: state.leads.length, action_today: 0, action_overdue: 0, no_action: 0 };
    for (const status of Object.keys(STATUS)) result[status] = 0;
    const now = new Date();
    for (const lead of state.leads) {
      const status = normalizedStatus(lead.status);
      result[status] = (result[status] || 0) + 1;
      const filters = actionFilters(lead, now);
      for (const key of ['action_today','action_overdue','no_action']) if (filters[key]) result[key] += 1;
    }
    return result;
  }

  function visibleLeads() {
    const needle = state.query.trim().toLocaleLowerCase('ru');
    return state.leads
      .filter((lead) => {
        const status = normalizedStatus(lead.status);
        if (['action_today','action_overdue','no_action'].includes(state.filter)) {
          if (!actionFilters(lead)[state.filter]) return false;
        } else if (state.filter !== 'all' && state.filter !== status) return false;
        if (!needle) return true;
        const text = [
          lead.leadNumber, lead.name, lead.company, lead.contact, lead.email,
          lead.route, lead.fromCity, lead.toCity, lead.distance, lead.vehicle,
          lead.weight, lead.comment, lead.dispatcher, lead.nextAction, lead.nextActionNote, sourceLabel(lead)
        ].join(' ').toLocaleLowerCase('ru');
        return text.includes(needle);
      })
      .sort((a, b) => ['action_today','action_overdue'].includes(state.filter)
        ? (new Date(a.nextActionAt || 0) - new Date(b.nextActionAt || 0))
        : (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
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
    const overdue = overdueLeads();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
    const activeActions = state.leads.filter((lead) => lead.nextAction && lead.nextActionAt && lead.nextActionState !== 'done');
    const actionOverdue = activeActions.filter((lead) => Number.isFinite(new Date(lead.nextActionAt).getTime()) && new Date(lead.nextActionAt).getTime() < now.getTime());
    const actionToday = activeActions.filter((lead) => { const date = new Date(lead.nextActionAt).getTime(); return date >= todayStart && date < tomorrowStart; });
    const withoutAction = state.leads.filter((lead) => ['new','processing'].includes(normalizedStatus(lead.status)) && (!lead.nextAction || lead.nextActionState === 'done')).length;
    if (!overdue.length && !activeActions.length && !withoutAction) { node.hidden = true; return; }
    const chunks = [];
    if (actionOverdue.length) chunks.push(`<div class="crm-alert-line crm-alert-line--overdue"><b>Просрочено действий: ${actionOverdue.length}</b> — ${actionOverdue.slice(0,2).map((lead)=>`№${escapeHtml(lead.leadNumber || '—')}: ${escapeHtml(lead.nextAction)}`).join('; ')}</div>`);
    if (actionToday.length) chunks.push(`<div class="crm-alert-line"><b>На сегодня: ${actionToday.length}</b> — ${actionToday.slice(0,2).map((lead)=>`№${escapeHtml(lead.leadNumber || '—')}: ${escapeHtml(lead.nextAction)}`).join('; ')}</div>`);
    if (withoutAction) chunks.push(`<div class="crm-alert-line"><b>Без следующего действия: ${withoutAction}</b> — назначьте шаг для активных заявок.</div>`);
    if (overdue.length) chunks.push(`<div class="crm-alert-line"><b>Ожидают реакции: ${overdue.length}</b> — ${overdue.slice(0,2).map(({lead,age})=>`№${escapeHtml(lead.leadNumber || '—')} (${escapeHtml(age.text)})`).join('; ')}</div>`);
    node.innerHTML = `<b>Рабочий список</b>${chunks.join('')}`;
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

  function boardCardHtml(lead) {
    const status = normalizedStatus(lead.status);
    const client = lead.company || lead.name || 'Без имени';
    const route = lead.route || [lead.fromCity, lead.toCity].filter(Boolean).join(' → ');
    const action = lead.nextAction && lead.nextActionState !== 'done' ? `${lead.nextAction} · ${formatDateTime(lead.nextActionAt)}` : 'Следующее действие не назначено';
    const age = ageInfo(lead);
    return `<article class="kanban-card" draggable="true" data-id="${escapeHtml(lead.id)}" tabindex="0" aria-label="Заявка №${escapeHtml(lead.leadNumber || '—')}: ${escapeHtml(client)}">
      <div class="kanban-card__top"><span>№${escapeHtml(lead.leadNumber || '—')}</span><span class="kanban-card__age">${escapeHtml(age.text)}</span></div>
      <strong class="kanban-card__client">${escapeHtml(client)}</strong>
      <span class="kanban-card__route">${escapeHtml(route || 'Маршрут уточняется')}</span>
      <span class="kanban-card__meta">${escapeHtml([lead.weight, lead.vehicle].filter(Boolean).join(' · ') || 'Параметры груза уточняются')}</span>
      <span class="kanban-card__action">${escapeHtml(action)}</span>
      <label class="kanban-card__move"><span class="sr-only">Изменить этап заявки</span><select data-board-status="${escapeHtml(lead.id)}" aria-label="Этап заявки №${escapeHtml(lead.leadNumber || '—')}">${Object.entries(STATUS).map(([key,label])=>`<option value="${key}" ${key===status?'selected':''}>${label}</option>`).join('')}</select></label>
    </article>`;
  }

  function renderKanban(rows) {
    if (!board) return;
    board.replaceChildren();
    Object.entries(STATUS).forEach(([status, label]) => {
      const column = document.createElement('section');
      column.className = 'kanban-column';
      column.dataset.dropStatus = status;
      const heading = document.createElement('header');
      heading.className = 'kanban-column__head';
      const title = document.createElement('strong'); title.textContent = label;
      const count = document.createElement('span');
      const items = rows.filter((lead) => normalizedStatus(lead.status) === status);
      count.textContent = String(items.length);
      heading.append(title, count);
      const body = document.createElement('div'); body.className = 'kanban-column__body'; body.dataset.dropStatus = status;
      body.innerHTML = items.map(boardCardHtml).join('') || '<p class="kanban-column__empty">Нет заявок на этом этапе</p>';
      column.append(heading, body);
      board.append(column);
    });
  }

  function renderList(force = false) {
    const rows = visibleLeads();
    const signature = `${state.viewMode}|${state.filter}|${state.query}|${rows.map((lead) => `${lead.id}:${lead.updatedAt || lead.createdAt || ''}:${lead.status}:${lead.dispatcher || ''}:${lead.nextAction || ''}:${lead.nextActionAt || ''}:${lead.nextActionState || ''}`).join(',')}`;
    document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === state.viewMode)));
    const tableHead = $('#lead-table-head');
    const kanban = state.viewMode === 'kanban';
    list.hidden = kanban;
    if (tableHead) tableHead.hidden = kanban;
    if (board) board.hidden = !kanban;
    if (!force && signature === state.listSignature) { markSelectedRow(); return; }
    state.listSignature = signature;
    if (kanban) renderKanban(rows);
    else list.innerHTML = rows.map(rowHtml).join('');
    $('#empty-state').hidden = rows.length > 0;
  }

  function setViewMode(mode) {
    state.viewMode = mode === 'kanban' ? 'kanban' : 'table';
    try { sessionStorage.setItem('asma-crm-view', state.viewMode); } catch (_) {}
    state.listSignature = '';
    renderList(true);
  }

  async function changeLeadStatus(leadId, status) {
    const lead = state.leads.find((item) => item.id === leadId);
    if (!lead || !STATUS[status] || normalizedStatus(lead.status) === status) return;
    await mutate({ action: 'update_status', leadId, status }, `Статус заявки №${lead.leadNumber || ''}: ${STATUS[status]}`);
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
      lead.partnerRole ? ['Роль', escapeHtml(PARTNER_ROLE_LABELS[lead.partnerRole] || lead.partnerRole)] : null,
      lead.direction ? ['Направления', escapeHtml(lead.direction)] : null,
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
          <section class="next-action-card" aria-labelledby="next-action-heading">
            <div class="section-title" id="next-action-heading">Следующее действие</div>
            ${lead.nextAction && lead.nextActionState !== 'done' ? `<p class="next-action-current"><strong>${escapeHtml(lead.nextAction)}</strong><span>${escapeHtml(formatDateTime(lead.nextActionAt) || 'Срок не указан')}</span>${lead.nextActionNote ? `<small>${escapeHtml(lead.nextActionNote)}</small>` : ''}</p><div class="next-action-tools"><button class="btn btn--small" type="button" data-action="complete-next-action">Отметить выполненным</button><button class="btn btn--small" type="button" data-action="clear-next-action">Снять действие</button></div>` : '<p class="next-action-empty">Активное действие не назначено.</p>'}
            <form id="next-action-form" class="next-action-form">
              <label><span>Действие</span><select name="nextAction" required><option>Позвонить клиенту</option><option>Уточнить параметры</option><option>Подготовить КП</option><option>Отправить документы</option><option>Проверить ответ</option><option>Другое</option></select></label>
              <label><span>Дата и время</span><input name="nextActionAt" type="datetime-local" required value="${escapeHtml(dateTimeLocalValue(lead.nextActionAt))}"></label>
              <label class="next-action-form__note"><span>Комментарий (необязательно)</span><input name="nextActionNote" maxlength="250" value="${escapeHtml(lead.nextActionNote || '')}" placeholder="Что нужно уточнить"></label>
              <button type="submit" class="btn btn--primary">Сохранить действие</button>
            </form>
          </section>
          <div class="section-title">Действия</div>
          <div class="actions">
            ${tel ? `<a class="btn" href="${tel}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h3.5l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.7 1.5C11.4 19.9 4.1 12.6 3.5 5.7A1.5 1.5 0 0 1 5 4Z"></path></svg>Позвонить</a>` : ''}
            ${telegram ? `<a class="btn" href="${telegram}" target="_blank" rel="noopener">Написать</a>` : ''}
            ${canClaim ? '<button class="btn" type="button" data-action="claim">Взять в работу</button>' : ''}
            ${canCancel ? '<button class="btn" type="button" data-action="cancel">Отменить</button>' : ''}
            <button class="btn btn--wide" type="button" data-action="repeat-lead">Повторить перевозку</button>
            <button class="btn btn--wide" type="button" data-action="document">Договор-заявка</button>
            <button class="btn btn--wide" type="button" data-action="proposal">Сформировать КП</button>
            <button class="btn btn--wide" type="button" data-action="tracking-link">Создать ссылку статуса</button>
            <button class="btn btn--wide" type="button" data-action="tracking-revoke">Отозвать ссылку статуса</button>
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
            <button class="btn btn--wide" type="button" data-action="proposal">Сформировать КП</button>
            <button class="btn btn--wide" type="button" data-action="tracking-link">Создать ссылку статуса</button>
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
    const signature = `${lead.id}|${lead.status}|${lead.dispatcher || ''}|${(lead.notes || []).length}|${lead.updatedAt || ''}|${lead.nextAction || ''}|${lead.nextActionAt || ''}|${lead.nextActionState || ''}|${state.tab}`;
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

  function repeatLeadDraft() {
    const lead = state.selected;
    if (!lead) return;
    const draft = {
      fromCity: lead.fromCity || '', toCity: lead.toCity || '', readyDate: lead.readyDate || '',
      distance: lead.distanceKm || lead.distance || '', weight: lead.weightTons || lead.weight || '',
      volume: lead.volumeM3 || lead.volume || '', cargo: lead.cargo || 'standard',
      loading: Boolean(lead.loading), vehicle: lead.vehicle || '', comment: lead.comment || '',
      savedAt: new Date().toISOString(), source: 'crm_repeat'
    };
    try { sessionStorage.setItem('asmaRequestDraft', JSON.stringify(draft)); }
    catch (_) { showToast('Не удалось подготовить повторную заявку в этом браузере.', true); return; }
    location.href = 'request';
  }

  async function openProposal() {
    const lead = state.selected;
    if (!lead) return;
    // Open synchronously to avoid popup blockers while the API issues the token.
    const popup = window.open('about:blank', '_blank');
    try {
      const result = await api('/api/crm/proposal-link', { method:'POST', body:JSON.stringify({leadId:lead.id}) });
      if (!result.url) throw new Error('Ссылка на КП не получена от сервера');
      if (popup) {
        popup.opener = null;
        popup.location.replace(result.url);
      } else if (tg?.openLink) {
        tg.openLink(result.url);
      } else {
        try { await navigator.clipboard.writeText(result.url); showToast('Защищённая ссылка на КП скопирована. Срок действия — 30 дней.'); }
        catch (_) { window.prompt('Скопируйте защищённую ссылку на КП. Она откроет только это предложение:', result.url); }
      }
    } catch (error) {
      try { popup?.close(); } catch (_) {}
      showToast(error.message || 'Не удалось сформировать КП', true);
    }
  }

  async function createTrackingLink() {
    const lead = state.selected; if (!lead) return;
    try {
      const result = await api('/api/crm/tracking-link', { method:'POST', body:JSON.stringify({leadId:lead.id}) });
      if (!result.url) throw new Error('Ссылка не получена от сервера');
      try { await navigator.clipboard.writeText(result.url); showToast('Защищённая ссылка скопирована. Срок действия — 90 дней.'); }
      catch (_) { window.prompt('Скопируйте защищённую ссылку статуса. Она даёт доступ к сводке заявки:', result.url); }
    } catch (error) { showToast(error.message || 'Не удалось создать ссылку статуса', true); }
  }

  async function revokeTrackingLink() {
    const lead = state.selected; if (!lead) return;
    if (!await confirmAction('Отозвать все активные ссылки статуса для этой заявки? Уже отправленные ссылки перестанут работать.')) return;
    try { await api('/api/crm/tracking-link', { method:'POST', body:JSON.stringify({leadId:lead.id,action:'revoke'}) }); showToast('Ссылки статуса отозваны.'); }
    catch (error) { showToast(error.message || 'Не удалось отозвать ссылку', true); }
  }

  async function openDocument() {
    const lead = state.selected;
    if (!lead) return;
    try {
      const result = await api('/api/crm/doc-ticket', { method: 'POST', body: JSON.stringify({ leadId: lead.id }) });
      const url = new URL('/order-doc', location.origin);
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

  /** Тёмная тема Telegram: атрибут темы + цвет шапки и фона самого клиента.
   *
   * Палитра берётся своя (см. crm-next.css), а не tg.themeParams: у Telegram
   * тема может быть любой, а у диспетчерской есть фирменные цвета, и на
   * произвольном фоне они могут не читаться. Клиенту сообщаем ровно те цвета,
   * которые стоят у нас, чтобы его шапка не отличалась от шапки приложения.
   */
  function syncTgChrome() {
    if (!tg) return;
    const dark = tg.colorScheme === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try {
      tg.setHeaderColor?.(dark ? '#1d1917' : '#fffdfc');
      tg.setBackgroundColor?.(dark ? '#191614' : '#f6f3ef');
      tg.disableVerticalSwipes?.();
    } catch (_) { /* метод появился в новых версиях Telegram */ }
  }

  /* ------------------------------ События ------------------------------- */

  function setFilter(filter) {
    state.filter = filter;
    $('#nav').querySelectorAll('[data-filter]').forEach((node) => {
      node.setAttribute('aria-current', String(node.dataset.filter === filter));
    });
    $('#action-nav')?.querySelectorAll('[data-filter]').forEach((node) => {
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
    $('#action-nav')?.addEventListener('click', (event) => {
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
      openJournal();
      const panel = $('#diagnostic-panel');
      if (!narrow.matches) panel.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
    // Закрыли журнал — убираем его совсем, чтобы он не занимал угол.
    $('#diagnostic-panel').addEventListener('toggle', (event) => {
      if (!event.target.open) event.target.hidden = true;
    });
    // Esc закрывает журнал: он открывается поверх карточки заявки
    // и не должен требовать попадания мышью в угол.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeJournal();
    });

    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setViewMode(button.dataset.view)));
    board?.addEventListener('click', (event) => {
      const card = event.target.closest('.kanban-card');
      if (card && !event.target.closest('select')) selectLead(card.dataset.id);
    });
    board?.addEventListener('change', (event) => {
      const select = event.target.closest('[data-board-status]');
      if (select) changeLeadStatus(select.dataset.boardStatus, select.value);
    });
    board?.addEventListener('dragstart', (event) => {
      const card = event.target.closest('.kanban-card');
      if (!card || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.id);
      card.classList.add('is-dragging');
    });
    board?.addEventListener('dragend', (event) => event.target.closest('.kanban-card')?.classList.remove('is-dragging'));
    board?.addEventListener('dragover', (event) => {
      const column = event.target.closest('[data-drop-status]');
      if (!column) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      column.classList.add('is-drop-target');
    });
    board?.addEventListener('dragleave', (event) => event.target.closest('[data-drop-status]')?.classList.remove('is-drop-target'));
    board?.addEventListener('drop', (event) => {
      const column = event.target.closest('[data-drop-status]');
      if (!column) return;
      event.preventDefault();
      column.classList.remove('is-drop-target');
      const leadId = event.dataTransfer?.getData('text/plain');
      if (leadId) changeLeadStatus(leadId, column.dataset.dropStatus);
    });

    $('#nav-queue').addEventListener('click', () => {
      closeSheets();
      if (state.viewMode === 'kanban') board?.scrollTo({ left: 0, behavior: 'smooth' });
      else list?.scrollTo({ top: 0, behavior: 'smooth' });
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
      if (action.dataset.action === 'proposal') openProposal();
      if (action.dataset.action === 'repeat-lead') repeatLeadDraft();
      if (action.dataset.action === 'tracking-link') createTrackingLink();
      if (action.dataset.action === 'tracking-revoke') revokeTrackingLink();
      if (action.dataset.action === 'complete-next-action') mutate({action:'complete_next_action',leadId:state.selected?.id}, 'Действие отмечено выполненным');
      if (action.dataset.action === 'clear-next-action') mutate({action:'clear_next_action',leadId:state.selected?.id}, 'Следующее действие снято');
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
        return;
      }
      if (event.target.matches('#next-action-form')) {
        event.preventDefault();
        const data = new FormData(event.target);
        const rawDate = String(data.get('nextActionAt') || '');
        const date = new Date(rawDate);
        if (!rawDate || Number.isNaN(date.getTime())) { showToast('Укажите дату и время действия', true); return; }
        mutate({ action:'set_next_action', leadId:state.selected?.id, nextAction:String(data.get('nextAction')||''), nextActionAt:date.toISOString(), nextActionNote:String(data.get('nextActionNote')||'').trim() }, 'Следующее действие сохранено');
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
      // Смену темы в Telegram применяем сразу: иначе тёмная тема
      // включится только после перезапуска приложения.
      tg.onEvent?.('themeChanged', syncTgChrome);
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
