// novice-133.test.mjs - проход «новичок» (lenivyy-polzovatel) по «Архиву для близких», меню и «О приложении»
// 1.3.3 (27.10.2026). Персоны: человек с нулём в теме с телефона и пожилой человек, впервые думающий о наследстве.
// Что держит (главные места, где новичок бросал):
// (1) первый экран архива: под каждой кнопкой видно, что получится (лист для печати / файл под паролем), а при
//     пустом архиве над разделами строка «Начните отсюда» - иначе человек жмёт кнопку и упирается в «пусто»;
// (2) окно пароля файла: КАК доверенный откроет файл (любой браузер, Сейф не нужен) видно сразу, а не в раскрывашке;
// (3) подпись над галочками не читается как «пароли попадут в лист»;
// (4) после сохранения файла названо его имя - понятно, что искать и что передавать.
// Мутации (27.10.2026, все красные): убрать backup-card-d у карточки «sheet»; показывать START_HINT всегда;
// вернуть FILE_PW.opens внутрь details; вернуть старую PICK_CAPTION; dlgAlert(A.FILE_PW.done) вместо fileSavedText.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../www/js/archive.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UIJS = fs.readFileSync(path.join(ROOT, 'www', 'js', 'archive-ui.js'), 'utf8');
const part = (from, to) => UIJS.slice(UIJS.indexOf(from), UIJS.indexOf(to));

test('новичок: под кнопками выдачи видно, что получится; пустой архив ведёт к разделам', () => {
  const home = part('function renderHome', 'function renderSection');
  assert.match(home, /data-issue="sheet"[\s\S]*?A\.ISSUE_SHEET\.title[\s\S]*?<span class="backup-card-d">\$\{esc\(A\.ISSUE_SHEET_SUB\)\}<\/span>[\s\S]*?data-issue="full"/);
  assert.match(home, /data-issue="full"[\s\S]*?A\.ISSUE_FULL\.title[\s\S]*?<span class="backup-card-d">\$\{esc\(A\.ISSUE_FULL_SUB\)\}<\/span>/);
  assert.match(A.ISSUE_SHEET_SUB, /без паролей/);
  assert.match(A.ISSUE_FULL_SUB, /под паролем/);
  assert.match(home, /\$\{A\.isFilled\(a, v\) \? '' : `<p class="arc-cap arc-start">\$\{esc\(A\.START_HINT\)\}<\/p>`\}/, '«Начните отсюда» - только пока архив пуст');
  assert.ok(home.indexOf('A.SECTIONS_HEAD') < home.indexOf('A.START_HINT') && home.indexOf('A.START_HINT') < home.indexOf('arc-list'));
  assert.equal((UIJS.match(/D\.dlgAlert\(A\.EMPTY_ALERT, A\.ARCHIVE_TITLE\)/g) || []).length, 2, 'обе кнопки при пустом архиве говорят, где разделы');
  assert.match(A.EMPTY_ALERT, /ниже, под кнопками/);
});

test('новичок: окно пароля файла сразу говорит, как доверенный откроет файл', () => {
  const full = part('function issueFull', 'document.addEventListener(\'keydown\', onKey, true);\n  D.closeOnBackdrop(back');
  const iOpens = full.indexOf('<p class="confirm-msg arc-opens">${esc(A.FILE_PW.opens)}</p>');
  const iDet = full.indexOf('<details');
  assert.ok(iOpens > 0 && iOpens < iDet, 'строка «как откроют» видна до раскрывашки, не внутри неё');
  assert.equal((full.match(/A\.FILE_PW\.opens/g) || []).length, 1);
  assert.match(A.FILE_PW.opens, /любом браузере/);
  assert.match(A.FILE_PW.opens, /ставить Сейф ему не нужно/);
  assert.match(full, /if \(saved\) D\.dlgAlert\(A\.fileSavedText\(name\), A\.ARCHIVE_TITLE\);/);
  assert.match(A.fileSavedText('Архив.html'), /^Файл «Архив\.html» сохранён\. Пароль к нему передайте отдельно\.$/);
});

test('новичок: подпись над галочками не обещает пароли в листе', () => {
  assert.ok(!/названия, пароли/.test(A.PICK_CAPTION), 'старая подпись читалась как «в лист попадут пароли»');
  // ревью 1.3.3 М3 (Алексей «ок» 27.10): подписи точнее - что именно в лист, что только в файл
  assert.match(A.PICK_CAPTION, /В лист для печати попадут названия и банки, без номеров и паролей\. Пароли и номера - только в файл под паролем\./);
  assert.ok(!/в лист попадёт название, логин и пароль/.test(A.sectionById('accounts').sourceCaption));
  assert.match(A.ACCOUNTS_CAPTION, /Логин и пароль - только в файл под паролем/);
});

test('новичок и редактура: новые строки на «вы» строчной, без «—» и двойных пробелов', () => {
  const all = [A.ISSUE_SHEET_SUB, A.ISSUE_FULL_SUB, A.SECTIONS_HEAD, A.START_HINT, A.EMPTY_ALERT, A.FILE_PW.opens, A.PICK_CAPTION, A.fileSavedText('x')].join(' ');
  assert.ok(!all.includes('—') && !/ {2}/.test(all));
  assert.ok(!/(?<![а-яё])(Вы|Вам|Ваш\S*|ты|тебе)(?![а-яё])/u.test(all));
});
