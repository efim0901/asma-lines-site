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

// Калькулятор с точной формулировкой из ТЗ
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

    const finalEstimate = Math.round(total);

    document.querySelector('.quote-label').textContent = `\({data.get('from')} →\){data.get('to')}`;
    document.querySelector('#quote-total').textContent = `от ${finalEstimate.toLocaleString('ru-RU')} BYN`;
    document.querySelector('#quote-note').textContent = 'Предварительный расчёт. Финальная стоимость подтверждается менеджером после уточнения параметров перевозки.';
    document.querySelector('#quote-link').classList.remove('hidden');

    // Сохранение данных расчета для передачи в CRM при клике "Оставить заявку"
    window.lastCalculation = {
      source: 'website_calculator',
      from: data.get('from'),
      to: data.get('to'),
      distance: km,
      weight: weight,
      cargo: data.get('cargo'),
      loading: data.get('loading') ? true : false,
      calculatedEstimate: finalEstimate
    };
  });
}

// Форма контактов и партнеров (подготовка к Bitrix24)
const contactForms = document.querySelectorAll('[data-contact-form]');
contactForms.forEach(contact => {
  contact.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = contact.querySelector('button[type="submit"]');
    const statusNode = contact.querySelector('.form-status');
    const formData = new FormData(contact);
    
    // Сборка payload для API
    const payload = {
      source: contact.dataset.source || 'website_contacts', // website_contacts / website_partners
      name: formData.get('name') || formData.get('company') || '',
      contact: formData.get('phone') || formData.get('email') || '',
      message: formData.get('message') || '',
      ...window.lastCalculation // Прикрепить расчет, если заявка идет из калькулятора
    };

    if (btn) btn.disabled = true;
    if (statusNode) {
      statusNode.textContent = 'Отправка заявки...';
      statusNode.style.color = 'var(--ink)';
    }

    try {
      // Имитация fetch запроса к Cloudflare Worker (/api/lead)
      // В реальности раскомментировать: await fetch('/api/lead', { method: 'POST', body: JSON.stringify(payload) });
      await new Promise(r => setTimeout(r, 800)); 
      
      if (statusNode) {
        statusNode.textContent = 'Заявка отправлена. Мы свяжемся с вами.';
        statusNode.style.color = 'var(--wine)';
      }
      contact.reset();
      window.lastCalculation = null; // Очистка кэша калькулятора
    } catch (error) {
      if (statusNode) {
        statusNode.textContent = 'Ошибка при отправке. Пожалуйста, попробуйте позже.';
        statusNode.style.color = '#d32f2f';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });
});
