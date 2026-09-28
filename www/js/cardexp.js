// cardexp.js — срок действия карты одним полем ММ/ГГ (спека 8b п.6). ТОЛЬКО мобайл, не core.
// Один источник разбора/формата, чтобы и ввод, и хранение говорили на одном языке.

// Прогрессивное форматирование по мере ввода: цифры превращаются в «ММ/ГГ».
//   '' → ''; '1' → '1'; '12' → '12'; '123' → '12/3'; '1229' → '12/29'; '12/29' → '12/29'.
export function formatExpiry(str) {
  const digits = String(str == null ? '' : str).replace(/\D+/g, '').slice(0, 4);
  if (!digits) return '';
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + '/' + digits.slice(2);
}

// Разбор: { mm, yy, valid, text }. valid — ровно 4 цифры и месяц 01..12.
//   '12/29' → {mm:'12', yy:'29', valid:true}; '1329' → valid:false (месяц 13);
//   '0929'  → valid:true; '12' → valid:false (год не задан).
export function parseExpiry(str) {
  const all = String(str == null ? '' : str).replace(/\D+/g, '');
  const digits = all.slice(0, 4);
  const mm = digits.slice(0, 2), yy = digits.slice(2, 4);
  const m = Number(mm);
  // 1.2.24 (п.6): больше 4 цифр (недописанный год «12/202») - не срок, а неполный ввод.
  const valid = all.length === 4 && m >= 1 && m <= 12;
  return { mm, yy, valid, text: formatExpiry(digits) };
}

// Срок карты уже прошёл? (1.2.24, п.6). Карта действует до КОНЦА месяца ММ/ГГ (год 20ГГ).
// Невалидный/пустой срок - false (про него говорит проверка формата).
export function expiryPassed(str, now = Date.now()) {
  const p = parseExpiry(str);
  if (!p.valid) return false;
  const end = new Date(2000 + Number(p.yy), Number(p.mm), 1).getTime();   // 1-е число следующего месяца
  return now >= end;
}

// Живая маска поля срока (1.2.23, C4) - поверх formatExpiry, понимает то, как люди реально вводят:
//   «1/»      -> «01/»   (месяц одной цифрой и слэш: раньше слэш пропадал и выходило «12/9» из «1/29»);
//   «1/29»    -> «01/29»;
//   «12/2029» -> «12/29» (вставка с годом из 4 цифр: раньше maxlength обрезал до «12/20» = истёкшая);
//   «122029»  -> «12/29» (6 цифр ММГГГГ с годом 20ГГ).
// Всё остальное - как formatExpiry (цифры -> ММ/ГГ с авто-слэшем).
// 1.2.24 (п.6): год из 4 цифр проверяется РАНЬШЕ ветки «месяц одной цифрой»: вставка «1/2029»
// давала «01/20» (ветка одной цифры брала первые две цифры года). И набор года целиком
// («12/2» -> «12/20» -> «12/202» -> «12/2029») больше не обрывается на «12/20»: «ММ/20Г» - законный
// промежуточный вид (у двузначного года третьей цифры не бывает), parseExpiry его не пропустит.
// 1.2.25 (ревью 1.2.24, п.1): год из 4 цифр - только 20ГГ («12/3029» больше не становится «12/29»),
// и больше 4 цифр НЕ обрезаются до «ММ/ГГ» (вставка «1212/29» давала «12/12»): такая строка
// остаётся в поле как есть - человек её видит, а сохранение скажет «Проверьте срок».
export function formatExpiryLive(str) {
  const s = String(str == null ? '' : str);
  // 1.3.0 (ревью 1.2.25, L3): разделителем может быть и пробел: «1 29» -> «01/29» (было «12/9»),
  // «1 2029» -> «01/29» (было «1 2029» и «Проверьте срок»). expiryRawOk эти формы уже признавал законными.
  const y4 = s.match(/^\s*(\d{1,2})(?:\s*[\/.\-]\s*|\s+)(20\d\d)\s*$/);
  if (y4) return formatExpiry(y4[1].padStart(2, '0') + y4[2].slice(2));
  const y3 = s.match(/^\s*(\d{1,2})(?:\s*[\/.\-]\s*|\s+)(20\d)\s*$/);
  if (y3) return y3[1].padStart(2, '0') + '/' + y3[2];
  const one = s.match(/^\s*(\d)(?:\s*[\/.\-]\s*|\s+)(\d*)\s*$/);
  if (one && one[2].length <= 2) return one[2] ? formatExpiry('0' + one[1] + one[2]) : '0' + one[1] + '/';
  const d = s.replace(/\D+/g, '');
  if (/^(0[1-9]|1[0-2])20\d\d$/.test(d)) return formatExpiry(d.slice(0, 2) + d.slice(4));
  // 1.2.25: лишние цифры, буквы и лишние разделители («1/2/29», «1/229») не склеиваем в «валидное».
  const t = s.trim();
  if (d.length > 4) return s;
  if (/[^\d\s\/.\-]/.test(t)) return s;
  if (/\D/.test(t) && !/^\d{1,2}(?:\s*[\/.\-]\s*|\s+)\d{0,2}$/.test(t)) return s;
  if (/^\s*\d{2}\s*\/\s*$/.test(s)) return d + '/';   // «12/» - слэш, набранный руками, не пропадает
  return formatExpiry(s);
}

