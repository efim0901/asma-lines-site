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
   Interactive Belarus Vector Map Tooltips
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
    'gomel': { name: 'Гомель', region: 'Гомельская обл.', desc: 'Регулярные ежедневные рейсы и подбор автотранспорта', status: 'Активно', time: 'Ежедневно' },
    'minsk': { name: 'Минск', region: 'Минская обл.', desc: 'Столичный логистический узел · Экспресс-доставка', status: 'Активно', time: 'Ежедневно' },
    'brest': { name: 'Брест', region: 'Брестская обл.', desc: 'Западный пограничный хаб · Таможенный транзит', status: 'Активно', time: 'Ежедневно' },
    'grodno': { name: 'Гродно', region: 'Гродненская обл.', desc: 'Северо-западный узел · Обслуживание предприятий', status: 'Активно', time: 'Ежедневно' },
    'vitebsk': { name: 'Витебск', region: 'Витебская обл.', desc: 'Северный логистический хаб · Прямые рейсы', status: 'Активно', time: 'Ежедневно' },
    'mogilev': { name: 'Могилёв', region: 'Могилёвская обл.', desc: 'Восточный промышленный кластер · Регулярные рейсы', status: 'Активно', time: 'Ежедневно' },
    'baranovichi': { name: 'Барановичи', region: 'Брестская обл.', desc: 'Крупный транспортный перекрёсток на магистрали М-1', status: 'Активно', time: 'Ежедневно' },
    'bobruisk': { name: 'Бобруйск', region: 'Могилёвская обл.', desc: 'Ключевой промышленный узел и распределительный центр', status: 'Активно', time: 'Ежедневно' },
    'zhlobin': { name: 'Жлобин', region: 'Гомельская обл.', desc: 'Металлургический и логистический центр', status: 'Активно', time: 'Ежедневно' },
    'mozyr': { name: 'Мозырь', region: 'Гомельская обл.', desc: 'Нефтеперерабатывающий и промышленный узел Полесья', status: 'Активно', time: 'Ежедневно' },
    'kalinkovichi': { name: 'Калинковичи', region: 'Гомельская обл.', desc: 'Узловой транспортный перекрёсток Полесья', status: 'Активно', time: 'Ежедневно' },
    'rechitsa': { name: 'Речица', region: 'Гомельская обл.', desc: 'Промышленный и производственный узел', status: 'Активно', time: 'Ежедневно' },
    'svetlogorsk': { name: 'Светлогорск', region: 'Гомельская обл.', desc: 'Химическая и целлюлозная промышленность', status: 'Активно', time: 'Ежедневно' },
    'rogachev': { name: 'Рогачёв', region: 'Гомельская обл.', desc: 'Пищевой промышленный комплекс', status: 'Активно', time: 'Ежедневно' },
    'pinsk': { name: 'Пинск', region: 'Брестская обл.', desc: 'Центральный хаб Припятского Полесья', status: 'Активно', time: 'Ежедневно' },
    'orsha': { name: 'Орша', region: 'Витебская обл.', desc: 'Ключевой интермодальный транспортный перекрёсток', status: 'Активно', time: 'Ежедневно' },
    'polotsk': { name: 'Полоцк', region: 'Витебская обл.', desc: 'Северный промышленный узел и нефтехимия', status: 'Активно', time: 'Ежедневно' },
    'novopolotsk': { name: 'Новополоцк', region: 'Витебская обл.', desc: 'Крупнейший нефтехимический комплекс', status: 'Активно', time: 'Ежедневно' },
    'lida': { name: 'Лида', region: 'Гродненская обл.', desc: 'Логистический центр на магистрали М-6', status: 'Активно', time: 'Ежедневно' },
    'borisov': { name: 'Борисов', region: 'Минская обл.', desc: 'Машиностроение и фармацевтика на М-1', status: 'Активно', time: 'Ежедневно' },
    'soligorsk': { name: 'Солигорск', region: 'Минская обл.', desc: 'Горнодобывающий и производственный центр', status: 'Активно', time: 'Ежедневно' },
    'slutsk': { name: 'Слуцк', region: 'Минская обл.', desc: 'Агропромышленный комплекс', status: 'Активно', time: 'Ежедневно' },
    'zhodino': { name: 'Жодино', region: 'Минская обл.', desc: 'Машиностроительный промышленный центр', status: 'Активно', time: 'Ежедневно' },
    'kobrin': { name: 'Кобрин', region: 'Брестская обл.', desc: 'Перекрёсток магистралей М-1 и М-10', status: 'Активно', time: 'Ежедневно' },
    'slonim': { name: 'Слоним', region: 'Гродненская обл.', desc: 'Промышленный пункт юго-востока Гродненщины', status: 'Активно', time: 'Ежедневно' },
    'volkovysk': { name: 'Волковыск', region: 'Гродненская обл.', desc: 'Строительный и пищевой кластер', status: 'Активно', time: 'Ежедневно' },
    'smorgon': { name: 'Сморгонь', region: 'Гродненская обл.', desc: 'Деревообрабатывающий кластер', status: 'Активно', time: 'Ежедневно' },
    'gorki': { name: 'Горки', region: 'Могилёвская обл.', desc: 'Северо-восток Могилёвской области', status: 'Активно', time: 'Ежедневно' },
    'osipovichi': { name: 'Осиповичи', region: 'Могилёвская обл.', desc: 'Транспортный и вагоностроительный хаб', status: 'Активно', time: 'Ежедневно' },
    'bereza': { name: 'Берёза', region: 'Брестская обл.', desc: 'Транзитный пункт на магистрали М-1', status: 'Активно', time: 'Ежедневно' },
    'ivatsevichi': { name: 'Ивацевичи', region: 'Брестская обл.', desc: 'Деревообрабатывающий кластер на М-1', status: 'Активно', time: 'Ежедневно' },
    'dzerzhinsk': { name: 'Дзержинск', region: 'Минская обл.', desc: 'Логистический узел к юго-западу от Минска', status: 'Активно', time: 'Ежедневно' },
    'vileyka': { name: 'Вилейка', region: 'Минская обл.', desc: 'Северо-запад Минской области', status: 'Активно', time: 'Ежедневно' },
    'luninets': { name: 'Лунинец', region: 'Брестская обл.', desc: 'Узел на коридоре Полесья', status: 'Активно', time: 'Ежедневно' },
    'maryina_gorka': { name: 'Марьина Горка', region: 'Минская обл.', desc: 'Узел на трассе М-5', status: 'Активно', time: 'Ежедневно' },
    'dobrush': { name: 'Добруш', region: 'Гомельская обл.', desc: 'Восточный промышленный пункт', status: 'Активно', time: 'Ежедневно' },
    'lepel': { name: 'Лепель', region: 'Витебская обл.', desc: 'Узел на магистрали М-3', status: 'Активно', time: 'Ежедневно' },
    'krichev': { name: 'Кричев', region: 'Могилёвская обл.', desc: 'Цементная и строительная индустрия', status: 'Активно', time: 'Ежедневно' },
    'braslav': { name: 'Браслав', region: 'Витебская обл.', desc: 'Северо-западный туристический и логистический сервис', status: 'Активно', time: 'Ежедневно' },
    'zhitkovichi': { name: 'Житковичи', region: 'Гомельская обл.', desc: 'Транзитный узел на трассе М-10', status: 'Активно', time: 'Ежедневно' }
  };

  const cityNodes = mapContainer.querySelectorAll('.map-city-node, .map-hub-target');

  function showTooltip(id, evt) {
    const nodeName = evt.currentTarget ? (evt.currentTarget.getAttribute('data-name') || '') : '';
    const nodeRegion = evt.currentTarget ? (evt.currentTarget.getAttribute('data-region') || '') : '';

    const data = CITIES_DATA[id] || {
      name: nodeName || (id.charAt(0).toUpperCase() + id.slice(1)).replace(/_/g, ' '),
      region: nodeRegion || 'Республика Беларусь',
      desc: 'Регулярные рейсы ASMA Lines · Доставка от двери до двери',
      status: 'Активно',
      time: 'Ежедневно'
    };
    if (!tooltip) return;

    tTitle.textContent = data.name;
    tRegion.textContent = data.region;
    tDesc.textContent = data.desc;
    if (tDistance) tDistance.textContent = data.status || 'Активно';
    if (tTime) tTime.textContent = data.time || 'Ежедневно';
    if (tLink) tLink.href = `calculator.html?to=${encodeURIComponent(data.name)}`;

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
    const y = Math.max(140, clientY - rect.top - 12);

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
}
async function submitLead(payload, statusNode, successMessage) {
  if (statusNode) {
    statusNode.textContent = 'Отправляем данные…';
    statusNode.className = 'form-status form-status--loading';
  }
  try {
    const response = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('request_failed');
    if (statusNode) {
      statusNode.textContent = successMessage;
      statusNode.className = 'form-status form-status--success';
    }
    return true;
  } catch (error) {
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
    if (ok) partnersForm.reset();
  });
});
