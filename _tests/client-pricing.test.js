/**
 * Тесты клиентского модуля тарифов (assets/pricing-client.js).
 *
 * Модуль написан как обычный браузерный скрипт, поэтому подставляем
 * минимальный объект window и проверяем, что расчёт совпадает с серверным.
 * Иначе клиент показывал бы одну цену, а диспетчер видел другую.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, assertEqual, assertTrue } from './harness.js';
import { calculatePrice as serverCalculatePrice, RATES } from '../_shared/pricing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'assets', 'pricing-client.js'), 'utf8');

const sandbox = {};
// eslint-disable-next-line no-new-func
new Function('window', `${source}\nreturn window;`)(sandbox);
const client = sandbox.ASMA_PRICING;

describe('Клиентский модуль тарифов', () => {
  test('публикует ожидаемые функции', () => {
    assertTrue(typeof client?.calculatePrice === 'function', 'нет calculatePrice');
    assertTrue(typeof client?.vehicleForWeight === 'function', 'нет vehicleForWeight');
    assertTrue(typeof client?.haversineKm === 'function', 'нет haversineKm');
  });

  test('тарифы совпадают с серверными', () => {
    assertEqual(client.RATES, RATES);
  });

  test('возвращает null на некорректных данных вместо исключения', () => {
    assertEqual(client.calculatePrice({ distanceKm: -10, weightTons: 5 }), null);
    assertEqual(client.calculatePrice({ distanceKm: 100, weightTons: 0 }), null);
    assertEqual(client.calculatePrice({ distanceKm: 'нет', weightTons: 5 }), null);
  });

  test('расчёт полностью совпадает с серверным', () => {
    const cases = [];
    for (const distanceKm of [1, 5, 47, 100, 335, 645, 1200, 2500]) {
      for (const weightTons of [0.1, 0.5, 2.5, 6, 10, 18, 22]) {
        for (const cargo of ['standard', 'fragile', 'temperature']) {
          for (const loading of [false, true]) {
            cases.push({ distanceKm, weightTons, cargo, loading });
          }
        }
      }
    }
    for (const input of cases) {
      const fromClient = client.calculatePrice(input);
      const fromServer = serverCalculatePrice(input);
      assertEqual(fromClient.total, fromServer.total, `Расхождение цены для ${JSON.stringify(input)}`);
      assertEqual(fromClient.vehicle, fromServer.vehicle, `Расхождение ТС для ${JSON.stringify(input)}`);
    }
  });

  test('подбор ТС закрывает диапазон 6–22 т', () => {
    for (const weight of [6, 8, 10, 15, 20, 22]) {
      const tier = client.vehicleForWeight(weight);
      assertTrue(Boolean(tier?.vehicle), `нет ТС для ${weight} т`);
    }
  });

  test('haversine считает известное расстояние', () => {
    // Минск → Брест по прямой ≈ 320 км.
    const km = client.haversineKm([53.9, 27.5667], [52.0976, 23.7341]);
    assertTrue(km > 290 && km < 350, `неправдоподобное расстояние: ${km}`);
  });
});
