import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoLock, resumeDecision, foregroundDecision } from '../www/js/autolock.js';

// Поддельный таймер: запоминаем колбэк и «дёргаем» вручную.
function fakeTimers() {
  let cb = null, id = 0, cleared = null;
  return {
    set: (fn) => { cb = fn; return ++id; },
    clear: (h) => { cleared = h; cb = null; },
    fire: () => { const f = cb; cb = null; if (f) f(); },
    pending: () => cb !== null,
    lastCleared: () => cleared,
  };
}

test('таймаут вызывает блокировку', () => {
  let locked = 0;
  const t = fakeTimers();
  const al = createAutoLock({ timeoutMs: 1000, onLock: () => locked++, setTimer: t.set, clearTimer: t.clear });
  al.arm();
  assert.ok(t.pending());
  t.fire();
  assert.equal(locked, 1);
});

test('activity сбрасывает таймер (старый снят, новый взведён)', () => {
  let locked = 0;
  const t = fakeTimers();
  const al = createAutoLock({ timeoutMs: 1000, onLock: () => locked++, setTimer: t.set, clearTimer: t.clear });
  al.arm();
  al.activity();
  assert.ok(t.lastCleared() != null, 'старый таймер снят');
  assert.ok(t.pending(), 'новый взведён');
  assert.equal(locked, 0);
});

test('уход в фон блокирует немедленно', () => {
  let locked = 0;
  const t = fakeTimers();
  const al = createAutoLock({ timeoutMs: 1000, onLock: () => locked++, setTimer: t.set, clearTimer: t.clear });
  al.arm();
  al.background();
  assert.equal(locked, 1);
});

// --- возврат из фона: в пределах окна восстановить экран, за окном — запереть (18.8) ---

test('resumeDecision: в пределах окна автоблока → восстановить тот же экран', () => {
  const ms = 5 * 60 * 1000;
  assert.equal(resumeDecision(1_000_000, 1_000_000 + 60_000, ms), 'restore');   // прошла 1 мин
  assert.equal(resumeDecision(1_000_000, 1_000_000 + ms - 1, ms), 'restore');   // ровно на границе изнутри
});

test('resumeDecision: за окном автоблока → запереть', () => {
  const ms = 5 * 60 * 1000;
  assert.equal(resumeDecision(1_000_000, 1_000_000 + ms, ms), 'lock');          // ровно окно
  assert.equal(resumeDecision(1_000_000, 1_000_000 + ms + 60_000, ms), 'lock'); // прошло 6 мин
});

test('resumeDecision: нет метки фона или битое окно → восстановить (не запирать зря)', () => {
  assert.equal(resumeDecision(0, Date.now(), 5 * 60 * 1000), 'restore');
  assert.equal(resumeDecision(null, Date.now(), 5 * 60 * 1000), 'restore');
  assert.equal(resumeDecision(1000, 999999, 0), 'restore');
});

// --- собственное системное окно (сохранение/выбор файла/камера) НЕ запирает (косяк #17) ---

test('foregroundDecision: пока открыто наше системное окно → восстановить даже за окном автоблока', () => {
  const ms = 5 * 60 * 1000;
  // прошло больше окна автоблока, но это был системный диалог сохранения — НЕ запираем
  assert.equal(foregroundDecision({ systemWindowOpen: true, backgroundedAt: 1_000_000, now: 1_000_000 + ms + 60_000, autolockMs: ms }), 'restore');
  assert.equal(foregroundDecision({ systemWindowOpen: true, backgroundedAt: 1_000_000, now: 1_000_000 + 60_000, autolockMs: ms }), 'restore');
});

test('foregroundDecision: без системного окна — обычная логика окна времени (Home запирает)', () => {
  const ms = 5 * 60 * 1000;
  assert.equal(foregroundDecision({ systemWindowOpen: false, backgroundedAt: 1_000_000, now: 1_000_000 + ms, autolockMs: ms }), 'lock');
  assert.equal(foregroundDecision({ systemWindowOpen: false, backgroundedAt: 1_000_000, now: 1_000_000 + 60_000, autolockMs: ms }), 'restore');
});
