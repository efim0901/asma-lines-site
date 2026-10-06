# Шпаргалка для ИИ-агента: работа с проектом ASMA Lines

Документ для того, кто продолжает работу над проектом вместо меня.
Здесь только то, что нужно знать **до** первой правки: где доступы, как
проверить актуальное состояние, как выложить и как убедиться, что всё живо.

Правила проекта, которые задал владелец:

- отвечать **по-русски**;
- сайт хостится на **Cloudflare**; если нужна дополнительная настройка —
  расписать её явно;
- **локальный сервер для деплоя не используем** («локально мы не делаем»):
  правки выкладываются прямо на Cloudflare;
- правки и удаления делать **самому**, не переспрашивая по мелочам;
- канонические контакты: телефон `+375 (29) 600-00-00`, почта
  `hello@asmalines.by` — не менять.

---

## 1. Что это за проект

Сайт-визитка логистической компании плюс встроенная диспетчерская
(Telegram Web App) с заявками, документами по рейсу и браузерным входом.

| Что | Значение |
|---|---|
| Публичный адрес | `https://asma-lines-site.firws.workers.dev` |
| Тип развёртывания | **Worker с ассетами, не Pages** |
| Имя скрипта | `asma-lines-site` |
| Точка входа | `_worker.js` |
| Хранилище | Cloudflare D1, база `asma-lines`, биндинг **`DB`** |
| Репозиторий | `https://github.com/efim0901/asma-lines-site` (публичный), ветка `main` |
| Домен `asmalines.by` | **не существует**, DNS не отвечает. Работаем на `workers.dev` |

Точка входа `_worker.js` импортирует общую логику из `_shared/`
(`core.js`, `validation.js`, `store.js`, `sessions.js`, `telegram.js`,
`qr.js`, `geo.js`, `notify.js`). Правки бизнес-логики почти всегда нужно
делать в `_shared/`, а не в самом `_worker.js`.

Статикой считаются все файлы в корне; что не публиковать — перечислено
в `.assetsignore`.

---

## 2. Доступы

**Значения секретов никогда не печатать в чат и не коммитить.**
Все они лежат вне репозитория, в домашнем каталоге:

| Файл | Что внутри |
|---|---|
| `~/.cf-token.txt` | токен Cloudflare (одна строка) |
| `~/.cf-account.txt` | Account ID Cloudflare (одна строка) |
| `~/.bot-token.txt` | токен Telegram-бота (одна строка) |
| `~/.cf-secrets.txt` | `TELEGRAM_WEBHOOK_SECRET`, `SETUP_TOKEN` |

Проверить, что они на месте (без вывода значений):

```powershell
foreach ($f in '.cf-token.txt','.cf-account.txt','.bot-token.txt','.cf-secrets.txt') {
  $p = Join-Path $env:USERPROFILE $f
  "{0,-18} {1}" -f $f, (Test-Path $p)
}
```

> **Важно.** В переписке один раз был вставлен GitHub-токен (`github_pat_…`).
> Его нужно отозвать, и **использовать токены из чата нельзя** — только
> файлы выше. Если GitHub просит пароль при `git push`, значит в системе
> сохранён рабочий доступ; токен руками в команды не подставлять.

---

## 3. Первое действие в новой сессии: проверить GitHub

**Это самое важное правило.** Локальная копия может отставать от GitHub,
а `wrangler deploy` выкладывает **локальные файлы** — то есть устаревшая
копия откатит продакшн назад. Со мной так уже случилось: на GitHub лежал
более новый коммит с модульным `_worker.js` и CSP для Telegram, а я выложил
старую версию.

Порядок в начале работы:

```powershell
git fetch origin
git status --short
git log --oneline -5
git log --oneline HEAD..origin/main      # что нового на GitHub — этого нет локально
git log --oneline origin/main..HEAD      # что есть локально, но не отправлено
```

Если `HEAD..origin/main` что-то показал — сначала подтянуть:

```powershell
git rebase origin/main
```

После ребейза **обязательно** прогнать проверки (см. п. 5) и посмотреть,
не появились ли конфликты в ассетах.

Отправка своих правок:

```powershell
git add -A
git commit -m "Понятное описание на русском"
git push origin main
```

---

## 4. Деплой

```powershell
$env:CLOUDFLARE_API_TOKEN  = (Get-Content "$env:USERPROFILE\.cf-token.txt" -Raw).Trim()
$env:CLOUDFLARE_ACCOUNT_ID = (Get-Content "$env:USERPROFILE\.cf-account.txt" -Raw).Trim()
npx wrangler deploy
```

В конце вывода будет адрес и `Current Version ID` — сохранить его для отчёта.

