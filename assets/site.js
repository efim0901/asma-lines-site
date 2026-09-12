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
   Bitrix24 submit helper (server-side proxy at /api/lead)
   ------------------------------------------------------------ */
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

/* calculator */
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
    const estimate = Math.round(total);

    const quoteLabel = document.querySelector('.quote-label');
    const quoteTotal = document.querySelector('#quote-total');
    const quoteNote = document.querySelector('#quote-note');
    const quoteLink = document.querySelector('#quote-link');
    if (quoteLabel) quoteLabel.textContent = `${data.get('from')} → ${data.get('to')}`;
    if (quoteTotal) quoteTotal.textContent = `от ${estimate.toLocaleString('ru-RU')} BYN`;
    if (quoteNote) quoteNote.textContent = 'Предварительный расчёт. Финальная стоимость подтверждается менеджером после уточнения параметров перевозки.';
    if (quoteLink) quoteLink.classList.remove('hidden');
  });
}

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
