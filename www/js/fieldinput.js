// fieldinput.js — поведение полей ввода на телефоне (спека 8d п.2,3,4,5,7,8).
// ТОЛЬКО мобайл, НЕ ядро. Чистые, тестируемые хелперы: клавиатуры по типу поля,
// лимиты и маски (номер карты по 4, ПИН/CVV/срок), латинская раскладка имени,
// автоудаление пробелов в ссылке. DOM-обвязку (навешивание слушателей) делает app.js.
//
// Нормализация НА СОХРАНЕНИИ живёт отдельно в fieldnorm.js (регистр/формат в vault).
// Здесь — то, что происходит ПРЯМО ПРИ ВВОДЕ (маска, клавиатура, отсев символов).

// Номер карты: ISO/IEC 7812 — 13..19 цифр (14 Diners, 15 Amex, 16 Visa/MC/Мир, 19 Maestro).
export const CARD_NUMBER_MIN = 13;
export const CARD_NUMBER_MAX = 19;

// Оставить только цифры и обрезать до maxLen (maxLen<=0 — без ограничения длины).
export function onlyDigits(v, maxLen = 0) {
  const d = String(v == null ? '' : v).replace(/\D+/g, '');
  return maxLen > 0 ? d.slice(0, maxLen) : d;
}

// Сгруппировать цифры по size (по умолчанию 4) пробелом — для визуального формата номера карты.
//   '1234123412341234' → '1234 1234 1234 1234'; сохранение снимет пробелы (fieldnorm.digitsOnly).
export function groupDigits(v, size = 4) {
  const d = onlyDigits(v);
  if (!d) return '';
  return d.replace(new RegExp(`(.{${size}})`, 'g'), '$1 ').trim();
}

// Живая маска номера карты при вводе: цифры (макс 19), сгруппированные по 4.
export function formatCardNumber(v) {
  return groupDigits(onlyDigits(v, CARD_NUMBER_MAX), 4);
}

// Валиден ли номер карты по длине (13..19 цифр). Пустой — не валиден (для проверки на сохранении).
export function cardNumberValid(v) {
  const n = onlyDigits(v).length;
  return n >= CARD_NUMBER_MIN && n <= CARD_NUMBER_MAX;
}

// Автоудаление ЛЮБЫХ пробельных символов (спека 8d п.8): клавиатуры телефона любят
// ставить пробел после точки, в URL это ломает ссылку. 'example .com / a b c' → без пробелов.
export function stripSpaces(v) {
  return String(v == null ? '' : v).replace(/\s+/g, '');
}

// Имя владельца — латинская раскладка (спека 8d п.3). Кириллицу на вводе не принимаем:
// вырезаем кириллические символы, оставляя латиницу/цифры/пробел/дефис/апостроф/точку.
// Возврат { value, hadCyrillic } — app.js по hadCyrillic один раз подскажет пользователю.
const CYRILLIC_RE = /[Ѐ-ӿ]/g;
export function latinOnly(v) {
  const s = String(v == null ? '' : v);
  const hadCyrillic = CYRILLIC_RE.test(s);
  // Вырезание кириллицы оставляет мусорные пробелы (напр. «Иван IVANOV» -> « IVANOV»,
  // «IVAN ИВАНОВ» между словами -> двойной пробел). Тримим ведущие и схлопываем двойные,
  // хвостовой одиночный пробел оставляем - он нужен, чтобы дописать вторую часть имени.
  const value = s.replace(CYRILLIC_RE, '').replace(/^ +/, '').replace(/ {2,}/g, ' ');
  return { value, hadCyrillic };
}