Что помнить:

- `npx wrangler deploy` берёт `name` и точку входа из `wrangler.toml`;
- выгружаются **файлы с диска**, поэтому сначала коммит и проверки, потом деплой;
- биндинг D1 должен называться именно `DB` — `_worker.js` читает `env.DB`.
  Без него заявки не принимаются, а сайт работает только на чтение;
- `compatibility_date` в `wrangler.toml` менять осознанно и с проверкой сайта.

---

## 5. Проверки перед деплоем

```powershell
npm run check
```

Одна команда прогоняет: синтаксис JS → сцены иллюстраций → версии ассетов →
валидацию HTML → ESLint → 7 наборов тестов (около 100 проверок).

Код возврата должен быть `0`. Отдельные шаги, если нужно:

| Команда | Что проверяет |
|---|---|
| `npm run check:assets` | у каждого ассета `?v=` соответствует хешу содержимого |
| `npm run check:scenes` | блок сцен в `style.css` совпадает с картинками и разметкой |
| `npm run check:html` | целостность разметки, отсутствие inline-обработчиков |
| `npm run assets:fix` | поднять `?v=`, если ассет изменился |
| `npm run scenes:light` | пересобрать светлые версии сцен и подключить их |

**Про кэш.** Для `/assets/*` стоит `max-age=31536000, immutable`, то есть
браузер запоминает файл на год. Поэтому после **любой** правки ассета нужно
менять `?v=` — этим занимается `npm run assets:fix`. Если правка за день не
первая, версия получает буквенный суффикс (`20261006b`) и никогда не
уменьшается: иначе можно вернуться к адресу, под которым уже отдавался
другой файл.

Для HTML стоит `max-age=0, must-revalidate` — разметка обновляется сразу.

---

## 6. Проверка после деплоя

Обязательный минимум:

```powershell
$base = 'https://asma-lines-site.firws.workers.dev'

# 1. Здоровье: ожидаем storage=d1, writable=true, botTokenConfigured=true
Invoke-RestMethod "$base/api/health" | Select-Object storage, writable, botTokenConfigured

# 2. Служебные пути НЕ должны открываться — везде ждём 404
foreach ($p in '/_tools/','/_shots/','/_worker.js','/server.js','/wrangler.toml','/schema.sql') {
  try { "ОТКРЫТО {0} {1}" -f $p, (Invoke-WebRequest "$base$p" -Method Head).StatusCode }
  catch { "{0} → {1}" -f $p, $_.Exception.Response.StatusCode.value__ }
}

# 3. CSP на странице диспетчерской: важно проверить именно `frame-ancestors`,
#    а не наличие X-Frame-Options. Заголовок может отсутствовать, но CSP
#    с frame-ancestors 'none' всё равно запретит встраивание.
(Invoke-WebRequest "$base/crm.html" -Method Head).Headers['Content-Security-Policy']

# 4. CRM закрыта без авторизации — ждём 401
try { Invoke-WebRequest "$base/api/crm" } catch { $_.Exception.Response.StatusCode.value__ }
```

Полезно дополнительно:

- **новые картинки** — прямой запрос `HEAD /assets/img/light/<сцена>.svg`, ждём 200;
- **проверка телефона** — `POST /api/lead` с заведомо неверным номером
  (например `+7 999 123-45-67`) должен вернуть `400`. Тестовые заявки с
  валидным номером лучше не создавать: они попадут в рабочую базу.

---

## 7. Правка иллюстраций и темы

Иллюстрации-сцены живут в двух вариантах: тёмный `assets/img/<имя>.svg`
и светлый `assets/img/light/<имя>.svg`. В разметке стоит `data-scene="<имя>"`,
а правила с нужным файлом генерирует `_tools/wire-scenes.mjs`.

```powershell
npm run scenes:light     # перерисовать светлые версии и подключить
npm run assets:fix       # поднять версию style.css, если изменился
npm run check
```

Что важно знать:

- пути внутри CSS **относительные** (`img/...`). Через `var()` относительный
  URL разрешается от таблицы стилей и даёт 404, а путь от корня (`/assets/...`)
  ломается при локальном просмотре через `file://`;
- версия картинки в блоках сцен — хеш содержимого, руками её поднимать не нужно;
- сцены, нарисованные генератором (`make-vehicle-scenes.py`), весят 7–13 КБ —
  в WebP их переводить не нужно, будет только хуже;
- четыре старые детальные сцены (`hero-truck`, `partners-fleet`,
  `about-road`, `service-auto`) весят 1110 КБ, а показываются в окне, где
  вектор избыточен. Их имеет смысл перевести в WebP — это в плане, `PLAN.md`.

