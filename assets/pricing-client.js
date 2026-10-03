/* ============================================================
   ASMA Lines — тарифы для браузера (единственный источник правды).

   Раньше тарифы были продублированы в assets/calculator.js,
   assets/site.js и proposal.html. Теперь они живут только здесь
   и синхронизированы с сервером (_shared/pricing.js и _worker.js —
   совпадение проверяется тестом _tests/pricing.test.js).

   Подключается ПЕРЕД calculator.js и site.js и отдаёт window.ASMA_PRICING.
   ============================================================ */

(function initPricing(global) {
  'use strict';

  let RATES = Object.freeze({
    base: 85,
    perKm: 1.65,
    perTonne: 18,
    fragile: 1.12,
    temperature: 1.28,
    loading: 45,
    minimum: 150,
    roadCoefficient: 1.28
  });

  let CARGO = Object.freeze({
    standard: { label: 'Обычный груз', multiplier: 1 },
    fragile: { label: 'Хрупкий груз', multiplier: RATES.fragile },
    temperature: { label: 'Терморежим', multiplier: RATES.temperature }
  });

  /* Ступени согласованы с парком: раньше груз 6 т считался как 20-тонная фура. */
  let WEIGHT_TIERS = Object.freeze([
    { maxWeight: 0.8, label: 'До 800 кг', vehicle: 'Каблук / фургон' },
    { maxWeight: 2.5, label: 'До 2.5 т', vehicle: 'Газель' },
    { maxWeight: 6, label: 'До 6 т', vehicle: 'Изотерм 6 т' },
    { maxWeight: 10, label: 'До 10 т', vehicle: 'Тент 10 т' },
    { maxWeight: 20, label: 'До 20 т', vehicle: 'Тент 20 т' },
    { maxWeight: 40, label: 'До 40 т', vehicle: 'Еврофура 40 т' }
  ]);

  let LIMITS = Object.freeze({
    minDistanceKm: 1,
    maxDistanceKm: 2500,
    minWeightT: 0.05,
    maxWeightT: 40
  });

  function vehicleForWeight(weightTons) {
    let weight = Number(weightTons) || 0;
    for (let i = 0; i < WEIGHT_TIERS.length; i += 1) {
      if (weight <= WEIGHT_TIERS[i].maxWeight) return WEIGHT_TIERS[i];
    }
    return WEIGHT_TIERS[WEIGHT_TIERS.length - 1];
  }

  /**
   * Считает стоимость. Повторяет серверный расчёт один в один, чтобы
   * показанная клиенту цена совпадала с той, что увидит диспетчер.
   * @returns {{total:number, breakdown:Array, vehicle:string}|null}
   */
  function calculatePrice(input) {
    let distanceKm = Number(input && input.distanceKm);
    let weightTons = Number(input && input.weightTons);
    if (!isFinite(distanceKm) || distanceKm < LIMITS.minDistanceKm || distanceKm > LIMITS.maxDistanceKm) return null;
    if (!isFinite(weightTons) || weightTons < LIMITS.minWeightT || weightTons > LIMITS.maxWeightT) return null;

    let cargoKey = CARGO[input.cargo] ? input.cargo : 'standard';
    let cargo = CARGO[cargoKey];

    let basePart = RATES.base;
    let kmPart = distanceKm * RATES.perKm;
    let tonnePart = weightTons * RATES.perTonne;
    let total = basePart + kmPart + tonnePart;

    let breakdown = [
      { label: 'Подача транспорта', value: basePart },
      { label: 'Пробег ' + Math.round(distanceKm) + ' км', value: kmPart },
      { label: 'Тоннаж ' + weightTons + ' т', value: tonnePart }
    ];

    if (cargo.multiplier !== 1) {
      let before = total;
      total *= cargo.multiplier;
      breakdown.push({ label: cargo.label, value: total - before });
    }
    if (input.loading) {
      total += RATES.loading;
      breakdown.push({ label: 'Погрузка / экспедирование', value: RATES.loading });
    }
    if (total < RATES.minimum) {
      breakdown.push({ label: 'Минимальная стоимость рейса', value: RATES.minimum - total });
      total = RATES.minimum;
    }

    return {
      total: Math.round(total),
      breakdown: breakdown.map(function (row) {
        return { label: row.label, value: Math.round(row.value) };
      }),
      vehicle: vehicleForWeight(weightTons).vehicle
    };
  }

  function haversineKm(a, b) {
    let lat1 = a[0], lon1 = a[1], lat2 = b[0], lon2 = b[1];
    let R = 6371;
    let dLat = ((lat2 - lat1) * Math.PI) / 180;
    let dLon = ((lon2 - lon1) * Math.PI) / 180;
    let s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function roadDistanceKm(a, b) {
    return haversineKm(a, b) * RATES.roadCoefficient;
  }

  global.ASMA_PRICING = {
    RATES: RATES,
    CARGO: CARGO,
    WEIGHT_TIERS: WEIGHT_TIERS,
    LIMITS: LIMITS,
    vehicleForWeight: vehicleForWeight,
    calculatePrice: calculatePrice,
    haversineKm: haversineKm,
    roadDistanceKm: roadDistanceKm
  };
})(window);
