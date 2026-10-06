# ASMA Lines — сайт и диспетчерская

Сайт логистической компании (автомобильные грузоперевозки по Беларуси)
и встроенная диспетчерская: заявки с сайта, документы по рейсу, доступ
через Telegram-бот.

| Что | Значение |
|---|---|
| Публичный адрес | <https://asma-lines-site.firws.workers.dev> |
| Тип развёртывания | Worker со статикой (не Pages) |
| Точка входа | `_worker.js` |
| Бизнес-логика | `_shared/` |
| Хранилище | Cloudflare D1, база `asma-lines`, биндинг `DB` |
| Репозиторий | <https://github.com/efim0901/asma-lines-site>, ветка `main` |

Домен `asmalines.by` не существует, DNS не отвечает — работаем на `workers.dev`.

## Как устроено

| Путь | Что внутри |
|---|---|
| `index.html`, `services.html`, `about.html`, `partners.html`, `calculator.html`, `contacts.html`, `faq.html`, `privacy.html` | страницы сайта |
| `crm.html` | диспетчерская (Telegram WebApp и браузерный вход) |
| `order-doc.html`, `proposal.html` | документы по заявке: договор-заявка, КП, маршрутное поручение |
| `assets/style.css`, `assets/*.js` | оформление и скрипты сайта |
| `assets/crm-next.css`, `assets/crm-next.js` | оформление и логика диспетчерской |
| `assets/img/` | иллюстрации-сцены: тёмная версия и `light/` для светлой темы |
| `_worker.js` | маршрутизация, API, заголовки безопасности, вебхук бота |
| `_shared/` | то, что общее для Worker и бота: заявки, доступы, сессии, расчёт цены, QR, геокодирование |
| `_tools/` | инструменты сопровождения, [описание](_tools/README.md) |
| `_prototypes/` | макеты диспетчерской, [описание](_prototypes/README.md) |
| `schema.sql` | схема базы D1 |
| `AGENTS.md` | шпаргалка для ИИ-агента: доступы, цикл правки, чего не делать |
| `PLAN.md` | разбор проекта с измерениями и статусом правок |
| `DEPLOY-CLOUDFLARE.md` | настройка Cloudflare, подъём с нуля, разбор частых проблем |

## Проверки

```bash
npm run check
```

Одна команда прогоняет: синтаксис JS → сцены иллюстраций → версии ассетов →
валидность разметки → чистоту адресов страниц → ESLint → 8 наборов тестов.
Код возврата должен быть `0`.

Отдельные шаги:

| Команда | Что проверяет |
|---|---|
| `npm run check:assets` | у каждого ассета `?v=` соответствует хешу содержимого |
| `npm run check:scenes` | блок сцен в `style.css` и `preload` совпадают с картинками |
| `npm run check:html` | разметка, отсутствие inline-обработчиков, битые ссылки |
| `npm run check:urls` | адреса страниц записаны без `.html` (Cloudflare их перенаправляет) |
| `npm test` | 8 наборов тестов бизнес-логики |

## Локальный просмотр

```bash
npm run dev          # http://localhost:3000 — тот же сайт и API на express
```

Это только для просмотра вёрстки. **Деплой локально не делаем**: правки
выкладываются прямо на Cloudflare. `server.js` в продакшн не публикуется
и в боевой маршрутизации не участвует — источник истины всегда `_worker.js`.

Отдельные страницы можно открыть и файлом, но тогда не будет работать то,
что требует сервера: карта, калькулятор, диспетчерская.

## Деплой и проверка

```powershell
$env:CLOUDFLARE_API_TOKEN  = (Get-Content "$env:USERPROFILE\.cf-token.txt" -Raw).Trim()
$env:CLOUDFLARE_ACCOUNT_ID = (Get-Content "$env:USERPROFILE\.cf-account.txt" -Raw).Trim()
npx wrangler deploy
```

После деплоя — обязательный минимум:

```powershell
$base = 'https://asma-lines-site.firws.workers.dev'
Invoke-RestMethod "$base/api/health" | Select-Object storage, writable, botTokenConfigured
foreach ($p in '/_tools/','/_shots/','/_worker.js','/server.js','/wrangler.toml','/schema.sql') {
  try { "ОТКРЫТО {0}" -f $p } catch { "{0} → {1}" -f $p, $_.Exception.Response.StatusCode.value__ }
}
```

Подробности и разбор частых проблем — в [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md).

## Правила, которые легко нарушить

- **Никаких inline-скриптов и `onclick`** — строгий CSP их блокирует,
  весь JS живёт в `assets/*.js`.
- **После правки ассета нужно поднять `?v=`** (`npm run assets:fix`): для
  `/assets/*` стоит `immutable`-кэш на год.
- **Новый каталог или файл в корне — сразу в `.assetsignore`**, для каталогов
  нужны оба шаблона: `dir/` и `dir/**`.
- **Секреты не коммитим и не печатаем**: токены лежат в домашнем каталоге,
  см. `AGENTS.md`.
- **Контакты и реквизиты** — телефон `+375 (29) 600-00-00`,
  почта `hello@asmalines.by` — меняются только по прямой просьбе.
- **Тестовые заявки** с настоящим телефоном не создаём: они попадут
  в рабочую базу диспетчерской.
