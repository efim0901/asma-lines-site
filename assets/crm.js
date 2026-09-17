/**
 * ASMA Lines Logistics CRM & Telegram WebApp Engine
 * Fully responsive Kanban board, Employee workload management, Live notes feed, and Telegram WebApp integration.
 */

(function () {
  'use strict';

  // Telegram WebApp detection & initialization
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    // Sync Telegram theme if available
    if (tg.colorScheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  // Kanban Columns Definition
  const STATUSES = [
    { id: 'new', title: 'Новые заявки', color: '#3b82f6', icon: '📥' },
    { id: 'processing', title: 'В работе / Звонок', color: '#f59e0b', icon: '📞' },
    { id: 'calculation', title: 'Поиск авто / Расчёт', color: '#8b5cf6', icon: '🔍' },
    { id: 'in_transit', title: 'В рейсе / Исполнение', color: '#06b6d4', icon: '🚛' },
    { id: 'completed', title: 'Завершено / Оплачено', color: '#10b981', icon: '✅' },
  ];

  // Default fallback data if API is inaccessible
  const DEFAULT_EMPLOYEES = [
    { id: "emp-1", name: "Иван Ефимович", role: "Руководитель / Старший диспетчер", phone: "+375 (29) 123-45-01", telegram: "@ivan_asma", color: "#1d4ed8" },
    { id: "emp-2", name: "Ольга Смирнова", role: "Диспетчер-логист", phone: "+375 (29) 234-56-02", telegram: "@olga_dispatch", color: "#0d9488" },
    { id: "emp-3", name: "Дмитрий Прокопенко", role: "Диспетчер по междугороду", phone: "+375 (29) 345-67-03", telegram: "@dmitry_logist", color: "#d97706" },
    { id: "emp-4", name: "Александр Ковалёв", role: "Водитель-экспедитор (МАЗ 10т)", phone: "+375 (29) 456-78-04", telegram: "@kovalev_trans", color: "#64748b" }
  ];

  // State
  let leads = [];
  let employees = [];
  let currentEmployee = null;
  let activeFilterEmployee = 'all';
  let activeFilterType = 'all';
  let searchQuery = '';
  let activeLeadId = null;

  // Initialize
  async function init() {
    loadLocalCache();
    setupActiveEmployee();
    setupEventListeners();
    await fetchCrmData();
    renderAll();

    // Periodic sync every 20s
    setInterval(fetchCrmData, 20000);
  }

  function loadLocalCache() {
    try {
      const cached = localStorage.getItem('asma_crm_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        leads = parsed.leads || [];
        employees = parsed.employees || DEFAULT_EMPLOYEES;
      } else {
        employees = DEFAULT_EMPLOYEES;
      }
    } catch (e) {
      employees = DEFAULT_EMPLOYEES;
    }
  }

  function saveLocalCache() {
    try {
      localStorage.setItem('asma_crm_cache', JSON.stringify({ leads, employees }));
    } catch (e) {}
  }

  function setupActiveEmployee() {
    // Check if Telegram user is known
    const tgUser = tg?.initDataUnsafe?.user;
    const savedEmpId = localStorage.getItem('asma_crm_active_emp');
    
    if (savedEmpId) {
      currentEmployee = employees.find(e => e.id === savedEmpId) || employees[0];
    } else if (tgUser) {
      const tgUsername = tgUser.username ? `@${tgUser.username}`.toLowerCase() : '';
      const matched = employees.find(e => e.telegram && e.telegram.toLowerCase() === tgUsername);
      currentEmployee = matched || employees[0];
    } else {
      currentEmployee = employees[0] || { id: 'emp-guest', name: 'Диспетчер', role: 'Сотрудник', color: '#6B1E2D' };
    }

    renderActiveEmployeePill();
  }

  function renderActiveEmployeePill() {
    const pill = document.getElementById('current-employee-pill');
    if (!pill || !currentEmployee) return;

    const initials = currentEmployee.name.split(' ').map(n => n[0]).join('').substring(0, 2);
    pill.innerHTML = `
      <div class="emp-avatar" style="background-color: ${currentEmployee.color || '#6B1E2D'}">${initials}</div>
      <span>${escapeHtml(currentEmployee.name)}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
    `;
  }

  // API Calls
  async function fetchCrmData() {
    try {
      const res = await fetch('/api/crm/data');
      if (res.ok) {
        const data = await res.json();
        if (data.leads && Array.isArray(data.leads)) {
          leads = data.leads;
        }
        if (data.employees && Array.isArray(data.employees)) {
          employees = data.employees;
        }
        saveLocalCache();
        renderAll();
      }
    } catch (err) {
      console.warn('API sync failed, continuing with local store:', err.message);
    }
  }

  async function updateLeadOnServer(leadId, patchData) {
    // Optimistic local update
    const index = leads.findIndex(l => l.id === leadId);
    if (index !== -1) {
      leads[index] = { ...leads[index], ...patchData };
      saveLocalCache();
      renderAll();
    }

    try {
      await fetch(`/api/crm/lead/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...patchData,
          editorName: currentEmployee?.name || 'Диспетчер'
        })
      });
    } catch (e) {
      console.warn('Server patch failed:', e.message);
    }
  }

  async function addLeadNoteOnServer(leadId, text) {
    const author = currentEmployee?.name || 'Диспетчер';
    const note = {
      id: 'n-' + Date.now(),
      author: author,
      text: text.trim(),
      time: new Date().toISOString()
    };

    // Optimistic update
    const index = leads.findIndex(l => l.id === leadId);
    if (index !== -1) {
      leads[index].notes = leads[index].notes || [];
      leads[index].notes.unshift(note);
      saveLocalCache();
      renderModalNotes(leads[index]);
    }

    try {
      await fetch(`/api/crm/lead/${leadId}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, author })
      });
    } catch (e) {
      console.warn('Server note creation failed:', e.message);
    }
  }

  async function createLeadOnServer(payload) {
    try {
      const res = await fetch('/api/crm/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          creatorName: currentEmployee?.name || 'Диспетчер'
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.lead) {
          leads.unshift(data.lead);
          saveLocalCache();
          renderAll();
          return data.lead;
        }
      }
    } catch (e) {
      console.warn('Server create lead failed, fallback locally:', e.message);
    }

    // Local fallback
    const localLead = {
      id: 'lead-' + Date.now(),
      leadNumber: String(leads.length + 101),
      ...payload,
      createdAt: new Date().toISOString(),
      notes: [{ id: 'n-' + Date.now(), author: currentEmployee?.name || 'Диспетчер', text: 'Заявка создана вручную', time: new Date().toISOString() }]
    };
    leads.unshift(localLead);
    saveLocalCache();
    renderAll();
    return localLead;
  }

  // Rendering
  function renderAll() {
    renderStats();
    renderBoard();
    updateEmployeeFilters();
  }

  function renderStats() {
    const totalNode = document.getElementById('stat-total');
    const newNode = document.getElementById('stat-new');
    const procNode = document.getElementById('stat-processing');
    const transitNode = document.getElementById('stat-transit');
    const revNode = document.getElementById('stat-revenue');

    if (!totalNode) return;

    const total = leads.length;
    const newCount = leads.filter(l => l.status === 'new').length;
    const procCount = leads.filter(l => l.status === 'processing' || l.status === 'calculation').length;
    const transitCount = leads.filter(l => l.status === 'in_transit').length;

    let revenue = 0;
    leads.forEach(l => {
      if (l.status === 'completed' || l.status === 'in_transit') {
        const p = parseFloat(String(l.price || '').replace(/[^\d.]/g, ''));
        if (!isNaN(p)) revenue += p;
      }
    });

    totalNode.textContent = total;
    newNode.textContent = newCount;
    procNode.textContent = procCount;
    transitNode.textContent = transitCount;
    revNode.textContent = revenue > 0 ? `${Math.round(revenue).toLocaleString('ru-RU')} BYN` : '0 BYN';
  }

  function renderBoard() {
    const board = document.getElementById('crm-kanban-board');
    if (!board) return;

    // Filter leads
    const filtered = leads.filter(lead => {
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchNum = lead.leadNumber && String(lead.leadNumber).includes(q);
        const matchName = lead.name && lead.name.toLowerCase().includes(q);
        const matchContact = lead.contact && lead.contact.toLowerCase().includes(q);
        const matchRoute = lead.route && lead.route.toLowerCase().includes(q);
        if (!matchNum && !matchName && !matchContact && !matchRoute) return false;
      }

      // Employee filter
      if (activeFilterEmployee === 'mine') {
        if (lead.assignedTo !== currentEmployee?.id) return false;
      } else if (activeFilterEmployee === 'unassigned') {
        if (lead.assignedTo) return false;
      } else if (activeFilterEmployee !== 'all') {
        if (lead.assignedTo !== activeFilterEmployee) return false;
      }

      // Type filter
      if (activeFilterType !== 'all') {
        if (lead.type !== activeFilterType) return false;
      }

      return true;
    });

    // Render columns
    board.innerHTML = STATUSES.map(status => {
      const colLeads = filtered.filter(l => l.status === status.id);
      return `
        <div class="crm-column" data-status="${status.id}">
          <div class="crm-col-header">
            <div class="crm-col-title-wrap">
              <span class="crm-col-dot" style="background-color: ${status.color}"></span>
              <span class="crm-col-title">${status.icon} ${status.title}</span>
            </div>
            <span class="crm-col-count">${colLeads.length}</span>
          </div>
          <div class="crm-col-cards" id="col-${status.id}">
            ${colLeads.map(lead => renderCardHtml(lead, status.id)).join('')}
          </div>
        </div>
      `;
    }).join('');

    attachCardHandlers();
  }

  function renderCardHtml(lead, colStatus) {
    const assignedEmp = employees.find(e => e.id === lead.assignedTo);
    const badgeClass = lead.type === 'cargo' ? 'badge-cargo' : (lead.type === 'partner' ? 'badge-partner' : 'badge-contact');
    const badgeText = lead.type === 'cargo' ? 'Перевозка' : (lead.type === 'partner' ? 'Партнёр' : 'Связь');

    const statusIndex = STATUSES.findIndex(s => s.id === colStatus);
    const canMoveLeft = statusIndex > 0;
    const canMoveRight = statusIndex < STATUSES.length - 1;

    const initials = assignedEmp ? assignedEmp.name.split(' ').map(n => n[0]).join('').substring(0, 2) : '?';

    return `
      <div class="crm-card priority-${lead.priority || 'normal'}" data-id="${lead.id}">
        <div class="crm-card-top">
          <span class="crm-card-num">#${lead.leadNumber || '—'}</span>
          <span class="crm-badge ${badgeClass}">${badgeText}</span>
        </div>

        <div class="crm-card-client">${escapeHtml(lead.name || 'Без имени')}</div>

        <div class="crm-card-specs">
          <a href="tel:${escapeHtml(lead.contact || '')}" class="crm-spec-pill" style="text-decoration:none; color:inherit;" onclick="event.stopPropagation();">
            📞 ${escapeHtml(lead.contact || 'Не указан')}
          </a>
          ${lead.price ? `<span class="crm-spec-pill" style="font-weight:700; color:var(--crm-burgundy)">💰 ${escapeHtml(lead.price)}</span>` : ''}
        </div>

        ${lead.route && lead.route !== 'Маршрут по согласованию' ? `
          <div class="crm-card-route">
            📍 <span>${escapeHtml(lead.route)}</span>
          </div>
        ` : ''}

        ${lead.vehicle || lead.weight ? `
          <div class="crm-card-specs">
            ${lead.vehicle ? `<span class="crm-spec-pill">🚚 ${escapeHtml(lead.vehicle)}</span>` : ''}
            ${lead.weight ? `<span class="crm-spec-pill">⚖️ ${escapeHtml(lead.weight)}</span>` : ''}
          </div>
        ` : ''}

        <div class="crm-card-footer">
          <div class="crm-card-assigned" data-lead-id="${lead.id}" title="Назначить работника">
            <div class="emp-avatar" style="width:22px; height:22px; font-size:10px; background-color:${assignedEmp?.color || '#94a3b8'}">
              ${initials}
            </div>
            <span>${assignedEmp ? escapeHtml(assignedEmp.name.split(' ')[0]) : 'Назначить'}</span>
          </div>

          <div class="crm-card-actions">
            ${canMoveLeft ? `
              <button class="crm-btn-move" data-move="left" data-id="${lead.id}" title="Шаг назад" onclick="event.stopPropagation();">◀</button>
            ` : ''}
            ${canMoveRight ? `
              <button class="crm-btn-move" data-move="right" data-id="${lead.id}" title="Передать на след. этап" onclick="event.stopPropagation();">▶</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function attachCardHandlers() {
    // Open modal on card click
    document.querySelectorAll('.crm-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        openLeadModal(id);
      });
    });

    // Move buttons
    document.querySelectorAll('.crm-btn-move').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const dir = btn.getAttribute('data-move');
        moveLeadStep(id, dir);
      });
    });

    // Assign worker click in footer
    document.querySelectorAll('.crm-card-assigned').forEach(elem => {
      elem.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = elem.getAttribute('data-lead-id');
        openLeadModal(id, true);
      });
    });
  }

  function moveLeadStep(leadId, direction) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    const curIndex = STATUSES.findIndex(s => s.id === lead.status);
    let nextIndex = curIndex;

    if (direction === 'right' && curIndex < STATUSES.length - 1) {
      nextIndex = curIndex + 1;
    } else if (direction === 'left' && curIndex > 0) {
      nextIndex = curIndex - 1;
    }

    if (nextIndex !== curIndex) {
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
      }
      const newStatus = STATUSES[nextIndex].id;
      updateLeadOnServer(leadId, { status: newStatus });
    }
  }

  // Lead Details Modal
  function openLeadModal(leadId, focusAssign = false) {
    activeLeadId = leadId;
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    const modal = document.getElementById('lead-modal');
    const titleNode = document.getElementById('modal-lead-title');
    const contentNode = document.getElementById('modal-lead-content');

    titleNode.innerHTML = `
      <span>Заявка #${lead.leadNumber || ''}</span>
      <span class="crm-badge badge-${lead.type || 'cargo'}">${lead.category || 'Заявка'}</span>
    `;

    contentNode.innerHTML = `
      <!-- Status and Assigned Bar -->
      <div class="crm-form-row">
        <div class="crm-form-group">
          <label class="crm-form-label">Статус заявки:</label>
          <select id="modal-lead-status" class="crm-form-select">
            ${STATUSES.map(s => `
              <option value="${s.id}" ${s.id === lead.status ? 'selected' : ''}>${s.icon} ${s.title}</option>
            `).join('')}
          </select>
        </div>

        <div class="crm-form-group">
          <label class="crm-form-label">Ответственный сотрудник (Выдача):</label>
          <select id="modal-lead-assigned" class="crm-form-select">
            <option value="">— Не назначен —</option>
            ${employees.map(e => `
              <option value="${e.id}" ${e.id === lead.assignedTo ? 'selected' : ''}>👤 ${escapeHtml(e.name)} (${escapeHtml(e.role)})</option>
            `).join('')}
          </select>
        </div>
      </div>

      <!-- Quick contact buttons -->
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin:4px 0;">
        <a href="tel:${escapeHtml(lead.contact)}" class="crm-btn crm-btn-primary crm-btn-sm" style="text-decoration:none;">
          📞 Позвонить (${escapeHtml(lead.contact)})
        </a>
        ${lead.email ? `
          <a href="mailto:${escapeHtml(lead.email)}" class="crm-btn crm-btn-secondary crm-btn-sm" style="text-decoration:none;">
            📧 Написать email
          </a>
        ` : ''}
      </div>

      <!-- Lead Details Grid -->
      <div style="background:var(--crm-col-bg); border:1px solid var(--crm-border); border-radius:10px; padding:14px; display:flex; flex-direction:column; gap:8px;">
        <div style="font-size:12px; font-weight:700; color:var(--crm-burgundy); text-transform:uppercase;">Параметры рейса / Клиента:</div>
        <div><b>Клиент:</b> ${escapeHtml(lead.name || '—')}</div>
        <div><b>Контакты:</b> ${escapeHtml(lead.contact || '—')}</div>
        ${lead.route ? `<div><b>Маршрут:</b> 📍 ${escapeHtml(lead.route)} ${lead.distance ? `(${escapeHtml(lead.distance)})` : ''}</div>` : ''}
        ${lead.vehicle ? `<div><b>Транспорт:</b> 🚚 ${escapeHtml(lead.vehicle)}</div>` : ''}
        ${lead.weight ? `<div><b>Вес / Объём:</b> ⚖️ ${escapeHtml(lead.weight)} / ${escapeHtml(lead.volume || '—')}</div>` : ''}
        ${lead.price ? `<div><b>Ориентир стоимости:</b> 💰 ${escapeHtml(lead.price)}</div>` : ''}
        ${lead.comment ? `<div><b>Комментарий:</b> 💬 <i>${escapeHtml(lead.comment)}</i></div>` : ''}
      </div>

      <!-- Dispatcher Notes & Timeline -->
      <div class="crm-form-group">
        <label class="crm-form-label">Лента заметок диспетчеров:</label>
        <div style="display:flex; gap:8px;">
          <input type="text" id="modal-new-note-input" class="crm-form-input" placeholder="Добавьте заметку (водитель назначен, уточнение условий и т.д.)..." style="flex:1;">
          <button id="modal-add-note-btn" class="crm-btn crm-btn-primary">Отправить</button>
        </div>

        <div id="modal-notes-container" class="crm-notes-feed"></div>
      </div>
    `;

    renderModalNotes(lead);

    // Event listeners inside modal
    document.getElementById('modal-lead-status').addEventListener('change', (e) => {
      updateLeadOnServer(lead.id, { status: e.target.value });
    });

    document.getElementById('modal-lead-assigned').addEventListener('change', (e) => {
      updateLeadOnServer(lead.id, { assignedTo: e.target.value || null });
    });

    const noteInput = document.getElementById('modal-new-note-input');
    const noteBtn = document.getElementById('modal-add-note-btn');

    const handleAddNote = () => {
      const val = noteInput.value.trim();
      if (!val) return;
      addLeadNoteOnServer(lead.id, val);
      noteInput.value = '';
    };

    noteBtn.addEventListener('click', handleAddNote);
    noteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddNote();
    });

    modal.classList.add('active');
    if (focusAssign) {
      document.getElementById('modal-lead-assigned')?.focus();
    }
  }

  function renderModalNotes(lead) {
    const container = document.getElementById('modal-notes-container');
    if (!container) return;

    const notes = lead.notes || [];
    if (notes.length === 0) {
      container.innerHTML = `<div style="font-size:12px; color:var(--crm-text-muted); font-style:italic;">Заметок пока нет.</div>`;
      return;
    }

    container.innerHTML = notes.map(note => {
      const timeStr = note.time ? new Date(note.time).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
      return `
        <div class="crm-note-item">
          <div class="crm-note-meta">
            <span class="crm-note-author">${escapeHtml(note.author || 'Диспетчер')}</span>
            <span>${timeStr}</span>
          </div>
          <p class="crm-note-text">${escapeHtml(note.text)}</p>
        </div>
      `;
    }).join('');
  }

  // Employee Management Modal
  function openEmployeeModal() {
    const modal = document.getElementById('employee-modal');
    const listNode = document.getElementById('employee-list-container');

    listNode.innerHTML = employees.map(emp => {
      const activeCount = leads.filter(l => l.assignedTo === emp.id && l.status !== 'completed').length;
      return `
        <div style="display:flex; align-items:center; justify-content:space-between; background:var(--crm-col-bg); border:1px solid var(--crm-border); border-radius:10px; padding:12px 14px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="emp-avatar" style="background-color:${emp.color || '#1d4ed8'}; width:34px; height:34px; font-size:13px;">
              ${emp.name.split(' ').map(n => n[0]).join('').substring(0, 2)}
            </div>
            <div>
              <div style="font-weight:700; font-size:14px;">${escapeHtml(emp.name)}</div>
              <div style="font-size:12px; color:var(--crm-text-muted);">${escapeHtml(emp.role || 'Диспетчер')} • ${escapeHtml(emp.phone || '')}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <span class="crm-badge badge-cargo" title="Активных заявок в работе">${activeCount} в работе</span>
            <button class="crm-btn crm-btn-secondary crm-btn-sm set-current-emp-btn" data-id="${emp.id}">Выбрать меня</button>
          </div>
        </div>
      `;
    }).join('');

    document.querySelectorAll('.set-current-emp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const found = employees.find(e => e.id === id);
        if (found) {
          currentEmployee = found;
          localStorage.setItem('asma_crm_active_emp', id);
          renderActiveEmployeePill();
          modal.classList.remove('active');
        }
      });
    });

    modal.classList.add('active');
  }

  // Create Manual Lead Modal
  function openCreateLeadModal() {
    const modal = document.getElementById('create-lead-modal');
    const select = document.getElementById('new-lead-assigned');
    if (select) {
      select.innerHTML = `
        <option value="">— Назначить позже —</option>
        ${employees.map(e => `<option value="${e.id}" ${e.id === currentEmployee?.id ? 'selected' : ''}>👤 ${escapeHtml(e.name)}</option>`).join('')}
      `;
    }
    modal.classList.add('active');
  }

  // Setup Event Listeners
  function setupEventListeners() {
    // Search
    const searchInput = document.getElementById('crm-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderBoard();
      });
    }

    // Filter Employee
    const empSelect = document.getElementById('crm-filter-employee');
    if (empSelect) {
      empSelect.addEventListener('change', (e) => {
        activeFilterEmployee = e.target.value;
        renderBoard();
      });
    }

    // Filter Type
    const typeSelect = document.getElementById('crm-filter-type');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        activeFilterType = e.target.value;
        renderBoard();
      });
    }

    // Open Modals
    document.getElementById('btn-open-create-lead')?.addEventListener('click', openCreateLeadModal);
    document.getElementById('btn-open-employees')?.addEventListener('click', openEmployeeModal);
    document.getElementById('current-employee-pill')?.addEventListener('click', openEmployeeModal);

    // Export CSV
    document.getElementById('btn-export-csv')?.addEventListener('click', exportCsv);

    // Close Modals on Overlay Click or Close Button
    document.querySelectorAll('.crm-modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    document.querySelectorAll('.crm-modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.crm-modal-overlay')?.classList.remove('active');
      });
    });

    // Handle Create Lead Submit
    const createForm = document.getElementById('create-lead-form');
    if (createForm) {
      createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(createForm);
        const fromCity = fd.get('fromCity')?.toString().trim();
        const toCity = fd.get('toCity')?.toString().trim();
        const payload = {
          name: fd.get('name')?.toString().trim() || 'Клиент (звонок)',
          contact: fd.get('contact')?.toString().trim() || 'Не указан',
          type: fd.get('type')?.toString() || 'cargo',
          category: fd.get('type') === 'cargo' ? 'Заявка на перевозку груза' : 'Заявка на обратную связь',
          fromCity,
          toCity,
          route: (fromCity && toCity) ? `${fromCity} → ${toCity}` : 'По согласованию',
          vehicle: fd.get('vehicle')?.toString() || '',
          weight: fd.get('weight')?.toString() || '',
          price: fd.get('price')?.toString() || '',
          comment: fd.get('comment')?.toString() || '',
          assignedTo: fd.get('assignedTo')?.toString() || null,
          priority: fd.get('priority')?.toString() || 'normal',
          status: 'new'
        };

        await createLeadOnServer(payload);
        createForm.reset();
        document.getElementById('create-lead-modal')?.classList.remove('active');
      });
    }

    // Handle Add Employee Submit
    const addEmpForm = document.getElementById('add-employee-form');
    if (addEmpForm) {
      addEmpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(addEmpForm);
        const name = fd.get('name')?.toString().trim();
        if (!name) return;

        const newEmp = {
          id: 'emp-' + Date.now(),
          name,
          role: fd.get('role')?.toString().trim() || 'Диспетчер',
          phone: fd.get('phone')?.toString().trim() || '',
          telegram: fd.get('telegram')?.toString().trim() || '',
          color: fd.get('color')?.toString() || '#1d4ed8'
        };

        employees.push(newEmp);
        saveLocalCache();
        try {
          await fetch('/api/crm/employee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newEmp)
          });
        } catch (err) {}

        addEmpForm.reset();
        openEmployeeModal();
        updateEmployeeFilters();
      });
    }
  }

  function updateEmployeeFilters() {
    const filterSelect = document.getElementById('crm-filter-employee');
    if (!filterSelect) return;

    const currentVal = filterSelect.value;
    filterSelect.innerHTML = `
      <option value="all">👥 Все сотрудники</option>
      <option value="mine">⭐️ Мои заявки</option>
      <option value="unassigned">⚠️ Не назначены</option>
      ${employees.map(e => `<option value="${e.id}">👤 ${escapeHtml(e.name)}</option>`).join('')}
    `;
    filterSelect.value = currentVal || 'all';
  }

  function exportCsv() {
    const rows = [
      ['№ Заявки', 'Статус', 'Тип', 'Клиент', 'Контакты', 'Маршрут', 'Транспорт', 'Вес', 'Стоимость', 'Ответственный', 'Дата создания']
    ];

    leads.forEach(l => {
      const emp = employees.find(e => e.id === l.assignedTo);
      rows.push([
        l.leadNumber || '',
        l.status || '',
        l.category || '',
        `"${(l.name || '').replace(/"/g, '""')}"`,
        `"${(l.contact || '').replace(/"/g, '""')}"`,
        `"${(l.route || '').replace(/"/g, '""')}"`,
        `"${(l.vehicle || '').replace(/"/g, '""')}"`,
        `"${(l.weight || '').replace(/"/g, '""')}"`,
        `"${(l.price || '').replace(/"/g, '""')}"`,
        `"${(emp ? emp.name : 'Не назначен').replace(/"/g, '""')}"`,
        l.createdAt ? new Date(l.createdAt).toLocaleDateString('ru-RU') : ''
      ]);
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.map(e => e.join(';')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `asma_crm_leads_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Start app on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
