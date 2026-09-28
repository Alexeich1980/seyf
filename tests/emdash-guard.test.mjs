// emdash-guard.test.mjs - заслон-ратчет правила проекта «дефис, не длинное тире».
// Правило: символ «—» (U+2014) не должен появляться в ПОЛЬЗОВАТЕЛЬСКИХ строках www
// (то, что видит человек в приложении). В комментариях кода тире допустимо - оно не
// показывается пользователю, поэтому сканер их пропускает (иначе тест ловил бы 300+
// технических комментариев и был бы бесполезен).
//
// Как отличаем: посимвольный сканер с учётом контекста.
//   JS  - пропускает // ... , /* ... */ ; ловит «—» в '..' , ".." , `..` и в голом коде;
//   HTML- пропускает <!-- ... --> ; ловит «—» в остальном тексте/атрибутах;
//   CSS - пропускает /* ... */ ; ловит «—» в остальном.
// «—» в голом JS-коде синтаксически невозможно вне строки, поэтому всё, что сканер ловит
// в JS, - это строковый литерал (=пользовательская строка) или шаблон.
//
// Мутация (подтверждена вручную): вернуть одно «—» в любую user-строку www -> тест краснеет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.resolve(HERE, '..', 'www');
const EMDASH = '—';
const BS = String.fromCharCode(92);   // backslash
const SKIP_DIRS = new Set(['vendor', 'node_modules']);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (['.js', '.html', '.css'].includes(path.extname(e.name))) acc.push(p);
  }
  return acc;
}

// JS/шаблоны: возвращает номера строк с «—» вне комментариев.
function scanJs(src) {
  const hits = [];
  let i = 0, line = 1, state = 'code';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') line++;
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") { state = 'sq'; i++; continue; }
      if (c === '"') { state = 'dq'; i++; continue; }
      if (c === '`') { state = 'tpl'; i++; continue; }
      if (c === EMDASH) hits.push(line);
    } else if (state === 'line') {
      if (c === '\n') state = 'code';
    } else if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; i += 2; continue; }
    } else if (state === 'sq') {
      if (c === BS) { i += 2; continue; }
      if (c === "'") { state = 'code'; i++; continue; }
      if (c === EMDASH) hits.push(line);
    } else if (state === 'dq') {
      if (c === BS) { i += 2; continue; }
      if (c === '"') { state = 'code'; i++; continue; }
      if (c === EMDASH) hits.push(line);
    } else if (state === 'tpl') {
      if (c === BS) { i += 2; continue; }
      if (c === '`') { state = 'code'; i++; continue; }
      if (c === EMDASH) hits.push(line);
    }
    i++;
  }
  return hits;
}

// HTML: пропускаем <!-- ... -->, ловим «—» в остальном.
function scanHtml(src) {
  const hits = [];
  let i = 0, line = 1, inComment = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') line++;
    if (!inComment && src.startsWith('<!--', i)) { inComment = true; i += 4; continue; }
    if (inComment && src.startsWith('-->', i)) { inComment = false; i += 3; continue; }
    if (!inComment && c === EMDASH) hits.push(line);
    i++;
  }
  return hits;
}

// CSS: пропускаем /* ... */.
function scanCss(src) {
  const hits = [];
  let i = 0, line = 1, inC = false;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') line++;
    if (!inC && c === '/' && n === '*') { inC = true; i += 2; continue; }
    if (inC && c === '*' && n === '/') { inC = false; i += 2; continue; }
    if (!inC && c === EMDASH) hits.push(line);
    i++;
  }
  return hits;
}

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file);
  if (ext === '.js') return scanJs(src);
  if (ext === '.html') return scanHtml(src);
  return scanCss(src);
}

test('в пользовательских строках www нет длинного тире «—» (дефис, не «—»)', () => {
  const offenders = [];
  for (const f of walk(WWW)) {
    for (const line of scan(f)) offenders.push(path.relative(WWW, f) + ':' + line);
  }
  assert.equal(
    offenders.length, 0,
    'длинное тире «—» в user-строках - заменить на дефис «-»:\n  ' + offenders.join('\n  ')
  );
});
