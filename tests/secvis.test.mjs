// secvis.test.mjs — видимость разделов на витрине (18.3) и наличие секретов в разделе (18.14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HIDDEN_SECTIONS_KEY, getHiddenSections, setHiddenSections, isSectionHidden,
  toggleSectionHidden, visibleSections, sectionHasSecrets,
} from '../www/js/secvis.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.resolve(HERE, '..', 'www');

function fakeStorage(initial) {
  const m = new Map(initial ? Object.entries(initial) : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _map: m };
}

const ALL = ['passwords', 'cards', 'wallets', 'seed', 'documents', 'notes', 'totp'];

test('по умолчанию скрытых нет, видны все', () => {
  const st = fakeStorage();
  assert.deepEqual(getHiddenSections(st), []);
  assert.deepEqual(visibleSections(ALL, st), ALL);
});

test('спрятать раздел → он исчезает с витрины, состояние сохраняется', () => {
  const st = fakeStorage();
  toggleSectionHidden(st, ALL, 'notes');
  assert.equal(isSectionHidden(st, 'notes'), true);
  assert.deepEqual(visibleSections(ALL, st), ['passwords', 'cards', 'wallets', 'seed', 'documents', 'totp']);
  assert.ok(st.getItem(HIDDEN_SECTIONS_KEY).includes('notes'));
});

test('повторное переключение показывает раздел снова', () => {
  const st = fakeStorage();
  toggleSectionHidden(st, ALL, 'notes');
  toggleSectionHidden(st, ALL, 'notes');
  assert.equal(isSectionHidden(st, 'notes'), false);
  assert.deepEqual(visibleSections(ALL, st), ALL);
});

test('нельзя спрятать последний видимый раздел (витрина не пустеет)', () => {
  const st = fakeStorage();
  // прячем все, кроме одного
  for (const s of ALL.slice(1)) toggleSectionHidden(st, ALL, s);
  assert.deepEqual(visibleSections(ALL, st), ['passwords']);
  // попытка спрятать последний — игнорируется
  toggleSectionHidden(st, ALL, 'passwords');
  assert.deepEqual(visibleSections(ALL, st), ['passwords']);
});

test('порядок видимых сохраняется как в исходном списке', () => {
  const st = fakeStorage();
  toggleSectionHidden(st, ALL, 'cards');
  assert.deepEqual(visibleSections(ALL, st), ['passwords', 'wallets', 'seed', 'documents', 'notes', 'totp']);
});

test('битое/пустое хранилище → пусто, не падаем', () => {
  const bad = { getItem() { return '{not json'; }, setItem() {} };
  assert.deepEqual(getHiddenSections(bad), []);
  const nul = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  assert.deepEqual(getHiddenSections(nul), []);
  assert.doesNotThrow(() => setHiddenSections(nul, ['x']));
});

// --- наличие секретов в разделе (18.14) ---

const SCHEMA_WITH_SECRET = [{ key: 'name', type: 'copy' }, { key: 'password', type: 'secret' }];
const SCHEMA_NO_SECRET = [{ key: 'name', type: 'copy' }, { key: 'text', type: 'textarea' }];

test('sectionHasSecrets: есть секретное поле в схеме → true', () => {
  assert.equal(sectionHasSecrets(SCHEMA_WITH_SECRET, []), true);
});

test('sectionHasSecrets: нет секретов в схеме и в записях → false', () => {
  assert.equal(sectionHasSecrets(SCHEMA_NO_SECRET, [{ customFields: [] }]), false);
  assert.equal(sectionHasSecrets(SCHEMA_NO_SECRET, []), false);
});

test('sectionHasSecrets: произвольное секретное поле у записи → true', () => {
  const entries = [{ customFields: [{ name: 'код', value: '1234', secret: true }] }];
  assert.equal(sectionHasSecrets(SCHEMA_NO_SECRET, entries), true);
});

test('sectionHasSecrets: секретное произвольное поле, но пустое → false', () => {
  const entries = [{ customFields: [{ name: 'код', value: '', secret: true }] }];
  assert.equal(sectionHasSecrets(SCHEMA_NO_SECRET, entries), false);
});

// Ратчет 18.14: скрытая ic-btn НЕ показывается (глаз показа секретов в детальном был виден
// в разделах без секретов, т.к. .ic-btn{display:grid} перебивал [hidden]).
test('CSS: .ic-btn[hidden] гасит display (глаз не всплывает без секретов)', () => {
  const css = fs.readFileSync(path.join(WWW, 'css', 'app.css'), 'utf8');
  assert.match(css, /\.ic-btn\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});

// Заход 2 п.6: детальный экран заменён разворотом на месте. Инвариант: действия разворота
// (Ред/Удал/Поделиться) СКРЫТЫ по умолчанию и появляются только у развёрнутой карточки —
// иначе тап не «разворачивал» бы ничего. Проверяем CSS-заслон + наличие bindCardExpand.
test('разворот: футер действий скрыт до .expanded (CSS-заслон)', () => {
  const css = fs.readFileSync(path.join(WWW, 'css', 'app.css'), 'utf8');
  assert.match(css, /\.entry\s+\.card-actions\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.entry\.expanded\s+\.card-actions\s*\{[^}]*display:\s*flex/);
  const app = fs.readFileSync(path.join(WWW, 'js', 'app.js'), 'utf8');
  assert.match(app, /bindCardExpand\(/);
});
