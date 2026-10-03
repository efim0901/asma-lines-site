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
  } catch (error) {
    /* localStorage может быть недоступен — тема просто останется светлой */
  }
})();
