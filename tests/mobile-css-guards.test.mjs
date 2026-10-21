// mobile-css-guards.test.mjs — машинные заслоны на CSS-правки бэклога (п.13/1/8, п.18, п.19,
// п.15). Читаем www/css/app.css как текст и проверяем ключевые правила: содержательные
// регрессии (кто-то вернёт overflow:auto модалке или nowrap заголовку) сразу краснеют.
// Геометрию (реальный layout) JSDOM не считает, поэтому заслон - на самих CSS-объявлениях,
// подтверждённых живой проверкой в браузере (scrollWidth==clientWidth после фикса).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, '..', 'www', 'css', 'app.css'), 'utf8');

// Достаёт тело правила по точному селектору в начале строки (первый матч).
function ruleBody(selector) {
  const re = new RegExp('(^|\\n)\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = CSS.match(re);
  return m ? m[2] : null;
}

test('п.13/1/8: .modal блокирует горизонтальный сдвиг (overflow-x:hidden, НЕ overflow:auto)', () => {
  const body = ruleBody('.modal');
  assert.ok(body, 'правило .modal не найдено');
  assert.ok(/overflow-x:\s*hidden/.test(body), '.modal должен иметь overflow-x: hidden');
  assert.ok(!/overflow:\s*auto/.test(body), '.modal НЕ должен иметь overflow: auto (вернётся горизонтальный сдвиг)');
});

test('п.13: .cf-row переносится (flex-wrap), строка произвольного поля не шире модалки', () => {
  const body = ruleBody('.cf-row');
  assert.ok(body, 'правило .cf-row не найдено');
  assert.ok(/flex-wrap:\s*wrap/.test(body), '.cf-row должен переноситься (flex-wrap: wrap)');
});

test('п.18: .field выравнивает подпись/кнопку по верхней строке значения (flex-start)', () => {
  const body = ruleBody('.field');
  assert.ok(body, 'правило .field не найдено');
  assert.ok(/align-items:\s*flex-start/.test(body), '.field должен быть align-items: flex-start');
  assert.ok(!/align-items:\s*center/.test(body), '.field НЕ должен центрировать (подпись съезжает вниз)');
});

test('п.19: .sechead-title переносится на 2 строки, без nowrap/ellipsis', () => {
  const body = ruleBody('.sechead-title');
  assert.ok(body, 'правило .sechead-title не найдено');
  assert.ok(/white-space:\s*normal/.test(body), 'заголовок раздела должен переноситься (white-space: normal)');
  assert.ok(!/white-space:\s*nowrap/.test(body), 'заголовок раздела НЕ должен резаться в одну строку');
});

test('п.15: кастомные поля скрыты в свёрнутом превью (правило cf-preview-hide есть)', () => {
  assert.ok(/\.cf-preview-hide/.test(CSS), 'нет правила скрытия кастомных полей в превью');
  assert.ok(/:not\(\.expanded\)[^{]*\.cf-preview-hide/.test(CSS), 'кастомные поля должны скрываться только пока карточка не развёрнута');
});

// --- v2 (приёмка на реале): заслоны на истинные причины каскада ---

test('B1: экран входа центрируется flex-ом (не хрупким grid place-items), карта с margin auto', () => {
  const lock = ruleBody('#lock');
  assert.ok(lock, 'нет правила #lock');
  assert.ok(/display:\s*flex/.test(lock), '#lock должен центрировать через flex');
  assert.ok(/align-items:\s*center/.test(lock), '#lock должен align-items: center');
  const card = ruleBody('.lock-card');
  assert.ok(card && /margin-inline:\s*auto/.test(card), '.lock-card должна иметь margin-inline: auto');
});

test('B2: каждый прямой ребёнок .field явно прижат к верху (align-self:flex-start)', () => {
  // v3: пуленепробиваемо - align-self на КАЖДОМ ребёнке .field, не только на label/ic.
  assert.ok(/\.field\s*>\s*\*\s*\{[^}]*align-self:\s*flex-start/.test(CSS),
    'нужен align-self: flex-start для всех прямых детей .field');
});

test('B3: глиф в ячейке пикера увеличен масштабом (не просто 100%)', () => {
  const svg = ruleBody('.iconcell svg');
  assert.ok(svg, 'нет правила .iconcell svg');
  assert.ok(/transform:\s*scale\(/.test(svg), 'глиф пикера должен увеличиваться scale()');
});

test('B4: срок/CVV/ПИН в карточке - строгая сетка из 3 колонок (без переноса ПИН)', () => {
  const grid = ruleBody('.card-inline-fields');
  assert.ok(grid, 'нет правила .card-inline-fields');
  assert.ok(/display:\s*grid/.test(grid), '.card-inline-fields должна быть grid');
  assert.ok(/repeat\(3,/.test(grid), 'ровно 3 колонки');
  assert.ok(!/flex-wrap:\s*wrap/.test(grid), 'перенос (flex-wrap) недопустим - ПИН уезжал на 2-ю строку');
});

test('B5: в документах «выдан <дата>» без прижатия вправо (margin-left:0)', () => {
  assert.ok(/\.entry\[data-section="documents"\]\s*\.changed\s*\{[^}]*margin-left:\s*0/.test(CSS),
    'дата «выдан» в документах должна идти в общем потоке (margin-left: 0)');
});