Проверка темы: страницы снимаются в двух темах, и участки, которые выглядят
одинаково в обеих, — это баги (элемент не использует переменные темы).

```powershell
node _tools/shoot-site.mjs index.html both full
python _tools/find-static-bands.py _shots/index-light-full.png _shots/index-dark-full.png
```

Ожидаемый ответ — «Неадаптивных полос не найдено».

---

## 8. Чего не делать

1. **Не выкладывать устаревшую локальную копию.** Сначала `git fetch`
   и сравнение с `origin/main` (п. 3).
2. **Не коммитить и не печатать секреты.** Токены — только из файлов в
   домашнем каталоге. `data/`, `.dev.vars`, `.wrangler/` — в `.gitignore`.
3. **Не публиковать служебное.** Новый каталог или файл в корне нужно сразу
   внести в `.assetsignore`. Для каталогов нужны **оба** шаблона: `dir/`
   и `dir/**`. Уже были случаи публикации `_tools/`, `node_modules/` и
   `_worker.js.map` (карта раскрывала весь серверный код).
4. **Не менять контакты и реквизиты** без прямой просьбы.
5. **Не создавать тестовые заявки** с валидным телефоном — они попадут
   в рабочую базу диспетчерской.
6. **Не менять `compatibility_date`** без необходимости.
7. **Не добавлять inline-скрипты и `onclick`** — строгий CSP их заблокирует.
   Весь JS живёт в `assets/*.js`.
8. **Не полагаться на `_headers` для заголовков, которые отдаёт Worker.**
   По документации Cloudflare ([Workers → Headers](https://developers.cloudflare.com/workers/static-assets/headers/))
   правила из `_headers` **не применяются** к ответам, которые формирует код
   Worker. А `_worker.js` перехватывает все не-API пути и сам вызывает
   `env.ASSETS.fetch()` — поэтому, например, правило для `/crm.html` в
   `_headers` не срабатывает, и страница уходит с `frame-ancestors 'none'`
   вместо разрешения Telegram Web. Заголовки нужно ставить прямо в Worker.
9. **Не считать проверку заголовков выполненной, если смотреть только
   `X-Frame-Options`.** Встраивание запрещает и `frame-ancestors` в CSP,
   а его легко пропустить: заголовка `X-Frame-Options` в ответе нет, но
   встраивание всё равно заблокировано.

---

## 9. Работа с диспетчерской и ботом

- Вебхук Telegram должен быть зарегистрирован с секретом
  (`TELEGRAM_WEBHOOK_SECRET`, заголовок `X-Telegram-Bot-Api-Secret-Token`).
- Если бот перестал отвечать после перевыпуска токена в @BotFather —
  Telegram сбрасывает вебхук, `getWebhookInfo` вернёт пустой `url`:
  лечится `node _tools/fix-bot-token.mjs`.
- Сквозные сценарии CRM на живом сервере: `npm run smoke:crm -- <url> <токен> <adminId>`.
- Браузерный вход в диспетчерскую: одноразовый код и подтверждение в боте,
  сессия 30 дней. Сессии лежат в D1.

---

## 10. Где смотреть подробности

| Файл | О чём |
|---|---|
| `DEPLOY-CLOUDFLARE.md` | конфигурация Cloudflare, подъём с нуля, разбор частых проблем |
| `PLAN.md` | разбор проекта и план правок с измерениями |
| `_tools/README.md` | все инструменты сопровождения и их запуск |
| `_prototypes/README.md` | макеты интерфейса диспетчерской, открытые вопросы |
| `_shared/` | бизнес-логика, общая для Worker и локального сервера |
| `schema.sql` | структура базы D1 |

---

## 11. Быстрый старт: полный цикл правки

```powershell
# 1. Синхронизация
git fetch origin
git log --oneline HEAD..origin/main        # если что-то есть — git rebase origin/main

# 2. Правки
#    ...

# 3. Проверки
npm run check                              # должен вернуть 0

# 4. Если менялись картинки или CSS
npm run assets:fix                         # поднять ?v=

# 5. Деплой
$env:CLOUDFLARE_API_TOKEN  = (Get-Content "$env:USERPROFILE\.cf-token.txt" -Raw).Trim()
$env:CLOUDFLARE_ACCOUNT_ID = (Get-Content "$env:USERPROFILE\.cf-account.txt" -Raw).Trim()
npx wrangler deploy

# 6. Проверка продакшна
Invoke-RestMethod 'https://asma-lines-site.firws.workers.dev/api/health'

# 7. Отправка в GitHub
git add -A && git commit -m "Описание правки" && git push origin main
```
