// onboarding.js — логика первого экрана «Сейфа» (ТОЛЬКО мобайл, НЕ core).
// Держит чистые, тестируемые решения онбординга; DOM-часть — в app.js.
//
// Спека 8a: убрать двойной ввод мастер-пароля. Первый экран создания — ОДНО поле пароля
// (≥8 симв.) + переключатель «Показать пароль». Пока пароль скрыт — под ним поле «повтор»
// (защита от опечатки). Как только пароль показан — подтверждать нечего, поле повтора исчезает.

import { estimateStrength } from './generator.js';

export const MIN_MASTER_LEN = 8;

// Оценка мастер-пароля (спека 8d п.1): жёсткого минимума сложности НЕТ, пользователь
// решает под свою ответственность. Возвращаем уровень 0..3 + подпись + флаг weak.
//   пусто        → level -1 (форма не пропустит пустой пароль вообще);
//   bits < 40    → 0 «крайне ненадёжный» (weak);
//   bits < 60    → 1 «слабый» (weak);
//   bits < 85    → 2 «хороший»;
//   иначе        → 3 «надёжный».
// weak = true → форма требует чекбокс «принять на свою ответственность».
export function masterStrength(pw) {
  const s = String(pw == null ? '' : pw);
  if (s.length === 0) return { level: -1, label: '', weak: false, bits: 0 };
  const bits = estimateStrength(s).bits;
  let level;
  if (bits < 40) level = 0;
  else if (bits < 60) level = 1;
  else if (bits < 85) level = 2;
  else level = 3;
  const label = ['крайне ненадёжный', 'слабый', 'хороший', 'надёжный'][level];
  return { level, label, weak: level <= 1, bits };
}

// Куда вести первый кадр приложения.
//   есть vault (hasVault) → 'unlock' (обычный вход, демо НЕ показываем);
//   первый запуск + демо включено → 'demo' (сначала посмотреть);
//   первый запуск + демо выключено (прод) → 'setup' (сразу создание мастер-пароля).
//   файл хранилища ЕСТЬ, но повреждён (corrupt) → 'corrupt' ПЕРВЫМ, до demo/setup: ни создание
//   нового сейфа, ни демо не должны запускаться и перезаписывать данные (1.2.20).
export function decideStart({ hasVault, demoEnabled, corrupt = false }) {
  if (corrupt) return 'corrupt';
  if (hasVault) return 'unlock';
  return demoEnabled ? 'demo' : 'setup';
}

// Нужно ли показывать поле «повтор пароля». Пароль скрыт → да; показан → нет.
export function confirmVisible(showPassword) {
  return !showPassword;
}

// Проверка формы создания мастер-пароля (спека 8d п.1 — без жёсткого минимума сложности).
//   пустой пароль            → ошибка (пустой не пропускаем никогда);
//   пароль скрыт и повтор ≠   → ошибка «не совпадают»;
//   пароль слабый и НЕ принят → ошибка weak (форма показывает чекбокс согласия);
//   слабый, но согласие есть  → ок; хороший/надёжный → ок.
export function validateMasterCreation(p1, p2, showPassword, acceptedWeak) {
  const pw = String(p1 == null ? '' : p1);
  if (pw.length === 0) {
    return { ok: false, error: 'Введите мастер-пароль - без него сейф не создать.', weak: false };
  }
  if (!showPassword && p2 !== p1) {
    return { ok: false, error: 'Пароли не совпадают.', weak: false };
  }
  const s = masterStrength(pw);
  if (s.weak && !acceptedWeak) {
    return { ok: false, error: 'Пароль ' + s.label + '. Отметьте согласие, чтобы принять его на свою ответственность.', weak: true };
  }
  return { ok: true, error: null, weak: s.weak };
}

// Совместимость: старый двухаргументный валидатор (без оценки сложности) больше не
// используется формой, но оставлен как тонкая обёртка на случай внешних вызовов.
export function validateMasterPassword(p1, p2, showPassword) {
  return validateMasterCreation(p1, p2, showPassword, true);
}
