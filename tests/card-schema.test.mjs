// card-schema.test.mjs — форма карты (спека 8b п.6) и безопасность ссылок (8b п.8).
// FIELD_SCHEMA — core, синхронна в обе копии (проверяет core-drift). Здесь — смысл схемы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELD_SCHEMA, safeHttpUrl } from '../www/js/ui.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_SRC = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'ui.js'), 'utf8');

// 8d п.13: в плашке записи НЕТ per-field «глаза» (раскрытие — глобальной кнопкой/деталью).
// DOM в node нет, поэтому проверяем источник ui.js: кнопки-глаза и её обработчика быть не должно.
test('renderField: нет per-field кнопки «глаз» (8d п.13)', () => {
  assert.ok(!/class="ic eye"/.test(UI_SRC), 'осталась кнопка-глаз в разметке поля');
  assert.ok(!/querySelector\('\.eye'\)/.test(UI_SRC), 'остался обработчик .eye');
});

test('карта: минимум полей, срок одним полем ММ/ГГ, без description/expMonth/expYear', () => {
  const keys = FIELD_SCHEMA.cards.map((f) => f.key);
  assert.deepEqual(keys, ['bank', 'number', 'holder', 'expiry', 'cvv', 'pin']);
  assert.ok(!keys.includes('description'), 'дефолтного «Описание» быть не должно');
  assert.ok(!keys.includes('expMonth') && !keys.includes('expYear'), 'раздельных месяц/год нет');
});

test('карта: имя и фамилия — одно поле с копированием (type copy)', () => {
  const holder = FIELD_SCHEMA.cards.find((f) => f.key === 'holder');
  assert.equal(holder.type, 'copy');
  assert.equal(holder.label, 'Имя и фамилия');
});

test('карта: CVV и ПИН — секреты', () => {
  assert.equal(FIELD_SCHEMA.cards.find((f) => f.key === 'cvv').type, 'secret');
  assert.equal(FIELD_SCHEMA.cards.find((f) => f.key === 'pin').type, 'secret');
});

test('safeHttpUrl: http(s) как есть, голый домен → https://, иные схемы → null', () => {
  assert.equal(safeHttpUrl('https://a.ru/x'), 'https://a.ru/x');
  assert.equal(safeHttpUrl('http://a.ru'), 'http://a.ru');
  assert.equal(safeHttpUrl('example.com/path'), 'https://example.com/path');
  assert.equal(safeHttpUrl('  bank.ru  '), 'https://bank.ru');
  assert.equal(safeHttpUrl(''), null);
  assert.equal(safeHttpUrl(null), null);
});

test('safeHttpUrl: режет javascript: и прочие опасные схемы', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,x'), null);
  assert.equal(safeHttpUrl('file:///etc/passwd'), null);
  assert.equal(safeHttpUrl('JavaScript:alert(1)'), null);
});
