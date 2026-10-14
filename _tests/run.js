/**
 * Точка входа тестов: node _tests/run.js
 * Внешних зависимостей нет — только стандартная библиотека Node.
 *
 * Тесты группируются по файлам и запускаются в дочерних процессах:
 * так один зависший тест не блокирует отчёт и не оставляет процесс висеть.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  'pricing.test.js',
  'client-pricing.test.js',
  'validation.test.js',
  'security.test.js',
  'store.test.js',
  'statuses.test.js',
  'qr.test.js',
  'sessions.test.js'
];

if (process.argv.includes('--single')) {
  // Режим одного файла: выполняем тесты, печатаем отчёт и явно завершаемся.
  const { run, finish } = await import('./harness.js');
  const target = process.argv[process.argv.indexOf('--single') + 1];
  await import(`./${target}`);
  finish(await run());
} else {
  let failedFiles = 0;
  for (const file of files) {
    process.stdout.write(`\n── ${file} `);
    const result = spawnSync(process.execPath, [path.join(here, 'run.js'), '--single', file], {
      stdio: 'inherit',
      timeout: 120000
    });
    if (result.status !== 0) failedFiles += 1;
  }
  process.stdout.write('\n');
  if (failedFiles) {
    console.error(`Файлов с ошибками: ${failedFiles} из ${files.length}`);
    process.exitCode = 1;
  } else {
    console.log(`Все наборы тестов пройдены (${files.length}) ✅`);
  }
}
