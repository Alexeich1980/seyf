import { WORDLIST } from './wordlist.js';

const rand = (max) => {
  // Равномерное случайное 0..max-1 на криптостойком источнике (без смещения по модулю).
  const a = new Uint32Array(1);
  const limit = Math.floor(0xFFFFFFFF / max) * max;
  let x;
  do { globalThis.crypto.getRandomValues(a); x = a[0]; } while (x >= limit);
  return x % max;
};
const pick = (arr) => arr[rand(arr.length)];

export function generatePassword(opts = {}) {
  const { length = 16, upper = true, lower = true, digits = true, symbols = true, avoidAmbiguous = false } = opts;
  let U = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", L = "abcdefghijklmnopqrstuvwxyz",
      D = "0123456789", S = "!@#$%^&*()-_=+[]{};:,.?";
  if (avoidAmbiguous) { U = U.replace(/[OI]/g, ''); L = L.replace(/[l]/g, ''); D = D.replace(/[01]/g, ''); }
  let pool = "";
  if (upper) pool += U; if (lower) pool += L; if (digits) pool += D; if (symbols) pool += S;
  if (!pool) pool = L;
  let out = "";
  for (let i = 0; i < length; i++) out += pool[rand(pool.length)];
  return out;
}

export function generatePassphrase(opts = {}) {
  const { words = 5, separator = '-', capitalize = true, number = true } = opts;
  const parts = [];
  for (let i = 0; i < words; i++) {
    let w = pick(WORDLIST);
    if (capitalize) w = w[0].toUpperCase() + w.slice(1);
    parts.push(w);
  }
  let p = parts.join(separator);
  if (number) p += separator + rand(100);
  return p;
}

export function estimateStrength(pw) {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 24;
  const bits = pw.length ? Math.round(pw.length * Math.log2(pool || 1)) : 0;
  let score = 0;
  if (bits >= 40) score = 1;
  if (bits >= 60) score = 2;
  if (bits >= 80) score = 3;
  if (bits >= 100) score = 4;
  const label = ["очень слабый", "слабый", "средний", "надёжный", "очень надёжный"][score];
  return { bits, score, label };
}
