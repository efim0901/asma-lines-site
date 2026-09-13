/* ============================================================
   ASMA Lines — interactive shipping cost calculator
   Loaded only on calculator.html.

   MAP PROVIDER — how this is wired up
   ------------------------------------------------------------
   Instead of a hand-drawn SVG outline with ~20 hardcoded cities,
   the map is a real Leaflet map on OpenStreetMap tiles, and city
   lookup goes through OSM's free geocoder (Nominatim) restricted
   to Belarus. That means EVERY settlement in OSM's database is
   searchable — regional cities, towns, and villages — not just a
   short hand list. Road distance comes from OSRM's public routing
   demo (falls back to a great-circle estimate if it's unreachable).

   This uses only free, keyless public services, so it works out
   of the box. Two things the site owner should do before relying
   on this at real traffic volumes:
     1. Nominatim's and OSRM's public demo servers are rate-limited
        and meant for light/dev use (see their usage policies). For
        production traffic, self-host both (Docker images exist for
        both) or move to a commercial provider.
     2. If a commercial map is preferred (Yandex Maps API or Google
        Maps Platform both have good Belarus coverage), swap the
        three functions marked "PROVIDER:" below for calls to that
        provider's geocoder/router/map SDK — the rest of the
        calculator (pricing, form, UI) does not need to change.
        Both require the owner's own paid/registered API key, which
        is why they aren't wired in here directly.

   Everything else follows the original brief:
   - "Calculator without a button" — input/change recalculates
     instantly.
   - Self-contained IIFE, no globals, delegated form listeners.
   - prefers-reduced-motion disables the tween and the van
     animation; recalculation itself is always instant.
   ============================================================ */
