const fs = require('fs');

const src = fs.readFileSync('belarus_source.svg', 'utf8');

function getTag(id) {
  const match = src.match(new RegExp('<(path|polyline|polygon)[^>]*id=\\\"' + id + '\\\"[^>]*>([\\s\\S]*?<\\/\\1>)?')) ||
                src.match(new RegExp('<(path|polyline|polygon)[^>]+id=\\\"' + id + '\\\"[\\s\\S]*?\\/>'));
  if (!match) return { id, d: '', points: '' };
  let str = match[0];
  const dMatch = str.match(/d=\"([\\s\\S]*?)\"/);
  const ptsMatch = str.match(/points=\"([\\s\\S]*?)\"/);
  return { id, d: dMatch ? dMatch[1].replace(/\\s+/g, ' ').trim() : null, points: ptsMatch ? ptsMatch[1].replace(/\\s+/g, ' ').trim() : null };
}

const p41 = getTag('path41');
const p43 = getTag('path43');
const poly25 = getTag('polyline25');
const poly27 = getTag('polyline27');
const poly29 = getTag('polyline29');
const poly31 = getTag('polyline31');
const poly33 = getTag('polyline33');

const majorCities = [
  { id: 'minsk', name: 'МИНСК', x: 752.0, y: 684.9, labelX: 752.0, labelY: 646, anchor: 'middle', region: 'Минская область' },
  { id: 'gomel', name: 'ГОМЕЛЬ', x: 1301.7, y: 1087.2, labelX: 1301.7, labelY: 1050, anchor: 'middle', region: 'Гомельская область' },
  { id: 'brest', name: 'БРЕСТ', x: 135.8, y: 1179.4, labelX: 175.0, labelY: 1186, anchor: 'start', region: 'Брестская область' },
  { id: 'grodno', name: 'ГРОДНО', x: 150.5, y: 749.4, labelX: 190.0, labelY: 756, anchor: 'start', region: 'Гродненская область' },
  { id: 'vitebsk', name: 'ВИТЕБСК', x: 1177.7, y: 332.9, labelX: 1177.7, labelY: 295, anchor: 'middle', region: 'Витебская область' },
  { id: 'mogilev', name: 'МОГИЛЁВ', x: 1206.6, y: 688.0, labelX: 1246.0, labelY: 694, anchor: 'start', region: 'Могилёвская область' }
];

const subCities = [
  { id: 'polotsk', x: 946.4, y: 252.1, name: 'Полоцк', region: 'Витебская обл.' },
  { id: 'novopolotsk', x: 928.0, y: 242.0, name: 'Новополоцк', region: 'Витебская обл.' },
  { id: 'orsha', x: 1213.3, y: 519.9, name: 'Орша', region: 'Витебская обл.' },
  { id: 'baranovichi', x: 502.9, y: 896.1, name: 'Барановичи', region: 'Брестская обл.' },
  { id: 'bobruisk', x: 1019.3, y: 894.5, name: 'Бобруйск', region: 'Могилёвская обл.' },
  { id: 'pinsk', x: 517.2, y: 1174.6, name: 'Пинск', region: 'Брестская обл.' },
  { id: 'mozyr', x: 1023.2, y: 1192.6, name: 'Мозырь', region: 'Гомельская обл.' },
  { id: 'lida', x: 388.1, y: 690.8, name: 'Лида', region: 'Гродненская обл.' },
  { id: 'borisov', x: 904.0, y: 596.4, name: 'Борисов', region: 'Минская обл.' },
  { id: 'soligorsk', x: 748.8, y: 990.6, name: 'Солигорск', region: 'Минская обл.' },
  { id: 'slutsk', x: 751.7, y: 896.7, name: 'Слуцк', region: 'Минская обл.' },
  { id: 'zhlobin', x: 1151.7, y: 945.7, name: 'Жлобин', region: 'Гомельская обл.' },
  { id: 'svetlogorsk', x: 1111.4, y: 1024.9, name: 'Светлогорск', region: 'Гомельская обл.' },
  { id: 'rechitsa', x: 1216.7, y: 1107.5, name: 'Речица', region: 'Гомельская обл.' },
  { id: 'kobrin', x: 239.3, y: 1146.4, name: 'Кобрин', region: 'Брестская обл.' },
  { id: 'slonim', x: 390.8, y: 891.1, name: 'Слоним', region: 'Гродненская обл.' },
  { id: 'volkovysk', x: 245.9, y: 870.2, name: 'Волковыск', region: 'Гродненская обл.' },
  { id: 'smorgon', x: 569.2, y: 494.3, name: 'Сморгонь', region: 'Гродненская обл.' },
  { id: 'kalinkovichi', x: 1052.8, y: 1168.1, name: 'Калинковичи', region: 'Гомельская обл.' },
  { id: 'rogachev', x: 1155.6, y: 883.3, name: 'Рогачёв', region: 'Гомельская обл.' },
  { id: 'gorki', x: 1313.3, y: 598.9, name: 'Горки', region: 'Могилёвская обл.' },
  { id: 'osipovichi', x: 946.8, y: 829.4, name: 'Осиповичи', region: 'Могилёвская обл.' },
  { id: 'bereza', x: 337.8, y: 1048.8, name: 'Берёза', region: 'Брестская обл.' },
  { id: 'ivatsevichi', x: 393.9, y: 994.1, name: 'Ивацевичи', region: 'Брестская обл.' },
  { id: 'dzerzhinsk', x: 673.8, y: 752.7, name: 'Дзержинск', region: 'Минская обл.' },
  { id: 'vileyka', x: 647.7, y: 491.2, name: 'Вилейка', region: 'Минская обл.' },
  { id: 'luninets', x: 631.3, y: 1134.1, name: 'Лунинец', region: 'Брестская обл.' },
  { id: 'maryina_gorka', x: 846.8, y: 780.0, name: 'Марьина Горка', region: 'Минская обл.' },
  { id: 'postavy', x: 635.0, y: 300.0, name: 'Поставы', region: 'Витебская обл.' },
  { id: 'pruzhany', x: 254.0, y: 1038.0, name: 'Пружаны', region: 'Брестская обл.' },
  { id: 'glubokoe', x: 770.0, y: 290.0, name: 'Глубокое', region: 'Витебская обл.' },
  { id: 'dobrush', x: 1356.7, y: 1094.2, name: 'Добруш', region: 'Гомельская обл.' },
  { id: 'lepel', x: 934.4, y: 406.8, name: 'Лепель', region: 'Витебская обл.' },
  { id: 'bykhov', x: 1195.4, y: 785.8, name: 'Быхов', region: 'Могилёвская обл.' },
  { id: 'krichev', x: 1430.7, y: 726.3, name: 'Кричев', region: 'Могилёвская обл.' },
  { id: 'mosty', x: 268.0, y: 818.0, name: 'Мосты', region: 'Гродненская обл.' },
  { id: 'shchuchin', x: 301.0, y: 760.0, name: 'Щучин', region: 'Гродненская обл.' },
  { id: 'oshmyany', x: 495.0, y: 512.0, name: 'Ошмяны', region: 'Гродненская обл.' },
  { id: 'stolbtsy', x: 610.0, y: 795.0, name: 'Столбцы', region: 'Минская обл.' },
  { id: 'klimovichi', x: 1470.0, y: 757.0, name: 'Климовичи', region: 'Могилёвская обл.' },
  { id: 'shklov', x: 1205.0, y: 605.0, name: 'Шклов', region: 'Могилёвская обл.' },
  { id: 'zhitkovichi', x: 800.0, y: 1145.0, name: 'Житковичи', region: 'Гомельская обл.' },
  { id: 'braslav', x: 668.0, y: 140.0, name: 'Браслав', region: 'Витебская обл.' },
  { id: 'ostrovets', x: 499.0, y: 450.0, name: 'Островец', region: 'Гродненская обл.' },
  { id: 'logoysk', x: 798.0, y: 592.0, name: 'Логойск', region: 'Минская обл.' },
  { id: 'nesvizh', x: 597.0, y: 875.0, name: 'Несвиж', region: 'Минская обл.' },
  { id: 'stolin', x: 640.0, y: 1240.0, name: 'Столин', region: 'Брестская обл.' },
  { id: 'mikashevichi', x: 735.0, y: 1145.0, name: 'Микашевичи', region: 'Брестская обл.' },
  { id: 'zaslavl', x: 708.0, y: 654.0, name: 'Заславль', region: 'Минская обл.' },
  { id: 'belooyersk', x: 370.0, y: 1065.0, name: 'Белоозёрск', region: 'Брестская обл.' },
  { id: 'petrikov', x: 780.0, y: 1170.0, name: 'Петриков', region: 'Гомельская обл.' },
  { id: 'khoiniki', x: 1140.0, y: 1245.0, name: 'Хойники', region: 'Гомельская обл.' },
  { id: 'zhodino', x: 865.0, y: 624.0, name: 'Жодино', region: 'Минская обл.' },
  { id: 'chechersk', x: 1290.0, y: 938.0, name: 'Чечерск', region: 'Гомельская обл.' },
  { id: 'buda_koshelevo', x: 1255.0, y: 998.0, name: 'Буда-Кошелёво', region: 'Гомельская обл.' },
  { id: 'yelsk', x: 1018.0, y: 1265.0, name: 'Ельск', region: 'Гомельская обл.' },
  { id: 'narovlya', x: 1070.0, y: 1270.0, name: 'Наровля', region: 'Гомельская обл.' },
  { id: 'vetka', x: 1335.0, y: 1045.0, name: 'Ветка', region: 'Гомельская обл.' },
  { id: 'bragin', x: 1188.0, y: 1280.0, name: 'Брагин', region: 'Гомельская обл.' },
  { id: 'komarin', x: 1230.0, y: 1410.0, name: 'Комарин', region: 'Гомельская обл.' },
  { id: 'miory', x: 770.0, y: 160.0, name: 'Миоры', region: 'Витебская обл.' },
  { id: 'dokshitsy', x: 780.0, y: 390.0, name: 'Докшицы', region: 'Витебская обл.' },
  { id: 'berezino', x: 960.0, y: 720.0, name: 'Березино', region: 'Минская обл.' },
  { id: 'lyuban', x: 800.0, y: 1010.0, name: 'Любань', region: 'Минская обл.' },
  { id: 'gorodeya', x: 575.0, y: 845.0, name: 'Городея', region: 'Минская обл.' },
  { id: 'telekhany', x: 440.0, y: 1060.0, name: 'Телеханы', region: 'Брестская обл.' }
];

const svgMarkup = `<svg viewBox="0 0 1600 1450" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="asma-master-vector-map" role="img" aria-label="Карта Республики Беларусь — сеть логистики ASMA Lines">
  <defs>
    <!-- Background Vignette -->
    <radialGradient id="mapVignette" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#1A0A10" stop-opacity="0.95"/>
      <stop offset="70%" stop-color="#12060A" stop-opacity="0.98"/>
      <stop offset="100%" stop-color="#0A0306" stop-opacity="1"/>
    </radialGradient>

    <!-- Territory Fill Gradient -->
    <radialGradient id="landFillGrad" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#240D15" stop-opacity="0.9"/>
      <stop offset="85%" stop-color="#18070D" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#130509" stop-opacity="1"/>
    </radialGradient>

    <!-- Hub Glow Filter -->
    <filter id="glowHub" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#8B2536" flood-opacity="0.6"/>
    </filter>
  </defs>

  <!-- Deep Backdrop -->
  <rect x="0" y="0" width="1600" height="1450" fill="#0E0508"/>
  <rect x="0" y="0" width="1600" height="1450" fill="url(#mapVignette)"/>

  <!-- ============================================================
       BELARUS LANDMASS & OBLAST BOUNDARIES
       ============================================================ -->
  <g class="belarus-landmass-layer">
    <!-- Base Fill & Outer Contour -->
    <path d="${p41.d}" fill="url(#landFillGrad)" stroke="#8B2536" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${p43.d}" fill="url(#landFillGrad)" stroke="#8B2536" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>

    <!-- Oblast Internal Borders -->
    <g class="oblast-boundaries" fill="none" stroke="#E6A9B4" stroke-width="1.8" stroke-opacity="0.28" stroke-dasharray="6 6">
      <polyline points="${poly25.points}"/>
      <polyline points="${poly27.points}"/>
      <polyline points="${poly29.points}"/>
      <polyline points="${poly31.points}"/>
      <polyline points="${poly33.points}"/>
    </g>
  </g>

  <!-- ============================================================
       NETWORK COVERAGE NODES (TOWNS & LOGISTICS POINTS)
       ============================================================ -->
  <g class="map-subcities-layer">
    ${subCities.map(c => `<circle cx="${c.x}" cy="${c.y}" r="4.5" fill="#E6A9B4" fill-opacity="0.75" stroke="#4E1521" stroke-width="1.2" class="map-city-node map-node-sub" data-id="${c.id}" data-name="${c.name}" data-region="${c.region}" role="button" tabindex="0" aria-label="${c.name}"><title>${c.name} (${c.region})</title></circle>`).join('\n    ')}
  </g>

  <!-- ============================================================
       6 MAJOR REGIONAL CENTERS (DOUBLE-RING TARGET HUBS)
       ============================================================ -->
  <g class="map-major-hubs-layer">
    ${majorCities.map(c => `
    <g class="map-major-hub map-city-node" data-id="${c.id}" data-name="${c.name}" data-region="${c.region}" role="button" tabindex="0" aria-label="${c.name}" filter="url(#glowHub)">
      <circle cx="${c.x}" cy="${c.y}" r="22" fill="rgba(139, 37, 54, 0.25)" stroke="#8B2536" stroke-width="2.5" class="hub-outer-ring"/>
      <circle cx="${c.x}" cy="${c.y}" r="11" fill="#6B1E2D" stroke="#E6A9B4" stroke-width="1.8"/>
      <circle cx="${c.x}" cy="${c.y}" r="4.5" fill="#FFFFFF"/>
      <text x="${c.labelX}" y="${c.labelY}" text-anchor="${c.anchor}" fill="#FFFFFF" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="800" letter-spacing="1.5" class="hub-city-label" style="text-shadow: 0 2px 8px rgba(0,0,0,0.9), 0 0 4px #000;">${c.name}</text>
    </g>`).join('\n')}
  </g>

  <!-- Top Right Indicator -->
  <g transform="translate(1420, 60)" font-family="system-ui, -apple-system, sans-serif" text-anchor="end">
    <line x1="0" y1="0" x2="-100" y2="0" stroke="#8B2536" stroke-width="2"/>
    <text x="0" y="24" fill="#E6A9B4" font-size="13" font-weight="700" letter-spacing="3">BELARUS / 2026</text>
  </g>
</svg>`;

// Save standalone SVG for asset usage
fs.writeFileSync('assets/img/asma-belarus-map.svg', svgMarkup, 'utf8');
console.log('Saved assets/img/asma-belarus-map.svg (Size:', svgMarkup.length, 'bytes)');

// Update index.html
let indexHtml = fs.readFileSync('index.html', 'utf8');

// Replace the text in geography section
indexHtml = indexHtml.replace(
  /<p class="lede">Центральный логистический хаб и диспетчерский центр компании расположены в <strong>Гомеле<\/strong>\. Мы обеспечиваем регулярные ежедневные рейсы по всей Беларуси с охватом всех 6 областей и более 70 населённых пунктов\.<\/p>/,
  '<p class="lede">Организуем регулярные грузоперевозки и подачу автотранспорта по всей Беларуси. Обеспечиваем надёжную доставку во все 6 областей и более 70 населённых пунктов страны.</p>'
);

// Remove corridor filter pills
indexHtml = indexHtml.replace(
  /\s*<!-- Route Filter Pills -->[\s\S]*?<\/div>\s*<!-- Quick Metrics Bar -->/,
  '\n          <!-- Quick Metrics Bar -->'
);

// Replace the old SVG in index.html with new clean SVG
const mapStartIdx = indexHtml.indexOf('<div class="route-map" id="belarus-interactive-map"');
if (mapStartIdx !== -1) {
  const tooltipIdx = indexHtml.indexOf('<!-- Dynamic Floating Info Tooltip -->', mapStartIdx);
  if (tooltipIdx !== -1) {
    const beforeMap = indexHtml.slice(0, mapStartIdx);
    const afterTooltip = indexHtml.slice(tooltipIdx);
    
    // Update tooltip header & content if needed (remove Gomel HQ specific wording)
    let updatedAfterTooltip = afterTooltip.replace(
      /<p class="map-tooltip__desc" id="tooltipCityDesc">.*?<\/p>/,
      '<p class="map-tooltip__desc" id="tooltipCityDesc">Регулярные рейсы ASMA Lines · Доставка от двери до двери</p>'
    );
    updatedAfterTooltip = updatedAfterTooltip.replace(
      /<span class="stat-lbl">До базы в Гомеле:<\/span>[\s\S]*?<strong class="stat-val" id="tooltipDistance">.*?<\/strong>/,
      '<span class="stat-lbl">Статус направления:</span>\n                  <strong class="stat-val" id="tooltipDistance">Активно</strong>'
    );
    updatedAfterTooltip = updatedAfterTooltip.replace(
      /<span class="stat-lbl">Время в пути:<\/span>[\s\S]*?<strong class="stat-val" id="tooltipTime">.*?<\/strong>/,
      '<span class="stat-lbl">График подачи:</span>\n                  <strong class="stat-val" id="tooltipTime">Ежедневно</strong>'
    );

    indexHtml = beforeMap + '<div class="route-map" id="belarus-interactive-map" aria-label="Карта Республики Беларусь — сеть логистики ASMA Lines">\n            ' + svgMarkup + '\n            ' + updatedAfterTooltip;
  }
}

fs.writeFileSync('index.html', indexHtml, 'utf8');
console.log('Updated index.html successfully!');
