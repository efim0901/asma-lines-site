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
const themeButton = document.querySelector('.theme-toggle');
let savedTheme = null;
try { savedTheme = localStorage.getItem('asma-theme'); } catch (error) { /* storage unavailable */ }

function setTheme(dark) {
  if (dark) {
    document.body.dataset.theme = 'dark';
  } else {
    delete document.body.dataset.theme;
  }
  try { localStorage.setItem('asma-theme', dark ? 'dark' : 'light'); } catch (error) { /* ignore */ }
  if (themeButton) {
    themeButton.textContent = dark ? '☀' : '◐';
    themeButton.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  }
}
setTheme(savedTheme === 'dark');
if (themeButton) {
  themeButton.addEventListener('click', () => setTheme(document.body.dataset.theme !== 'dark'));
}

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
   Interactive Belarus Vector Map Tooltips & Corridor Filters
   ------------------------------------------------------------ */
const mapContainer = document.getElementById('belarus-interactive-map');
if (mapContainer) {
  const tooltip = document.getElementById('mapCityTooltip');
  const tTitle = document.getElementById('tooltipCityName');
  const tRegion = document.getElementById('tooltipCityRegion');
  const tDesc = document.getElementById('tooltipCityDesc');
  const tDistance = document.getElementById('tooltipDistance');
  const tTime = document.getElementById('tooltipTime');
  const tLink = document.getElementById('tooltipCalcLink');

  const CITIES_DATA = {
    'gomel': { name: 'Гомель', region: 'Гомельская обл.', desc: 'Центральный хаб ASMA Lines · 24/7 диспетчерская · собственный автопарк', km: '0', time: 'База компании' },
    'minsk': { name: 'Минск', region: 'Минская обл.', desc: 'Столичный логистический узел · Ежедневные экспресс-рейсы по М-5', km: '310', time: '3.5-4 ч' },
    'brest': { name: 'Брест', region: 'Брестская обл.', desc: 'Западный пограничный хаб · Таможенный транзит и терминалы', km: '530', time: '6-7 ч' },
    'grodno': { name: 'Гродно', region: 'Гродненская обл.', desc: 'Северо-западный узел · Обслуживание предприятий и кластеров', km: '580', time: '7 ч' },
    'vitebsk': { name: 'Витебск', region: 'Витебская обл.', desc: 'Северный хаб · Прямой коридор М-8 через Оршу и Могилёв', km: '330', time: '4 ч' },
    'mogilev': { name: 'Могилёв', region: 'Могилёвская обл.', desc: 'Восточный промышленный кластер · Скоростная линия по М-8', km: '180', time: '2.5 ч' },
    'baranovichi': { name: 'Барановичи', region: 'Брестская обл.', desc: 'Крупнейший транспортный перекрёсток на магистрали М-1', km: '410', time: '5 ч' },
    'bobruisk': { name: 'Бобруйск', region: 'Могилёвская обл.', desc: 'Ключевой пункт на магистрали М-5 Гомель ⇄ Минск', km: '140', time: '1.8 ч' },
    'zhlobin': { name: 'Жлобин', region: 'Гомельская обл.', desc: 'Металлургический и логистический центр на М-5', km: '88', time: '1 ч' },
    'mozyr': { name: 'Мозырь', region: 'Гомельская обл.', desc: 'Нефтеперерабатывающий и логистический хаб Полесья', km: '135', time: '1.8 ч' },
    'kalinkovichi': { name: 'Калинковичи', region: 'Гомельская обл.', desc: 'Узловой транспортный перекрёсток Полесья', km: '125', time: '1.6 ч' },
    'rechitsa': { name: 'Речица', region: 'Гомельская обл.', desc: 'Промышленный узел на скоростной трассе М-10', km: '48', time: '40 мин' },
    'svetlogorsk': { name: 'Светлогорск', region: 'Гомельская обл.', desc: 'Химическая и целлюлозная промышленность', km: '110', time: '1.4 ч' },
    'rogachev': { name: 'Рогачёв', region: 'Гомельская обл.', desc: 'Пищевой промышленный узел на магистрали М-8', km: '115', time: '1.5 ч' },
    'pinsk': { name: 'Пинск', region: 'Брестская обл.', desc: 'Центральный хаб Припятского Полесья на М-10', km: '360', time: '4.5 ч' },
    'orsha': { name: 'Орша', region: 'Витебская обл.', desc: 'Ключевой интермодальный перекрёсток М-1 и М-8', km: '240', time: '3 ч' },
    'polotsk': { name: 'Полоцк', region: 'Витебская обл.', desc: 'Северный промышленный узел и нефтехимия', km: '420', time: '5.2 ч' },
    'novopolotsk': { name: 'Новополоцк', region: 'Витебская обл.', desc: 'Крупнейший нефтехимический комплекс Беларуси', km: '425', time: '5.3 ч' },
    'lida': { name: 'Лида', region: 'Гродненская обл.', desc: 'Логистический центр на магистрали М-6 Минск–Гродно', km: '480', time: '6 ч' },
    'borisov': { name: 'Борисов', region: 'Минская обл.', desc: 'Машиностроение и фармацевтика на М-1', km: '320', time: '4 ч' },
    'soligorsk': { name: 'Солигорск', region: 'Минская обл.', desc: 'Калийный горнодобывающий гигант Беларуси', km: '270', time: '3.5 ч' },
    'slutsk': { name: 'Слуцк', region: 'Минская обл.', desc: 'Агропромышленный центр Минской области', km: '280', time: '3.6 ч' },
    'zhodino': { name: 'Жодино', region: 'Минская обл.', desc: 'Родина карьерных самосвалов БЕЛАЗ', km: '335', time: '4.2 ч' },
    'kobrin': { name: 'Кобрин', region: 'Брестская обл.', desc: 'Перекрёсток магистралей М-1 и М-10', km: '485', time: '6 ч' },
    'slonim': { name: 'Слоним', region: 'Гродненская обл.', desc: 'Промышленный пункт юго-востока Гродненщины', km: '440', time: '5.5 ч' },
    'volkovysk': { name: 'Волковыск', region: 'Гродненская обл.', desc: 'Строительный и пищевой кластер', km: '490', time: '6.2 ч' },
    'smorgon': { name: 'Сморгонь', region: 'Гродненская обл.', desc: 'Деревообрабатывающий кластер (Kronospan)', km: '430', time: '5.4 ч' },
    'gorki': { name: 'Горки', region: 'Могилёвская обл.', desc: 'Северо-восток Могилёвской области', km: '230', time: '3 ч' },
    'osipovichi': { name: 'Осиповичи', region: 'Могилёвская обл.', desc: 'Транспортный хаб и вагоностроение на М-5', km: '190', time: '2.4 ч' },
    'bereza': { name: 'Берёза', region: 'Брестская обл.', desc: 'Транзитный пункт на магистрали М-1', km: '445', time: '5.5 ч' },
    'ivatsevichi': { name: 'Ивацевичи', region: 'Брестская обл.', desc: 'Деревообрабатывающий кластер на М-1', km: '420', time: '5.2 ч' },
    'dzerzhinsk': { name: 'Дзержинск', region: 'Минская обл.', desc: 'Логистический узел к юго-западу от Минска', km: '340', time: '4.2 ч' },
    'vileyka': { name: 'Вилейка', region: 'Минская обл.', desc: 'Северо-запад Минской области', km: '410', time: '5 ч' },
    'luninets': { name: 'Лунинец', region: 'Брестская обл.', desc: 'Узел на коридоре М-10', km: '310', time: '4 ч' },
    'maryina_gorka': { name: 'Марьина Горка', region: 'Минская обл.', desc: 'Узел на М-5 между Бобруйском и Минском', km: '235', time: '2.8 ч' },
    'dobrush': { name: 'Добруш', region: 'Гомельская обл.', desc: 'Восточный промышленный пункт на трассе М-10', km: '28', time: '25 мин' },
    'lepel': { name: 'Лепель', region: 'Витебская обл.', desc: 'Узел на магистрали М-3 Минск ⇄ Витебск', km: '360', time: '4.5 ч' },
    'krichev': { name: 'Кричев', region: 'Могилёвская обл.', desc: 'Цементная и строительная индустрия', km: '240', time: '3.2 ч' },
    'braslav': { name: 'Браслав', region: 'Витебская обл.', desc: 'Озёрный край, туристический и грузовой сервис', km: '510', time: '6.5 ч' },
    'zhitkovichi': { name: 'Житковичи', region: 'Гомельская обл.', desc: 'Транзитный узел на трассе М-10', km: '235', time: '3 ч' }
  };

  const svgElem = mapContainer.querySelector('svg.belarus-master-map');
  const cityNodes = mapContainer.querySelectorAll('.map-city-node');

  function showTooltip(id, evt) {
    const data = CITIES_DATA[id];
    if (!data || !tooltip) return;

    tTitle.textContent = data.name;
    tRegion.textContent = data.region;
    tDesc.textContent = data.desc;
    tDistance.textContent = data.km === '0' ? 'База' : `${data.km} км`;
    tTime.textContent = data.time;
    tLink.href = `calculator.html?from=Гомель&to=${encodeURIComponent(data.name)}`;

    const rect = mapContainer.getBoundingClientRect();
    let clientX, clientY;
    if (evt.touches && evt.touches[0]) {
      clientX = evt.touches[0].clientX;
      clientY = evt.touches[0].clientY;
    } else {
      clientX = evt.clientX;
      clientY = evt.clientY;
    }

    const x = Math.max(120, Math.min(rect.width - 120, clientX - rect.left));
    const y = Math.max(160, clientY - rect.top - 12);

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.classList.add('is-active');
    tooltip.setAttribute('aria-hidden', 'false');
  }

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.classList.remove('is-active');
    tooltip.setAttribute('aria-hidden', 'true');
  }

  cityNodes.forEach(node => {
    const id = node.getAttribute('data-id');
    node.addEventListener('mouseenter', (e) => showTooltip(id, e));
    node.addEventListener('mouseleave', hideTooltip);
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      showTooltip(id, e);
    });
  });

  document.addEventListener('click', (e) => {
    if (!mapContainer.contains(e.target)) hideTooltip();
  });

  // Corridor Filter Buttons
  const corridorBtns = document.querySelectorAll('.corridor-btn');
  const highwaysGroup = svgElem ? svgElem.querySelector('.highways-layer') : null;

  corridorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      corridorBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const corridor = btn.getAttribute('data-corridor');

      // Highlight logic on SVG paths
      if (highwaysGroup) {
        const paths = highwaysGroup.querySelectorAll('path');
        paths.forEach(p => {
          p.style.transition = 'opacity 0.3s ease, stroke-width 0.3s ease';
          if (corridor === 'all') {
            p.style.opacity = '';
          } else if (corridor === 'm5') {
            p.style.opacity = p.getAttribute('d').includes('1301') || p.getAttribute('d').includes('1260') ? '1' : '0.15';
          } else if (corridor === 'm1') {
            p.style.opacity = p.getAttribute('d').includes('135.8') && p.getAttribute('d').includes('826') ? '1' : '0.15';
          } else if (corridor === 'm8') {
            p.style.opacity = p.getAttribute('d').includes('1177') && p.getAttribute('d').includes('1301') ? '1' : '0.15';
          } else if (corridor === 'm10') {
            p.style.opacity = p.getAttribute('d').includes('516.9') || p.getAttribute('d').includes('1356') ? '1' : '0.15';
          }
        });
      }
    });
  });
}
async function submitLead(payload, statusNode, successMessage) {
  if (statusNode) statusNode.textContent = 'Отправляем…';
  try {
    const response = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('request_failed');
    if (statusNode) statusNode.textContent = successMessage;
    return true;
  } catch (error) {
    if (statusNode) statusNode.textContent = 'Не удалось отправить заявку. Попробуйте ещё раз или свяжитесь с нами по телефону.';
    return false;
  }
}

/* Interactive calculator now lives in assets/calculator.js
   (loaded only on calculator.html) to keep this file page-agnostic. */

/* contact form */
const contact = document.querySelector('[data-contact-form]');
if (contact) {
  contact.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(contact);
    const ok = await submitLead({
      name: data.get('name'),
      contact: data.get('contact'),
      message: data.get('message'),
      source: 'website_contacts',
    }, contact.querySelector('.form-status'), 'Заявка отправлена. Мы свяжемся с вами в течение рабочего дня.');
    if (ok) contact.reset();
  });
}

/* partners form */
const partnersForm = document.querySelector('[data-partners-form]');
if (partnersForm) {
  partnersForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(partnersForm);
    const ok = await submitLead({
      company: data.get('company'),
      contact_name: data.get('contact_name'),
      contact: data.get('contact'),
      direction: data.get('direction'),
      message: data.get('message'),
      source: 'website_partners',
    }, partnersForm.querySelector('.form-status'), 'Спасибо! Мы свяжемся с вами для обсуждения сотрудничества.');
    if (ok) partnersForm.reset();
  });
}
