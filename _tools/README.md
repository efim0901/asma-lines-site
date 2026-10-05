# Инструменты сопровождения

Скрипты разовые и идемпотентные: их можно запускать повторно, ничего не сломается.
Все они уже применены к репозиторию — оставлены, чтобы правки можно было
воспроизвести и чтобы было видно, что именно менялось.

| Файл | Назначение | Запуск |
|---|---|---|
| `sync-asset-versions.mjs` | **Главный инструмент сопровождения.** Сверяет хеш содержимого ассетов с `asset-versions.json`; находит файлы, изменённые без смены `?v=`. Без этого правка ассета «не доедет» до вернувшихся посетителей из-за `immutable`-кэша. | `npm run check:assets` (проверка) · `npm run assets:fix` (починить) |
| `validate-html.mjs` | Целостность разметки: баланс парных тегов, inline-обработчики (ломают CSP), исполняемый inline `<script>`, ссылки на несуществующие файлы, `href="#"`, `lang`/`viewport`/`title`. | `npm run check:html` |
| `smoke-crm.mjs` | 25 сквозных сценариев CRM на живом сервере: подпись initData, доступ по ролям, попытка подмены полей заявки, подделка тикета, выдача и отзыв доступа. | `npm run smoke:crm -- <url> <токен> <adminId>` |
| `setup-webhook-secret.mjs` | Генерирует `TELEGRAM_WEBHOOK_SECRET` и `SETUP_TOKEN`, регистрирует вебхук у Telegram **с** секретом, сохраняет значения в Cloudflare и проверяет, что подделка отбивается с 401. Секреты пишет в `~/.cf-secrets.txt` (вне репозитория). | `node _tools/setup-webhook-secret.mjs` |
| `import-legacy-to-d1.mjs` | Переносит заявки, список доступа и tombstone-записи из прежнего публичного JSON-бина в D1. Без `--apply` только показывает план. Делает резервную копию снапшота в домашний каталог. | `node _tools/import-legacy-to-d1.mjs [--apply]` |
| `switch-domain.mjs` | Переезд на другой домен: меняет хост везде (canonical, og:url, `og:image`, `twitter:image`, JSON-LD `@id`, sitemap, robots, `CRM_APP_URL`), не трогая почтовые адреса. Перед запуском поменяйте `OLD_HOST` / `NEW_HOST`. | `node _tools/switch-domain.mjs` |
| `make_og_cover.py` | Перерисовывает `assets/img/og-cover.svg` в `assets/img/og-cover.png` (1200×630). Нужен, если меняется макет обложки: соцсети не умеют SVG в `og:image`. | `python _tools/make_og_cover.py` |
| `fix-og-image.mjs` | Проставляет `og:image` = PNG и `og:image:type` на всех страницах. Запускать после добавления новой страницы. | `node _tools/fix-og-image.mjs` |
| `fix-a11y.mjs` | Skip-link, `id="main"`, `aria-pressed` у карточек транспорта. | `node _tools/fix-a11y.mjs` |
| `fix-toggle-aria.mjs` | `aria-pressed` у кнопок-переключателей (темы обращения, канал, роль партнёра, чипы автопарка). | `node _tools/fix-toggle-aria.mjs` |
| `fix-nav-labels.mjs` | Подписи `aria-label` для навигационных лендмарков. | `node _tools/fix-nav-labels.mjs` |
| `prepare-csp.mjs` | Убирает inline-обработчики `onclick` и трюк с `onload` у шрифтов — предпосылка для строгого CSP. | `node _tools/prepare-csp.mjs` |
| `extract-theme-and-csp.mjs` | Создаёт `assets/theme-init.js` (установка темы) и убирает инлайн `<script>` из `<head>`. | `node _tools/extract-theme-and-csp.mjs` |
| `fix-footer-and-meta.mjs` | Геометки на Гомель, удаление заглушек `href="#"`, замена текста про неопубликованные реквизиты. | `node _tools/fix-footer-and-meta.mjs` |
| `shorten-seo.mjs` | Сокращает `title`/`description` до отображаемых в выдаче длин. | `node _tools/shorten-seo.mjs` |

## Что проверять после запуска

```bash
npm run check      # синтаксис + версии ассетов + разметка + eslint + тесты
```

Скрипты печатают отчёт о том, что изменили, и в конце сообщают, остались ли
проблемные места (inline-обработчики, заглушки `href="#"`, устаревшие версии).
