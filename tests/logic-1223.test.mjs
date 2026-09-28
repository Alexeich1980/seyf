// logic-1223.test.mjs - заслоны блока C адверсариального ревью 22.09 (логика и поведение, 1.2.23).
// Сценарии перенесены из пруф-скриптов ревьюера review-logic/pure.mjs и live*.mjs: там старое
// поведение (день/месяц местами, «через 1 дн.» в день окончания, «1/29» -> «12/9», Backspace по
// выделенному разделителю съедал цифру) было «наблюдаемым», здесь требуется новое.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Docs from '../www/js/documents.js';
import { formatExpiryLive, parseExpiry, checkCardExpiry } from '../www/js/cardexp.js';
import { reformatWithCaret, formatCardNumber, fieldInputProps, liveMaskFor } from '../www/js/fieldinput.js';
import { normalizeFieldValue } from '../www/js/fieldnorm.js';
import { openableHref } from '../www/js/contactlinks.js';
import { buildRequisitesShareText } from '../www/js/share.js';
import { cropSourceDims, CROP_SRC_FACTOR } from '../www/js/crop.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const APP = read('www', 'js', 'app.js');
const DV = read('www', 'js', 'doc-viewer.js');
const CSS = read('www', 'css', 'app.css');
const NOW = new Date(2026, 8, 22, 10, 0).getTime();   // 22.09.2026 10:00 местного, как у ревьюера

