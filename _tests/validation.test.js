/**
 * Тесты валидации заявок.
 *
 * Ключевая проверка безопасности: цена, присланная клиентом, должна
 * игнорироваться — сервер считает её сам. Раньше `price` из тела запроса
 * сохранялся в CRM как есть, то есть клиент мог выставить любую сумму.
 */

import { describe, test, assertEqual, assertTrue, assertThrows } from './harness.js';
import { normalizeLead, parseRouteDetails, LEAD_LIMITS } from '../_shared/validation.js';
import { normalizeBelarusPhone } from '../_shared/core.js';
import { __testables as worker } from '../_worker.js';

const baseLead = {
  name: 'Иван Петров',
  phone: '+375291234567',
  fromCity: 'Минск',
  toCity: 'Брест',
  distance: 350,
  weight: 18,
  source: 'website_calculator'
};

describe('Валидация телефона', () => {
  test('принимает белорусские форматы', () => {
    assertEqual(normalizeBelarusPhone('+375291234567'), '+375291234567');
    assertEqual(normalizeBelarusPhone('80291234567'), '+375291234567');
    assertEqual(normalizeBelarusPhone('+375 (29) 123-45-67'), '+375291234567');
    assertEqual(normalizeBelarusPhone('291234567'), '+375291234567');
  });

  test('отклоняет мусор и чужие коды', () => {
    assertEqual(normalizeBelarusPhone('abc'), null);
    assertEqual(normalizeBelarusPhone('+79001234567'), null);
    assertEqual(normalizeBelarusPhone('12345'), null);
    assertEqual(normalizeBelarusPhone(''), null);
    assertEqual(normalizeBelarusPhone(null), null);
  });
});

describe('Нормализация заявки', () => {
  test('принимает корректную заявку', () => {
    const lead = normalizeLead(baseLead);
    assertEqual(lead.name, 'Иван Петров');
    assertEqual(lead.contact, '+375291234567');
    assertEqual(lead.route, 'Минск → Брест');
    assertEqual(lead.distanceKm, 350);
    assertEqual(lead.weightTons, 18);
    assertTrue(lead.priceValue > 0, 'цена должна быть посчитана');
  });

  test('ИГНОРИРУЕТ цену, присланную клиентом', () => {
    const honest = normalizeLead(baseLead);
    const tampered = normalizeLead({ ...baseLead, price: 1, priceValue: 1 });
    assertEqual(tampered.priceValue, honest.priceValue, 'клиент не должен влиять на цену');
    assertEqual(tampered.price, honest.price);
  });

  test('игнорирует попытку подменить служебные поля', () => {
    const lead = normalizeLead({ ...baseLead, status: 'completed', leadNumber: '1', id: 'hacked' });
    assertEqual(lead.status, undefined, 'статус задаёт сервер, а не клиент');
    assertEqual(lead.leadNumber, undefined);
    assertEqual(lead.id, undefined);
  });

  test('требует имя и телефон', () => {
    assertThrows(() => normalizeLead({ ...baseLead, name: '' }));
    assertThrows(() => normalizeLead({ ...baseLead, name: 'A' }));
    assertThrows(() => normalizeLead({ ...baseLead, phone: '', contact: '' }));
    assertThrows(() => normalizeLead({ ...baseLead, phone: 'не телефон' }));
  });

  test('обрезает слишком длинные поля', () => {
    const lead = normalizeLead({ ...baseLead, comment: 'x'.repeat(5000) });
    assertTrue(lead.comment.length <= LEAD_LIMITS.commentMax, 'комментарий должен быть обрезан');
  });

  test('проверяет e-mail, если он передан', () => {
    assertThrows(() => normalizeLead({ ...baseLead, email: 'не-почта' }));
    const lead = normalizeLead({ ...baseLead, email: 'client@example.by' });
    assertEqual(lead.email, 'client@example.by');
  });

  test('принимает Telegram-ник только в режиме CRM', () => {
    assertThrows(() => normalizeLead({ ...baseLead, phone: '', contact: '@dispatcher' }));
    const lead = normalizeLead({ ...baseLead, phone: '', contact: '@dispatcher' }, { allowTelegramHandle: true });
    assertEqual(lead.contact, '@dispatcher');
  });

  test('распознаёт партнёрскую заявку', () => {
    const lead = normalizeLead({ name: 'ООО Ромашка', phone: '+375291234567', company: 'Ромашка', source: 'website_partners' });
    assertEqual(lead.type, 'partner');
    assertEqual(lead.isPartner, true);
  });

  test('не падает, если расстояние и вес не указаны', () => {
    const lead = normalizeLead({ name: 'Обратный звонок', phone: '+375291234567', comment: 'Перезвоните' });
    assertEqual(lead.priceValue, null);
    assertEqual(lead.route, 'Маршрут по запросу');
  });
});

