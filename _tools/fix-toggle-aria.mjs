/**
 * Разовая утилита: aria-pressed для кнопок-переключателей
 * (темы обращения, канал связи, роль партнёра, чипы автопарка).
 *
 * Скринридер не сообщал, какая кнопка выбрана: состояние хранилось только
 * в CSS-классе .is-active. Теперь состояние дублируется в aria-pressed
 * и обновляется в тех же обработчиках.
 *
 * Запуск: node _tools/fix-toggle-aria.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = [];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function write(relative, content) {
  fs.writeFileSync(path.join(root, relative), content, 'utf8');
  log.push(`обновлён ${relative}`);
}

/** Заменяет ровно expected вхождений; если их 0 — значит правка уже применена. */
function replaceExact(content, from, to, expected, label) {
  const occurrences = content.split(from).length - 1;
  if (occurrences === 0) {
    log.push(`пропущено (уже применено): ${label}`);
    return content;
  }
  if (occurrences !== expected) {
    throw new Error(`${label}: ожидалось ${expected} вхождений, найдено ${occurrences}`);
  }
  return content.split(from).join(to);
}

/* ---------- Разметка ---------- */

let contacts = read('contacts.html');
contacts = replaceExact(
  contacts,
  '<button type="button" class="contact-topic-chip is-active" data-topic=',
  '<button type="button" class="contact-topic-chip is-active" aria-pressed="true" data-topic=',
  1,
  'contacts: активная тема'
);
contacts = replaceExact(
  contacts,
  '<button type="button" class="contact-topic-chip" data-topic=',
  '<button type="button" class="contact-topic-chip" aria-pressed="false" data-topic=',
  3,
  'contacts: неактивные темы'
);
contacts = replaceExact(
  contacts,
  '<button type="button" class="channel-chip is-active" data-channel=',
  '<button type="button" class="channel-chip is-active" aria-pressed="true" data-channel=',
  1,
  'contacts: активный канал'
);
contacts = replaceExact(
  contacts,
  '<button type="button" class="channel-chip" data-channel=',
  '<button type="button" class="channel-chip" aria-pressed="false" data-channel=',
  2,
  'contacts: неактивные каналы'
);
write('contacts.html', contacts);

let partners = read('partners.html');
partners = replaceExact(
  partners,
  '<button type="button" class="partner-role-tab is-active" data-role=',
  '<button type="button" class="partner-role-tab is-active" aria-pressed="true" data-role=',
  1,
  'partners: активная роль'
);
partners = replaceExact(
  partners,
  '<button type="button" class="partner-role-tab" data-role=',
  '<button type="button" class="partner-role-tab" aria-pressed="false" data-role=',
  2,
  'partners: неактивные роли'
);
partners = replaceExact(
  partners,
  '<button type="button" class="partner-fleet-chip" data-fleet=',
  '<button type="button" class="partner-fleet-chip" aria-pressed="false" data-fleet=',
  13,
  'partners: чипы автопарка'
);
write('partners.html', partners);

/* ---------- Обработчики ---------- */

let site = read('assets/site.js');

site = replaceExact(
  site,
  `    parent.querySelectorAll('.contact-topic-chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');`,
  `    parent.querySelectorAll('.contact-topic-chip').forEach((c) => {
      c.classList.remove('is-active');
      c.setAttribute('aria-pressed', 'false');
    });
    chip.classList.add('is-active');
    chip.setAttribute('aria-pressed', 'true');`,
  1,
  'site.js: тема обращения'
);

site = replaceExact(
  site,
  `    parent.querySelectorAll('.channel-chip').forEach(c => c.classList.remove('is-active'));
    chip.classList.add('is-active');`,
  `    parent.querySelectorAll('.channel-chip').forEach((c) => {
      c.classList.remove('is-active');
      c.setAttribute('aria-pressed', 'false');
    });
    chip.classList.add('is-active');
    chip.setAttribute('aria-pressed', 'true');`,
  1,
  'site.js: канал связи'
);

write('assets/site.js', site);

console.log(log.join('\n'));
