// v4-refinements.test.mjs - машинные заслоны на доработки приёмки v4 (17.09 ночь).
// Пункты 1-11: иконки (2 разных места, противоположные направления), B2 (геометрия
// копирования), центрирование заголовка шапки, крупный заголовок карточки, мягкая
// валидация реквизитов, свёрнутая карточка документа, растяжка витрины/меню по высоте,
// свотч темы, цветовая семантика кнопок, цветные иконки меню.
//
// Геометрию реального layout JSDOM не считает - заслон на CSS-объявлениях (подтверждён живой
// проверкой в браузере: B2 dBtn=0 при 2 строках vs мутация align-items:center dBtn=5.7;
// витрина 10→5 рядов и 6→3 ряда без overflow и без пустоты; меню-плитки 130px без скролла;
// иконки: превью 66% кнопки, ячейка пикера 68%). Чистые функции покрыты полноценно + мутация.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRequisite, hasRequisiteNorm, REQUISITE_NORMS } from '../www/js/fieldnorm.js';
import { themeSwatchIcon } from '../www/js/theme.js';
import { ICON_PATHS } from '../www/js/icons.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, '..', 'www', 'css', 'app.css'), 'utf8');
const HTML = fs.readFileSync(path.join(HERE, '..', 'www', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');

function ruleBody(selector) {
  const re = new RegExp('(^|\\n)\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = CSS.match(re);
  return m ? m[2] : null;
}

// ============================ п.5: мягкая валидация реквизитов ============================
test('п.5: checkRequisite - нормы длины по полям (р/с 20, корр 20, БИК 9, ИНН 10/12, КПП 9)', () => {
  assert.deepEqual(REQUISITE_NORMS.account.lengths, [20]);
  assert.deepEqual(REQUISITE_NORMS.corr.lengths, [20]);
  assert.deepEqual(REQUISITE_NORMS.bik.lengths, [9]);
  assert.deepEqual(REQUISITE_NORMS.inn.lengths, [10, 12]);
  assert.deepEqual(REQUISITE_NORMS.kpp.lengths, [9]);
});

test('п.5: совпадение длины → ok (без подсказки)', () => {
  assert.equal(checkRequisite('account', '1'.repeat(20)).level, 'ok');
  assert.equal(checkRequisite('account', '1'.repeat(20)).message, null);
  assert.equal(checkRequisite('bik', '123456789').level, 'ok');
  assert.equal(checkRequisite('inn', '1'.repeat(10)).level, 'ok');
  assert.equal(checkRequisite('inn', '1'.repeat(12)).level, 'ok');
  assert.equal(checkRequisite('kpp', '1'.repeat(9)).level, 'ok');
});

test('п.5: длина не по норме → warn с точным текстом и счётчиком', () => {
  const a = checkRequisite('account', '1'.repeat(19));
  assert.equal(a.level, 'warn');
  assert.equal(a.message, 'Обычно в расчётном счёте 20 цифр, сейчас 19.');
  assert.equal(a.count, 19);
  assert.equal(a.expected, '20');
  assert.equal(checkRequisite('corr', '1'.repeat(18)).message, 'Обычно в корреспондентском счёте 20 цифр, сейчас 18.');
  assert.equal(checkRequisite('bik', '12345').message, 'Обычно БИК - это 9 цифр, сейчас 5.');
  assert.equal(checkRequisite('inn', '1'.repeat(11)).message, 'Обычно ИНН - это 10 цифр у организаций или 12 у ИП и физлиц, сейчас 11.');
  assert.equal(checkRequisite('kpp', '1234').message, 'Обычно КПП - это 9 цифр, сейчас 4.');
});

test('п.5: буквы/не-цифры → предупреждение «не только цифры»', () => {
  const r = checkRequisite('account', '1234abcd5678');
  assert.equal(r.level, 'warn');
  assert.equal(r.message, 'Похоже, в поле попали не только цифры - обычно здесь только цифры.');
});

test('п.5: пустое значение → ok, счётчик 0 (не пугаем до ввода)', () => {
  const r = checkRequisite('account', '');
  assert.equal(r.level, 'ok');
  assert.equal(r.message, null);
  assert.equal(r.count, 0);
});

test('п.5: ИНН - счётчик показывает диапазон 10-12', () => {
  assert.equal(checkRequisite('inn', '1'.repeat(5)).expected, '10-12');
});

test('п.5 [мутация]: сдвиг нормы ломает проверку (20 цифр перестал бы быть ok, если норма != 20)', () => {
  // Если кто-то заменит lengths:[20] на другое, «ровно 20 цифр» получит warn - тест выше упадёт.
  // Здесь фиксируем сам инвариант: 20 цифр в account именно ok, 20 в bik - warn (норма 9).
  assert.equal(checkRequisite('account', '1'.repeat(20)).level, 'ok');
  assert.equal(checkRequisite('bik', '1'.repeat(20)).level, 'warn');
});

test('п.5: hasRequisiteNorm - только банковские поля имеют норму', () => {
  assert.ok(hasRequisiteNorm('account') && hasRequisiteNorm('bik') && hasRequisiteNorm('inn'));
  assert.ok(!hasRequisiteNorm('name') && !hasRequisiteNorm('note') && !hasRequisiteNorm('iban'));
});

test('п.5: подсветка ЯНТАРНАЯ (не красная), счётчик серый, поле подсвечивается', () => {
  assert.ok(/\.req-hint\s*\{[^}]*color:\s*var\(--amber\)/.test(CSS), 'подсказка реквизита янтарная');
  assert.ok(/\.req-counter\s*\{[^}]*color:\s*var\(--muted\)/.test(CSS), 'счётчик серый (muted)');
  const warn = ruleBody('.form-row.req-warn input');
  assert.ok(warn && /var\(--amber\)/.test(warn) && !/var\(--danger\)/.test(warn), 'подсветка поля янтарная, не красная');
  assert.ok(/section === 'requisites'/.test(APP), 'в редакторе есть блок валидации requisites');
});

// ============================ п.1: иконки (два разных места) ============================
test('п.1: превью иконки в РЕДАКТОРЕ (.icon-pick-chip) - глиф увеличен (scale > 1)', () => {
  const svg = ruleBody('.icon-pick-chip svg');
  assert.ok(svg, 'нет правила .icon-pick-chip svg');
  const m = svg.match(/transform:\s*scale\(([\d.]+)\)/);
  assert.ok(m, 'глиф превью должен масштабироваться');
  assert.ok(parseFloat(m[1]) > 1.3, 'глиф превью заметно крупнее (scale > 1.3), проверено 66% высоты кнопки');
});

test('п.1: сетка пикера (.iconcell svg) - глиф УМЕНЬШЕН (scale < 1.4, было 1.4)', () => {
  const svg = ruleBody('.iconcell svg');
  assert.ok(svg, 'нет правила .iconcell svg');
  const m = svg.match(/transform:\s*scale\(([\d.]+)\)/);
  assert.ok(m, 'глиф ячейки масштабируется');
  assert.ok(parseFloat(m[1]) < 1.4, 'сетка пикера умереннее прежних 1.4 (проверено ~68% ячейки)');
});

test('п.1 [заслон]: это РАЗНЫЕ селекторы, направления ПРОТИВОПОЛОЖНЫЕ (превью > 1.3 > ячейка)', () => {
  const chip = parseFloat(ruleBody('.icon-pick-chip svg').match(/scale\(([\d.]+)\)/)[1]);
  const cell = parseFloat(ruleBody('.iconcell svg').match(/scale\(([\d.]+)\)/)[1]);
  assert.ok(chip > cell, 'глиф превью редактора крупнее глифа ячейки пикера (не перепутать места)');
});

// ============================ п.2: B2 геометрия копирования ============================
test('п.2 (B2): .entry-body прижат к верху (flex-start), НЕ center - истинная причина', () => {
  const eb = ruleBody('.entry-body');
  assert.ok(eb, 'нет правила .entry-body');
  assert.ok(/align-items:\s*flex-start/.test(eb), '.entry-body должен быть align-items: flex-start');
  assert.ok(!/align-items:\s*center/.test(eb), '.entry-body НЕ center (мутация center → кнопка уезжает вниз, dBtn=5.7)');
});

test('п.2 (B2): .field и его дети держат верхнюю строку значения', () => {
  const f = ruleBody('.field');
  assert.ok(/align-items:\s*flex-start/.test(f), '.field flex-start');
  assert.ok(/\.field\s*>\s*\*\s*\{[^}]*align-self:\s*flex-start/.test(CSS), 'дети .field: align-self flex-start');
});

// ============================ п.3: заголовок шапки по центру (1 строка) ============================
test('п.3: .sechead-title вертикально по центру (align-self:center) при одной строке', () => {
  const t = ruleBody('.sechead-title');
  assert.ok(t, 'нет правила .sechead-title');
  assert.ok(/align-self:\s*center/.test(t), 'заголовок шапки центрируется относительно иконок');
});

// ============================ п.4: крупный заголовок карточки ============================
test('п.4: .entry-title крупнее (>=18px) и жирнее (700)', () => {
  const t = ruleBody('.entry-title');
  assert.ok(t, 'нет правила .entry-title');
  const fs2 = t.match(/font-size:\s*(\d+)px/);
  assert.ok(fs2 && parseInt(fs2[1], 10) >= 18, 'заголовок карточки >= 18px (был 15px)');
  assert.ok(/font-weight:\s*700/.test(t), 'заголовок карточки жирнее (700)');
  // ellipsis для длинного заголовка сохранён (не ломает верстку)
  assert.ok(/\.entry-title-text\s*\{[^}]*text-overflow:\s*ellipsis/.test(CSS), 'длинный заголовок обрезается ellipsis');
});

// ============================ п.6: свёрнутая карточка документа ============================
test('п.6: миниатюры/номер/дата/комментарии скрыты в свёрнутой карточке документа', () => {
  assert.ok(/\.entry\.expandable:not\(\.expanded\)\s*\.doc-collapse-hide\s*\{[^}]*display:\s*none/.test(CSS),
    'нужно правило скрытия doc-collapse-hide до разворота');
  assert.ok(/doc-collapse-hide/.test(APP), 'app.js помечает поля/миниатюры класcом doc-collapse-hide');
  assert.ok(/doc-thumbs doc-collapse-hide/.test(APP), 'миниатюры документа скрыты до разворота');
});

test('п.6: счётчик свёрнутой карточки - «N сканов» (не «страниц»)', () => {
  assert.ok(/'скан', 'скана', 'сканов'/.test(APP), 'счётчик считает сканы');
});

// ============================ п.7: витрина растянута по высоте ============================
test('п.7: #shell - flex-колонка, .vitrina заполняет высоту (flex + grid-auto-rows:1fr)', () => {
  const shell = ruleBody('#shell');
  assert.ok(shell && /display:\s*flex/.test(shell) && /flex-direction:\s*column/.test(shell), '#shell flex-колонка');
  const vit = ruleBody('.vitrina');
  assert.ok(vit && /flex:\s*1/.test(vit), '.vitrina растягивается (flex:1)');
  assert.ok(/grid-auto-rows:\s*1fr/.test(vit), '.vitrina: ряды делят высоту поровну (1fr)');
});

// ============================ п.8: меню-плитки растянуты по высоте ============================
test('п.8: .menu-body - колонка, .menu-list заполняет высоту (flex + grid-auto-rows:1fr)', () => {
  const body = ruleBody('.menu-body');
  assert.ok(body && /flex-direction:\s*column/.test(body), '.menu-body flex-колонка');
  const list = ruleBody('.menu-list');
  assert.ok(list && /flex:\s*1/.test(list) && /grid-auto-rows:\s*1fr/.test(list), '.menu-list растягивается, ряды 1fr');
});

// ============================ п.9: свотч темы ============================
test('п.9: themeSwatchIcon - луна для тёмной (bank), солнце для светлой (nord)', () => {
  assert.equal(themeSwatchIcon('bank'), 'moon');
  assert.equal(themeSwatchIcon('nord'), 'sun');
  assert.equal(themeSwatchIcon('dark'), 'moon');  // миграция
  assert.equal(themeSwatchIcon('light'), 'sun');
  assert.equal(themeSwatchIcon('мусор'), 'moon'); // дефолт bank
});

test('п.9: значки moon/sun существуют в наборе икон', () => {
  assert.ok(ICON_PATHS.moon && ICON_PATHS.sun, 'нужны глифы moon и sun');
});

test('п.9: пункт «Тема» - свотч #mThemeSwatch, тап красит значок и ЗАКРЫВАЕТ меню', () => {
  assert.ok(/id="mThemeSwatch"/.test(HTML), 'в меню есть свотч темы');
  assert.ok(/themeSwatchIcon\(currentTheme\(\)\)/.test(APP), 'свотч красится по текущей теме');
  assert.ok(/on\('mTheme',\s*\(\)\s*=>\s*\{\s*toggleTheme\(\);\s*updateMenuInfo\(\);\s*closeMenu\(\)/.test(APP),
    'тап по теме переключает, синхронит и закрывает меню');
});

// ============================ п.10: цветовая семантика кнопок ============================
test('п.10/1.2.18-п.11: «Восстановить из файла» - вторичная карточка, НЕ красная', () => {
  // Редизайн окна «Резервная копия» (батч 1.2.18): вместо кнопки kind:neutral - карточка-действие
  // backup-restore. Цветовая семантика прежняя: восстановление на этом шаге не деструктивно
  // (перезапись подтверждается отдельным danger-диалогом), поэтому карточка не красная.
  assert.ok(/function openBackupDialog\(/.test(APP), 'нет окна резервной копии (openBackupDialog)');
  assert.ok(/backup-restore/.test(APP), 'нет карточки «Восстановить из файла»');
  const restore = ruleBody('.backup-restore');
  assert.ok(restore && !/var\(--danger\)/.test(restore) && !/#d9534f/.test(restore),
    'карточка восстановления не должна быть красной');
});

test('п.10: красный (danger/deny) только у реально деструктивных подтверждений', () => {
  // Все kind:'deny' попадают только через dlgConfirm(danger:true) - деструктив (удаление/замена).
  assert.ok(!/kind:\s*'deny'/.test(APP.replace(/kind:\s*danger\s*\?\s*'deny'\s*:\s*'save'/g, '')),
    'нет прямых kind:deny кроме danger-ветки dlgConfirm (удаление/замена данных)');
  // Восстановление всё же подтверждается отдельно (перезапись данных).
  assert.ok(/dlgConfirm\([^)]*danger:\s*true/.test(APP), 'деструктивная замена данных подтверждается danger-диалогом');
});

// ============================ п.11: цветные иконки меню ============================
test('п.11: каждый пункт меню имеет цветовой класс c-*; danger (красный) только у «Заблокировать»', () => {
  const buttons = [...HTML.matchAll(/<button class="(mi[^"]*)" id="(m\w+)"/g)];
  assert.ok(buttons.length >= 9, 'найдены пункты меню');
  for (const [, cls, id] of buttons) {
    if (id === 'mLock') {
      assert.ok(/mi-lock/.test(cls), 'Заблокировать - акцентная (mi-lock)');
      assert.ok(!/c-/.test(cls), 'Заблокировать не имеет цветного c-* (у неё свой красный)');
    } else {
      assert.ok(/\bc-[a-z]+\b/.test(cls), `пункт ${id} должен иметь цветовой класс c-*`);
    }
  }
  // Красный акцент иконки - только у mi-lock.
  assert.ok(/\.mi-lock \.mi-ic\s*\{[^}]*var\(--danger\)/.test(CSS), 'красная иконка только у mi-lock');
  // Ни один c-* класс не завязан на danger.
  assert.ok(!/\.mi\.c-[a-z]+\s+\.mi-ic\s*\{[^}]*var\(--danger\)/.test(CSS), 'цветные пункты не используют danger');
});

test('п.11: цветовые токены меню заданы в обеих темах', () => {
  assert.ok(/--mi-teal:/.test(CSS) && /--mi-purple:/.test(CSS) && /--mi-blue:/.test(CSS), 'есть токены акцентов меню');
  // токены определены и для светлой темы (nord)
  const nord = CSS.slice(CSS.indexOf('[data-theme="nord"]'));
  assert.ok(/--mi-teal:/.test(nord) && /--mi-purple:/.test(nord), 'акценты меню заданы и для светлой темы');
});
