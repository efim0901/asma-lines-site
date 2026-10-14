/* ============================================================
   ASMA Lines — построение коммерческого предложения (proposal.html).

   Раньше этот код был inline в <script> внутри HTML и содержал третью
   копию тарифов, а также подменял итог значением из URL (?total=...):
   любую сумму можно было навязать клиенту ссылкой.

   Теперь расчёт берётся из assets/pricing-client.js — того же модуля,
   что использует калькулятор и сервер.
   ============================================================ */

(function renderProposal() {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var from = params.get('from') || 'Гомель';
  var to = params.get('to') || 'Минск';
  var km = Number(params.get('km')) || 310;
  var weight = Number(params.get('weight')) || 5;
  var cargo = params.get('cargo') || 'standard';
  var loading = params.get('loading') === '1';

  var PRICING = window.ASMA_PRICING;
  if (!PRICING) {
    console.error('ASMA: не загружен assets/pricing-client.js — КП не может быть построено');
    return;
  }

  var quote = PRICING.calculatePrice({
    distanceKm: km,
    weightTons: weight,
    cargo: cargo,
    loading: loading
  });

  if (!quote) {
    // Параметры вне допустимых границ (например, km=0 в ссылке).
    var totalNode = document.getElementById('t-total');
    if (totalNode) totalNode.textContent = 'уточняется';
    console.warn('ASMA: некорректные параметры КП — расчёт невозможен');
    return;
  }

  // ВАЖНО: значение ?total= из URL больше не используется.
  // Ссылку может подделать кто угодно, а итог должен совпадать с расчётом сервера.
  var total = quote.total;

  var rate = PRICING.RATES;
  var kmCost = km * rate.perKm;
  var weightCost = weight * rate.perTonne;
  var base = rate.base;

  var extrasList = [];
  if (cargo === 'fragile') extrasList.push('Хрупкий груз (×' + rate.fragile + ')');
  if (cargo === 'temperature') extrasList.push('Температурный режим (×' + rate.temperature + ')');
  if (loading) extrasList.push('Помощь в погрузке (+' + rate.loading + ' BYN)');

  var now = new Date();
  var pad = function (value) {
    return String(value).padStart(2, '0');
  };
  var dateStr = pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' + now.getFullYear();
  var docId =
    'ASMA-' +
    now.getFullYear() +
    '-' +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    Math.floor(100 + Math.random() * 900);

  document.getElementById('doc-num').textContent = 'КП № ' + docId;
  document.getElementById('doc-date').textContent = 'Дата: ' + dateStr;
  document.getElementById('route-text').textContent = from + ' → ' + to;
  document.getElementById('distance-text').textContent = 'Расстояние: ~' + km + ' км';
  document.getElementById('cargo-weight').textContent = 'Вес груза: ' + weight + ' т';

  var cargoName = 'Стандартный тент';
  if (cargo === 'fragile') cargoName = 'Хрупкий груз';
  if (cargo === 'temperature') cargoName = 'Изотерм / Рефрижератор';
  document.getElementById('cargo-type').textContent =
    'Тип: ' + cargoName + (loading ? ' · С погрузкой' : '') + ' · ' + quote.vehicle;

  document.getElementById('t-km-num').textContent = km;
  document.getElementById('t-w-num').textContent = weight;
  document.getElementById('t-km').textContent = kmCost.toFixed(2) + ' BYN';
  document.getElementById('t-weight').textContent = weightCost.toFixed(2) + ' BYN';

  if (extrasList.length) {
    var row = document.getElementById('row-extras');
    if (row) row.style.display = 'table-row';
    var extrasName = document.getElementById('extras-name');
    var extrasVal = document.getElementById('extras-val');
    if (extrasName) extrasName.textContent = extrasList.join(', ');
    if (extrasVal) extrasVal.textContent = (total - (base + kmCost + weightCost)).toFixed(2) + ' BYN';
  }

  document.getElementById('t-total').textContent = Math.round(total).toLocaleString('ru-RU') + ' BYN';

  if (params.get('autoprint') === '1') {
    setTimeout(function () {
      window.print();
    }, 350);
  }
})();

/* Кнопки печатной формы. Раньше они обрабатывались в site.js, но на этой
   странице site.js не подключён — кнопки просто не реагировали на клики. */
document.querySelectorAll('[data-action="print"]').forEach(function (button) {
  button.addEventListener('click', function () {
    window.print();
  });
});

document.querySelectorAll('[data-action="close-window"]').forEach(function (button) {
  button.addEventListener('click', function () {
    window.close();
  });
});
