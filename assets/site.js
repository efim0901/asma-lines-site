/* ============================================================
   ASMA Lines — site script
   Forms are prepared for Bitrix24 via a server-side proxy:
     site → /api/lead → Cloudflare Worker → Bitrix24 REST API
   Never place the Bitrix24 webhook in client-side code.
   ============================================================ */

const rates = { base: 85, perKm: 1.65, perTonne: 18, fragile: 1.12, temperature: 1.28, loading: 45 };
const MOBILE_BREAKPOINT = 900; // must match the burger breakpoint in style.css

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
    img.onerror = function() {
      if (!this.dataset.fallbackApplied) {
        this.dataset.fallbackApplied = 'true';
        this.src = `assets/brand/asma-mark.svg?v=${v}`;
      }
    };
    if (img.classList.contains('brand-logo--full') || img.dataset.brandLogo === 'full') {
      img.src = fullLogoSrc;
    } else {
      img.src = markSrc;
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
    btn.textContent = dark ? '☀' : '◐';
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
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenuOpen(false)));
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

/* dropdown toggle (mobile) */
document.querySelectorAll('.nav-dropdown').forEach((dd) => {
  const btn = dd.querySelector('.nav-link');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    if (window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches) {
      e.preventDefault();
      const open = !dd.classList.contains('open');
      document.querySelectorAll('.nav-dropdown.open').forEach((other) => {
        if (other !== dd) {
          other.classList.remove('open');
          const otherBtn = other.querySelector('.nav-link');
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
        }
      });
      dd.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    }
  });
});

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

  // Verified road route distances, times, and highways
  const ROUTE_MATRIX = {
    "Гомель-Минск": { km: 310, time: "~3.5 – 4.5 ч", corridor: "Магистраль М-5 · Экспресс", lead: "от 2 ч", baseCost: 595 },
    "Минск-Гомель": { km: 310, time: "~3.5 – 4.5 ч", corridor: "Магистраль М-5 · Экспресс", lead: "от 2 ч", baseCost: 595 },
    "Гомель-Брест": { km: 530, time: "~6.5 – 7.5 ч", corridor: "Магистраль М-10 Полесье", lead: "от 2.5 ч", baseCost: 950 },
    "Брест-Гомель": { km: 530, time: "~6.5 – 7.5 ч", corridor: "Магистраль М-10 Полесье", lead: "от 2.5 ч", baseCost: 950 },
    "Гомель-Гродно": { km: 580, time: "~7.0 – 8.0 ч", corridor: "Магистрали М-5 / М-6", lead: "от 3 ч", baseCost: 1030 },
    "Гродно-Гомель": { km: 580, time: "~7.0 – 8.0 ч", corridor: "Магистрали М-6 / М-5", lead: "от 3 ч", baseCost: 1030 },
    "Гомель-Витебск": { km: 330, time: "~4.0 – 4.5 ч", corridor: "Магистраль М-8 Север–Юг", lead: "от 2 ч", baseCost: 625 },
    "Витебск-Гомель": { km: 330, time: "~4.0 – 4.5 ч", corridor: "Магистраль М-8 Север–Юг", lead: "от 2 ч", baseCost: 625 },
    "Гомель-Могилёв": { km: 180, time: "~2.0 – 2.5 ч", corridor: "Магистраль М-8 Прямой", lead: "от 1.5 ч", baseCost: 380 },
    "Могилёв-Гомель": { km: 180, time: "~2.0 – 2.5 ч", corridor: "Магистраль М-8 Прямой", lead: "от 1.5 ч", baseCost: 380 },
    "Минск-Брест": { km: 350, time: "~4.0 – 4.5 ч", corridor: "Магистраль М-1 Олимпийка", lead: "от 2 ч", baseCost: 660 },
    "Брест-Минск": { km: 350, time: "~4.0 – 4.5 ч", corridor: "Магистраль М-1 Олимпийка", lead: "от 2 ч", baseCost: 660 },
    "Минск-Гродно": { km: 290, time: "~3.5 – 4.0 ч", corridor: "Магистраль М-6 Скоростной", lead: "от 2 ч", baseCost: 560 },
    "Гродно-Минск": { km: 290, time: "~3.5 – 4.0 ч", corridor: "Магистраль М-6 Скоростной", lead: "от 2 ч", baseCost: 560 },
    "Минск-Витебск": { km: 290, time: "~3.5 – 4.0 ч", corridor: "Магистраль М-3 Север", lead: "от 2 ч", baseCost: 560 },
    "Витебск-Минск": { km: 290, time: "~3.5 – 4.0 ч", corridor: "Магистраль М-3 Север", lead: "от 2 ч", baseCost: 560 },
    "Минск-Могилёв": { km: 200, time: "~2.2 – 2.8 ч", corridor: "Магистраль М-4 Восток", lead: "от 2 ч", baseCost: 410 },
    "Могилёв-Минск": { km: 200, time: "~2.2 – 2.8 ч", corridor: "Магистраль М-4 Восток", lead: "от 2 ч", baseCost: 410 },
    "Гомель-Мозырь": { km: 135, time: "~1.5 – 2.0 ч", corridor: "Трасса Р-31 / М-10", lead: "от 1 ч", baseCost: 310 },
    "Мозырь-Гомель": { km: 135, time: "~1.5 – 2.0 ч", corridor: "Трасса Р-31 / М-10", lead: "от 1 ч", baseCost: 310 },
    "Гомель-Жлобин": { km: 90, time: "~1.0 – 1.3 ч", corridor: "Магистраль М-5 Прямой", lead: "от 1 ч", baseCost: 235 },
    "Жлобин-Гомель": { km: 90, time: "~1.0 – 1.3 ч", corridor: "Магистраль М-5 Прямой", lead: "от 1 ч", baseCost: 235 },
    "Гомель-Речица": { km: 45, time: "~40 – 50 мин", corridor: "Магистраль М-10 Экспресс", lead: "от 45 мин", baseCost: 160 },
    "Речица-Гомель": { km: 45, time: "~40 – 50 мин", corridor: "Магистраль М-10 Экспресс", lead: "от 45 мин", baseCost: 160 },
    "Минск-Барановичи": { km: 145, time: "~1.8 – 2.2 ч", corridor: "Магистраль М-1 Юго-Запад", lead: "от 2 ч", baseCost: 325 },
    "Барановичи-Минск": { km: 145, time: "~1.8 – 2.2 ч", corridor: "Магистраль М-1 Юго-Запад", lead: "от 2 ч", baseCost: 325 },
    "Минск-Бобруйск": { km: 150, time: "~1.8 – 2.2 ч", corridor: "Магистраль М-5 Юго-Восток", lead: "от 2 ч", baseCost: 330 },
    "Бобруйск-Минск": { km: 150, time: "~1.8 – 2.2 ч", corridor: "Магистраль М-5 Юго-Восток", lead: "от 2 ч", baseCost: 330 },
    "Минск-Пинск": { km: 300, time: "~3.5 – 4.2 ч", corridor: "Р-6 / М-1 Южное Полесье", lead: "от 2.5 ч", baseCost: 580 },
    "Пинск-Минск": { km: 300, time: "~3.5 – 4.2 ч", corridor: "Р-6 / М-1 Южное Полесье", lead: "от 2.5 ч", baseCost: 580 },
    "Минск-Полоцк": { km: 250, time: "~3.2 – 3.8 ч", corridor: "Р-46 / М-3 Северо-Восток", lead: "от 2.5 ч", baseCost: 490 },
    "Полоцк-Минск": { km: 250, time: "~3.2 – 3.8 ч", corridor: "Р-46 / М-3 Северо-Восток", lead: "от 2.5 ч", baseCost: 490 },
    "Минск-Орша": { km: 220, time: "~2.5 – 3.0 ч", corridor: "Магистраль М-1 Восток", lead: "от 2 ч", baseCost: 440 },
    "Орша-Минск": { km: 220, time: "~2.5 – 3.0 ч", corridor: "Магистраль М-1 Восток", lead: "от 2 ч", baseCost: 440 },
    "Минск-Борисов": { km: 75, time: "~1.0 ч", corridor: "Магистраль М-1 Пригород", lead: "от 1.5 ч", baseCost: 210 },
    "Борисов-Минск": { km: 75, time: "~1.0 ч", corridor: "Магистраль М-1 Пригород", lead: "от 1.5 ч", baseCost: 210 },
    "Минск-Солигорск": { km: 135, time: "~1.8 – 2.2 ч", corridor: "Трасса Р-23 Юг", lead: "от 2 ч", baseCost: 310 },
    "Солигорск-Минск": { km: 135, time: "~1.8 – 2.2 ч", corridor: "Трасса Р-23 Юг", lead: "от 2 ч", baseCost: 310 },
    "Минск-Лида": { km: 170, time: "~2.0 – 2.4 ч", corridor: "Магистраль М-6 Запад", lead: "от 2 ч", baseCost: 360 },
    "Лида-Минск": { km: 170, time: "~2.0 – 2.4 ч", corridor: "Магистраль М-6 Запад", lead: "от 2 ч", baseCost: 360 },
    "Брест-Пинск": { km: 180, time: "~2.2 – 2.6 ч", corridor: "Магистраль М-10 Полесье", lead: "от 2 ч", baseCost: 380 },
    "Пинск-Брест": { km: 180, time: "~2.2 – 2.6 ч", corridor: "Магистраль М-10 Полесье", lead: "от 2 ч", baseCost: 380 },
    "Гродно-Лида": { km: 110, time: "~1.2 – 1.5 ч", corridor: "Магистраль М-6 Восток", lead: "от 2 ч", baseCost: 265 },
    "Лида-Гродно": { km: 110, time: "~1.2 – 1.5 ч", corridor: "Магистраль М-6 Восток", lead: "от 2 ч", baseCost: 265 },
    "Витебск-Полоцк": { km: 105, time: "~1.2 – 1.5 ч", corridor: "Трасса Р-20 Двина", lead: "от 2 ч", baseCost: 260 },
    "Полоцк-Витебск": { km: 105, time: "~1.2 – 1.5 ч", corridor: "Трасса Р-20 Двина", lead: "от 2 ч", baseCost: 260 }
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

  // Update Route Info
  function updateRoute() {
    if (!originSelect || !destSelect) return;
    let from = originSelect.value.trim();
    let to = destSelect.value.trim();

    if (from === to) {
      if (from === "Гомель") to = "Минск";
      else to = "Гомель";
      ensureOptionExists(destSelect, to);
      destSelect.value = to;
    }

    if (originBadge) originBadge.textContent = from;
    if (destBadge) destBadge.textContent = to;

    const pairKey = `${from}-${to}`;
    const pairKeyRev = `${to}-${from}`;
    const known = ROUTE_MATRIX[pairKey] || ROUTE_MATRIX[pairKeyRev];

    let km = 200, time = "~2.5 – 3.5 ч", corridor = "Автодорожная сеть РБ", lead = "от 2 ч", cost = 420;

    if (known) {
      km = known.km;
      time = known.time;
      corridor = known.corridor;
      lead = known.lead;
      cost = known.baseCost;
    } else {
      km = calcFallbackKm(from, to);
      const hours = (km / 72).toFixed(1);
      time = `~${Math.max(1, (Number(hours) - 0.5)).toFixed(1)} – ${(Number(hours) + 0.6).toFixed(1)} ч`;
      corridor = `Прямой маршрут · ${km} км`;
      lead = "от 2.5 ч";
      cost = Math.round(90 + km * 1.65 + 5 * 10);
    }

    if (distVal) distVal.textContent = `${km} км`;
    if (timeVal) timeVal.textContent = time;
    if (leadVal) leadVal.textContent = lead;
    if (costVal) costVal.textContent = `от ${cost.toLocaleString("ru-RU")} BYN`;
    if (corridorTag) corridorTag.textContent = corridor;

    if (calcLink) {
      calcLink.href = `calculator.html?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
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

  // Swap Direction
  if (btnSwap) {
    btnSwap.addEventListener("click", () => {
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


async function syncLeadToCrmCloud(payload) {
  try {
    const isPartner = payload.source === 'website_partners' || Boolean(payload.company);
    const isCargo = !isPartner && Boolean(
      (payload.fromCity && payload.toCity) ||
      (payload.route_details && payload.route_details.length > 3) ||
      payload.source === 'calculator_modal' ||
      payload.source === 'website_calculator' ||
      (payload.distance && payload.vehicle) ||
      payload.price
    );
    const routeStr = (payload.fromCity && payload.toCity) ? `${payload.fromCity} → ${payload.toCity}` : (payload.route_details || payload.route || 'Маршрут по согласованию');

    const newLead = {
      id: 'lead-' + Date.now(),
      leadNumber: String(Date.now()).slice(-3),
      type: isPartner ? 'partner' : (isCargo ? 'cargo' : 'contact'),
      category: isPartner ? 'Сотрудничество' : (isCargo ? 'Перевозка груза' : 'Обратная связь'),
      status: 'new',
      createdAt: new Date().toISOString(),
      name: payload.name || payload.contact_name || 'Не указано',
      contact: payload.contact || payload.phone || 'Не указан',
      email: payload.email || '',
      route: routeStr,
      distance: payload.distance ? (String(payload.distance).includes('км') ? payload.distance : `${payload.distance} км`) : '',
      vehicle: payload.vehicle || '',
      weight: payload.weight ? (String(payload.weight).includes('т') ? payload.weight : `${payload.weight} т`) : '',
      volume: payload.volume ? (String(payload.volume).includes('м³') ? payload.volume : `${payload.volume} м³`) : '',
      price: payload.price ? (String(payload.price).includes('BYN') ? payload.price : `${payload.price} BYN`) : '',
      comment: payload.message || payload.comment || '',
      dispatcher: 'Иван',
      notes: [
        {
          id: 'n-' + Date.now(),
          author: 'Система',
          text: `Заявка с сайта (${payload.source || 'форма'})`,
          time: new Date().toISOString()
        }
      ],
      source: payload.source || 'website'
    };

    // Primary: Send to CRM API endpoint
    try {
      const apiRes = await fetch('/api/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', lead: newLead })
      });
      if (apiRes.ok) return;
    } catch (e) {}

    // Fallback: Fetch current cloud data and prepend
    const CRM_BIN = 'https://json.extendsclass.com/bin/becdbda';
    const res = await fetch(CRM_BIN + '?_t=' + Date.now(), { cache: 'no-store' });
    let data = { leads: [], deletedIds: [] };
    if (res.ok) {
      data = await res.json();
    }
    if (!Array.isArray(data.leads)) data.leads = [];
    if (!Array.isArray(data.deletedIds)) data.deletedIds = [];

    const delSet = new Set(data.deletedIds);
    data.leads = data.leads.filter(l => !delSet.has(l.id));
    newLead.leadNumber = String(data.leads.length + 101);
    data.leads.unshift(newLead);

    // Save back if supported
    await fetch(CRM_BIN, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(() => {});
  } catch (err) {
    console.warn('CRM sync error:', err);
  }
}

async function submitLead(payload, statusNode, successMessage) {
  if (statusNode) {
    statusNode.textContent = 'Отправляем данные…';
    statusNode.className = 'form-status form-status--loading';
  }

  let sent = false;

  // 1. Primary: Try Node.js server API (/api/lead)
  try {
    const response = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      sent = true;
    }
  } catch (error) {
    console.warn('Backend /api/lead unavailable, attempting direct Telegram fallback...', error);
  }

  // 2. Secondary fallback / CRM sync
  if (!sent) {
    try {
      // Post to /api/crm directly and FormSubmit
      await syncLeadToCrmCloud(payload).catch(e => console.warn('CRM sync error:', e));

      const isPartner = payload.source === 'website_partners' || Boolean(payload.company);
      const isCargoOrder = !isPartner && Boolean(
        (payload.fromCity && payload.toCity) ||
        (payload.route_details && payload.route_details.length > 3) ||
        payload.source === 'calculator_modal' ||
        payload.source === 'website_calculator' ||
        (payload.distance && payload.vehicle) ||
        payload.price
      );

      const routeStr = (payload.fromCity && payload.toCity) ? `${payload.fromCity} → ${payload.toCity}` : (payload.route_details || '');
      const nowStr = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' });

      let emailSubject = '';
      let emailFormData = {};

      if (isCargoOrder) {
        emailSubject = `🚛 ЗАЯВКА НА ПЕРЕВОЗКУ: ${payload.name || 'Клиент'} (${routeStr ? routeStr + ', ' : ''}${payload.contact || ''})`;
        emailFormData = {
          _subject: emailSubject,
          'Категория': 'Заявка на перевозку груза',
          'Клиент / Заказчик': payload.name || 'Не указано',
          'Телефон / Контакты': payload.contact || payload.phone || 'Не указан',
          'Email': payload.email || '—',
          'Маршрут': routeStr || 'По согласованию',
          'Расстояние': payload.distance || '—',
          'Транспорт': payload.vehicle || '—',
          'Вес груза': payload.weight || '—',
          'Объём груза': payload.volume || '—',
          'Ориентир стоимости': payload.price || '—',
          'Комментарий': payload.message || payload.comment || '—',
          'Время отправки': nowStr,
          'Источник': 'Калькулятор на сайте ASMA Lines'
        };
      } else if (isPartner) {
        const partnerRole = payload.partner_role || payload.role || 'Партнёр';
        emailSubject = `🤝 СОТРУДНИЧЕСТВО [${partnerRole}]: ${payload.company || payload.contact_name || 'Партнёр'} (${payload.contact || ''})`;
        emailFormData = {
          _subject: emailSubject,
          'Категория': `Заявка на сотрудничество (${partnerRole})`,
          'Формат сотрудничества': partnerRole,
          'Компания / ИП': payload.company || '—',
          'Контактное лицо': payload.contact_name || payload.name || 'Не указано',
          'Телефон / Контакты': payload.contact || payload.phone || 'Не указан',
          'Email': payload.email || '—',
          'Направление / Автопарк': payload.direction || '—',
          'Сообщение / Условия': payload.message || '—',
          'Время отправки': nowStr,
          'Источник': 'Раздел Партнерам (Анкета)'
        };
      } else {
        emailSubject = `📩 ЗАЯВКА [${payload.topic || 'Перевозка'}]: ${payload.name || 'Клиент'} (${payload.contact || ''})`;
        emailFormData = {
          _subject: emailSubject,
          'Категория': payload.topic ? `Заявка: ${payload.topic}` : 'Заявка на перевозку / обратная связь',
          'Имя / Организация': payload.name || 'Не указано',
          'Телефон / Контакты': payload.contact || payload.phone || 'Не указан',
          'Email': payload.email || '—',
          'Удобный способ связи': payload.preferred_channel || 'Звонок',
          'Маршрут и детали': payload.message || payload.comment || '—',
          'Время отправки': nowStr,
          'Источник': payload.source === 'website_contacts' ? 'Форма заявки (Контакты)' : (payload.source || 'Сайт')
        };
      }

      // Send email to PlanFix via FormSubmit HTTP API
      fetch('https://formsubmit.co/ajax/Plomba@asma.planfix.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(emailFormData)
      }).catch(e => console.warn('PlanFix email notice:', e));

      // If PlanFix Webhook URL is set globally on window (e.g. window.PLANFIX_WEBHOOK_URL), post to PlanFix as well
      const planfixWebhook = window.PLANFIX_WEBHOOK_URL || window.PLANFIX_FORM_URL;
      if (planfixWebhook) {
        fetch(planfixWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(e => console.warn('PlanFix webhook notice:', e));
      }

      sent = true;
    } catch (e) {
      console.warn('Fallback sync notice:', e);
    }
  }

  if (sent) {
    if (statusNode) {
      statusNode.textContent = successMessage;
      statusNode.className = 'form-status form-status--success';
    }
    return true;
  } else {
    if (statusNode) {
      statusNode.textContent = 'Не удалось отправить заявку. Пожалуйста, позвоните нам или отправьте повторно.';
      statusNode.className = 'form-status form-status--error';
    }
    return false;
  }
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
    }, statusNode, 'Заявка принята! Диспетчер свяжется с вами в течение 10–15 минут.');
    
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
    parent.querySelectorAll('.contact-topic-chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    const input = document.getElementById('contactFormTopic');
    if (input) input.value = chip.dataset.topic || '';
    
    // Context-sensitive placeholder for message textarea
    const msg = document.getElementById('contactFormMessage');
    if (msg) {
      if (chip.dataset.topic === 'Срочная подача машины') {
        msg.placeholder = 'Срочный маршрут (откуда — куда), желаемое время подачи, требования к авто (тент/реф/бус)';
      } else if (chip.dataset.topic === 'Договор / Юрлицо') {
        msg.placeholder = 'Реквизиты компании, планируемые регулярные направления и ориентировочный объём';
      } else if (chip.dataset.topic === 'Консультация логиста') {
        msg.placeholder = 'Ваш вопрос дежурному логисту (габариты груза, документы, особые условия)';
      } else {
        msg.placeholder = 'Откуда — куда (например: Гомель → Минск), вес/объём груза, желаемая дата подачи';
      }
    }
  });
});

document.querySelectorAll('.channel-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const parent = chip.closest('.channel-chips');
    if (!parent) return;
    parent.querySelectorAll('.channel-chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');
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
        roleTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        const role = tab.getAttribute('data-role');

        if (role === 'carrier') {
          if (roleInput) roleInput.value = 'Перевозчик / Владелец авто';
          if (carrierChips) carrierChips.style.display = 'block';
          if (shipperChips) shipperChips.style.display = 'none';
          if (transportLabel) transportLabel.textContent = 'Транспорт, базирование и направления *';
          if (transportInput) transportInput.placeholder = 'Например: Тент 20т, базирование в Гомеле, рейсы в Минск и по Беларуси';
          if (submitBtn) submitBtn.textContent = 'Отправить анкету перевозчика →';
        } else if (role === 'shipper') {
          if (roleInput) roleInput.value = 'Грузовладелец / Заказчик перевозок';
          if (carrierChips) carrierChips.style.display = 'none';
          if (shipperChips) shipperChips.style.display = 'block';
          if (transportLabel) transportLabel.textContent = 'Маршруты и характер регулярных отгрузок *';
          if (transportInput) transportInput.placeholder = 'Например: Регулярные рейсы Минск — Гомель, паллеты, 2 раза в неделю';
          if (submitBtn) submitBtn.textContent = 'Отправить заявку грузовладельца →';
        } else if (role === 'forwarder') {
          if (roleInput) roleInput.value = 'Экспедитор / Диспетчер';
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
        parentWrap.querySelectorAll('.partner-fleet-chip').forEach((c) => c.classList.remove('is-active'));
      }
      chip.classList.add('is-active');
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
    const ok = await submitLead({
      partner_role: data.get('partner_role') || 'Перевозчик',
      company: data.get('company') || '',
      contact_name: data.get('contact_name') || '',
      contact: data.get('contact') || '',
      email: data.get('email') || '',
      direction: data.get('direction') || '',
      message: data.get('message') || '',
      source: 'website_partners',
    }, statusNode, 'Спасибо! Анкета принята. Дежурный логист свяжется с вами в течение 10–15 минут для обсуждения условий сотрудничества.');
    
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
    if (ok) {
      partnersForm.reset();
      chips.forEach((c) => c.classList.remove('is-active'));
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
          <a href="tel:+375291234567" class="fcc-btn fcc-btn-call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>Позвонить +375 29 123-45-67</span>
          </a>
          <a href="https://t.me/asmalinesbot" target="_blank" rel="noopener" class="fcc-btn fcc-btn-tg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
            <span>Написать в Telegram</span>
          </a>
          <a href="calculator.html" class="fcc-btn fcc-btn-calc">
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
