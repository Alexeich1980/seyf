// totp.js — одноразовые коды TOTP (RFC 6238) полностью офлайн (только мобайл, не ядро).
// HMAC берём у globalThis.crypto.subtle (как всё крипто «Сейфа» — доступно в WebView и Node ≥20);
// счётчик времени, усечение (RFC 4226) и модуль цифр — свой код (это и есть проверяемая логика).
// Никаких сетевых вызовов и сервисов Google: секрет → код считается на устройстве.
const subtle = globalThis.crypto.subtle;

// Параметры по умолчанию (спека 4.3): 6 цифр, окно 30 секунд, алгоритм SHA-1.
export const TOTP_DEFAULTS = { digits: 6, period: 30, algorithm: 'SHA-1' };

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Декод base32 (RFC 4648): регистр не важен, пробелы/дефисы/паддинг «=» игнорируются,
// любой другой символ — ошибка (чтобы не принять мусор за секрет). Возвращает Uint8Array.
export function base32Decode(str) {
  const clean = String(str == null ? '' : str).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean) throw new Error('пустой секрет');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('недопустимый символ base32: ' + ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// Счётчик → 8-байтный big-endian буфер (поддержка значений > 32 бит).
function counterBytes(counter) {
  const buf = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  return buf;
}

// HOTP (RFC 4226): HMAC(secret, counter) → динамическое усечение → код на `digits` цифр.
export async function hotp(secretBytes, counter, { digits = TOTP_DEFAULTS.digits, algorithm = TOTP_DEFAULTS.algorithm } = {}) {
  const key = await subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  const mac = new Uint8Array(await subtle.sign('HMAC', key, counterBytes(counter)));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  const code = bin % 10 ** digits;
  return String(code).padStart(digits, '0');
}

// TOTP (RFC 6238): counter = floor(секунды / период), T0 = 0. `time` — в миллисекундах.
export async function generateTOTP(secret, { time = Date.now(), digits, period, algorithm } = {}) {
  const d = digits || TOTP_DEFAULTS.digits;
  const p = period || TOTP_DEFAULTS.period;
  const alg = algorithm || TOTP_DEFAULTS.algorithm;
  const bytes = base32Decode(secret);
  const counter = Math.floor(Math.floor(time / 1000) / p);
  return hotp(bytes, counter, { digits: d, algorithm: alg });
}

// Сколько секунд до смены кода. `remaining` в диапазоне (0..period]: ровно на границе окна
// показываем полный период, а не 0 (индикатор не «моргает» в ноль перед сменой).
export function totpProgress(time = Date.now(), period = TOTP_DEFAULTS.period) {
  const sec = Math.floor(time / 1000);
  const elapsed = sec % period;
  return { remaining: period - elapsed, period };
}

// Нормализация имени алгоритма из URI (SHA1/SHA256/SHA512 → форма WebCrypto).
function normalizeAlg(raw) {
  const a = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (a === 'SHA256') return 'SHA-256';
  if (a === 'SHA512') return 'SHA-512';
  return 'SHA-1';
}

function clampInt(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// 1.2.23 (B6): разумные границы параметров из QR. Раньше digits=999 / period=99999999 из чужого
// QR принимались как есть (код в 999 цифр, окно на три года). Вне границ - значение по умолчанию.
export const TOTP_LIMITS = { digitsMin: 6, digitsMax: 8, periodMin: 10, periodMax: 300, secretMinChars: 16 };
export function safeDigits(raw) {
  const n = clampInt(raw, TOTP_DEFAULTS.digits);
  return (n >= TOTP_LIMITS.digitsMin && n <= TOTP_LIMITS.digitsMax) ? n : TOTP_DEFAULTS.digits;
}
export function safePeriod(raw) {
  const n = clampInt(raw, TOTP_DEFAULTS.period);
  return (n >= TOTP_LIMITS.periodMin && n <= TOTP_LIMITS.periodMax) ? n : TOTP_DEFAULTS.period;
}
// Ключ 2FA достаточной длины: не меньше 16 символов base32 (80 бит, минимум RFC 4226). Короче -
// почти наверняка обрезанный/ошибочный ключ (коды не совпадут с сервисом).
export function secretLongEnough(secret) {
  const clean = String(secret == null ? '' : secret).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  return clean.length >= TOTP_LIMITS.secretMinChars;
}
// decodeURIComponent без исключения (B6): битая %-последовательность в подписи QR раньше бросала
// URIError прямо в обработчике сканера - сканер зависал. Не разобрали - берём как есть.
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

// Разбор стандартного otpauth://totp/<label>?secret=…&issuer=…&digits=…&period=…&algorithm=…
// Чистая функция (без камеры/DOM) — на ней держится тест парсера. Возвращает
// { ok:true, name, secret, issuer, account, digits, period, algorithm } либо { ok:false, error }.
export function parseOtpauth(uri) {
  let url;
  try {
    url = new URL(String(uri == null ? '' : uri));
  } catch {
    return { ok: false, error: 'Это не тот код. Отсканируйте QR из настроек двухфакторки сервиса.' };
  }
  if (url.protocol !== 'otpauth:') {
    return { ok: false, error: 'Это не код для входа. Отсканируйте QR из настроек двухфакторки сервиса.' };
  }
  if (url.host.toLowerCase() !== 'totp') {
    return { ok: false, error: 'Поддерживаются только коды, которые меняются по времени.' };
  }
  const secretRaw = url.searchParams.get('secret');
  if (!secretRaw) {
    return { ok: false, error: 'В этом QR нет ключа - возможно, отсканирован не тот код.' };
  }
  let secret;
  try {
    base32Decode(secretRaw);
    secret = secretRaw.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  } catch {
    return { ok: false, error: 'Ключ в этом QR не распознан.' };
  }
  if (!secretLongEnough(secret)) return { ok: false, error: 'Ключ в этом QR слишком короткий - отсканируйте QR из настроек двухфакторки сервиса.' };
  const label = safeDecode(url.pathname.replace(/^\//, ''));
  const colon = label.indexOf(':');
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : '';
  const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const issuer = (url.searchParams.get('issuer') || labelIssuer || '').trim();
  const name = issuer && account ? `${issuer} (${account})` : (issuer || account || 'Код 2FA');
  return {
    ok: true,
    name,
    secret,
    issuer,
    account,
    digits: safeDigits(url.searchParams.get('digits')),
    period: safePeriod(url.searchParams.get('period')),
    algorithm: normalizeAlg(url.searchParams.get('algorithm')),
  };
}
