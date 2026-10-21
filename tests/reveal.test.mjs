// reveal.test.mjs — ревью-20 п.3: страховка появления списка карточек.
// Проверяем чистую логику reveal.js без DOM: markRevealed идемпотентен, а scheduleReveal
// показывает список через setTimeout-фолбэк, даже если requestAnimationFrame не сработал.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markRevealed, scheduleReveal, REVEAL_FALLBACK_MS } from '../www/js/reveal.js';

// Мини-заглушка узла с classList (Set под капотом) — достаточно для логики .in.
function fakeNode() {
  const set = new Set();
  return {
    added: [],
    classList: {
      add(c) { set.add(c); },
      contains(c) { return set.has(c); },
    },
    has(c) { return set.has(c); },
  };
}

test('markRevealed ставит .in один раз (идемпотентно)', () => {
  const n = fakeNode();
  assert.equal(markRevealed(n), true);   // первый раз — реально добавили
  assert.equal(n.has('in'), true);
  assert.equal(markRevealed(n), false);  // второй раз — уже есть, no-op
});

test('markRevealed на битом узле не бросает', () => {
  assert.equal(markRevealed(null), false);
  assert.equal(markRevealed({}), false);
});

test('фолбэк помечает видимым, когда requestAnimationFrame не пришёл', () => {
  const n = fakeNode();
  let timerMs = null; let timerCb = null;
  scheduleReveal(n, {
    raf: () => {},                                   // rAF «подвис» — колбэк не вызван
    setTimeout: (cb, ms) => { timerCb = cb; timerMs = ms; },
  });
  assert.equal(n.has('in'), false, 'до срабатывания таймера список ещё скрыт');
  assert.equal(timerMs, REVEAL_FALLBACK_MS, 'страховка планируется на REVEAL_FALLBACK_MS');
  timerCb();                                          // сработал setTimeout-фолбэк
  assert.equal(n.has('in'), true, 'фолбэк показал список');
});

test('нормальный путь: rAF показывает список сразу, фолбэк потом безвреден', () => {
  const n = fakeNode();
  let timerCb = null;
  scheduleReveal(n, {
    raf: (cb) => cb(),                               // rAF сработал штатно
    setTimeout: (cb) => { timerCb = cb; },
  });
  assert.equal(n.has('in'), true, 'rAF показал список');
  timerCb();                                          // фолбэк дублирует — остаётся видимым
  assert.equal(n.has('in'), true);
});
