// license.js — офлайн-активация Полной версии по лицензионному ключу (заход 2 п.9).
// НЕ core (мобильная монетизация). Асимметрия: ECDSA P-256 + SHA-256 через WebCrypto —
// поддержана ЛЮБЫМ Android WebView (в отличие от Ed25519, который есть лишь в новых). В
// приложение вшит ТОЛЬКО ПУБЛИЧНЫЙ ключ; подписать валидный ключ можно лишь приватным
// (tools/license-key.json, НЕ в git). Поэтому ключ нельзя подделать, вытащив что-либо из APK.
//
// Формат ключа: "SEYF-PRO." + b64url(payloadJSON) + "." + b64url(signature).
// payload = { product:'seyf-pro', id, iat }. Подпись покрывает БАЙТЫ payloadJSON.
// Проверка чистой логики разбора — под тестом (без WebCrypto); сама криптопроверка —
// тестом с эфемерной парой ключей (тот же путь verifyToken), плюс тест-ключ Алексея на устройстве.

// Публичный ключ (raw uncompressed P-256, 65 байт, base64url). Пара сгенерирована
// tools/gen-license.mjs; приватная половина у Алексея и в git не попадает.
export const PUB_KEY_B64 = 'BPo5qGDNDuEYPLZpZa1elO4NMNqCpFqc-5z5fsiN8CSFUaENH98faP4f02O0sbo2i2OGosbI8CE5wVbfqkLMa40';

const PREFIX = 'SEYF-PRO.';

// base64url → Uint8Array (без исключений наружу: битый ключ → null у вызывающего).
function fromB64u(s) {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4 === 2 ? '==' : t.length % 4 === 3 ? '=' : '';
  const bin = atobSafe(t + pad);
  if (bin == null) return null;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function atobSafe(s) {
  try {
    if (typeof atob === 'function') return atob(s);
    return Buffer.from(s, 'base64').toString('binary');   // node-тест
  } catch { return null; }
}

// Чистый разбор ключа (без крипто): нормализует, режет префикс/пробелы, достаёт части.
// Возвращает { payloadB64, sigB64, payloadBytes, payload } или null. Под тест.
export function parseLicenseKey(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  // допускаем ключ с префиксом и без; регистр префикса не важен, пробелы/переводы внутри убираем
  s = s.replace(/\s+/g, '');
  if (s.toUpperCase().startsWith(PREFIX)) s = s.slice(PREFIX.length);
  const parts = s.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const payloadBytes = fromB64u(payloadB64);
  const sig = fromB64u(sigB64);
  if (!payloadBytes || !sig || payloadBytes.length === 0 || sig.length !== 64) return null;
  let payload = null;
  try { payload = JSON.parse(new TextDecoder().decode(payloadBytes)); } catch { return null; }
  if (!payload || typeof payload !== 'object' || payload.product !== 'seyf-pro') return null;
  return { payloadB64, sigB64, payloadBytes, sig, payload };
}

// Импорт публичного ключа (raw P-256) как CryptoKey для verify.
export async function importPublicKey(rawB64, subtle) {
  const raw = fromB64u(rawB64);
  if (!raw) throw new Error('bad public key');
  return subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

// Проверка ключа против ГОТОВОГО публичного CryptoKey (общий путь для теста и прод).
// Возвращает { valid, reason?, payload? }.
export async function verifyToken(raw, publicKey, subtle) {
  const parsed = parseLicenseKey(raw);
  if (!parsed) return { valid: false, reason: 'format' };
  let ok = false;
  try {
    ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, parsed.sig, parsed.payloadBytes);
  } catch { return { valid: false, reason: 'crypto' }; }
  return ok ? { valid: true, payload: parsed.payload } : { valid: false, reason: 'signature' };
}

// Прод-точка: проверка против ВШИТОГО публичного ключа. subtle/pubB64 инъектируются в тестах.
export async function verifyLicense(raw, opts = {}) {
  const subtle = opts.subtle || (typeof crypto !== 'undefined' && crypto.subtle) || null;
  if (!subtle) return { valid: false, reason: 'no-webcrypto' };
  let pub;
  try { pub = await importPublicKey(opts.publicKeyB64 || PUB_KEY_B64, subtle); }
  catch { return { valid: false, reason: 'no-webcrypto' }; }
  return verifyToken(raw, pub, subtle);
}
