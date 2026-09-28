// patch-1216.test.mjs - заслоны на патч 1.2.16: логотип/заголовок меню крупнее, «v.» в версии,
// список возможностей PRO, компактная «Заблокировать», единый размер старт-иконки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, '..', 'www', 'css', 'app.css'), 'utf8');
const HTML = fs.readFileSync(path.join(HERE, '..', 'www', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');

function ruleBody(selector) {
  const re = new RegExp('(^|\\n)\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = CSS.match(re);
  return m ? m[2] : null;
}

// ---- п.1: логотип сейфа в шапке меню крупнее ----
test('меню: логотип .menu-safe крупный (>=40px), задаётся и в JS, и в CSS', () => {
  assert.ok(/class="menu-safe" src="img\/vault-emblem\.png" width="40" height="40"/.test(APP),
    'paintMenuIcons рисует крупный логотип (40px)');
  const b = ruleBody('.menu-safe');
  assert.ok(b, 'нет правила .menu-safe');
  const w = b.match(/width:\s*(\d+)px/);
  assert.ok(w && parseInt(w[1], 10) >= 40, '.menu-safe >= 40px (был 26px)');
});

// ---- п.2: «Сейф» крупнее + «v.» перед версией (только в отображении меню) ----
test('меню: .menu-title крупнее (>=20px)', () => {
  const b = ruleBody('.menu-title');
  const fs2 = b.match(/font-size:\s*(\d+)px/);
  assert.ok(fs2 && parseInt(fs2[1], 10) >= 20, '.menu-title >= 20px (был 17px)');
});

test('меню: версия отображается как «v.<версия>», OTA-сравнение не затронуто', () => {
  assert.ok(/ver\.textContent = ' v\.' \+ \(window\.APP_VERSION/.test(APP),
    'menuVer показывает префикс «v.»');
  // Сам APP_VERSION остаётся чистым числом версии (в files.json/manifest без «v.»).
  assert.ok(/window\.APP_VERSION = '\d+\.\d+\.\d+';/.test(fs.readFileSync(path.join(HERE, '..', 'www', 'version.js'), 'utf8')),
    'version.js хранит версию без префикса (сравнение OTA не ломается)');
});

// ---- п.3: PRO показывает список возможностей вместо пустого сообщения ----
test('PRO: openProFlow в режиме PRO показывает список (openProInfo), не пустой dlgAlert', () => {
  const i = APP.indexOf('function openProFlow');
  const body = APP.slice(i, i + 400);
  assert.ok(/vaultIsPro\(state\.vault\)\)\s*\{\s*openProInfo\(\)/.test(body), 'PRO-ветка вызывает openProInfo');
  assert.ok(!/dlgAlert\('Полная версия активна/.test(APP), 'старое пустое сообщение убрано');
});

test('PRO: openProInfo содержит все согласованные выгоды и отметку активной версии', () => {
  const i = APP.indexOf('function openProInfo');
  assert.ok(i >= 0, 'нет openProInfo');
  const body = APP.slice(i, i + 1600);
  assert.ok(/Без лимитов: сколько угодно паролей/.test(body), 'пункт про лимиты');
  assert.ok(/Все разделы открыты: избранные контакты и важные реквизиты/.test(body), 'пункт про разделы');
  assert.ok(/Один платёж навсегда, не подписка/.test(body), 'пункт про разовый платёж');
  assert.ok(/Все данные только на телефоне, под мастер-паролем/.test(body), 'пункт про приватность');
  assert.ok(/Поддержка развития приложения/.test(body), 'пункт про поддержку');
  assert.ok(/Полная версия активна/.test(body), 'отметка «активна» для PRO');
  assert.ok(/Что открыто/.test(body), 'заголовок списка «Что открыто» для PRO');
});

// ---- п.4: «Заблокировать» вынесена из растянутой сетки и обычной высоты ----
test('меню: mLock вынесена ИЗ .menu-list (иначе grid-auto-rows:1fr растягивал её)', () => {
  const listStart = HTML.indexOf('<div class="menu-list">');
  const listEnd = HTML.indexOf('</div>', listStart);
  const listInner = HTML.slice(listStart, listEnd);
  assert.ok(!/id="mLock"/.test(listInner), 'mLock не должна быть внутри .menu-list');
  assert.ok(/id="mAbout"/.test(listInner), 'плитки-настройки остаются в .menu-list');
});

test('меню: .mi-lock фиксированной нормальной высоты (не 1fr), полная ширина', () => {
  const b = ruleBody('.mi-lock.mi');
  assert.ok(b, 'нет правила .mi-lock.mi');
  assert.ok(/flex:\s*0 0 auto/.test(b), 'lock не растягивается (flex:0 0 auto)');
  const h = b.match(/height:\s*(\d+)px/);
  assert.ok(h && parseInt(h[1], 10) <= 60, 'высота «Заблокировать» обычная (<=60px)');
  assert.ok(/width:\s*100%/.test(b), 'полная ширина');
});

// ---- B2 (истинная причина): глиф копирования на линии текста даже у ОДНОСТРОЧНОГО значения ----
// Браузерный пруф (устройство/Chromium 375px): ДО фикса центр глифа был на +3.2px ниже центра
// строки (кнопка 26px выше строки 19px, глиф центрирован по кнопке); ПОСЛЕ - разница 0.0px во всех
// типах полей (text/copy/secret/link/date/textarea), тап-зона 41px, горизонталь card-inline цела.
test('B2: .field > .ic.copy сводит глиф к строке значения (line-height=строка + компенсирующий margin)', () => {
  const b = ruleBody('.field > .ic.copy');
  assert.ok(b, 'нет правила .field > .ic.copy (выравнивание глифа по строке)');
  // строка глифа == строка значения (не выше), чтобы центр совпал
  assert.ok(/line-height:\s*19px/.test(b), 'line-height глифа = высоте строки значения');
  // тап-зону создаём вертикальным padding...
  assert.ok(/padding-top:\s*11px/.test(b) && /padding-bottom:\s*11px/.test(b), 'вертикальный padding даёт тап-зону');
  // ...скомпенсированным ОТРИЦАТЕЛЬНЫМ margin, иначе padding увёл бы глиф вниз (это и был баг)
  assert.ok(/margin-top:\s*-11px/.test(b) && /margin-bottom:\s*-11px/.test(b), 'padding компенсирован -margin (глиф на линии, не ниже)');
  // горизонталь НЕ трогаем: margin-left:auto у card-inline и padding-left/right остаются
  assert.ok(!/margin-left/.test(b) && !/margin-right/.test(b) && !/margin:\s/.test(b), 'горизонтальные отступы не тронуты (card-inline цел)');
  assert.ok(!/padding-left/.test(b) && !/padding-right/.test(b) && !/padding:\s/.test(b), 'горизонтальный padding не тронут');
});

test('B2 [мутация]: без компенсирующего -margin padding увёл бы глиф вниз (заслон на связку)', () => {
  const b = ruleBody('.field > .ic.copy');
  // связка padding+(-margin) обязательна вместе; проверяем, что оба знака присутствуют
  const hasPad = /padding-top:\s*11px/.test(b);
  const hasNegMargin = /margin-top:\s*-11px/.test(b);
  assert.ok(hasPad && hasNegMargin, 'padding и компенсирующий -margin должны идти в паре');
});

// ---- п.5: единый крупный размер старт-иконки (splash == login) ----
test('старт: splash-icon и lock-logo одинакового крупного размера (нет «прыжка» иконки)', () => {
  const sp = ruleBody('.splash-icon');
  const lg = ruleBody('.lock-logo');
  const spW = sp.match(/width:\s*(\d+)px/), lgW = lg.match(/width:\s*(\d+)px/);
  assert.ok(spW && lgW, 'обе иконки имеют размер');
  assert.equal(spW[1], lgW[1], 'splash-icon и lock-logo одинаковой ширины');
  assert.ok(parseInt(lgW[1], 10) >= 100, 'иконка крупная (>=100px)');
  // разметка: атрибуты width/height тоже согласованы
  assert.ok(/class="splash-icon"[^>]*width="104"/.test(HTML), 'splash-icon 104 в разметке');
  assert.ok(/class="lock-logo"[^>]*width="104"/.test(HTML), 'lock-logo 104 в разметке');
});
