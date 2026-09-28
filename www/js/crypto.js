// Криптоядро «Сейфа». Работает на globalThis.crypto.subtle — в браузере и в Node ≥ 20.
// Данные шифруются AES-256-GCM ключом DEK. DEK обёрнут дважды:
//   pwWrap    — ключом из мастер-пароля (PBKDF2),
//   helloWrap — ключом из секрета Windows Hello (WebAuthn PRF).
// Ключа шифрования в файле нет — только обёртки.
const subtle = globalThis.crypto.subtle;

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
export const enc = (s) => new TextEncoder().encode(s);
export const dec = (b) => new TextDecoder().decode(b);
export function b64(b) {
  const u = new Uint8Array(b);
  let s = '';
  const chunk = 0x8000; // без spread — не переполняет стек на больших данных
  for (let i = 0; i < u.length; i += chunk) s += String.fromCharCode.apply(null, u.subarray(i, i + chunk));
  return btoa(s);
}
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKEK(password, salt, iterations = 600000) {
  const base = await subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
export async function importDEK(raw) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function aesEncrypt(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv, ct };
}
export async function aesDecrypt(key, iv, ct) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}
export const wrapDEK = (kek, dekRaw) => aesEncrypt(kek, dekRaw);
export const unwrapDEK = (kek, iv, ct) => aesDecrypt(kek, iv, ct);
export async function encryptJSON(dek, obj) { return aesEncrypt(dek, enc(JSON.stringify(obj))); }
export async function decryptJSON(dek, iv, ct) { return JSON.parse(dec(await aesDecrypt(dek, iv, ct))); }

// --- Формат файла хранилища ---
const packBlob = ({ iv, ct }) => ({ iv: b64(iv), ct: b64(ct) });
const unpackBlob = (o) => ({ iv: unb64(o.iv), ct: unb64(o.ct) });

async function importRawAesKey(raw) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function newVaultFile(password, vaultObj) {
  const salt = randomBytes(16);
  const iterations = 600000;
  const kek = await deriveKEK(password, salt, iterations);
  const dekRaw = randomBytes(32);
  const dek = await importDEK(dekRaw);
  const pwWrap = await wrapDEK(kek, dekRaw);
  const data = await encryptJSON(dek, vaultObj);
  return {
    v: 1,
    kdf: { salt: b64(salt), iterations },
    pwWrap: packBlob(pwWrap),
    helloWrap: null,
    data: packBlob(data),
  };
}

export async function unlockWithPassword(file, password) {
  const salt = unb64(file.kdf.salt);
  const kek = await deriveKEK(password, salt, file.kdf.iterations);
  const w = unpackBlob(file.pwWrap);
  const dekRaw = await unwrapDEK(kek, w.iv, w.ct); // бросит при неверном пароле
  const dek = await importDEK(dekRaw);
  const d = unpackBlob(file.data);
  const vault = await decryptJSON(dek, d.iv, d.ct);
  return { dek, vault, dekRaw };
}

export async function reencryptData(file, dek, vaultObj) {
  const data = await encryptJSON(dek, vaultObj);
  return { ...file, data: packBlob(data) };
}

// Смена мастер-пароля: перевязываем ТУ ЖЕ DEK новым паролем (данные и отпечаток не трогаем).
export async function rewrapPassword(file, dekRaw, newPassword) {
  const salt = randomBytes(16);
  const iterations = 600000;
  const kek = await deriveKEK(newPassword, salt, iterations);
  const w = await wrapDEK(kek, dekRaw);
  return { ...file, kdf: { salt: b64(salt), iterations }, pwWrap: packBlob(w) };
}

// Привязка Hello: оборачиваем сырой DEK (известен в момент разблокировки) ключом из PRF-секрета.
export async function attachHelloRaw(file, dekRaw, prfKeyRaw, credentialId) {
  const kek = await importRawAesKey(prfKeyRaw);
  const w = await wrapDEK(kek, dekRaw);
  return { ...file, helloWrap: { iv: b64(w.iv), ct: b64(w.ct), credentialId: b64(credentialId) } };
}

export async function unlockWithHello(file, prfKeyRaw) {
  const kek = await importRawAesKey(prfKeyRaw);
  const w = unpackBlob(file.helloWrap);
  const dekRaw = await unwrapDEK(kek, w.iv, w.ct);
  const dek = await importDEK(dekRaw);
  const d = unpackBlob(file.data);
  const vault = await decryptJSON(dek, d.iv, d.ct);
  return { dek, vault, dekRaw };
}
