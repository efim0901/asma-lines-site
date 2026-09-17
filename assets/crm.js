/**
 * ASMA Lines — CRM Диспетчерская (Telegram Mini App)
 * Designed for Operator: Иван (@plombit)
 */

(function () {
  'use strict';

  // Constants & Storage Config
  const CLOUD_FALLBACK_URL = 'https://extendsclass.com/api/json-storage/bin/becdbda';
  const CACHE_KEY = 'asma_crm_leads_v2';
  const DELETED_KEY = 'asma_crm_deleted_leads_v1';
  const OPERATOR = { name: 'Иван', username: 'plombit', role: 'Диспетчер' };

  // Telegram WebApp Setup
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      if (tg.setHeaderColor) tg.setHeaderColor('#0B0F17');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#0B0F17');
    } catch (e) {}
  }

  // App State
  let leads = [];
  let deletedLeadIds = new Set();
  let currentFilter = 'new'; // 'new' | 'processing' | 'transit' | 'completed' | 'all'
  let searchQuery = '';

  // DOM Elements
  const leadsListEl = document.getElementById('leads-list');
  const feedLoadingEl = document.getElementById('feed-loading');
  const feedEmptyEl = document.getElementById('feed-empty');
  const searchInput = document.getElementById('lead-search');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const tabsNav = document.getElementById('status-tabs');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnAddLead = document.getElementById('btn-add-lead');
  const btnEmptyAdd = document.getElementById('btn-empty-add');
  const modalAddLead = document.getElementById('modal-add-lead');
  const formNewLead = document.getElementById('form-new-lead');
  const toastEl = document.getElementById('toast');

  // Count Elements
  const countNewEl = document.getElementById('count-new');
  const countProcessingEl = document.getElementById('count-processing');
  const countTransitEl = document.getElementById('count-transit');
  const countCompletedEl = document.getElementById('count-completed');
  const countAllEl = document.getElementById('count-all');

  // Initialize
  init();

  async function init() {
    loadDeletedIds();
    loadCachedLeads();
    setupEventListeners();
    await fetchLeads(false);

    // Auto-poll in background every 10 seconds for real-time dispatching
    setInterval(() => {
      fetchLeads(false);
    }, 10000);
  }

  function loadDeletedIds() {
    try {
      const raw = localStorage.getItem(DELETED_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          deletedLeadIds = new Set(arr);
        }
      }
    } catch (e) {}
  }

  function saveDeletedIds() {
    try {
      localStorage.setItem(DELETED_KEY, JSON.stringify(Array.from(deletedLeadIds)));
    } catch (e) {}
  }

  function loadCachedLeads() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          leads = parsed.filter(l => !deletedLeadIds.has(l.id));
          render();
        }
      }
    } catch (e) {}
  }

  function saveCache(data) {
    try {
      const filtered = (data || []).filter(l => !deletedLeadIds.has(l.id));
      localStorage.setItem(CACHE_KEY, JSON.stringify(filtered));
    } catch (e) {}
  }

  // Fetch leads from Cloud API / Fallback
  async function fetchLeads(isUserRefresh = true) {
    if (isUserRefresh) {
      if (btnRefresh) btnRefresh.style.transform = 'rotate(180deg)';
      showToast('Обновление заявок...');
    } else if (leads.length === 0) {
      feedLoadingEl.style.display = 'block';
    }

    let fetched = null;
    const cacheBuster = '?_t=' + Date.now();

    // 1. Try local API
    try {
      const res = await fetch('/api/crm' + cacheBuster, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.deletedIds)) {
          json.deletedIds.forEach(id => deletedLeadIds.add(id));
          saveDeletedIds();
        }
        if (Array.isArray(json.leads)) {
          fetched = json.leads;
        }
      }
    } catch (e) {}

    // 2. Direct cloud storage (always with cache buster for Telegram Webview)
    try {
      const cloudRes = await fetch(CLOUD_FALLBACK_URL + cacheBuster, { cache: 'no-store' });
      if (cloudRes.ok) {
        const cloudJson = await cloudRes.json();
        if (Array.isArray(cloudJson.deletedIds)) {
          cloudJson.deletedIds.forEach(id => deletedLeadIds.add(id));
          saveDeletedIds();
        }
        if (fetched === null && Array.isArray(cloudJson.leads)) {
          fetched = cloudJson.leads;
        }
      }
    } catch (e) {}

    if (btnRefresh) {
      setTimeout(() => { btnRefresh.style.transform = 'none'; }, 300);
    }

    feedLoadingEl.style.display = 'none';

    if (fetched !== null) {
      const validLeads = fetched.filter(l => !deletedLeadIds.has(l.id));
      const prevCount = leads.length;
      leads = validLeads;
      saveCache(leads);
      render();

      if (isUserRefresh) {
        showToast(`Заявки обновлены (${leads.length})`);
      } else if (prevCount > 0 && validLeads.length > prevCount) {
        // New lead arrived in background
        showToast('🔔 Новая заявка поступила!');
        if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
      }
    } else if (leads.length === 0) {
      feedEmptyEl.style.display = 'block';
    }
  }

  // Sync back to cloud storage
  async function syncLeadsToCloud() {
    saveCache(leads);
    saveDeletedIds();
    renderCounts();

    const payload = {
      leads,
      deletedIds: Array.from(deletedLeadIds)
    };

    // 1. Always directly save to Cloud Storage (guaranteed for Cloudflare Pages / Telegram WebApp)
    try {
      await fetch(CLOUD_FALLBACK_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn('Cloud fallback sync error:', err);
    }

    // 2. Also try local backend API
    try {
      await fetch('/api/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', ...payload })
      });
    } catch (e) {}
  }

  // Event Listeners Setup
  function setupEventListeners() {
    // Status Tabs
    tabsNav.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab-item');
      if (!tab) return;
      tabsNav.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.status;
      if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
      render();
    });

    // Search Filter
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      btnClearSearch.style.display = searchQuery ? 'block' : 'none';
      render();
    });

    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.style.display = 'none';
      render();
    });

    // Refresh
    btnRefresh.addEventListener('click', () => fetchLeads(true));

    // Modals
    btnAddLead.addEventListener('click', openAddModal);
    btnEmptyAdd.addEventListener('click', openAddModal);

    document.querySelectorAll('.modal-close-trigger').forEach(btn => {
      btn.addEventListener('click', closeAddModal);
    });

    modalAddLead.addEventListener('click', (e) => {
      if (e.target === modalAddLead) closeAddModal();
    });

    // New Lead Form Submit
    formNewLead.addEventListener('submit', handleCreateLead);
  }

  function openAddModal() {
    modalAddLead.classList.add('open');
    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  }

  function closeAddModal() {
    modalAddLead.classList.remove('open');
    formNewLead.reset();
  }

  async function handleCreateLead(e) {
    e.preventDefault();
    const fd = new FormData(formNewLead);

    const type = fd.get('leadType') || 'cargo';
    const fromCity = (fd.get('fromCity') || '').trim();
    const toCity = (fd.get('toCity') || '').trim();
    const route = (fromCity && toCity) ? `${fromCity} → ${toCity}` : (fromCity || toCity || 'Маршрут по согласованию');

    const newLead = {
      id: 'lead-' + Date.now(),
      leadNumber: String(leads.length + 101),
      type: type,
      category: type === 'cargo' ? 'Перевозка груза' : 'Обратная связь',
      status: 'new',
      createdAt: new Date().toISOString(),
      name: (fd.get('name') || '').trim(),
      contact: (fd.get('contact') || '').trim(),
      route: route,
      vehicle: (fd.get('vehicle') || '').trim(),
      price: (fd.get('price') || '').trim(),
      comment: (fd.get('comment') || '').trim(),
      dispatcher: OPERATOR.name,
      notes: [
        {
          id: 'n-' + Date.now(),
          author: OPERATOR.name,
          text: 'Заявка добавлена диспетчером',
          time: new Date().toISOString()
        }
      ],
      source: 'manual_dispatch'
    };

    leads.unshift(newLead);
    closeAddModal();
    showToast('Заявка #' + newLead.leadNumber + ' успешно добавлена!');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

    // Select tab 'new' if not already
    currentFilter = 'new';
    tabsNav.querySelectorAll('.tab-item').forEach(t => {
      t.classList.toggle('active', t.dataset.status === 'new');
    });

    render();
    await syncLeadsToCloud();
  }

  // Update Status
  window.changeLeadStatus = async function (leadId, newStatus) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    const prevStatus = lead.status;
    lead.status = newStatus;

    const statusLabels = {
      new: 'Новая',
      processing: 'В работе',
      transit: 'В рейсе',
      completed: 'Завершена'
    };

    if (!lead.notes) lead.notes = [];
    lead.notes.unshift({
      id: 'n-' + Date.now(),
      author: OPERATOR.name,
      text: `Статус изменён на «${statusLabels[newStatus] || newStatus}»`,
      time: new Date().toISOString()
    });

    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    showToast(`Заявка #${lead.leadNumber} переведена: ${statusLabels[newStatus]}`);

    render();
    await syncLeadsToCloud();
  };

  // Add Dispatcher Note
  window.addLeadNote = async function (leadId) {
    const input = document.getElementById(`note-input-${leadId}`);
    if (!input || !input.value.trim()) return;

    const text = input.value.trim();
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    if (!lead.notes) lead.notes = [];
    lead.notes.unshift({
      id: 'n-' + Date.now(),
      author: OPERATOR.name,
      text: text,
      time: new Date().toISOString()
    });

    input.value = '';
    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    showToast('Заметка сохранена');

    render();
    await syncLeadsToCloud();
  };

  // Delete Lead Permanently (with full confirmation)
  window.deleteLead = async function (leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    const leadNum = lead.leadNumber || lead.id;
    const clientName = lead.name || 'клиента';

    const confirmed = await askConfirmation(`Удалить заявку #${leadNum} (${clientName}) с концами?\nВосстановить её будет невозможно.`);
    if (!confirmed) return;

    // Visual fade out
    const cardEl = document.getElementById(`card-${leadId}`);
    if (cardEl) {
      cardEl.style.transition = 'all 0.25s ease';
      cardEl.style.opacity = '0';
      cardEl.style.transform = 'scale(0.95)';
    }

    // Filter out from memory and register as permanently deleted
    deletedLeadIds.add(leadId);
    saveDeletedIds();

    leads = leads.filter(l => l.id !== leadId);
    saveCache(leads);

    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
    showToast(`🗑️ Заявка #${leadNum} удалена навсегда`);

    setTimeout(() => {
      render();
    }, 250);

    // Sync to Cloud Storage
    await syncLeadsToCloud();

    // Call DELETE API if available
    try {
      fetch(`/api/crm/lead/${encodeURIComponent(leadId)}`, { method: 'DELETE' }).catch(() => {});
    } catch (e) {}
  };

  function askConfirmation(message) {
    return new Promise((resolve) => {
      if (window.Telegram?.WebApp?.showConfirm) {
        window.Telegram.WebApp.showConfirm(message, (ok) => resolve(Boolean(ok)));
      } else {
        resolve(window.confirm(message));
      }
    });
  }

  // Toggle Notes visibility
  window.toggleNotes = function (leadId) {
    const panel = document.getElementById(`notes-panel-${leadId}`);
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  };

  // Render Engine
  function render() {
    renderCounts();

    // Filter leads
    let filtered = leads;

    if (currentFilter !== 'all') {
      filtered = filtered.filter(l => (l.status || 'new') === currentFilter);
    }

    if (searchQuery) {
      filtered = filtered.filter(l => {
        const str = `${l.leadNumber || ''} ${l.name || ''} ${l.contact || ''} ${l.route || ''} ${l.comment || ''}`.toLowerCase();
        return str.includes(searchQuery);
      });
    }

    if (filtered.length === 0) {
      leadsListEl.innerHTML = '';
      feedEmptyEl.style.display = 'block';
      return;
    }

    feedEmptyEl.style.display = 'none';

    leadsListEl.innerHTML = filtered.map(lead => createCardHtml(lead)).join('');
  }

  function renderCounts() {
    const counts = { new: 0, processing: 0, transit: 0, completed: 0, all: leads.length };
    leads.forEach(l => {
      const s = l.status || 'new';
      if (counts[s] !== undefined) counts[s]++;
    });

    if (countNewEl) countNewEl.textContent = counts.new;
    if (countProcessingEl) countProcessingEl.textContent = counts.processing;
    if (countTransitEl) countTransitEl.textContent = counts.transit;
    if (countCompletedEl) countCompletedEl.textContent = counts.completed;
    if (countAllEl) countAllEl.textContent = counts.all;
  }

  function createCardHtml(lead) {
    const status = lead.status || 'new';
    const num = lead.leadNumber || lead.id.replace(/\D/g, '').slice(-3) || '101';
    const isCargo = lead.type === 'cargo' || Boolean(lead.route && lead.route.includes('→'));
    const badgeClass = isCargo ? 'badge-cargo' : (lead.type === 'partner' ? 'badge-partner' : 'badge-contact');
    const badgeLabel = isCargo ? '🚚 Перевозка' : (lead.type === 'partner' ? '🤝 Партнёр' : '📩 Вопрос');

    // Phone Clean for tel:
    const cleanPhone = (lead.contact || '').replace(/[^\d+]/g, '');

    // Format created date
    let timeStr = 'Недавно';
    if (lead.createdAt) {
      try {
        const d = new Date(lead.createdAt);
        timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ', ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      } catch (e) {}
    }

    // Status action buttons
    let statusActionsHtml = '';
    if (status === 'new') {
      statusActionsHtml = `
        <button class="btn-stage stage-action" onclick="changeLeadStatus('${lead.id}', 'processing')">
          📞 Взять в работу
        </button>
        <button class="btn-stage" onclick="changeLeadStatus('${lead.id}', 'transit')">
          🚛 Сразу в рейс
        </button>
      `;
    } else if (status === 'processing') {
      statusActionsHtml = `
        <button class="btn-stage stage-action" onclick="changeLeadStatus('${lead.id}', 'transit')">
          🚛 Назначить в рейс
        </button>
        <button class="btn-stage stage-complete" onclick="changeLeadStatus('${lead.id}', 'completed')">
          ✅ Завершить
        </button>
      `;
    } else if (status === 'transit') {
      statusActionsHtml = `
        <button class="btn-stage stage-complete" onclick="changeLeadStatus('${lead.id}', 'completed')">
          ✅ Доставлен / Завершить
        </button>
        <button class="btn-stage" onclick="changeLeadStatus('${lead.id}', 'processing')">
          ↩️ Вернуть в работу
        </button>
      `;
    } else if (status === 'completed') {
      statusActionsHtml = `
        <span style="font-size:12px; font-weight:700; color:var(--accent-green);">✅ Заказ выполнен</span>
        <button class="btn-stage" onclick="changeLeadStatus('${lead.id}', 'processing')">
          ↩️ Открыть снова
        </button>
      `;
    }

    // Route block (if cargo or route specified)
    let routeHtml = '';
    if (lead.route && lead.route !== '—') {
      routeHtml = `
        <div class="route-box">
          <div class="route-header">
            <span>📍 ${escapeHtml(lead.route)}</span>
          </div>
          <div class="route-specs">
            ${lead.distance ? `<span class="spec-chip">📏 ${escapeHtml(lead.distance)}</span>` : ''}
            ${lead.vehicle ? `<span class="spec-chip">🚚 ${escapeHtml(lead.vehicle)}</span>` : ''}
            ${lead.weight ? `<span class="spec-chip">⚖️ ${escapeHtml(lead.weight)}</span>` : ''}
            ${lead.price ? `<span class="spec-chip spec-price">💰 ${escapeHtml(lead.price)}</span>` : ''}
          </div>
        </div>
      `;
    }

    // Comment block
    let commentHtml = '';
    if (lead.comment && lead.comment.trim() && lead.comment !== '—') {
      commentHtml = `
        <div class="client-comment">
          💬 ${escapeHtml(lead.comment)}
        </div>
      `;
    }

    // Notes list
    const notes = lead.notes || [];
    const notesCount = notes.length;
    const notesHtml = notes.map(n => `
      <div class="note-item">
        <span class="note-author">${escapeHtml(n.author || 'Иван')}:</span>
        <span class="note-text">${escapeHtml(n.text)}</span>
        <span class="note-time">${formatTimeShort(n.time)}</span>
      </div>
    `).join('');

    return `
      <article class="lead-card status-${status}" id="card-${lead.id}">
        <!-- Top Meta -->
        <div class="card-meta-row">
          <div class="card-number-time">
            <span class="lead-num">#${num}</span>
            <span class="lead-time">${timeStr}</span>
          </div>
          <div class="card-meta-right">
            <span class="lead-badge ${badgeClass}">${badgeLabel}</span>
            <button class="btn-delete-lead" onclick="deleteLead('${lead.id}')" title="Удалить заявку с концами" aria-label="Удалить заявку">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Client Info -->
        <div class="card-client-block">
          <div class="client-name">${escapeHtml(lead.name || 'Клиент')}</div>
          <div class="client-contact-row">
            <span class="client-phone">${escapeHtml(lead.contact || 'Телефон не указан')}</span>
          </div>
        </div>

        <!-- Direct Actions (Call & Chat) -->
        <div class="card-actions-row">
          <a href="tel:${cleanPhone}" class="btn-call">
            📞 Позвонить
          </a>
          <a href="https://t.me/+${cleanPhone.replace('+', '')}" target="_blank" class="btn-chat" title="Открыть в Telegram">
            💬 Telegram
          </a>
        </div>

        <!-- Route & Details -->
        ${routeHtml}

        <!-- Client Comment -->
        ${commentHtml}

        <!-- Stage Progression Controls -->
        <div class="card-footer-controls">
          <div class="stage-buttons">
            ${statusActionsHtml}
          </div>
          <div class="footer-actions-right">
            <button class="notes-toggle" onclick="toggleNotes('${lead.id}')">
              📝 Заметки (${notesCount})
            </button>
            <button class="btn-delete-link" onclick="deleteLead('${lead.id}')" title="Удалить навсегда">
              🗑️ Удалить
            </button>
          </div>
        </div>

        <!-- Inline Notes Panel -->
        <div id="notes-panel-${lead.id}" class="notes-panel" style="display: ${notesCount > 0 ? 'block' : 'none'};">
          <div class="lead-notes-area">
            ${notesHtml}
            <div class="note-input-row">
              <input type="text" id="note-input-${lead.id}" class="note-input" placeholder="Добавить заметку..." onkeydown="if(event.key==='Enter') addLeadNote('${lead.id}')">
              <button class="btn-note-add" onclick="addLeadNote('${lead.id}')">OK</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTimeShort(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2400);
  }

})();
