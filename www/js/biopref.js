// biopref.js — выбор способа входа (мобильная оболочка, НЕ ядро): включён ли вход по
// отпечатку или лицу. Чистая логика без DOM, storage инъектируется. Ядро (crypto/store)
// не трогаем: обёртка ключа (helloWrap) и bioKey живут прежним форматом. Здесь только
// флаг выбора пользователя и решение «показывать ли системный биозапрос при входе».

// Ключ хранения выбора. Значение — '1' (вкл) или '0' (выкл). Отсутствие ключа = вкл
// (дефолт), чтобы у текущих пользователей поведение входа не менялось.
export const BIO_ENABLED_KEY = 'seyf-bio-enabled';

// Включён ли вход по отпечатку или лицу. Битое/недоступное storage → дефолт (вкл).
export function isBioLoginEnabled(storage) {
  try {
    const raw = storage && storage.getItem(BIO_ENABLED_KEY);
    if (raw === null || raw === undefined) return true;   // не задано — вкл по умолчанию
    return raw !== '0';
  } catch {
    return true;
  }
}

// Сохранить выбор (тихо, storage может быть недоступен). Возвращает применённое значение.
export function setBioLoginEnabled(storage, on) {
  const val = !!on;
  try {
    if (storage) storage.setItem(BIO_ENABLED_KEY, val ? '1' : '0');
  } catch {}
  return val;
}

// Показывать ли системный биозапрос при разблокировке: только если у файла есть
// обёрнутый ключ (helloWrap), биометрия на телефоне доступна И выбор пользователя включён.
// Мастер-пароль работает всегда и от этого решения не зависит.
export function shouldOfferBio({ hasHelloWrap, bioAvailable, enabled }) {
  return !!hasHelloWrap && !!bioAvailable && !!enabled;
}

// ---------- Подсказка-напоминание к мастер-паролю (v3-auth-B) ----------
// ⚠️ Хранится в ОТКРЫТОМ виде (namespace seyf-*), потому что нужна ДО расшифровки vault
// (на экране входа). Это НАМЁК, не сам пароль - предупреждение показываем при задании.
// Не завязана на пароль математически. Показывается после нескольких неудачных попыток.
export const PW_HINT_KEY = 'seyf-pw-hint';
export const PW_HINT_MAX = 200;

export function getPasswordHint(storage) {
  try {
    const v = storage && storage.getItem(PW_HINT_KEY);
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

// Сохранить/очистить подсказку (обрезаем до PW_HINT_MAX). Пустая строка удаляет ключ.
export function setPasswordHint(storage, text) {
  const t = String(text == null ? '' : text).trim().slice(0, PW_HINT_MAX);
  try {
    if (storage) { if (t) storage.setItem(PW_HINT_KEY, t); else storage.removeItem(PW_HINT_KEY); }
  } catch {}
  return t;
}

// L3-заслон: подсказка не должна выдавать сам пароль. «Протекает», если подсказка совпадает
// с паролем или содержит его как подстроку (без учёта регистра). Пустой пароль/подсказка -
// не утечка (нечего/не с чем сравнивать). Чистая функция, storage не трогает.
export function hintLeaksPassword(hint, password) {
  const h = String(hint == null ? '' : hint).trim().toLowerCase();
  const p = String(password == null ? '' : password).trim().toLowerCase();
  if (!h || !p) return false;
  return h.includes(p);
}