describe('Разбор строки route_details', () => {
  test('понимает цену из 4 цифр', () => {
    // Прежняя регулярка `est\\s*(\\d+)` не справлялась с 1000+.
    const parsed = parseRouteDetails('Гомель -> Витебск, 335km, 10t, est 1200 BYN');
    assertEqual(parsed.distanceKm, 335);
    assertEqual(parsed.weightTons, 10);
    assertEqual(parsed.price, 1200);
    assertEqual(parsed.fromCity, 'Гомель');
    assertEqual(parsed.toCity, 'Витебск');
  });

  test('понимает пробел как разделитель разрядов', () => {
    assertEqual(parseRouteDetails('Минск - Брест, 350km, 18t, est 1 200 BYN').price, 1200);
  });

  test('возвращает пустые значения для мусора', () => {
    const parsed = parseRouteDetails('');
    assertEqual(parsed.distanceKm, null);
    assertEqual(parsed.price, null);
  });
});

describe('Parity: Worker и общий модуль валидируют одинаково', () => {
  const cases = [
    baseLead,
    { ...baseLead, price: 1 },
    { ...baseLead, name: 'A' },
    { ...baseLead, phone: 'bad' },
    { ...baseLead, email: 'bad' },
    { ...baseLead, comment: 'x'.repeat(3000) },
    { ...baseLead, distance: 5000, weight: 100 },
    { ...baseLead, phone: '', contact: '@dispatcher' },
    { name: 'Партнёр', phone: '+375291234567', company: 'ООО', source: 'website_partners' },
    { name: 'Обратный звонок', phone: '+375291234567' },
    { name: 'Иван', phone: '+375291234567', route_details: 'Гомель -> Витебск, 335km, 10t, est 1200 BYN' }
  ];

  test('одинаковый результат или одинаковая ошибка на всех кейсах', () => {
    for (const input of cases) {
      for (const options of [{}, { allowTelegramHandle: true }]) {
        let sharedResult = null;
        let sharedError = null;
        try {
          sharedResult = normalizeLead(input, options);
        } catch (error) {
          sharedError = error.message;
        }

        let inlineResult = null;
        let inlineError = null;
        try {
          inlineResult = worker.normalizeLead(input, options);
        } catch (error) {
          inlineError = error.message;
        }

        const label = `${JSON.stringify(input).slice(0, 80)} / ${JSON.stringify(options)}`;
        assertEqual(inlineError, sharedError, `Расхождение ошибки для ${label}`);
        if (sharedResult) {
          assertEqual(inlineResult.priceValue, sharedResult.priceValue, `Расхождение цены для ${label}`);
          assertEqual(inlineResult.contact, sharedResult.contact, `Расхождение контакта для ${label}`);
          assertEqual(inlineResult.route, sharedResult.route, `Расхождение маршрута для ${label}`);
          assertEqual(inlineResult.type, sharedResult.type, `Расхождение типа для ${label}`);
        }
      }
    }
  });

  test('лимиты полей совпадают', () => {
    assertEqual(worker.LEAD_LIMITS, LEAD_LIMITS);
    assertEqual(worker.LEAD_STATUSES.join(','), 'new,processing,transit,completed,cancelled');
  });
});
