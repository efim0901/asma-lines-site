/* ============================================================
   ASMA Lines — тема диспетчерской до первой отрисовки.

   Зачем отдельный файл. В Telegram тема приходит из tg.colorScheme,
   в обычном браузере — из системной настройки. Если решать это только
   в crm-next.js (он подключён в конце <body>), страница успевает
   отрисоваться светлой и в тёмной теме мигает. Здесь решение принимается
   в <head>, до первой отрисовки.

   Инлайн-скрипт использовать нельзя: строгий CSP запрещает 'unsafe-inline'
   для скриптов — тот же приём, что и в assets/theme-init.js сайта.
   ============================================================ */
(function applyTelegramTheme() {
  try {
    const tg = window.Telegram && window.Telegram.WebApp;
    const scheme = tg && tg.colorScheme;
    if (scheme === 'dark' || scheme === 'light') {
      document.documentElement.setAttribute('data-theme', scheme);
      return;
    }
    const prefersDark = window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } catch (error) {
    /* Если Telegram недоступен — остаётся светлая тема из разметки. */
  }
})();
