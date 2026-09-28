// sectionsx.test.mjs — новые разделы batch2 (Контакты/Wi-Fi/Реквизиты): регистрация в UI,
// схемы, «глаз» только у Wi-Fi, заслон апгрейда ensureSections. sectionsx мутирует UI.* при
// импорте — проверяем результат этой мутации на живых core-объектах.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXTRA_LABELS, EXTRA_SCHEMA, ensureSections } from '../www/js/sectionsx.js';
import * as UI from '../www/js/ui.js';
import { SECTIONS } from '../www/js/sections.js';
import { sectionHasSecrets } from '../www/js/secvis.js';
import { sectionDefaultIcon, CARD_ICON_PATHS } from '../www/js/cardicons.js';

const NEW = ['contacts', 'wifi', 'requisites'];

test('sections.js содержит три новых раздела', () => {
  for (const s of NEW) assert.ok(SECTIONS.includes(s), 'нет раздела ' + s);
  assert.equal(SECTIONS.length, 10);
});

test('импорт sectionsx дорегистрировал подписи и схемы в core-объекты UI', () => {
  for (const s of NEW) {
    assert.equal(UI.SECTION_LABELS[s], EXTRA_LABELS[s], 'нет подписи ' + s);
    assert.ok(Array.isArray(UI.FIELD_SCHEMA[s]) && UI.FIELD_SCHEMA[s].length, 'нет схемы ' + s);
    assert.deepEqual(UI.FIELD_SCHEMA[s], EXTRA_SCHEMA[s]);
  }
});

test('первое поле каждой схемы — «Название»-заголовок карточки', () => {
  // Wi-Fi и Реквизиты: заголовок = произвольное «Название» (п.20/п.21), отдельно от SSID/полей.
  assert.equal(EXTRA_SCHEMA.contacts[0].key, 'name');
  assert.equal(EXTRA_SCHEMA.wifi[0].key, 'name');
  assert.equal(EXTRA_SCHEMA.requisites[0].key, 'name');
});

test('Wi-Fi: имя сети (SSID) - отдельное поле в теле, не заголовок (п.20)', () => {
  const keys = EXTRA_SCHEMA.wifi.map((f) => f.key);
  assert.deepEqual(keys, ['name', 'ssid', 'password', 'note']);
});

test('Реквизиты: «Название» перед банком, порядок полей сохранён + ОГРН после ИНН (п.8/п.21)', () => {
  const keys = EXTRA_SCHEMA.requisites.map((f) => f.key);
  assert.deepEqual(keys, ['name', 'bank', 'account', 'bik', 'corr', 'inn', 'ogrn', 'iban', 'note']);
});

test('Реквизиты: «Расчётный счёт» (п.7) и «ОГРН/ОГРНИП» (п.8), поля copy', () => {
  const byKey = Object.fromEntries(EXTRA_SCHEMA.requisites.map((f) => [f.key, f]));
  assert.equal(byKey.account.label, 'Расчётный счёт');
  assert.equal(byKey.ogrn.label, 'ОГРН/ОГРНИП');
  assert.equal(byKey.ogrn.type, 'copy');
});

test('Контакты: новое поле E-mail (п.10), тип copy', () => {
  const email = EXTRA_SCHEMA.contacts.find((f) => f.key === 'email');
  assert.ok(email, 'нет поля email в контактах');
  assert.equal(email.label, 'E-mail');
  assert.equal(email.type, 'copy');
});

test('«глаз» (секрет) ТОЛЬКО у Wi-Fi среди новых разделов', () => {
  assert.equal(sectionHasSecrets(EXTRA_SCHEMA.wifi, []), true, 'Wi-Fi обязан иметь секрет');
  assert.equal(sectionHasSecrets(EXTRA_SCHEMA.contacts, []), false, 'Контакты без секретов');
  assert.equal(sectionHasSecrets(EXTRA_SCHEMA.requisites, []), false, 'Реквизиты без секретов');
});

test('реквизиты: числовые поля — copy (копирование)', () => {
  const byKey = Object.fromEntries(EXTRA_SCHEMA.requisites.map((f) => [f.key, f.type]));
  for (const k of ['account', 'bik', 'corr', 'inn', 'iban']) assert.equal(byKey[k], 'copy', k + ' должен быть copy');
});

test('дефолт-иконки новых разделов ссылаются на существующие глифы', () => {
  for (const s of NEW) assert.ok(CARD_ICON_PATHS[sectionDefaultIcon(s)], 'нет иконки для ' + s);
});

test('ensureSections: старый vault (7 разделов) дозаполняется до полного набора', () => {
  const old = { version: 1, sections: { passwords: [{ id: 'a' }], cards: [], wallets: [], seed: [], documents: [], notes: [], totp: [] } };
  ensureSections(old);
  for (const s of SECTIONS) assert.ok(Array.isArray(old.sections[s]), 'не дозаполнен ' + s);
  assert.equal(old.sections.passwords.length, 1, 'существующие записи не тронуты');
});

test('ensureSections: битый vault не роняет (создаёт sections)', () => {
  const v = ensureSections({});
  for (const s of SECTIONS) assert.deepEqual(v.sections[s], []);
  assert.doesNotThrow(() => ensureSections(null));
});
