// v3-source-guards.test.mjs — машинные заслоны на JS-правки v3, которые нельзя проверить чистой
// функцией (они завязаны на DOM/поток app.js). Читаем исходник как текст и проверяем, что нужные
// места на месте: их удаление/откат сразу краснит тест (протокол ошибок - заслон машинный).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');

test('v3-1: appDialog экранирует message/label/placeholder (self-XSS закрыт)', () => {
  const i = APP.indexOf('function appDialog');
  assert.ok(i >= 0, 'appDialog не найден');
  const body = APP.slice(i, i + 1200);
  assert.ok(/const esc = UI\.escapeHtml/.test(body), 'appDialog должен завести esc = UI.escapeHtml');
  assert.ok(/esc\(message\)/.test(body), 'message должен экранироваться');
  assert.ok(/esc\(b\.label\)/.test(body), 'label кнопки должен экранироваться');
  assert.ok(/esc\(input\.placeholder/.test(body), 'placeholder должен экранироваться');
});

test('v3-UX: лимиты записей и сканов реально применяются в редакторе', () => {
  assert.ok(/INPUT_LIMITS\.recordsPerSection/.test(APP), 'предел записей в разделе не подключён');
  assert.ok(/INPUT_LIMITS\.scansPerDoc/.test(APP), 'предел сканов на документ не подключён');
  assert.ok(/defaultMaxLength\(inp\.tagName/.test(APP), 'дефолтный maxLength полей не навешивается');
});

test('v3-3: осиротевшие поля (docType, pages[].name) чистятся при сохранении', () => {
  assert.ok(/delete saved\.docType/.test(APP), 'docType должен удаляться из сохранённой записи');
  assert.ok(/delete p\.name/.test(APP), 'имя скана должно удаляться из сохранённой записи');
});

test('v3-UX: стрелки порядка сканов вызывают reorderPages вверх и вниз', () => {
  assert.ok(/reorderPages\(docEntry, i, i - 1\)/.test(APP), 'нет перемещения скана вверх');
  assert.ok(/reorderPages\(docEntry, i, i \+ 1\)/.test(APP), 'нет перемещения скана вниз');
});

test('v3-UX: удаление произвольного поля удаляет ТОЛЬКО одно (splice по индексу)', () => {
  assert.ok(/cfs\.splice\(i, 1\)/.test(APP), 'удаление кастомного поля должно быть splice(i,1), не очистка всех');
});

test('v3-auth: экран входа - следствие настройки; порог фолбэка 3; фолбэк-ссылка есть', () => {
  assert.ok(/bioFails >= 3/.test(APP), 'порог фолбэка на мастер-пароль должен быть 3');
  assert.ok(/#pwFallback/.test(APP), 'ссылка «Войти по мастер-паролю» не подключена');
  assert.ok(/setPasswordHint\(lsGet\(\)/.test(APP), 'подсказка-напоминание не сохраняется при создании');
  assert.ok(/setupWarnAck/.test(APP), 'обязательное подтверждение при создании пароля не проверяется');
});

test('M1: смена мастер-пароля предлагает обновить подсказку (editPasswordHint после rewrap)', () => {
  const i = APP.indexOf('async function doChangeMaster');
  assert.ok(i >= 0, 'doChangeMaster не найден');
  const body = APP.slice(i, APP.indexOf('\n}\n', i));   // 1.3.0: до конца функции (окно 3200 символов не вмещало M1-заслоны)
  assert.ok(/rewrapPassword/.test(body), 'смена пароля должна идти через rewrapPassword (ядро)');
  const rw = body.indexOf('rewrapPassword');
  assert.ok(/editPasswordHint\(p1\)/.test(body.slice(rw)), 'после смены пароля должно вызываться editPasswordHint(p1)');
});

test('M1: подсказку можно посмотреть/отредактировать из «Вход в приложение» (кнопка + вызов)', () => {
  assert.ok(/authmode-hint-btn/.test(APP), 'нет кнопки подсказки в openBioLogin');
  // 1.2.15: кнопка сначала ПОКАЗЫВАЕТ подсказку (viewPasswordHint), редактирование - второй шаг.
  assert.ok(/\.authmode-hint-btn'\)\.onclick = \(\) => viewPasswordHint/.test(APP), 'кнопка подсказки должна вызывать viewPasswordHint (двухшаговый доступ)');
  // viewPasswordHint переходит к editPasswordHint по «Изменить»/«Добавить».
  const v = APP.indexOf('async function viewPasswordHint');
  assert.ok(v >= 0, 'viewPasswordHint не найден');
  assert.ok(/editPasswordHint\(knownPw\)/.test(APP.slice(v, v + 700)), 'из просмотра должен вызываться editPasswordHint');
});

test('L3: подсказка при создании и редактировании проверяется на утечку пароля', () => {
  // onSetup: перед сохранением подсказки — проверка hintLeaksPassword(hintVal, p1).
  assert.ok(/hintLeaksPassword\(hintVal, p1\)/.test(APP), 'onSetup не проверяет подсказку на пароль');
  // editPasswordHint: тоже держит L3-заслон.
  const j = APP.indexOf('async function editPasswordHint');
  assert.ok(j >= 0, 'editPasswordHint не найден');
  assert.ok(/hintLeaksPassword\(val, knownPw\)/.test(APP.slice(j, j + 900)), 'editPasswordHint не проверяет утечку');
});

test('L2: styledConfirm экранирует title/message (self-XSS закрыт)', () => {
  const i = APP.indexOf('function styledConfirm');
  assert.ok(i >= 0, 'styledConfirm не найден');
  const body = APP.slice(i, i + 900);
  assert.ok(/const esc = UI\.escapeHtml/.test(body), 'styledConfirm должен завести esc = UI.escapeHtml');
  assert.ok(/esc\(title\)/.test(body) && /esc\(message\)/.test(body), 'title и message должны экранироваться');
});

test('v3-auth: терминология «биометрия», без «отпечаток» в видимых строках', () => {
  // Игнорируем комментарии (// ...): проверяем только код. В строковых литералах не должно
  // остаться «отпечат» - перешли на «биометрию» (v3-auth).
  const code = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const bad = (code.match(/отпечат/g) || []);
  assert.equal(bad.length, 0, 'в коде остались упоминания «отпечаток» (нужна «биометрия»)');
});
