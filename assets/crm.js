/**
 * ASMA Lines — CRM Диспетчерская (Telegram Mini App)
 * Designed for Operator: Иван (@plombit)
 */

(function () {
  'use strict';

  // Constants & Storage Config
  const CACHE_KEY = 'asma_crm_leads_v2';
  const DELETED_KEY = 'asma_crm_deleted_leads_v1';
  const MASTER_ADMIN_USERNAME = 'plombit';
  const MASTER_ADMIN_ID = '1014012851';

  function getCrmHeaders(extraHeaders = {}) {
    const initData = window.Telegram?.WebApp?.initData || '';
    return {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
      ...extraHeaders
    };
  }

  let authorizedUsers = [
    {
      id: '1014012851',
      username: 'plombit',
      name: 'Иван Ефимович',
      isAdmin: true,
      addedAt: '2026-09-17T10:00:00.000Z'
    }
  ];

  function sanitizeUsers(usersList) {
    let list = Array.isArray(usersList) ? [...usersList] : [];
    const hasMaster = list.some(u => 
      (u.username && u.username.toLowerCase() === MASTER_ADMIN_USERNAME) ||
      (u.id && String(u.id) === MASTER_ADMIN_ID)
    );

    if (!hasMaster) {
      list.unshift({
        id: MASTER_ADMIN_ID,
        username: MASTER_ADMIN_USERNAME,
        name: 'Иван Ефимович',
        isAdmin: true,
        addedAt: new Date().toISOString()
      });
    }

    // Deduplicate
    const seen = new Set();
    return list.filter(u => {
      const key = (u.username ? u.username.toLowerCase() : '') + '::' + (u.id ? String(u.id) : '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(u => {
      const isMaster = (u.username && u.username.toLowerCase() === MASTER_ADMIN_USERNAME) ||
                       (u.id && String(u.id) === MASTER_ADMIN_ID);
      return {
        ...u,
        isAdmin: isMaster ? true : Boolean(u.isAdmin)
      };
    });
  }

  let currentOperator = {
    name: 'Иван',
    username: 'plombit',
    id: '1014012851',
    isAdmin: true
  };

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
  let currentView = 'grid'; // 'grid' | 'kanban'
  try {
    const savedView = localStorage.getItem('asma-crm-view');
    if (savedView === 'grid' || savedView === 'kanban') currentView = savedView;
  } catch (e) {}
  let searchQuery = '';
  let isAuthorized = false;

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
  const operatorNameDisplay = document.getElementById('operator-name-display');
  const btnAccessMgmt = document.getElementById('btn-access-mgmt');
  const modalAccessMgmt = document.getElementById('modal-access-mgmt');
  const accessGateScreen = document.getElementById('access-gate-screen');
  const gateTitle = document.getElementById('gate-title');
  const gateDesc = document.getElementById('gate-desc');
  const gateUserInfo = document.getElementById('gate-user-info');
  const gateUserVal = document.getElementById('gate-user-val');
  const accessUsersList = document.getElementById('access-users-list');
  const formAddAccessUser = document.getElementById('form-add-access-user');
  const btnOpenTg = document.getElementById('btn-open-tg');
  const btnViewGrid = document.getElementById('btn-view-grid');
  const btnViewKanban = document.getElementById('btn-view-kanban');

  // Count Elements
  const countNewEl = document.getElementById('count-new');
  const countProcessingEl = document.getElementById('count-processing');
  const countTransitEl = document.getElementById('count-transit');
  const countCompletedEl = document.getElementById('count-completed');
  const countAllEl = document.getElementById('count-all');

  // Desktop Metrics Elements
  const metricTotalLeads = document.getElementById('metric-total-leads');
  const metricNewLeads = document.getElementById('metric-new-leads');
  const metricProcessingLeads = document.getElementById('metric-processing-leads');
  const metricTransitLeads = document.getElementById('metric-transit-leads');
  const metricCompletedLeads = document.getElementById('metric-completed-leads');
  const btnThemeToggle = document.getElementById('btn-theme-toggle');

  // Initialize
  init();

  async function init() {
    setupEventListeners();

    // Clear any obsolete localStorage session
    try {
      localStorage.removeItem('asma_crm_operator_session');
    } catch (e) {}

    // Check Access First - strictly no data is loaded or displayed until Telegram identity is verified
    await checkAuthorization();

    if (isAuthorized) {
      loadDeletedIds();
      loadCachedLeads();
      await fetchLeads(false);
      highlightLeadFromUrl();

      // Auto-poll in background every 10 seconds for real-time dispatching.
      // Pauses when tab is hidden to conserve resources and refreshes immediately when tab returns.
      setInterval(() => {
        if (isAuthorized && document.visibilityState === 'visible') {
          fetchLeads(false);
        }
      }, 10000);

      document.addEventListener('visibilitychange', () => {
        if (isAuthorized && document.visibilityState === 'visible') {
          fetchLeads(false);
        }
      });
    } else {
      // Purge any local cache if unauthorized
      leads = [];
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch (e) {}
    }
  }

  async function checkAuthorization() {
    const tgUser = tg?.initDataUnsafe?.user;
    const hasTgInitData = Boolean(window.Telegram?.WebApp?.initData);

    // If inside Telegram WebApp, hide the "Open in Telegram" header button
    if (btnOpenTg) {
      btnOpenTg.style.display = hasTgInitData ? 'none' : 'inline-flex';
    }

    // 1. Fetch authorized users list from server
    try {
      const res = await fetch('/api/crm/access?_t=' + Date.now(), {
        headers: getCrmHeaders(),
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users) && data.users.length > 0) {
          authorizedUsers = sanitizeUsers(data.users);
        }
      }
    } catch (e) {
      console.warn('Access check fetch notice:', e);
    }

    // 2. Strict verification: user MUST be opening inside Telegram WebApp with valid initData
    if (tgUser && hasTgInitData) {
      const tgUsername = (tgUser.username || '').toLowerCase().replace(/^@/, '');
      const tgId = String(tgUser.id || '');
      const tgFullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUsername || 'Диспетчер';

      // Check if master admin or in authorized list
      const isMaster = tgUsername === MASTER_ADMIN_USERNAME || tgId === MASTER_ADMIN_ID;
      const matched = authorizedUsers.find(u => {
        const uName = (u.username || '').toLowerCase().replace(/^@/, '');
        const uId = String(u.id || '');
        return (uName && uName === tgUsername) || (uId && uId === tgId);
      });

      if (isMaster || matched) {
        isAuthorized = true;
        currentOperator = {
          name: matched?.name || tgFullName || 'Иван',
          username: tgUsername || 'plombit',
          id: tgId || MASTER_ADMIN_ID,
          isAdmin: isMaster || Boolean(matched?.isAdmin)
        };
        grantAccessUI();
        return;
      } else {
        // In Telegram WebApp but account not authorized!
        isAuthorized = false;
        denyAccessUI({
          title: 'Доступ ограничен',
          desc: 'Ваш Telegram-аккаунт не найден в списке разрешённых сотрудников ASMA Lines. Доступ к заявкам закрыт.',
          handle: tgUsername ? `@${tgUsername} (ID: ${tgId})` : `ID: ${tgId}`
        });
        return;
      }
    }

    // STRICT: External browser without Telegram WebApp session — strictly denied!
    isAuthorized = false;
    denyAccessUI({
      title: 'Закрытая диспетчерская',
      desc: 'Доступ к управлению заявками и рейсами ASMA Lines разрешён только авторизованным сотрудникам через официальный Telegram-бот.',
      handle: null
    });
  }

  function grantAccessUI() {
    const crmShell = document.getElementById('crm-shell') || document.querySelector('.crm-shell');
    if (crmShell) crmShell.style.display = 'block';
    if (accessGateScreen) accessGateScreen.style.display = 'none';
    if (operatorNameDisplay) operatorNameDisplay.textContent = currentOperator.name;
    if (btnAccessMgmt) {
      btnAccessMgmt.style.display = currentOperator.isAdmin ? 'inline-flex' : 'none';
    }
  }

  function denyAccessUI({ title, desc, handle }) {
    const crmShell = document.getElementById('crm-shell') || document.querySelector('.crm-shell');
    if (crmShell) crmShell.style.display = 'none';
    if (feedLoadingEl) feedLoadingEl.style.display = 'none';
    if (accessGateScreen) {
      accessGateScreen.style.display = 'flex';
      if (gateTitle) gateTitle.textContent = title;
      if (gateDesc) gateDesc.textContent = desc;
      if (gateUserInfo && gateUserVal) {
        if (handle) {
          gateUserInfo.style.display = 'inline-flex';
          gateUserVal.textContent = handle;
        } else {
          gateUserInfo.style.display = 'none';
        }
      }
    }
  }

  // Highlight specific lead when navigated from Telegram notification link (?lead=105 or ?leadId=...)
  function highlightLeadFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const targetLeadNum = urlParams.get('lead') || urlParams.get('leadId');
    if (!targetLeadNum) return;

    // Find the lead to check if we should switch status tab
    const target = leads.find(l => String(l.leadNumber) === String(targetLeadNum) || String(l.id) === String(targetLeadNum));
    if (target && target.status && currentFilter !== 'all' && currentFilter !== target.status) {
      currentFilter = target.status;
      document.querySelectorAll('.tab-item').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-status') === currentFilter);
      });
      render();
    }

    setTimeout(() => {
      const targetCard = document.querySelector(`[data-lead-number="${targetLeadNum}"]`) ||
                         document.querySelector(`[data-lead-id="${targetLeadNum}"]`) ||
                         document.getElementById(`card-${targetLeadNum}`);
      if (targetCard) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetCard.classList.add('card-highlight-pulse');
        setTimeout(() => {
          targetCard.classList.remove('card-highlight-pulse');
        }, 5000);
      }
    }, 300);
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

  // Fetch leads from Server API
  async function fetchLeads(isUserRefresh = true) {
    if (!isAuthorized) return;

    if (isUserRefresh) {
      if (btnRefresh) btnRefresh.style.transform = 'rotate(180deg)';
      showToast('Обновление заявок...');
    } else if (leads.length === 0) {
      feedLoadingEl.style.display = 'block';
    }

    let fetched = null;
    const cacheBuster = '?_t=' + Date.now();

    try {
      const res = await fetch('/api/crm' + cacheBuster, {
        headers: getCrmHeaders(),
        cache: 'no-store'
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.deletedIds)) {
          json.deletedIds.forEach(id => deletedLeadIds.add(id));
          saveDeletedIds();
        }
        if (Array.isArray(json.authorizedUsers) && json.authorizedUsers.length > 0) {
          authorizedUsers = sanitizeUsers(json.authorizedUsers);
          if (modalAccessMgmt && modalAccessMgmt.classList.contains('open')) {
            renderAccessUsersList();
          }
        }
        if (Array.isArray(json.leads)) {
          fetched = json.leads;
        }
      } else if (res.status === 401 || res.status === 403) {
        isAuthorized = false;
        denyAccessUI({
          title: 'Доступ ограничен',
          desc: 'Сессия истекла или аккаунт не авторизован сервером.',
          handle: currentOperator.username ? `@${currentOperator.username}` : null
        });
        return;
      }
    } catch (e) {
      console.warn('CRM fetch error:', e);
    }

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
      highlightLeadFromUrl();

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

  // Sync back to server storage
  async function syncLeadsToCloud() {
    if (!isAuthorized) return;
    saveCache(leads);
    saveDeletedIds();
    renderCounts();

    const activeLeads = leads.filter(l => !deletedLeadIds.has(l.id));
    const payload = {
      action: 'sync',
      leads: activeLeads,
      deletedIds: Array.from(deletedLeadIds),
      authorizedUsers: sanitizeUsers(authorizedUsers)
    };

    try {
      const res = await fetch('/api/crm', {
        method: 'POST',
        headers: getCrmHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.authorizedUsers) {
          authorizedUsers = sanitizeUsers(json.authorizedUsers);
        }
      }
    } catch (e) {
      console.warn('CRM sync warning:', e);
    }
  }

  // View Mode Switcher
  function setViewMode(mode) {
    currentView = mode;
    try {
      localStorage.setItem('asma-crm-view', mode);
    } catch (e) {}

    if (btnViewGrid) btnViewGrid.classList.toggle('active', mode === 'grid');
    if (btnViewKanban) btnViewKanban.classList.toggle('active', mode === 'kanban');

    if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
    render();
  }

  // Quick filter helper
  function setStatusFilter(status) {
    currentFilter = status;
    if (tabsNav) {
      tabsNav.querySelectorAll('.tab-item').forEach(t => {
        t.classList.toggle('active', t.dataset.status === status);
      });
    }
    document.querySelectorAll('.metric-card[data-status-filter]').forEach(c => {
      c.classList.toggle('active-filter', c.getAttribute('data-status-filter') === status);
    });
    if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
    render();
  }

  // Global Phone Copy Helper
  window.copyPhone = function (e, phone) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!phone) return;
    const clean = phone.trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clean).then(() => {
        showToast('✓ Телефон скопирован: ' + clean);
      }).catch(() => {
        showToast('Телефон: ' + clean);
      });
    } else {
      showToast('Телефон: ' + clean);
    }
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  };

  // Event Listeners Setup
  function setupEventListeners() {
    // Desktop View Switcher
    if (btnViewGrid) {
      btnViewGrid.addEventListener('click', () => setViewMode('grid'));
    }
    if (btnViewKanban) {
      btnViewKanban.addEventListener('click', () => setViewMode('kanban'));
    }

    // Status Tabs
    if (tabsNav) {
      tabsNav.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab-item');
        if (!tab) return;
        tabsNav.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.status;

        // Sync active highlight on metric cards
        document.querySelectorAll('.metric-card[data-status-filter]').forEach(c => {
          c.classList.toggle('active-filter', c.getAttribute('data-status-filter') === currentFilter);
        });

        if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
        render();
      });
    }

    // Clickable Desktop Metric Cards
    document.querySelectorAll('.metric-card[data-status-filter]').forEach(card => {
      card.addEventListener('click', () => {
        const status = card.getAttribute('data-status-filter');
        if (status) setStatusFilter(status);
      });
    });

    // Window Resize (Handle desktop <-> mobile layout shift)
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        render();
      }, 150);
    });

    // Search Filter (Debounced)
    let searchDebounceTimer = null;
    searchInput.addEventListener('input', (e) => {
      const value = e.target.value;
      btnClearSearch.style.display = value.trim() ? 'block' : 'none';
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        searchQuery = value.trim().toLowerCase();
        render();
      }, 180);
    });

    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.style.display = 'none';
      render();
    });

    // Refresh
    btnRefresh.addEventListener('click', () => fetchLeads(true));

    // Theme Switcher Toggle
    function updateCrmBrandLogo(isDark) {
      const v = '20260926';
      const markSrc = isDark ? `assets/brand/asma-mark-dark.svg?v=${v}` : `assets/brand/asma-mark-light.svg?v=${v}`;
      document.querySelectorAll('img.brand-logo').forEach((img) => {
        img.onerror = function() {
          if (!this.dataset.fallbackApplied) {
            this.dataset.fallbackApplied = 'true';
            this.src = `assets/brand/asma-mark.svg?v=${v}`;
          }
        };
        img.src = markSrc;
      });
      const svgFavicon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
      if (svgFavicon) {
        svgFavicon.href = markSrc;
      }
    }

    // Initialize logo according to current theme
    const currentIsDark = document.documentElement.getAttribute('data-theme') === 'dark';
    updateCrmBrandLogo(currentIsDark);

    if (btnThemeToggle) {
      btnThemeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const nextTheme = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        if (nextTheme === 'dark') {
          document.documentElement.classList.add('theme-dark');
        } else {
          document.documentElement.classList.remove('theme-dark');
        }
        try {
          localStorage.setItem('asma-theme', nextTheme);
        } catch(e) {}
        updateCrmBrandLogo(nextTheme === 'dark');
        if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
      });
    }

    // Keyboard Shortcuts (Desktop)
    document.addEventListener('keydown', (e) => {
      const isInputActive = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (e.key === 'Escape') {
        closeAddModal();
        closeAccessModal();
        return;
      }
      if (isInputActive) return;

      if (e.key === '/' || e.code === 'Slash') {
        e.preventDefault();
        searchInput?.focus();
      } else if ((e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        openAddModal();
      } else if (e.key === '1') {
        setStatusFilter('new');
      } else if (e.key === '2') {
        setStatusFilter('processing');
      } else if (e.key === '3') {
        setStatusFilter('transit');
      } else if (e.key === '4') {
        setStatusFilter('completed');
      } else if (e.key === '5' || e.key === '0') {
        setStatusFilter('all');
      } else if (e.altKey && e.key === '1') {
        setViewMode('grid');
      } else if (e.altKey && e.key === '2') {
        setViewMode('kanban');
      }
    });

    // Access Management Modal (Admin only)
    if (btnAccessMgmt) {
      btnAccessMgmt.addEventListener('click', openAccessModal);
    }
    if (formAddAccessUser) {
      formAddAccessUser.addEventListener('submit', handleAddAccessUser);
    }
    if (modalAccessMgmt) {
      modalAccessMgmt.addEventListener('click', (e) => {
        if (e.target === modalAccessMgmt) closeAccessModal();
      });
    }

    // Modals
    btnAddLead.addEventListener('click', openAddModal);
    btnEmptyAdd.addEventListener('click', openAddModal);

    document.querySelectorAll('.modal-close-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        closeAddModal();
        closeAccessModal();
      });
    });

    modalAddLead.addEventListener('click', (e) => {
      if (e.target === modalAddLead) closeAddModal();
    });

    // New Lead Form Submit
    formNewLead.addEventListener('submit', handleCreateLead);
  }

  function openAccessModal() {
    if (!modalAccessMgmt) return;
    renderAccessUsersList();
    modalAccessMgmt.classList.add('open');
    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  }

  function closeAccessModal() {
    if (!modalAccessMgmt) return;
    modalAccessMgmt.classList.remove('open');
    if (formAddAccessUser) formAddAccessUser.reset();
  }

  function renderAccessUsersList() {
    if (!accessUsersList) return;
    if (authorizedUsers.length === 0) {
      accessUsersList.innerHTML = '<div style="color:#64748B;font-size:12px;text-align:center;padding:12px;">Список пуст</div>';
      return;
    }

    accessUsersList.innerHTML = authorizedUsers.map(u => {
      const isMaster = (u.username && u.username.toLowerCase() === MASTER_ADMIN_USERNAME) ||
                       (u.id && String(u.id) === MASTER_ADMIN_ID) ||
                       Boolean(u.isAdmin);
      const handleDisplay = u.username ? `@${u.username}` : `ID: ${u.id}`;
      const targetVal = u.username || u.id;

      return `
        <div class="access-user-item">
          <div class="access-user-info">
            <div class="access-user-name">
              <span>${escapeHtml(u.name || 'Сотрудник')}</span>
              ${isMaster ? '<span class="access-user-badge">⭐ Владелец</span>' : ''}
            </div>
            <div class="access-user-meta">${handleDisplay}</div>
          </div>
          ${!isMaster ? `
            <button class="btn-remove-user" onclick="removeAccessUser('${escapeHtml(targetVal)}')">
              Отозвать
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  async function handleAddAccessUser(e) {
    e.preventDefault();
    const fd = new FormData(formAddAccessUser);
    const rawHandle = (fd.get('userHandle') || '').trim();
    const name = (fd.get('userName') || '').trim();

    if (!rawHandle) {
      showToast('⚠️ Укажите @username или Telegram ID');
      return;
    }

    const isId = /^\d+$/.test(rawHandle.replace(/^@/, ''));
    const cleanUsername = !isId ? rawHandle.replace(/^@/, '').toLowerCase() : null;
    const cleanId = isId ? rawHandle.replace(/^@/, '') : null;

    const exists = authorizedUsers.some(u =>
      (cleanUsername && u.username && u.username.toLowerCase() === cleanUsername) ||
      (cleanId && u.id && String(u.id) === cleanId)
    );

    if (exists) {
      showToast('⚠️ Пользователь уже есть в списке доступа');
      return;
    }

    const newUser = {
      id: cleanId,
      username: cleanUsername,
      name: name || rawHandle,
      isAdmin: false,
      addedAt: new Date().toISOString()
    };

    showToast('Сохранение доступа...');

    let updatedUsers = null;

    try {
      const res = await fetch('/api/crm/access', {
        method: 'POST',
        headers: getCrmHeaders(),
        body: JSON.stringify({
          action: 'add',
          user: newUser,
          requestedBy: currentOperator
        })
      });
      if (res.ok) {
        const text = await res.text();
        if (text) {
          const json = JSON.parse(text);
          if (json.success && Array.isArray(json.users)) {
            updatedUsers = json.users;
          }
        }
      }
    } catch (e) {
      console.warn('API add user notice:', e);
    }

    if (updatedUsers) {
      authorizedUsers = sanitizeUsers(updatedUsers);
      renderAccessUsersList();
      formAddAccessUser.reset();
      showToast('✅ Доступ предоставлен!');
      if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    } else {
      showToast('❌ Ошибка при добавлении доступа');
    }
  }

  window.removeAccessUser = async function(target) {
    const confirmed = await askConfirmation(`Отозвать доступ к диспетчерской для ${target}?`);
    if (!confirmed) return;

    const cleanTarget = String(target).replace(/^@/, '').toLowerCase().trim();
    if (cleanTarget === MASTER_ADMIN_USERNAME || cleanTarget === MASTER_ADMIN_ID) {
      showToast('⚠️ Нельзя отозвать доступ у владельца');
      return;
    }

    showToast('Отзыв доступа...');
    let updatedUsers = null;

    try {
      const res = await fetch('/api/crm/access', {
        method: 'POST',
        headers: getCrmHeaders(),
        body: JSON.stringify({
          action: 'remove',
          target: cleanTarget,
          requestedBy: currentOperator
        })
      });
      if (res.ok) {
        const text = await res.text();
        if (text) {
          const json = JSON.parse(text);
          if (json.success && Array.isArray(json.users)) {
            updatedUsers = json.users;
          }
        }
      }
    } catch (e) {
      console.warn('API remove user notice:', e);
    }

    if (updatedUsers) {
      authorizedUsers = sanitizeUsers(updatedUsers);
    } else {
      authorizedUsers = sanitizeUsers(authorizedUsers.filter(u => {
        const uName = (u.username || '').toLowerCase().replace(/^@/, '');
        const uId = String(u.id || '');
        return uName !== cleanTarget && uId !== cleanTarget;
      }));
    }

    renderAccessUsersList();
    showToast('🗑 Доступ отозван');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
  };

  function openAddModal() {
    modalAddLead.classList.add('open');
    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  }

  function closeAddModal() {
    modalAddLead.classList.remove('open');
    formNewLead.reset();
    const submitBtn = formNewLead.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      if (submitBtn.dataset.defaultHtml) submitBtn.innerHTML = submitBtn.dataset.defaultHtml;
    }
  }

  async function handleCreateLead(e) {
    e.preventDefault();

    // Guard against double-submit (double click / Enter spam) creating duplicate leads
    const submitBtn = formNewLead.querySelector('button[type="submit"]');
    if (submitBtn) {
      if (submitBtn.disabled) return;
      if (!submitBtn.dataset.defaultHtml) submitBtn.dataset.defaultHtml = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Сохраняем…</span>';
    }

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
      dispatcher: currentOperator.name,
      notes: [
        {
          id: 'n-' + Date.now(),
          author: currentOperator.name,
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
      author: currentOperator.name,
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
      author: currentOperator.name,
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

    // Sync to Storage
    await syncLeadsToCloud();

    // Call DELETE API if available
    try {
      fetch(`/api/crm/lead/${encodeURIComponent(leadId)}`, {
        method: 'DELETE',
        headers: getCrmHeaders()
      }).catch(() => {});
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
    if (!isAuthorized) return;
    renderCounts();

    // Check if desktop Kanban view should be active
    const isDesktop = window.innerWidth >= 1024;
    const isKanbanActive = isDesktop && currentView === 'kanban';

    // Highlight active view button
    if (btnViewGrid) btnViewGrid.classList.toggle('active', currentView === 'grid');
    if (btnViewKanban) btnViewKanban.classList.toggle('active', currentView === 'kanban');

    if (isKanbanActive) {
      renderKanban();
      return;
    }

    // Grid / List View (Desktop Grid or Mobile Feed)
    leadsListEl.className = 'leads-list leads-list--grid';

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
    leadsListEl.innerHTML = filtered.map(lead => createCardHtml(lead, { isKanban: false })).join('');
  }

  function renderKanban() {
    leadsListEl.className = 'leads-list leads-list--kanban';
    feedEmptyEl.style.display = 'none';

    const cols = [
      { id: 'new', title: 'Новые заявки', subtitle: 'Требуют ответа', dot: 'dot-new' },
      { id: 'processing', title: 'В обработке', subtitle: 'Расчёт и логистика', dot: 'dot-processing' },
      { id: 'transit', title: 'В рейсе', subtitle: 'Груз в пути', dot: 'dot-transit' },
      { id: 'completed', title: 'Выполнено', subtitle: 'Доставлено', dot: 'dot-completed' }
    ];

    leadsListEl.innerHTML = cols.map(col => {
      let colLeads = leads.filter(l => (l.status || 'new') === col.id);
      if (searchQuery) {
        colLeads = colLeads.filter(l => {
          const str = `${l.leadNumber || ''} ${l.name || ''} ${l.contact || ''} ${l.route || ''} ${l.comment || ''}`.toLowerCase();
          return str.includes(searchQuery);
        });
      }

      const cardsHtml = colLeads.length > 0
        ? colLeads.map(l => createCardHtml(l, { isKanban: true })).join('')
        : `<div class="kanban-empty-col">Нет заявок</div>`;

      return `
        <div class="kanban-column kanban-col--${col.id}">
          <div class="kanban-col-header">
            <div class="kanban-col-title-box">
              <span class="tab-dot ${col.dot}"></span>
              <span class="kanban-col-title">${col.title}</span>
            </div>
            <span class="kanban-col-count">${colLeads.length}</span>
          </div>
          <div class="kanban-cards-stack">
            ${cardsHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderCounts() {
    const counts = { new: 0, processing: 0, transit: 0, completed: 0, all: leads.length };
    leads.forEach(l => {
      const s = l.status || 'new';
      if (counts[s] !== undefined) counts[s]++;
    });

    // Mobile & Toolbar Tab Counts
    if (countNewEl) countNewEl.textContent = counts.new;
    if (countProcessingEl) countProcessingEl.textContent = counts.processing;
    if (countTransitEl) countTransitEl.textContent = counts.transit;
    if (countCompletedEl) countCompletedEl.textContent = counts.completed;
    if (countAllEl) countAllEl.textContent = counts.all;

    // Desktop Header Metrics Bar
    if (metricTotalLeads) metricTotalLeads.textContent = counts.all;
    if (metricNewLeads) metricNewLeads.textContent = counts.new;
    if (metricProcessingLeads) metricProcessingLeads.textContent = counts.processing;
    if (metricTransitLeads) metricTransitLeads.textContent = counts.transit;
    if (metricCompletedLeads) metricCompletedLeads.textContent = counts.completed;
  }

  function createCardHtml(lead, options = {}) {
    const isKanban = Boolean(options.isKanban);
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
        <button class="btn-stage stage-action" onclick="changeLeadStatus('${lead.id}', 'processing')" title="Взять в работу">
          📞 В работу
        </button>
        <button class="btn-stage" onclick="changeLeadStatus('${lead.id}', 'transit')" title="Сразу назначить рейс">
          🚛 В рейс
        </button>
      `;
    } else if (status === 'processing') {
      statusActionsHtml = `
        <button class="btn-stage stage-action" onclick="changeLeadStatus('${lead.id}', 'transit')" title="Назначить в рейс">
          🚛 В рейс
        </button>
        <button class="btn-stage stage-complete" onclick="changeLeadStatus('${lead.id}', 'completed')" title="Завершить заказ">
          ✅ Завершить
        </button>
      `;
    } else if (status === 'transit') {
      statusActionsHtml = `
        <button class="btn-stage stage-complete" onclick="changeLeadStatus('${lead.id}', 'completed')" title="Груз доставлен, закрыть">
          ✅ Доставлен
        </button>
        <button class="btn-stage" onclick="changeLeadStatus('${lead.id}', 'processing')" title="Вернуть на стадию обработки">
          ↩️ В работу
        </button>
      `;
    } else if (status === 'completed') {
      statusActionsHtml = `
        <span class="status-done-tag">✅ Выполнено</span>
        <button class="btn-stage btn-stage-subtle" onclick="changeLeadStatus('${lead.id}', 'processing')" title="Открыть снова">
          ↩️ Возобновить
        </button>
      `;
    }

    // Route block (parsed with arrow)
    let routeHtml = '';
    if (lead.route && lead.route !== '—') {
      let routeLine = escapeHtml(lead.route);
      let fromCity = '';
      let toCity = '';
      if (lead.route.includes('→')) {
        const pts = lead.route.split('→');
        fromCity = pts[0].trim();
        toCity = pts[1].trim();
      } else if (lead.route.includes('-') && !lead.route.includes('–')) {
        const pts = lead.route.split('-');
        fromCity = pts[0].trim();
        toCity = pts[1].trim();
      }

      const routeDisplay = (fromCity && toCity)
        ? `<div class="route-path"><span class="route-city route-from">📍 ${escapeHtml(fromCity)}</span><span class="route-arrow" aria-hidden="true">➔</span><span class="route-city route-to">${escapeHtml(toCity)}</span></div>`
        : `<div class="route-header"><span>📍 ${routeLine}</span></div>`;

      routeHtml = `
        <div class="route-box">
          ${routeDisplay}
          <div class="route-specs">
            ${lead.distance ? `<span class="spec-chip spec-dist" title="Расстояние">📏 ${escapeHtml(lead.distance)}</span>` : ''}
            ${lead.vehicle ? `<span class="spec-chip spec-veh" title="Транспорт">🚚 ${escapeHtml(lead.vehicle)}</span>` : ''}
            ${lead.weight ? `<span class="spec-chip spec-wt" title="Тоннаж">⚖️ ${escapeHtml(lead.weight)}</span>` : ''}
            ${lead.price ? `<span class="spec-chip spec-price" title="Ставка перевозки">💰 ${escapeHtml(lead.price)}</span>` : ''}
          </div>
        </div>
      `;
    }

    // Comment block
    let commentHtml = '';
    if (lead.comment && lead.comment.trim() && lead.comment !== '—') {
      commentHtml = `
        <div class="client-comment">
          <span class="comment-icon">💬</span>
          <span class="comment-text">${escapeHtml(lead.comment)}</span>
        </div>
      `;
    }

    // Notes list
    const notes = lead.notes || [];
    const notesCount = notes.length;
    const notesHtml = notes.map(n => `
      <div class="note-item">
        <div class="note-meta-row">
          <span class="note-author">${escapeHtml(n.author || 'Иван')}</span>
          <span class="note-time">${formatTimeShort(n.time)}</span>
        </div>
        <div class="note-text">${escapeHtml(n.text)}</div>
      </div>
    `).join('');

    return `
      <article class="lead-card status-${status} ${isKanban ? 'lead-card--kanban' : ''}" id="card-${lead.id}" data-lead-id="${lead.id}" data-lead-number="${num}">
        <!-- Top Meta -->
        <div class="card-meta-row">
          <div class="card-number-time">
            <span class="lead-num">#${num}</span>
            <span class="lead-time" title="${lead.createdAt ? new Date(lead.createdAt).toLocaleString('ru-RU') : ''}">${timeStr}</span>
          </div>
          <div class="card-meta-right">
            <span class="lead-badge ${badgeClass}">${badgeLabel}</span>
            <button class="btn-delete-lead" onclick="deleteLead('${lead.id}')" title="Удалить заявку" aria-label="Удалить заявку">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Client & Communication Section -->
        <div class="card-client-block">
          <div class="client-name">${escapeHtml(lead.name || 'Клиент')}</div>
          <div class="client-contact-row">
            <span class="client-phone">${escapeHtml(lead.contact || 'Телефон не указан')}</span>
            ${lead.contact ? `
              <button type="button" class="btn-copy-phone" onclick="copyPhone(event, '${escapeHtml(lead.contact)}')" title="Скопировать номер">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Direct Actions (Call & Chat) -->
        <div class="card-actions-row">
          <a href="tel:${cleanPhone}" class="btn-call" title="Позвонить клиенту">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            <span>Позвонить</span>
          </a>
          <a href="https://t.me/+${cleanPhone.replace('+', '')}" target="_blank" rel="noopener" class="btn-chat" title="Открыть чат в Telegram">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.05-.2-.06-.05-.16-.03-.23-.02-.1.02-1.74 1.11-4.91 3.25-.46.32-.88.48-1.26.47-.42-.01-1.22-.24-1.82-.43-.73-.24-1.31-.37-1.26-.78.03-.21.32-.43.88-.66 3.46-1.5 5.76-2.49 6.92-2.97 3.3-1.38 3.99-1.62 4.43-1.63.1 0 .32.02.46.14.12.1.15.24.17.34.02.13.03.3.01.46z"/>
            </svg>
            <span>Telegram</span>
          </a>
        </div>

        <!-- Route & Details -->
        ${routeHtml}

        <!-- Client Comment -->
        ${commentHtml}

        <!-- Stage Progression Controls & Notes -->
        <div class="card-footer-controls">
          <div class="stage-buttons">
            ${statusActionsHtml}
          </div>
          <div class="footer-actions-right">
            <button type="button" class="notes-toggle ${notesCount > 0 ? 'has-notes' : ''}" onclick="toggleNotes('${lead.id}')" title="Заметки диспетчера">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>${notesCount > 0 ? notesCount : 'Заметки'}</span>
            </button>
          </div>
        </div>

        <!-- Inline Notes Panel -->
        <div id="notes-panel-${lead.id}" class="notes-panel" style="display: ${notesCount > 0 && !isKanban ? 'block' : 'none'};">
          <div class="lead-notes-area">
            ${notesHtml}
            <div class="note-input-row">
              <input type="text" id="note-input-${lead.id}" class="note-input" placeholder="Заметка диспетчера (Enter)..." onkeydown="if(event.key==='Enter') addLeadNote('${lead.id}')">
              <button type="button" class="btn-note-add" onclick="addLeadNote('${lead.id}')">OK</button>
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
