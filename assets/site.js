/* ============================================================
   ASMA Lines — site script
   Forms post to the site's own API (own CRM on Cloudflare D1):
     site → /api/lead → Cloudflare Worker → D1 (+ Telegram notification)
   Server-side secrets never belong in client-side code.
   ============================================================ */

/* Тарифы вынесены в assets/pricing-client.js (window.ASMA_PRICING):
   здесь была вторая копия ставок, которая расходилась с калькулятором. */
const MOBILE_BREAKPOINT = 1100; // keeps the expanded B2B navigation from crowding medium-width screens

const header = document.querySelector('.site-header');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* favicon fallback */
if (!document.querySelector('link[rel="icon"]')) {
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/svg+xml';
  favicon.href = 'assets/brand/asma-mark.svg?v=20260926';
  document.head.append(favicon);
}

/* Печать документа: вынесено из inline-атрибутов onclick,
   чтобы работал строгий Content-Security-Policy. */
document.addEventListener('click', (event) => {
  const printButton = event.target.closest('[data-action="print"]');
  if (printButton) {
    event.preventDefault();
    window.print();
    return;
  }
  const closeButton = event.target.closest('[data-action="close-window"]');
  if (closeButton) {
    event.preventDefault();
    window.close();
    return;
  }
  const consultButton = event.target.closest('[data-action="quick-consult"]');
  if (consultButton) {
    event.preventDefault();
    const target = document.getElementById(consultButton.dataset.target || 'btn-quick-consult');
    if (target) target.click();
    return;
  }
  /* Кнопки и вкладки страницы документа обрабатывает сам order-doc.js:
     site.js на той странице не подключён, а дублирование обработчиков
     привело бы к двойным срабатываниям. */
});

/* sticky header border */
if (header) {
  const setHeaderState = () => header.classList.toggle('is-scrolled', window.scrollY > 4);
  setHeaderState();
  window.addEventListener('scroll', setHeaderState, { passive: true });
}

/* theme */
const themeButtons = document.querySelectorAll('.theme-toggle');
let savedTheme = null;
try { savedTheme = localStorage.getItem('asma-theme'); } catch (error) { /* storage unavailable */ }

if (!savedTheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  savedTheme = 'dark';
}

function updateBrandLogos(dark) {
  const v = '20260926';
  const markSrc = dark ? `assets/brand/asma-mark-dark.svg?v=${v}` : `assets/brand/asma-mark-light.svg?v=${v}`;
  const fullLogoSrc = dark ? `assets/brand/asma-logo-dark.svg?v=${v}` : `assets/brand/asma-logo-light.svg?v=${v}`;

  document.querySelectorAll('img.brand-logo, img[data-brand-logo]').forEach((img) => {
    // Подвал всегда тёмный (в обеих темах): логотип там должен быть светлым,
    // иначе в светлой теме тёмный знак сливается с фоном.
    const onDarkSurface = Boolean(img.closest('.site-footer'));
    const imgMarkSrc = onDarkSurface ? `assets/brand/asma-mark-dark.svg?v=${v}` : markSrc;
    const imgFullSrc = onDarkSurface ? `assets/brand/asma-logo-dark.svg?v=${v}` : fullLogoSrc;
    img.onerror = function() {
      if (!this.dataset.fallbackApplied) {
        this.dataset.fallbackApplied = 'true';
        this.src = `assets/brand/asma-mark.svg?v=${v}`;
      }
    };
    if (img.classList.contains('brand-logo--full') || img.dataset.brandLogo === 'full') {
      img.src = imgFullSrc;
    } else {
      img.src = imgMarkSrc;
    }
  });

  const svgFavicon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
  if (svgFavicon) {
    svgFavicon.href = markSrc;
  }
}

function setTheme(dark, animate = false) {
  if (animate) {
    document.documentElement.classList.add('is-theme-transitioning');
    document.body.classList.add('is-theme-transitioning');
    setTimeout(() => {
      document.documentElement.classList.remove('is-theme-transitioning');
      document.body.classList.remove('is-theme-transitioning');
    }, 400);
  }
  const theme = dark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
  if (dark) {
    document.documentElement.classList.add('theme-dark');
    document.body.dataset.theme = 'dark';
  } else {
    document.documentElement.classList.remove('theme-dark');
    delete document.body.dataset.theme;
  }
  try { localStorage.setItem('asma-theme', theme); } catch (error) { /* ignore */ }
  themeButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    btn.setAttribute('title', dark ? 'Светлая тема' : 'Тёмная тема');
  });

  updateBrandLogos(dark);

  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme, dark } }));
}

