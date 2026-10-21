// documents.js — логика раздела «Документы (сканы)» (только мобайл, НЕ ядро, как seed/totp).
// Держит чистую, тестируемую логику вложений: модель страниц-сканов, разбор/валидацию
// бинаря, математику зума/пана и статус срока действия. Base64 берём из crypto.js (DRY),
// чтобы не дублировать и не расходиться с форматом хранилища. DOM-часть (просмотрщик,
// камера, выбор файла, рендер PDF) — в doc-viewer.js; здесь ничего браузерного.
import { b64, unb64 } from './crypto.js';

export { b64, unb64 };

// Типы документов для выпадающего списка (спека 4.1). Значение хранится в записи (docType),
// подпись показывается пользователю. Расширять — здесь, в одном месте.
export const DOC_TYPES = [
  { value: 'passport_rf', label: 'Паспорт РФ' },
  { value: 'passport_intl', label: 'Загранпаспорт' },
  { value: 'visa', label: 'Виза' },
  { value: 'snils', label: 'СНИЛС' },
  { value: 'inn', label: 'ИНН' },
  { value: 'oms', label: 'Полис ОМС' },
  { value: 'dms', label: 'Полис ДМС' },
  { value: 'license', label: 'Водительское удостоверение' },
  { value: 'certificate', label: 'Свидетельство' },
  { value: 'other', label: 'Иное' },
];

export function docTypeLabel(value) {
  const t = DOC_TYPES.find((d) => d.value === value);
  return t ? t.label : '';
}

// --- разбор бинаря ---

export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const isAccepted = (mime) => ACCEPTED_MIME.includes(mime);

// Определение типа по «магическим байтам» — не доверяем расширению/заявленному MIME.
export function detectMime(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'; // %PDF
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'; // RIFF....WEBP
  // HEIC/HEIF (1.2.23, C8): ....ftypheic / heix / hevc / mif1 / msf1. Узнаём, чтобы честно сказать
  // «формат не поддерживается», а не молча не добавить фото (WebView HEIC не рисует).
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return null;
}

// Почему фото нельзя добавить (C8): 'heic' - формат HEIC/HEIF (узнаём по байтам, заявленному типу
// или расширению); 'unsupported' - не картинка и не PDF; null - всё в порядке.
export function imageProblem({ mime = '', declared = '', name = '' } = {}) {
  const m = String(mime).toLowerCase(), d = String(declared).toLowerCase(), n = String(name).toLowerCase();
  if (/heic|heif/.test(m) || /heic|heif/.test(d) || /\.(heic|heif)$/.test(n)) return 'heic';
  if (!isAccepted(m)) return 'unsupported';
  return null;
}
export const IMAGE_PROBLEM_TEXT = {
  heic: 'Фото в формате HEIC не поддерживается. Выберите JPG или PNG, или включите в настройках камеры совместимый формат (JPG) и сделайте снимок ещё раз.',
  unsupported: 'Этот файл не картинка и не PDF. Выберите фото (JPG, PNG, WEBP) или PDF.',
  broken: 'Не удалось обработать фото (слишком большое или повреждённое). Попробуйте другое фото или сделайте снимок ещё раз.',
};

// data:URL (из FileReader.readAsDataURL) → { mime, bytes }. mime уточняем по содержимому.
export function parseDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  const m = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(s);
  if (!m) throw new Error('Не удалось прочитать файл.');
  const declared = m[1] || '';
  const isB64 = !!m[2];
  const bytes = isB64 ? unb64(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
  const mime = detectMime(bytes) || declared || 'application/octet-stream';
  return { mime, bytes };
}

// --- модель страниц (вложений) записи документа ---

// Страница = один скан: картинка или PDF. data — base64 (round-trip через AES-GCM без потерь).
export function createPage({ name, mime, data }) {
  if (!isAccepted(mime)) throw new Error('Поддерживаются картинки (JPG/PNG/WEBP) и PDF.');
  return {
    id: globalThis.crypto.randomUUID(),
    name: String(name || '').slice(0, 120) || (mime === 'application/pdf' ? 'Документ.pdf' : 'Скан'),
    mime,
    data: String(data || ''),
    addedAt: new Date().toISOString(),
  };
}

