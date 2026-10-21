// patch-1222.test.mjs - заслоны (ratchet) на правки 1.2.22 по живому тесту Алексея:
//   1) обрезка фото: две кнопки поворота ↺ влево / ↻ вправо вместо одной «Повернуть»;
//   2) редактор документа: «Срок действия» сразу под «Дата выдачи», «Комментарии» последним
//      (корень: строка срока добавлялась form.appendChild(meta) - в конец, после комментариев);
//      в карточке тот же порядок: выдан -> срок -> комментарии;
//   3) живые маски (даты, срок карты, номер карты, ссылка, имя, seed-слова) не уводят каретку в
//      конец: только через bindCaretMask (reformatWithCaret + setSelectionRange).
// Поведенческие проверки порядка - на функциях, вырезанных из app.js и запущенных на мини-DOM.
// Мутация: вернуть form.appendChild(meta) / не переносить комментарии / вернуть голое
// «x.value = formatDocDate(x.value)» -> тесты краснеют.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as UI from '../www/js/ui.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const APP = read('www', 'js', 'app.js');
const DV = read('www', 'js', 'doc-viewer.js');
const CSS = read('www', 'css', 'app.css');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// Вырезать функцию верхнего уровня из исходника app.js (до первой строки «}» в колонке 0).
function extractFn(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `в app.js нет function ${name}`);
  const end = src.indexOf('\n}\n', i);
  return src.slice(i, end + 2);
}

