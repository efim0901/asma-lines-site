/**
 * Разовая утилита: сокращение title/description до рекомендуемой длины.
 *
 * Google показывает примерно 60 символов заголовка и 155 символов описания;
 * всё, что длиннее, обрезается многоточием и теряет смысл. Здесь пять
 * страниц выходили за лимит (до 86 и 213 символов).
 *
 * Запуск: node _tools/shorten-seo.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const revisions = {
  'services.html': {
    title: 'Грузоперевозки по Беларуси: тент, реф, бус, LTL | ASMA Lines',
    description:
      'Услуги автоперевозок по Беларуси: тент 20 т, рефрижератор, экспресс-бусы и сборные грузы LTL. Договор с НДС, подача от 2 часов.'
  },
  'calculator.html': {
    title: 'Калькулятор грузоперевозок по Беларуси | ASMA Lines',
    description:
      'Онлайн-калькулятор стоимости перевозки по Беларуси: расстояние, время в пути и тариф за 15 секунд. Тент, реф, бус, догруз.'
  },
  'faq.html': {
    title: 'Вопросы и ответы о грузоперевозках по Беларуси | ASMA Lines',
    description:
      'Как формируется цена, сроки подачи от 2 часов, работа с НДС и юрлицами, документы ТТН/CMR, страхование груза — коротко и по делу.'
  },
  'partners.html': {
    title: 'Перевозчикам и экспедиторам: загрузки по Беларуси | ASMA Lines',
    description:
      'Приглашаем перевозчиков с автопарком: бусы, 5–10 т, еврофуры 20 т, рефы. Регулярные рейсы по Беларуси, быстрая оплата, прямые заявки.'
  },
  'about.html': {
    title: 'О компании ASMA Lines — логистический оператор Беларуси',
    description:
      'ASMA Lines — организация автомобильных грузоперевозок по Беларуси: своя диспетчерская, партнёрская сеть, фиксированные тарифы и договор с НДС.'
  },
  'contacts.html': {
    title: 'Контакты ASMA Lines — заказ грузоперевозки по Беларуси',
    description:
      'Диспетчерская ASMA Lines: +375 (29) 600-00-00, Telegram-бот, офис в Гомеле. Расчёт стоимости перевозки по Беларуси за 10–15 минут.'
  },
  'index.html': {
    title: 'Грузоперевозки по Беларуси от 1.10 BYN/км | ASMA Lines',
    description:
      'Организация автоперевозок по Беларуси: тент, рефрижератор, бус, сборные грузы. Подача от 2 часов, расчёт за 15 минут, договор с НДС.'
  }
};

const log = [];

for (const [page, revision] of Object.entries(revisions)) {
  const file = path.join(root, page);
  let content = fs.readFileSync(file, 'utf8');

  const beforeTitle = content.match(/<title>([\s\S]*?)<\/title>/);
  const beforeDesc = content.match(/<meta name="description" content="([^"]*)"/);

  content = content.replace(/<title>[\s\S]*?<\/title>/, `<title>${revision.title}</title>`);
  content = content.replace(
    /<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${revision.description}"`
  );

  fs.writeFileSync(file, content, 'utf8');

  log.push(
    `${page}\n  title: ${beforeTitle ? beforeTitle[1].length : 0} → ${revision.title.length} символов` +
      `\n  description: ${beforeDesc ? beforeDesc[1].length : 0} → ${revision.description.length} символов`
  );
}

console.log(log.join('\n'));

/* Контроль лимитов */
const problems = [];
for (const page of fs.readdirSync(root).filter((name) => name.endsWith('.html'))) {
  const content = fs.readFileSync(path.join(root, page), 'utf8');
  if (/noindex/.test(content)) continue; // служебные страницы не индексируются
  const title = content.match(/<title>([\s\S]*?)<\/title>/);
  const description = content.match(/<meta name="description" content="([^"]*)"/);
  if (title && title[1].length > 62) problems.push(`${page}: title ${title[1].length}`);
  if (description && description[1].length > 160) problems.push(`${page}: description ${description[1].length}`);
}
console.log(problems.length ? `\nВНЕ ЛИМИТОВ:\n  ${problems.join('\n  ')}` : '\nВсе title/description в пределах лимитов ✅');
