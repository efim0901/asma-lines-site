/**
 * ASMA Lines — генератор QR-кодов для экрана входа в диспетчерскую.
 *
 * Зачем свой: QR рисуется на сервере как SVG (ссылка `t.me/...?start=login_...`
 * меняется при каждом входе), а подключать внешний сервис нельзя — CSP
 * разрешает только собственные скрипты, да и отдавать ссылку входа
 * на чужой сервер нельзя.
 *
 * Реализация: byte mode, уровень коррекции M, версии 1–6 (до 108 байт —
 * ссылки входа короче). Таблицы блоков и позиции выравнивающих узоров
 * сверены с независимой реализацией (ReportLab qrencoder): тест
 * `_tests/qr.test.js` сравнивает матрицы модуль за модулем.
 */

/* Поле Галуа GF(256) с порождающим полиномом 0x11D — арифметика для ECC. */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMultiply(a, b) {
  if (!a || !b) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Блоки RS для уровня M: версия → [[блоков, всего кодовых слов, данных], ...]. */
const RS_BLOCKS_M = {
  1: [[1, 26, 16]],
  2: [[1, 44, 28]],
  3: [[1, 70, 44]],
  4: [[2, 50, 32]],
  5: [[2, 67, 43]],
  6: [[4, 43, 27]]
};

/** Центры выравнивающих узоров (для версий 1–6 — два значения). */
const ALIGNMENT_POSITIONS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34]
};

/** Порождающий полином для нужного числа кодовых слов коррекции. */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let a = 0; a < poly.length; a += 1) {
      next[a] ^= gfMultiply(poly[a], 1);
      next[a + 1] ^= gfMultiply(poly[a], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Остаток от деления данных на порождающий полином — кодовые слова ECC. */
function rsRemainder(data, ecCount) {
  const generator = rsGenerator(ecCount);
  const remainder = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor) {
      for (let i = 0; i < ecCount; i += 1) {
        remainder[i] ^= gfMultiply(generator[i + 1], factor);
      }
    }
  }
  return remainder;
}

function totalDataCodewords(version) {
  return RS_BLOCKS_M[version].reduce((sum, [count, , data]) => sum + count * data, 0);
}

/** Байты → кодовые слова с коррекцией, уже перемешанные по блокам. */
export function buildCodewords(bytes, version) {
  const blocks = RS_BLOCKS_M[version];
  const capacity = totalDataCodewords(version);
  if (bytes.length + 2 > capacity) {
    throw new Error('Слишком длинная строка для QR-кода');
  }

  const bits = [];
  const pushBits = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  pushBits(0b0100, 4); // byte mode
  pushBits(bytes.length, 8); // для версий 1–9 длина — 8 бит
  for (const byte of bytes) pushBits(byte, 8);

  const capacityBits = capacity * 8;
  // Терминатор: 4 нулевых бита, если они ещё помещаются (как в спецификации).
  if (bits.length + 4 <= capacityBits) pushBits(0, 4);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  const pads = [0xec, 0x11];
  const firstPad = data.length;
  while (data.length < capacity) data.push(pads[(data.length - firstPad) % 2]);

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, total, size] of blocks) {
    const ecCount = total - size;
    for (let i = 0; i < count; i += 1) {
      const chunk = data.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(chunk);
      ecBlocks.push(rsRemainder(chunk, ecCount));
    }
  }

  const result = [];
  const maxData = Math.max(...dataBlocks.map(block => block.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  const maxEc = Math.max(...ecBlocks.map(block => block.length));
  for (let i = 0; i < maxEc; i += 1) {
    for (const block of ecBlocks) if (i < block.length) result.push(block[i]);
  }
  return result;
}

export function pickVersion(bytes) {
  for (const version of Object.keys(RS_BLOCKS_M).map(Number)) {
    const overhead = 2; // режим (4 бита) + длина (8 бит) — примерно одно кодовое слово
    if (bytes.length + overhead <= totalDataCodewords(version)) return version;
  }
  throw new Error('Слишком длинная строка для QR-кода');
}

/** Маска: правило из спецификации, применимое к модулю (i — строка, j — столбец). */
function maskApplies(mask, i, j) {
  switch (mask) {
    case 0: return (i + j) % 2 === 0;
    case 1: return i % 2 === 0;
    case 2: return j % 3 === 0;
    case 3: return (i + j) % 3 === 0;
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
    default: return false;
  }
}

function bchTypeInfo(data) {
  const g15 = 0b10100110111;
  const g15Mask = 0b101010000010010;
  let d = data << 10;
  const digit = (value) => {
    let count = 0;
    let rest = value;
    while (rest) {
      count += 1;
      rest >>= 1;
    }
    return count;
  };
  while (digit(d) - digit(g15) >= 0) d ^= g15 << (digit(d) - digit(g15));
  return ((data << 10) | d) ^ g15Mask;
}

/** Пустая матрица: null — модуль ещё не занят. */
function createMatrix(version) {
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  return { size, matrix, isFunction };
}

function setupFinder({ matrix, isFunction, size }, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    if (row + r < 0 || row + r >= size) continue;
    for (let c = -1; c <= 7; c += 1) {
      if (col + c < 0 || col + c >= size) continue;
      const dark =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      matrix[row + r][col + c] = dark;
      isFunction[row + r][col + c] = true;
    }
  }
}

