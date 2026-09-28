import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../www/js/store.js';
import { SECTIONS } from '../www/js/sections.js';

test('emptyVault строит все разделы из списка SECTIONS пустыми массивами', () => {
  const v = S.emptyVault();
  assert.deepEqual(Object.keys(v.sections).sort(), [...SECTIONS].sort());
  for (const s of SECTIONS) assert.deepEqual(v.sections[s], [], 'раздел ' + s + ' пуст');
  assert.ok(SECTIONS.includes('seed'), 'мобильный набор содержит seed');
});

test('createEntry добавляет запись с id в нужный раздел', () => {
  const v = S.emptyVault();
  const e = S.createEntry(v, 'passwords', { description: 'Почта', password: 'x' });
  assert.ok(e.id);
  assert.equal(v.sections.passwords.length, 1);
  assert.ok(e.passwordChanged, 'дата смены пароля проставлена');
});

test('updateEntry меняет поля и дату пароля', () => {
  const v = S.emptyVault();
  const e = S.createEntry(v, 'passwords', { password: 'a' });
  const upd = S.updateEntry(v, 'passwords', e.id, { password: 'b', login: 'me' });
  assert.equal(upd.login, 'me');
  assert.notEqual(upd.passwordChanged, undefined);
});

test('deleteEntry удаляет', () => {
  const v = S.emptyVault();
  const e = S.createEntry(v, 'notes', { title: 'X' });
  assert.equal(S.deleteEntry(v, 'notes', e.id), true);
  assert.equal(v.sections.notes.length, 0);
});

test('reorderEntry переставляет порядок', () => {
  const v = S.emptyVault();
  S.createEntry(v, 'cards', { bank: 'A' });
  S.createEntry(v, 'cards', { bank: 'B' });
  S.createEntry(v, 'cards', { bank: 'C' });
  S.reorderEntry(v, 'cards', 0, 2); // A в конец
  assert.deepEqual(v.sections.cards.map((x) => x.bank), ['B', 'C', 'A']);
});

test('searchEntries находит по разным разделам и полям', () => {
  const v = S.emptyVault();
  S.createEntry(v, 'passwords', { description: 'Госуслуги', login: 'ivan' });
  S.createEntry(v, 'documents', { description: 'Паспорт', number: '4000' });
  const r = S.searchEntries(v, 'пасп');
  assert.equal(r.length, 1);
  assert.equal(r[0].section, 'documents');
});

test('toggleFavorite переключает флаг', () => {
  const v = S.emptyVault();
  const e = S.createEntry(v, 'wallets', { description: 'W' });
  assert.equal(S.toggleFavorite(v, 'wallets', e.id), true);
  assert.equal(v.sections.wallets[0].favorite, true);
});
