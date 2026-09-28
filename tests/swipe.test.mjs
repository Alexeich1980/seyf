// swipe.test.mjs — соответствие иконки «глаза» состоянию (8f A.3, ратчет) и порог
// закрывающего свайпа меню (8f A.4, перенос рабочего Хомяка). Обе — чистые функции.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eyeIconName, swipeCloses, SWIPE_SIDE } from '../www/js/icons.js';

test('глаз: пароль ВИДЕН → открытый «eye»', () => {
  assert.equal(eyeIconName(true), 'eye');
});
test('глаз: пароль СКРЫТ → зачёркнутый «eyeOff»', () => {
  assert.equal(eyeIconName(false), 'eyeOff');
});
test('глаз: состояние и иконка не инвертированы (eye !== eyeOff)', () => {
  assert.notEqual(eyeIconName(true), eyeIconName(false));
});

test('свайп влево: честный горизонтальный жест закрывает', () => {
  assert.equal(swipeCloses(-120, 10, 'left'), true);
});
test('свайп влево: косой жест (вертикаль велика) НЕ закрывает', () => {
  assert.equal(swipeCloses(-120, 100, 'left'), false);
});
test('свайп влево: слишком короткий жест НЕ закрывает', () => {
  assert.equal(swipeCloses(-(SWIPE_SIDE - 1), 0, 'left'), false);
});
test('свайп вправо (dx положительный) не считается закрытием влево', () => {
  assert.equal(swipeCloses(120, 0, 'left'), false);
});
