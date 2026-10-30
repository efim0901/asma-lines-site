/**
 * Минимальный раннер тестов без внешних зависимостей.
 * Запуск: node _tests/run.js
 */

const registered = [];
let currentFile = '';

export function describe(name, fn) {
  currentFile = name;
  fn();
  currentFile = '';
}

export function test(name, fn) {
  registered.push({ file: currentFile, name, fn });
}

export function assertEqual(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${message}\n  ожидалось: ${b}\n  получено:  ${a}`);
  }
}

export function assertTrue(value, message = 'Ожидалось истинное значение') {
  if (!value) throw new Error(message);
}

export function assertFalse(value, message = 'Ожидалось ложное значение') {
  if (value) throw new Error(message);
}

export function assertThrows(fn, message = 'Ожидалось исключение') {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

export async function assertRejects(fn, message = 'Ожидалось отклонение промиса') {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

/** Запускает все зарегистрированные тесты и печатает отчёт. */
export async function run() {
  let passed = 0;
  const failures = [];

  for (const item of registered) {
    try {
      await item.fn();
      passed += 1;
      process.stdout.write('.');
    } catch (error) {
      failures.push({ ...item, error });
      process.stdout.write('F');
    }
  }

  process.stdout.write('\n\n');
  for (const failure of failures) {
    console.error(`✖ ${failure.file} → ${failure.name}`);
    console.error(`  ${String(failure.error.message).split('\n').join('\n  ')}\n`);
  }

  console.log(`Пройдено: ${passed} из ${registered.length}`);
  if (failures.length) {
    console.error(`Провалено: ${failures.length}`);
    process.exitCode = 1;
  } else {
    console.log('Все тесты пройдены ✅');
  }
  return failures.length === 0;
}

/** Явно завершает процесс: не даём открытым хендлам держать event loop. */
export function finish(ok) {
  process.exit(ok ? 0 : 1);
}
