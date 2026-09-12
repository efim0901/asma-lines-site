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

/* ------------------------------------------------------------
   Interactive calculator:
   - live recalculation on every input (no submit button)
   - map of Belarus: recognised cities light up, route draws
     itself and a truck drives along it; distance auto-fills
   - total price tweens smoothly, cost breakdown animates
   ------------------------------------------------------------ */
(function initCalculator() {
  const form = document.querySelector('#calculator');
  if (!form) return;

  const els = {
    from: form.querySelector('#calc-from'),
    to: form.querySelector('#calc-to'),
    distance: form.querySelector('#calc-distance'),
    range: form.querySelector('#calc-distance-range'),
    weight: form.querySelector('#calc-weight'),
    loading: form.querySelector('#calc-loading'),
    label: document.querySelector('#quote-label'),
    total: document.querySelector('#quote-total'),
    note: document.querySelector('#quote-note'),
    link: document.querySelector('#quote-link'),
    hint: document.querySelector('#calc-hint'),
    breakdown: document.querySelector('#quote-breakdown'),
    multi: document.querySelector('#quote-multi'),
    qdBase: document.querySelector('#qd-base'),   qdBaseV: document.querySelector('#qd-base-v'),
    qdKm: document.querySelector('#qd-km'),       qdKmV: document.querySelector('#qd-km-v'),
    qdT: document.querySelector('#qd-t'),         qdTV: document.querySelector('#qd-t-v'),
    svg: document.querySelector('#calc-map'),
    citiesLayer: document.querySelector('#map-cities'),
    routePath: document.querySelector('#route-path'),
    truck: document.querySelector('#map-truck'),
    datalist: document.querySelector('#city-list'),
  };
  if (!els.svg) return;

  /* simplified city coordinates on the 520x400 viewBox */
  const CITIES = [
    { name: 'Гродно',       x: 43,  y: 209, aliases: ['гродно', 'hrodna', 'groдno'] },
    { name: 'Лида',         x: 116, y: 194, aliases: ['лида', 'lida'] },
    { name: 'Сморгонь',     x: 173, y: 147, aliases: ['сморгонь', 'smarhon', 'smorgon'] },
    { name: 'Молодечно',    x: 196, y: 159, aliases: ['молодечно', 'молодечна', 'maladzechna', 'molodechno'] },
    { name: 'Брест',        x: 37,  y: 330, aliases: ['брест', 'brest'] },
    { name: 'Кобрин',       x: 68,  y: 321, aliases: ['кобрин', 'kobryn'], lbl: 'below' },
    { name: 'Пинск',        x: 159, y: 328, aliases: ['пинск', 'pinsk'] },
    { name: 'Барановичи',   x: 153, y: 252, aliases: ['барановичи', 'baranavichy', 'baranovichi'] },
    { name: 'Минск',        x: 232, y: 192, aliases: ['минск', 'minsk'] },
    { name: 'Жодино',       x: 272, y: 177, aliases: ['жодино', 'zhodzina', 'zhodino'] },
    { name: 'Слуцк',        x: 232, y: 259, aliases: ['слуцк', 'slutsk'] },
    { name: 'Солигорск',    x: 231, y: 277, aliases: ['солигорск', 'salihorsk', 'soligorsk'] },
    { name: 'Бобруйск',     x: 317, y: 251, aliases: ['бобруйск', 'babruysk', 'bobruisk'] },
    { name: 'Полоцк',       x: 295, y: 71,  aliases: ['полоцк', 'polatsk', 'polotsk'] },
    { name: 'Новополоцк',   x: 285, y: 67,  aliases: ['новополоцк', 'navapolatsk', 'novopolotsk'] },
    { name: 'Витебск',      x: 367, y: 93,  aliases: ['витебск', 'vitebsk', 'vicebsk'] },
    { name: 'Орша',         x: 378, y: 145, aliases: ['орша', 'orsha'] },
    { name: 'Горки',        x: 407, y: 163, aliases: ['горки', 'gorki'] },
    { name: 'Могилёв',      x: 374, y: 192, aliases: ['могилев', 'могилёв', 'mahilyow', 'mogilev'] },
    { name: 'Жлобин',       x: 358, y: 269, aliases: ['жлобин', 'zhlobin'] },
    { name: 'Гомель',       x: 407, y: 304, aliases: ['гомель', 'gomel', 'homyel'] },
    { name: 'Мозырь',       x: 308, y: 354, aliases: ['мозырь', 'мозыр', 'mazyr', 'mozyr'] },
  ];

  const SVGNS = 'http://www.w3.org/2000/svg';
  const cityEls = new Map();

  /* render dots + labels + datalist */
  CITIES.forEach((city) => {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'city-node');
    g.dataset.city = city.name;

    const pulse = document.createElementNS(SVGNS, 'circle');
    pulse.setAttribute('class', 'city-pulse');
    pulse.setAttribute('cx', city.x); pulse.setAttribute('cy', city.y);
    pulse.setAttribute('r', 7);

    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('class', 'city-dot');
    dot.setAttribute('cx', city.x); dot.setAttribute('cy', city.y);
    dot.setAttribute('r', 4);

    const label = document.createElementNS(SVGNS, 'text');
    label.setAttribute('class', 'city-label');
    if (city.lbl === 'below') {
      label.setAttribute('x', city.x);
      label.setAttribute('y', city.y + 17);
      label.setAttribute('text-anchor', 'middle');
    } else {
      label.setAttribute('x', city.x + 8);
      label.setAttribute('y', city.y + 3.5);
    }
    label.textContent = city.name;

    g.append(pulse, dot, label);
    els.citiesLayer.append(g);
    cityEls.set(city.name, g);

    const opt = document.createElement('option');
    opt.value = city.name;
    els.datalist.append(opt);
  });

  function matchCity(raw) {
    if (!raw) return null;
    const norm = raw.toLowerCase().replace(/ё/g, 'е').trim()
      .replace(/^(г\.?|город|беларусь|республика беларусь)\s+/i, '')
      .trim();
    if (!norm) return null;
    return CITIES.find((c) => c.name.toLowerCase().replace(/ё/g, 'е') === norm
      || c.aliases.some((a) => a === norm)) || null;
  }

  /* quadratic curve between two points, bent to the "north" side */
  function curvePath(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }            // always bend upward
    const k = len * 0.16;
    return `M ${a.x} ${a.y} Q ${mx + nx * k} ${my + ny * k} ${b.x} ${b.y}`;
  }

  /* truck driving along the route */
  let truckRaf = null;
  function driveTruck() {
    if (reducedMotion) return;
    cancelAnimationFrame(truckRaf);
    const path = els.routePath;
    const length = path.getTotalLength();
    if (!length) return;
    const start = performance.now();
    const speed = 90; // px per second
    const tick = (now) => {
      const t = ((now - start) / 1000 * speed) % (length + 40) - 20;
      if (t < 0) {
        els.truck.setAttribute('visibility', 'hidden');
      } else {
        const pos = path.getPointAtLength(t);
        const ahead = path.getPointAtLength(Math.min(t + 2, length));
        const angle = Math.atan2(ahead.y - pos.y, ahead.x - pos.x) * 180 / Math.PI;
        els.truck.setAttribute('visibility', 'visible');
        els.truck.setAttribute('transform', `translate(${pos.x} ${pos.y}) rotate(${angle})`);
      }
      truckRaf = requestAnimationFrame(tick);
    };
    truckRaf = requestAnimationFrame(tick);
  }
  function stopTruck() {
    cancelAnimationFrame(truckRaf);
    els.truck.setAttribute('visibility', 'hidden');
  }

  /* smooth number tween for the total */
  let tweenRaf = null;
  function tweenTotal(from, to) {
    cancelAnimationFrame(tweenRaf);
    if (reducedMotion || from === to) {
      els.total.textContent = `от ${to.toLocaleString('ru-RU')} BYN`;
      return;
    }
    const start = performance.now(), dur = 550;
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.round(from + (to - from) * eased);
      els.total.textContent = `от ${value.toLocaleString('ru-RU')} BYN`;
      if (p < 1) tweenRaf = requestAnimationFrame(step);
    };
    tweenRaf = requestAnimationFrame(step);
    els.total.classList.remove('is-flashing');
    void els.total.offsetWidth; // restart animation
    els.total.classList.add('is-flashing');
  }

  function currentTotal() {
    const km = Number(els.distance.value) || 0;
    const weight = Number(els.weight.value) || 0;
    if (!km || !weight) return null;
    let total = rates.base + km * rates.perKm + weight * rates.perTonne;
    const cargo = form.querySelector('input[name="cargo"]:checked');
    if (cargo && cargo.value === 'fragile') total *= rates.fragile;
    if (cargo && cargo.value === 'temperature') total *= rates.temperature;
    if (els.loading && els.loading.checked) total += rates.loading;
    return Math.round(total);
  }

  let shownTotal = 0;
  function recalc() {
    const km = Number(els.distance.value) || 0;
    const weight = Number(els.weight.value) || 0;
    const cargo = form.querySelector('input[name="cargo"]:checked');
    const total = currentTotal();

    /* sync range slider + fill */
    if (els.range && document.activeElement !== els.range) {
      if (km && Number(els.range.value) !== km) els.range.value = Math.min(km, Number(els.range.max));
    }
    if (els.range) {
      const max = Number(els.range.max);
      const val = Number(els.range.value) || 0;
      els.range.style.setProperty('--fill', `${Math.min(val / max * 100, 100)}%`);
    }

    /* sync weight chips */
    form.querySelectorAll('.weight-chips button').forEach((btn) => {
      btn.classList.toggle('is-active', weight > 0 && Number(btn.dataset.weight) === weight);
    });

    if (!total) {
      els.label.textContent = 'Заполните параметры перевозки';
      els.total.textContent = '—';
      els.note.textContent = 'Укажите расстояние и вес груза — ориентир появится здесь.';
      els.link.classList.add('hidden');
      els.breakdown.hidden = true;
      els.multi.hidden = true;
      shownTotal = 0;
      return;
    }

    const fromTxt = els.from.value.trim() || 'Откуда';
    const toTxt = els.to.value.trim() || 'Куда';
    els.label.textContent = `${fromTxt} → ${toTxt} · ${km} км · ${weight} т`;

    tweenTotal(shownTotal, total);
    shownTotal = total;

    /* breakdown bars (shares of the pre-multiplier subtotal) */
    const basePart = rates.base, kmPart = km * rates.perKm, tPart = weight * rates.perTonne;
    const subtotal = basePart + kmPart + tPart || 1;
    els.breakdown.hidden = false;
    const fmt = (v) => `${Math.round(v).toLocaleString('ru-RU')} р.`;
    els.qdBase.style.width = `${Math.max(basePart / subtotal * 100, 5)}%`;
    els.qdKm.style.width = `${Math.max(kmPart / subtotal * 100, 5)}%`;
    els.qdT.style.width = `${Math.max(tPart / subtotal * 100, 5)}%`;
    els.qdBaseV.textContent = fmt(basePart);
    els.qdKmV.textContent = fmt(kmPart);
    els.qdTV.textContent = fmt(tPart);

    /* multiplier note */
    const extras = [];
    if (cargo && cargo.value === 'fragile') extras.push(`хрупкий груз ×${rates.fragile}`);
    if (cargo && cargo.value === 'temperature') extras.push(`температурный режим ×${rates.temperature}`);
    if (els.loading && els.loading.checked) extras.push(`погрузка/разгрузка +${rates.loading} р.`);
    if (extras.length) {
      els.multi.hidden = false;
      els.multi.textContent = extras.join(' · ');
    } else {
      els.multi.hidden = true;
    }

    els.note.textContent = 'Предварительный расчёт. Финальная стоимость подтверждается менеджером после уточнения параметров перевозки.';
    els.link.classList.remove('hidden');
  }

  /* map state */
  let distanceTouched = false;
  function updateMap() {
    const a = matchCity(els.from.value);
    const b = matchCity(els.to.value);

    cityEls.forEach((g, name) => {
      g.classList.toggle('is-active', (a && a.name === name) || (b && b.name === name));
    });

    if (a && b && a.name !== b.name) {
      els.routePath.setAttribute('d', curvePath(a, b));
      els.routePath.classList.remove('is-hidden');
      els.hint.textContent = `Маршрут: ${a.name} → ${b.name}`;
      els.hint.classList.remove('is-hidden');
      if (!distanceTouched) {
        const straight = Math.hypot(b.x - a.x, b.y - a.y);
        const km = Math.max(5, Math.round(straight * 1.37 * 1.28 / 5) * 5);
        els.distance.value = km;
        if (km > Number(els.range.max)) els.range.max = Math.ceil(km / 50) * 50;
      }
      driveTruck();
    } else {
      els.routePath.classList.add('is-hidden');
      stopTruck();
      if (a || b) {
        els.hint.textContent = a
          ? `Город "${a.name}" найден — введите пункт назначения`
          : `Город "${b.name}" найден — введите пункт отправления`;
        els.hint.classList.remove('is-hidden');
      } else {
        els.hint.textContent = 'Начните вводить город — он появится на карте';
        els.hint.classList.remove('is-hidden');
      }
    }
    recalc();
  }

  /* events */
  ['input', 'change'].forEach((evt) => form.addEventListener(evt, (e) => {
    if (e.target === els.from || e.target === els.to) updateMap();
    else recalc();
  }));
  els.from.addEventListener('input', updateMap);
  els.to.addEventListener('input', updateMap);

  els.distance.addEventListener('input', () => { distanceTouched = true; recalc(); });
  els.range.addEventListener('input', () => {
    distanceTouched = true;
    els.distance.value = els.range.value;
    recalc();
  });

  form.querySelectorAll('.weight-chips button').forEach((btn) => {
    btn.addEventListener('click', () => {
      els.weight.value = btn.dataset.weight;
      recalc();
    });
  });

  form.addEventListener('submit', (e) => e.preventDefault());

  /* initial paint */
  if (els.range) {
    els.range.style.setProperty('--fill', `${Number(els.range.value) / Number(els.range.max) * 100}%`);
  }
})();

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