function setupFunctionPatterns(context, version) {
  const { matrix, isFunction, size } = context;
  setupFinder(context, 0, 0);
  setupFinder(context, size - 7, 0);
  setupFinder(context, 0, size - 7);

  // Синхронизирующие полосы: чередование по строкам 6 и столбцам 6.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    if (!isFunction[6][i]) {
      matrix[6][i] = dark;
      isFunction[6][i] = true;
    }
    if (!isFunction[i][6]) {
      matrix[i][6] = dark;
      isFunction[i][6] = true;
    }
  }

  const positions = ALIGNMENT_POSITIONS[version] || [];
  for (const row of positions) {
    for (const col of positions) {
      if (isFunction[row][col]) continue; // не перекрываем угловые метки
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          matrix[row + r][col + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          isFunction[row + r][col + c] = true;
        }
      }
    }
  }

  // Служебные поля формата и тёмный модуль — заполняются позже, но место резервируем.
  for (let i = 0; i < 9; i += 1) {
    if (!isFunction[8][i]) { matrix[8][i] = false; isFunction[8][i] = true; }
    if (!isFunction[i][8]) { matrix[i][8] = false; isFunction[i][8] = true; }
  }
  for (let i = 0; i < 8; i += 1) {
    if (!isFunction[8][size - 1 - i]) { matrix[8][size - 1 - i] = false; isFunction[8][size - 1 - i] = true; }
    if (!isFunction[size - 1 - i][8]) { matrix[size - 1 - i][8] = false; isFunction[size - 1 - i][8] = true; }
  }
  matrix[size - 8][8] = true;
  isFunction[size - 8][8] = true;
}

function applyTypeInfo({ matrix, isFunction, size }, mask) {
  const bits = bchTypeInfo((0b00 << 3) | mask); // 0b00 — уровень коррекции M
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) === 1;
    if (i < 6) matrix[i][8] = dark;
    else if (i < 8) matrix[i + 1][8] = dark;
    else matrix[size - 15 + i][8] = dark;
    if (i < 8) matrix[8][size - i - 1] = dark;
    else if (i < 9) matrix[8][15 - i - 1 + 1] = dark;
    else matrix[8][15 - i - 1] = dark;
  }
  matrix[size - 8][8] = true;
  isFunction[size - 8][8] = true;
}