// Атрибуты клавиатуры/ввода по (section,key). Отсутствие записи → поле без спецатрибутов.
// maxLength: ПИН 4, CVV 3, срок 5 (ММ/ГГ), номер карты 23 (19 цифр + 4 пробела-разделителя).
const PROPS = {
  cards: {
    number:  { inputMode: 'numeric', pattern: '[0-9 ]*', maxLength: 23, autocomplete: 'off' },
    holder:  { lang: 'en', autocapitalize: 'characters', autocomplete: 'off' },
    // maxLength 7 (C4): вставка «12/2029» не обрезается браузером до «12/20»; маска сводит к ММ/ГГ.
    expiry:  { inputMode: 'numeric', pattern: '[0-9/]*', maxLength: 7, autocomplete: 'off' },
    cvv:     { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 3, autocomplete: 'off' },
    pin:     { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 4, autocomplete: 'off' },
  },
  passwords: {
    url:     { inputMode: 'url', autocapitalize: 'off', autocomplete: 'off', spellcheck: false },
  },
  wallets: {
    url:     { inputMode: 'url', autocapitalize: 'off', autocomplete: 'off', spellcheck: false },
  },
  totp: {
    secret:  { autocapitalize: 'characters', autocomplete: 'off', spellcheck: false },
  },
  // C3/C11 (1.2.23): даты документа - цифровая клавиатура и maxlength 10 (ДД.ММ.ГГГГ). Раньше
  // срок получал общий лимит 500 символов: вставка в заполненное поле давала «15.04.3202».
  documents: {
    expiry:    { inputMode: 'numeric', maxLength: 10, autocomplete: 'off' },
    issueDate: { inputMode: 'numeric', maxLength: 10, autocomplete: 'off' },
  },
  // C9 (1.2.23): контакты - клавиатура по смыслу поля. Телефон - type=tel (цифровая с +),
  // e-mail и ссылка - inputmode email/url без автозаглавной и проверки орфографии.
  contacts: {
    phone:   { inputMode: 'tel', type: 'tel', autocomplete: 'off' },
    email:   { inputMode: 'email', autocapitalize: 'off', autocomplete: 'off', spellcheck: false },
    link:    { inputMode: 'url', autocapitalize: 'off', autocomplete: 'off', spellcheck: false },
  },
};

