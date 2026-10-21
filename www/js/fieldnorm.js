// fieldnorm.js — правила регистра/формата по полям (спека 8b п.5). ТОЛЬКО мобайл, не core.
// Задача: нигде не допускать «самопроизвольной» смены регистра, но там, где регистр
// значим (адрес кошелька EVM-checksum, пароли, passphrase) — не трогать вовсе.
//
// Правило есть → значение нормализуется. Правила НЕТ → значение возвращается как есть.
// Именно поэтому wallets.number (адрес) и passwords.password правил не имеют.

export const digitsOnly = (v) => String(v == null ? '' : v).replace(/\D+/g, '');

// base32 (RFC 4648) для TOTP-секрета: верхний регистр, без пробелов/дефисов и хвостовых '='.
export const base32Normalize = (v) =>
  String(v == null ? '' : v).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');

// seed-слова BIP-39 всегда строчные (wordlist в нижнем регистре) — trim + lower.
export const seedLower = (v) => String(v == null ? '' : v).trim().toLowerCase();

// C9 (1.2.23): e-mail и ссылка контакта - без пробелов (клавиатура любит пробел после точки).
export const noSpaces = (v) => String(v == null ? '' : v).replace(/\s+/g, '');

// section → { key → нормализатор }. Отсутствие ключа = поле не трогаем.
const RULES = {
  contacts: { email: noSpaces, link: noSpaces },
  seed:  { phrase: seedLower },            // passphrase (25-е слово) регистрозависима — правила нет
  cards: { number: digitsOnly, cvv: digitsOnly, pin: digitsOnly },
  totp:  { secret: base32Normalize },
  // wallets.number — адрес кошелька (EIP-55 checksum): регистр НЕ меняем, правила нет.
};

export function normalizeFieldValue(section, key, value) {
  const rule = RULES[section] && RULES[section][key];
  if (rule) return rule(value);
  return value == null ? '' : String(value);
}

// Есть ли для поля правило нормализации (нужно UI, чтобы не форматировать «немые» поля).
export function hasFieldRule(section, key) {
  return !!(RULES[section] && RULES[section][key]);
}

// --- v4: мягкая валидация банковских реквизитов (подсказка, НЕ блокировка сохранения) ---
// Нормы длины по полю раздела requisites. Значение можно сохранить в любом случае; при
// расхождении показываем ЯНТАРНУЮ подсказку и счётчик. Чистая функция - на ней тест.
export const REQUISITE_NORMS = {
  account: { lengths: [20], expected: '20', message: (n) => `Обычно в расчётном счёте 20 цифр, сейчас ${n}.` },
  corr:    { lengths: [20], expected: '20', message: (n) => `Обычно в корреспондентском счёте 20 цифр, сейчас ${n}.` },
  bik:     { lengths: [9],  expected: '9',  message: (n) => `Обычно БИК - это 9 цифр, сейчас ${n}.` },
  inn:     { lengths: [10, 12], expected: '10-12', message: (n) => `Обычно ИНН - это 10 цифр у организаций или 12 у ИП и физлиц, сейчас ${n}.` },
  kpp:     { lengths: [9],  expected: '9',  message: (n) => `Обычно КПП - это 9 цифр, сейчас ${n}.` },
};
const REQUISITE_LETTERS_MSG = 'Похоже, в поле попали не только цифры - обычно здесь только цифры.';

// Проверка одного поля реквизитов. Возвращает { level, message, count, expected }.
// level: 'ok' (пусто или совпало) | 'warn' (буквы или длина не по норме). Ничего не блокирует.
export function checkRequisite(key, value) {
  const norm = REQUISITE_NORMS[key];
  const raw = String(value == null ? '' : value).trim();
  if (!norm) return { level: 'ok', message: null, count: raw.replace(/\D+/g, '').length, expected: '' };
  if (raw === '') return { level: 'ok', message: null, count: 0, expected: norm.expected };
  const digits = raw.replace(/\D+/g, '');
  const count = digits.length;
  // Есть символы кроме цифр → предупреждение про «не только цифры».
  if (digits.length !== raw.length) {
    return { level: 'warn', message: REQUISITE_LETTERS_MSG, count, expected: norm.expected };
  }
  if (norm.lengths.includes(count)) return { level: 'ok', message: null, count, expected: norm.expected };
  return { level: 'warn', message: norm.message(count), count, expected: norm.expected };
}

// Поле реквизитов имеет норму длины (UI решает, вешать ли счётчик/подсказку).
export function hasRequisiteNorm(key) {
  return Object.prototype.hasOwnProperty.call(REQUISITE_NORMS, key);
}
