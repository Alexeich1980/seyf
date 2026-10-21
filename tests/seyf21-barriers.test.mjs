// seyf21-barriers.test.mjs — МАШИННЫЕ ЗАСЛОНЫ батча-21 (протокол ошибок: заслон, а не «буду
// внимательнее»). Каждый тест держит один корень, чтобы починенный баг не отрос обратно.
// Тесты читают исходники и проверяют присутствие ключевого механизма фикса.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');
const CSS = read('../www/css/app.css');
const APP = read('../www/js/app.js');
const UPDATE = read('../www/update.js');

test('bug6-заслон: ГЛОБАЛЬНОЕ [hidden]{display:none!important} есть (не точечное .ic-btn[hidden]) — иначе .vitrina{display:grid} перебивает hidden и витрина не скрывается при поиске', () => {
  const norm = CSS.replace(/\s+/g, ' ');
  // [hidden] как самостоятельный селектор: слева пробел/`}`/`;`, а не приклеенный класс/тег
  assert.ok(/[\s};]\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(norm),
    'нет ГЛОБАЛЬНОГО заслона [hidden]{display:none!important} (точечные .x[hidden] не считаются)');
});

// bug5 (перенос срывался скроллом) закрыт в 1.2.20 радикально: ручное перетаскивание порядка
// убрано целиком, заслон переехал в patch-1220.test.mjs (drag не подключён, режим порядка - pan-y).

test('bug3-заслон: window.Backup.backup экспортирован (кнопка «Сохранить бэкап» в диалоге обновления его зовёт)', () => {
  assert.ok(/window\.Backup\s*=\s*\{[^}]*backup/.test(APP.replace(/\s+/g, ' ')), 'app.js не задаёт window.Backup.backup');
  assert.ok(/window\.Backup\s*&&\s*window\.Backup\.backup/.test(UPDATE), 'update.js больше не зовёт window.Backup.backup — тест устарел');
});

test('bug4-заслон: смена мастер-пароля сначала ПРОВЕРЯЕТ действующий (unlockWithPassword ДО rewrapPassword)', () => {
  const i = APP.indexOf('function doChangeMaster');
  assert.ok(i >= 0, 'нет функции doChangeMaster');
  const body = APP.slice(i, i + 2600);
  const posVerify = body.indexOf('unlockWithPassword');
  const posRewrap = body.indexOf('rewrapPassword');
  assert.ok(posVerify >= 0, 'нет проверки действующего пароля (unlockWithPassword)');
  assert.ok(posRewrap >= 0, 'нет перевязки (rewrapPassword)');
  assert.ok(posVerify < posRewrap, 'проверка действующего пароля должна идти ДО перевязки');
});
