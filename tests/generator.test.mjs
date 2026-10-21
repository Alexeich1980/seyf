import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../www/js/generator.js';

test('длина пароля соблюдается', () => {
  assert.equal(G.generatePassword({ length: 20 }).length, 20);
});

test('только цифры — пароль состоит из цифр', () => {
  const pw = G.generatePassword({ length: 30, upper: false, lower: false, digits: true, symbols: false });
  assert.match(pw, /^[0-9]{30}$/);
});

test('avoidAmbiguous исключает похожие символы', () => {
  const pw = G.generatePassword({ length: 200, avoidAmbiguous: true });
  assert.doesNotMatch(pw, /[0O1lI]/);
});

test('фраза содержит нужное число слов', () => {
  const p = G.generatePassphrase({ words: 4, separator: '-', number: false, capitalize: false });
  assert.equal(p.split('-').length, 4);
});

test('оценка стойкости растёт с длиной', () => {
  const weak = G.estimateStrength('abc');
  const strong = G.estimateStrength(G.generatePassword({ length: 24 }));
  assert.ok(strong.bits > weak.bits);
  assert.ok(strong.score >= weak.score);
});
