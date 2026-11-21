import test from 'node:test';
import assert from 'node:assert/strict';
import { LOYALTY_COLORS, LOYALTY_COLOR_NAMES, cardColor, makeCard } from '../www/js/loyalty.js';

const original = ['#2563eb', '#7c3aed', '#be185d', '#b45309', '#047857', '#0e7490'];
// Independent legacy oracle: BigInt multiplication, explicitly reduced to uint32.
function legacyColor(description) {
  let hash = 0n;
  for (const c of String(description || '')) hash = (hash * 31n + BigInt(c.codePointAt(0))) & 0xffffffffn;
  return original[Number(hash % 6n)];
}

test('ten immutable distinct safe colors with matching accessible names; original six unchanged', () => {
  assert.equal(LOYALTY_COLORS.length, 10);
  assert.equal(new Set(LOYALTY_COLORS).size, 10);
  assert.deepEqual(LOYALTY_COLORS.slice(0, 6), original);
  assert.deepEqual(LOYALTY_COLOR_NAMES, ['Синий', 'Фиолетовый', 'Розовый', 'Янтарный', 'Зелёный', 'Бирюзовый', 'Красный', 'Оливковый', 'Коричневый', 'Серый']);
  assert.equal(Object.isFrozen(LOYALTY_COLORS), true);
  assert.equal(Object.isFrozen(LOYALTY_COLOR_NAMES), true);
  for (const color of LOYALTY_COLORS) assert.match(color, /^#[0-9a-f]{6}$/);
});

test('colorless legacy cards keep exact hash modulo six, including Unicode and uint32 overflow', () => {
  const descriptions = ['', undefined, null, 0, 'A', 'B', 'C', 'D', 'E', 'F', 'Shop', 'Пятёрочка', 'Ёж', 'Е\u0308ж', '🛒💳', '𐐀', 'a'.repeat(200)];
  for (let i = 0; i < 512; i++) descriptions.push(`Магазин ${i} 🛒`);
  const seen = new Set();
  for (const description of descriptions) {
    const entry = Object.freeze({ description, number: '000123' });
    const expected = legacyColor(description);
    assert.equal(cardColor(entry), expected, String(description));
    assert.equal(cardColor(JSON.parse(JSON.stringify(entry))), expected);
    assert.equal(Object.hasOwn(entry, 'color'), false, 'rendering must not migrate stored entries');
    seen.add(expected);
  }
  assert.equal(seen.size, 6);
  assert.equal(cardColor(), original[0]);
  assert.equal(cardColor(null), original[0]);
  // B has hash 66: modulo ten would turn the original blue into red.
  assert.equal(cardColor({ description: 'A' }), '#0e7490');
  assert.equal(cardColor({ description: 'B' }), '#2563eb');
});

test('all ten selections survive create, JSON roundtrip, rename, edit and a second roundtrip', () => {
  for (const color of LOYALTY_COLORS) {
    const data = { description: 'Shop', number: '0000123', color };
    assert.equal(cardColor(data), color);
    const saved = JSON.parse(JSON.stringify(makeCard(data)));
    assert.equal(saved.color, color);
    const edit = makeCard({ description: 'Renamed', number: saved.number, note: 'Updated' }, saved);
    const reopened = JSON.parse(JSON.stringify(edit));
    assert.equal(reopened.color, color);
    assert.equal(cardColor(reopened), color);
    assert.equal(reopened.id, saved.id);
    assert.equal(reopened.number, '0000123');
    assert.equal(saved.color, color);
    for (const nextColor of LOYALTY_COLORS) {
      assert.equal(makeCard({ ...data, color: nextColor }, reopened).color, nextColor);
    }
  }
});

test('invalid selections retain legacy fallback and cannot introduce CSS', () => {
  for (const color of ['', null, false, 7, {}, ['#2563eb'], 'red', 'url(https://invalid.test)', '#abc;display:none', '#123456', '#2563EB']) {
    const data = { description: 'A', number: '001', color };
    assert.equal(cardColor(data), legacyColor('A'));
    assert.equal(makeCard(data).color, legacyColor('A'));
  }
});

test('saving an unchanged colorless legacy card preserves its displayed color without mutating original', () => {
  for (const description of ['A', 'B', 'Пятёрочка', '🛒']) {
    const previous = Object.freeze({ id: 'legacy', description, number: '0001', createdAt: 'earlier' });
    const updated = makeCard({ description, number: previous.number, note: 'Edited' }, previous);
    assert.equal(updated.color, legacyColor(description));
    assert.equal(Object.hasOwn(previous, 'color'), false);
  }
});

test('every swatch supports existing white initials and checkmark at 4.5:1 or better', () => {
  for (const color of LOYALTY_COLORS) {
    const channels = color.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    assert.ok(1.05 / (luminance + .05) >= 4.5, color);
  }
});
