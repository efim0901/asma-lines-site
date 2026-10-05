/**
 * ESLint (flat config).
 *
 * Проект без сборки: часть файлов работает в браузере, часть — в Worker,
 * часть — в Node. Поэтому окружения раздаются по путям, а не одной строкой.
 */

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  performance: 'readonly',
  FormData: 'readonly',
  URLSearchParams: 'readonly',
  URL: 'readonly',
  AbortSignal: 'readonly',
  AbortController: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  Blob: 'readonly',
  matchMedia: 'readonly',
  getComputedStyle: 'readonly',
  IntersectionObserver: 'readonly',
  MutationObserver: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  Image: 'readonly',
  alert: 'readonly',
  confirm: 'readonly'
};

const workerGlobals = {
  crypto: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortSignal: 'readonly',
  FormData: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly'
};

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  crypto: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortSignal: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  __dirname: 'readonly'
};

const rules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-undef': 'error',
  'no-var': 'error',
  'prefer-const': 'off',
  eqeqeq: ['warn', 'smart'],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-console': 'off'
};

export default [
  {
    ignores: [
      'node_modules/**',
      '.wrangler/**',
      'data/**',
      'assets/vendor/**',
      '_tests/**'
    ]
  },
  {
    files: ['_worker.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: workerGlobals
    },
    rules
  },
  {
    files: ['server.js', '_shared/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals
    },
    rules
  },
  {
    // Классические браузерные скрипты без модулей.
    files: ['assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...browserGlobals, ASMA_PRICING: 'readonly', L: 'readonly' }
    },
    rules: {
      ...rules,
      // Файлы исторически написаны как IIFE без модулей: это допустимо.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    // Эти файлы вынесены из inline-скриптов и написаны в старом стиле (var).
    // Переписывание на const/let — отдельная задача, здесь не блокируем сборку.
    files: ['assets/order-doc.js', 'assets/proposal.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...browserGlobals, ASMA_PRICING: 'readonly', tg: 'readonly' }
    },
    rules: {
      ...rules,
      'no-var': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  }
];
