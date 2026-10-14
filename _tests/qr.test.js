/**
 * Тесты генератора QR-кодов для входа в диспетчерскую.
 *
 * Главная проверка — эталонная матрица: она сгенерирована независимой
 * реализацией (ReportLab qrencoder, byte mode, уровень коррекции M).
 * Если сломается кодирование данных, блоки ECC или раскладка модулей,
 * матрица перестанет совпадать, и тест это поймает.
 */

import { describe, test, assertEqual, assertTrue, assertThrows } from './harness.js';
import { qrMatrix, qrSvg, buildCodewords, pickVersion } from '../_shared/qr.js';

/** Эталон: https://t.me/asmalinesbot?start=login_482173, версия 4, маска 2. */
const REFERENCE_URL = 'https://t.me/asmalinesbot?start=login_482173';
const REFERENCE_ROWS = [
  '111111100111011011011001001111111',
  '100000100110011111001010001000001',
  '101110101110010101101001001011101',
  '101110101001101110001111101011101',
  '101110101011100100100100101011101',
  '100000101000010111101100001000001',
  '111111101010101010101010101111111',
  '000000001000000100000111100000000',
  '101111100011111101000010101111100',
  '111010001001001010111111101101101',
  '110111111001000100100100010010110',
  '111101001001101110011110000011100',
  '001011111101000100110100000011011',
  '001101010010001110001111111101011',
  '001001111100101001110000011011010',
  '101010001001001010111111011011100',
  '001001100001111011010010110110001',
  '010101011100010011111001011101101',
  '001010100110100111001010001110110',
  '100111011001011001100000000111110',
  '001101111000010110011111000001011',
  '111100000110110101100001111001101',
  '100001100100110111001110010111010',
  '100011010101101100000110100011100',
  '101101101110001111000010111110011',
  '000000001010101010011100100010111',
  '111111100011000110100101101010100',
  '100000101010011010001111100011100',
  '101110101010100000110100111111010',
  '101110101111000110001110000010001',
  '101110101101111000010101001101100',
  '100000100011110010111111000011100',
  '111111101001011011110010101100010'
];

const text = (matrix) => matrix.map(row => row.map(cell => (cell ? '1' : '0')).join(''));

describe('QR: эталонная матрица', () => {
  test('ссылка входа совпадает с независимой реализацией', () => {
    const result = qrMatrix(REFERENCE_URL);
    assertEqual(result.version, 4, 'Ожидалась версия 4');
    assertEqual(result.size, 33);
    assertEqual(text(result.matrix), REFERENCE_ROWS);
  });

  test('каждая маска даёт корректную раскладку (совпадает хоть одна)', () => {
    const matches = [];
    for (let mask = 0; mask < 8; mask += 1) {
      const candidate = text(qrMatrix(REFERENCE_URL, { mask }).matrix);
      if (JSON.stringify(candidate) === JSON.stringify(REFERENCE_ROWS)) matches.push(mask);
    }
    // Эталонная матрица должна воспроизводиться при явном указании маски:
    // так проверяется и раскладка данных, и служебные узоры, и поле формата.
    assertTrue(matches.length > 0, 'Ни одна из восьми масок не совпала с эталоном');
  });
});

describe('QR: кодирование данных', () => {
  test('кодовые слова совпадают с эталоном (byte mode, версия 1)', () => {
    // 'A' в byte mode: режим 0100, длина 00000001, байт 01000001, терминатор
    // и добивка 0xEC/0x11, затем 10 кодовых слов коррекции.
    const bytes = Array.from(new TextEncoder().encode('A'));
    assertEqual(buildCodewords(bytes, 1), [
      64, 20, 16, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17, 236,
      107, 112, 244, 24, 163, 122, 17, 95, 52, 252
    ]);
  });

  test('кириллица кодируется в UTF-8', () => {
    // 6 кириллических символов — это 12 байт UTF-8, они помещаются в версию 1.
    const result = qrMatrix('Привет');
    assertEqual(result.version, 1);
    assertEqual(result.size, 21);
  });

  test('слишком длинная строка отклоняется', () => {
    assertThrows(() => qrMatrix('x'.repeat(200)), 'Ожидалась ошибка о слишком длинной строке');
  });
});

describe('QR: выбор версии', () => {
  test('версия растёт вместе с длиной ссылки', () => {
    const version = (length) => pickVersion(Array.from(new TextEncoder().encode('a'.repeat(length))));
    assertEqual(version(10), 1);
    assertEqual(version(20), 2);
    assertEqual(version(30), 3);
    assertEqual(version(60), 4);
    assertEqual(version(100), 6);
  });

  test('служебные узоры на месте при любой маске', () => {
    for (let mask = 0; mask < 8; mask += 1) {
      const { matrix, size, isFunction } = qrMatrix(REFERENCE_URL, { mask });
      // Угловые метки: три квадрата 7×7.
      assertEqual(matrix[0].slice(0, 7).filter(Boolean).length, 7, `Маска ${mask}: метка сверху слева`);
      assertEqual(matrix[size - 1].slice(0, 7).filter(Boolean).length, 7, `Маска ${mask}: метка снизу слева`);
      assertEqual(matrix[0].slice(size - 7).filter(Boolean).length, 7, `Маска ${mask}: метка сверху справа`);
      // Тёмный модуль всегда тёмный, синхронизирующие полосы чередуются.
      assertTrue(matrix[size - 8][8] === true, `Маска ${mask}: тёмный модуль`);
      assertTrue(matrix[6][8] === true && matrix[6][9] === false, `Маска ${mask}: горизонтальная полоса`);
      assertTrue(matrix[8][6] === true && matrix[9][6] === false, `Маска ${mask}: вертикальная полоса`);
      assertTrue(isFunction[size - 8][8] === true, `Маска ${mask}: тёмный модуль помечен служебным`);
    }
  });
});

describe('QR: SVG', () => {
  test('рисует модули и содержит метку доступности', () => {
    const svg = qrSvg(REFERENCE_URL, { scale: 4, margin: 2 });
    const dark = REFERENCE_ROWS.join('').split('').filter(char => char === '1').length;
    assertTrue(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'Ожидался SVG');
    assertEqual((svg.match(/M\d+/g) || []).length, dark, 'Число тёмных модулей не совпало');
    assertTrue(svg.includes('role="img"') && svg.includes('aria-label'), 'Нет роли и подписи для скринридера');
    assertTrue(/width="\d+" height="\d+"/.test(svg), 'Не заданы размеры');
  });
});
