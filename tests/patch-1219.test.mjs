// patch-1219.test.mjs - исходные заслоны (ratchet) на правки батча 1.2.19, которые живут в
// DOM/CSS-слое и не выносятся целиком в чистую функцию. Сканируем текст: содержательная
// регрессия (кто-то вернёт баг стрелок/кропа/контакт-ссылки) сразу краснеет. Живое поведение
// подтверждено скриншотами в браузере + device-QA на телефоне Алексея.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');
const APP = read('www', 'js', 'app.js');
const CSS = read('www', 'css', 'app.css');
const DOCV = read('www', 'js', 'doc-viewer.js');

// --- п.13: стрелки порядка реально работают на устройстве (pointer/touch не крадёт тап) ---
// 1.2.20: корень п.13 (drag контейнера глотал тап по стрелке) устранён удалением drag целиком.
// Прежние заслоны «reorder.js пропускает .reorder-move» / «стрелки гасят pointerdown» заменены
// на patch-1220: drag НЕ подключён, стрелки кликаются без перехватчиков.
test('п.13: клик по стрелке не всплывает до карточки (stopPropagation) и двигает на одну позицию', () => {
  assert.ok(/\.reorder-up'\)\.onclick = \(e\) => \{ e\.stopPropagation\(\); move\(-1\); \}/.test(APP), 'нет ↑');
  assert.ok(/\.reorder-down'\)\.onclick = \(e\) => \{ e\.stopPropagation\(\); move\(1\); \}/.test(APP), 'нет ↓');
});
test('п.13 (A7 1.2.23): перестановка через чистую moveWithinGroup, перерисовка СРАЗУ, запись после (saveFile)', () => {
  assert.ok(/moveWithinGroup\(/.test(APP), 'move должен использовать moveWithinGroup (тестируемо)');
  assert.ok(/function persistAfterRender\([^)]*\)\s*\{[\s\S]*?close: \(\) => \{ try \{ refreshAfterMutation\(\); \}[\s\S]*?persist: saveFile/.test(APP),
    'persistAfterRender обязан перерисовать сразу и сохранить (saveFile) после - иначе порядок не переживёт перезапуск');
});

// --- п.14: длинный URL контакта не рендерится текстом в РАЗВЁРНУТОЙ карточке ---
test('п.14: значение ссылки контакта скрыто всегда (contact-link-hidden), не только свёрнуто', () => {
  assert.ok(/contact-link-hidden/.test(APP) && /contact-link-hidden/.test(CSS),
    'нет класса contact-link-hidden (длинный URL показывался текстом в развёрнутой карточке)');
  assert.ok(/\.contact-link-row \.contact-link-hidden \{ display: none; \}/.test(CSS),
    'contact-link-hidden должен гасить .f-val ВСЕГДА (без :not(.expanded))');
  // .f-val скрытой ссылки помечается contact-link-hidden, а не -collapsed (иначе всплывёт в развороте)
  assert.ok(/querySelector\('\.f-val'\)\?\.classList\.add\('contact-link-hidden'\)/.test(APP),
    'значение ссылки должно получать contact-link-hidden');
});
test('п.14: ячейки значений переносятся overflow-wrap:anywhere, а не word-break:break-all', () => {
  assert.ok(/\.f-val \{ color: var\(--ink\); overflow-wrap: anywhere; min-width: 0; \}/.test(CSS),
    '.f-val должен использовать overflow-wrap:anywhere+min-width:0 (break-all сыпал по 2 символа)');
});

// --- п.15: рамка кропа учитывает смещение центрированного холста ---
test('п.15: paintFrame берёт смещение холста (framePlacement + canvas.offsetLeft/Top)', () => {
  assert.ok(/framePlacement\(crop, scale, canvas\.offsetLeft, canvas\.offsetTop\)/.test(DOCV),
    'paintFrame обязан прибавлять смещение холста, иначе рамка уезжает влево от картинки');
});

// --- п.12: тактильный отклик на основных действиях ---
test('п.12: haptic на сохранении, удалении, копировании и разблокировке', () => {
  // копирование
  assert.ok(/toast\('Скопировано'\);\s*haptic\('light'\)/.test(APP), 'нет haptic на copyPlain');
  assert.ok(/буфер очистится[^']*'\);\s*haptic\('light'\)/.test(APP), 'нет haptic на copySecret');
  // сохранение записи (успех)
  assert.ok(/onSaved: \(\) => haptic\('light'\),\s*\/\/ п\.12/.test(APP), 'нет haptic на успешном сохранении записи');
  // удаление (заметнее - medium), минимум два места удаления
  assert.ok(/Store\.deleteEntry\(state\.vault, section, entry\.id\);\s*haptic\('medium'\);/.test(APP), 'нет haptic(medium) на удалении');
  // разблокировка сейфа
  assert.ok(/hideSplash\(\);[\s\S]{0,80}haptic\('light'\)/.test(APP), 'нет haptic на разблокировке');
});