// B5 (1.2.23): атрибуты полей-секретов и произвольных полей в редакторе - клавиатура не
// запоминает, не исправляет и не подсказывает введённое. app.js навешивает их setAttribute-ом.
export const SECRET_INPUT_ATTRS = { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' };

// Тип <input> редактора по типу поля схемы: секрет - password (с кнопкой-глазом в app.js), иначе
// null (не менять: text у input, textarea без type).
export function editorInputType(fieldType) {
  return fieldType === 'secret' ? 'password' : null;
}

export function fieldInputProps(section, key) {
  return (PROPS[section] && PROPS[section][key]) || null;
}

// Разумные лимиты ввода (v3) - защита от гигантского ввода, который душит шифрование/рендер.
// Действуют даже в Pro. Числа - дефолт, правятся здесь одной строкой.
export const INPUT_LIMITS = {
  textarea: 10000,  // многострочное поле (заметка, комментарии)
  text: 500,        // обычное однострочное текстовое поле
  scansPerDoc: 20,  // сканов в одном документе
  recordsPerSection: 1000, // записей в одном разделе
};

// Дефолтный maxLength для поля по типу элемента, ЕСЛИ у поля нет своего явного лимита (PROPS).
// tagName - 'TEXTAREA' | 'INPUT' | ...; hasExplicit - уже задан ли maxLength из PROPS.
// Возвращает число или null (не навешивать).
export function defaultMaxLength(tagName, hasExplicit) {
  if (hasExplicit) return null;
  const t = String(tagName || '').toUpperCase();
  if (t === 'TEXTAREA') return INPUT_LIMITS.textarea;
  if (t === 'INPUT') return INPUT_LIMITS.text;
  return null;
}

// Правило живого отсева/маски для поля. Возвращает функцию (rawValue) → newValue или null,
// если у поля нет живой маски. Имя владельца отдаётся отдельно (latinOnly) — там нужен флаг.
export function liveMaskFor(section, key) {
  if (section === 'cards') {
    if (key === 'number') return formatCardNumber;
    if (key === 'cvv') return (v) => onlyDigits(v, 3);
    if (key === 'pin') return (v) => onlyDigits(v, 4);
    // expiry маскируется formatExpiry (cardexp.js) — там уже есть авто-слэш.
  }
  if ((section === 'passwords' || section === 'wallets') && key === 'url') return stripSpaces;
  // C9: в e-mail и ссылке контакта пробелов быть не может (клавиатура ставит их после точки).
  if (section === 'contacts' && (key === 'email' || key === 'link')) return stripSpaces;
  return null;
}

// Какие символы маски «значимые» (их считаем при переносе каретки): для ссылки - всё, кроме
// пробелов (stripSpaces их вырезает), для остальных масок раздела карт - цифры.
export function liveMaskSig(section, key) {
  if ((section === 'passwords' || section === 'wallets') && key === 'url') return isNonSpace;
  if (section === 'contacts' && (key === 'email' || key === 'link')) return isNonSpace;
  return isDigitCh;
}

// ---------- каретка при живой маске (1.2.22, баг живого теста) ----------
// Корень бага: обработчик input переформатировал значение (вставлял точки/слэш/пробелы) и
// присваивал inp.value = formatted -> браузер уводил каретку в КОНЕЦ строки, и следующий
// Backspace удалял не тот символ. Здесь чистый расчёт: сколько ЗНАЧИМЫХ символов (цифр) стоит
// слева от каретки ДО форматирования -> после форматирования ставим каретку сразу за тем же
// числом значимых символов. Backspace (или Delete) по разделителю (точка/слэш/пробел, который
// маска всё равно вернёт) удаляет соседнюю ЦИФРУ, а не упирается в разделитель.
export const isDigitCh = (ch) => ch >= '0' && ch <= '9';
export const isNonSpace = (ch) => !/\s/.test(ch);

// ---------- 1.2.24 (0b): маска дат и номера карты - ТОЛЬКО при наборе в конце ----------
// Живой тест на Gboard: удаление символа в СЕРЕДИНЕ даты удаляло «где-то в другом месте». Экранная
// клавиатура (IME, композиция) присылает inputType/каретку не так, как headless: любой пересчёт
// значения посреди правки рискует. Поэтому для дат (срок и дата выдачи документа, срок карты) и
// номера карты значение переписываем ТОЛЬКО когда каретка в конце и выделения не было (обычный
// набор: авто-точка/слэш/пробел). Каретка не в конце - значение НЕ трогаем совсем: пользователь
// правит как обычный текст. Приведение к формату - на blur и при сохранении (с проверкой).
// Возврат { value, caret, changed }.
//
// 1.3.0 (ревью 1.2.25, L5): Backspace сразу после авто-нуля. Маска дописывает цифру, которую человек
// не набирал («1.» -> «01.», срок карты «1/» -> «01/»). Backspace стирал только точку, и оставалось
// «01» - дописанный ноль «прилипал» («1.«, ←, «2» давало «01.2» вместо «12»). Сам formatter этого не
// различит: по строке «01» не видно, набрали её или это остаток от «01.». Поэтому решение здесь, в
// слое события: memo (объект на поле, его держит bindCaretMask) помнит последнюю правку маски,
// ДОБАВИВШУЮ цифры { typed, shown }. Если следующее событие - Backspace в конце, стёрший ровно
// последний символ показанного, - стираем последний символ того, что человек НАБРАЛ, и форматируем
// заново («1.» -> «1»). Любое другое событие memo сбрасывает. Без memo (старые вызовы/тесты) - как было.
const digitCount = (x) => (String(x).match(/\d/g) || []).length;
function rememberAuto(memo, typed, shown) {
  if (memo) memo.auto = digitCount(shown) > digitCount(typed) ? { typed, shown } : null;
}
export function endOnlyMask(raw, caret, formatter, { hadSelection = false, composing = false, inputType = '', memo = null } = {}) {
  const s = String(raw == null ? '' : raw);
  const c = Number.isFinite(caret) ? Math.min(Math.max(0, caret), s.length) : s.length;
  const last = memo ? memo.auto : null;
  if (memo) memo.auto = null;
  if (hadSelection || composing || c < s.length) return { value: s, caret: c, changed: false };
  if (last && inputType === 'deleteContentBackward' && last.typed && s === last.shown.slice(0, -1)) {
    const typed = last.typed.slice(0, -1);
    const value = String(formatter(typed) ?? '');
    rememberAuto(memo, typed, value);
    return { value, caret: value.length, changed: value !== s };
  }
  const value = String(formatter(s) ?? '');
  rememberAuto(memo, s, value);
  return { value, caret: value.length, changed: value !== s };
}

// Поля с маской «только в конце» (0b): номер и срок карты, срок и дата выдачи документа.
export function endOnlyMaskField(section, key) {
  if (section === 'cards') return key === 'number' || key === 'expiry';
  if (section === 'documents') return key === 'expiry' || key === 'issueDate';
  return false;
}

// raw/caret - значение и позиция каретки ПОСЛЕ правки браузером (до маски); formatter - маска.
// opts.prev - значение ДО правки (для распознавания удаления разделителя), opts.inputType -
// InputEvent.inputType ('deleteContentBackward' = Backspace, 'deleteContentForward' = Delete),
// opts.isSig - предикат значимого символа (по умолчанию цифра).
// Возврат { value, caret }: value - что поставить в поле, caret - куда поставить каретку.
export function reformatWithCaret(raw, caret, formatter, opts = {}) {
  const isSig = opts.isSig || isDigitCh;
  let s = String(raw == null ? '' : raw);
  let c = Math.min(Math.max(0, Number.isFinite(caret) ? caret : s.length), s.length);
  const prev = opts.prev == null ? null : String(opts.prev);
  // Удалили ровно один НЕзначимый символ (разделитель) в позиции c: prev без prev[c] == raw.
  // C11 (1.2.23): только если выделения НЕ было. Выделили разделитель и нажали Backspace/Вырезать -
  // пользователь удаляет ИМЕННО выделенное; раньше вместе с ним уходила соседняя цифра («1235 678»).
  if (!opts.hadSelection && opts.inputType !== 'deleteByCut'
      && prev !== null && prev.length === s.length + 1 && c <= s.length && !isSig(prev[c])
      && prev.slice(0, c) + prev.slice(c + 1) === s) {
    if (opts.inputType === 'deleteContentForward') {
      let i = c; while (i < s.length && !isSig(s[i])) i++;          // Delete: ближайшая цифра справа
      if (i < s.length) s = s.slice(0, i) + s.slice(i + 1);
    } else {
      let i = c - 1; while (i >= 0 && !isSig(s[i])) i--;            // Backspace: цифра слева
      if (i >= 0) { s = s.slice(0, i) + s.slice(i + 1); c = i; }
    }
  }
  let nLeft = 0;
  for (let i = 0; i < c; i++) if (isSig(s[i])) nLeft++;
  const value = String(formatter(s) ?? '');
  // Маска ничего не поменяла - каретка остаётся ровно там, где её оставил браузер.
  if (value === s) return { value, caret: c };
  // 1.2.23 (C4): каретка была В КОНЦЕ (обычный набор) - остаётся в конце. Маска могла ДОБАВИТЬ
  // значимый символ слева («1/» -> «01/»): счёт цифр слева тогда ставил каретку между 0 и 1, и
  // следующая цифра уходила в середину («1/29» -> «02/91»).
  if (c >= s.length) return { value, caret: value.length };
  let pos = 0;
  if (nLeft > 0) {
    let seen = 0;
    for (pos = 0; pos < value.length && seen < nLeft; pos++) if (isSig(value[pos])) seen++;
  }
  return { value, caret: Math.min(pos, value.length) };
}
