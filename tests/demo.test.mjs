// demo.test.mjs — демо-режим первого запуска «Сейфа» (только мобайл, НЕ core).
// Проверяет: единый флаг, сидирование по одной записи в каждый раздел, безопасность
// демо-данных (тест-вектор seed, валидный base32 totp, скан-заглушка) и — ГЛАВНОЕ —
// машинный заслон инварианта «в демо-режиме на диск ничего не пишется» (guardedSave).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ENABLED, seedDemoVault, isDemoEntry, guardedSave } from '../www/js/demo.js';
import { SECTIONS } from '../www/js/sections.js';
import { base32Decode } from '../www/js/totp.js';
import { isAccepted } from '../www/js/documents.js';

test('DEMO_ENABLED включён (для прода гасится одной строкой)', () => {
  assert.equal(DEMO_ENABLED, true);
});

test('seedDemoVault: по одной демо-записи в КАЖДОМ из 7 разделов', () => {
  const v = seedDemoVault();
  assert.ok(v && v.sections, 'форма vault');
  for (const s of SECTIONS) {
    assert.equal(v.sections[s].length, 1, 'ровно одна запись в разделе ' + s);
    const e = v.sections[s][0];
    assert.equal(e.demo, true, 'запись раздела ' + s + ' помечена demo:true');
    assert.ok(e.id, 'у записи раздела ' + s + ' есть id');
  }
});

test('seedDemoVault: seed — ЗАВЕДОМО тестовый вектор, не «живая» фраза', () => {
  const seed = seedDemoVault().sections.seed[0];
  assert.match(seed.phrase, /^abandon( abandon){10} about$/, 'публичный тест-вектор BIP39');
});

test('seedDemoVault: totp-секрет — валидный base32 (код реально тикает)', () => {
  const totp = seedDemoVault().sections.totp[0];
  assert.doesNotThrow(() => base32Decode(totp.secret));
});

test('seedDemoVault: документ — один скан-заглушка принятого типа', () => {
  const doc = seedDemoVault().sections.documents[0];
  assert.equal(doc.pages.length, 1);
  assert.ok(isAccepted(doc.pages[0].mime), 'mime скана принят');
  assert.ok(doc.pages[0].data && doc.pages[0].data.length > 0, 'есть base64 скана');
});

test('isDemoEntry: строгий флаг', () => {
  assert.equal(isDemoEntry({ demo: true }), true);
  assert.equal(isDemoEntry({ demo: 'true' }), false);
  assert.equal(isDemoEntry({}), false);
  assert.equal(isDemoEntry(null), false);
});

// --- ГЛАВНЫЙ инвариант: в демо-режиме на диск НИЧЕГО не пишется ---
function spyStore() {
  const s = { writes: 0, last: null };
  s.save = async (file) => { s.writes++; s.last = file; };
  return s;
}

test('guardedSave: в демо-режиме сохранение ЗАПРЕЩЕНО и store.save НЕ вызван', async () => {
  const store = spyStore();
  const save = guardedSave(store, () => true);
  await assert.rejects(() => save({ v: 1 }), /demo/i);
  assert.equal(store.writes, 0, 'на диск ничего не легло');
});

test('guardedSave: вне демо-режима делегирует store.save', async () => {
  const store = spyStore();
  const save = guardedSave(store, () => false);
  await save({ v: 1 });
  assert.equal(store.writes, 1);
});