setTheme(savedTheme === 'dark', false);

// Ensure logos are updated when DOM is fully ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body.dataset.theme === 'dark';
    updateBrandLogos(isDark);
  });
} else {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body.dataset.theme === 'dark';
  updateBrandLogos(isDark);
}

themeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || document.body.dataset.theme === 'dark';
    setTheme(!isDark, true);
  });
});

/* year */
document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });

/* mobile menu */
const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('#main-nav');
function setMenuOpen(open) {
  if (!nav || !menu) return;
  nav.classList.toggle('open', open);
  menu.classList.toggle('is-open', open);
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  document.body.style.overflow = open && window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches ? 'hidden' : '';
}
if (menu && nav) {
  menu.addEventListener('click', () => setMenuOpen(!nav.classList.contains('open')));
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => { setMenuOpen(false); closeNavDropdowns(); }));
  document.addEventListener('click', (event) => {
    if (nav.classList.contains('open') && !nav.contains(event.target) && !menu.contains(event.target)) {
      setMenuOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('open')) setMenuOpen(false);
  });
  window.addEventListener('resize', () => {
    if (window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT + 1}px)`).matches) {
      setMenuOpen(false);
      nav.querySelectorAll('.nav-dropdown.open').forEach((dd) => {
        dd.classList.remove('open');
        const btn = dd.querySelector('.nav-link');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      });
    }
  });
}

/* Dropdowns: click works on desktop and touch; keyboard focus and hover are supported too. */
const navDropdowns = [...document.querySelectorAll('.nav-dropdown')];
function setDropdownOpen(dropdown, open) {
  if (!dropdown) return;
  dropdown.classList.toggle('open', open);
  const button = dropdown.querySelector('.nav-link');
  if (button) button.setAttribute('aria-expanded', String(open));
}
function closeNavDropdowns(except = null) {
  navDropdowns.forEach((dropdown) => { if (dropdown !== except) setDropdownOpen(dropdown, false); });
}
navDropdowns.forEach((dd) => {
  const btn = dd.querySelector('.nav-link');
  if (!btn) return;
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    const shouldOpen = !dd.classList.contains('open');
    closeNavDropdowns(dd);
    setDropdownOpen(dd, shouldOpen);
  });
  dd.addEventListener('mouseenter', () => {
    if (!window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches) {
      closeNavDropdowns(dd);
      btn.setAttribute('aria-expanded', 'true');
    }
  });
  dd.addEventListener('mouseleave', () => {
    if (!window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches && !dd.classList.contains('open') && !dd.contains(document.activeElement)) {
      btn.setAttribute('aria-expanded', 'false');
    }
  });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.nav-dropdown')) closeNavDropdowns();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeNavDropdowns();
    if (nav?.classList.contains('open')) setMenuOpen(false);
  }
});

/* Mark the current page consistently, including items inside dropdowns. */
function normalizeRoutePath(value) {
  let path = String(value || '/').split('?')[0].split('#')[0];
  path = path.replace(/\.html$/i, '').replace(/\/+$/, '') || '/';
  if (path === '/index') path = '/';
  return path;
}
if (nav) {
  const currentPath = normalizeRoutePath(window.location.pathname);
  nav.querySelectorAll('[data-route]').forEach((link) => {
    const isCurrent = normalizeRoutePath(link.dataset.route) === currentPath;
    link.classList.toggle('active', isCurrent);
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    const parent = link.closest('.nav-dropdown');
    if (parent && isCurrent) {
      parent.classList.add('active');
      const trigger = parent.querySelector('.nav-link');
      if (trigger) trigger.classList.add('active');
    }
  });
}

/* Subtle progressive reveal: content remains visible if motion APIs are unavailable. */
if (!reducedMotion && 'IntersectionObserver' in window) {
  document.body.classList.add('has-scroll-reveal');
  document.querySelectorAll('main > section:not(.hero):not(.final), .steps li, .route, .svc, .qa details, .std article')
    .forEach((node) => node.setAttribute('data-reveal', ''));
}

/* Optional pointer spotlight on large-screen cards; no canvas, WebGL or touch overhead. */
if (!reducedMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
  document.querySelectorAll('.route, .svc, .steps li, .qa details, .std article, .pf, .svc-row').forEach((node) => {
    node.classList.add('spotlight-surface');
    node.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      const rect = node.getBoundingClientRect();
      node.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
      node.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
    }, { passive: true });
    node.addEventListener('pointerleave', () => {
      node.style.removeProperty('--spot-x');
      node.style.removeProperty('--spot-y');
    }, { passive: true });
  });
}

/* reveal on scroll */
const revealTargets = document.querySelectorAll('[data-reveal]');
revealTargets.forEach((node, index) => {
  node.style.transitionDelay = `${Math.min((index % 4) * 50, 150)}ms`;
});

if (reducedMotion || !('IntersectionObserver' in window)) {
  revealTargets.forEach((node) => node.classList.add('is-visible'));
} else {
  const observer = new IntersectionObserver((entries, activeObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        activeObserver.unobserve(entry.target);
      }
    });
  }, { threshold: .12 });
  revealTargets.forEach((node) => observer.observe(node));
}

/* ------------------------------------------------------------
   Express Route Calculator Component
   ------------------------------------------------------------ */
function initRouteConstructorAndNetwork() {
  const panel = document.getElementById("geography-network-section");
  if (!panel) return;

  // Approximate route-distance reference only. Travel time, vehicle availability and price are confirmed separately.
  const ROUTE_MATRIX = {
    "Гомель-Минск": { km: 310 },
    "Минск-Гомель": { km: 310 },
    "Гомель-Брест": { km: 530 },
    "Брест-Гомель": { km: 530 },
    "Гомель-Гродно": { km: 580 },
    "Гродно-Гомель": { km: 580 },
    "Гомель-Витебск": { km: 330 },
    "Витебск-Гомель": { km: 330 },
    "Гомель-Могилёв": { km: 180 },
    "Могилёв-Гомель": { km: 180 },
    "Минск-Брест": { km: 350 },
    "Брест-Минск": { km: 350 },
    "Минск-Гродно": { km: 290 },
    "Гродно-Минск": { km: 290 },
    "Минск-Витебск": { km: 290 },
    "Витебск-Минск": { km: 290 },
    "Минск-Могилёв": { km: 200 },
    "Могилёв-Минск": { km: 200 },
    "Гомель-Мозырь": { km: 135 },
    "Мозырь-Гомель": { km: 135 },
    "Гомель-Жлобин": { km: 90 },
    "Жлобин-Гомель": { km: 90 },
    "Гомель-Речица": { km: 45 },
    "Речица-Гомель": { km: 45 },
    "Минск-Барановичи": { km: 145 },
    "Барановичи-Минск": { km: 145 },
    "Минск-Бобруйск": { km: 150 },
    "Бобруйск-Минск": { km: 150 },
    "Минск-Пинск": { km: 300 },
    "Пинск-Минск": { km: 300 },
    "Минск-Полоцк": { km: 250 },
    "Полоцк-Минск": { km: 250 },
    "Минск-Орша": { km: 220 },
    "Орша-Минск": { km: 220 },
    "Минск-Борисов": { km: 75 },
    "Борисов-Минск": { km: 75 },
    "Минск-Солигорск": { km: 135 },
    "Солигорск-Минск": { km: 135 },
    "Минск-Лида": { km: 170 },
    "Лида-Минск": { km: 170 },
    "Брест-Пинск": { km: 180 },
    "Пинск-Брест": { km: 180 },
    "Гродно-Лида": { km: 110 },
    "Лида-Гродно": { km: 110 },
    "Витебск-Полоцк": { km: 105 },
    "Полоцк-Витебск": { km: 105 },
  };

  // City Coordinates for fallback Haversine distance
  const CITY_COORDS = {
    "Гомель": [52.4345, 30.9754],
    "Минск": [53.9006, 27.5590],
    "Брест": [52.0976, 23.7341],
    "Гродно": [53.6884, 23.8258],
    "Витебск": [55.1904, 30.2049],
    "Могилёв": [53.8981, 30.3325],
    "Барановичи": [53.1327, 26.0139],
    "Бобруйск": [53.1384, 29.2214],
    "Пинск": [52.1153, 26.0954],
    "Мозырь": [52.0495, 29.2456],
    "Полоцк": [55.4856, 28.7684],
    "Орша": [54.5085, 30.4285],
    "Лида": [53.8833, 25.3000],
    "Борисов": [54.2276, 28.5050],
    "Солигорск": [52.7876, 27.5415],
    "Жлобин": [52.8926, 30.0367],
    "Светлогорск": [52.6333, 29.7333],
    "Речица": [52.3667, 30.4000],
    "Сморгонь": [54.4833, 26.4000],
    "Кобрин": [52.2139, 24.3564],
    "Слоним": [53.0869, 25.3183],
    "Осиповичи": [53.3000, 28.6333],
    "Берёза": [52.5333, 24.9833],
    "Ивацевичи": [52.7167, 25.3333],
    "Дзержинск": [53.6833, 27.1333],
    "Вилейка": [54.5000, 26.9167],
    "Кричев": [53.7167, 31.7167],
    "Горки": [54.2833, 30.9833],
    "Добруш": [52.4167, 31.3000],
    "Житковичи": [52.2167, 27.8500],
    "Калинковичи": [52.1333, 29.3333],
    "Рогачёв": [53.0833, 30.0500]
  };

  function calcFallbackKm(fromCity, toCity) {
    const c1 = CITY_COORDS[fromCity];
    const c2 = CITY_COORDS[toCity];
    if (!c1 || !c2) return 200;
    const R = 6371;
    const dLat = (c2[0] - c1[0]) * Math.PI / 180;
    const dLon = (c2[1] - c1[1]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(c1[0] * Math.PI / 180) * Math.cos(c2[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(a));
    return Math.round(d * 1.25); // Road winding coefficient
  }

  // DOM Elements
  const originSelect = document.getElementById("routeOriginSelect");
  const destSelect = document.getElementById("routeDestSelect");
  const btnSwap = document.getElementById("btnSwapRoute");
  
  const originBadge = document.getElementById("routeOriginBadge");
  const destBadge = document.getElementById("routeDestBadge");
  const corridorTag = document.getElementById("routeCorridorTag");
  const distVal = document.getElementById("summaryDistanceVal");
  const timeVal = document.getElementById("summaryTimeVal");
  const leadVal = document.getElementById("summaryLeadVal");
  const costVal = document.getElementById("summaryCostVal");
  const calcLink = document.getElementById("routeCalcDirectLink");
  const corridorsList = document.getElementById("popularCorridorsList");

  function ensureOptionExists(selectEl, cityName) {
    if (!selectEl) return;
    let exists = false;
    for (let i = 0; i < selectEl.options.length; i++) {
      if (selectEl.options[i].value === cityName) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = cityName;
      opt.textContent = cityName;
      selectEl.appendChild(opt);
    }
  }

  // В разметке <select> может оказаться пустым (раньше из-за этого «Откуда» было пустым,
  // а в «Куда» стоял Минск). Заполняем список городов сами: областные центры первыми, остальные по алфавиту.
  const PRIORITY_CITIES = ["Минск", "Брест", "Витебск", "Гомель", "Гродно", "Могилёв"];
  function populateCitySelect(selectEl, defaultCity) {
    if (!selectEl) return;
    if (selectEl.options.length === 0) {
      const all = Object.keys(CITY_COORDS);
      const rest = all.filter((c) => !PRIORITY_CITIES.includes(c)).sort((a, b) => a.localeCompare(b, "ru"));
      PRIORITY_CITIES.filter((c) => all.includes(c)).concat(rest).forEach((c) => ensureOptionExists(selectEl, c));
    }
    if (!selectEl.value && defaultCity) selectEl.value = defaultCity;
  }
  populateCitySelect(originSelect, "Минск");
  populateCitySelect(destSelect, "Брест");

  // Update Route Info
  function updateRoute() {
    if (!originSelect || !destSelect) return;
    let from = originSelect.value.trim();
    let to = destSelect.value.trim();

    if (from === to) {
      if (from === "Минск") to = "Брест";
      else to = "Минск";
      ensureOptionExists(destSelect, to);
      destSelect.value = to;
    }

    if (originBadge) originBadge.textContent = from;
    if (destBadge) destBadge.textContent = to;

    const pairKey = `${from}-${to}`;
    const pairKeyRev = `${to}-${from}`;
    const known = ROUTE_MATRIX[pairKey] || ROUTE_MATRIX[pairKeyRev];

    const km = known ? known.km : calcFallbackKm(from, to);
    const routeLabel = "Ориентировочное расстояние";

    if (distVal) distVal.textContent = `≈ ${km} км`;
    const mapKm = document.getElementById("routeMapKm");
    if (mapKm) mapKm.textContent = `≈ ${km} км`;
    if (timeVal) timeVal.textContent = "Время в пути уточняется по заявке";
    if (leadVal) leadVal.textContent = "Подача — по согласованию";
    if (costVal) costVal.textContent = "Рассчитываем на сервере…";
    if (corridorTag) corridorTag.textContent = routeLabel;

    // All price previews come from the Worker endpoint, never from browser-only constants.
    const quoteRequestId = (updateRoute.requestId || 0) + 1;
    updateRoute.requestId = quoteRequestId;
    fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ distanceKm: km, weightTons: 2.5 })
    }).then((response) => response.ok ? response.json() : Promise.reject(new Error('quote unavailable')))
      .then((data) => {
        if (updateRoute.requestId !== quoteRequestId || !costVal) return;
        const amount = Number(data?.quote?.total);
        costVal.textContent = data?.ok && Number.isFinite(amount) && amount > 0
          ? `≈ ${amount.toLocaleString('ru-RU')} BYN`
          : 'Стоимость уточняется в калькуляторе';
      })
      .catch(() => {
        if (updateRoute.requestId === quoteRequestId && costVal) costVal.textContent = 'Стоимость уточняется в калькуляторе';
      });

    if (calcLink) {
      calcLink.href = `calculator?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    }

    if (corridorsList) {
      corridorsList.querySelectorAll(".corridor-pill").forEach((btn) => {
        const f = btn.dataset.from;
        const t = btn.dataset.to;
        const isActive = (from === f && to === t) || (from === t && to === f);
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }
  }

  // Swap Direction with continuous rotation
  if (btnSwap) {
    let swapRotation = 0;
    btnSwap.addEventListener("click", () => {
      swapRotation += 180;
      btnSwap.style.transform = `rotate(${swapRotation}deg)`;
      const from = originSelect.value;
      const to = destSelect.value;
      ensureOptionExists(originSelect, to);
      ensureOptionExists(destSelect, from);
      originSelect.value = to;
      destSelect.value = from;
      updateRoute();
    });
  }

  if (originSelect) originSelect.addEventListener("change", updateRoute);
  if (destSelect) destSelect.addEventListener("change", updateRoute);

  // Popular Corridors Click
  if (corridorsList) {
    corridorsList.addEventListener("click", (e) => {
      const btn = e.target.closest(".corridor-pill");
      if (!btn) return;
      const f = btn.dataset.from;
      const t = btn.dataset.to;
      if (f && t) {
        ensureOptionExists(originSelect, f);
        ensureOptionExists(destSelect, t);
        originSelect.value = f;
        destSelect.value = t;
        updateRoute();
      }
    });
  }

  // Initial populate & setup
  updateRoute();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRouteConstructorAndNetwork);
} else {
  initRouteConstructorAndNetwork();
}


