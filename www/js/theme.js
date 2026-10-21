// theme.js — именованные темы оформления «Сейфа» (визуальный слой, mobile-only).
// Две темы по концептам Claude Design; переключение по кругу из меню. Чистые
// функции — на них висит тест theme.test.mjs. Ключ хранения — seyf_theme.

export const THEMES = ['bank', 'nord'];
export const DEFAULT_THEME = 'bank';           // дефолт — тёмная (внутр. ключ bank)
// 8e п.4: внешние подписи — «Тёмная» / «Светлая». Внутренние ключи (bank/nord) не меняем,
// чтобы не ломать сохранённое значение и миграцию день/ночь.
export const THEME_LABELS = { bank: 'Тёмная', nord: 'Светлая' };

// Приводит сохранённое значение к валидной теме. Мигрирует прежний день/ночь
// ('light' → nord, 'dark' → bank) и любой мусор → дефолт. Чистая, без DOM/стораджа.
export function normalizeTheme(v) {
  if (THEMES.includes(v)) return v;
  if (v === 'light') return 'nord';
  if (v === 'dark') return 'bank';
  return DEFAULT_THEME;
}

// Следующая тема по кругу.
export function nextTheme(v) {
  const i = THEMES.indexOf(normalizeTheme(v));
  return THEMES[(i + 1) % THEMES.length];
}

// v4: значок-свотч темы для пункта меню (как в «Хомяке»): луна = тёмная (bank),
// солнце = светлая (nord). Чистая функция - на ней тест соответствия значка теме.
export function themeSwatchIcon(v) {
  return normalizeTheme(v) === 'bank' ? 'moon' : 'sun';
}
