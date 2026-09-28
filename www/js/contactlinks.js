// contactlinks.js — безопасные ссылки для раздела «Контакты» (mobile-only, чистая логика).
// Две функции строят href для системного открытия: телефон → tel:, мессенджер/ссылка →
// разрешённая схема. Открытие делает app.openExternal (window.open _system), здесь только
// валидация и нормализация — на них тест (без DOM). Заслон: любую иную схему (javascript:,
// data:, file: и т.п.) режем в null, чтобы не пустить инъекцию в системный обработчик.

// tel: из телефона. Оставляем ведущий + и цифры, прочее (пробелы, скобки, дефисы) убираем.
// Меньше 3 цифр — не телефон (кнопки не будет).
// 1.2.23 (B6): хвост после ';' или ',' (добавочный/пауза) отрезаем - раньше его цифры
// приклеивались к номеру ('+7999;ext=1' -> tel:+79991, звонок не туда). Символы * и # (USSD-коды
// переадресации вида *21*...#) в tel: не пропускаем - остаются только + и цифры.
export function telHref(v) {
  const s = String(v == null ? '' : v).trim().replace(/^tel:/i, '').split(/[;,]/)[0];
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 3) return null;
  const plus = cleaned.startsWith('+') ? '+' : '';
  return 'tel:' + plus + digits;
}

// Разрешённые схемы для «Открыть»: https/http/tel/tg/whatsapp. Уже со схемой — как есть.
// Голое значение, похожее на домен, → https://. Иная схема или мусор → null.
// 1.2.23 (B6): tel: из поля ссылки больше НЕ отдаётся как есть - только через telHref (цифры и +):
// иначе 'tel:*21*+7...#' открывал набор USSD-кода переадресации звонков. (C9) '@ник' - это
// Telegram: открываем https://t.me/ник.
const ALLOWED = /^(https?|tg|whatsapp):/i;
const TG_NICK = /^@([A-Za-z0-9_]{3,32})$/;
export function openableHref(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^tel:/i.test(s)) return telHref(s);
  const nick = TG_NICK.exec(s);
  if (nick) return 'https://t.me/' + nick[1];
  if (ALLOWED.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // иная схема — не открываем
  if (/^[\w-]+(\.[\w-]+)+(\/|$|\?)/.test(s)) return 'https://' + s; // похоже на домен/путь
  return null; // @ник, произвольный текст — открывать нечего (копирование остаётся)
}

// mailto: из адреса почты (п.10). Простая проверка: ровно один @, в домене есть точка и TLD,
// без пробелов. Не e-mail → null (кнопки «Написать» не будет, копирование остаётся).
// 1.2.23 (B6): адрес с '?' (или '&', '%') - это уже не адрес, а шаблон письма (?cc=, ?bcc=, ?body=):
// так можно тихо подставить скрытую копию или текст. Такое не открываем (копирование остаётся).
export function mailtoHref(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || /\s/.test(s) || /[?&%]/.test(s)) return null;
  const m = s.match(/^[^@]+@([^@]+)$/);
  if (!m) return null;
  if (!/\.[a-z]{2,}$/i.test(m[1])) return null;
  return 'mailto:' + s;
}

// Короткий умный лейбл ссылки для СВЁРНУТОЙ карточки контакта (п.9): вместо длинного URL —
// «Открыть <лейбл>». t.me → «Telegram», wa.me/whatsapp → «WhatsApp», mailto → «e-mail»,
// иначе — только домен (с хвостом «…», если за доменом есть путь/параметры). Чистая логика — тест.
function hostOf(s) {
  let r = String(s).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '');
  const m = r.match(/^([^/?#\s]+)([/?#].*)?$/);
  if (!m) return { host: '', tail: false };
  return { host: m[1].toLowerCase().replace(/^www\./, ''), tail: !!(m[2] && m[2].length) };
}
export function linkLabel(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if (low.startsWith('mailto:')) return 'e-mail';
  if (/^tg:/i.test(low)) return 'Telegram';
  if (/^whatsapp:/i.test(low)) return 'WhatsApp';
  if (TG_NICK.test(s)) return 'Telegram';
  const { host, tail } = hostOf(s);
  if (!host) return s;
  if (host === 't.me' || host.endsWith('.t.me')) return 'Telegram';
  if (host === 'wa.me' || host === 'whatsapp.com' || host.endsWith('.whatsapp.com')) return 'WhatsApp';
  return tail ? host + '…' : host;
}
