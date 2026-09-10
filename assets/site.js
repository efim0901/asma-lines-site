const rates = { base: 85, perKm: 1.65, perTonne: 18, fragile: 1.12, temperature: 1.28, loading: 45 };
const header = document.querySelector('.site-header');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const brandMarkup = `
  <picture>
    <source media="(max-width: 480px)" srcset="assets/brand/asma-crest-short.svg">
    <img class="brand-logo" src="assets/brand/asma-full.svg" alt="ASMA Lines">
  </picture>`;

document.querySelectorAll('.brand').forEach((brand) => {
  brand.innerHTML = brandMarkup;
});

if (!document.querySelector('link[rel="icon"]')) {
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/svg+xml';
  favicon.href = 'assets/brand/asma-crest-short.svg';
  document.head.append(favicon);
}

if (header) {
  if (!document.querySelector('.top-line')) {
    header.insertAdjacentHTML('beforebegin', `
      <div class="top-line"><div class="top-line-inner">
        <span><strong>ASMA LINES</strong> · Внутренние перевозки по Беларуси</span>
        <span>Гомель · Беларусь</span>
      </div></div>`);
  }

  const navigation = header.querySelector('nav');
  if (navigation && !navigation.querySelector('a[href="faq.html"]')) {
    navigation.insertAdjacentHTML('beforeend', '<a href="faq.html">FAQ</a>');
  }

  const menuButton = header.querySelector('.menu-toggle');
  if (menuButton && !header.querySelector('.theme-toggle')) {
    menuButton.insertAdjacentHTML('beforebegin', '<button class="theme-toggle" type="button" aria-label="Переключить цветовую тему" title="Переключить тему">◐</button>');
  }

  if (!document.querySelector('.floating-contact')) {
    document.body.insertAdjacentHTML('beforeend', '<a class="floating-contact" href="contacts.html" aria-label="Перейти к контактам">↗</a>');
  }

  const setHeaderState = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
  setHeaderState();
  window.addEventListener('scroll', setHeaderState, { passive: true });
}

const themeButton = document.querySelector('.theme-toggle');
const savedTheme = localStorage.getItem('asma-theme');

function setTheme(dark) {
  document.body.dataset.theme = dark ? 'dark' : '';
  localStorage.setItem('asma-theme', dark ? 'dark' : 'light');
  if (themeButton) {
    themeButton.textContent = dark ? '☼' : '◐';
    themeButton.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  }
}

setTheme(savedTheme === 'dark');
if (themeButton) {
  themeButton.addEventListener('click', () => setTheme(document.body.dataset.theme !== 'dark'));
}

document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });

const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('nav');
if (menu && nav) {
  menu.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
    menu.textContent = open ? 'Закрыть' : 'Меню';
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    if (nav.classList.contains('open')) {
      nav.classList.remove('open');
      menu.setAttribute('aria-expanded', 'false');
      menu.textContent = 'Меню';
    }
  }));
}

const revealTargets = document.querySelectorAll([
  '.hero-copy', '.hero-stage', '.page-title > *', '.section > h2', '.section > .grid',
  '.section > .split', '.card', '.metrics article', '.calculator', '.quote',
  '.contact-form', '.contacts > div', '.faq-item', '.checks'
].join(','));

revealTargets.forEach((node, index) => {
  node.dataset.reveal = '';
  node.style.transitionDelay = `${Math.min((index % 5) * 55, 180)}ms`;
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
    document.querySelector('#quote-note').textContent = 'Ориентировочная стоимость. Итоговая ставка зависит от даты, типа транспорта и условий перевозки.';
    document.querySelector('#quote-link').classList.remove('hidden');
  });
}

const contact = document.querySelector('[data-contact-form]');
if (contact) {
  contact.addEventListener('submit', (event) => {
    event.preventDefault();
    contact.querySelector('.form-status').textContent = 'Форма готова к подключению к серверной отправке. Пока укажите рабочий e-mail или CRM-интеграцию.';
  });
}
