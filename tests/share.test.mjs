// share.test.mjs — сборка текста «Копировать все реквизиты» (п.21; 1.2.20 - пункты через пустую строку).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRequisitesShareText } from '../www/js/share.js';

test('полные реквизиты - через ПУСТУЮ строку (1.2.20), подписи из схемы (Расчётный счёт п.7, ОГРН п.8); заметка НЕ включается', () => {
  const text = buildRequisitesShareText({
    name: 'Жена', bank: 'Сбербанк', account: '40817810000000000001', bik: '044525225',
    corr: '30101810400000000225', inn: '7707083893', ogrn: '1027700132195', iban: 'RU00',
    note: 'на имя Дорохина А.',
  });
  assert.equal(text,
    'Банк: Сбербанк\n\n' +
    'Расчётный счёт: 40817810000000000001\n\n' +
    'БИК: 044525225\n\n' +
    'Корр. счёт: 30101810400000000225\n\n' +
    'ИНН / получатель: 7707083893\n\n' +
    'ОГРН/ОГРНИП: 1027700132195\n\n' +
    'IBAN: RU00');
  // Ни заметка (личная пометка), ни «Название» (ярлык карточки) в реквизиты не попадают.
  assert.ok(!text.includes('на имя Дорохина А.'), 'заметка не должна попадать в «Копировать все»');
  assert.ok(!text.includes('Жена'), '«Название» не должно попадать в реквизиты');
});

test('ОГРН пустой — строки нет (необязательное поле, п.8)', () => {
  const text = buildRequisitesShareText({ bank: 'Тинькофф', account: '40817810000000000002' });
  assert.ok(!/ОГРН/.test(text), 'пустой ОГРН не должен попадать в текст');
});

test('пустые поля пропускаются, порядок сохранён', () => {
  const text = buildRequisitesShareText({ bank: 'Тинькофф', bik: '', account: '  ', inn: '7710140679' });
  assert.equal(text, 'Банк: Тинькофф\n\nИНН / получатель: 7710140679');
});

test('нет данных → пустая строка (кнопка сообщит «нечего отправить»)', () => {
  assert.equal(buildRequisitesShareText({}), '');
  assert.equal(buildRequisitesShareText(null), '');
});

test('1.2.20: пункты разделены ровно одной пустой строкой, сплошного текста нет', () => {
  const text = buildRequisitesShareText({ bank: 'Сбербанк', account: '40817810000000000001', bik: '044525225' });
  const parts = text.split('\n\n');
  assert.equal(parts.length, 3, 'три пункта через пустую строку');
  for (const p of parts) assert.ok(!p.includes('\n'), 'внутри пункта нет переноса: ' + JSON.stringify(p));
  assert.ok(!/\n{3,}/.test(text), 'не больше одной пустой строки подряд');
});

test('1.2.20/1.2.24 п.2: «Копировать все» - ЗАЩИЩЁННОЕ копирование (автоочистка), текст целиком через clipboard.writeText', () => {
  const APP = fs.readFileSync(new URL('../www/js/app.js', import.meta.url), 'utf8');
  const i0 = APP.indexOf('async function copyAllRequisites(');
  const body = APP.slice(i0, APP.indexOf('\n}\n', i0));
  assert.match(body, /await copySecret\(text\);/, 'copyAllRequisites должен звать copySecret(text): туда входят произвольные поля (C10)');
  assert.ok(!/copyPlain\(/.test(body), 'без автоочистки буфера (copyPlain) копировать все реквизиты нельзя');
  const i = APP.indexOf('async function copySecret(');
  const cs = APP.slice(i, i + 300);
  assert.ok(/await clip\.copy\(text\)/.test(cs), 'copySecret идёт через clip.copy (очистка по TTL и при блокировке)');
  const CL = fs.readFileSync(new URL('../www/js/clipboard.js', import.meta.url), 'utf8');
  assert.ok(/async function copy\(secret\) \{\s*await clipboard\.writeText\(secret\);/.test(CL), 'clip.copy пишет строку целиком через clipboard.writeText (переносы целы)');
});
