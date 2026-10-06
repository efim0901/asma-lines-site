(function initCalculator() {
  const form = document.querySelector('#calculator');
  if (!form) return;

  const mapEl = document.querySelector('#calc-leaflet-map');
  const hintElFallback = document.querySelector('#calc-hint');
  if (!mapEl) return;
  if (typeof window.L === 'undefined') {
    mapEl.classList.add('calc-leaflet-map--error');
    mapEl.textContent = 'Карта временно недоступна.';
    if (hintElFallback) hintElFallback.textContent = 'Карта не загрузилась (F12 → Console).';
    return;
  }

  // Тарифы берём из общего модуля assets/pricing-client.js — он совпадает
  // с серверным расчётом, поэтому показанная цена равна той, что увидит диспетчер.
  const PRICING = window.ASMA_PRICING;
  if (!PRICING) {
    console.error('ASMA: не загружен assets/pricing-client.js — расчёт стоимости недоступен');
    return;
  }
  const RATES = PRICING.RATES;
  const ROAD_COEFFICIENT = RATES.roadCoefficient;
  const GEOCODE_DEBOUNCE_MS = 550;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const els = {
    from: form.querySelector('#calc-from'),
    to: form.querySelector('#calc-to'),
    distance: form.querySelector('#calc-distance'),
    range: form.querySelector('#calc-distance-range') || null,
    btnResetDistance: document.querySelector('#btn-reset-distance'),
    resetKmLabel: document.querySelector('#reset-km-label'),
    weight: form.querySelector('#calc-weight'),
    loading: form.querySelector('#calc-loading'),
    label: document.querySelector('#quote-label'),
    total: document.querySelector('#quote-total'),
    note: document.querySelector('#quote-note'),
    link: document.querySelector('#quote-link'),
    actions: document.querySelector('#quote-actions'),
    btnQuickConsult: document.querySelector('#btn-quick-consult'),
    btnToggleShare: document.querySelector('#btn-toggle-share'),
    btnPrintProposal: document.querySelector('#btn-print-proposal'),
    shareBox: document.querySelector('#quote-share-box'),
    shareTg: document.querySelector('#share-tg'),
    shareViber: document.querySelector('#share-viber'),
    shareMail: document.querySelector('#share-mail'),
    shareCopy: document.querySelector('#share-copy'),
    copyBtnText: document.querySelector('#copy-btn-text'),
    hint: document.querySelector('#calc-hint'),
    breakdown: document.querySelector('#quote-breakdown'),
    multi: document.querySelector('#quote-multi'),
    qdBase: document.querySelector('#qd-base'),   qdBaseV: document.querySelector('#qd-base-v'),
    qdKm: document.querySelector('#qd-km'),       qdKmV: document.querySelector('#qd-km-v'),
    qdT: document.querySelector('#qd-t'),         qdTV: document.querySelector('#qd-t-v'),
    modal: document.querySelector('#consult-modal'),
    modalClose: document.querySelector('#modal-close'),
    modalRoutePreview: document.querySelector('#modal-route-preview'),
    modalHiddenRoute: document.querySelector('#modal-hidden-route'),
    consultForm: document.querySelector('#consult-form'),
    mobileBar: document.querySelector('#calc-mobile-bar'),
    mobileBarRoute: document.querySelector('#mobile-bar-route'),
    mobileBarMeta: document.querySelector('#mobile-bar-meta'),
    mobileBarPrice: document.querySelector('#mobile-bar-price'),
    mobileBarCta: document.querySelector('#mobile-bar-cta'),
  };

  function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' || document.body.dataset.theme === 'dark';
  }

  // Map Engine Setup: Yandex Maps API v2.1 Primary, Leaflet Fallback
  let map = null;
  let currentTileLayer = null;

  function initLeafletFallback() {
    if (map || typeof window.L === 'undefined') return;
    try {
      mapEl.innerHTML = '';
      const BY_CENTER = [53.55, 28.0];
      const BY_BOUNDS = window.L.latLngBounds([50.9, 22.6], [56.4, 33.1]);
      const isTouch = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
      map = window.L.map(mapEl, {
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: !isTouch,
        tap: false,
        minZoom: 6,
        maxZoom: 18,
      }).setView(BY_CENTER, 7);
      map.setMaxBounds(BY_BOUNDS.pad(0.2));
      setupTiles(0);
      setTimeout(triggerInvalidate, 80);
      setTimeout(triggerInvalidate, 400);
      setTimeout(triggerInvalidate, 1000);
    } catch (err) {
      console.warn('Leaflet fallback init error:', err);
    }
  }

  function getTileSources(isDark) {
    if (isDark) {
      return [
        { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', subdomains: '', maxZoom: 16 },
        { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: 'abc', maxZoom: 19 }
      ];
    }
    return [
      { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: 'abc', maxZoom: 19 },
      { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', subdomains: '', maxZoom: 18 }
    ];
  }

  function setupTiles(sourceIndex = 0) {
    if (!map) return;
    const isDark = isDarkTheme();
    const tileSources = getTileSources(isDark);
    if (sourceIndex >= tileSources.length) return;
    if (currentTileLayer) {
      try { map.removeLayer(currentTileLayer); } catch (_) {}
    }
    const cfg = tileSources[sourceIndex];
    currentTileLayer = window.L.tileLayer(cfg.url, {
      subdomains: cfg.subdomains,
      maxZoom: cfg.maxZoom,
      crossOrigin: true,
      attribution: '',
    });
    currentTileLayer.addTo(map);
  }

  initLeafletFallback();

  window.addEventListener('themechange', () => {
    if (map) setupTiles(0);
    if (routeLine && map) {
      const isDark = isDarkTheme();
      routeLine.setStyle({ color: isDark ? '#FFD382' : '#8B2536' });
    }
  });

  function triggerInvalidate() {
    try {
      if (map) map.invalidateSize();
    } catch (_) {}
  }
  setTimeout(triggerInvalidate, 80);
  setTimeout(triggerInvalidate, 350);
  setTimeout(triggerInvalidate, 1000);
  window.addEventListener('resize', triggerInvalidate);
  window.addEventListener('orientationchange', triggerInvalidate);
  window.addEventListener('load', triggerInvalidate);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) triggerInvalidate();
  });

  function pinIcon(isOrigin) {
    return window.L.divIcon({
      className: `calc-pin${isOrigin ? ' is-origin' : ''}`,
      html: '<span></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  function currentCargoType() {
    const cargo = form.querySelector('input[name="cargo"]:checked');
    return cargo ? cargo.value : 'standard';
  }
  function currentWeightClass() {
    const w = Number(els.weight.value) || 0;
    if (!window.ASMAVehicles) return 'm';
    return window.ASMAVehicles.classFor(w);
  }

  let vehicleState = { class: null, cargo: null, html: '', width: 24, height: 50, anchor: [12, 25] };

  function buildVehicleIcon() {
    if (!window.ASMAVehicles) {
      return window.L.divIcon({
        className: 'calc-van',
        html: '<span class="calc-van-arrow"></span>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
    }
    const wc = currentWeightClass();
    const ct = currentCargoType();
    if (vehicleState.class !== wc || vehicleState.cargo !== ct || !vehicleState.html) {
      const pick = window.ASMAVehicles.pickRandom(wc, ct);
      vehicleState = {
        class: wc,
        cargo: ct,
        html: pick.html,
        width: pick.width,
        height: pick.height,
        anchor: pick.anchor,
      };
    }
    return window.L.divIcon({
      className: 'calc-vehicle',
      html: vehicleState.html,
      iconSize: [vehicleState.width, vehicleState.height],
      iconAnchor: vehicleState.anchor,
    });
  }

  function refreshVehicleMarker() {
    if (!vanMarker) return;
    vanMarker.setIcon(buildVehicleIcon());
  }

  let markerFrom = null;
  let markerTo = null;
  let routeLine = null;
  // Маркер-«машинка» вдоль маршрута: анимация отключена (driveVan/stopVan — заглушки),
  // поэтому переменная всегда null, а refreshVehicleMarker() ниже — безопасная проверка.
  let vanMarker = null;

  // Pre-compiled offline dictionary of 70+ Belarusian cities and regional hubs for instant zero-latency lookup
  const BY_SETTLEMENTS = {
    'минск': { lat: 53.9045, lon: 27.5615, name: 'Минск' },
    'гомель': { lat: 52.4345, lon: 30.9754, name: 'Гомель' },
    'брест': { lat: 52.0976, lon: 23.7341, name: 'Брест' },
    'гродно': { lat: 53.6688, lon: 23.8258, name: 'Гродно' },
    'витебск': { lat: 55.1904, lon: 30.2049, name: 'Витебск' },
    'могилев': { lat: 53.8981, lon: 30.3325, name: 'Могилёв' },
    'могилёв': { lat: 53.8981, lon: 30.3325, name: 'Могилёв' },
    'барановичи': { lat: 53.1327, lon: 26.0139, name: 'Барановичи' },
    'бобруйск': { lat: 53.1384, lon: 29.2214, name: 'Бобруйск' },
    'пинск': { lat: 52.1153, lon: 26.1031, name: 'Пинск' },
    'мозырь': { lat: 52.0495, lon: 29.2456, name: 'Мозырь' },
    'орша': { lat: 54.5070, lon: 30.4262, name: 'Орша' },
    'полоцк': { lat: 55.4856, lon: 28.7686, name: 'Полоцк' },
    'новополоцк': { lat: 55.5323, lon: 28.6582, name: 'Новополоцк' },
    'лида': { lat: 53.8828, lon: 25.3013, name: 'Лида' },
    'борисов': { lat: 54.2276, lon: 28.5050, name: 'Борисов' },
    'солигорск': { lat: 52.7876, lon: 27.5415, name: 'Солигорск' },
    'слуцк': { lat: 53.0274, lon: 27.5595, name: 'Слуцк' },
    'жлобин': { lat: 52.8906, lon: 30.0247, name: 'Жлобин' },
    'светлогорск': { lat: 52.6331, lon: 29.7389, name: 'Светлогорск' },
    'речица': { lat: 52.3639, lon: 30.3953, name: 'Речица' },
    'кобрин': { lat: 52.2138, lon: 24.3564, name: 'Кобрин' },
    'слоним': { lat: 53.0933, lon: 25.3161, name: 'Слоним' },
    'волковыск': { lat: 53.1611, lon: 24.4539, name: 'Волковыск' },
    'сморгонь': { lat: 54.4811, lon: 26.3986, name: 'Сморгонь' },
    'калинковичи': { lat: 52.1286, lon: 29.3244, name: 'Калинковичи' },
    'рогачев': { lat: 53.0931, lon: 30.0494, name: 'Рогачёв' },
    'рогачёв': { lat: 53.0931, lon: 30.0494, name: 'Рогачёв' },
    'горки': { lat: 54.2861, lon: 30.9856, name: 'Горки' },
    'осиповичи': { lat: 53.3056, lon: 28.6444, name: 'Осиповичи' },
    'береза': { lat: 52.5317, lon: 24.9789, name: 'Берёза' },
    'берёза': { lat: 52.5317, lon: 24.9789, name: 'Берёза' },
    'ивацевичи': { lat: 52.7094, lon: 25.3406, name: 'Ивацевичи' },
    'дзержинск': { lat: 53.6833, lon: 27.1333, name: 'Дзержинск' },
    'вилейка': { lat: 54.4914, lon: 26.9108, name: 'Вилейка' },
    'лунинец': { lat: 52.2483, lon: 26.8011, name: 'Лунинец' },
    'марьина горка': { lat: 53.5083, lon: 28.1517, name: 'Марьина Горка' },
    'поставы': { lat: 55.1117, lon: 26.8322, name: 'Поставы' },
    'пружаны': { lat: 52.5561, lon: 24.4642, name: 'Пружаны' },
    'глубокое': { lat: 55.1378, lon: 27.6908, name: 'Глубокое' },
    'добруш': { lat: 52.4117, lon: 31.3211, name: 'Добруш' },
    'лепель': { lat: 54.8814, lon: 28.6967, name: 'Лепель' },
    'быхов': { lat: 53.5208, lon: 30.2528, name: 'Быхов' },
    'кричев': { lat: 53.7144, lon: 31.7139, name: 'Кричев' },
    'мосты': { lat: 53.4111, lon: 24.5361, name: 'Мосты' },
    'щучин': { lat: 53.6042, lon: 24.7436, name: 'Щучин' },
    'ошмяны': { lat: 54.4253, lon: 25.9361, name: 'Ошмяны' },
    'столбцы': { lat: 53.4833, lon: 26.7333, name: 'Столбцы' },
    'климовичи': { lat: 53.6108, lon: 31.9567, name: 'Климовичи' },
    'шклов': { lat: 54.2047, lon: 30.2978, name: 'Шклов' },
    'житковичи': { lat: 52.2189, lon: 27.8592, name: 'Житковичи' },
    'браслав': { lat: 55.6389, lon: 27.0319, name: 'Браслав' },
    'островец': { lat: 54.6139, lon: 25.9556, name: 'Островец' },
    'фаниполь': { lat: 53.7500, lon: 27.3333, name: 'Фаниполь' },
    'логойск': { lat: 54.2056, lon: 27.8486, name: 'Логойск' },
    'несвиж': { lat: 53.2194, lon: 26.6806, name: 'Несвиж' },
    'столин': { lat: 51.8906, lon: 26.8456, name: 'Столин' },
    'микашевичи': { lat: 52.2178, lon: 27.4764, name: 'Микашевичи' },
    'заславль': { lat: 54.0083, lon: 27.2917, name: 'Заславль' },
    'белоозерск': { lat: 52.4719, lon: 25.1764, name: 'Белоозёрск' },
    'петриков': { lat: 52.1289, lon: 27.7478, name: 'Петриков' },
    'хойники': { lat: 51.8917, lon: 29.9667, name: 'Хойники' },
    'жодино': { lat: 54.1000, lon: 28.3500, name: 'Жодино' },
    'чечерск': { lat: 52.9167, lon: 30.9167, name: 'Чечерск' },
    'буда-кошелево': { lat: 52.7167, lon: 30.7000, name: 'Буда-Кошелёво' },
    'ельск': { lat: 51.8167, lon: 29.1500, name: 'Ельск' },
    'наровля': { lat: 51.8000, lon: 29.5000, name: 'Наровля' },
    'ветка': { lat: 52.5667, lon: 31.1833, name: 'Ветка' },
    'лоев': { lat: 51.9333, lon: 30.8000, name: 'Лоев' },
    'брагин': { lat: 51.7833, lon: 30.2667, name: 'Брагин' },
    'комарин': { lat: 51.2742, lon: 30.5317, name: 'Комарин' },
  };

  const geocodeCache = new Map();
  async function geocode(rawQuery) {
    const cleanQuery = rawQuery.replace(/,?\s*беларусь/gi, '').trim().toLowerCase();
    if (!cleanQuery) return null;
    
    // 1. Instant offline settlements dictionary match
    if (BY_SETTLEMENTS[cleanQuery]) {
      return BY_SETTLEMENTS[cleanQuery];
    }
    // Partial starting match (e.g. "гоме" -> "Гомель")
    for (const [key, item] of Object.entries(BY_SETTLEMENTS)) {
      if (cleanQuery.length >= 3 && key.startsWith(cleanQuery)) {
        return item;
      }
    }

    if (geocodeCache.has(cleanQuery)) return geocodeCache.get(cleanQuery);

    // 2. Try proxy endpoint if available
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(cleanQuery + ', Беларусь')}`);
      if (res.ok) {
        const place = await res.json();
        if (place && place.lat && place.lon) {
          geocodeCache.set(cleanQuery, place);
          return place;
        }
      }
    } catch {
      // Cloudflare / static hosting fallback
    }

    // 3. Direct Public OpenStreetMap Nominatim with retry
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=by&accept-language=ru&q=${encodeURIComponent(cleanQuery + ', Беларусь')}`;
      const res = await fetch(url);
      if (res.ok) {
        const rows = await res.json();
        const row = rows && rows[0];
        const place = row
          ? { lat: parseFloat(row.lat), lon: parseFloat(row.lon), name: (row.display_name || cleanQuery).split(',')[0].trim() }
          : null;
        if (place) {
          geocodeCache.set(cleanQuery, place);
          return place;
        }
      }
    } catch {
      // Network limitation fallback
    }

    return null;
  }

  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  async function fetchRoute(a, b) {
    try {
      const res = await fetch(`/api/route?from=${a.lon},${a.lat}&to=${b.lon},${b.lat}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.coords && data.coords.length) {
          return data;
        }
      }
    } catch {
      // Fallback
    }

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('routing_failed');
      const data = await res.json();
      const route = data.routes && data.routes[0];
      if (!route) throw new Error('no_route');
      return {
        km: route.distance / 1000,
        coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
        approx: false,
      };
    } catch {
      const km = haversineKm([a.lat, a.lon], [b.lat, b.lon]) * ROAD_COEFFICIENT;
      return { km, coords: [[a.lat, a.lon], [b.lat, b.lon]], approx: true };
    }
  }

  function driveVan() {}
  function stopVan() {}

  function currentTotal() {
    const km = Number(els.distance.value) || 0;
    const weight = Number(els.weight.value) || 0;
    if (!km || !weight) return null;
    const cargo = form.querySelector('input[name="cargo"]:checked');
    const quote = PRICING.calculatePrice({
      distanceKm: km,
      weightTons: weight,
      cargo: cargo ? cargo.value : 'standard',
      loading: Boolean(els.loading && els.loading.checked)
    });
    return quote ? quote.total : null;
  }

  /** Подпись подвижного состава из общей таблицы ступеней. */
  function vehicleLabel(weight) {
    return PRICING.vehicleForWeight(weight).vehicle;
  }

  let tweenRaf = null;
  function tweenTotal(from, to) {
    cancelAnimationFrame(tweenRaf);
    if (reducedMotion || from === to) {
      els.total.textContent = `от ${to.toLocaleString('ru-RU')} BYN`;
      return;
    }
    const start = performance.now(); const dur = 550;
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.round(from + (to - from) * eased);
      els.total.textContent = `от ${value.toLocaleString('ru-RU')} BYN`;
      if (p < 1) tweenRaf = requestAnimationFrame(step);
    };
    tweenRaf = requestAnimationFrame(step);
    els.total.classList.remove('is-flashing');
    void els.total.offsetWidth;
    els.total.classList.add('is-flashing');
  }

  let shownTotal = 0;
  function recalc() {
    const km = Number(els.distance.value) || 0;
    const weight = Number(els.weight.value) || 0;
    const cargo = form.querySelector('input[name="cargo"]:checked');
    const total = currentTotal();

    if (els.range && document.activeElement !== els.range) {
      if (km && Number(els.range.value) !== km) els.range.value = Math.min(km, Number(els.range.max));
    }
    if (els.range) {
      const max = Number(els.range.max);
      const val = Number(els.range.value) || 0;
      els.range.style.setProperty('--fill', `${Math.min((val / max) * 100, 100)}%`);
    }

    form.querySelectorAll('.b2b-qweight-btn, .weight-chips button').forEach((btn) => {
      const btnW = Number(btn.dataset.weight);
      btn.classList.toggle('is-active', weight > 0 && Math.abs(btnW - weight) < 0.05);
    });

    // Подсветка карточки подвижного состава: выбираем наименьшую карточку,
    // которая выдерживает указанный вес. Прежние жёсткие пороги оставляли
    // груз 6–20 т вообще без подсветки.
    const vehicleCards = Array.from(form.querySelectorAll('.b2b-vcard, .v-class-card'));
    const capacities = vehicleCards
      .map((card) => ({ card, capacity: Number(card.dataset.vehicleWeight) || 0 }))
      .filter((item) => item.capacity > 0)
      .sort((a, b) => a.capacity - b.capacity);
    let matchedCard = null;
    if (weight > 0 && capacities.length) {
      matchedCard = (capacities.find((item) => weight <= item.capacity) || capacities[capacities.length - 1]).card;
    }
    for (const item of capacities) {
      const active = item.card === matchedCard;
      item.card.classList.toggle('is-active', active);
      item.card.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    updateResetButtonState();

    if (!total) {
      els.label.textContent = 'Заполните параметры перевозки';
      els.total.textContent = '—';
      els.note.textContent = 'Укажите маршрут и вес груза для расчёта ставки.';
      if (els.link) els.link.classList.add('hidden');
      if (els.actions) els.actions.hidden = true;
      els.breakdown.hidden = true;
      els.multi.hidden = true;
      if (els.mobileBar) els.mobileBar.hidden = true;
      shownTotal = 0;
      return;
    }

    const fromTxt = els.from.value.trim() || 'Пункт отправления';
    const toTxt = els.to.value.trim() || 'Пункт назначения';
    els.label.textContent = `${fromTxt} → ${toTxt} · ${km} км · ${weight} т`;

    tweenTotal(shownTotal, total);
    shownTotal = total;

    if (els.mobileBar) {
      els.mobileBar.hidden = false;
      if (els.mobileBarRoute) els.mobileBarRoute.textContent = `${fromTxt} → ${toTxt}`;
      if (els.mobileBarMeta) els.mobileBarMeta.textContent = `${km} км · ${weight} т`;
      if (els.mobileBarPrice) els.mobileBarPrice.textContent = `от ${Math.round(total).toLocaleString('ru-RU')} BYN`;
    }

    const basePart = RATES.base, kmPart = km * RATES.perKm;
    els.breakdown.hidden = false;
    const fmt = (v) => `${Math.round(v).toLocaleString('ru-RU')} BYN`;
    if (els.qdBaseV) els.qdBaseV.textContent = fmt(basePart);
    if (els.qdKmV) els.qdKmV.textContent = `${km} км (${fmt(kmPart)})`;
    if (els.qdTV) {
      els.qdTV.textContent = `${weight} т · ${vehicleLabel(weight)}`;
    }

    const extras = [];
    if (cargo && cargo.value === 'fragile') extras.push(`Спецкрепёж/хрупкий груз (×${RATES.fragile})`);
    if (cargo && cargo.value === 'temperature') extras.push(`Терморежим от -20°C до +25°C (×${RATES.temperature})`);
    if (els.loading && els.loading.checked) extras.push(`Погрузка/экспедирование (+${RATES.loading} BYN)`);
    if (extras.length) { els.multi.hidden = false; els.multi.textContent = extras.join(' · '); }
    else els.multi.hidden = true;

    if (cargo && cargo.value === 'temperature') {
      els.note.textContent = 'Терморежим (рефрижератор от −20°C до +25°C с термописцем и санпаспортом). Ставка фиксируется в договоре-заявке.';
    } else {
      els.note.textContent = 'Предварительная ставка с НДС 20%. Фиксируется в договоре-заявке после согласования графика подачи.';
    }
    if (els.link) els.link.classList.remove('hidden');
    if (els.actions) els.actions.hidden = false;

    updateShareLinks(fromTxt, toTxt, km, weight, total, extras);

    const curFrom = fromTxt.toLowerCase();
    const curTo = toTxt.toLowerCase();
    document.querySelectorAll('.popular-route-pill').forEach((btn) => {
      const bf = (btn.dataset.from || '').toLowerCase();
      const bt = (btn.dataset.to || '').toLowerCase();
      const isActive = (curFrom === bf && curTo === bt) || (curFrom === bt && curTo === bf);
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  let fromPlace = null;
  let toPlace = null;
  let routeCalculatedKm = null;
  let distanceTouched = false;
  let lastPairKey = '';
  let routeToken = 0;

  function updateEtaLabel(km) {
    const etaEl = document.getElementById('calc-eta-label');
    if (!etaEl) return;
    if (!km || km <= 0) {
      etaEl.textContent = '—';
      return;
    }
    const minHours = (km / 75).toFixed(1);
    const maxHours = (km / 65 + 0.3).toFixed(1);
    etaEl.textContent = `~${minHours} – ${maxHours} ч`;
  }

  function updateResetButtonState() {
    const currentVal = Math.round(Number(els.distance.value) || 0);
    updateEtaLabel(currentVal);
    if (!els.btnResetDistance) return;
    const hasRoute = Boolean(fromPlace && toPlace && routeCalculatedKm);
    if (hasRoute && currentVal !== routeCalculatedKm) {
      if (els.resetKmLabel) els.resetKmLabel.textContent = `${routeCalculatedKm} км`;
      els.btnResetDistance.hidden = false;
    } else {
      els.btnResetDistance.hidden = true;
    }
  }

  function setHint(text, isError) {
    els.hint.textContent = text;
    els.hint.classList.toggle('is-error', !!isError);
  }

  function placeMarker(which, place) {
    if (map) {
      const existing = which === 'from' ? markerFrom : markerTo;
      if (!place) {
        if (existing) { map.removeLayer(existing); if (which === 'from') markerFrom = null; else markerTo = null; }
      } else if (existing) {
        existing.setLatLng([place.lat, place.lon]);
      } else {
        const marker = window.L.marker([place.lat, place.lon], { icon: pinIcon(which === 'from') }).addTo(map);
        if (which === 'from') markerFrom = marker; else markerTo = marker;
      }
    }
  }

  async function updateRoute() {
    placeMarker('from', fromPlace);
    placeMarker('to', toPlace);

    if (fromPlace && toPlace) {
      const pairKey = `${fromPlace.name}|${toPlace.name}`;
      if (pairKey !== lastPairKey) { distanceTouched = false; lastPairKey = pairKey; }

      setHint(`Маршрут: ${fromPlace.name} → ${toPlace.name}`);
      const token = ++routeToken;
      const route = await fetchRoute(fromPlace, toPlace);
      if (token !== routeToken) return;

      // Render Leaflet route line if Leaflet map is active
      if (map) {
        if (routeLine) map.removeLayer(routeLine);
        routeLine = window.L.polyline(route.coords, {
          color: '#C74D60',
          weight: 3.5,
          opacity: .95,
          dashArray: route.approx ? '2 9' : null,
        }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [28, 28], animate: !reducedMotion });
        driveVan(route.coords);
      }

      if (route.approx) {
        setHint(`Маршрут: ${fromPlace.name} → ${toPlace.name} (расстояние оценено по прямой)`);
      }

      const kmRounded = Math.max(5, Math.round(route.km / 5) * 5);
      routeCalculatedKm = kmRounded;

      if (!distanceTouched) {
        els.distance.value = kmRounded;
        if (els.range && kmRounded > Number(els.range.max)) els.range.max = Math.ceil(kmRounded / 50) * 50;
      }
      updateResetButtonState();
      recalc();
      return;
    }

    routeCalculatedKm = null;
    updateResetButtonState();
    if (routeLine && map) { map.removeLayer(routeLine); routeLine = null; }
    stopVan();
    if (fromPlace || toPlace) {
      const known = fromPlace || toPlace;
      const missing = fromPlace ? 'назначения' : 'отправления';
      setHint(`Город "${known.name}" найден — введите пункт ${missing}`);
      if (map) map.flyTo([known.lat, known.lon], 9, { animate: !reducedMotion });
    } else {
      setHint('Начните вводить город, посёлок или деревню — любой населённый пункт Беларуси');
    }
    recalc();
  }

  const geocodeTimers = { from: null, to: null };
  function handleCityInput(which) {
    const input = which === 'from' ? els.from : els.to;
    const query = input.value.trim();
    clearTimeout(geocodeTimers[which]);

    if (query.length < 2) {
      if (which === 'from') fromPlace = null; else toPlace = null;
      updateRoute();
      return;
    }

    setHint('Ищем населённый пункт…');
    geocodeTimers[which] = setTimeout(async () => {
      const place = await geocode(`${query}, Беларусь`);
      if (which === 'from') fromPlace = place; else toPlace = place;
      if (!place) setHint(`Не нашли «${query}» в Беларуси — проверьте написание`, true);
      updateRoute();
    }, GEOCODE_DEBOUNCE_MS);
  }

  form.addEventListener('input', (event) => {
    const target = event.target;
    if (target === els.from) { handleCityInput('from'); return; }
    if (target === els.to) { handleCityInput('to'); return; }
    if (target === els.distance || (els.range && target === els.range)) {
      distanceTouched = true;
      if (els.range && target === els.range) els.distance.value = els.range.value;
      updateResetButtonState();
      recalc();
      return;
    }
    recalc();
  });

  form.addEventListener('change', (event) => {
    const target = event.target;
    if (target === els.from || target === els.to) { handleCityInput(target === els.from ? 'from' : 'to'); return; }
    if (target === els.weight || target.name === 'cargo') {
      if (vanMarker) refreshVehicleMarker();
    }
    recalc();
  });

  form.addEventListener('click', (event) => {
    const chip = event.target.closest('.b2b-qweight-btn, .weight-chips button');
    if (chip) {
      els.weight.value = chip.dataset.weight;
      recalc();
      return;
    }

    const vCard = event.target.closest('.b2b-vcard, .v-class-card');
    if (vCard) {
      els.weight.value = vCard.dataset.vehicleWeight;
      recalc();
      return;
    }

    const adjBtn = event.target.closest('.b2b-adjust-btn, .btn-dist-adjust');
    if (adjBtn) {
      const add = Number(adjBtn.dataset.add) || 0;
      distanceTouched = true;
      els.distance.value = Math.max(5, (Number(els.distance.value) || 0) + add);
      updateResetButtonState();
      recalc();
      return;
    }
  });

  const btnCalcSwap = document.getElementById('calc-swap-route');
  if (btnCalcSwap) {
    let swapAngle = 0;
    btnCalcSwap.addEventListener('click', () => {
      swapAngle += 180;
      btnCalcSwap.style.transform = `rotate(${swapAngle}deg)`;
      const tmp = els.from.value;
      els.from.value = els.to.value;
      els.to.value = tmp;
      const tmpPlace = fromPlace;
      fromPlace = toPlace;
      toPlace = tmpPlace;
      distanceTouched = false;
      lastPairKey = '';
      recalc();
      updateRoute();
    });
  }

  function updateShareLinks(fromTxt, toTxt, km, weight, total, extras) {
    const extrasTxt = extras && extras.length ? `\nОсобенности: ${extras.join(', ')}` : '';
    const textMsg = `Здравствуйте! Хочу заказать перевозку ASMA Lines:\n📍 Маршрут: ${fromTxt} → ${toTxt}\n📏 Расстояние: ~${km} км\n📦 Вес груза: ${weight} т${extrasTxt}\n💰 Расчёт стоимости: от ${Math.round(total).toLocaleString('ru-RU')} BYN\n\nПожалуйста, свяжитесь со мной для уточнения деталей.`;

    const encodedMsg = encodeURIComponent(textMsg);
    
    if (els.shareTg) {
      els.shareTg.href = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodedMsg}`;
    }
    
    // Direct Telegram bot link in modal
    const modalTgLink = document.getElementById('modal-tg-direct-link');
    if (modalTgLink) {
      modalTgLink.href = 'https://t.me/asmalinesbot';
    }

    if (els.shareViber) {
      els.shareViber.href = `viber://forward?text=${encodeURIComponent(textMsg + '\n' + window.location.href)}`;
    }
    if (els.shareMail) {
      els.shareMail.href = `mailto:?subject=${encodeURIComponent(`Заявка на перевозку ${fromTxt} — ${toTxt} (ASMA Lines)`)}&body=${encodeURIComponent(textMsg + '\n\nСайт: ' + window.location.href)}`;
    }

    const cardFrom = document.getElementById('modal-card-from');
    const cardTo = document.getElementById('modal-card-to');
    const cardPrice = document.getElementById('modal-card-price');
    const cardDist = document.getElementById('modal-card-dist');
    const cardWeight = document.getElementById('modal-card-weight');
    const cardVehicle = document.getElementById('modal-card-vehicle');

    const formattedPrice = `от ${Math.round(total).toLocaleString('ru-RU')} BYN`;
    if (cardFrom) cardFrom.textContent = fromTxt || 'Гомель';
    if (cardTo) cardTo.textContent = toTxt || 'Минск';
    if (cardPrice) {
      const pNode = cardPrice.querySelector('.mrv-price-val') || cardPrice;
      pNode.textContent = formattedPrice;
    }
    if (cardDist) cardDist.textContent = `${km} км`;
    if (cardWeight) cardWeight.textContent = `${weight} т`;
    if (cardVehicle) {
      const vClass = weight <= 1.5 ? '1.5 т' : weight <= 3 ? '3 т' : weight <= 5 ? '5 т' : weight <= 10 ? '10 т' : '20 т (фура)';
      cardVehicle.textContent = `Авто ${vClass}`;
    }
    if (els.modalHiddenRoute) {
      els.modalHiddenRoute.value = `${fromTxt} -> ${toTxt}, ${km}km, ${weight}t, est ${Math.round(total)} BYN`;
    }

    const fromInput = document.getElementById('modal-from-city');
    const toInput = document.getElementById('modal-to-city');
    const distInput = document.getElementById('modal-distance');
    const vehicleInput = document.getElementById('modal-vehicle');
    const weightInput = document.getElementById('modal-weight');
    const priceInput = document.getElementById('modal-price');

    if (fromInput) fromInput.value = fromTxt;
    if (toInput) toInput.value = toTxt;
    if (distInput) distInput.value = km;
    if (vehicleInput) vehicleInput.value = `${currentWeightClass().toUpperCase()} (${weight} т)`;
    if (weightInput) weightInput.value = weight;
    if (priceInput) priceInput.value = Math.round(total);
  }

  // Toggle Share Box
  if (els.btnToggleShare) {
    els.btnToggleShare.addEventListener('click', () => {
      if (!els.shareBox) return;
      els.shareBox.hidden = !els.shareBox.hidden;
    });
  }
  const closeShareBox = document.getElementById('close-share-box');
  if (closeShareBox) {
    closeShareBox.addEventListener('click', () => {
      if (els.shareBox) els.shareBox.hidden = true;
    });
  }

  // Copy details to clipboard
  if (els.shareCopy) {
    els.shareCopy.addEventListener('click', async () => {
      const fromTxt = els.from.value.trim() || 'Гомель';
      const toTxt = els.to.value.trim() || 'Минск';
      const km = els.distance.value;
      const weight = els.weight.value;
      const total = els.total.textContent;
      const copyText = `Расчёт логистики ASMA Lines:\n${fromTxt} → ${toTxt}\nРасстояние: ${km} км\nВес: ${weight} т\nСтоимость: ${total}\n${window.location.href}`;

      try {
        await navigator.clipboard.writeText(copyText);
        els.copyBtnText.textContent = 'Скопировано!';
        setTimeout(() => {
          if (els.copyBtnText) els.copyBtnText.textContent = 'Скопировать';
        }, 2200);
      } catch {
        els.copyBtnText.textContent = 'Готово';
      }
    });
  }

  // Print Proposal (Commercial Offer)
  if (els.btnPrintProposal) {
    els.btnPrintProposal.addEventListener('click', () => {
      const fromTxt = els.from.value.trim() || 'Гомель';
      const toTxt = els.to.value.trim() || 'Минск';
      const km = els.distance.value || 310;
      const weight = els.weight.value || 5;
      const cargo = currentCargoType();
      const loading = els.loading && els.loading.checked ? '1' : '0';
      const totalRaw = parseInt(els.total.textContent.replace(/\D/g, ''), 10) || 0;
      
      const url = new URL('proposal', window.location.href);
      url.searchParams.set('from', fromTxt);
      url.searchParams.set('to', toTxt);
      url.searchParams.set('km', km);
      url.searchParams.set('weight', weight);
      url.searchParams.set('cargo', cargo);
      url.searchParams.set('loading', loading);
      url.searchParams.set('total', totalRaw);
      url.searchParams.set('autoprint', '1');
      
      window.open(url.toString(), '_blank');
    });
  }

  // Quick Consultation Modal
  let lastFocusedBeforeModal = null;

  /** Элементы, доступные для фокуса внутри открытого окна. */
  function focusableInModal() {
    if (!els.modal) return [];
    return Array.from(
      els.modal.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => node.offsetParent !== null || node === document.activeElement);
  }

  function openModal() {
    if (!els.modal) return;
    recalc(); // Refresh calculations and links
    lastFocusedBeforeModal = document.activeElement;
    els.modal.classList.add('is-open');
    els.modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const firstInput = els.modal.querySelector('input[name="name"]');
    if (firstInput) setTimeout(() => firstInput.focus(), 80);
  }

  function closeModal() {
    if (!els.modal) return;
    els.modal.classList.remove('is-open');
    els.modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    // Возвращаем фокус туда, откуда окно открыли.
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
      lastFocusedBeforeModal.focus();
    }
    lastFocusedBeforeModal = null;
  }

  /** Удерживает Tab внутри открытого модального окна. */
  function trapModalFocus(event) {
    if (event.key !== 'Tab' || !els.modal || !els.modal.classList.contains('is-open')) return;
    const focusable = focusableInModal();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (els.btnQuickConsult) {
    els.btnQuickConsult.addEventListener('click', openModal);
  }
  if (els.modalClose) {
    els.modalClose.addEventListener('click', closeModal);
  }
  if (els.modal) {
    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.modal.classList.contains('is-open')) closeModal();
      trapModalFocus(e);
    });
  }

  // Popular routes click handling
  const popGrid = document.querySelector('#popular-routes-grid');
  if (popGrid) {
    popGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.popular-route-pill');
      if (!btn) return;
      const { from, to, km } = btn.dataset;
      if (from && els.from) els.from.value = from;
      if (to && els.to) els.to.value = to;
      if (km && els.distance) {
        els.distance.value = km;
      }
      if (!els.weight.value || Number(els.weight.value) <= 0) {
        els.weight.value = '2.5';
      }
      distanceTouched = false;
      lastPairKey = '';
      const cleanF = (from || '').trim().toLowerCase();
      const cleanT = (to || '').trim().toLowerCase();
      if (BY_SETTLEMENTS[cleanF]) fromPlace = BY_SETTLEMENTS[cleanF];
      if (BY_SETTLEMENTS[cleanT]) toPlace = BY_SETTLEMENTS[cleanT];
      recalc();
      updateRoute();
    });
  }

  // Mobile Sticky Summary Bar CTA & Interaction
  if (els.mobileBarCta) {
    els.mobileBarCta.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal();
    });
  }
  if (els.mobileBar) {
    document.body.classList.add('has-calc-mobile-bar');
    els.mobileBar.addEventListener('click', () => {
      openModal();
    });

    if ('IntersectionObserver' in window) {
      const quoteEl = document.querySelector('.calculator-layout .quote');
      if (quoteEl) {
        const quoteObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            const isQuoteVisible = entry.isIntersecting;
            els.mobileBar.classList.toggle('is-quote-visible', isQuoteVisible);
            document.body.classList.toggle('calc-bar-hidden', isQuoteVisible);
          });
        }, { threshold: 0.25 });
        quoteObserver.observe(quoteEl);
      }
    }
  }

  // Quick adjust buttons (+20 km for stop, +50 km for extra address)
  document.querySelectorAll('.btn-dist-adjust').forEach(btn => {
    btn.addEventListener('click', () => {
      const addKm = parseInt(btn.dataset.add, 10) || 0;
      const current = parseInt(els.distance.value, 10) || 0;
      els.distance.value = Math.max(1, current + addKm);
      distanceTouched = true;
      updateResetButtonState();
      recalc();
    });
  });

  if (els.btnResetDistance) {
    els.btnResetDistance.addEventListener('click', () => {
      if (!routeCalculatedKm) return;
      distanceTouched = false;
      els.distance.value = routeCalculatedKm;
      if (els.range) {
        if (routeCalculatedKm > Number(els.range.max)) {
          els.range.max = Math.ceil(routeCalculatedKm / 50) * 50;
        }
        els.range.value = routeCalculatedKm;
      }
      updateResetButtonState();
      recalc();
    });
  }

  form.addEventListener('submit', (event) => event.preventDefault());

  if (els.range) {
    try {
      els.range.style.setProperty('--fill', `${(Number(els.range.value) / Number(els.range.max)) * 100}%`);
    } catch (_) {}
  }
  // Handle URL Query Params (e.g. ?from=Гомель&to=Минск or ?to=Витебск from homepage constructor)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const urlFrom = urlParams.get('from');
    const urlTo = urlParams.get('to');
    let hasUrlCities = false;

    if (urlFrom && els.from) {
      els.from.value = urlFrom;
      hasUrlCities = true;
    }
    if (urlTo && els.to) {
      els.to.value = urlTo;
      hasUrlCities = true;
    }

    if (hasUrlCities) {
      setTimeout(() => {
        if (urlFrom) handleCityInput('from');
        if (urlTo) handleCityInput('to');
      }, 120);
    } else if (els.from && els.to && els.from.value && els.to.value) {
      // If default cities are present (Gomel -> Minsk), initialize map route smoothly
      setTimeout(() => {
        handleCityInput('from');
        handleCityInput('to');
      }, 140);
    }
  } catch (_) {}

  recalc();
  setTimeout(triggerInvalidate, 200);
})();
