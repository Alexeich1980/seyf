import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHint, getHintParagraphs, HINTS } from '../www/js/hints.js';
import { SECTIONS } from '../www/js/store.js';

test('для каждого раздела есть непустая подсказка', () => {
  for (const s of SECTIONS) {
    const h = getHint(s);
    assert.equal(typeof h, 'string');
    assert.ok(h.trim().length > 0, 'подсказка для ' + s + ' не пуста');
  }
});

test('неизвестный ключ даёт фолбэк, а не undefined', () => {
  const h = getHint('nosuchsection');  // заведомо несуществующий раздел
  assert.equal(typeof h, 'string');
  assert.ok(h.trim().length > 0);
});

test('реестр покрывает ровно текущие разделы (заслон от забытой подсказки)', () => {
  for (const s of SECTIONS) assert.ok(s in HINTS, 'нет подсказки для ' + s);
});

// --- 18.15: подсказки разбиты на короткие абзацы, а не сплошная стена текста ---

test('getHintParagraphs: у каждого раздела 2+ абзаца, каждый непустой', () => {
  for (const s of SECTIONS) {
    const ps = getHintParagraphs(s);
    assert.ok(Array.isArray(ps), 'абзацы массивом для ' + s);
    assert.ok(ps.length >= 2, 'подсказка ' + s + ' разбита на абзацы');
    for (const p of ps) assert.ok(typeof p === 'string' && p.trim().length > 0);
  }
});

test('getHintParagraphs: ни один абзац не превращается в стену (< 320 символов)', () => {
  for (const s of SECTIONS) {
    for (const p of getHintParagraphs(s)) {
      assert.ok(p.length < 320, `слишком длинный абзац в ${s}: ${p.length}`);
    }
  }
});

test('getHintParagraphs: неизвестный раздел → один фолбэк-абзац', () => {
  const ps = getHintParagraphs('nosuchsection');
  assert.equal(ps.length, 1);
  assert.ok(ps[0].trim().length > 0);
});
