const fs = require('fs');
const path = require('path');

const src = fs.readFileSync('belarus_source.svg', 'utf8');
const cityMap = JSON.parse(fs.readFileSync('cities_coords.json', 'utf8'));

function getTag(id) {
  const match = src.match(new RegExp('<(path|polyline|polygon)[^>]*id=\\\"' + id + '\\\"[^>]*>([\\s\\S]*?<\\/\\1>)?')) ||
                src.match(new RegExp('<(path|polyline|polygon)[^>]+id=\\\"' + id + '\\\"[\\s\\S]*?\\/>'));
  if (!match) return { id, d: '', points: '' };
  let str = match[0];
  const dMatch = str.match(/d=\"([\\s\\S]*?)\"/);
  const ptsMatch = str.match(/points=\"([\\s\\S]*?)\"/);
  return { id, d: dMatch ? dMatch[1].replace(/\s+/g, ' ').trim() : null, points: ptsMatch ? ptsMatch[1].replace(/\s+/g, ' ').trim() : null };
}

const p10 = getTag('path10');
const p20 = getTag('path20');
const p41 = getTag('path41');
const p43 = getTag('path43');
const poly25 = getTag('polyline25');
const poly27 = getTag('polyline27');
const poly29 = getTag('polyline29');
const poly31 = getTag('polyline31');
const poly33 = getTag('polyline33');

const l3 = src.slice(src.indexOf('id="layer3"'), src.indexOf('id="layer1"'));
const l5 = src.slice(src.indexOf('id="layer5"'), src.indexOf('id="layer3"'));

const lakeMatches = [...l3.matchAll(/<path[^>]*d=\"([\s\S]*?)\"[^>]*>/g)];
const lakePaths = lakeMatches.map(m => m[1].replace(/\s+/g, ' ').trim()).filter(d => d.length > 25);

const riverMatches = [...l5.matchAll(/<path[^>]*d=\"([\s\S]*?)\"[^>]*>/g)];
const riverPaths = riverMatches.map(m => m[1].replace(/\s+/g, ' ').trim()).filter(d => d.length > 25);

// Highway Corridors
const hw_m1 = `M ${cityMap.brest.x} ${cityMap.brest.y} L ${cityMap.kobrin.x} ${cityMap.kobrin.y} L ${cityMap.bereza.x} ${cityMap.bereza.y} L ${cityMap.ivatsevichi.x} ${cityMap.ivatsevichi.y} L ${cityMap.baranovichi.x} ${cityMap.baranovichi.y} L 618.3 799.0 L ${cityMap.dzerzhinsk.x} ${cityMap.dzerzhinsk.y} L ${cityMap.minsk.x} ${cityMap.minsk.y} L 826.5 650.0 L ${cityMap.zhodino.x} ${cityMap.zhodino.y} L ${cityMap.borisov.x} ${cityMap.borisov.y} L 1050.0 550.0 L ${cityMap.orsha.x} ${cityMap.orsha.y} L 1400 480`;
const hw_m5 = `M ${cityMap.gomel.x} ${cityMap.gomel.y} L 1260 1020 L ${cityMap.zhlobin.x} ${cityMap.zhlobin.y} L ${cityMap.bobruisk.x} ${cityMap.bobruisk.y} L ${cityMap.osipovichi.x} ${cityMap.osipovichi.y} L ${cityMap.maryina_gorka.x} ${cityMap.maryina_gorka.y} L ${cityMap.minsk.x} ${cityMap.minsk.y}`;
const hw_m8 = `M ${cityMap.vitebsk.x} ${cityMap.vitebsk.y} L ${cityMap.orsha.x} ${cityMap.orsha.y} L ${cityMap.shklov.x} ${cityMap.shklov.y} L ${cityMap.mogilev.x} ${cityMap.mogilev.y} L ${cityMap.bykhov.x} ${cityMap.bykhov.y} L ${cityMap.rogachev.x} ${cityMap.rogachev.y} L 1220 1000 L ${cityMap.gomel.x} ${cityMap.gomel.y} L 1335 1200`;
const hw_m10 = `M ${cityMap.brest.x} ${cityMap.brest.y} L ${cityMap.kobrin.x} ${cityMap.kobrin.y} L 340 1160 L ${cityMap.pinsk.x} ${cityMap.pinsk.y} L ${cityMap.luninets.x} ${cityMap.luninets.y} L 710 1140 L ${cityMap.zhitkovichi.x} ${cityMap.zhitkovichi.y} L 900 1155 L ${cityMap.kalinkovichi.x} ${cityMap.kalinkovichi.y} L ${cityMap.rechitsa.x} ${cityMap.rechitsa.y} L ${cityMap.gomel.x} ${cityMap.gomel.y} L ${cityMap.dobrush.x} ${cityMap.dobrush.y}`;
const hw_m6 = `M ${cityMap.minsk.x} ${cityMap.minsk.y} L 600 700 L 490 695 L ${cityMap.lida.x} ${cityMap.lida.y} L 298.8 767.1 L 220 755 L ${cityMap.grodno.x} ${cityMap.grodno.y}`;
const hw_m4 = `M ${cityMap.minsk.x} ${cityMap.minsk.y} L 880 730 L 980 710 L 1090 695 L ${cityMap.mogilev.x} ${cityMap.mogilev.y}`;
const hw_m3 = `M ${cityMap.minsk.x} ${cityMap.minsk.y} L 800 600 L 820 530 L ${cityMap.lepel.x} ${cityMap.lepel.y} L 1050 380 L ${cityMap.vitebsk.x} ${cityMap.vitebsk.y}`;
const hw_polotsk = `M ${cityMap.lepel.x} ${cityMap.lepel.y} L ${cityMap.polotsk.x} ${cityMap.polotsk.y} L ${cityMap.novopolotsk.x} ${cityMap.novopolotsk.y}`;
const hw_grodno_bar = `M ${cityMap.grodno.x} ${cityMap.grodno.y} L ${cityMap.volkovysk.x} ${cityMap.volkovysk.y} L ${cityMap.slonim.x} ${cityMap.slonim.y} L ${cityMap.baranovichi.x} ${cityMap.baranovichi.y}`;
const hw_soligorsk = `M ${cityMap.minsk.x} ${cityMap.minsk.y} L ${cityMap.dzerzhinsk.x} ${cityMap.dzerzhinsk.y} L ${cityMap.slutsk.x} ${cityMap.slutsk.y} L ${cityMap.soligorsk.x} ${cityMap.soligorsk.y}`;
const hw_mozyr = `M ${cityMap.kalinkovichi.x} ${cityMap.kalinkovichi.y} L ${cityMap.mozyr.x} ${cityMap.mozyr.y}`;

// Generate SVG Code
const svg = `<svg viewBox="1.472 1.809 1626.241 1450.672" xmlns="http://www.w3.org/2000/svg" class="belarus-master-map" role="img" aria-label="Карта Беларуси с логистической сетью ASMA Lines">
  <defs>
    <!-- Gradients -->
    <linearGradient id="by_territory_bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#241118"/>
      <stop offset="45%" stop-color="#2C141D"/>
      <stop offset="85%" stop-color="#1F0D14"/>
      <stop offset="100%" stop-color="#16080D"/>
    </linearGradient>

    <linearGradient id="foreign_country_bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0E070A"/>
      <stop offset="100%" stop-color="#140A0D"/>
    </linearGradient>

    <linearGradient id="m5_express_grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFD382"/>
      <stop offset="40%" stop-color="#FF2E50"/>
      <stop offset="100%" stop-color="#8B2536"/>
    </linearGradient>

    <linearGradient id="m1_main_grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#E6A9B4"/>
      <stop offset="50%" stop-color="#FFC048"/>
      <stop offset="100%" stop-color="#E6A9B4"/>
    </linearGradient>

    <!-- Radar Pulse Beacon Gradient for Gomel HQ -->
    <radialGradient id="gomel_beacon_glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FF2E50" stop-opacity="0.6"/>
      <stop offset="50%" stop-color="#8B2536" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#8B2536" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="minsk_hub_glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFC048" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#FFC048" stop-opacity="0"/>
    </radialGradient>

    <!-- Filter for Glow on Markers -->
    <filter id="hub_marker_glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <filter id="city_badge_shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.8"/>
    </filter>
  </defs>

  <!-- Canvas Frame & Base -->
  <rect x="1.472" y="1.809" width="1626.241" height="1450.672" fill="#0C0608"/>

  <!-- Belarus Real Territorial Landmass -->
  <rect x="1.472" y="1.809" width="1626.241" height="1450.672" fill="url(#by_territory_bg)"/>

  <!-- Surrounding Foreign Nations (Poland, Lithuania, Latvia, Russia, Ukraine) from Wikimedia Geometry -->
  <g class="foreign-countries-layer" fill="url(#foreign_country_bg)" stroke="#261017" stroke-width="1.2">
    <path d="${p10.d}"/>
    <path d="${p20.d}"/>
  </g>

  <!-- Soft Graticule Coordinates (Subtle grid) -->
  <g stroke="#E6A9B4" stroke-opacity="0.05" stroke-width="1" stroke-dasharray="6 8">
    <line x1="200" y1="10" x2="200" y2="1440"/>
    <line x1="500" y1="10" x2="500" y2="1440"/>
    <line x1="750" y1="10" x2="750" y2="1440"/>
    <line x1="1000" y1="10" x2="1000" y2="1440"/>
    <line x1="1250" y1="10" x2="1250" y2="1440"/>
    <line x1="10" y1="350" x2="1620" y2="350"/>
    <line x1="10" y1="700" x2="1620" y2="700"/>
    <line x1="10" y1="1050" x2="1620" y2="1050"/>
  </g>

  <!-- International Borders (High-Precision Belarus Perimeter) -->
  <g class="state-borders" fill="none" stroke="#8B2536" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="${p41.d}" opacity="0.95"/>
    <path d="${p43.d}" opacity="0.95"/>
  </g>

  <!-- Internal Oblast (Regional) Boundaries -->
  <g class="oblast-borders" fill="none" stroke="#E6A9B4" stroke-width="1.6" stroke-opacity="0.35" stroke-dasharray="6 6">
    <polyline points="${poly25.points}"/>
    <polyline points="${poly27.points}"/>
    <polyline points="${poly29.points}"/>
    <polyline points="${poly31.points}"/>
    <polyline points="${poly33.points}"/>
  </g>

  <!-- Real Hydrography: Lakes & Reservoirs -->
  <g class="hydrography-lakes" fill="#3D7D93" fill-opacity="0.35" stroke="#4DA3C0" stroke-width="0.75" stroke-opacity="0.45">
    ${lakePaths.slice(0, 150).map(d => `<path d="${d}"/>`).join('\n    ')}
  </g>

  <!-- Real Hydrography: Rivers (Dnieper, Neman, Pripyat, Western Dvina, Berezina, Sozh) -->
  <g class="hydrography-rivers" fill="none" stroke="#3D7D93" stroke-width="1.3" stroke-opacity="0.32" stroke-linecap="round" stroke-linejoin="round">
    ${riverPaths.slice(0, 120).map(d => `<path d="${d}"/>`).join('\n    ')}
  </g>

  <!-- Regional Labels (Watermark Style) -->
  <g class="region-watermarks" font-family="system-ui, -apple-system, sans-serif" font-size="19" font-weight="700" letter-spacing="3" fill="#E6A9B4" fill-opacity="0.12" text-anchor="middle">
    <text x="760" y="770">МИНСКАЯ ОБЛАСТЬ</text>
    <text x="1260" y="1030">ГОМЕЛЬСКАЯ ОБЛАСТЬ</text>
    <text x="360" y="1120">БРЕСТСКАЯ ОБЛАСТЬ</text>
    <text x="320" y="790">ГРОДНЕНСКАЯ ОБЛАСТЬ</text>
    <text x="1100" y="380">ВИТЕБСКАЯ ОБЛАСТЬ</text>
    <text x="1270" y="690">МОГИЛЁВСКАЯ ОБЛАСТЬ</text>
    
    <!-- Neighbor Country Labels -->
    <text x="70" y="900" font-size="15" fill="#71717A" fill-opacity="0.25">ПОЛЬША</text>
    <text x="210" y="380" font-size="15" fill="#71717A" fill-opacity="0.25">ЛИТВА</text>
    <text x="680" y="100" font-size="15" fill="#71717A" fill-opacity="0.25">ЛАТВИЯ</text>
    <text x="1500" y="550" font-size="16" fill="#71717A" fill-opacity="0.25">РОССИЯ</text>
    <text x="800" y="1390" font-size="16" fill="#71717A" fill-opacity="0.25">УКРАИНА</text>
  </g>

  <!-- ============================================================
       ASMA LINES FREIGHT ARTERIES & HIGHWAY NETWORK
       ============================================================ -->
  <g class="highways-layer" fill="none">
    <!-- Secondary Connections -->
    <path d="${hw_m3}" stroke="#8B2536" stroke-width="2.5" stroke-opacity="0.6"/>
    <path d="${hw_m4}" stroke="#8B2536" stroke-width="2.5" stroke-opacity="0.6"/>
    <path d="${hw_m6}" stroke="#8B2536" stroke-width="3" stroke-opacity="0.75"/>
    <path d="${hw_m6}" stroke="#E6A9B4" stroke-width="1.2" stroke-opacity="0.6" stroke-dasharray="5 7"/>

    <path d="${hw_polotsk}" stroke="#8B2536" stroke-width="2" stroke-opacity="0.6"/>
    <path d="${hw_grodno_bar}" stroke="#8B2536" stroke-width="2.2" stroke-opacity="0.6"/>
    <path d="${hw_soligorsk}" stroke="#8B2536" stroke-width="2.2" stroke-opacity="0.6"/>
    <path d="${hw_mozyr}" stroke="#BD334B" stroke-width="3" stroke-opacity="0.85"/>

    <!-- M-10: Polesie Cross-Country Artery (Brest - Pinsk - Mozyr - Gomel) -->
    <path d="${hw_m10}" stroke="#BD334B" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <path d="${hw_m10}" stroke="#FFD382" stroke-width="2" stroke-dasharray="8 8" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- M-8: Direct North-South Artery (Vitebsk - Orsha - Mogilev - Gomel) -->
    <path d="${hw_m8}" stroke="#BD334B" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
    <path d="${hw_m8}" stroke="#FFA8B6" stroke-width="2" stroke-dasharray="7 9" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- M-1: West-East Artery (Brest - Baranovichi - Minsk - Borisov - Orsha - RF) -->
    <path d="${hw_m1}" stroke="#8B2536" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <path d="${hw_m1}" stroke="url(#m1_main_grad)" stroke-width="2" stroke-dasharray="10 8" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- M-5: Gomel ⇄ Minsk (PRIMARY ASMA LINES ARTERY) -->
    <path d="${hw_m5}" stroke="url(#m5_express_grad)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" filter="url(#hub_marker_glow)"/>
    <path d="${hw_m5}" stroke="#FFFFFF" stroke-width="2.6" stroke-dasharray="12 10" stroke-linecap="round" stroke-linejoin="round" class="animated-freight-flow"/>
  </g>

  <!-- ============================================================
       GOMEL HQ RADAR PULSE WAVES & BEACON
       ============================================================ -->
  <g class="gomel-beacon" transform="translate(${cityMap.gomel.x}, ${cityMap.gomel.y})">
    <circle cx="0" cy="0" r="140" fill="url(#gomel_beacon_glow)"/>
    <circle cx="0" cy="0" r="95" fill="none" stroke="#FF2E50" stroke-width="1.8" stroke-dasharray="5 5" opacity="0.8"/>
    <circle cx="0" cy="0" r="55" fill="none" stroke="#FFC048" stroke-width="2" opacity="0.9"/>
    <circle cx="0" cy="0" r="28" fill="#8B2536" stroke="#FFFFFF" stroke-width="3.5" filter="url(#hub_marker_glow)"/>
    <circle cx="0" cy="0" r="10" fill="#FFD382"/>
  </g>

  <!-- MINSK HUB GLOW -->
  <g class="minsk-beacon" transform="translate(${cityMap.minsk.x}, ${cityMap.minsk.y})">
    <circle cx="0" cy="0" r="75" fill="url(#minsk_hub_glow)"/>
    <circle cx="0" cy="0" r="20" fill="#1A0D12" stroke="#FFC048" stroke-width="3" filter="url(#hub_marker_glow)"/>
    <circle cx="0" cy="0" r="8" fill="#FFC048"/>
  </g>

  <!-- ============================================================
       SECONDARY CITIES & TRANSIT HUBS (Vector Nodes)
       ============================================================ -->
  <g class="secondary-nodes" font-family="system-ui, -apple-system, sans-serif">
    ${[
      'baranovichi', 'bobruisk', 'pinsk', 'mozyr', 'orsha', 'polotsk', 'novopolotsk',
      'lida', 'borisov', 'soligorsk', 'slutsk', 'zhlobin', 'svetlogorsk', 'rechitsa',
      'kobrin', 'slonim', 'volkovysk', 'smorgon', 'kalinkovichi', 'rogachev', 'gorki',
      'osipovichi', 'bereza', 'ivatsevichi', 'dzerzhinsk', 'vileyka', 'luninets',
      'maryina_gorka', 'dobrush', 'lepel', 'krichev', 'braslav', 'zhodino', 'zhitkovichi'
    ].map(id => {
      const c = cityMap[id];
      if (!c) return '';
      const isHub = c.type === 'hub';
      const r = isHub ? 6 : 4;
      const fill = isHub ? '#FFC048' : '#E6A9B4';
      const textFill = isHub ? '#F8F7EF' : '#C9C5B9';
      const fontSize = isHub ? 13 : 11.5;
      const fontWeight = isHub ? '700' : '500';
      return `
    <g class="map-city-node" data-id="${c.id}" transform="translate(${c.x}, ${c.y})" style="cursor: pointer;">
      <circle cx="0" cy="0" r="${r + 2}" fill="#140A0D" opacity="0.8"/>
      <circle cx="0" cy="0" r="${r}" fill="${fill}" stroke="#140A0D" stroke-width="1.5"/>
      <text x="${c.x > 800 ? 10 : -10}" y="4" text-anchor="${c.x > 800 ? 'start' : 'end'}" fill="${textFill}" font-size="${fontSize}" font-weight="${fontWeight}" filter="url(#city_badge_shadow)">${c.name}</text>
    </g>`;
    }).join('\n')}
  </g>

  <!-- ============================================================
       6 REGIONAL CAPITALS (MAIN HUBS)
       ============================================================ -->
  <!-- 1. Vitebsk -->
  <g class="map-city-node major-hub" data-id="vitebsk" transform="translate(${cityMap.vitebsk.x}, ${cityMap.vitebsk.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="14" fill="#140A0D" stroke="#BD334B" stroke-width="3" filter="url(#hub_marker_glow)"/>
    <circle cx="0" cy="0" r="6" fill="#F8F7EF"/>
    <text x="20" y="6" fill="#F8F7EF" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" letter-spacing="0.8" filter="url(#city_badge_shadow)">ВИТЕБСК</text>
  </g>

  <!-- 2. Grodno -->
  <g class="map-city-node major-hub" data-id="grodno" transform="translate(${cityMap.grodno.x}, ${cityMap.grodno.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="14" fill="#140A0D" stroke="#BD334B" stroke-width="3" filter="url(#hub_marker_glow)"/>
    <circle cx="0" cy="0" r="6" fill="#F8F7EF"/>
    <text x="-20" y="6" text-anchor="end" fill="#F8F7EF" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" letter-spacing="0.8" filter="url(#city_badge_shadow)">ГРОДНО</text>
  </g>

  <!-- 3. Mogilev -->
  <g class="map-city-node major-hub" data-id="mogilev" transform="translate(${cityMap.mogilev.x}, ${cityMap.mogilev.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="14" fill="#140A0D" stroke="#BD334B" stroke-width="3" filter="url(#hub_marker_glow)"/>
    <circle cx="0" cy="0" r="6" fill="#F8F7EF"/>
    <text x="20" y="6" fill="#F8F7EF" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" letter-spacing="0.8" filter="url(#city_badge_shadow)">МОГИЛЁВ</text>
  </g>

  <!-- 4. Brest -->
  <g class="map-city-node major-hub" data-id="brest" transform="translate(${cityMap.brest.x}, ${cityMap.brest.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="14" fill="#140A0D" stroke="#BD334B" stroke-width="3" filter="url(#hub_marker_glow)"/>
    <circle cx="0" cy="0" r="6" fill="#F8F7EF"/>
    <text x="-20" y="6" text-anchor="end" fill="#F8F7EF" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="800" letter-spacing="0.8" filter="url(#city_badge_shadow)">БРЕСТ</text>
  </g>

  <!-- 5. Minsk (Capital Hub) -->
  <g class="map-city-node major-hub" data-id="minsk" transform="translate(${cityMap.minsk.x}, ${cityMap.minsk.y})" style="cursor: pointer;">
    <rect x="22" y="-18" width="124" height="36" rx="7" fill="#140A0D" stroke="#FFC048" stroke-width="1.8" filter="url(#city_badge_shadow)"/>
    <text x="84" y="5" text-anchor="middle" fill="#FFD382" font-family="system-ui, -apple-system, sans-serif" font-size="15" font-weight="900" letter-spacing="1">МИНСК · ХАБ</text>
  </g>

  <!-- 6. GOMEL (ASMA LINES HEADQUARTERS & CENTRAL BASE) -->
  <g class="map-city-node major-hq" data-id="gomel" transform="translate(${cityMap.gomel.x}, ${cityMap.gomel.y})" style="cursor: pointer;">
    <g transform="translate(34, -28)">
      <rect x="0" y="0" width="220" height="56" rx="9" fill="#140A0D" stroke="#FF2E50" stroke-width="2.5" filter="url(#city_badge_shadow)"/>
      <text x="16" y="24" fill="#FFD382" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="900" letter-spacing="1.2">ГОМЕЛЬ · ХАБ</text>
      <text x="16" y="44" fill="#E6A9B4" font-family="system-ui, -apple-system, sans-serif" font-size="11.5" font-weight="700" letter-spacing="0.8">БАЗА ASMA LINES · 24/7</text>
    </g>
  </g>

  <!-- Legend Card (Top Left) -->
  <g transform="translate(36, 36)" font-family="system-ui, -apple-system, sans-serif">
    <rect x="0" y="0" width="340" height="110" rx="12" fill="#140A0D" fill-opacity="0.94" stroke="#8B2536" stroke-width="1.8" filter="url(#city_badge_shadow)"/>
    <text x="18" y="30" fill="#F8F7EF" font-size="14" font-weight="800" letter-spacing="1.5">ЛОГИСТИЧЕСКАЯ СЕТЬ РБ</text>
    <text x="18" y="52" fill="#E6A9B4" font-size="12" font-weight="600">6 ОБЛАСТЕЙ · 70+ ГОРОДОВ ДОСТАВКИ</text>
    
    <line x1="18" y1="74" x2="48" y2="74" stroke="#FF2E50" stroke-width="4"/>
    <text x="56" y="78" fill="#F8F7EF" font-size="11" font-weight="600">Экспресс-линия М-5 (Гомель ⇄ Минск)</text>
    
    <line x1="18" y1="94" x2="48" y2="94" stroke="#FFC048" stroke-width="2.5" stroke-dasharray="4 3"/>
    <text x="56" y="98" fill="#C9C5B9" font-size="11" font-weight="500">Магистрали М-1, М-8, М-10, М-6</text>
  </g>
</svg>`;

fs.writeFileSync('assets/img/map-belarus.svg', svg, 'utf8');
console.log('Successfully generated assets/img/map-belarus.svg (size: ' + svg.length + ' bytes)');