async function submitLead(payload, statusNode, successMessage) {
  if (statusNode) {
    statusNode.textContent = 'Отправляем данные…';
    statusNode.className = 'form-status form-status--loading';
  }

  let sent = false;
  let failureReason = '';

  // Единственный путь отправки — /api/lead (Worker на Cloudflare или локальный сервер).
  // Раньше ниже лежал «фолбэк», который считал письмо и тут же присваивал
  // sent = false, то есть не отправлял ничего и лишь шумел в консоль.
  try {
    const response = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => null);

    if (response.ok && result && (result.success === true || result.ok === true)) {
      sent = true;
      // Подтверждаем клиенту номер заявки, если сервер его вернул.
      if (result.leadNumber && statusNode) {
        successMessage = `Заявка № ${result.leadNumber} принята. Диспетчер свяжется с вами.`;
      }
    } else if (result && (result.error || result.message)) {
      failureReason = result.error || result.message;
    } else if (response.status === 429) {
      failureReason = 'Слишком много заявок. Попробуйте через минуту.';
    } else if (!response.ok) {
      failureReason = `Сервер вернул ошибку ${response.status}`;
    }
  } catch (error) {
    failureReason = 'Нет связи с сервером';
    console.warn('/api/lead недоступен:', error);
  }

  if (sent) {
    if (statusNode) {
      statusNode.textContent = successMessage;
      statusNode.className = 'form-status form-status--success';
    }
    return true;
  }

  if (statusNode) {
    statusNode.textContent = failureReason
      ? `${failureReason} Позвоните нам: +375 (29) 600-00-00.`
      : 'Не удалось отправить заявку. Пожалуйста, позвоните нам или попробуйте ещё раз.';
    statusNode.className = 'form-status form-status--error';
  }
  return false;
}

