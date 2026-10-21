// patch-1220.test.mjs - исходные заслоны (ratchet) на правки 1.2.20 по живому тесту Алексея:
//   1) вибро-отклик ×3 к 1.2.19 (impact HEAVY + vibrate 120/240/360 мс), удаление заметнее рутины;
//   2) режим порядка БЕЗ ручного перетаскивания: только стрелки ↑/↓, список скроллится пальцем.
// Корень бага п.2: контейнер списка в режиме порядка ставил touch-action:none и на pointerdown
// стартовал drag -> попытка прокрутить превращалась в перенос. Заслон: drag не подключён,
// touch-action режима порядка не none (pan-y). Мутация: вернуть enablePointerReorder в app.js
// или touch-action:none в режим порядка -> тесты краснеют.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');
const APP = read('www', 'js', 'app.js');
const CSS = read('www', 'css', 'app.css').replace(/\r\n/g, '\n');
const FILES = JSON.parse(read('www', 'files.json'));
// Код без комментариев: упоминание в комментарии не считается подключением.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// --- п.2: ручное перетаскивание порядка не подключено ---
test('п.2: drag порядка НЕ подключён - нет enablePointerReorder / импорта reorder.js в app.js', () => {
  const c = code(APP);
  assert.ok(!/enablePointerReorder/.test(c), 'app.js снова подключает enablePointerReorder (drag в режиме порядка)');
  assert.ok(!/from '\.\/reorder\.js'/.test(c), 'app.js снова импортирует reorder.js');
  assert.ok(!/setPointerCapture/.test(c), 'в app.js появился setPointerCapture (признак drag-переноса)');
});
test('п.2: мёртвый модуль reorder.js удалён из www и из описи OTA', () => {
  assert.ok(!fs.existsSync(path.join(HERE, '..', 'www', 'js', 'reorder.js')), 'www/js/reorder.js вернулся');
  assert.ok(!FILES.files.includes('js/reorder.js'), 'files.json всё ещё описывает js/reorder.js');
});
test('п.2: режим порядка - touch-action НЕ none, а pan-y (список скроллится пальцем)', () => {
  const c = code(CSS);
  const m = c.match(/body\.reorder-mode #cards \.entry\s*\{([^}]*)\}/);
  assert.ok(m, 'нет правила body.reorder-mode #cards .entry');
  assert.ok(/touch-action:\s*pan-y/.test(m[1]), 'в режиме порядка карточка должна иметь touch-action: pan-y');
  // Нигде в CSS режим порядка / перенос не глушит прокрутку.
  for (const r of c.matchAll(/([^{}]*reorder[^{}]*)\{([^}]*)\}/g)) {
    assert.ok(!/touch-action:\s*none/.test(r[2]), 'touch-action:none в правиле режима порядка: ' + r[1].trim());
  }
  assert.ok(!/body\.reordering/.test(c), 'вернулись правила body.reordering (глушение скролла при переносе)');
});
test('п.2: баннер режима - «Меняйте порядок стрелками», без упоминания перетаскивания', () => {
  assert.ok(/<span class="reorder-bar-hint">Меняйте порядок стрелками<\/span>/.test(APP), 'текст баннера не тот');
  assert.ok(!/перетаскиван/i.test(code(APP).match(/['"`][^'"`\n]*['"`]/g).join(' ')),
    'в пользовательских строках app.js осталось «перетаскивание»');
});
test('п.2 (A7 1.2.23): стрелки ↑/↓ на месте и ведут в moveWithinGroup -> persistAfterRender -> saveFile', () => {
  assert.ok(/addReorderArrows\(card, current, entry\)/.test(APP), 'стрелки не навешиваются на карточки');
  assert.ok(/moveWithinGroup\(state\.vault\.sections\[section\] \|\| \[\], entry\.id, dir\)/.test(APP));
  assert.ok(/persistAfterRender\('Не удалось сохранить порядок'\)/.test(APP));
});

// --- п.1: вибро (1.2.21: сила возвращена к 1.2.19 по просьбе Алексея) ---
test('п.1: haptic - light→MEDIUM, прочие→HEAVY, длительности 40/80/120 мс (как в 1.2.19)', () => {
  const i = APP.indexOf('function haptic(');
  const body = APP.slice(i, APP.indexOf('\n}\n', i));
  assert.ok(/'HEAVY' : 'MEDIUM'/.test(body), 'импакт: light→MEDIUM, medium/heavy/success→HEAVY');
  assert.ok(/const dur = hapticMs\(kind\);/.test(body), 'длительность должна браться из hapticMs');
  const src = APP.slice(APP.indexOf('function hapticMs('));
  const hapticMs = new Function('kind', src.slice(src.indexOf('{') + 1, src.indexOf('\n}')));
  assert.equal(hapticMs('light'), 40);
  assert.equal(hapticMs('medium'), 80);
  assert.equal(hapticMs('heavy'), 120);
  assert.equal(hapticMs('success'), 120);
  assert.ok(hapticMs('medium') > hapticMs('light'), 'удаление (medium) должно быть заметнее рутины (light)');
});
test('п.1: haptic уважает reduced-motion и глушит промисы плагина', () => {
  const i = APP.indexOf('function haptic(');
  const body = APP.slice(i, APP.indexOf('\n}\n', i));
  assert.ok(/prefers-reduced-motion: reduce\)'\)\.matches\) return;/.test(body), 'нет выхода по reduced-motion');
  assert.ok(/p\.catch\(\(\) => \{\}\)/.test(body) && /v\.catch\(\(\) => \{\}\)/.test(body), 'промисы impact/vibrate не глушатся');
  assert.ok(/addEventListener\('unhandledrejection'[\s\S]{0,300}Haptics/.test(APP), 'нет unhandledrejection-фильтра');
});

// --- п.3: подсказка «?» Документов без абзаца про формат даты (оба формата принимаются молча) ---
test('п.3: в подсказке documents нет абзаца про формат даты, бейдж срока остался', async () => {
  const { HINTS } = await import('../www/js/hints.js');
  const docs = HINTS.documents.join('\n');
  assert.ok(!/ДД\.ММ\.ГГ/.test(docs), 'в подсказке documents снова абзац про формат даты ДД.ММ.ГГГГ/ГГ');
  assert.ok(!/Срок пишется цифрами/.test(docs), 'в подсказке documents снова «Срок пишется цифрами...»');
  assert.ok(/истекает через N дн\./.test(docs) && /истёк/.test(docs), 'пропал абзац про бейдж срока');
});

// --- п.4: B2 обобщён на ВСЕ action-элементы строки поля (не только .ic.copy) ---
// Геометрический заслон (центры глифов, |Δ|<=2px по всем разделам) - tools/qa-align-check.mjs
// (headless). Здесь - исходный ratchet, чтобы обобщённое правило не откатили к одному селектору.
test('п.4: правило строки глифа действует на любой .ic/button/a в .field (inline-flex, 19px, padding+-margin)', () => {
  const c = code(CSS);
  const m = c.match(/\.field > \.ic, \.field > button, \.field > a \{([^}]*)\}/);
  assert.ok(m, 'нет обобщённого правила .field > .ic, .field > button, .field > a');
  const b = m[1];
  assert.ok(/display:\s*inline-flex/.test(b) && /align-items:\s*center/.test(b), 'глиф/svg центрируется в строке (inline-flex)');
  assert.ok(/line-height:\s*19px/.test(b), 'строка = строке значения (19px)');
  assert.ok(/padding-top:\s*11px/.test(b) && /margin-top:\s*-11px/.test(b), 'тап-зона padding + компенсирующий -margin');
  assert.ok(/\.field > \.ic svg, \.field > button svg, \.field > a svg \{[^}]*display:\s*block/.test(c), 'svg - block (не на базовой линии)');
  assert.ok(/\.field > \.ic\.golink \{[^}]*font-size:\s*inherit/.test(c), '«Открыть <лейбл>» - кегль значения, не крупнее');
});

// --- п.6: подсказка длины расчётного счёта - по новому имени поля ---
test('п.6: fieldnorm - «Обычно в расчётном счёте 20 цифр»', async () => {
  const { checkRequisite } = await import('../www/js/fieldnorm.js');
  assert.equal(checkRequisite('account', '123').message, 'Обычно в расчётном счёте 20 цифр, сейчас 3.');
});

// --- 1.2.20 [HIGH]: битое хранилище не превращается в «начать с нуля» ---
test('decideStart: corrupt -> "corrupt" раньше demo/setup/unlock', async () => {
  const { decideStart } = await import('../www/js/onboarding.js');
  assert.equal(decideStart({ hasVault: false, demoEnabled: true, corrupt: true }), 'corrupt');
  assert.equal(decideStart({ hasVault: false, demoEnabled: false, corrupt: true }), 'corrupt');
  assert.equal(decideStart({ hasVault: false, demoEnabled: true }), 'demo', 'без corrupt поведение прежнее');
});
test('boot: VAULT_CORRUPT ловится и ведёт в startCorrupt ДО enterDemo/startSetup', () => {
  const i = APP.indexOf('async function boot()');
  const body = APP.slice(i, APP.indexOf('\n}\n', i));
  assert.ok(/if \(e && e\.code === 'VAULT_CORRUPT'\) \{ corrupt = true;/.test(body), 'boot не отличает «повреждено» от «нет сейфа»');
  const c = body.indexOf("if (route === 'corrupt') return startCorrupt({ missing });");
  assert.ok(c > 0, 'нет ветки corrupt');
  assert.ok(c < body.indexOf('enterDemo()') && c < body.indexOf('startSetup()'), 'ветка corrupt должна идти ДО демо и создания');
  const sc = APP.slice(APP.indexOf('async function startCorrupt('), APP.indexOf('async function startFreshOnCorrupt('));
  assert.ok(!/enterDemo\(|newVaultFile\(/.test(sc), 'экран повреждения не должен создавать новый сейф/демо');
  // 1.2.24 (п.11): новый сейф - ТОЛЬКО явным «Начать заново» после подтверждения (startFreshOnCorrupt).
  assert.equal((sc.match(/startSetup\(/g) || []).length, 1, 'startSetup ровно один раз');
  assert.match(sc, /if \(await startFreshOnCorrupt\(\{ missing \}\)\) \{ state\.storageCorrupt = false; return startSetup\(\); \}/);
});
