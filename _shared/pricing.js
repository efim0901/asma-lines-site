/**
 * ASMA Lines — единственный источник правды по тарифам и расчёту стоимости.
 *
 * Раньше тарифы были продублированы в assets/calculator.js, assets/site.js
 * и proposal.html, из-за чего уже разошлись. Теперь их импортируют:
 *   - server.js и _worker.js (серверный пересчёт цены — клиентское значение игнорируется)
 *   - assets/pricing-client.js (тонкая обёртка для браузера)
 *   - proposal.html (через assets/pricing-client.js)
 */

export const RATES = Object.freeze({
  base: 85,
  perKm: 1.65,
  perTonne: 18,
  fragile: 1.12,
  temperature: 1.28,
  loading: 45,
  /** Минимальная стоимость рейса, BYN. */
  minimum: 150,
  /** Коэффициент извилистости дорог при расчёте по прямой. */
  roadCoefficient: 1.28
});

export const CARGO_TYPES = Object.freeze({
  standard: { label: 'Обычный груз', multiplier: 1 },
  fragile: { label: 'Хрупкий груз', multiplier: RATES.fragile },
  temperature: { label: 'Терморежим', multiplier: RATES.temperature }
});

/**
 * Тарифные ступени по тоннажу. Раньше калькулятор прыгал с 5 т сразу на 20 т,
 * из-за чего груз 6 т считался как 20-тонная еврофура.
 * Значения согласованы с парком в assets/vehicles.js.
 */
export const WEIGHT_TIERS = Object.freeze([
  { maxWeight: 0.8, label: 'До 800 кг', vehicle: 'Каблук / фургон' },
  { maxWeight: 2.5, label: 'До 2.5 т', vehicle: 'Газель' },
  { maxWeight: 6, label: 'До 6 т', vehicle: 'Изотерм 6 т' },
  { maxWeight: 10, label: 'До 10 т', vehicle: 'Тент 10 т' },
  { maxWeight: 20, label: 'До 20 т', vehicle: 'Тент 20 т' },
  { maxWeight: 40, label: 'До 40 т', vehicle: 'Еврофура 40 т' }
]);

export const LIMITS = Object.freeze({
  minDistanceKm: 1,
  maxDistanceKm: 2500,
  minWeightT: 0.05,
  maxWeightT: 40
});

/** Подбирает подходящий подвижной состав по весу. */
export function vehicleForWeight(weightTons) {
  const weight = Number(weightTons) || 0;
  for (const tier of WEIGHT_TIERS) {
    if (weight <= tier.maxWeight) return tier;
  }
  return WEIGHT_TIERS[WEIGHT_TIERS.length - 1];
}

/**
 * Считает стоимость перевозки.
 * @param {object} input
 * @param {number} input.distanceKm — расстояние, км (>0)
 * @param {number} input.weightTons — вес, т (>0)
 * @param {string} [input.cargo] — standard | fragile | temperature
 * @param {boolean} [input.loading] — нужны ли погрузка/экспедирование
 * @param {number} [input.volumeM3] — объём, м³ (справочно, влияет на выбор кузова)
 * @returns {{total:number, breakdown:Array<{label:string,value:number}>, vehicle:string}}
 * @throws {RangeError} если distanceKm или weightTons вне допустимых границ
 */
export function calculatePrice(input = {}) {
  const distanceKm = Number(input.distanceKm);
  const weightTons = Number(input.weightTons);

  if (!Number.isFinite(distanceKm) || distanceKm < LIMITS.minDistanceKm || distanceKm > LIMITS.maxDistanceKm) {
    throw new RangeError(`distanceKm должен быть числом от ${LIMITS.minDistanceKm} до ${LIMITS.maxDistanceKm}`);
  }
  if (!Number.isFinite(weightTons) || weightTons < LIMITS.minWeightT || weightTons > LIMITS.maxWeightT) {
    throw new RangeError(`weightTons должен быть числом от ${LIMITS.minWeightT} до ${LIMITS.maxWeightT}`);
  }

  const cargoKey = CARGO_TYPES[input.cargo] ? input.cargo : 'standard';
  const cargo = CARGO_TYPES[cargoKey];

  const basePart = RATES.base;
  const kmPart = distanceKm * RATES.perKm;
  const tonnePart = weightTons * RATES.perTonne;

  let total = basePart + kmPart + tonnePart;
  const breakdown = [
    { label: 'Подача транспорта', value: basePart },
    { label: `Пробег ${Math.round(distanceKm)} км`, value: kmPart },
    { label: `Тоннаж ${weightTons} т`, value: tonnePart }
  ];

  if (cargo.multiplier !== 1) {
    const before = total;
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

  const tier = vehicleForWeight(weightTons);
  return {
    total: Math.round(total),
    breakdown: breakdown.map(row => ({ label: row.label, value: Math.round(row.value) })),
    vehicle: tier.vehicle
  };
}

/** Расстояние по прямой (формула гаверсинуса), км. */
export function haversineKm(a, b) {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Расстояние по дорогам (оценка через коэффициент извилистости). */
export function roadDistanceKm(a, b) {
  return haversineKm(a, b) * RATES.roadCoefficient;
}
