// listorder.test.mjs — порядок показа записей v1.0 (8f, «ручной порядок главный»):
// порядок массива = ручной; избранные закреплены сверху; новая (в начале массива) — первой.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayOrder, orderByIds, moveInOrder } from '../www/js/listorder.js';

const E = (id, fav = false) => ({ id, favorite: fav });

test('ручной порядок сохраняется: массив = показ (без избранных)', () => {
  const out = displayOrder([E('a'), E('b'), E('c')]).map((e) => e.id);
  assert.deepEqual(out, ['a', 'b', 'c']);
});

test('новая запись (в начале массива) показывается первой', () => {
  // app.js кладёт новую в начало; displayOrder не переставляет обычные между собой.
  const out = displayOrder([E('new'), E('old1'), E('old2')]).map((e) => e.id);
  assert.deepEqual(out, ['new', 'old1', 'old2']);
});

test('избранные закреплены сверху, внутри групп — ручной порядок', () => {
  const out = displayOrder([E('p1'), E('f1', true), E('p2'), E('f2', true)]).map((e) => e.id);
  assert.deepEqual(out, ['f1', 'f2', 'p1', 'p2']);   // избранные (в их порядке), потом обычные
});

test('избранное поднимается над обычными, даже если в массиве ниже', () => {
  const out = displayOrder([E('plain'), E('fav', true)]).map((e) => e.id);
  assert.deepEqual(out, ['fav', 'plain']);
});

test('displayOrder не мутирует вход', () => {
  const input = [E('a'), E('b', true)];
  const before = input.map((e) => e.id);
  displayOrder(input);
  assert.deepEqual(input.map((e) => e.id), before);
});

test('orderByIds: переставляет массив под порядок id из DOM', () => {
  const arr = [E('a'), E('b'), E('c')];
  const out = orderByIds(arr, ['c', 'a', 'b']).map((e) => e.id);
  assert.deepEqual(out, ['c', 'a', 'b']);
});

test('orderByIds: id не из списка держатся в хвосте стабильно', () => {
  const arr = [E('a'), E('b'), E('c'), E('d')];
  const out = orderByIds(arr, ['c', 'a']).map((e) => e.id);
  assert.deepEqual(out, ['c', 'a', 'b', 'd']);
});

test('orderByIds не мутирует вход', () => {
  const input = [E('a'), E('b')];
  const before = input.map((e) => e.id);
  orderByIds(input, ['b', 'a']);
  assert.deepEqual(input.map((e) => e.id), before);
});

// --- moveInOrder: основа стрелок ↑/↓ (п.13) ---
test('moveInOrder: ↓ у первой (0→1) меняет местами с соседом', () => {
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
});
test('moveInOrder: ↑ у последней (2→1) меняет местами с соседом', () => {
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 2, 1), ['a', 'c', 'b']);
});
test('moveInOrder: перенос через несколько позиций (0→2)', () => {
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
});
test('moveInOrder: индексы вне диапазона отдают копию без изменений', () => {
  assert.deepEqual(moveInOrder(['a', 'b'], -1, 0), ['a', 'b']);
  assert.deepEqual(moveInOrder(['a', 'b'], 0, 5), ['a', 'b']);
  assert.deepEqual(moveInOrder(['a', 'b'], 1.5, 0), ['a', 'b']);
});
test('moveInOrder не мутирует вход (новый массив)', () => {
  const input = ['a', 'b', 'c'];
  const out = moveInOrder(input, 0, 2);
  assert.deepEqual(input, ['a', 'b', 'c']);
  assert.notEqual(out, input);
});
