/* ============================================================
   ASMA Lines — ранняя установка темы (до отрисовки, чтобы не мигало).
   Вынесено из inline <script> в <head>: это позволяет держать строгий
   Content-Security-Policy без 'unsafe-inline' для скриптов.
   ============================================================ */
(function applyStoredTheme() {
  try {
    let stored = localStorage.getItem('asma-theme');
    let prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('theme-dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.remove('theme-dark');
    }
    /* Для главной: заранее запрашиваем иллюстрацию именно выбранной темы.
       Скрытый вариант не грузится (у обоих <img> стоит loading="lazy"). */
    var hero = document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'assets/img/asma-hero-visual-dark.svg?v=20261027b'
      : 'assets/img/asma-hero-visual.svg?v=20261026';
    if (/\/(index\.html)?$/.test(location.pathname)) {
      var l = document.createElement('link');
      l.rel = 'preload'; l.as = 'image'; l.href = hero; l.fetchPriority = 'high';
      document.head.appendChild(l);
    }
  } catch (error) {
    /* localStorage может быть недоступен — тема просто останется светлой */
  }
})();
