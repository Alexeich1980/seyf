// Encrypted as part of the vault; never persist this module's data separately.
export const TRASH_VERSION = 1;
export const TRASH_RETENTION_MS = 30 * 86400000;
const safeSection = s => typeof s === 'string' && !['__proto__','prototype','constructor'].includes(s);
const stamp = now => { const n = now instanceof Date ? now.getTime() : now; if (!Number.isFinite(n) || !Number.isFinite(new Date(n).getTime())) throw new TypeError('Invalid time'); return n; };
function validate(vault) {
  if (!vault || !vault.sections || typeof vault.sections !== 'object') throw new TypeError('Invalid vault');
  if (vault.trash === undefined) return;
  const t = vault.trash;
  if (!t || t.version !== TRASH_VERSION || !Array.isArray(t.records)) throw new Error('Unsupported trash format');
  const ids = new Set();
  for (const r of t.records) {
    if (!r || typeof r.trashId !== 'string' || !r.trashId || ids.has(r.trashId) || !safeSection(r.section) || !r.entry || typeof r.entry !== 'object' || Array.isArray(r.entry) || typeof r.entry.id !== 'string' || !r.entry.id || typeof r.deletedAt !== 'string' || !Number.isFinite(Date.parse(r.deletedAt))) throw new Error('Invalid trash record');
    ids.add(r.trashId);
  }
}
export function ensureTrash(vault) {
  validate(vault);
  if (vault.trash === undefined) vault.trash = {version: TRASH_VERSION, records: []};
  return vault.trash;
}
export function moveToTrash(vault, section, id, now = Date.now()) {
  validate(vault); const deletedAt = new Date(stamp(now)).toISOString();
  if (!safeSection(section) || !Object.hasOwn(vault.sections, section) || !Array.isArray(vault.sections[section])) throw new Error('Unknown section');
  const list = vault.sections[section], index = list.findIndex(e => e.id === id);
  if (index < 0) return null;
  const entry = structuredClone(list[index]);
  if (typeof entry.id !== 'string' || !entry.id) throw new Error('Invalid entry ID');
  const used = new Set((vault.trash?.records || []).map(r=>r.trashId));
  let trashId; do { trashId = globalThis.crypto.randomUUID(); } while (used.has(trashId));
  const record = {trashId, section, entry, deletedAt};
  ensureTrash(vault).records.push(record); list.splice(index, 1);
  return record;
}
export function restoreFromTrash(vault, trashId) {
  validate(vault);
  const records = vault.trash?.records || [], index = records.findIndex(r=>r.trashId === trashId);
  if (index < 0) return null;
  const r = records[index];
  if (Object.hasOwn(vault.sections,r.section) && !Array.isArray(vault.sections[r.section])) throw new Error('Invalid destination');
  const list = vault.sections[r.section] || [], entry = structuredClone(r.entry);
  const ids = new Set(Object.values(vault.sections).filter(Array.isArray).flatMap(a=>a.map(e=>e.id)));
  while (ids.has(entry.id)) entry.id = globalThis.crypto.randomUUID();
  if (!Object.hasOwn(vault.sections,r.section)) vault.sections[r.section] = list;
  list.push(entry); records.splice(index,1); return entry;
}
export function purgeTrash(vault, trashId) {
  validate(vault); const records = vault.trash?.records || [], i = records.findIndex(r=>r.trashId === trashId);
  if (i < 0) return false; records.splice(i,1); return true;
}
export function pruneTrash(vault, now = Date.now()) {
  validate(vault); const cutoff = stamp(now) - TRASH_RETENTION_MS;
  if (!vault.trash) return 0;
  const records = vault.trash.records, kept = records.filter(r=>Date.parse(r.deletedAt)>cutoff);
  const count = records.length-kept.length;
  if (count) vault.trash.records = kept;
  return count;
}
const pending = new WeakSet();
// Parent MUST serialize writes and drain the real saver queue before clearing keys.
// Mutation errors roll back. Once save starts, any failure may be a late/partial write:
// retain memory, propagate the error and let the parent's unsaved banner/retry handle it.
// Never assume saveFile rejection means the durable write was cancelled.
export async function withVaultTransaction(vault, mutate, save) {
  if (pending.has(vault)) throw new Error('Vault save already in progress');
  const before = structuredClone(vault); pending.add(vault);
  let saving = false;
  try {
    const result = mutate();
    if (result && typeof result.then === 'function') throw new TypeError('Mutation must be synchronous');
    saving = true;
    if (await save(vault) === false) throw new Error('Vault save failed');
    return result;
  } catch (error) {
    if (!saving) {
      for (const key of Object.keys(vault)) delete vault[key];
      Object.assign(vault,before);
    }
    throw error;
  } finally { pending.delete(vault); }
}
