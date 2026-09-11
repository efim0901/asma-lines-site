const rates = { base: 85, perKm: 1.65, perTonne: 18, fragile: 1.12, temperature: 1.28, loading: 45 };
const header = document.querySelector('.site-header');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!document.querySelector('link[rel="icon"]')) {
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/svg+xml';
  favicon.href = 'assets/brand/asma-mark.svg';
  document.head.append(favicon);
}

if (header) {
  const setHeaderState = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  setHeaderState();
  window.addEventListener('scroll', setHeaderState, { passive: true });
}

const themeButton = document.querySelector('.theme-toggle');
const savedTheme = localStorage.getItem('asma-theme');

function setTheme(dark) {
  document.body.dataset.theme = dark ? 'dark' : '';
  localStorage.setItem('asma-theme', dark ? 'dark' : 'light');
  if (themeButton) {
    themeButton.textContent = dark ? '☀' : '◐';
    themeButton.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  }
}

setTheme(savedTheme === 'dark');
if (themeButton) {
  themeButton.addEventListener('click', () => setTheme(document.body.dataset.theme !== 'dark'));
}

document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });

const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('#main-nav');
function setMenuOpen(open) {
  nav.classList.toggle('open', open);
  menu.classList.toggle('is-open', open);
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
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
}

const revealTargets = document.querySelectorAll('[data-reveal]');
revealTargets.forEach((node, index) => {
  node.style.transitionDelay = `${Math.min((index % 4) * 60, 180)}ms`;
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
  }, { threshold: .14 });
  revealTargets.forEach((node) => observer.observe(node));
}

const calculator = document.querySelector('#calculator');
if (calculator) {
  calculator.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(calculator);
    const km = Number(data.get('distance'));
    const weight = Number(data.get('weight'));
    let total = rates.base + km * rates.perKm + weight * rates.perTonne;
    if (data.get('cargo') === 'fragile') total *= rates.fragile;
    if (data.get('cargo') === 'temperature') total *= rates.temperature;
    if (data.get('loading')) total += rates.loading;

    document.querySelector('.quote-label').textContent = `${data.get('from')} → ${data.get('to')}`;
    document.querySelector('#quote-total').textContent = `от ${Math.round(total).toLocaleString('ru-RU')} BYN`;
    document.querySelector('#quote-note').textContent = 'Предварительный расчёт. Финальная стоимость подтверждается менеджером после уточнения параметров перевозки.';
    document.querySelector('#quote-link').classList.remove('hidden');

    // TODO(Bitrix24): payload ready for /api/lead, source: 'website_calculator'
    // { from, to, distance: km, weight, cargo, loading: !!data.get('loading'), estimate: Math.round(total) }
  });
}

const contact = document.querySelector('[data-contact-form]');
if (contact) {
  contact.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(contact);
    // TODO(Bitrix24): POST { name, contact, message, source: 'website_contacts' } to /api/lead
    contact.querySelector('.form-status').textContent = 'Заявка отправлена. Мы свяжемся с вами в течение рабочего дня.';
    contact.reset();
  });
}

const partnersForm = document.querySelector('[data-partners-form]');
if (partnersForm) {
  partnersForm.addEventListener('submit', (event) => {
    event.preventDefault();
    // TODO(Bitrix24): POST { company, contact, direction, message, source: 'website_partners' } to /api/lead
    partnersForm.querySelector('.form-status').textContent = 'Спасибо! Мы свяжемся с вами для обсуждения сотрудничества.';
    partnersForm.reset();
  });
}