/* contact & lead forms */
document.querySelectorAll('[data-contact-form]').forEach((formElem) => {
  formElem.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(formElem);
    const btn = formElem.querySelector('button[type="submit"]');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Отправка…';
    }
    const statusNode = formElem.querySelector('.form-status');
    const ok = await submitLead({
      name: data.get('name') || '',
      contact: data.get('contact') || '',
      email: data.get('email') || '',
      message: data.get('message') || '',
      topic: data.get('topic') || '',
      preferred_channel: data.get('preferred_channel') || '',
      fromCity: data.get('fromCity') || undefined,
      toCity: data.get('toCity') || undefined,
      distance: data.get('distance') || undefined,
      vehicle: data.get('vehicle') || undefined,
      weight: data.get('weight') || undefined,
      volume: data.get('volume') || undefined,
      price: data.get('price') || undefined,
      route_details: data.get('route_details') || undefined,
      source: data.get('source') || 'website_contacts',
    }, statusNode, (data.get('source') === 'website_contacts' ? 'Запрос принят! Мы свяжемся с вами, чтобы обсудить формат сотрудничества.' : 'Заявка принята! Диспетчер свяжется с вами по заявке.'));
    
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
    if (ok) {
      formElem.reset();
      // Reset topic chips to first item
      const topicChips = formElem.querySelectorAll('.contact-topic-chip');
      if (topicChips.length) {
        topicChips.forEach((c, idx) => c.classList.toggle('is-active', idx === 0));
        const topicInput = formElem.querySelector('#contactFormTopic');
        if (topicInput) topicInput.value = topicChips[0].dataset.topic || '';
      }
      // Reset channel chips to first item
      const channelChips = formElem.querySelectorAll('.channel-chip');
      if (channelChips.length) {
        channelChips.forEach((c, idx) => c.classList.toggle('is-active', idx === 0));
        const channelInput = formElem.querySelector('#contactFormChannel');
        if (channelInput) channelInput.value = channelChips[0].dataset.channel || '';
      }
      const modal = formElem.closest('.modal-backdrop');
      if (modal) {
        setTimeout(() => {
          modal.classList.remove('is-open');
          modal.setAttribute('aria-hidden', 'true');
          document.body.style.overflow = '';
          if (statusNode) {
            statusNode.textContent = '';
            statusNode.className = 'form-status';
          }
        }, 2200);
      }
    }
  });
});

