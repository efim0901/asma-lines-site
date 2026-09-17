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
  favicon.href = 'assets/brand/asma-mark.svg';
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
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme, dark } }));
}

setTheme(savedTheme === 'dark', false);

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
   Route Constructor & Network Coverage Component (Variants 3 + 4)
   ------------------------------------------------------------ */
function initRouteConstructorAndNetwork() {
  const panel = document.getElementById("geography-network-section");
  if (!panel) return;

  const CITIES_MASTER = [
    // Гомельская область
    { name: "Гомель", region: "Гомельская" },
    { name: "Мозырь", region: "Гомельская" },
    { name: "Жлобин", region: "Гомельская" },
    { name: "Светлогорск", region: "Гомельская" },
    { name: "Речица", region: "Гомельская" },
    { name: "Калинковичи", region: "Гомельская" },
    { name: "Рогачёв", region: "Гомельская" },
    { name: "Добруш", region: "Гомельская" },
    { name: "Житковичи", region: "Гомельская" },
    { name: "Хойники", region: "Гомельская" },
    { name: "Петриков", region: "Гомельская" },
    { name: "Ельск", region: "Гомельская" },
    { name: "Буда-Кошелёво", region: "Гомельская" },
    { name: "Ветка", region: "Гомельская" },
    { name: "Чечерск", region: "Гомельская" },
    { name: "Лельчицы", region: "Гомельская" },
    { name: "Наровля", region: "Гомельская" },
    { name: "Лоев", region: "Гомельская" },
    { name: "Корма", region: "Гомельская" },

    // Минская область
    { name: "Минск", region: "Минская" },
    { name: "Борисов", region: "Минская" },
    { name: "Солигорск", region: "Минская" },
    { name: "Молодечно", region: "Минская" },
    { name: "Жодино", region: "Минская" },
    { name: "Слуцк", region: "Минская" },
    { name: "Дзержинск", region: "Минская" },
    { name: "Вилейка", region: "Минская" },
    { name: "Марьина Горка", region: "Минская" },
    { name: "Столбцы", region: "Минская" },
    { name: "Смолевичи", region: "Минская" },
    { name: "Несвиж", region: "Минская" },
    { name: "Фаниполь", region: "Минская" },
    { name: "Заславль", region: "Минская" },
    { name: "Любань", region: "Минская" },
    { name: "Крупки", region: "Минская" },
    { name: "Клецк", region: "Минская" },
    { name: "Логойск", region: "Минская" },
    { name: "Березино", region: "Минская" },
    { name: "Червень", region: "Минская" },

    // Брестская область
    { name: "Брест", region: "Брестская" },
    { name: "Барановичи", region: "Брестская" },
    { name: "Пинск", region: "Брестская" },
    { name: "Кобрин", region: "Брестская" },
    { name: "Берёза", region: "Брестская" },
    { name: "Лунинец", region: "Брестская" },
    { name: "Ивацевичи", region: "Брестская" },
    { name: "Пружаны", region: "Брестская" },
    { name: "Иваново", region: "Брестская" },
    { name: "Дрогичин", region: "Брестская" },
    { name: "Ганцевичи", region: "Брестская" },
    { name: "Жабинка", region: "Брестская" },
    { name: "Столин", region: "Брестская" },
    { name: "Микашевичи", region: "Брестская" },
    { name: "Белоозёрск", region: "Брестская" },
    { name: "Каменец", region: "Брестская" },
    { name: "Малорита", region: "Брестская" },
    { name: "Ляховичи", region: "Брестская" },

    // Гродненская область
    { name: "Гродно", region: "Гродненская" },
    { name: "Лида", region: "Гродненская" },
    { name: "Слоним", region: "Гродненская" },
    { name: "Волковыск", region: "Гродненская" },
    { name: "Сморгонь", region: "Гродненская" },
    { name: "Новогрудок", region: "Гродненская" },
    { name: "Мосты", region: "Гродненская" },
    { name: "Щучин", region: "Гродненская" },
    { name: "Ошмяны", region: "Гродненская" },
    { name: "Скидель", region: "Гродненская" },
    { name: "Островец", region: "Гродненская" },
    { name: "Дятлово", region: "Гродненская" },
    { name: "Ивье", region: "Гродненская" },
    { name: "Зельва", region: "Гродненская" },
    { name: "Кореличи", region: "Гродненская" },
    { name: "Свислочь", region: "Гродненская" },

    // Витебская область
    { name: "Витебск", region: "Витебская" },
    { name: "Орша", region: "Витебская" },
    { name: "Новополоцк", region: "Витебская" },
    { name: "Полоцк", region: "Витебская" },
    { name: "Поставы", region: "Витебская" },
    { name: "Глубокое", region: "Витебская" },
    { name: "Лепель", region: "Витебская" },
    { name: "Городок", region: "Витебская" },
    { name: "Браслав", region: "Витебская" },
    { name: "Толочин", region: "Витебская" },
    { name: "Чашники", region: "Витебская" },
    { name: "Миоры", region: "Витебская" },
    { name: "Сенно", region: "Витебская" },
    { name: "Верхнедвинск", region: "Витебская" },
    { name: "Дубровно", region: "Витебская" },

    // Могилёвская область
    { name: "Могилёв", region: "Могилёвская" },
    { name: "Бобруйск", region: "Могилёвская" },
    { name: "Горки", region: "Могилёвская" },
    { name: "Осиповичи", region: "Могилёвская" },
    { name: "Кричев", region: "Могилёвская" },
    { name: "Быхов", region: "Могилёвская" },
    { name: "Климовичи", region: "Могилёвская" },
    { name: "Шклов", region: "Могилёвская" },
    { name: "Костюковичи", region: "Могилёвская" },
    { name: "Мстиславль", region: "Могилёвская" },
    { name: "Чаусы", region: "Могилёвская" },
    { name: "Белыничи", region: "Могилёвская" },
    { name: "Кировск", region: "Могилёвская" },
    { name: "Чериков", region: "Могилёвская" },
    { name: "Славгород", region: "Могилёвская" },
    { name: "Круглое", region: "Могилёвская" },
    { name: "Кличев", region: "Могилёвская" }
  ];

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
  
  const originHubsWrap = document.getElementById("originQuickHubs");
  const destHubsWrap = document.getElementById("destQuickHubs");
  
  const searchInput = document.getElementById("networkCitySearch");
  const clearSearch = document.getElementById("clearSearchBtn");
  const searchResult = document.getElementById("searchResultCard");
  const srcName = document.getElementById("srcCityName");
  const srcRegion = document.getElementById("srcCityRegion");
  const srcDesc = document.getElementById("srcCityDesc");
  const srcBtn = document.getElementById("srcSelectBtn");
  
  const regionTabs = panel.querySelectorAll(".region-tab");
  const citiesGrid = document.getElementById("networkCitiesGrid");
  const corridorsList = document.getElementById("popularCorridorsList");

  let activeRegion = "all";
  let activeSearchQuery = "";
  let selectedSearchCity = null;

  // Render City Chips in Column 2
  function renderCityChips() {
    if (!citiesGrid) return;
    citiesGrid.innerHTML = "";

    const currentDest = destSelect ? destSelect.value : "";
    const filtered = CITIES_MASTER.filter(c => {
      const matchRegion = activeRegion === "all" || c.region === activeRegion;
      const matchSearch = !activeSearchQuery || c.name.toLowerCase().includes(activeSearchQuery) || c.region.toLowerCase().includes(activeSearchQuery);
      return matchRegion && matchSearch;
    });

    if (filtered.length === 0) {
      citiesGrid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:20px 10px; color:rgba(248,247,239,0.5); font-size:13px;">Город не найден в фильтре. ASMA Lines выполняет доставку в любой населённый пункт РБ — свяжитесь с диспетчером.</div>`;
      return;
    }

    filtered.forEach(city => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `city-catalog-chip ${city.name === currentDest ? "is-selected" : ""}`;
      chip.setAttribute("data-city", city.name);
      chip.setAttribute("title", `Выбрать город ${city.name}`);
      chip.innerHTML = `<span class="chip-name">${city.name}</span>`;

      chip.addEventListener("click", () => {
        if (destSelect) {
          ensureOptionExists(destSelect, city.name);
          destSelect.value = city.name;
          updateRoute();
          highlightCityChip(city.name);
          scrollGentlyToConstructor();
        }
      });

      citiesGrid.appendChild(chip);
    });
  }

  function ensureOptionExists(selectEl, cityName) {
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

  function highlightCityChip(cityName) {
    const chips = citiesGrid ? citiesGrid.querySelectorAll(".city-catalog-chip") : [];
    chips.forEach(c => {
      if (c.getAttribute("data-city") === cityName) {
        c.classList.add("is-selected");
      } else {
        c.classList.remove("is-selected");
      }
    });
  }

  function scrollGentlyToConstructor() {
    if (window.innerWidth <= 900) {
      const summaryCard = document.getElementById("routeSummaryCard");
      const box = document.getElementById("routeBuilderPanel");
      const target = summaryCard || box;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
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

    // Update quick buttons states
    if (originHubsWrap) {
      originHubsWrap.querySelectorAll(".quick-hub-btn").forEach(btn => {
        btn.classList.toggle("is-active", btn.dataset.city === from);
      });
    }
    if (destHubsWrap) {
      destHubsWrap.querySelectorAll(".quick-hub-btn").forEach(btn => {
        btn.classList.toggle("is-active", btn.dataset.city === to);
      });
    }

    highlightCityChip(to);
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

  // Quick Hub buttons inside inputs
  if (originHubsWrap) {
    originHubsWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".quick-hub-btn");
      if (!btn) return;
      originSelect.value = btn.dataset.city;
      updateRoute();
    });
  }
  if (destHubsWrap) {
    destHubsWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".quick-hub-btn");
      if (!btn) return;
      destSelect.value = btn.dataset.city;
      updateRoute();
    });
  }

  // Regional Filter Tabs
  regionTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      regionTabs.forEach(t => {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      activeRegion = tab.dataset.region || "all";
      renderCityChips();
    });
  });

  // Search Input in Column 2
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      activeSearchQuery = q;
      if (clearSearch) clearSearch.hidden = !q;

      // Find best single match for direct card
      if (q.length >= 2) {
        const found = CITIES_MASTER.find(c => c.name.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q));
        if (found) {
          selectedSearchCity = found;
          if (searchResult) {
            searchResult.hidden = false;
            if (srcName) srcName.textContent = found.name;
            if (srcRegion) srcRegion.textContent = `${found.region} обл.`;
          }
        } else {
          if (searchResult) searchResult.hidden = true;
          selectedSearchCity = null;
        }
      } else {
        if (searchResult) searchResult.hidden = true;
        selectedSearchCity = null;
      }

      renderCityChips();
    });
  }

  if (clearSearch) {
    clearSearch.addEventListener("click", () => {
      if (searchInput) {
        searchInput.value = "";
        activeSearchQuery = "";
        clearSearch.hidden = true;
        if (searchResult) searchResult.hidden = true;
        renderCityChips();
        searchInput.focus();
      }
    });
  }

  if (srcBtn) {
    srcBtn.addEventListener("click", () => {
      if (selectedSearchCity && destSelect) {
        ensureOptionExists(destSelect, selectedSearchCity.name);
        destSelect.value = selectedSearchCity.name;
        updateRoute();
        scrollGentlyToConstructor();
      }
    });
  }

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
        scrollGentlyToConstructor();
      }
    });
  }

  // Initial populate & setup
  renderCityChips();
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

  // 2. Fallback for static Cloudflare Workers / GitHub Pages / Netlify hosting
  if (!sent) {
    try {
      const botToken = '8808722578:AAEiNdtl3ut-oYBIrCFOFZYPy1vnYVd9VMY';
      const chatId = '-5230752915';

      const escapeHtml = (str) => str ? String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

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

      let textHtml = '';
      let emailSubject = '';
      let emailFormData = {};

      if (isCargoOrder) {
        // === 1. ЗАЯВКА НА ПЕРЕВОЗКУ ГРУЗА ===
        textHtml = `🚛 <b>ЗАЯВКА НА ПЕРЕВОЗКУ ГРУЗА (ASMA LINES)</b>\n`;
        textHtml += `───────────────────────\n`;
        textHtml += `👤 <b>Клиент / Компания:</b> ${escapeHtml(payload.name || 'Не указано')}\n`;
        textHtml += `📞 <b>Контакты:</b> ${escapeHtml(payload.contact || payload.phone || 'Не указан')}\n`;
        if (payload.email) textHtml += `📧 <b>Email:</b> ${escapeHtml(payload.email)}\n`;

        textHtml += `\n📦 <b>УСЛОВИЯ И ДЕТАЛИ РЕЙСА:</b>\n`;
        if (routeStr) textHtml += `📍 <b>Маршрут:</b> ${escapeHtml(routeStr)}\n`;
        if (payload.distance) textHtml += `📏 <b>Расстояние:</b> ${escapeHtml(payload.distance)}\n`;
        if (payload.vehicle) textHtml += `🚚 <b>Транспорт:</b> ${escapeHtml(payload.vehicle)}\n`;
        if (payload.weight) textHtml += `⚖️ <b>Вес груза:</b> ${escapeHtml(payload.weight)}\n`;
        if (payload.volume) textHtml += `📦 <b>Объём:</b> ${escapeHtml(payload.volume)}\n`;
        if (payload.price) textHtml += `💰 <b>Предварительный расчёт:</b> ${escapeHtml(payload.price)}\n`;

        if (payload.message || payload.comment) {
          textHtml += `\n💬 <b>Комментарий заказчика:</b>\n${escapeHtml(payload.message || payload.comment)}\n`;
        }

        textHtml += `───────────────────────\n`;
        textHtml += `⏱ <b>Время:</b> ${nowStr} (Минск)\n`;
        textHtml += `🌐 <b>Источник:</b> Калькулятор перевозки (Сайт ASMA Lines)`;

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
        // === 2. ЗАЯВКА НА СОТРУДНИЧЕСТВО (ПАРТНЕРЫ) ===
        textHtml = `🤝 <b>ЗАЯВКА НА СОТРУДНИЧЕСТВО (ПАРТНЁРЫ)</b>\n`;
        textHtml += `───────────────────────\n`;
        if (payload.company) textHtml += `🏢 <b>Компания:</b> ${escapeHtml(payload.company)}\n`;
        textHtml += `👤 <b>Контактное лицо:</b> ${escapeHtml(payload.contact_name || payload.name || 'Не указано')}\n`;
        textHtml += `📞 <b>Контакты:</b> ${escapeHtml(payload.contact || payload.phone || 'Не указан')}\n`;
        if (payload.direction) textHtml += `🚛 <b>Направление / Автопарк:</b> ${escapeHtml(payload.direction)}\n`;
        if (payload.message) textHtml += `\n💬 <b>Сообщение:</b>\n${escapeHtml(payload.message)}\n`;
        textHtml += `───────────────────────\n`;
        textHtml += `⏱ <b>Время:</b> ${nowStr} (Минск)\n`;
        textHtml += `🌐 <b>Источник:</b> Раздел «Партнёрам» (Сайт ASMA Lines)`;

        emailSubject = `🤝 СОТРУДНИЧЕСТВО: ${payload.company || payload.contact_name || 'Партнёр'} (${payload.contact || ''})`;
        emailFormData = {
          _subject: emailSubject,
          'Категория': 'Заявка на партнерство / сотрудничество',
          'Компания': payload.company || '—',
          'Контактное лицо': payload.contact_name || payload.name || 'Не указано',
          'Телефон / Контакты': payload.contact || payload.phone || 'Не указан',
          'Направление / Автопарк': payload.direction || '—',
          'Сообщение': payload.message || '—',
          'Время отправки': nowStr,
          'Источник': 'Раздел Партнерам'
        };

      } else {
        // === 3. ЗАЯВКА НА ОБРАТНУЮ СВЯЗЬ (КОНТАКТЫ / КОНСУЛЬТАЦИЯ) ===
        textHtml = `📩 <b>ЗАЯВКА НА ОБРАТНУЮ СВЯЗЬ</b>\n`;
        textHtml += `───────────────────────\n`;
        textHtml += `👤 <b>Имя / Клиент:</b> ${escapeHtml(payload.name || 'Не указано')}\n`;
        textHtml += `📞 <b>Контакты:</b> ${escapeHtml(payload.contact || payload.phone || 'Не указан')}\n`;
        if (payload.email) textHtml += `📧 <b>Email:</b> ${escapeHtml(payload.email)}\n`;

        textHtml += `\n💬 <b>Текст обращения / Вопрос:</b>\n`;
        textHtml += `${escapeHtml(payload.message || payload.comment || 'Заказ обратного звонка / консультации')}\n`;

        textHtml += `───────────────────────\n`;
        textHtml += `⏱ <b>Время:</b> ${nowStr} (Минск)\n`;
        textHtml += `🌐 <b>Источник:</b> Форма обратной связи (Контакты, ASMA Lines)`;

        emailSubject = `📩 ОБРАТНАЯ СВЯЗЬ: ${payload.name || 'Клиент'} (${payload.contact || ''})`;
        emailFormData = {
          _subject: emailSubject,
          'Категория': 'Заявка на обратную связь (Консультация / Вопрос)',
          'Имя / Клиент': payload.name || 'Не указано',
          'Телефон / Контакты': payload.contact || payload.phone || 'Не указан',
          'Email': payload.email || '—',
          'Текст обращения': payload.message || payload.comment || 'Заказ обратного звонка',
          'Время отправки': nowStr,
          'Источник': 'Форма обратной связи (Контакты)'
        };
      }

      const tgPromise = fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: textHtml,
          parse_mode: 'HTML'
        })
      });

      // Send email directly to Plomba@asma.planfix.com via FormSubmit HTTP API (for Cloudflare / static hosting)
      fetch('https://formsubmit.co/ajax/Plomba@asma.planfix.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(emailFormData)
      }).catch(e => console.error('PlanFix email dispatch error:', e));

      // If PlanFix Webhook URL is set globally on window (e.g. window.PLANFIX_WEBHOOK_URL), post to PlanFix as well
      const planfixWebhook = window.PLANFIX_WEBHOOK_URL || window.PLANFIX_FORM_URL;
      if (planfixWebhook) {
        fetch(planfixWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(e => console.error('PlanFix client webhook error:', e));
      }

      const tgRes = await tgPromise;
      const tgData = await tgRes.json();
      if (tgData && tgData.ok) {
        sent = true;
      }
    } catch (err) {
      console.error('Direct Telegram fallback error:', err);
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
      message: data.get('message') || '',
      fromCity: data.get('fromCity') || undefined,
      toCity: data.get('toCity') || undefined,
      distance: data.get('distance') || undefined,
      vehicle: data.get('vehicle') || undefined,
      weight: data.get('weight') || undefined,
      volume: data.get('volume') || undefined,
      price: data.get('price') || undefined,
      route_details: data.get('route_details') || undefined,
      source: data.get('source') || 'website_contacts',
    }, statusNode, 'Заявка принята! Диспетчер свяжется с вами в течение 15 минут.');
    
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
    if (ok) {
      formElem.reset();
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

/* partners form */
document.querySelectorAll('[data-partners-form]').forEach((partnersForm) => {
  const chips = partnersForm.querySelectorAll('.partner-fleet-chip');
  const input = partnersForm.querySelector('#partnerTransportInput');

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      const val = chip.getAttribute('data-fleet');
      if (input && val) {
        input.value = val;
        input.focus();
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
      btn.textContent = 'Отправка…';
    }
    const statusNode = partnersForm.querySelector('.form-status');
    const ok = await submitLead({
      company: data.get('company') || '',
      contact_name: data.get('contact_name') || '',
      contact: data.get('contact') || '',
      direction: data.get('direction') || '',
      message: data.get('message') || '',
      source: 'website_partners',
    }, statusNode, 'Спасибо! Мы свяжемся с вами для обсуждения взаимовыгодного сотрудничества.');
    
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