(function initCalculator() {
  const form = document.querySelector('#calculator');
  if (!form) return;

  const mapEl = document.querySelector('#calc-leaflet-map');
  const hintElFallback = document.querySelector('#calc-hint');
  if (!mapEl) return;
  if (typeof window.L === 'undefined') {
    // Leaflet's local script (assets/vendor/leaflet/leaflet.js) failed to
    // load or execute — fail visibly instead of silently.
    mapEl.classList.add('calc-leaflet-map--error');
    mapEl.textContent = 'Карта временно недоступна. Расстояние можно ввести вручную ниже.';
    if (hintElFallback) hintElFallback.textContent = 'Карта не загрузилась. Проверьте, что файл assets/vendor/leaflet/leaflet.js доступен на сервере (см. консоль браузера, F12).';
    console.error('[ASMA calculator] Leaflet (assets/vendor/leaflet/leaflet.js) did not load — map disabled, form still works manually.');
    return;
  }

  /* ---- self-contained config ---- */
  const RATES = { base: 85, perKm: 1.65, perTonne: 18, fragile: 1.12, temperature: 1.28, loading: 45 };
  const ROAD_COEFFICIENT = 1.28; // used only as a fallback when routing is unavailable
  const GEOCODE_DEBOUNCE_MS = 550;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  };

  /* ------------------------------------------------------------
     Map setup — real OSM tiles, bounded and tinted to fit the
     brand's dark palette (see .calc-leaflet-map in style.css).
     ------------------------------------------------------------ */
  const BY_CENTER = [53.55, 28.0];
  const BY_BOUNDS = window.L.latLngBounds([50.9, 22.6], [56.4, 33.1]);
  const map = window.L.map(mapEl, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false,
    minZoom: 6,
    maxZoom: 15,
  }).setView(BY_CENTER, 7);
  map.setMaxBounds(BY_BOUNDS.pad(0.2));

  /* PROVIDER: tile source. Swap this URL for a commercial tile
     provider (Yandex, Mapbox, MapTiler, 2GIS) if the free OSM tile
     policy doesn't fit production traffic. */
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(map);

  function pinIcon(isOrigin) {
    return window.L.divIcon({
      className: `calc-pin${isOrigin ? ' is-origin' : ''}`,
      html: '<span></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }
  function vanIcon() {
    return window.L.divIcon({
      className: 'calc-van',
      html: '<span class="calc-van-arrow"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  let markerFrom = null;
  let markerTo = null;
  let routeLine = null;
  let vanMarker = null;
  let vanRaf = null;

  /* ------------------------------------------------------------
     PROVIDER: geocoding. Nominatim (OSM), scoped to Belarus.
     Covers every settlement in OSM's data, not a hand-picked list.
     ------------------------------------------------------------ */
  const geocodeCache = new Map();
  function geocode(query) {
    const key = query.trim().toLowerCase();
    if (!key) return Promise.resolve(null);
    if (geocodeCache.has(key)) return Promise.resolve(geocodeCache.get(key));
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=by&accept-language=ru&q=${encodeURIComponent(query)}`;
    return fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        const row = rows && rows[0];
        const place = row
          ? { lat: parseFloat(row.lat), lon: parseFloat(row.lon), name: (row.display_name || query).split(',')[0].trim() }
          : null;
        geocodeCache.set(key, place);
        return place;
      })
      .catch(() => null);
  }

  /* great-circle distance in km, used for the fallback estimate and for
     walking a van marker along the route geometry at a constant speed */
  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /* ------------------------------------------------------------
     PROVIDER: routing. OSRM public demo server, driving profile.
     Falls back to a straight line x road coefficient if it fails.
     ------------------------------------------------------------ */
  async function fetchRoute(a, b) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('osrm_failed');
      const data = await res.json();
      const route = data.routes && data.routes[0];
      if (!route) throw new Error('osrm_no_route');
      return {
        km: route.distance / 1000,
        coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
        approx: false,
      };
    } catch (error) {
      const km = haversineKm([a.lat, a.lon], [b.lat, b.lon]) * ROAD_COEFFICIENT;
      return { km, coords: [[a.lat, a.lon], [b.lat, b.lon]], approx: true };
    }
  }

  /* van driving along the real route geometry, constant real-world speed */
  function driveVan(coords) {
    if (reducedMotion) return;
    cancelAnimationFrame(vanRaf);
    if (!vanMarker) {
      vanMarker = window.L.marker(coords[0], { icon: vanIcon(), interactive: false }).addTo(map);
    } else {
      vanMarker.setIcon(vanIcon());
    }
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
    const total = cum[cum.length - 1] || 1;
    const durationMs = 7000;
    const pauseMs = 1200;
    const start = performance.now();

    function tick(now) {
      const elapsed = (now - start) % (durationMs + pauseMs);
      if (!vanMarker) return;
      if (elapsed > durationMs) {
        vanMarker.setOpacity(0);
        vanRaf = requestAnimationFrame(tick);
        return;
      }
      vanMarker.setOpacity(1);
      const distAlong = (elapsed / durationMs) * total;
      let idx = 0;
      while (idx < cum.length - 2 && cum[idx + 1] < distAlong) idx++;
      const segStart = coords[idx];
      const segEnd = coords[Math.min(idx + 1, coords.length - 1)];
      const segLen = cum[idx + 1] - cum[idx] || 1;
      const segT = Math.min(1, (distAlong - cum[idx]) / segLen);
      const lat = segStart[0] + (segEnd[0] - segStart[0]) * segT;
      const lon = segStart[1] + (segEnd[1] - segStart[1]) * segT;
      vanMarker.setLatLng([lat, lon]);
      const bearing = (Math.atan2(segEnd[1] - segStart[1], segEnd[0] - segStart[0]) * 180) / Math.PI;
      const arrow = vanMarker.getElement() && vanMarker.getElement().querySelector('.calc-van-arrow');
      if (arrow) arrow.style.transform = `rotate(${bearing + 90}deg)`;
      vanRaf = requestAnimationFrame(tick);
    }
    vanRaf = requestAnimationFrame(tick);
  }
  function stopVan() {
    cancelAnimationFrame(vanRaf);
    if (vanMarker) { map.removeLayer(vanMarker); vanMarker = null; }
  }

  /* ------------------------------------------------------------
     Pricing (unchanged formula): base 85 + km*1.65 + t*18,
     cargo multipliers apply to the subtotal, loading is a flat add-on.
     ------------------------------------------------------------ */
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
    els.link.classList.remove('hidden');
  }

  /* ------------------------------------------------------------
     Map + route state
     ------------------------------------------------------------ */
  let fromPlace = null;
  let toPlace = null;
  let distanceTouched = false;
  let lastPairKey = '';
  let routeToken = 0; // guards against out-of-order async responses

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
      if (token !== routeToken) return; // a newer request already superseded this one

      if (routeLine) map.removeLayer(routeLine);
      routeLine = window.L.polyline(route.coords, {
        color: '#E6A9B4',
        weight: 3.5,
        opacity: .95,
        dashArray: route.approx ? '2 9' : null,
      }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [28, 28], animate: !reducedMotion });

      if (route.approx) {
        setHint(`Маршрут: ${fromPlace.name} → ${toPlace.name} (расстояние оценено по прямой)`);
      }

      if (!distanceTouched) {
        const kmRounded = Math.max(5, Math.round(route.km / 5) * 5);
        els.distance.value = kmRounded;
        if (kmRounded > Number(els.range.max)) els.range.max = Math.ceil(kmRounded / 50) * 50;
      }
      driveVan(route.coords);
      recalc();
      return;
    }

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

  /* ------------------------------------------------------------
     Delegated events — three listeners on the form (input, change,
     click), no per-field listeners, no globals outside this closure.
     ------------------------------------------------------------ */
  form.addEventListener('input', (event) => {
    const target = event.target;
    if (target === els.from) { handleCityInput('from'); return; }
    if (target === els.to) { handleCityInput('to'); return; }
    if (target === els.distance || target === els.range) {
      distanceTouched = true;
      if (target === els.range) els.distance.value = els.range.value;
      recalc();
      return;
    }
    recalc();
  });

  form.addEventListener('change', (event) => {
    const target = event.target;
    if (target === els.from || target === els.to) { handleCityInput(target === els.from ? 'from' : 'to'); return; }
    recalc();
  });

  form.addEventListener('click', (event) => {
    const chip = event.target.closest('.weight-chips button');
    if (!chip) return;
    els.weight.value = chip.dataset.weight;
    recalc();
  });

  form.addEventListener('submit', (event) => event.preventDefault());

  /* initial paint */
  if (els.range) {
    els.range.style.setProperty('--fill', `${(Number(els.range.value) / Number(els.range.max)) * 100}%`);
  }
  recalc();
})();
