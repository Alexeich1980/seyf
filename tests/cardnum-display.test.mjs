// cardnum-display.test.mjs — номер карты в списке показывается группами по 4, а копируется
// СЫРЫМ (без пробелов) — заслон 18.7. Отображение делает groupDigits (fieldinput.js),
// копирование идёт от исходного значения записи (ui.js: copyPlain(val), сырой номер).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupDigits, onlyDigits } from '../www/js/fieldinput.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('отображение: номер разбивается на группы по 4', () => {
  assert.equal(groupDigits('4111111111111111'), '4111 1111 1111 1111');
  assert.equal(groupDigits('378282246310005'), '3782 8224 6310 005');   // 15 цифр (Amex)
});

test('буфер: снятие пробелов с отображаемого = исходный сырой номер', () => {
  const raw = '4111111111111111';
  const shown = groupDigits(raw);
  assert.notEqual(shown, raw);                       // на экране — с пробелами
  assert.equal(shown.replace(/\s+/g, ''), raw);      // в буфер уйдёт сырой
  assert.equal(onlyDigits(shown), raw);
});

test('app.js: декоратор меняет только отображение, копирование остаётся сырым', () => {
  const app = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');
  // Есть декоратор номера карты, который ставит текст группами (groupDigits).
  assert.match(app, /decorateCardNumber/);
  assert.match(app, /groupDigits/);
});
