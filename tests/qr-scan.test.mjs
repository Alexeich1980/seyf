// qr-scan.test.mjs — даунскейл кадра для декода QR (п.16). Чистая функция decodeSize:
// кадр камеры (1280×720 и т.п.) ужимается до ширины ~640 перед jsQR, аспект сохраняется.
// Это снимает рывки (декод в полном разрешении блокировал главный поток). DOM/камеру не трогаем.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSize, DECODE_WIDTH, DECODE_INTERVAL_MS } from '../www/js/qr-scan.js';

test('decodeSize: широкий кадр ужимается до DECODE_WIDTH, аспект сохранён', () => {
  assert.deepEqual(decodeSize(1280, 720), { width: 640, height: 360 });
  assert.deepEqual(decodeSize(1920, 1080), { width: 640, height: 360 });
});

test('decodeSize: кадр не шире максимума остаётся как есть', () => {
  assert.deepEqual(decodeSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(decodeSize(320, 240), { width: 320, height: 240 });
});

test('decodeSize: пустой/битый размер → нули (не декодируем)', () => {
  assert.deepEqual(decodeSize(0, 0), { width: 0, height: 0 });
  assert.deepEqual(decodeSize(undefined, undefined), { width: 0, height: 0 });
});

test('decodeSize: кастомный maxWidth', () => {
  assert.deepEqual(decodeSize(1000, 500, 500), { width: 500, height: 250 });
});

test('константы троттлинга/ширины заданы разумно (заслон п.16)', () => {
  assert.ok(DECODE_WIDTH >= 320 && DECODE_WIDTH <= 800, 'ширина декода ~640');
  assert.ok(DECODE_INTERVAL_MS >= 100 && DECODE_INTERVAL_MS <= 300, 'интервал декода ~150-200 мс');
});
