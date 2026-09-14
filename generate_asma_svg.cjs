const fs = require('fs');

const src = fs.readFileSync('belarus_source.svg', 'utf8');
const cityMap = JSON.parse(fs.readFileSync('cities_coords.json', 'utf8'));

function getTag(id) {
  const match = src.match(new RegExp('<(path|polyline|polygon)[^>]*id=\\\"' + id + '\\\"[^>]*>([\\s\\S]*?<\\/\\1>)?')) ||
                src.match(new RegExp('<(path|polyline|polygon)[^>]+id=\\\"' + id + '\\\"[\\s\\S]*?\\/>'));
  if (!match) return { id, d: '', points: '' };
  let str = match[0];
  const dMatch = str.match(/d=\"([\\s\\S]*?)\"/);
  const ptsMatch = str.match(/points=\"([\\s\\S]*?)\"/);
  return { id, d: dMatch ? dMatch[1].replace(/\\s+/g, ' ').trim() : null, points: ptsMatch ? ptsMatch[1].replace(/\\s+/g, ' ').trim() : null };
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

const lakeMatches = [...l3.matchAll(/<path[^>]*d=\"([\\s\\S]*?)\"[^>]*>/g)];
const lakePaths = lakeMatches.map(m => m[1].replace(/\\s+/g, ' ').trim()).filter(d => d.length > 25);

const riverMatches = [...l5.matchAll(/<path[^>]*d=\"([\\s\\S]*?)\"[^>]*>/g)];
const riverPaths = riverMatches.map(m => m[1].replace(/\\s+/g, ' ').trim()).filter(d => d.length > 25);

// Curved Logistics Artery Paths (matching the user design in asma-belarus-map-preview.png)
// Gomel -> Minsk (arc curving slightly north)
const arc_gomel_minsk = `M ${cityMap.gomel.x} ${cityMap.gomel.y} Q 1060 840, ${cityMap.minsk.x} ${cityMap.minsk.y}`;
// Minsk -> Vitebsk (straight / subtle curve)
const arc_minsk_vitebsk = `M ${cityMap.minsk.x} ${cityMap.minsk.y} Q 960 480, ${cityMap.vitebsk.x} ${cityMap.vitebsk.y}`;
// Minsk -> Mogilev
const arc_minsk_mogilev = `M ${cityMap.minsk.x} ${cityMap.minsk.y} Q 960 670, ${cityMap.mogilev.x} ${cityMap.mogilev.y}`;
// Mogilev -> Gomel
const arc_mogilev_gomel = `M ${cityMap.mogilev.x} ${cityMap.mogilev.y} Q 1240 920, ${cityMap.gomel.x} ${cityMap.gomel.y}`;
// Minsk -> Grodno (arc curving upward)
const arc_minsk_grodno = `M ${cityMap.minsk.x} ${cityMap.minsk.y} Q 430 630, ${cityMap.grodno.x} ${cityMap.grodno.y}`;
// Minsk -> Brest (direct diagonal corridor)
const arc_minsk_brest = `M ${cityMap.minsk.x} ${cityMap.minsk.y} Q 440 930, ${cityMap.brest.x} ${cityMap.brest.y}`;
// Gomel -> Mozyr -> Pinsk -> Brest (M-10 Polesie artery)
const arc_gomel_brest_m10 = `M ${cityMap.gomel.x} ${cityMap.gomel.y} L ${cityMap.kalinkovichi.x} ${cityMap.kalinkovichi.y} L ${cityMap.pinsk.x} ${cityMap.pinsk.y} L ${cityMap.kobrin.x} ${cityMap.kobrin.y} L ${cityMap.brest.x} ${cityMap.brest.y}`;

// List of all 65+ cities matching the user preview
const ALL_CITIES = [
  // Major 6
  { id: 'gomel', x: 1301.7, y: 1087.2, name: 'Гомель', isHq: true },
  { id: 'minsk', x: 752.0, y: 684.9, name: 'Минск', isHub: true },
  { id: 'brest', x: 135.8, y: 1179.4, name: 'Брест', isMajor: true },
  { id: 'grodno', x: 150.5, y: 749.4, name: 'Гродно', isMajor: true },
  { id: 'vitebsk', x: 1177.7, y: 332.9, name: 'Витебск', isMajor: true },
  { id: 'mogilev', x: 1206.6, y: 688.0, name: 'Могилёв', isMajor: true },

  // Key Cities & Hubs across Belarus
  { id: 'polotsk', x: 978.8, y: 247.9, name: 'Полоцк' },
  { id: 'novopolotsk', x: 963.8, y: 236.2, name: 'Новополоцк' },
  { id: 'orsha', x: 1227.8, y: 531.0, name: 'Орша' },
  { id: 'baranovichi', x: 486.2, y: 882.3, name: 'Барановичи' },
  { id: 'bobruisk', x: 1033.4, y: 880.8, name: 'Бобруйск' },
  { id: 'pinsk', x: 501.7, y: 1174.4, name: 'Пинск' },
  { id: 'mozyr', x: 1039.4, y: 1192.4, name: 'Мозырь' },
  { id: 'lida', x: 388.9, y: 673.7, name: 'Лида' },
  { id: 'borisov', x: 890.3, y: 586.2, name: 'Борисов' },
  { id: 'soligorsk', x: 748.8, y: 970.6, name: 'Солигорск' },
  { id: 'slutsk', x: 751.7, y: 896.7, name: 'Слуцк' },
  { id: 'zhlobin', x: 1151.7, y: 945.7, name: 'Жлобин' },
  { id: 'svetlogorsk', x: 1111.4, y: 1024.9, name: 'Светлогорск' },
  { id: 'rechitsa', x: 1216.7, y: 1107.5, name: 'Речица' },
  { id: 'kobrin', x: 239.3, y: 1146.4, name: 'Кобрин' },
  { id: 'slonim', x: 390.8, y: 891.1, name: 'Слоним' },
  { id: 'volkovysk', x: 245.9, y: 870.2, name: 'Волковыск' },
  { id: 'smorgon', x: 569.2, y: 494.3, name: 'Сморгонь' },
  { id: 'kalinkovichi', x: 1052.8, y: 1168.1, name: 'Калинковичи' },
  { id: 'rogachev', x: 1155.6, y: 883.3, name: 'Рогачёв' },
  { id: 'gorki', x: 1313.3, y: 598.9, name: 'Горки' },
  { id: 'osipovichi', x: 946.8, y: 829.4, name: 'Осиповичи' },
  { id: 'bereza', x: 337.8, y: 1048.8, name: 'Берёза' },
  { id: 'ivatsevichi', x: 393.9, y: 994.1, name: 'Ивацевичи' },
  { id: 'dzerzhinsk', x: 673.8, y: 752.7, name: 'Дзержинск' },
  { id: 'vileyka', x: 647.7, y: 491.2, name: 'Вилейка' },
  { id: 'luninets', x: 631.3, y: 1134.1, name: 'Лунинец' },
  { id: 'maryina_gorka', x: 846.8, y: 780.0, name: 'Марьина Горка' },
  { id: 'postavy', x: 635.0, y: 300.0, name: 'Поставы' },
  { id: 'pruzhany', x: 254.0, y: 1038.0, name: 'Пружаны' },
  { id: 'glubokoe', x: 770.0, y: 290.0, name: 'Глубокое' },
  { id: 'dobrush', x: 1356.7, y: 1094.2, name: 'Добруш' },
  { id: 'lepel', x: 934.4, y: 406.8, name: 'Лепель' },
  { id: 'bykhov', x: 1195.4, y: 785.8, name: 'Быхов' },
  { id: 'krichev', x: 1430.7, y: 726.3, name: 'Кричев' },
  { id: 'mosty', x: 268.0, y: 818.0, name: 'Мосты' },
  { id: 'shchuchin', x: 301.0, y: 760.0, name: 'Щучин' },
  { id: 'oshmyany', x: 495.0, y: 512.0, name: 'Ошмяны' },
  { id: 'stolbtsy', x: 610.0, y: 795.0, name: 'Столбцы' },
  { id: 'klimovichi', x: 1470.0, y: 757.0, name: 'Климовичи' },
  { id: 'shklov', x: 1205.0, y: 605.0, name: 'Шклов' },
  { id: 'zhitkovichi', x: 800.0, y: 1145.0, name: 'Житковичи' },
  { id: 'braslav', x: 668.0, y: 140.0, name: 'Браслав' },
  { id: 'ostrovets', x: 499.0, y: 450.0, name: 'Островец' },
  { id: 'logoysk', x: 798.0, y: 592.0, name: 'Логойск' },
  { id: 'nesvizh', x: 597.0, y: 875.0, name: 'Несвиж' },
  { id: 'stolin', x: 640.0, y: 1240.0, name: 'Столин' },
  { id: 'mikashevichi', x: 735.0, y: 1145.0, name: 'Микашевичи' },
  { id: 'zaslavl', x: 708.0, y: 654.0, name: 'Заславль' },
  { id: 'belooyersk', x: 370.0, y: 1065.0, name: 'Белоозёрск' },
  { id: 'petrikov', x: 780.0, y: 1170.0, name: 'Петриков' },
  { id: 'khoiniki', x: 1140.0, y: 1245.0, name: 'Хойники' },
  { id: 'zhodino', x: 865.0, y: 624.0, name: 'Жодино' },
  { id: 'chechersk', x: 1290.0, y: 938.0, name: 'Чечерск' },
  { id: 'buda_koshelevo', x: 1255.0, y: 998.0, name: 'Буда-Кошелёво' },
  { id: 'yelsk', x: 1018.0, y: 1265.0, name: 'Ельск' },
  { id: 'narovlya', x: 1070.0, y: 1270.0, name: 'Наровля' },
  { id: 'vetka', x: 1335.0, y: 1045.0, name: 'Ветка' },
  { id: 'bragin', x: 1188.0, y: 1280.0, name: 'Брагин' },
  { id: 'komarin', x: 1230.0, y: 1410.0, name: 'Комарин' },
  { id: 'miory', x: 770.0, y: 160.0, name: 'Миоры' },
  { id: 'dokshitsy', x: 780.0, y: 390.0, name: 'Докшицы' },
  { id: 'berezino', x: 960.0, y: 720.0, name: 'Березино' },
  { id: 'lyuban', x: 800.0, y: 1010.0, name: 'Любань' },
  { id: 'gorodeya', x: 575.0, y: 845.0, name: 'Городея' },
  { id: 'telekhany', x: 440.0, y: 1060.0, name: 'Телеханы' }
];

const svg = `<svg viewBox="0 0 1600 1400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="asma-master-vector-map" role="img" aria-label="Карта Беларуси — логистическая сеть ASMA Lines">
  <defs>
    <!-- Dark Background Gradients -->
    <radialGradient id="bgVignette" cx="50%" cy="50%" r="65%">
      <stop offset="0%" stop-color="#180C11" stop-opacity="0.95"/>
      <stop offset="55%" stop-color="#12070A" stop-opacity="0.98"/>
      <stop offset="100%" stop-color="#080305" stop-opacity="1"/>
    </radialGradient>

    <radialGradient id="mapCenterGlow" cx="55%" cy="55%" r="45%">
      <stop offset="0%" stop-color="#8B2536" stop-opacity="0.18"/>
      <stop offset="70%" stop-color="#8B2536" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#8B2536" stop-opacity="0"/>
    </radialGradient>

    <!-- Radar Pulse Beacon for Gomel HQ -->
    <radialGradient id="gomelPulseGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FF2E50" stop-opacity="0.75"/>
      <stop offset="35%" stop-color="#8B2536" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#8B2536" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="minskPulseGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFC048" stop-opacity="0.6"/>
      <stop offset="60%" stop-color="#FFC048" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#FFC048" stop-opacity="0"/>
    </radialGradient>

    <!-- Glowing Filters -->
    <filter id="hubGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <filter id="badgeShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.85"/>
    </filter>

    <!-- Regional Tint Gradients (Authentic Belarus Colors under Dark Vignette) -->
    <linearGradient id="vitebskOblastGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4A657E" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#2D4357" stop-opacity="0.25"/>
    </linearGradient>

    <linearGradient id="minskOblastGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#80354E" stop-opacity="0.46"/>
      <stop offset="100%" stop-color="#542131" stop-opacity="0.28"/>
    </linearGradient>

    <linearGradient id="gomelOblastGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8A6B29" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#574214" stop-opacity="0.28"/>
    </linearGradient>

    <linearGradient id="grodnoOblastGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7A5A32" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#4F381D" stop-opacity="0.24"/>
    </linearGradient>

    <linearGradient id="brestOblastGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4D5F3A" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#303E22" stop-opacity="0.25"/>
    </linearGradient>

    <linearGradient id="mogilevOblastGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6E4A35" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#482F20" stop-opacity="0.25"/>
    </linearGradient>
  </defs>

  <!-- Canvas Deep Base -->
  <rect x="0" y="0" width="1600" height="1400" fill="#0A0406"/>
  <rect x="0" y="0" width="1600" height="1400" fill="url(#bgVignette)"/>
  <rect x="0" y="0" width="1600" height="1400" fill="url(#mapCenterGlow)"/>

  <!-- ============================================================
       TOPOGRAPHIC & ADMINISTRATIVE TERRITORY OF BELARUS
       ============================================================ -->
  <g class="belarus-territory-base" id="belarus-landmass">
    <!-- Surrounding Foreign Nations (Soft dark backdrop) -->
    <g class="foreign-borders" fill="#0C0508" stroke="#220D14" stroke-width="1.2">
      <path d="${p10.d}"/>
      <path d="${p20.d}"/>
    </g>

    <!-- Belarus Base Land Silhouette -->
    <g class="state-landmass" fill="#1C0E14" stroke="#8B2536" stroke-width="2.5">
      <path d="${p41.d}"/>
      <path d="${p43.d}"/>
    </g>

    <!-- Oblasts Color Layer (Vitebsk, Minsk, Gomel, Grodno, Brest, Mogilev) -->
    <!-- Vitebsk (North) -->
    <path d="M 570 120 L 780 80 L 1150 150 L 1450 180 L 1480 340 L 1260 490 L 1180 500 L 980 430 L 780 430 L 640 400 L 530 350 Z" fill="url(#vitebskOblastGrad)"/>
    <!-- Grodno (West) -->
    <path d="M 120 620 L 530 460 L 570 660 L 480 870 L 330 890 L 220 900 L 140 760 Z" fill="url(#grodnoOblastGrad)"/>
    <!-- Brest (South-West) -->
    <path d="M 130 960 L 340 900 L 480 880 L 660 970 L 690 1220 L 490 1280 L 230 1240 L 120 1200 Z" fill="url(#brestOblastGrad)"/>
    <!-- Minsk (Center) -->
    <path d="M 570 470 L 890 440 L 980 620 L 960 880 L 740 1020 L 580 910 L 550 680 Z" fill="url(#minskOblastGrad)"/>
    <!-- Mogilev (East) -->
    <path d="M 980 490 L 1320 490 L 1480 640 L 1460 850 L 1200 890 L 1050 880 L 970 640 Z" fill="url(#mogilevOblastGrad)"/>
    <!-- Gomel (South-East) -->
    <path d="M 700 1010 L 1060 900 L 1220 890 L 1450 900 L 1380 1220 L 1240 1390 L 1040 1300 L 740 1240 Z" fill="url(#gomelOblastGrad)"/>

    <!-- Oblast Internal Boundaries -->
    <g class="oblast-borders" fill="none" stroke="#E6A9B4" stroke-width="1.4" stroke-opacity="0.4" stroke-dasharray="5 6">
      <polyline points="${poly25.points}"/>
      <polyline points="${poly27.points}"/>
      <polyline points="${poly29.points}"/>
      <polyline points="${poly31.points}"/>
      <polyline points="${poly33.points}"/>
    </g>

    <!-- Hydrography: Lakes -->
    <g class="lakes" fill="#3A7088" fill-opacity="0.45" stroke="#4B8EA8" stroke-width="0.8" stroke-opacity="0.6">
      ${lakePaths.slice(0, 140).map(d => `<path d="${d}"/>`).join('\n      ')}
    </g>

    <!-- Hydrography: Rivers (Dnieper, Neman, Pripyat, Western Dvina, Berezina, Sozh) -->
    <g class="rivers" fill="none" stroke="#3A7088" stroke-width="1.4" stroke-opacity="0.45" stroke-linecap="round" stroke-linejoin="round">
      ${riverPaths.slice(0, 110).map(d => `<path d="${d}"/>`).join('\n      ')}
    </g>

    <!-- External State Border Highlight -->
    <g class="country-border-highlight" fill="none" stroke="#BD334B" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95">
      <path d="${p41.d}"/>
      <path d="${p43.d}"/>
    </g>
  </defs>

  <!-- ============================================================
       ASMA LINES TRANSPORT ARTERIES & FREIGHT ROUTES (CURVED & DIRECT)
       ============================================================ -->
  <g class="logistics-arteries" id="routesLayer">
    <!-- M-10: Polesie Artery (Gomel -> Mozyr -> Pinsk -> Brest) -->
    <path d="${arc_gomel_brest_m10}" fill="none" stroke="#8B2536" stroke-width="3" stroke-opacity="0.6" stroke-dasharray="8 6"/>

    <!-- Minsk -> Vitebsk -->
    <path d="${arc_minsk_vitebsk}" fill="none" stroke="#8B2536" stroke-width="3.2" stroke-opacity="0.75"/>
    <path d="${arc_minsk_vitebsk}" fill="none" stroke="#E6A9B4" stroke-width="1.4" stroke-dasharray="6 7" stroke-opacity="0.9"/>

    <!-- Minsk -> Mogilev -->
    <path d="${arc_minsk_mogilev}" fill="none" stroke="#8B2536" stroke-width="3.2" stroke-opacity="0.75"/>
    <path d="${arc_minsk_mogilev}" fill="none" stroke="#E6A9B4" stroke-width="1.4" stroke-dasharray="6 7" stroke-opacity="0.9"/>

    <!-- Mogilev -> Gomel -->
    <path d="${arc_mogilev_gomel}" fill="none" stroke="#8B2536" stroke-width="3.2" stroke-opacity="0.75"/>
    <path d="${arc_mogilev_gomel}" fill="none" stroke="#E6A9B4" stroke-width="1.4" stroke-dasharray="6 7" stroke-opacity="0.9"/>

    <!-- Minsk -> Grodno -->
    <path d="${arc_minsk_grodno}" fill="none" stroke="#8B2536" stroke-width="3.2" stroke-opacity="0.75"/>
    <path d="${arc_minsk_grodno}" fill="none" stroke="#E6A9B4" stroke-width="1.4" stroke-dasharray="6 7" stroke-opacity="0.9"/>

    <!-- Minsk -> Brest -->
    <path d="${arc_minsk_brest}" fill="none" stroke="#8B2536" stroke-width="3.2" stroke-opacity="0.75"/>
    <path d="${arc_minsk_brest}" fill="none" stroke="#E6A9B4" stroke-width="1.4" stroke-dasharray="6 7" stroke-opacity="0.9"/>

    <!-- PRIMARY EXPRESS ROUTE: GOMEL BASE ⇄ MINSK HUB (M-5) -->
    <path d="${arc_gomel_minsk}" fill="none" stroke="#8B2536" stroke-width="7" stroke-linecap="round" opacity="0.85" filter="url(#hubGlow)"/>
    <path d="${arc_gomel_minsk}" fill="none" stroke="#FF2E50" stroke-width="3.5" stroke-linecap="round"/>
    <path d="${arc_gomel_minsk}" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-dasharray="10 8" stroke-linecap="round" class="animated-freight-flow"/>
  </g>

  <!-- ============================================================
       RADAR PULSE BEACONS (GOMEL BASE & MINSK HUB)
       ============================================================ -->
  <!-- Gomel HQ Central Beacon -->
  <g class="gomel-pulse-beacon" transform="translate(${cityMap.gomel.x}, ${cityMap.gomel.y})">
    <circle cx="0" cy="0" r="140" fill="url(#gomelPulseGrad)"/>
    <circle cx="0" cy="0" r="95" fill="none" stroke="#FF2E50" stroke-width="1.8" stroke-dasharray="5 5" opacity="0.8"/>
    <circle cx="0" cy="0" r="52" fill="none" stroke="#FFC048" stroke-width="2" opacity="0.9"/>
  </g>

  <!-- Minsk Hub Glow -->
  <g class="minsk-pulse-beacon" transform="translate(${cityMap.minsk.x}, ${cityMap.minsk.y})">
    <circle cx="0" cy="0" r="70" fill="url(#minskPulseGrad)"/>
    <circle cx="0" cy="0" r="35" fill="none" stroke="#FFC048" stroke-width="1.6" stroke-dasharray="4 4" opacity="0.8"/>
  </g>

  <!-- ============================================================
       SECONDARY SETTLEMENT NODES (60+ Cities)
       ============================================================ -->
  <g class="secondary-settlement-nodes" font-family="system-ui, -apple-system, sans-serif">
    ${ALL_CITIES.filter(c => !c.isHq && !c.isHub && !c.isMajor).map(c => `
    <g class="map-city-node" data-id="${c.id}" transform="translate(${c.x}, ${c.y})" style="cursor: pointer;">
      <circle cx="0" cy="0" r="6" fill="#0F0609" opacity="0.9"/>
      <circle cx="0" cy="0" r="3.6" fill="#F8F7EF" stroke="#8B2536" stroke-width="1"/>
      <text x="${c.x > 850 ? 9 : -9}" y="3.5" text-anchor="${c.x > 850 ? 'start' : 'end'}" fill="#E8E4D9" font-size="12" font-weight="600" filter="url(#badgeShadow)">${c.name}</text>
    </g>`).join('\n')}
  </g>

  <!-- ============================================================
       MAJOR REGIONAL HUBS (Brest, Grodno, Vitebsk, Mogilev)
       ============================================================ -->
  <!-- Vitebsk -->
  <g class="map-city-node major-hub" data-id="vitebsk" transform="translate(${cityMap.vitebsk.x}, ${cityMap.vitebsk.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="18" fill="#140A0D" stroke="#E6A9B4" stroke-width="2.5" filter="url(#hubGlow)"/>
    <circle cx="0" cy="0" r="7" fill="#8B2536" stroke="#FFFFFF" stroke-width="2"/>
    <text x="26" y="7" fill="#F8F7EF" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="800" letter-spacing="1" filter="url(#badgeShadow)">ВИТЕБСК</text>
  </g>

  <!-- Mogilev -->
  <g class="map-city-node major-hub" data-id="mogilev" transform="translate(${cityMap.mogilev.x}, ${cityMap.mogilev.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="18" fill="#140A0D" stroke="#E6A9B4" stroke-width="2.5" filter="url(#hubGlow)"/>
    <circle cx="0" cy="0" r="7" fill="#8B2536" stroke="#FFFFFF" stroke-width="2"/>
    <text x="26" y="7" fill="#F8F7EF" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="800" letter-spacing="1" filter="url(#badgeShadow)">МОГИЛЁВ</text>
  </g>

  <!-- Grodno -->
  <g class="map-city-node major-hub" data-id="grodno" transform="translate(${cityMap.grodno.x}, ${cityMap.grodno.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="18" fill="#140A0D" stroke="#E6A9B4" stroke-width="2.5" filter="url(#hubGlow)"/>
    <circle cx="0" cy="0" r="7" fill="#8B2536" stroke="#FFFFFF" stroke-width="2"/>
    <text x="-26" y="7" text-anchor="end" fill="#F8F7EF" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="800" letter-spacing="1" filter="url(#badgeShadow)">ГРОДНО</text>
  </g>

  <!-- Brest -->
  <g class="map-city-node major-hub" data-id="brest" transform="translate(${cityMap.brest.x}, ${cityMap.brest.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="18" fill="#140A0D" stroke="#E6A9B4" stroke-width="2.5" filter="url(#hubGlow)"/>
    <circle cx="0" cy="0" r="7" fill="#8B2536" stroke="#FFFFFF" stroke-width="2"/>
    <text x="-26" y="7" text-anchor="end" fill="#F8F7EF" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="800" letter-spacing="1" filter="url(#badgeShadow)">БРЕСТ</text>
  </g>

  <!-- ============================================================
       MINSK HUB (Central Hub Node + Badge)
       ============================================================ -->
  <g class="map-city-node capital-hub" data-id="minsk" transform="translate(${cityMap.minsk.x}, ${cityMap.minsk.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="18" fill="#140A0D" stroke="#FFFFFF" stroke-width="3" filter="url(#hubGlow)"/>
    <circle cx="0" cy="0" r="7" fill="#8B2536"/>
    <g transform="translate(24, -18)">
      <rect x="0" y="0" width="136" height="36" rx="6" fill="#12080B" stroke="#FFC048" stroke-width="1.6" filter="url(#badgeShadow)"/>
      <text x="68" y="23" text-anchor="middle" fill="#FFD382" font-family="system-ui, -apple-system, sans-serif" font-size="13.5" font-weight="800" letter-spacing="1">МИНСК · ХАБ</text>
    </g>
  </g>

  <!-- ============================================================
       GOMEL HQ & BASE (ASMA Lines Central Dispatcher Base)
       ============================================================ -->
  <g class="map-city-node hq-hub" data-id="gomel" transform="translate(${cityMap.gomel.x}, ${cityMap.gomel.y})" style="cursor: pointer;">
    <circle cx="0" cy="0" r="24" fill="#8B2536" stroke="#FFFFFF" stroke-width="3.5" filter="url(#hubGlow)"/>
    <circle cx="0" cy="0" r="10" fill="#FF2E50"/>
    <circle cx="0" cy="0" r="4" fill="#FFFFFF"/>
    <g transform="translate(32, -26)">
      <rect x="0" y="0" width="240" height="54" rx="8" fill="#140A0D" stroke="#FF2E50" stroke-width="2" filter="url(#badgeShadow)"/>
      <text x="14" y="24" fill="#FFD382" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="800" letter-spacing="0.8">ГОМЕЛЬ · БАЗА ASMA</text>
      <text x="14" y="42" fill="#E6A9B4" font-family="system-ui, -apple-system, sans-serif" font-size="10.5" font-weight="600">Гомель · Республика Беларусь · 24/7</text>
    </g>
  </g>

  <!-- ============================================================
       TOP LEFT BRANDING & HEADER (Matches User Preview Exactly)
       ============================================================ -->
  <g transform="translate(48, 52)" font-family="system-ui, -apple-system, sans-serif">
    <text x="0" y="24" fill="#FFFFFF" font-size="28" font-weight="900" letter-spacing="3">ASMA <tspan fill="#E6A9B4" font-weight="400" font-size="18" letter-spacing="5">LINES</tspan></text>
    <line x1="0" y1="44" x2="220" y2="44" stroke="#8B2536" stroke-width="2.5"/>
    <text x="0" y="68" fill="#E6A9B4" font-size="12" font-weight="700" letter-spacing="2">ЛОГИСТИКА ПО БЕЛАРУСИ</text>
    <text x="0" y="112" fill="#FFFFFF" font-size="34" font-weight="900" letter-spacing="1">ГЕОГРАФИЯ</text>
    <text x="0" y="152" fill="#FFFFFF" font-size="34" font-weight="900" letter-spacing="1">РАБОТЫ</text>
    <text x="0" y="196" fill="#C9C5B9" font-size="13" font-weight="500" width="240">
      <tspan x="0" dy="0">Организуем грузоперевозки</tspan>
      <tspan x="0" dy="18">по всей территории Беларуси</tspan>
      <tspan x="0" dy="18">под конкретную задачу.</tspan>
    </text>

    <!-- Map Legend -->
    <g transform="translate(0, 275)">
      <!-- Item 1: Base -->
      <circle cx="10" cy="10" r="8" fill="#8B2536" stroke="#FFFFFF" stroke-width="2"/>
      <circle cx="10" cy="10" r="3.5" fill="#FF2E50"/>
      <text x="28" y="14" fill="#F8F7EF" font-size="13" font-weight="600">База ASMA Lines</text>

      <!-- Item 2: Oblast center -->
      <circle cx="10" cy="38" r="7" fill="#140A0D" stroke="#E6A9B4" stroke-width="2"/>
      <circle cx="10" cy="38" r="2.5" fill="#FFFFFF"/>
      <text x="28" y="42" fill="#F8F7EF" font-size="13" font-weight="600">Областной центр</text>

      <!-- Item 3: Key city -->
      <circle cx="10" cy="66" r="4.5" fill="#F8F7EF"/>
      <text x="28" y="70" fill="#C9C5B9" font-size="13" font-weight="500">Ключевой город</text>

      <!-- Item 4: Direction line -->
      <line x1="0" y1="94" x2="20" y2="94" stroke="#8B2536" stroke-width="3"/>
      <line x1="0" y1="94" x2="20" y2="94" stroke="#E6A9B4" stroke-width="1.5" stroke-dasharray="4 3"/>
      <text x="28" y="98" fill="#C9C5B9" font-size="13" font-weight="500">Основное направление</text>
    </g>
  </g>

  <!-- ============================================================
       TOP RIGHT BADGE: BELARUS / 2026
       ============================================================ -->
  <g transform="translate(1380, 52)" font-family="system-ui, -apple-system, sans-serif" text-anchor="end">
    <line x1="0" y1="0" x2="-120" y2="0" stroke="#8B2536" stroke-width="2"/>
    <text x="0" y="24" fill="#E6A9B4" font-size="13" font-weight="700" letter-spacing="3">BELARUS / 2026</text>
  </g>

  <!-- ============================================================
       BOTTOM LEFT FOOTER BOX
       ============================================================ -->
  <g transform="translate(48, 1260)" font-family="system-ui, -apple-system, sans-serif">
    <rect x="0" y="0" width="340" height="78" rx="8" fill="#12080B" fill-opacity="0.85" stroke="#8B2536" stroke-width="1.4" filter="url(#badgeShadow)"/>
    <text x="16" y="26" fill="#F8F7EF" font-size="15" font-weight="900" letter-spacing="1">2026 · ГОМЕЛЬ</text>
    <text x="16" y="46" fill="#E6A9B4" font-size="10.5" font-weight="700" letter-spacing="0.5">БАЗА КОМПАНИИ · ОСНОВНОЙ РЫНОК — БЕЛАРУСЬ</text>
    <text x="16" y="64" fill="#9E988D" font-size="9.5" font-weight="600" letter-spacing="0.4">НАЧИНАЕМ С БЕЛАРУСИ · РАСТЁМ ПО МЕРЕ РЕАЛЬНЫХ ПЕРЕВОЗОК</text>
  </g>
</svg>`;

fs.writeFileSync('assets/img/asma-belarus-map.svg', svg, 'utf8');
console.log('Successfully generated assets/img/asma-belarus-map.svg (size: ' + svg.length + ' bytes)');