// ---------- 1. кроп: две кнопки поворота ----------
test('кроп: две кнопки-иконки ↺/↻ с aria-label «Повернуть влево/вправо», старой «⟳ Повернуть» нет', () => {
  assert.match(DV, /class="crop-rotate crop-rotate-ccw"[^>]*aria-label="Повернуть влево"[^>]*>\s*<span aria-hidden="true">↺<\/span>/);
  assert.match(DV, /class="crop-rotate crop-rotate-cw"[^>]*aria-label="Повернуть вправо"[^>]*>\s*<span aria-hidden="true">↻<\/span>/);
  assert.ok(!DV.includes('⟳ Повернуть'), 'осталась старая одиночная кнопка «⟳ Повернуть»');
  assert.ok(DV.includes('Кнопки поворота - если фото боком.'), 'подсказка под рамкой не обновлена');
  assert.ok(!/«Повернуть» - если фото боком/.test(DV), 'осталась старая подсказка про «Повернуть»');
});
test('кроп: ↺ вызывает rotateCropCCW (против часовой), ↻ - rotateCropCW', () => {
  const c = code(DV);
  assert.match(c, /\.crop-rotate-ccw'\)\.onclick = \(\) => rotate\(false\)/);
  assert.match(c, /\.crop-rotate-cw'\)\.onclick = \(\) => rotate\(true\)/);
  assert.match(c, /cw \? rotateCropCW\(crop, base\.width, base\.height\) : rotateCropCCW\(crop, base\.width, base\.height\)/);
  assert.match(c, /ctx\.rotate\(-Math\.PI \/ 2\)/, 'нет отрисовки поворота против часовой');
});
test('кроп: кнопка поворота выглядит кнопкой (рамка+фон) и тап-зона >= 44px', () => {
  const m = CSS.match(/\.crop-rotate \{([^}]*)\}/);
  assert.ok(m, 'нет правила .crop-rotate');
  assert.match(m[1], /border: 1px solid/);
  assert.match(m[1], /background: var\(--elevated\)/);
  assert.match(m[1], /width: 44px/);
  assert.match(m[1], /height: 44px/);
});

// ---------- 2. порядок полей документа ----------
// Мини-DOM формы: ряды с data-key; insertBefore/appendChild/nextSibling как у настоящего DOM.
function fakeForm(keys) {
  const form = { children: [] };
  const mkRow = (key) => {
    const row = { key, parentNode: form };
    Object.defineProperty(row, 'nextSibling', { get: () => form.children[form.children.indexOf(row) + 1] || null });
    row.input = { tag: key === 'comments' ? 'textarea' : 'input', closest: () => row };
    return row;
  };
  form.children = keys.map(mkRow);
  form.querySelector = (sel) => {
    const m = sel.match(/^\[data-key="(.+)"\]$/);
    if (m) { const r = form.children.find((x) => x.key === m[1]); return r ? r.input : null; }
    if (sel === 'textarea') { const r = form.children.find((x) => x.input && x.input.tag === 'textarea'); return r ? r.input : null; }
    return null;
  };
  form.insertBefore = (n, ref) => {
    const cur = form.children.indexOf(n); if (cur >= 0) form.children.splice(cur, 1);
    const idx = ref ? form.children.indexOf(ref) : form.children.length;
    form.children.splice(idx < 0 ? form.children.length : idx, 0, n); n.parentNode = form;
  };
  form.appendChild = (n) => form.insertBefore(n, null);
  return form;
}
const placeDocExpiryRow = new Function(`${extractFn(APP, 'placeDocExpiryRow')}; return placeDocExpiryRow;`)();

test('редактор документа: схема ядра documents - issueDate, затем comments (ключи для вставки)', () => {
  const keys = UI.FIELD_SCHEMA.documents.map((f) => f.key);
  assert.ok(keys.includes('issueDate') && keys.includes('comments'));
  assert.ok(keys.indexOf('issueDate') < keys.indexOf('comments'));
});
test('редактор документа: «Срок действия» сразу под «Дата выдачи», «Комментарии» последним', () => {
  const form = fakeForm(['icon', ...UI.FIELD_SCHEMA.documents.map((f) => f.key)]);
  const meta = { key: 'expiry' };
  placeDocExpiryRow(form, meta);
  const order = form.children.map((r) => r.key);
  assert.deepEqual(order, ['icon', 'description', 'number', 'issueDate', 'expiry', 'comments']);
  assert.equal(order[order.length - 1], 'comments');
});
test('редактор документа: нет даты выдачи - срок перед комментариями; нет и их - в конец', () => {
  const f1 = fakeForm(['description', 'number', 'comments']);
  placeDocExpiryRow(f1, { key: 'expiry' });
  assert.deepEqual(f1.children.map((r) => r.key), ['description', 'number', 'expiry', 'comments']);
  const f2 = fakeForm(['description', 'number']);
  placeDocExpiryRow(f2, { key: 'expiry' });
  assert.deepEqual(f2.children.map((r) => r.key), ['description', 'number', 'expiry']);
});
test('редактор документа: блок documents ставит срок через placeDocExpiryRow, не appendChild(meta)', () => {
  const c = code(APP);
  const i = c.indexOf("if (section === 'documents') {\n    const meta");
  assert.ok(i >= 0, 'не найден блок documents в openEditor');
  const block = c.slice(i, c.indexOf("box.className = 'doc-attach'", i));
  assert.match(block, /placeDocExpiryRow\(form, meta\)/);
  assert.ok(!/form\.appendChild\(meta\)/.test(block), 'срок снова добавляется в конец формы (после комментариев)');
  // сканы - после полей (как было)
  assert.match(c.slice(i), /form\.appendChild\(box\)/);
});

// Карточка: комментарии уходят в конец тела (после «выдан …» и футера со сроком).
const moveDocCommentsLast = new Function('UI', `${extractFn(APP, 'moveDocCommentsLast')}; return moveDocCommentsLast;`)(UI);
function fakeCardBody(parts) {
  const body = { children: [] };
  body.children = parts.map((p) => ({ ...p, querySelector: (s) => (s === '.f-label' && p.label ? { textContent: p.label } : null) }));
  body.querySelectorAll = (sel) => (sel === ':scope > .field' ? body.children.filter((x) => x.cls === 'field') : []);
  body.appendChild = (n) => { const k = body.children.indexOf(n); if (k >= 0) body.children.splice(k, 1); body.children.push(n); };
  return { querySelector: (s) => (s === '.entry-body' ? body : null), body };
}
test('карточка документа: порядок номер -> выдан -> срок -> комментарии', () => {
  const card = fakeCardBody([
    { cls: 'field', label: 'Номер', id: 'number' },
    { cls: 'field', label: 'Комментарии', id: 'comments' },
    { cls: 'changed', id: 'issued' },
    { cls: 'doc-foot', id: 'expiry' },
  ]);
  moveDocCommentsLast(card);
  assert.deepEqual(card.body.children.map((x) => x.id), ['number', 'issued', 'expiry', 'comments']);
});
test('карточка документа: decorateDocCard зовёт moveDocCommentsLast ДО миниатюр', () => {
  const fn = code(extractFn(APP, 'decorateDocCard'));
  const a = fn.indexOf('moveDocCommentsLast(card)'), b = fn.indexOf('decorateDocThumbs(card, entry)');
  assert.ok(a > 0, 'decorateDocCard не переносит комментарии');
  assert.ok(a < b, 'комментарии должны переноситься до добавления миниатюр (сканы - после)');
  assert.ok(fn.indexOf("appendChild(foot)") < a, 'перенос комментариев должен идти после футера со сроком');
});

// ---------- 3. каретка живых масок ----------
test('маски: все переписывающие value обработчики идут через bindCaretMask', () => {
  const c = code(APP);
  // голое переприсваивание значения маской (корень бага «каретка улетает в конец»)
  const bad = [
    // (стартовое форматирование значения при открытии редактора - не в input-обработчике - допустимо)
    /addEventListener\('input'[^\n]*\.value = (formatExpiry|Docs\.formatDocDate|mask|formatCardNumber)\(/,
    /inp\.value = a;/, /inp\.value = cleaned/, /inp\.value = r\.value/,
  ];
  const outside = c.replace(code(extractFn(APP, 'bindCaretMask')), '');   // сам хелпер - единственное легальное место
  for (const re of bad) assert.ok(!re.test(outside), 'в app.js снова голая маска без каретки: ' + re);
  const uses = (c.match(/bindCaretMask\(/g) || []).length - 1;   // минус определение
  assert.ok(uses >= 5, `bindCaretMask используется ${uses} раз, ожидается >= 5 (маски, имя, seed, срок карты, срок документа)`);
  assert.match(c, /bindCaretMask\(expInput, Docs\.formatDocDate/);
  assert.match(c, /bindCaretMask\(exp, formatExpiry/);
});
test('bindCaretMask: value переприсваивается только при изменении + каретка через setSelectionRange', () => {
  const fn = code(extractFn(APP, 'bindCaretMask'));
  assert.match(fn, /reformatWithCaret\(raw, caret, formatter, \{ prev, inputType: e && e\.inputType/);
  assert.match(fn, /if \(r\.value !== raw\) \{\s*inp\.value = r\.value;/);
  assert.match(fn, /setSelectionRange\(r\.caret, r\.caret\)/);
  assert.match(fn, /prev = inp\.value;/);
});
