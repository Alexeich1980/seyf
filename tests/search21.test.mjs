// search21.test.mjs — поиск по хранилищу (батч-21, bug6). Проверяем ФИЛЬТР store.searchEntries:
// находит по имени и по цифрам, режет по подстроке, «ничего не найдено» = пустой массив,
// и результат раскладывается по разделам (для группировки в UI). Само скрытие витрины —
// CSS-заслон [hidden] (см. hidden-guard.test.mjs), тут только чистая логика фильтра.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyVault, createEntry, searchEntries, SECTIONS } from '../www/js/store.js';

function seeded() {
  const v = emptyVault();
  createEntry(v, 'cards', { bank: 'Демо-банк', number: '0000000000001234', holder: 'IVAN IVANOV' });
  createEntry(v, 'passwords', { description: 'Почта', login: 'demo@example.com' });
  createEntry(v, 'wifi', { ssid: 'HomeNet', password: 'secret' });
  return v;
}

test('bug6: находит карту по имени банка', () => {
  const res = searchEntries(seeded(), 'Демо-банк');
  assert.equal(res.length, 1);
  assert.equal(res[0].section, 'cards');
});

test('bug6: находит по цифрам номера карты (подстрока)', () => {
  const res = searchEntries(seeded(), '1234');
  assert.equal(res.length, 1);
  assert.equal(res[0].section, 'cards');
});

test('bug6: находит по держателю без учёта регистра', () => {
  assert.equal(searchEntries(seeded(), 'ivan').length, 1);
  assert.equal(searchEntries(seeded(), 'IVAN').length, 1);
});

test('bug6: пустой запрос и промах → пусто (состояние «ничего не найдено»)', () => {
  assert.deepEqual(searchEntries(seeded(), ''), []);
  assert.deepEqual(searchEntries(seeded(), '   '), []);
  assert.deepEqual(searchEntries(seeded(), 'неттакого'), []);
});

test('bug6: результат раскладывается по разделам (для группировки выдачи)', () => {
  const v = seeded();
  createEntry(v, 'passwords', { description: 'демо-почта' });      // ещё один в другой раздел
  const res = searchEntries(v, 'демо');                            // карта (банк) + пароль
  const bySection = new Set(res.map((r) => r.section));
  assert.ok(bySection.has('cards'));
  assert.ok(bySection.has('passwords'));
  // раскладка идёт в порядке SECTIONS (passwords раньше cards) — так же группирует и UI
  const order = res.map((r) => r.section).filter((s, i, a) => a.indexOf(s) === i);
  assert.ok(order.indexOf('passwords') < order.indexOf('cards'));
  assert.ok(SECTIONS.indexOf('passwords') < SECTIONS.indexOf('cards'));
});
