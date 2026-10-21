// theme.test.mjs — именованные темы: дефолт, нормализация/миграция, переключение по кругу.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, DEFAULT_THEME, THEME_LABELS, normalizeTheme, nextTheme } from '../www/js/theme.js';

test('темы: ровно две, дефолт — bank (тёмная); подписи Тёмная/Светлая (8e п.4)', () => {
  assert.deepEqual(THEMES, ['bank', 'nord']);
  assert.equal(DEFAULT_THEME, 'bank');
  assert.equal(THEME_LABELS.bank, 'Тёмная');
  assert.equal(THEME_LABELS.nord, 'Светлая');
});

test('normalizeTheme: валидные проходят как есть', () => {
  assert.equal(normalizeTheme('bank'), 'bank');
  assert.equal(normalizeTheme('nord'), 'nord');
});

test('normalizeTheme: миграция прежнего день/ночь', () => {
  assert.equal(normalizeTheme('dark'), 'bank');   // ночная → банковская
  assert.equal(normalizeTheme('light'), 'nord');  // дневная → скандинавская
});

test('normalizeTheme: мусор/пусто → дефолт', () => {
  assert.equal(normalizeTheme(null), DEFAULT_THEME);
  assert.equal(normalizeTheme(undefined), DEFAULT_THEME);
  assert.equal(normalizeTheme(''), DEFAULT_THEME);
  assert.equal(normalizeTheme('neon'), DEFAULT_THEME);
});

test('nextTheme: переключение по кругу bank <-> nord', () => {
  assert.equal(nextTheme('bank'), 'nord');
  assert.equal(nextTheme('nord'), 'bank');
  assert.equal(nextTheme(nextTheme('bank')), 'bank'); // круг замыкается
});

test('nextTheme: нормализует вход перед переключением', () => {
  assert.equal(nextTheme('dark'), 'nord');   // dark→bank→nord
  assert.equal(nextTheme('light'), 'bank');  // light→nord→bank
  assert.equal(nextTheme('мусор'), 'nord');  // →bank→nord
});
