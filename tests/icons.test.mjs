// icons.test.mjs — SVG-набор «Сейфа» (8e). Заслон п.1: глаз открыт/закрыт — РАЗНЫЕ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icon, hasIcon, ICON_PATHS } from '../www/js/icons.js';

test('нужные глифы 8e есть в наборе', () => {
  for (const n of ['safe', 'eye', 'eyeOff', 'refresh', 'palette', 'archive', 'key', 'shield', 'star', 'info', 'lock', 'help', 'search', 'close']) {
    assert.ok(hasIcon(n), 'нет иконки ' + n);
  }
});

test('п.1: eye и eyeOff — РАЗНЫЕ иконки', () => {
  assert.notEqual(ICON_PATHS.eye, ICON_PATHS.eyeOff);
  assert.notEqual(icon('eye'), icon('eyeOff'));
});

test('icon() отдаёт валидный inline-SVG с currentColor', () => {
  const s = icon('safe', 24);
  assert.match(s, /^<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(s, /stroke="currentColor"/);
  assert.match(s, /width="24" height="24"/);
  assert.match(s, /<\/svg>$/);
});

test('неизвестная иконка — пустое тело, но валидная обёртка (не падаем)', () => {
  assert.match(icon('нет-такой'), /^<svg[\s\S]*<\/svg>$/);
});
