import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED_LENGTHS, parseSeedWords, validateSeedPhrase,
  SEED_BANNER_KEY, isSeedBannerDismissed, dismissSeedBanner,
  seedLengthChangeIsDirty,
} from '../www/js/seed.js';

// --- количество слов (ключевой инвариант, под мутацию) ---

test('SEED_LENGTHS — ровно 12, 15, 18, 21, 24 (BIP-39)', () => {
  assert.deepEqual(SEED_LENGTHS, [12, 15, 18, 21, 24]);
});

test('parseSeedWords режет по пробелам/переводам, чистит пустые, в нижний регистр', () => {
  assert.deepEqual(parseSeedWords('  Alpha   BETA\nGamma\t delta '), ['alpha', 'beta', 'gamma', 'delta']);
  assert.deepEqual(parseSeedWords(''), []);
  assert.deepEqual(parseSeedWords(null), []);
  assert.deepEqual(parseSeedWords('   '), []);
});

test('validateSeedPhrase: валидны 12/15/18/21/24 слова', () => {
  for (const n of [12, 15, 18, 21, 24]) {
    const r = validateSeedPhrase(Array(n).fill('слово'));
    assert.equal(r.valid, true, n + ' слов должны быть валидны');
    assert.equal(r.count, n);
    assert.equal(r.message, '');
  }
});

test('validateSeedPhrase: невалидны 0/11/13/16/23/25', () => {
  for (const n of [0, 11, 13, 16, 23, 25]) {
    const r = validateSeedPhrase(Array(n).fill('w'));
    assert.equal(r.valid, false, n + ' слов должны быть невалидны');
    assert.equal(r.count, n);
    assert.ok(r.message.trim().length > 0, 'есть понятное сообщение');
  }
});

test('validateSeedPhrase принимает и строку (считает слова сам)', () => {
  const r = validateSeedPhrase('one two three four five six seven eight nine ten eleven twelve');
  assert.equal(r.count, 12);
  assert.equal(r.valid, true);
});

test('невалидное сообщение содержит фактическое число слов', () => {
  const r = validateSeedPhrase(Array(13).fill('w'));
  assert.ok(r.message.includes('13'), 'сообщение называет число слов');
});

// --- смена длины фразы не считается правкой, если ничего не введено (18.9) ---

test('seedLengthChangeIsDirty: пустая фраза → смена длины НЕ правка', () => {
  assert.equal(seedLengthChangeIsDirty(0), false);
});

test('seedLengthChangeIsDirty: есть введённые слова → смена длины считается правкой', () => {
  assert.equal(seedLengthChangeIsDirty(1), true);
  assert.equal(seedLengthChangeIsDirty(12), true);
});

// --- состояние баннера ---

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('баннер по умолчанию не свёрнут, после dismiss — свёрнут', () => {
  const st = fakeStorage();
  assert.equal(isSeedBannerDismissed(st), false);
  dismissSeedBanner(st);
  assert.equal(isSeedBannerDismissed(st), true);
  assert.equal(st.getItem(SEED_BANNER_KEY), '1');
});

test('состояние баннера не падает при отсутствии/битом storage', () => {
  assert.equal(isSeedBannerDismissed(null), false);
  assert.doesNotThrow(() => dismissSeedBanner(null));
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  assert.equal(isSeedBannerDismissed(bad), false);
  assert.doesNotThrow(() => dismissSeedBanner(bad));
});
