// seedwords.test.mjs — проверка слов seed-фразы по офлайн-списку BIP-39 (заход 2 п.16).
// Заслон от опечатки/кириллицы: валидное английское слово ок, «привет»/мусор/слово с
// пробелом → невалидно. Плюс санити списка (2048 уникальных, латиница).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedWordValid, invalidSeedWords } from '../www/js/seed.js';
import { BIP39_EN, BIP39_SET, isBip39Word } from '../www/js/bip39-wordlist.js';

test('список BIP-39: ровно 2048 уникальных латинских слов, abandon…zoo', () => {
  assert.equal(BIP39_EN.length, 2048);
  assert.equal(BIP39_SET.size, 2048);
  assert.equal(BIP39_EN[0], 'abandon');
  assert.equal(BIP39_EN[2047], 'zoo');
  assert.ok(BIP39_EN.every((w) => /^[a-z]+$/.test(w)), 'все слова латиница без пробелов');
});

test('isBip39Word: регистронезависимо, вне списка → false', () => {
  assert.equal(isBip39Word('Abandon'), true);
  assert.equal(isBip39Word('ZOO'), true);
  assert.equal(isBip39Word('zzzz'), false);
});

test('seedWordValid: валидное слово BIP-39 → true', () => {
  assert.equal(seedWordValid('abandon'), true);
  assert.equal(seedWordValid('ZOO'), true);   // регистр не важен
  assert.equal(seedWordValid(' legal '), true);
});

test('seedWordValid: «привет»/мусор/цифры → false', () => {
  assert.equal(seedWordValid('привет'), false);   // кириллица
  assert.equal(seedWordValid('zzzz'), false);      // латиница, но не BIP-39
  assert.equal(seedWordValid('abandon1'), false);  // цифра
  assert.equal(seedWordValid(''), false);
  assert.equal(seedWordValid(null), false);
});

test('seedWordValid: слово с пробелом внутри → false', () => {
  assert.equal(seedWordValid('abandon ability'), false);   // это два слова, не одно
  assert.equal(seedWordValid('legal tender'), false);
});

test('invalidSeedWords: возвращает только заполненные невалидные (с индексами)', () => {
  const words = ['abandon', 'привет', '', 'ability', 'zzzz'];
  const bad = invalidSeedWords(words);
  assert.deepEqual(bad, [{ index: 1, word: 'привет' }, { index: 4, word: 'zzzz' }]);
});

test('invalidSeedWords: всё валидно → пустой массив', () => {
  assert.deepEqual(invalidSeedWords(['abandon', 'ability', 'able']), []);
});
