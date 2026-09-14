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

  const RATES = { base: 85, perKm: 1.65, perTonne: 18, fragile: 1.12, temperature: 1.28, loading: 45 };
  const ROAD_COEFFICIENT = 1.28;
  const GEOCODE_DEBOUNCE_MS = 550;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const els = {
    from: form.querySelector('#calc-from'),
    to: form.querySelector('#calc-to'),
    distance: form.querySelector('#calc-distance'),
    range: form.querySelector('#calc-distance-range'),
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
  };

  const BY_CENTER = [53.55, 28.0];
  const BY_BOUNDS = window.L.latLngBounds([50.9, 22.6], [56.4, 33.1]);
  const map = window.L.map(mapEl, {
    zoomControl: true,
    attributionControl: false,
    scrollWheelZoom: false,
    minZoom: 6,
    maxZoom: 18,
  }).setView(BY_CENTER, 7);
  map.setMaxBounds(BY_BOUNDS.pad(0.2));

  // High-detail dark graphite basemap served via internal proxy — no external keys or watermarks, full road network
  window.L.tileLayer('/api/tile/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '',
  }).addTo(map);

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
  let vanMarker = null;
  let vanRaf = null;

  const geocodeCache = new Map();
  async function geocode(query) {
    const key = query.trim().toLowerCase();
    if (!key) return null;
    if (geocodeCache.has(key)) return geocodeCache.get(key);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const place = await res.json();
        if (place && place.lat && place.lon) {
          geocodeCache.set(key, place);
          return place;
        }
      }
    } catch {
      // Internal request fallback
    }

    // Direct fallback if server endpoint is ever unavailable
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=by&accept-language=ru&q=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const rows = await res.json();
      const row = rows && rows[0];
      const place = row
        ? { lat: parseFloat(row.lat), lon: parseFloat(row.lon), name: (row.display_name || query).split(',')[0].trim() }
        : null;
      if (place) geocodeCache.set(key, place);
      return place;
    } catch {
      return null;
    }
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

  function getBearing(p1, p2) {
    if (!p1 || !p2) return 0;
    const lat1 = (p1[0] * Math.PI) / 180;
    const lat2 = (p2[0] * Math.PI) / 180;
    const dLon = ((p2[1] - p1[1]) * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = (Math.atan2(y, x) * 180) / Math.PI;
    return (brng + 360) % 360;
  }

  function driveVan(coords) {
    if (reducedMotion || !coords || coords.length < 2) return;
    cancelAnimationFrame(vanRaf);
    const icon = buildVehicleIcon();
    if (!vanMarker) {
      vanMarker = window.L.marker(coords[0], { icon, interactive: false }).addTo(map);
    } else {
      vanMarker.setIcon(icon);
    }

    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
    const total = cum[cum.length - 1] || 1;
    const durationMs = Math.min(13000, Math.max(7500, total * 22));
    const pauseMs = 1600;
    const cycleMs = durationMs + pauseMs;
    const start = performance.now();

    let currentBearing = getBearing(coords[0], coords[1]);

    function tick(now) {
      if (!vanMarker) return;
      const elapsed = (now - start) % cycleMs;

      // In pause phase at destination
      if (elapsed > durationMs) {
        const dest = coords[coords.length - 1];
        vanMarker.setLatLng(dest);
        const pauseProg = (elapsed - durationMs) / pauseMs;
        const opacity = pauseProg > 0.65 ? Math.max(0, 1 - (pauseProg - 0.65) / 0.35) : 1;
        vanMarker.setOpacity(opacity);
        vanRaf = requestAnimationFrame(tick);
        return;
      }

      vanMarker.setOpacity(1);
      const progress = elapsed / durationMs;
      const distAlong = progress * total;

      let idx = 0;
      while (idx < cum.length - 2 && cum[idx + 1] < distAlong) idx++;

      const segStart = coords[idx];
      const segEnd = coords[Math.min(idx + 1, coords.length - 1)];
      const segLen = cum[idx + 1] - cum[idx] || 1;
      const segT = Math.min(1, Math.max(0, (distAlong - cum[idx]) / segLen));

      const lat = segStart[0] + (segEnd[0] - segStart[0]) * segT;
      const lon = segStart[1] + (segEnd[1] - segStart[1]) * segT;
      vanMarker.setLatLng([lat, lon]);

      // Lookahead point for natural, organic steering into bends
      const lookDist = Math.min(total, distAlong + Math.max(1.8, total * 0.015));
      let lookIdx = idx;
      while (lookIdx < cum.length - 2 && cum[lookIdx + 1] < lookDist) lookIdx++;
      const lookPos = coords[Math.min(lookIdx + 1, coords.length - 1)];

      const targetBearing = getBearing([lat, lon], lookPos);
      const diff = ((targetBearing - currentBearing + 540) % 360) - 180;
      currentBearing = (currentBearing + diff * 0.18 + 360) % 360;

      const node = vanMarker.getElement();
      if (node) {
        const rotator = node.querySelector('.calc-vehicle-rotator');
        if (rotator) {
          rotator.style.transform = `rotate(${currentBearing.toFixed(1)}deg)`;
        }
      }
      vanRaf = requestAnimationFrame(tick);
    }
    vanRaf = requestAnimationFrame(tick);
  }
  function stopVan() {
    cancelAnimationFrame(vanRaf);
    if (vanMarker) { map.removeLayer(vanMarker); vanMarker = null; }
  }

  function currentTotal() {
    const km = Number(els.distance.value) || 0;
    const weight = Number(els.weight.value) || 0;
    if (!km || !weight) return null;
    let total = RATES.base + km * RATES.perKm + weight * RATES.perTonne;
    const cargo = form.querySelector('input[name="cargo"]:checked');
    if (cargo && cargo.value === 'fragile') total *= RATES.fragile;
    if (cargo && cargo.value === 'temperature') total *= RATES.temperature;
    if (els.loading && els.loading.checked) total += RATES.loading;
    return Math.round(total);
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

    form.querySelectorAll('.weight-chips button').forEach((btn) => {
      btn.classList.toggle('is-active', weight > 0 && Number(btn.dataset.weight) === weight);
    });

    if (vanMarker) refreshVehicleMarker();
    updateResetButtonState();

    if (!total) {
      els.label.textContent = 'Заполните параметры перевозки';
      els.total.textContent = '—';
      els.note.textContent = 'Укажите расстояние и вес груза — ориентир появится здесь.';
      if (els.link) els.link.classList.add('hidden');
      if (els.actions) els.actions.hidden = true;
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

    const basePart = RATES.base, kmPart = km * RATES.perKm, tPart = weight * RATES.perTonne;
    const subtotal = basePart + kmPart + tPart || 1;
    els.breakdown.hidden = false;
    const fmt = (v) => `${Math.round(v).toLocaleString('ru-RU')} р.`;
    els.qdBase.style.width = `${Math.max((basePart / subtotal) * 100, 5)}%`;
    els.qdKm.style.width = `${Math.max((kmPart / subtotal) * 100, 5)}%`;
    els.qdT.style.width = `${Math.max((tPart / subtotal) * 100, 5)}%`;
    els.qdBaseV.textContent = fmt(basePart);
    els.qdKmV.textContent = fmt(kmPart);
    els.qdTV.textContent = fmt(tPart);

    const extras = [];
    if (cargo && cargo.value === 'fragile') extras.push(`хрупкий груз ×${RATES.fragile}`);
    if (cargo && cargo.value === 'temperature') extras.push(`температурный режим ×${RATES.temperature}`);
    if (els.loading && els.loading.checked) extras.push(`погрузка +${RATES.loading} р.`);
    if (extras.length) { els.multi.hidden = false; els.multi.textContent = extras.join(' · '); }
    else els.multi.hidden = true;

    els.note.textContent = 'Предварительный расчёт. Финальная стоимость подтверждается менеджером после уточнения параметров перевозки.';
    if (els.link) els.link.classList.remove('hidden');
    if (els.actions) els.actions.hidden = false;

    updateShareLinks(fromTxt, toTxt, km, weight, total, extras);
  }

  let fromPlace = null;
  let toPlace = null;
  let routeCalculatedKm = null;
  let distanceTouched = false;
  let lastPairKey = '';
  let routeToken = 0;

  function updateResetButtonState() {
    if (!els.btnResetDistance) return;
    const currentVal = Math.round(Number(els.distance.value) || 0);
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
    const existing = which === 'from' ? markerFrom : markerTo;
    if (!place) {
      if (existing) { map.removeLayer(existing); if (which === 'from') markerFrom = null; else markerTo = null; }
      return;
    }
    if (existing) {
      existing.setLatLng([place.lat, place.lon]);
    } else {
      const marker = window.L.marker([place.lat, place.lon], { icon: pinIcon(which === 'from') }).addTo(map);
      if (which === 'from') markerFrom = marker; else markerTo = marker;
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

      if (routeLine) map.removeLayer(routeLine);
      routeLine = window.L.polyline(route.coords, {
        color: '#C74D60',
        weight: 3.5,
        opacity: .95,
        dashArray: route.approx ? '2 9' : null,
      }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [28, 28], animate: !reducedMotion });

      if (route.approx) {
        setHint(`Маршрут: ${fromPlace.name} → ${toPlace.name} (расстояние оценено по прямой)`);
      }

      const kmRounded = Math.max(5, Math.round(route.km / 5) * 5);
      routeCalculatedKm = kmRounded;

      if (!distanceTouched) {
        els.distance.value = kmRounded;
        if (kmRounded > Number(els.range.max)) els.range.max = Math.ceil(kmRounded / 50) * 50;
      }
      driveVan(route.coords);
      updateResetButtonState();
      recalc();
      return;
    }

    routeCalculatedKm = null;
    updateResetButtonState();
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    stopVan();
    if (fromPlace || toPlace) {
      const known = fromPlace || toPlace;
      const missing = fromPlace ? 'назначения' : 'отправления';
      setHint(`Город "${known.name}" найден — введите пункт ${missing}`);
      map.flyTo([known.lat, known.lon], 9, { animate: !reducedMotion });
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
    if (target === els.distance || target === els.range) {
      distanceTouched = true;
      if (target === els.range) els.distance.value = els.range.value;
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
    const chip = event.target.closest('.weight-chips button');
    if (!chip) return;
    els.weight.value = chip.dataset.weight;
    if (vanMarker) refreshVehicleMarker();
    recalc();
  });

  function updateShareLinks(fromTxt, toTxt, km, weight, total, extras) {
    if (!els.shareTg) return;
    const extrasTxt = extras && extras.length ? `\nОсобенности: ${extras.join(', ')}` : '';
    const textMsg = `Расчёт перевозки ASMA Lines:\nМаршрут: ${fromTxt} → ${toTxt}\nРасстояние: ~${km} км\nВес груза: ${weight} т${extrasTxt}\nОриентировочная стоимость: ${Math.round(total).toLocaleString('ru-RU')} BYN`;

    els.shareTg.href = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(textMsg)}`;
    els.shareViber.href = `viber://forward?text=${encodeURIComponent(textMsg + '\n' + window.location.href)}`;
    els.shareMail.href = `mailto:?subject=${encodeURIComponent(`Расчёт перевозки ${fromTxt} — ${toTxt} (ASMA Lines)`)}&body=${encodeURIComponent(textMsg + '\n\nСайт: ' + window.location.href)}`;

    if (els.modalRoutePreview) {
      els.modalRoutePreview.textContent = `${fromTxt} → ${toTxt} · ${km} км · ${weight} т · ~${Math.round(total).toLocaleString('ru-RU')} BYN`;
    }
    if (els.modalHiddenRoute) {
      els.modalHiddenRoute.value = `${fromTxt} -> ${toTxt}, ${km}km, ${weight}t, est ${Math.round(total)} BYN`;
    }
  }

  // Toggle Share Box
  if (els.btnToggleShare) {
    els.btnToggleShare.addEventListener('click', () => {
      if (!els.shareBox) return;
      els.shareBox.hidden = !els.shareBox.hidden;
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
      window.print();
    });
  }

  // Quick Consultation Modal
  function openModal() {
    if (!els.modal) return;
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
        if (els.range) {
          if (Number(km) > Number(els.range.max)) {
            els.range.max = Math.ceil(Number(km) / 50) * 50;
          }
          els.range.value = km;
          els.range.style.setProperty('--fill', `${(Number(km) / Number(els.range.max)) * 100}%`);
        }
      }
      handleCityInput('from');
      handleCityInput('to');
      recalc();
    });
  }

  if (els.btnResetDistance) {
    els.btnResetDistance.addEventListener('click', () => {
      if (!routeCalculatedKm) return;
      distanceTouched = false;
      els.distance.value = routeCalculatedKm;
      if (routeCalculatedKm > Number(els.range.max)) {
        els.range.max = Math.ceil(routeCalculatedKm / 50) * 50;
      }
      els.range.value = routeCalculatedKm;
      updateResetButtonState();
      recalc();
    });
  }

  form.addEventListener('submit', (event) => event.preventDefault());

  if (els.range) {
    els.range.style.setProperty('--fill', `${(Number(els.range.value) / Number(els.range.max)) * 100}%`);
  }
  recalc();
})();
