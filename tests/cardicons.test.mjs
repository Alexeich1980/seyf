// cardicons.test.mjs — новый плоский векторный набор (вариант A): дефолт раздела, сохранение
// выбора, рендер inline-SVG. Растровый путь отключён (везде вектор), поэтому проверяем, что
// renderCardIcon всегда отдаёт непустой <svg> в кадре 24×24, единый набор красится бирюзой+
// золотом на самом <svg> (класс .cardicon-svg), и что правки Алексея (seed=монета, totp=twofa)
// закреплены ратчетом.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveIconId, renderCardIcon, sectionDefaultIcon, CARD_ICON_PATHS, CARD_ICON_IDS,
} from '../www/js/cardicons.js';

const SECTIONS = ['passwords', 'cards', 'wallets', 'seed', 'documents', 'notes', 'totp', 'contacts', 'wifi', 'requisites'];

test('нет выбора → иконка по разделу (дефолт)', () => {
  assert.equal(resolveIconId({}, 'passwords'), sectionDefaultIcon('passwords'));
  assert.equal(resolveIconId({ icon: '' }, 'cards'), 'card');
});

test('выбранная валидная иконка сохраняется и возвращается', () => {
  assert.equal(resolveIconId({ icon: 'globe' }, 'passwords'), 'globe');
});

test('невалидный id → откат на дефолт раздела (не падаем)', () => {
  assert.equal(resolveIconId({ icon: 'нет-такой' }, 'notes'), sectionDefaultIcon('notes'));
});

test('renderCardIcon рисует inline-SVG 24×24 нужного размера', () => {
  const html = renderCardIcon('globe', 20);
  assert.match(html, /<svg[^>]*class="cardicon-svg"/);
  assert.match(html, /viewBox="0 0 24 24"/);
  assert.match(html, /width="20"/);
  assert.match(html, /<\/svg>$/);
});

test('растровый путь отключён: без <img> и без класса duo (везде вектор)', () => {
  for (const id of CARD_ICON_IDS) {
    const html = renderCardIcon(id, 24);
    assert.doesNotMatch(html, /<img/, 'растр для ' + id);
    assert.doesNotMatch(html, /\bduo\b/, 'класс duo для ' + id);
  }
});

test('renderCardIcon неизвестного id не бросает, даёт валидный SVG (fallback lock)', () => {
  const html = renderCardIcon('zzz');
  assert.match(html, /<svg/);
  assert.ok(html.includes(CARD_ICON_PATHS.lock.slice(0, 40)), 'fallback должен быть lock');
});

test('каждая иконка набора — непустое тело с бирюзой и акцентом (единый стиль)', () => {
  // seed = монета с тёмным ₿ (акцент - контрастный тёмный символ, не золото: золото сливалось
  // с бирюзой). У остальных акцент золотой. Бирюза обязательна у всех.
  for (const id of CARD_ICON_IDS) {
    const body = CARD_ICON_PATHS[id];
    assert.ok(body && body.length > 10, 'пустое тело: ' + id);
    assert.match(body, /var\(--teal\)/, 'нет бирюзы в ' + id);
    if (id !== 'seed') assert.match(body, /var\(--gold\)/, 'нет золотого акцента в ' + id);
  }
});

test('все дефолты разделов (10) ссылаются на существующие иконки набора', () => {
  for (const s of SECTIONS) {
    assert.ok(CARD_ICON_PATHS[sectionDefaultIcon(s)], 'нет иконки для дефолта ' + s);
    assert.match(renderCardIcon(sectionDefaultIcon(s)), /<svg[\s\S]*<\/svg>/);
  }
});

// --- ратчет правок Алексея по варианту A ---
test('seed раздел = криптомонета (₿), НЕ росток; totp = twofa', () => {
  assert.equal(sectionDefaultIcon('seed'), 'seed');
  assert.equal(sectionDefaultIcon('totp'), 'twofa');
  // монета: сплошной бирюзовый кружок + тёмный символ ₿ (разборчивый, контраст с бирюзой); росток убран.
  assert.match(CARD_ICON_PATHS.seed, /circle cx="12" cy="12" r="8\.6" fill="var\(--teal\)"/);
  assert.match(CARD_ICON_PATHS.seed, /₿/);
});
