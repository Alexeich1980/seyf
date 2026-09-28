// plural.test.mjs - русское склонение по числу (чипы длины seed-фразы, счётчики страниц,
// лимиты paywall). Находка ревью: чипы показывали «21 слов»/«24 слов» вместо «21 слово»/«24 слова».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plural } from '../www/js/plural.js';

const word = (n) => plural(n, 'слово', 'слова', 'слов');

test('чипы длины seed-фразы склоняются правильно', () => {
  assert.equal(word(12), 'слов');    // 12 слов
  assert.equal(word(15), 'слов');    // 15 слов
  assert.equal(word(18), 'слов');    // 18 слов
  assert.equal(word(21), 'слово');   // 21 слово (было «слов»)
  assert.equal(word(24), 'слова');   // 24 слова (было «слов»)
});

test('общие правила: 1/few/many и особый десяток 11..14', () => {
  assert.equal(word(1), 'слово');
  assert.equal(word(2), 'слова');
  assert.equal(word(4), 'слова');
  assert.equal(word(5), 'слов');
  assert.equal(word(11), 'слов');    // 11 - исключение, не «слово»
  assert.equal(word(14), 'слов');    // 14 - исключение, не «слова»
  assert.equal(word(101), 'слово');
  assert.equal(word(102), 'слова');
  assert.equal(word(0), 'слов');
});
