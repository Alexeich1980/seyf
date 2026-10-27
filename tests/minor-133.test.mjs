// minor-133.test.mjs - мелочи из прохода на эмуляторе 1.3.2 (TASKS «Мелочи…»), версия 1.3.3:
//   кнопка-иконка в форме записи с подписью для озвучки экрана; демо-фразы seed только из BIP39.
// (окно «Полная версия» с начала - purchase-133; смена шрифта без перезагрузки - font-133.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const BIP39 = new Set(read('www', 'js', 'bip39-wordlist.js').match(/[a-z]+/g));

test('форма записи: кнопка выбора иконки подписана для озвучки экрана (aria-label)', () => {
  const APP = read('www', 'js', 'app.js');
  const m = APP.match(/<button[^>]*class="picker-btn icon-pick-btn"[^>]*>/);
  assert.ok(m, 'кнопка иконки на месте');
  assert.match(m[0], /aria-label="[^"]{4,}"/);
});

test('в шаблонах app.js нет кнопок с одной иконкой и без подписи (aria-label или title)', () => {
  const APP = read('www', 'js', 'app.js');
  const bad = [];
  for (const m of APP.matchAll(/<button([^>]*)>\s*\$\{icon\([^}]*\}\s*<\/button>/g)) {
    if (!/aria-label=|title=/.test(m[1])) bad.push(m[0].slice(0, 80));
  }
  assert.deepEqual(bad, []);
});

test('демо-фразы seed (скриншоты стора и демо) - только слова BIP39 (без «candle»)', () => {
  const phrases = [];
  // публичный репозиторий: скрипта скриншотов витрины (Дизайн/) нет - тогда проверяется только демо-режим
  const DESIGN = fs.existsSync(path.join(ROOT, 'Дизайн', 'capture-screens.mjs'));
  for (const src of [DESIGN ? read('Дизайн', 'capture-screens.mjs') : '', read('www', 'js', 'demo.js')]) {
    for (const m of src.matchAll(/phrase:\s*'([a-z ]+)'/g)) phrases.push(m[1]);
  }
  assert.ok(phrases.length >= (DESIGN ? 3 : 1), 'фразы найдены');
  for (const p of phrases) {
    const bad = p.split(' ').filter((w) => !BIP39.has(w));
    assert.deepEqual(bad, [], p);
  }
});