// 1.2.25 (ревью 1.2.24, п.1): проверка СЫРОГО ввода срока до formatExpiryLive. Маска работает только
// при наборе в конце, поэтому правка/вставка в середине оставляла в поле «12/3029», «12/329», «1212/29»,
// а formatExpiryLive/formatExpiry молча обрезали это до «валидного» (12/29, 12/32, 12/12). Теперь
// законны только формы, которые человек реально вводит:
//   ММГГ, М/ГГ, ММ/ГГ (разделитель / . - или пробел), ММ20ГГ, М/20ГГ, ММ/20ГГ.
// Всё остальное (больше 4 цифр не в форме «год 20ГГ», лишние разделители, буквы) - «проверьте срок».
// Месяц 13+ форму проходит, но его отсекает parseExpiry (valid:false) - в «валидное» он не превращается.
export function expiryRawOk(str) {
  const s = String(str == null ? '' : str).trim();
  if (!s) return true;
  if (/^\d{4}$/.test(s)) return true;                                   // ММГГ
  if (/^(0[1-9]|1[0-2])20\d\d$/.test(s)) return true;                   // ММ20ГГ
  return /^\d{1,2}(?:\s*[\/.\-]\s*|\s+)(?:\d{2}|20\d{2})$/.test(s);     // М/ГГ, ММ/ГГ, М/20ГГ, ММ/20ГГ
}

// Приведение на blur (1.2.25): форматируем ТОЛЬКО законную форму; мусор оставляем в поле как есть,
// чтобы человек его увидел, а проверка на сохранении сказала «проверьте срок».
export function normalizeExpiryInput(str) {
  const s = String(str == null ? '' : str);
  return expiryRawOk(s) ? formatExpiryLive(s) : s;
}

// Решение на сохранении карты (1.2.25): raw - значение поля как есть, old - срок записи до правки.
//   { ok:false, reason:'format' } - не сохранять, окно не закрывать («Проверьте срок»);
//   { ok:true, value, passed, untouched } - value в каноническом ММ/ГГ; passed - срок уже прошёл
//   (спросить подтверждение). Нетронутое старое значение (поле = formatExpiry(old)) не блокируем.
export function checkCardExpiry(raw, old = '', now = Date.now()) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { ok: true, value: '', passed: false, untouched: false };
  // 1.3.0 (Info): редактор больше не переписывает старый срок при открытии, поэтому нетронутое поле
  // равно самому старому значению - сохраняем его КАК ЕСТЬ (без приведения к ММ/ГГ).
  const oldS = String(old == null ? '' : old);
  if (oldS.trim() && s === oldS.trim()) return { ok: true, value: oldS, passed: false, untouched: true };
  const untouched = s === formatExpiry(oldS);
  const value = expiryRawOk(s) ? formatExpiryLive(s) : s;
  if (untouched) return { ok: true, value, passed: false, untouched: true };
  if (!expiryRawOk(s) || !parseExpiry(value).valid) return { ok: false, reason: 'format' };
  return { ok: true, value, passed: expiryPassed(value, now), untouched: false };
}