/* Contact form topic chips & communication channel chips */
document.querySelectorAll('.contact-topic-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const parent = chip.closest('.contact-topic-chips');
    if (!parent) return;
    parent.querySelectorAll('.contact-topic-chip').forEach((c) => {
      c.classList.remove('is-active');
      c.setAttribute('aria-pressed', 'false');
    });
    chip.classList.add('is-active');
    chip.setAttribute('aria-pressed', 'true');
    const input = document.getElementById('contactFormTopic');
    if (input) input.value = chip.dataset.topic || '';
    
    // Context-sensitive placeholder for message textarea
    const msg = document.getElementById('contactFormMessage');
    if (msg) {
      if (chip.dataset.topic === 'Регулярные поставки') {
        msg.placeholder = 'Основные направления, частота перевозок, примерный объём в месяц и типы грузов.';
      } else if (chip.dataset.topic === 'Договор / условия') {
        msg.placeholder = 'Реквизиты компании, планируемые регулярные направления и ориентировочный объём';
      } else if (chip.dataset.topic === 'Пока изучаю варианты') {
        msg.placeholder = 'Расскажите, что важно учесть при выборе логистического партнёра.';
      } else {
        msg.placeholder = 'Укажите, пожалуйста, направления, частоту и ориентировочные объёмы перевозок.';
      }
    }
  });
});

