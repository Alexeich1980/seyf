import { SECTIONS } from './sections.js';
export { SECTIONS };

export const nowISO = () => new Date().toISOString();

export function emptyVault() {
  return { version: 1, sections: Object.fromEntries(SECTIONS.map((s) => [s, []])) };
}

function find(vault, section, id) {
  return (vault.sections[section] || []).find((e) => e.id === id);
}

export function createEntry(vault, section, data = {}) {
  const entry = {
    id: globalThis.crypto.randomUUID(),
    favorite: false,
    tags: [],
    customFields: [],
    ...data,
  };
  if (section === 'passwords' && data.password) entry.passwordChanged = nowISO();
  vault.sections[section].push(entry);
  return entry;
}

export function updateEntry(vault, section, id, patch) {
  const e = find(vault, section, id);
  if (!e) return null;
  if (section === 'passwords' && patch.password && patch.password !== e.password) {
    patch = { ...patch, passwordChanged: nowISO() };
  }
  Object.assign(e, patch);
  return e;
}

export function deleteEntry(vault, section, id) {
  const arr = vault.sections[section];
  const i = arr.findIndex((e) => e.id === id);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}

export function reorderEntry(vault, section, fromIndex, toIndex) {
  const arr = vault.sections[section];
  if (fromIndex < 0 || fromIndex >= arr.length) return;
  const [item] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, item);
}

export function toggleFavorite(vault, section, id) {
  const e = find(vault, section, id);
  if (!e) return false;
  e.favorite = !e.favorite;
  return e.favorite;
}

// Поднять избранные наверх, сохранив относительный порядок внутри групп (стабильная сортировка).
export function sortFavoritesTop(vault, section) {
  vault.sections[section].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
}

export function searchEntries(vault, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const section of SECTIONS) {
    for (const entry of vault.sections[section]) {
      const hay = [];
      for (const [k, val] of Object.entries(entry)) {
        if (k === 'id' || k === 'customFields' || k === 'tags') continue;
        if (typeof val === 'string') hay.push(val);
      }
      for (const t of entry.tags || []) hay.push(t);
      for (const f of entry.customFields || []) { hay.push(f.name || ''); hay.push(f.value || ''); }
      if (hay.join(' ').toLowerCase().includes(q)) out.push({ section, entry });
    }
  }
  return out;
}
