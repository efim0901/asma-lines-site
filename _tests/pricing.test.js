/**
 * Тесты расчёта стоимости.
 *
 * Главная ценность: parity-проверка. Расчёт существует в двух местах —
 * _shared/pricing.js (использует локальный сервер) и инлайн в _worker.js
 * (продакшн на Cloudflare). Тест прогоняет десятки комбинаций через обе
 * реализации и падает, если они разойдутся.
 */

import { describe, test, assertEqual, assertTrue, assertThrows } from './harness.js';
import { calculatePrice, RATES, WEIGHT_TIERS, LIMITS, vehicleForWeight } from '../_shared/pricing.js';
import { __testables as worker } from '../_worker.js';

describe('Расчёт стоимости: базовая формула', () => {
  test('складывает подачу, пробег и тоннаж', () => {
    const result = calculatePrice({ distanceKm: 100, weightTons: 5 });
    // 85 + 100*1.65 + 5*18 = 85 + 165 + 90 = 340
    assertEqual(result.total, 340);
  });

  test('применяет коэффициент хрупкого груза', () => {
    const standard = calculatePrice({ distanceKm: 100, weightTons: 5 });
    const fragile = calculatePrice({ distanceKm: 100, weightTons: 5, cargo: 'fragile' });
    assertEqual(fragile.total, Math.round(standard.total * RATES.fragile));
  });

  test('применяет коэффициент терморежима', () => {
    const standard = calculatePrice({ distanceKm: 200, weightTons: 10 });
    const thermo = calculatePrice({ distanceKm: 200, weightTons: 10, cargo: 'temperature' });
    assertEqual(thermo.total, Math.round(standard.total * RATES.temperature));
  });

  test('добавляет стоимость погрузки', () => {
    const withoutLoading = calculatePrice({ distanceKm: 100, weightTons: 5 });
    const withLoading = calculatePrice({ distanceKm: 100, weightTons: 5, loading: true });
    assertEqual(withLoading.total, withoutLoading.total + RATES.loading);
  });

  test('не опускается ниже минимальной стоимости рейса', () => {
    const result = calculatePrice({ distanceKm: 1, weightTons: 0.1 });
    assertEqual(result.total, RATES.minimum);
  });

  test('разбивка в сумме даёт итог', () => {
    const result = calculatePrice({ distanceKm: 350, weightTons: 18, cargo: 'fragile', loading: true });
    const sum = result.breakdown.reduce((acc, row) => acc + row.value, 0);
    // Допускаем расхождение в 1 BYN из-за независиного округления строк.
    assertTrue(Math.abs(sum - result.total) <= 1, `разбивка ${sum} ≠ итог ${result.total}`);
  });
});

describe('Расчёт стоимости: защита от некорректных данных', () => {
  test('отклоняет отрицательное расстояние', () => {
    assertThrows(() => calculatePrice({ distanceKm: -100, weightTons: 5 }));
  });

  test('отклоняет отрицательный вес', () => {
    assertThrows(() => calculatePrice({ distanceKm: 100, weightTons: -5 }));
  });

  test('отклоняет нулевое расстояние', () => {
    assertThrows(() => calculatePrice({ distanceKm: 0, weightTons: 5 }));
  });

  test('отклоняет вес выше предела', () => {
    assertThrows(() => calculatePrice({ distanceKm: 100, weightTons: LIMITS.maxWeightT + 1 }));
  });

  test('отклоняет нечисловые значения', () => {
    assertThrows(() => calculatePrice({ distanceKm: 'сто', weightTons: 5 }));
    assertThrows(() => calculatePrice({ distanceKm: 100, weightTons: null }));
  });
});

describe('Подбор подвижного состава', () => {
  test('закрывает разрыв между 5 и 20 тоннами', () => {
    // Раньше груз 6 т считался как 20-тонная еврофура.
    const sixTons = vehicleForWeight(6);
    assertTrue(!/20 т|40 т/.test(sixTons.vehicle), `6 т не должен быть фурой, получено: ${sixTons.vehicle}`);
  });

  test('возвращает минимальную ступень для малого груза', () => {
    assertEqual(vehicleForWeight(0.5).vehicle, WEIGHT_TIERS[0].vehicle);
  });

  test('возвращает максимальную ступень для перегруза', () => {
    assertEqual(vehicleForWeight(40).vehicle, WEIGHT_TIERS[WEIGHT_TIERS.length - 1].vehicle);
  });
});

describe('Parity: Worker и общий модуль считают одинаково', () => {
  const cases = [];
  for (const distanceKm of [5, 47, 100, 335, 645, 1200, 2499]) {
    for (const weightTons of [0.5, 1, 2.5, 5, 6, 10, 18, 20, 40]) {
      for (const cargo of ['standard', 'fragile', 'temperature']) {
        for (const loading of [false, true]) {
          cases.push({ distanceKm, weightTons, cargo, loading });
        }
      }
    }
  }

  test(`совпадает на ${cases.length} комбинациях`, () => {
    for (const input of cases) {
      const shared = calculatePrice(input);
      const inline = worker.calculatePrice(input);
      assertEqual(inline.total, shared.total, `Расхождение итога для ${JSON.stringify(input)}`);
      assertEqual(inline.vehicle, shared.vehicle, `Расхождение ТС для ${JSON.stringify(input)}`);
      assertEqual(inline.breakdown, shared.breakdown, `Расхождение разбивки для ${JSON.stringify(input)}`);
    }
  });

  test('тарифы и ступени совпадают', () => {
    assertEqual(worker.RATES, RATES);
    assertEqual(worker.WEIGHT_TIERS, WEIGHT_TIERS);
    assertEqual(worker.PRICE_LIMITS, LIMITS);
  });
});