function mapData(context, codewords, mask) {
  const { matrix, size } = context;
  let inc = -1;
  let row = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c += 1) {
        if (matrix[row][col - c] !== null) continue;
        let dark = false;
        if (byteIndex < codewords.length) {
          dark = ((codewords[byteIndex] >> bitIndex) & 1) === 1;
        }
        if (maskApplies(mask, row, col - c)) dark = !dark;
        matrix[row][col - c] = dark;
        bitIndex -= 1;
        if (bitIndex === -1) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += inc;
      if (row < 0 || row >= size) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
}

/** Штрафы из спецификации: чем меньше, тем лучше маска читается сканером. */
function maskPenalty(matrix, size) {
  let score = 0;

  const runScore = (get) => {
    let run = 1;
    for (let i = 1; i < size; i += 1) {
      if (get(i) === get(i - 1)) {
        run += 1;
      } else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  };
  for (let i = 0; i < size; i += 1) {
    runScore((j) => matrix[i][j]);
    runScore((j) => matrix[j][i]);
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = matrix[row][col];
      if (
        matrix[row][col + 1] === value &&
        matrix[row + 1][col] === value &&
        matrix[row + 1][col + 1] === value
      ) {
        score += 3;
      }
    }
  }

  const pattern = [true, false, true, true, true, false, true, false, false, false, false];
  const mirrored = [...pattern].reverse();
  const matches = (get, start) =>
    pattern.every((value, offset) => get(start + offset) === value) ||
    mirrored.every((value, offset) => get(start + offset) === value);
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + pattern.length <= size; j += 1) {
      if (matches((k) => matrix[i][k], j)) score += 40;
      if (matches((k) => matrix[k][i], j)) score += 40;
    }
  }

  let darkCount = 0;
  for (const row of matrix) for (const cell of row) if (cell) darkCount += 1;
  score += 10 * Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5);

  return score;
}

/**
 * Матрица QR-кода.
 *
 * @param {string} text — строка (кодируется в UTF-8)
 * @param {{ version?: number, mask?: number }} options — принудительная версия
 *        или маска; нужны тестам, в рабочем коде не используются.
 * @returns {{ size: number, version: number, mask: number, matrix: boolean[][] }}
 */
export function qrMatrix(text, options = {}) {
  const bytes = Array.from(new TextEncoder().encode(String(text ?? '')));
  const version = options.version || pickVersion(bytes);
  if (!RS_BLOCKS_M[version]) throw new Error(`QR версии ${version} не поддерживается`);

  const base = createMatrix(version);
  setupFunctionPatterns(base, version);
  const codewords = buildCodewords(bytes, version);

  const candidates = [];
  const masks = Number.isInteger(options.mask) ? [options.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const mask of masks) {
    const context = {
      size: base.size,
      matrix: base.matrix.map(row => [...row]),
      isFunction: base.isFunction
    };
    mapData(context, codewords, mask);
    applyTypeInfo(context, mask);
    candidates.push({ mask, matrix: context.matrix, penalty: maskPenalty(context.matrix, base.size) });
  }

  const best = candidates.reduce((winner, candidate) => (candidate.penalty < winner.penalty ? candidate : winner));
  return {
    size: best.matrix.length,
    version,
    mask: best.mask,
    matrix: best.matrix,
    penalty: best.penalty,
    // Карта служебных модулей — нужна тестам и диагностике.
    isFunction: base.isFunction
  };
}

/**
 * QR-код как SVG: одна картинка, вставляется в <img> и не требует скриптов
 * на клиенте.
 */
export function qrSvg(text, options = {}) {
  const scale = options.scale || 4;
  const margin = options.margin ?? 2;
  const dark = options.dark || '#1a1817';
  const light = options.light || '#ffffff';
  const { size, matrix } = qrMatrix(text, options);
  const side = (size + margin * 2) * scale;

  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!matrix[row][col]) continue;
      path += `M${(col + margin) * scale} ${(row + margin) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" ` +
    `viewBox="0 0 ${side} ${side}" role="img" aria-label="QR-код для входа в диспетчерскую">` +
    `<rect width="${side}" height="${side}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/></svg>`
  );
}