document.querySelectorAll('.channel-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const parent = chip.closest('.channel-chips');
    if (!parent) return;
    parent.querySelectorAll('.channel-chip').forEach((c) => {
      c.classList.remove('is-active');
      c.setAttribute('aria-pressed', 'false');
    });
    chip.classList.add('is-active');
    chip.setAttribute('aria-pressed', 'true');
    const input = document.getElementById('contactFormChannel');
    if (input) input.value = chip.dataset.channel || '';
  });
});

/* partners form */
document.querySelectorAll('[data-partners-form]').forEach((partnersForm) => {
  const roleTabs = partnersForm.querySelectorAll('.partner-role-tab');
  const roleInput = partnersForm.querySelector('#partnerRoleInput');
  const carrierChips = partnersForm.querySelector('#carrierFleetChipsWrap');
  const shipperChips = partnersForm.querySelector('#shipperChipsWrap');
  const transportLabel = partnersForm.querySelector('#labelTransportOrRoutes');
  const transportInput = partnersForm.querySelector('#partnerTransportInput');
  const submitBtn = partnersForm.querySelector('#partnerSubmitBtn');
  const chips = partnersForm.querySelectorAll('.partner-fleet-chip');

  if (roleTabs.length) {
    roleTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        roleTabs.forEach((t) => {
          t.classList.remove('is-active');
          t.setAttribute('aria-pressed', 'false');
        });
        tab.classList.add('is-active');
        tab.setAttribute('aria-pressed', 'true');
        const role = tab.getAttribute('data-role');

        if (role === 'carrier') {
          if (roleInput) roleInput.value = 'carrier';
          if (carrierChips) carrierChips.style.display = 'block';
          if (shipperChips) shipperChips.style.display = 'none';
          if (transportLabel) transportLabel.textContent = 'Транспорт, базирование и направления *';
          if (transportInput) transportInput.placeholder = 'Например: Тент 20т, базирование в Гомеле, рейсы в Минск и по Беларуси';
          if (submitBtn) submitBtn.textContent = 'Отправить анкету перевозчика →';
        } else if (role === 'shipper') {
          if (roleInput) roleInput.value = 'shipper';
          if (carrierChips) carrierChips.style.display = 'none';
          if (shipperChips) shipperChips.style.display = 'block';
          if (transportLabel) transportLabel.textContent = 'Маршруты и характер регулярных отгрузок *';
          if (transportInput) transportInput.placeholder = 'Например: Регулярные рейсы Минск — Гомель, паллеты, 2 раза в неделю';
          if (submitBtn) submitBtn.textContent = 'Отправить заявку грузовладельца →';
        } else if (role === 'forwarder') {
          if (roleInput) roleInput.value = 'forwarder';
          if (carrierChips) carrierChips.style.display = 'block';
          if (shipperChips) shipperChips.style.display = 'none';
          if (transportLabel) transportLabel.textContent = 'Специализация и приоритетные направления *';
          if (transportInput) transportInput.placeholder = 'Например: Сборные грузы, тенты и рефы по Беларуси';
          if (submitBtn) submitBtn.textContent = 'Предложить экспедиторское партнёрство →';
        }
      });
    });
  }

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const parentWrap = chip.closest('.partner-fleet-chips-wrap');
      if (parentWrap) {
        parentWrap.querySelectorAll('.partner-fleet-chip').forEach((c) => {
          c.classList.remove('is-active');
          c.setAttribute('aria-pressed', 'false');
        });
      }
      chip.classList.add('is-active');
      chip.setAttribute('aria-pressed', 'true');
      const val = chip.getAttribute('data-fleet');
      if (transportInput && val) {
        transportInput.value = val;
        transportInput.focus();
      }
    });
  });

  partnersForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(partnersForm);
    const btn = partnersForm.querySelector('button[type="submit"]');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Отправка анкеты…';
    }
    const statusNode = partnersForm.querySelector('.form-status');
    // Роль берём из активной вкладки: скрытое поле сбрасывается после form.reset().
    const activeTab = partnersForm.querySelector('.partner-role-tab.is-active');
    const partnerRole = (activeTab && activeTab.getAttribute('data-role')) || data.get('partner_role') || 'carrier';
    const ok = await submitLead({
      partner_role: partnerRole,
      company: data.get('company') || '',
      contact_name: data.get('contact_name') || '',
      contact: data.get('contact') || '',
      email: data.get('email') || '',
      direction: data.get('direction') || '',
      message: data.get('message') || '',
      source: 'website_partners',
    }, statusNode, 'Спасибо! Анкета принята. Логист свяжется с вами по заявке для обсуждения условий сотрудничества.');
    
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
    if (ok) {
      partnersForm.reset();
      chips.forEach((c) => c.classList.remove('is-active'));
      // reset() вернул скрытое поле к значению по умолчанию — синхронизируем с активной вкладкой.
      if (roleInput && activeTab) roleInput.value = activeTab.getAttribute('data-role');
    }
  });
});