// Дефолтное имя для нового скана с камеры (заход 2 п.18): «Скан ДД.ММ.ГГГГ», без времени.
// Дата форматируется без локали (детерминированно) — чтобы имя было одинаковым и тестируемым.
export function scanDefaultName(date = new Date()) {
  const d = (date instanceof Date && !isNaN(date)) ? date : new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `Скан ${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function ensurePages(entry) {
  if (!Array.isArray(entry.pages)) entry.pages = [];
  return entry.pages;
}

export function addPage(entry, page) {
  ensurePages(entry).push(page);
  return entry;
}

export function removePage(entry, pageId) {
  const arr = ensurePages(entry);
  const i = arr.findIndex((p) => p.id === pageId);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}

export function reorderPages(entry, from, to) {
  const arr = ensurePages(entry);
  if (from < 0 || from >= arr.length) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
}

export function pageCount(entry) {
  return Array.isArray(entry && entry.pages) ? entry.pages.length : 0;
}

// Новый индекс кадра после удаления страницы из просмотрщика (заход 3 п.9: удаление скана
// прямо из окна просмотра). Кадров стало меньше (removedFrames) — держим индекс в пределах,
// стараясь остаться на том же месте. Отрицательный/пустой → 0. Пусто (все удалены) → -1.
export function frameIndexAfterRemoval(currentIdx, removedCount, newLength) {
  if (!(newLength > 0)) return -1;
  let idx = currentIdx - (removedCount > 0 ? removedCount : 0);
  if (idx < 0) idx = 0;
  if (idx > newLength - 1) idx = newLength - 1;
  return idx;
}

// --- даунскейл изображений (контроль размера vault) ---
// Только уменьшение, пропорции сохраняются. Возвращает целые пиксели.
export function fitDimensions(w, h, maxDim) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (!maxDim || (w <= maxDim && h <= maxDim)) return { w, h };
  const k = maxDim / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// --- захват кадра камеры → canvas (чистая математика, тестируема) ---
// Приводит кадр videoW×videoH к canvas с сохранением пропорций и ПОЛНЫМ содержимым.
// Заслон от бага «в файле только уголок»: весь исходный кадр (sx,sy,sw,sh = весь кадр)
// рисуется в весь canvas (dx,dy=0; dw,dh = размер canvas). canvas = fitDimensions —
// пропорции те же, что у кадра, ничего не обрезается и не растягивается.
// Возвращает всё, что нужно для canvas.width/height и ctx.drawImage(video, sx,sy,sw,sh, dx,dy,dw,dh).
export function captureCanvasPlan(videoW, videoH, maxDim) {
  const sw = Math.max(1, Math.round(videoW));
  const sh = Math.max(1, Math.round(videoH));
  const { w: canvasW, h: canvasH } = fitDimensions(sw, sh, maxDim);
  return {
    canvasW, canvasH,
    sx: 0, sy: 0, sw, sh,           // источник — ВЕСЬ кадр
    dx: 0, dy: 0, dw: canvasW, dh: canvasH, // назначение — ВЕСЬ canvas
  };
}

// --- математика зума/пана (просмотрщик) ---

export function clampScale(scale, min, max) {
  if (!(scale > 0)) return min;
  return Math.min(max, Math.max(min, scale));
}

// Тумблер по двойному тапу: если близко к минимуму — приблизить, иначе вернуть к минимуму.
export function doubleTapScale(current, min, max) {
  const target = Math.min(max, min * 2.5);
  return current > min * 1.05 ? min : target;
}

// Ограничить сдвиг так, чтобы содержимое не «улетало» за пределы вида.
// При масштабе, когда контент меньше вида, центрируем (сдвиг 0).
export function constrainTranslate(tx, ty, scale, viewW, viewH, contentW, contentH) {
  const cw = contentW * scale;
  const ch = contentH * scale;
  const maxX = Math.max(0, (cw - viewW) / 2);
  const maxY = Math.max(0, (ch - viewH) / 2);
  return {
    tx: Math.min(maxX, Math.max(-maxX, tx)),
    ty: Math.min(maxY, Math.max(-maxY, ty)),
  };
}

// --- навигация по кадрам (картинка = 1 кадр, PDF = N кадров) ---
// pdfCounts: { [pageId]: числоСтраницPdf }. Для картинок и неизвестных PDF — 1 кадр.
export function buildFrames(pages, pdfCounts = {}) {
  const frames = [];
  for (const p of pages || []) {
    if (p.mime === 'application/pdf') {
      const n = Math.max(1, Number(pdfCounts[p.id]) || 1);
      for (let sub = 0; sub < n; sub++) frames.push({ pageId: p.id, mime: p.mime, sub });
    } else {
      frames.push({ pageId: p.id, mime: p.mime, sub: 0 });
    }
  }
  return frames;
}

// --- срок действия ---
// Срок документа хранится как ПОЛНАЯ дата ДД.ММ.ГГГГ (18 п.10; цифрами с маской, без
// нативного календаря). Статус считаем от конца указанного дня. Пустое/неполное — 'none'.
// Совместимость: понимаем и старый ММ/ГГ (8e п.13, конец месяца), и очень старый ISO
// (YYYY-MM-DD) — чтобы записи из прежних версий не «протухали» и не падали.
const DAY = 86400000;

// Живая маска ввода полной даты: цифры → ДД.ММ.ГГГГ (макс 8 цифр).
//   '' → ''; '3' → '3'; '31' → '31'; '3112' → '31.12'; '31122029' → '31.12.2029'.
export function formatDocDate(str) {
  const d = String(str == null ? '' : str).replace(/\D+/g, '').slice(0, 8);
  if (!d) return '';
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.slice(0, 2) + '.' + d.slice(2);
  return d.slice(0, 2) + '.' + d.slice(2, 4) + '.' + d.slice(4);
}

// Живая маска даты при наборе В КОНЦЕ (1.2.25): введённая точка уважается. formatDocDate считал
// только цифры, и «1.3.98» по символу превращалось в «13.98» (точка после одной цифры съедалась).
// Теперь разделитель (. / - пробел запятая) закрывает текущую часть: день/месяц из одной цифры
// дополняется нулём («1.» -> «01.», «01.3.» -> «01.03.»), дальше год. Без разделителей - как раньше:
// после двух цифр дня/месяца точка ставится сама («01031998» -> «01.03.1998»). Год - до 4 цифр,
// лишнее и буквы отбрасываются. Правку в середине маска не видит (endOnlyMask), сюда приходит
// только набор/вставка в конец.
export function formatDocDateLive(str) {
  const s = String(str == null ? '' : str);
  const buf = ['', '', ''];
  let f = 0;
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      if (f < 2 && buf[f].length === 2) f++;          // день/месяц заполнен - точка сама
      if (f === 2 && buf[2].length >= 4) continue;    // год не длиннее 4 цифр
      buf[f] += ch;
    } else if (/[.\/\-\s,]/.test(ch)) {
      if (f < 2 && buf[f].length) { buf[f] = buf[f].padStart(2, '0'); f++; }   // введённая точка закрывает часть
    }
  }
  if (f === 0) return buf[0];
  if (f === 1) return buf[0] + '.' + buf[1];
  return buf[0] + '.' + buf[1] + '.' + buf[2];
}

// Разбор даты: { dd, mm, yyyy, valid, text }. valid — реальная календарная дата (учитываем
// длину месяца и високосность через нормализацию Date), год 1900..2100. Смягчение (п.5):
// принимаем И полную дату ДД.ММ.ГГГГ (8 цифр), И короткую ДД.ММ.ГГ (6 цифр, год ГГ → 20ГГ).
// text всегда канонический ДД.ММ.ГГГГ (короткий год разворачивается в 20ГГ) — так в vault
// хранится единый формат, а expiryEndMs/статус срока считаются одинаково.
export function parseDocDate(str) {
  const d = String(str == null ? '' : str).replace(/\D+/g, '').slice(0, 8);
  const dd = d.slice(0, 2), mm = d.slice(2, 4);
  const day = Number(dd), mon = Number(mm);
  let year = NaN;
  if (d.length === 6) year = 2000 + Number(d.slice(4, 6));   // ДД.ММ.ГГ → 20ГГ
  else if (d.length === 8) year = Number(d.slice(4, 8));     // ДД.ММ.ГГГГ
  let valid = false;
  if ((d.length === 6 || d.length === 8) && mon >= 1 && mon <= 12 && day >= 1 && year >= 1900 && year <= 2100) {
    const dt = new Date(year, mon - 1, day);
    valid = dt.getFullYear() === year && dt.getMonth() === mon - 1 && dt.getDate() === day;
  }
  const yyyy = valid ? String(year) : d.slice(4, 8);
  const text = valid ? `${dd}.${mm}.${String(year).padStart(4, '0')}` : formatDocDate(d);
  return { dd, mm, yyyy, valid, text };
}

// Приведение введённой даты к ДД.ММ.ГГГГ на blur/сохранении (1.2.24, 0b). Маска больше не
// переписывает поле посреди правки, поэтому после правки в середине там может быть «1.3.2029» или
// «12.3.2029». Если в строке есть разделители - берём части как есть и дополняем день/месяц нулём
// (подсчёт по цифрам склеил бы «12.3.2029» в «12.32.029»); только цифры - обычная маска. Иначе
// (мусор) - строка без изменений: проверка на сохранении скажет, что не так.
export function normalizeDocDateInput(str) {
  const s = String(str == null ? '' : str).trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\s*[.\/\-\s]\s*(\d{1,2})\s*[.\/\-\s]\s*(\d{2}|\d{4})$/);
  if (m) return m[1].padStart(2, '0') + '.' + m[2].padStart(2, '0') + '.' + m[3];
  if (/^\d+$/.test(s)) return formatDocDate(s);
  return s;
}

// Человеческий вид срока для карточки: ДД.ММ.ГГГГ как есть; старый ISO → ДД.ММ.ГГГГ;
// старый ММ/ГГ оставляем как есть (это уже читаемо). Пустое → ''.
export function formatDocExpiryDisplay(str) {
  const s = String(str == null ? '' : str).trim();
  if (!s) return '';
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return iso[3] + '.' + iso[2] + '.' + iso[1];
  return s;   // legacy ММ/ГГ
}

// Конец срока в мс, либо NaN. Понимает 'ДД.ММ.ГГГГ' и 'ДД.ММ.ГГ' (конец дня; короткий год
// ГГ → 20ГГ, п.5), старое 'ММ/ГГ' (конец месяца) и очень старое ISO-'YYYY-MM-DD' (конец дня).
export function expiryEndMs(str) {
  const s = String(str == null ? '' : str).trim();
  if (!s) return NaN;
  // Полная дата ДД.ММ.ГГГГ или короткая ДД.ММ.ГГ (год 2 цифры → 20ГГ).
  const dotted = s.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
  if (dotted) {
    const day = Number(dotted[1]), mon = Number(dotted[2]);
    const year = dotted[3].length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3]);
    if (!(mon >= 1 && mon <= 12 && day >= 1 && day <= 31)) return NaN;
    const dt = new Date(year, mon - 1, day, 23, 59, 59, 999);
    if (dt.getFullYear() !== year || dt.getMonth() !== mon - 1 || dt.getDate() !== day) return NaN;
    return dt.getTime();
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);       // очень старый формат календаря
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 23, 59, 59, 999).getTime();
  const digits = s.replace(/\D+/g, '');                  // старый ММ/ГГ
  if (digits.length !== 4) return NaN;
  const mm = Number(digits.slice(0, 2)), yy = Number(digits.slice(2, 4));
  if (!(mm >= 1 && mm <= 12)) return NaN;
  const year = 2000 + yy;
  return new Date(year, mm, 0, 23, 59, 59, 999).getTime();  // day 0 следующего = последний день mm
}

// 1.2.23 (C5): срок считаем по КАЛЕНДАРНЫМ дням (полночь к полуночи, местное время), а не по
// 24-часовым отрезкам от текущего момента. Раньше в 10:00 срок «через 30 дней» был уже «ok», а
// срок, кончающийся сегодня вечером, показывался как «через 1 дн.». Теперь: 0 - «истекает
// сегодня», 1..30 - «через N дн.», <0 - «истёк». Номер дня - через Date.UTC (без сдвига летнего времени).
function dayNumber(ms) {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

// Сколько КАЛЕНДАРНЫХ дней осталось до дня окончания срока (для бейджа, п.3). 0 - срок кончается
// сегодня; отрицательное - просрочка (бейдж «истёк» без N). NaN для нераспознанной/пустой даты.
export function expiryDaysLeft(str, now = Date.now()) {
  const t = expiryEndMs(str);
  if (isNaN(t)) return NaN;
  return dayNumber(t) - dayNumber(now);
}

export function expiryStatus(str, now = Date.now()) {
  const n = expiryDaysLeft(str, now);
  if (isNaN(n)) return 'none';
  if (n < 0) return 'expired';
  if (n <= 30) return 'soon';
  return 'ok';
}

// Подпись бейджа срока (C5): 0 - «истекает сегодня», иначе «истекает через N дн.»; просрочка - «истёк».
export function expiryBadgeText(str, now = Date.now()) {
  const st = expiryStatus(str, now);
  if (st === 'expired') return 'истёк';
  if (st !== 'soon') return '';
  const n = expiryDaysLeft(str, now);
  return n === 0 ? 'истекает сегодня' : 'истекает через ' + n + ' дн.';
}

// Дата выдачи (1.2.24, п.7) - разбор как у срока, НО короткий год ГГ читается в прошлом: выдан
// документ всегда не позже сегодняшнего дня. «15.03.98» -> 1998 (раньше 2098). ГГ -> 20ГГ, если это
// не позже текущего года, иначе 19ГГ. future - дата позже сегодняшнего дня (на сохранении - отказ).
// Возврат как у parseDocDate + { future }.
export function parseIssueDate(str, now = Date.now()) {
  const d = String(str == null ? '' : str).replace(/\D+/g, '').slice(0, 8);
  let src = str;
  if (d.length === 6) {
    const yy = Number(d.slice(4, 6));
    const cur = new Date(now).getFullYear();
    const year = 2000 + yy <= cur ? 2000 + yy : 1900 + yy;
    src = d.slice(0, 4) + String(year);
  }
  const p = parseDocDate(src);
  let future = false;
  if (p.valid) future = dayNumber(new Date(Number(p.yyyy), Number(p.mm) - 1, Number(p.dd)).getTime()) > dayNumber(now);
  return { ...p, future };
}

// Дата выдачи документа (1.2.23, C3): хранится ДД.ММ.ГГГГ (маска и разбор как у срока). Показ в
// карточке - без перестановки дня и месяца: ядро (ui.js) делает new Date('03.04.2020'), а JS
// читает это как ММ.ДД -> «выдан 04.03.2020». Старое ISO 'ГГГГ-ММ-ДД' (прежний календарь) -> ДД.ММ.ГГГГ.
export function formatIssueDateDisplay(str) {
  const s = String(str == null ? '' : str).trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + '.' + iso[2] + '.' + iso[1];
  const p = parseIssueDate(s);
  if (p.valid) return p.text;
  return s;
}

// Приведение дат на blur (1.2.25, п.8): после ухода из поля дата ВСЕГДА в виде ДД.ММ.ГГГГ, если
// это реальная дата («1.3.98» -> «01.03.1998», а не «01.03.98»). Короткий год: у даты выдачи - в
// прошлом (ГГ позже текущего года -> 19ГГ, parseIssueDate), у срока действия - 20ГГ (parseDocDate).
// Нераспознанное - как normalizeDocDateInput (части дополнены нулём), проверка на сохранении скажет.
export function normalizeIssueDateInput(str, now = Date.now()) {
  const n = normalizeDocDateInput(str);
  if (!n) return '';
  const p = parseIssueDate(n, now);
  return p.valid ? p.text : n;
}
export function normalizeExpiryDateInput(str) {
  const n = normalizeDocDateInput(str);
  if (!n) return '';
  const p = parseDocDate(n);
  return p.valid ? p.text : n;
}

// Решение по дате выдачи на сохранении (1.2.25, п.8). raw - значение поля, old - дата записи до правки.
//   { ok:true, value } - сохранить value (ДД.ММ.ГГГГ; пусто - '');
//   { ok:false, reason:'future', text } - дата ещё не наступила;  { ok:false, reason:'format' }.
// Нетронутое старое значение НЕ блокирует сохранение (как у сроков): запись, у которой старая версия
// сохранила дату выдачи в будущем (например 15.03.2098 из «15.03.98» в 1.2.23), правится свободно,
// если поле не трогали; дата остаётся как была.
export function checkIssueDate(raw, old = '', now = Date.now()) {
  const src = String(raw == null ? '' : raw).trim();
  const n = normalizeDocDateInput(src);
  if (!n) return { ok: true, value: '' };
  const oldShown = formatIssueDateDisplay(old);
  const untouched = !!oldShown && (src === oldShown || n === oldShown);
  const p = parseIssueDate(n, now);
  if (p.valid && !p.future) return { ok: true, value: p.text };
  if (untouched) return { ok: true, value: String(old), untouched: true };
  if (p.valid) return { ok: false, reason: 'future', text: p.text };
  return { ok: false, reason: 'format' };
}
