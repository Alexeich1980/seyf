// ota-selfcheck.test.mjs — заслон публикации OTA (build-lib.selfCheckZip): свежий бандл
// обязан пройти ТУ ЖЕ проверку, что и клиент на устройстве (sha == манифест + fflate.unzipSync
// + safeName + index.html/опорные js). Проверяем и обратное — мутация одного байта КРАСНИТ
// самопроверку (иначе заслон бесполезен, память mutation-testing-proves-tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { selfCheckZip } from '../build-lib.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(HERE, '..', 'www');

// vendor-fflate тот же, что у клиента (zipSync ↔ unzipSync — одна библиотека)
function loadFflate() {
  const code = fs.readFileSync(path.join(WWW, 'vendor', 'fflate.min.js'), 'utf8');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, self: {}, globalThis, console });
  return mod.exports;
}
const fflate = loadFflate();
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// минимальный, но валидный по правилам клиента бандл: index.html + опорные js + настоящий fflate
function makeBundle() {
  const enc = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
  const bag = {
    'index.html': enc('<!doctype html><title>Сейф</title>'),
    'boot.js': enc('/* boot */'),
    'update.js': enc('/* update */'),
    'js/app.js': enc('/* app */'),
    'js/crypto.js': enc('/* crypto */'),
    'vendor/fflate.min.js': new Uint8Array(fs.readFileSync(path.join(WWW, 'vendor', 'fflate.min.js'))),
  };
  return Buffer.from(fflate.zipSync(bag, { level: 6 }));
}

test('selfCheckZip: валидный бандл клиент принимает', () => {
  const zip = makeBundle();
  const r = selfCheckZip(zip, sha256(zip), WWW);
  assert.equal(r.files, 6);
  assert.equal(r.sha, sha256(zip));
});

test('МУТАЦИЯ: перевёрнутый байт при sha из манифеста → краснеет (как ERR_HASH у клиента)', () => {
  const zip = makeBundle();
  const good = sha256(zip);                 // sha, который лёг бы в манифест
  const bad = Buffer.from(zip);
  const at = Math.floor(bad.length / 2);
  bad[at] = bad[at] ^ 0xff;                 // «на проводе» побился один байт
  // клиент качает битые байты, считает их sha, сверяет с манифестом → не сойдётся (fflate
  // не проверяет CRC, поэтому целостность держит именно sha256 — здесь это и доказываем)
  assert.throws(() => selfCheckZip(bad, good, WWW), /sha256/i);
});

test('МУТАЦИЯ: обрезанный архив бьёт распаковку → самопроверка краснеет (как ERR_ZIP)', () => {
  const zip = makeBundle();
  const bad = zip.subarray(0, zip.length - 40);   // снесли конец central directory
  assert.throws(() => selfCheckZip(bad, sha256(bad), WWW), /unpack|распаков|zip/i);
});

test('МУТАЦИЯ: нет index.html → самопроверка краснеет', () => {
  const enc = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
  const zip = Buffer.from(fflate.zipSync({ 'boot.js': enc('x'), 'js/app.js': enc('x') }, { level: 6 }));
  assert.throws(() => selfCheckZip(zip, sha256(zip), WWW), /index\.html|unpack|распаков/i);
});