/* Auto-inject floating contact ring widget at bottom-right */
function initFloatingContactWidget() {
  if (document.getElementById("floatingContactWidget")) return;

  const container = document.createElement("div");
  container.id = "floatingContactWidget";
  container.className = "floating-contact-widget";
  container.innerHTML = `
    <div class="floating-contact-card" id="floatingContactCard" aria-hidden="true">
      <div class="fcc-header">
        <div class="fcc-title">Быстрая связь</div>
        <button type="button" class="fcc-close" id="fccCloseBtn" aria-label="Закрыть">✕</button>
      </div>
      <div class="fcc-body">
        <p class="fcc-desc">Дежурный логист ASMA Lines на связи. Выберите удобный способ:</p>
        <div class="fcc-links">
          <a href="tel:+375296000000" class="fcc-btn fcc-btn-call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>Позвонить +375 (29) 600-00-00</span>
          </a>
          <a href="https://t.me/asmalinesbot" target="_blank" rel="noopener" class="fcc-btn fcc-btn-tg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
            <span>Написать в Telegram</span>
          </a>
          <a href="calculator" class="fcc-btn fcc-btn-calc">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>
            <span>Рассчитать перевозку</span>
          </a>
        </div>
      </div>
    </div>

    <button type="button" class="floating-contact-trigger" id="floatingContactTrigger" aria-label="Быстрая связь" title="Связаться с логистом">
      <span class="floating-contact-ring"></span>
      <span class="floating-contact-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </span>
    </button>
  `;

  document.body.appendChild(container);

  const trigger = document.getElementById("floatingContactTrigger");
  const card = document.getElementById("floatingContactCard");
  const closeBtn = document.getElementById("fccCloseBtn");

  if (trigger && card) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      card.classList.toggle("is-open");
      card.setAttribute("aria-hidden", !card.classList.contains("is-open"));
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        card.classList.remove("is-open");
        card.setAttribute("aria-hidden", "true");
      });
    }

    document.addEventListener("click", (e) => {
      if (!container.contains(e.target)) {
        card.classList.remove("is-open");
        card.setAttribute("aria-hidden", "true");
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFloatingContactWidget);
} else {
  initFloatingContactWidget();
}

/* FAQ: подсвечиваем только тот вопрос, с которым работает пользователь (раньше сам по себе горел
   первый пункт, а на телефоне «залипал» :hover у последнего нажатого). */
document.querySelectorAll('.qa').forEach((group) => {
  group.addEventListener('click', (event) => {
    const summary = event.target.closest('summary');
    if (!summary || !group.contains(summary)) return;
    const item = summary.parentElement;
    group.querySelectorAll('details.is-active').forEach((other) => {
      if (other !== item) other.classList.remove('is-active');
    });
    item.classList.add('is-active');
  });
});
