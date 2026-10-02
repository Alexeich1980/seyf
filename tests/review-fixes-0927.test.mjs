// review-fixes-0927.test.mjs — заслоны исправлений по code-review 27.09.2026 (мобайл «Сейфа»):
// PDF после закрытия просмотра уничтожается, выбор файлов не теряет медленные файлы,
// смена мастер-пароля по правилу создания (CVV 4 цифры - в fieldinput.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPdfDoc, countPdfPages, renderPdfFrame, PICK_SAFETY_MS } from '../www/js/doc-viewer.js';
import { validateMasterChange } from '../www/js/onboarding.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');
const DV = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'doc-viewer.js'), 'utf8');

function mockPdfLib(onLoad) {
  const docs = [];
  return {
    docs,
    getDocument: () => ({ promise: (async () => { await onLoad(); const d = { numPages: 2, destroyed: false, destroy() { this.destroyed = true; }, getPage: async () => ({ getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve() }) }) }; docs.push(d); return d; })() }),
  };
}
const PDF_PAGE = { id: 'p1', mime: 'application/pdf', data: 'AAAA' };

test('PDF, догрузившийся после закрытия просмотра, уничтожается', async () => {
  let closed = false;
  const lib = mockPdfLib(() => { closed = true; });
  assert.equal(await loadPdfDoc(lib, new Uint8Array(1), () => closed), null);
  assert.equal(lib.docs[0].destroyed, true);
});
test('подсчёт страниц после закрытия не кладёт документ в карту', async () => {
  let closed = false;
  const lib = mockPdfLib(() => { closed = true; });
  const map = new Map();
  assert.equal(await countPdfPages(lib, [PDF_PAGE], map, {}, () => closed), false);
  assert.equal(map.size, 0);
  assert.equal(lib.docs[0].destroyed, true);
});
test('renderPdfFrame после закрытия уничтожает документ', async () => {
  let closed = false;
  const lib = mockPdfLib(() => { closed = true; });
  const map = new Map();
  const canvas = { replaceWith() {}, style: {}, getContext: () => ({}) };
  await renderPdfFrame(canvas, PDF_PAGE, 0, { clientWidth: 300, clientHeight: 300 }, map, { setContentSize() {} }, () => closed, lib);
  assert.equal(map.size, 0);
  assert.equal(lib.docs[0].destroyed, true);
});
test('выбор файлов: страховка не меньше 5 с, поздний change уходит в onLate', () => {
  assert.ok(PICK_SAFETY_MS >= 5000);
  const choose = DV.slice(DV.indexOf('export function chooseFiles('), DV.indexOf('function problem('));
  assert.match(choose, /addEventListener\('cancel'/);
  assert.match(choose, /onLate\(files\)/);
  assert.doesNotMatch(choose, /camera \? 800 : 400/);
});
test('смена мастер-пароля: правило создания, слабый только с согласием', () => {
  assert.equal(validateMasterChange('abc', 'abc', false).weak, true);
  assert.equal(validateMasterChange('abc', 'abc', true).ok, true);
  assert.equal(validateMasterChange('abc', 'abd', true).ok, false);
  assert.doesNotMatch(APP, /p1\.length < 8/);
  assert.match(APP, /validateMasterChange\(p1, p2, false\)/);
});
