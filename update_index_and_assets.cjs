const fs = require('fs');

const svgContent = fs.readFileSync('assets/img/map-belarus.svg', 'utf8');
const cityMap = JSON.parse(fs.readFileSync('cities_coords.json', 'utf8'));

// Extract inner SVG content or use clean embedding
const svgInner = svgContent
  .replace(/<\?xml[\s\S]*?\?>/, '')
  .replace(/<!DOCTYPE[\s\S]*?>/, '');

// Prepare the new index.html section
let indexHtml = fs.readFileSync('index.html', 'utf8');

// Replace dark-section with the updated master map
const newMapSection = `  <section class="dark-section" id="geography-map-section">
    <div class="dark-section__bg" style="background-image:url('assets/img/map-belarus.svg?v=20260914g')"></div>
    <div class="dark-section__overlay"></div>
    <div class="dark-section__inner container">
      <div class="dark-grid">
        <div class="dark-grid__info">
          <p class="kicker">География перевозок</p>
          <h2 class="display-2">ASMA Lines — путь начинается с маршрута</h2>
          <p class="lede">Центральный логистический хаб и диспетчерский центр компании расположены в <strong>Гомеле</strong>. Мы обеспечиваем регулярные ежедневные рейсы по всей Беларуси с охватом всех 6 областей и более 70 населённых пунктов.</p>
          
          <!-- Route Filter Pills -->
          <div class="map-corridor-filters" role="tablist" aria-label="Фильтр маршрутов по Беларуси">
            <button type="button" class="corridor-btn active" data-corridor="all">Все маршруты</button>
            <button type="button" class="corridor-btn" data-corridor="m5">М-5 Гомель ⇄ Минск</button>
            <button type="button" class="corridor-btn" data-corridor="m1">М-1 Брест ⇄ Орша</button>
            <button type="button" class="corridor-btn" data-corridor="m8">М-8 Север ⇄ Юг</button>
            <button type="button" class="corridor-btn" data-corridor="m10">М-10 Полесье</button>
          </div>

          <!-- Quick Metrics Bar -->
          <div class="map-metrics-bar">
            <div class="map-metric-item">
              <span class="map-metric-val">6</span>
              <span class="map-metric-lbl">Областных центров</span>
            </div>
            <div class="map-metric-item">
              <span class="map-metric-val">70+</span>
              <span class="map-metric-lbl">Городов и узлов</span>
            </div>
            <div class="map-metric-item">
              <span class="map-metric-val">24/7</span>
              <span class="map-metric-lbl">Диспетчерский контроль</span>
            </div>
            <div class="map-metric-item">
              <span class="map-metric-val">100%</span>
              <span class="map-metric-lbl">Покрытие Беларуси</span>
            </div>
          </div>

          <div class="actions" style="margin-top:24px">
            <a class="btn btn-primary" href="calculator.html">Рассчитать маршрут</a>
            <a class="btn btn-outline-light" href="about.html">О компании</a>
          </div>
        </div>

        <div class="route-map-wrapper">
          <div class="route-map" id="belarus-interactive-map" aria-label="Интерактивная карта Республики Беларусь со схемой маршрутов ASMA Lines">
            ${svgInner}
            
            <!-- Dynamic Floating Info Tooltip -->
            <div class="map-tooltip" id="mapCityTooltip" role="tooltip" aria-hidden="true">
              <div class="map-tooltip__header">
                <strong class="map-tooltip__title" id="tooltipCityName">Гомель</strong>
                <span class="map-tooltip__tag" id="tooltipCityRegion">Гомельская обл.</span>
              </div>
              <p class="map-tooltip__desc" id="tooltipCityDesc">Центральный хаб ASMA Lines · 24/7 диспетчерская</p>
              <div class="map-tooltip__meta">
                <div class="map-tooltip__stat">
                  <span class="stat-lbl">До базы в Гомеле:</span>
                  <strong class="stat-val" id="tooltipDistance">0 км</strong>
                </div>
                <div class="map-tooltip__stat">
                  <span class="stat-lbl">Время в пути:</span>
                  <strong class="stat-val" id="tooltipTime">База</strong>
                </div>
              </div>
              <a href="calculator.html" id="tooltipCalcLink" class="map-tooltip__btn">Рассчитать перевозку →</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>`;

// Replace from <section class="dark-section"> to </section> before <section class="section container">
const regex = /<section class="dark-section"[\s\S]*?<\/section>/;
indexHtml = indexHtml.replace(regex, newMapSection);
fs.writeFileSync('index.html', indexHtml, 'utf8');
console.log('Successfully updated index.html with master interactive map');
