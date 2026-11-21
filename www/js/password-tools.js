// Local-only password tools. Never infer entropy from a user's string.
import { BIP39_EN } from './bip39-wordlist.js';

export const PASSPHRASE_WORDS = 6;
export const PASSPHRASE_ENTROPY_BITS = 66; // 6 independent draws, log2(2048) = 11 each.

export function randomIndex(size) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 0x100000000) throw new RangeError('Invalid pool size');
  const limit = Math.floor(0x100000000 / size) * size;
  const buffer = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % size;
}

export function generateArchivePassword() {
  if (BIP39_EN.length !== 2048 || new Set(BIP39_EN).size !== 2048) throw new Error('Invalid word list');
  // Repeated words are allowed: conditioning on uniqueness would change the distribution.
  return Array.from({ length: PASSPHRASE_WORDS }, () => BIP39_EN[randomIndex(2048)]).join('-');
}

export function generatePassword({ length = 18, noSymbols = false } = {}) {
  if (!Number.isInteger(length) || length < 8 || length > 32) throw new RangeError('Length must be 8–32');
  const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' + (noSymbols ? '' : '!@#$%^&*()-_=+[]{};:,.?');
  return Array.from({ length }, () => pool[randomIndex(pool.length)]).join('');
}

export function assessPassword(password) {
  const s = typeof password === 'string' ? password.normalize('NFC') : '';
  const reasons = [];
  if ([...s].length < 16) reasons.push('short');
  const folded = s.toLowerCase().replace(/[013457@$!]/g, c => ({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s','!':'i'})[c]);
  if (/(password|passwd|qwerty|letmein|welcome|iloveyou|admin|парол|йцукен|привет|секрет)/u.test(folded)) reasons.push('common');
  if (/(.{1,32})\1{2,}/u.test(s) || /^(.*)\1$/u.test(s) || new Set(s).size < 8) reasons.push('repeated');
  const rows = ['01234567890', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'йцукенгшщзхъ', 'фывапролджэ'];
  if (rows.some(row => [row, [...row].reverse().join('')].some(r => Array.from({ length: r.length - 3 }, (_, i) => r.slice(i, i + 4)).some(part => s.toLowerCase().includes(part))))) reasons.push('sequence');
  const classes = [/[a-zа-яё]/u, /[A-ZА-ЯЁ]/u, /\d/u, /[^\p{L}\p{N}\s]/u].filter(re => re.test(s)).length;
  // Words, dates and decorated sentences have unknown provenance. Do not label them
  // strong merely because they are long or resemble output of a random generator.
  const wordCount = (s.match(/(?:^|[\s_-])\p{L}{2,}(?=[\s_-]|$)/gu) || []).length;
  if (wordCount >= 3 || /\s/u.test(s) || /\p{L}{5,}/u.test(s) || /(?:19|20)\d{2}/u.test(s) || classes < 3) reasons.push('human-pattern');
  const weak = reasons.some(reason => reason !== 'human-pattern');
  const status = weak ? 'weak' : reasons.length ? 'unknown' : 'no-obvious-weakness';
  // Unknown is not evidence of weakness, nor permission to accept a new archive password.
  return { weak, status, needsReview: reasons.length > 0, reasons, entropyBits: null };
}

// Results deliberately contain no password, hash, login, URL or arbitrary custom field.
// Only live section entries are visited; vault.trash is never traversed.
export function auditPasswords(vault) {
  const rows = [], groups = new Map();
  let unknownCount = 0;
  for (const [section, entries] of Object.entries(vault?.sections || {})) {
    if (!Array.isArray(entries) || section === 'trash') continue;
    for (const entry of entries) {
      if (!entry || entry.deleted || entry.deletedAt || entry.trashed || entry.trashedAt || typeof entry.password !== 'string' || !entry.password) continue;
      const assessment = assessPassword(entry.password);
      if (assessment.status === 'unknown') unknownCount++;
      const row = { section, id: entry.id, title: String(entry.description || entry.name || 'Без названия'), weak: assessment.weak, duplicate: false };
      rows.push(row);
      // Exact comparison: case, whitespace and Unicode differences are significant for services.
      const group = groups.get(entry.password) || [];
      group.push(row); groups.set(entry.password, group);
    }
  }
  let duplicateGroups = 0;
  for (const group of groups.values()) if (group.length > 1) { duplicateGroups++; for (const row of group) row.duplicate = true; }
  groups.clear();
  return { checked: rows.length, unknownCount, weakCount: rows.filter(r => r.weak).length, duplicateCount: rows.filter(r => r.duplicate).length, duplicateGroups, items: rows.filter(r => r.weak || r.duplicate) };
}
