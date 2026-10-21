// cardexp.test.mjs — срок карты ММ/ГГ (спека 8b п.6): разбор и форматирование.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatExpiry, parseExpiry } from '../www/js/cardexp.js';

test('formatExpiry: прогрессивная группировка цифр в ММ/ГГ', () => {
  assert.equal(formatExpiry(''), '');
  assert.equal(formatExpiry('1'), '1');
  assert.equal(formatExpiry('12'), '12');
  assert.equal(formatExpiry('123'), '12/3');
  assert.equal(formatExpiry('1229'), '12/29');
  assert.equal(formatExpiry('12/29'), '12/29');
  assert.equal(formatExpiry('12/29/99'), '12/29'); // лишнее отбрасывается
});

test('parseExpiry: валиден при 4 цифрах и месяце 01..12', () => {
  assert.deepEqual(parseExpiry('12/29'), { mm: '12', yy: '29', valid: true, text: '12/29' });
  assert.deepEqual(parseExpiry('1229'), { mm: '12', yy: '29', valid: true, text: '12/29' });
  assert.deepEqual(parseExpiry('0929'), { mm: '09', yy: '29', valid: true, text: '09/29' });
});

test('parseExpiry: невалиден при месяце вне 1..12 или неполном вводе', () => {
  assert.equal(parseExpiry('1329').valid, false);   // месяц 13
  assert.equal(parseExpiry('0029').valid, false);   // месяц 00
  assert.equal(parseExpiry('12').valid, false);     // год не задан
  assert.equal(parseExpiry('').valid, false);
});
