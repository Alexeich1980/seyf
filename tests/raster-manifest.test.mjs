// raster-manifest.test.mjs — порядок иконок пикера после перехода на векторный набор (вариант A).
// Раст (PNG-лист) отключён: PICKER_ICON_IDS = все ключи cardicons. Заслон: список не пустой,
// без дублей, синхронен с CARD_ICON_IDS, каждый id пикера рендерится в непустой <svg>, и все
// дефолты разделов присутствуют в наборе (иначе «Авто»-ячейка пикера рисовала бы пустоту).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PICKER_ICON_IDS } from '../www/js/raster-manifest.js';
import { CARD_ICON_IDS, renderCardIcon, sectionDefaultIcon, CARD_ICON_PATHS } from '../www/js/cardicons.js';

const SECTIONS = ['passwords', 'cards', 'wallets', 'seed', 'documents', 'notes', 'totp', 'contacts', 'wifi', 'requisites'];

test('список пикера не пустой и синхронен с набором cardicons', () => {
  assert.ok(PICKER_ICON_IDS.length >= 30, 'ожидали >=30 иконок, есть ' + PICKER_ICON_IDS.length);
  assert.deepEqual(PICKER_ICON_IDS, CARD_ICON_IDS);
});

test('id пикера уникальны (нет дублей)', () => {
  assert.equal(new Set(PICKER_ICON_IDS).size, PICKER_ICON_IDS.length);
});

test('10 эталонных ключей присутствуют в наборе', () => {
  for (const id of ['key', 'card', 'wallet', 'seed', 'doc', 'note', 'twofa', 'user', 'wifi', 'bank']) {
    assert.ok(PICKER_ICON_IDS.includes(id), 'нет эталонной иконки ' + id);
    assert.ok(CARD_ICON_PATHS[id], 'нет тела иконки ' + id);
  }
});

test('каждый id пикера рендерится в непустой <svg>', () => {
  for (const id of PICKER_ICON_IDS) {
    const html = renderCardIcon(id, 20);
    assert.match(html, /<svg[\s\S]*<\/svg>/, 'пустой рендер ' + id);
    assert.ok(CARD_ICON_PATHS[id].length > 10, 'пустое тело ' + id);
  }
});

test('все дефолты разделов входят в набор пикера', () => {
  for (const s of SECTIONS) {
    assert.ok(PICKER_ICON_IDS.includes(sectionDefaultIcon(s)), 'дефолт ' + s + ' не в наборе');
  }
});
