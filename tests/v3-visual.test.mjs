// v3-visual.test.mjs — машинные заслоны на v3-визуал: единая эмблема, порядок витрины,
// меню-плитки и правило симметрии. Геометрию JSDOM не считает, поэтому заслон - на порядке
// массива SECTIONS (чистые данные) и на самих CSS/HTML-объявлениях (текстом). Откат любого
// из них сразу краснит тест (протокол ошибок - заслон машинный, не «буду внимателен»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS } from '../www/js/sections.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');
const HTML = read('www', 'index.html');
const APP = read('www', 'js', 'app.js');
const CSS = read('www', 'css', 'app.css');

// Достаёт тело CSS-правила по точному селектору в начале строки (первый матч, без вложенных {}).
function ruleBody(selector) {
  const re = new RegExp('(^|\\n)\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = CSS.match(re);
  return m ? m[2] : null;
}

test('витрина: порядок разделов согласован (v3-визуал 17.09)', () => {
  assert.deepEqual(SECTIONS, [
    'passwords', 'totp', 'cards', 'requisites', 'wallets',
    'seed', 'wifi', 'contacts', 'documents', 'notes',
  ]);
});

test('эмблема: старт/иконки/триггер/О приложении ссылаются на vault-emblem.png', () => {
  // favicon + apple-touch + splash + lock-logo в index.html
  assert.equal((HTML.match(/img\/vault-emblem\.png/g) || []).length, 4, 'ожидали 4 ссылки на эмблему в index.html');
  // триггер меню (topbar), голова меню, «О приложении» в app.js
  assert.ok(/class="topbar-safe" src="img\/vault-emblem\.png"/.test(APP), 'триггер меню на эмблему');
  assert.ok(/class="menu-safe" src="img\/vault-emblem\.png"/.test(APP), 'голова меню на эмблему');
  assert.ok(/class="about-app"><img src="img\/vault-emblem\.png"/.test(APP), '«О приложении» на эмблему');
});

test('эмблема: старая vault-round.png больше не референсится в HTML/JS-исходнике', () => {
  assert.ok(!/vault-round\.png/.test(HTML), 'index.html не должен ссылаться на vault-round.png');
  assert.ok(!/vault-round\.png/.test(APP), 'app.js не должен ссылаться на vault-round.png');
});

test('меню-плитки: сетка 2 колонки, содержимое по центру, пояснения скрыты', () => {
  const list = ruleBody('.menu-list');
  assert.ok(list && /grid-template-columns:\s*1fr 1fr/.test(list), '.menu-list - сетка 2 колонки');
  const mi = ruleBody('.mi');
  assert.ok(mi && /align-items:\s*center/.test(mi), '.mi центрирует содержимое');
  const mis = ruleBody('.mi-s');
  assert.ok(mis && /display:\s*none/.test(mis), '.mi-s (длинные пояснения) скрыты в плитках');
});

test('симметрия меню: нечётная последняя плитка на всю ширину', () => {
  assert.ok(/\.menu-list \.mi:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*1 \/ -1/.test(CSS),
    'нужно правило симметрии для меню (:last-child:nth-child(odd) -> span 2)');
});

test('симметрия витрины: нечётная последняя плитка на всю ширину', () => {
  assert.ok(/\.vitrina \.vtile:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*1 \/ -1/.test(CSS),
    'нужно правило симметрии для витрины (:last-child:nth-child(odd) -> span 2)');
});

test('порядок пунктов меню в index.html: согласованные пары + Заблокировать последней', () => {
  const ids = [...HTML.matchAll(/<button class="mi[^"]*" id="(m\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['mBio', 'mKey', 'mBackup', 'mUpdate', 'mTheme', 'mSections', 'mPro', 'mAbout', 'mLock']);
  assert.equal(ids[ids.length - 1], 'mLock', '«Заблокировать» - последняя (широкая) плитка');
});