// ---------------- C1 ----------------
test('C1: флаг «системное окно» держится только на выборе файла/камере; окно обрезки - вне withSystemWindow', () => {
  const cam = APP.slice(APP.indexOf("box.querySelector('.doc-cam').onclick"), APP.indexOf("box.querySelector('.doc-file').onclick"));
  assert.match(cam, /await withSystemWindow\(\(\) => chooseFiles\(\{ camera: true \}\)\)/);
  assert.match(cam, /await cameraFileToPage\(files\[0\]\)/);
  assert.ok(!/withSystemWindow\(\(\) => captureFromCamera/.test(cam), 'кроп больше не внутри системного окна');
  const file = APP.slice(APP.indexOf("box.querySelector('.doc-file').onclick"), APP.indexOf("box.querySelector('.doc-file').onclick") + 900);
  assert.match(file, /await withSystemWindow\(\(\) => chooseFiles\(\{ camera: false \}\)\)/);
  assert.match(file, /await filesToPages\(picked\)/);
  const choose = DV.slice(DV.indexOf('export function chooseFiles('), DV.indexOf('function problem('));
  assert.ok(!/openCropEditor|readAsDataURL/.test(choose), 'chooseFiles - только системное окно, без обработки');
});

// ---------------- C2 ----------------
test('C2: Escape/«Назад» во вложенном окне закрывает только его (редактор проверяет, что он верхний)', () => {
  const esc = APP.slice(APP.indexOf('const onEsc = (e) => {'), APP.indexOf('const onEsc = (e) => {') + 400);
  assert.match(esc, /if \(!isTopModal\(back\)\) return;/);
  assert.match(APP, /function isTopModal\(back\) \{\s*const all = document\.querySelectorAll\('\.modal-back'\);\s*return all\.length > 0 && all\[all\.length - 1\] === back;/);
  assert.match(DV, /if \(e\.key === 'Escape' && isTopBack\(back\)\)/, 'просмотр/кроп закрываются, только если сверху');
});

// ---------------- C3 ----------------
test('C3: дата выдачи в карточке без перестановки дня и месяца; ISO -> ДД.ММ.ГГГГ', () => {
  assert.equal(Docs.formatIssueDateDisplay('03.04.2020'), '03.04.2020', 'было: «выдан 04.03.2020»');
  assert.equal(Docs.formatIssueDateDisplay('2020-04-03'), '03.04.2020');
  assert.equal(Docs.formatIssueDateDisplay('03.04.20'), '03.04.2020', 'короткий год -> 20ГГ');
  assert.equal(Docs.formatIssueDateDisplay(''), '');
  const dc = APP.slice(APP.indexOf('function decorateDocCard('), APP.indexOf('function decorateDocThumbs('));
  assert.match(dc, /ch\.textContent = 'выдан ' \+ Docs\.formatIssueDateDisplay\(entry\.issueDate\)/);
});

test('C3: в редакторе дата выдачи с маской ДД.ММ.ГГГГ и разбором как у срока (хранится ДД.ММ.ГГГГ)', () => {
  assert.match(APP, /bindCaretMask\(issueInput, Docs\.formatDocDateLive/);
  // 1.2.24 (п.7): короткий год даты выдачи - в прошлом (parseIssueDate), дата в будущем - отказ.
  // 1.2.25 (п.8): решение вынесено в Docs.checkIssueDate (разбор parseIssueDate внутри, хранится p.text).
  assert.match(APP, /const ci = Docs\.checkIssueDate\(patch\.issueDate, [^\n]*\n[\s\S]{0,400}patch\.issueDate = ci\.value;/);
  assert.equal(Docs.checkIssueDate('1.3.2020', '').value, '01.03.2020');
  assert.deepEqual(fieldInputProps('documents', 'issueDate'), { inputMode: 'numeric', maxLength: 10, autocomplete: 'off' });
});

// ---------------- C4 ----------------
test('C4: срок карты - «1/» -> «01/», «1/29» -> «01/29», вставка «12/2029» -> «12/29»', () => {
  assert.equal(formatExpiryLive('1/'), '01/');
  assert.equal(formatExpiryLive('1/29'), '01/29', 'было «12/9»');
  assert.equal(formatExpiryLive('12/2029'), '12/29', 'было «12/20» (истёкшая)');
  assert.equal(formatExpiryLive('122029'), '12/29');
  assert.equal(formatExpiryLive('1229'), '12/29');
  assert.equal(formatExpiryLive('123'), '12/3');
  assert.equal(fieldInputProps('cards', 'expiry').maxLength, 7, 'вставка ММ/ГГГГ не обрезается браузером');
});

// Живой набор по символу (как клавиатура): каретка в конце, маска после каждого символа.
function typeInto(formatter, text) {
  let v = '', caret = 0;
  for (const ch of text) {
    const raw = v.slice(0, caret) + ch + v.slice(caret);
    const r = reformatWithCaret(raw, caret + 1, formatter, { prev: v, inputType: 'insertText' });
    v = r.value; caret = r.caret;
  }
  return v;
}
test('C4: живой набор «1/29» по символу даёт «01/29» (каретка не уезжает внутрь после «0»)', () => {
  assert.equal(typeInto(formatExpiryLive, '1/29'), '01/29', 'было «02/91» в живом тесте');
  assert.equal(typeInto(formatExpiryLive, '1229'), '12/29');
  assert.equal(typeInto(formatExpiryLive, '12/29'), '12/29');
  assert.equal(typeInto(formatCardNumber, '2200123412341234'), '2200 1234 1234 1234');
});

test('C4: невалидный срок карты на сохранении - dlgAlert, окно не закрывается', () => {
  assert.equal(parseExpiry('13/29').valid, false);
  // 1.2.25 (п.1): решение по сырому вводу - checkCardExpiry (parseExpiry внутри).
  assert.equal(checkCardExpiry('13/29', '').ok, false);
  const i = APP.indexOf("const ce = checkCardExpiry(patch.expiry, ");
  assert.ok(i > 0);
  const body = APP.slice(i, i + 700);
  assert.match(body, /if \(!ce\.ok\) \{\s*await dlgAlert\([\s\S]*?\);\s*return;/);
});

// ---------------- C5 ----------------
test('C5: бейдж срока по календарным дням; 0 -> «истекает сегодня»', () => {
  assert.equal(Docs.expiryDaysLeft('22.09.2026', NOW), 0);
  assert.equal(Docs.expiryBadgeText('22.09.2026', NOW), 'истекает сегодня', 'было «через 1 дн.»');
  assert.equal(Docs.expiryBadgeText('22.09.2026', new Date(2026, 8, 22, 23, 59, 59, 999).getTime()), 'истекает сегодня');
  assert.equal(Docs.expiryBadgeText('23.09.2026', NOW), 'истекает через 1 дн.');
  assert.equal(Docs.expiryDaysLeft('22.10.2026', NOW), 30);
  assert.equal(Docs.expiryStatus('22.10.2026', NOW), 'soon', 'ровно 30 календарных дней - янтарный (было ok)');
  assert.equal(Docs.expiryStatus('23.10.2026', NOW), 'ok');
  assert.equal(Docs.expiryBadgeText('21.09.2026', NOW), 'истёк');
  assert.equal(Docs.expiryBadgeText('31.12.2030', NOW), '');
  assert.match(APP, /badge\.textContent = Docs\.expiryBadgeText\(raw\);/);
});

// ---------------- C6 ----------------
// Заслон-ратчет «интерфейс на вы»: формы на «ты» в ПОЛЬЗОВАТЕЛЬСКИХ строках www (строковые литералы
// JS и текст HTML; комментарии не считаются). Граница слова для кириллицы - через lookbehind/
// lookahead (\b в JS только ASCII). demo.js - демо-данные, не интерфейс.
const TY_WORDS = ['ты', 'твой', 'твоя', 'твоё', 'твои', 'тебе', 'тебя', 'задай', 'нажми', 'введи', 'повтори', 'проверь', 'обнови', 'вставил', 'спрячь', 'пользуешься', 'выбери', 'сохрани', 'попробуй', 'открой', 'добавь', 'сделай', 'отметь', 'укажи', 'скопируй', 'удали', 'приложи', 'подожди', 'включи', 'вернись', 'напиши', 'отсканируй', 'наведи', 'коснись', 'смени', 'закрой', 'разреши', 'можешь', 'хочешь', 'сможешь', 'закрывай', 'менял'];
const TY_RE = new RegExp('(?<![а-яёА-ЯЁ])(' + TY_WORDS.join('|') + ')(?![а-яёА-ЯЁ])', 'i');
function userStrings(src) {
  const BS = String.fromCharCode(92);
  const out = []; let i = 0, line = 1, st = 'code', buf = '', bl = 1;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') line++;
    if (st === 'code') {
      if (c === '/' && n === '/') { st = 'lc'; i += 2; continue; }
      if (c === '/' && n === '*') { st = 'bc'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { st = c; buf = ''; bl = line; i++; continue; }
    } else if (st === 'lc') { if (c === '\n') st = 'code'; }
    else if (st === 'bc') { if (c === '*' && n === '/') { st = 'code'; i += 2; continue; } }
    else { if (c === BS) { buf += src[i + 1] || ''; i += 2; continue; } if (c === st) { out.push([bl, buf]); st = 'code'; i++; continue; } buf += c; }
    i++;
  }
  return out;
}
test('C6: в пользовательских строках интерфейса нет обращения на «ты»', () => {
  const hits = [];
  const files = fs.readdirSync(path.join(ROOT, 'www', 'js')).filter((f) => f.endsWith('.js') && f !== 'demo.js').map((f) => path.join('www', 'js', f));
  files.push(path.join('www', 'update.js'), path.join('www', 'boot.js'));
  for (const f of files) for (const [ln, s] of userStrings(read(f))) { const m = s.match(TY_RE); if (m) hits.push(f + ':' + ln + ' «' + m[1] + '»'); }
  const html = read('www', 'index.html').replace(/<!--[\s\S]*?-->/g, '');
  html.split('\n').forEach((l, k) => { const m = l.match(TY_RE); if (m) hits.push('index.html:' + (k + 1) + ' «' + m[1] + '»'); });
  assert.deepEqual(hits, [], 'найдено обращение на «ты»');
});

// ---------------- C7 ----------------
test('C7: ручки кропа - зона касания 44px, у сцены отступ под ручки, холст вписывается с учётом отступа', () => {
  assert.match(CSS, /\.crop-stage \{[^}]*padding: 22px;/);
  assert.match(CSS, /\.crop-h \{[^}]*width: 44px; height: 44px;/);
  assert.match(CSS, /\.crop-h\.nw \{ left: -22px; top: -22px;/);
  assert.match(DV, /const avail = Math\.max\(120, \(stage\.clientWidth \|\| 320\) - padX\);/);
});

// ---------------- C8 ----------------
test('C8: большие фото уменьшаются перед кропом до 2*MAX_IMAGE_DIM; HEIC узнаётся и даёт понятное сообщение', () => {
  assert.equal(CROP_SRC_FACTOR, 2);
  assert.deepEqual(cropSourceDims(12000, 9000, 2000), { w: 4000, h: 3000 });
  assert.deepEqual(cropSourceDims(1200, 900, 2000), { w: 1200, h: 900 }, 'без апскейла');
  const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
  assert.equal(Docs.detectMime(heic), 'image/heic');
  assert.equal(Docs.imageProblem({ mime: 'image/heic' }), 'heic');
  assert.equal(Docs.imageProblem({ mime: 'application/octet-stream', name: 'IMG_1.HEIC' }), 'heic');
  assert.equal(Docs.imageProblem({ mime: 'image/jpeg' }), null);
  assert.equal(Docs.imageProblem({ mime: 'text/plain' }), 'unsupported');
  assert.ok(/HEIC/.test(Docs.IMAGE_PROBLEM_TEXT.heic) && !/—/.test(Object.values(Docs.IMAGE_PROBLEM_TEXT).join('')));
  assert.match(DV, /const nat = cropSourceDims\(/);
  assert.ok(!/img\.onerror = \(\) => resolve\(dataUrl\)/.test(DV), 'сбой открытия фото больше не глотается молча');
  assert.match(APP, /Docs\.IMAGE_PROBLEM_TEXT\[e && e\.code\] \|\| Docs\.IMAGE_PROBLEM_TEXT\.broken/);
});

// ---------------- C9 ----------------
test('C9: контакты - клавиатуры tel/email/url, пробелы из e-mail и ссылки убираются, «@ник» -> t.me', () => {
  assert.equal(fieldInputProps('contacts', 'phone').type, 'tel');
  assert.equal(fieldInputProps('contacts', 'email').inputMode, 'email');
  assert.equal(fieldInputProps('contacts', 'link').inputMode, 'url');
  assert.equal(liveMaskFor('contacts', 'email')('ivan@mail. ru'), 'ivan@mail.ru');
  assert.equal(normalizeFieldValue('contacts', 'email', ' ivan@mail. ru '), 'ivan@mail.ru');
  assert.equal(normalizeFieldValue('contacts', 'link', 'vk.com/id1 '), 'vk.com/id1');
  assert.equal(normalizeFieldValue('contacts', 'name', ' Иван '), ' Иван ', 'имя не трогаем');
  assert.equal(openableHref('@ivan_petrov'), 'https://t.me/ivan_petrov');
});

// ---------------- C10 ----------------
test('C10: «Копировать все реквизиты» включает заполненные произвольные поля («подпись: значение»)', () => {
  const t = buildRequisitesShareText({ name: 'Бизнес', bank: 'Банк', customFields: [{ name: 'Назначение', value: 'Оплата по счёту' }, { name: '', value: 'X-1' }, { name: 'Пусто', value: '' }] });
  assert.match(t, /Назначение: Оплата по счёту/);
  assert.match(t, /Поле: X-1/);
  assert.ok(!/Пусто/.test(t));
});

// ---------------- C11 ----------------
test('C11: Backspace/Вырезать по ВЫДЕЛЕННОМУ разделителю не съедает соседнюю цифру; срок документа maxlength 10', () => {
  assert.deepEqual(reformatWithCaret('12345678', 4, formatCardNumber, { prev: '1234 5678', inputType: 'deleteContentBackward', hadSelection: true }), { value: '1234 5678', caret: 4 });
  assert.deepEqual(reformatWithCaret('12345678', 4, formatCardNumber, { prev: '1234 5678', inputType: 'deleteByCut' }), { value: '1234 5678', caret: 4 });
  // без выделения прежнее поведение: Backspace по разделителю удаляет цифру слева
  assert.deepEqual(reformatWithCaret('12345678', 4, formatCardNumber, { prev: '1234 5678', inputType: 'deleteContentBackward' }), { value: '1235 678', caret: 3 });
  assert.equal(fieldInputProps('documents', 'expiry').maxLength, 10);
  assert.match(APP, /inp\.addEventListener\('beforeinput', \(\) => \{\s*try \{ hadSelection = /);
  assert.match(APP, /isSig: opts\.isSig, hadSelection \}/);
});
