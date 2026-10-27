// zam133.test.mjs - замечания Алексея по тесту полной сборки 1.3.3 (27.10.2026).
//   З1 - «Что там» (Деньги) и «Что застраховано» (Страховки): несколько вариантов сразу, своё окно с галочками;
//        старое одиночное значение -> список из одного; лист и файл - через запятую; остальные выборы - один вариант;
//   З3 - варианта «несчастный случай» нет; сохранённый -> «жизнь» + «здоровье»; подсказка раздела прежняя;
//   З2 - после сохранения записи - список того же раздела архива (и через крестик -> «Сохранить изменения?» ->
//        «Сохранить», который раньше закрывал весь архив и выбрасывал на главный экран), «Назад» оттуда - первый
//        экран архива.
// Часть 1 - чистая логика и исходники; часть 2 - настоящий DOM в headless Edge 360x640.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as A from '../www/js/archive.js';
import * as UI from '../www/js/ui.js';
import * as C from '../www/js/crypto.js';
import { ensureSections } from '../www/js/sectionsx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const UIJS = read('www', 'js', 'archive-ui.js');
const fd = (sec, key, kind) => A.fieldsFor(A.sectionById(sec), kind).find((x) => x.key === key);

// ---------------- З1 / З3: схема ----------------
test('З1: несколько вариантов - только «Что там» и «Что застраховано»; остальные выборы - один вариант', () => {
  const multi = [];
  for (const s of A.ARCHIVE_SECTIONS) {
    for (const k of (s.kinds ? s.kinds.map((x) => x.id) : [null])) {
      for (const f of A.fieldsFor(s, k)) if (f.type === 'multi') multi.push(s.id + '.' + f.key);
    }
  }
  assert.deepEqual(multi, ['money.what', 'insurance.what']);
  assert.equal(fd('property', 'what').type, 'choice');
  assert.equal(fd('payments', 'action').type, 'choice');
  assert.equal(fd('accounts', 'action').type, 'choice');
  assert.equal(fd('debts', 'insured', 'mine').type, 'choice');
  assert.equal(fd('wishes', 'will').type, 'choice');
  assert.deepEqual(fd('money', 'what').options, ['вклад', 'счёт', 'брокерский счёт', 'ИИС', 'зарубежный счёт', 'криптовалюта', 'банковская ячейка', 'наличные', 'другое']);
});

test('З3: «несчастный случай» убран из «Что застраховано»; подсказка раздела не тронута', () => {
  assert.deepEqual(fd('insurance', 'what').options, ['жизнь', 'здоровье', 'квартира', 'машина', 'другое']);
  assert.equal(A.sectionById('insurance').hint, 'Если есть полис страхования жизни или от несчастного случая, родным может полагаться выплата. Получить её они смогут, только если узнают о полисе.');
});

// ---------------- миграция ----------------
test('З1/З3 миграция: одиночное значение -> список из одного; «несчастный случай» -> жизнь + здоровье; прочее не теряется', () => {
  const old = {
    v: 1,
    items: {
      money: [{ id: 'm1', f: { company: 'Брокер-пример', what: 'брокерский счёт', note: 'ключ' }, extra: 5 }, { id: 'm2', f: { company: 'Сбер' } }],
      insurance: [
        { id: 'i1', f: { company: 'Согаз', what: 'несчастный случай', policy: 'P-1' } },
        { id: 'i2', f: { company: 'Ингосстрах', what: 'машина' } },
        { id: 'i3', f: { what: ['здоровье', 'несчастный случай', 'машина', 'здоровье'] } },
      ],
      property: [{ id: 'p1', f: { what: 'квартира', address: 'Садовая' } }],
    },
    wishes: { will: 'есть' },
  };
  const a = A.normalizeArchive(JSON.parse(JSON.stringify(old)));
  assert.deepEqual(a.items.money[0].f, { company: 'Брокер-пример', what: ['брокерский счёт'], note: 'ключ' });
  assert.equal(a.items.money[0].extra, 5, 'неизвестное поле записи сохранено');
  assert.deepEqual(a.items.money[1].f, { company: 'Сбер' }, 'без выбора - поле не появляется');
  assert.deepEqual(a.items.insurance[0].f, { company: 'Согаз', what: ['жизнь', 'здоровье'], policy: 'P-1' });
  assert.deepEqual(a.items.insurance[1].f.what, ['машина']);
  assert.deepEqual(a.items.insurance[2].f.what, ['жизнь', 'здоровье', 'машина'], 'без повторов, в порядке вариантов');
  assert.equal(a.items.property[0].f.what, 'квартира', 'один вариант - строкой, как было');
  assert.deepEqual(a.wishes, { will: 'есть' });
  assert.deepEqual(A.normalizeArchive(JSON.parse(JSON.stringify(a))), a, 'идемпотентно');
});

test('З1/З3 миграция: настоящий зашифрованный сейф со старым архивом открывается без потерь', async () => {
  const old = { version: 1, sections: { passwords: [{ id: 'p1', password: 'pw' }] },
    archive: { v: 1, items: { insurance: [{ id: 'i1', f: { company: 'Согаз', what: 'несчастный случай' } }], money: [{ id: 'm1', f: { what: 'вклад' } }] } } };
  const file = await C.newVaultFile('master pass phrase', old);
  const res = await C.unlockWithPassword(file, 'master pass phrase');
  const v = A.ensureArchive(ensureSections(res.vault));
  assert.deepEqual(v.archive.items.insurance[0].f, { company: 'Согаз', what: ['жизнь', 'здоровье'] });
  assert.deepEqual(v.archive.items.money[0].f, { what: ['вклад'] });
  assert.equal(v.sections.passwords[0].password, 'pw');
});

test('З1: запись хранит список; пустой выбор не сохраняется; мусор отбрасывается', () => {
  const a = A.normalizeArchive(null);
  const it = A.addItem(a, 'money', { company: 'ВТБ', what: ['счёт', 'вклад', '', 7, 'вклад'] });
  assert.deepEqual(it.f.what, ['вклад', 'счёт']);
  A.updateItem(a, 'money', it.id, { company: 'ВТБ', what: [] });
  assert.deepEqual(a.items.money[0].f, { company: 'ВТБ' });
  A.updateItem(a, 'money', it.id, { what: 'ИИС' });
  assert.deepEqual(a.items.money[0].f, { what: ['ИИС'] }, 'строка - список из одного');
  A.addItem(a, 'property', { what: ['дом', 'дача'] });
  assert.deepEqual(a.items.property[0].f, {}, 'один вариант - массив не принимается');
});

// ---------------- лист и файл ----------------
test('З1: лист для печати и зашифрованный файл - варианты через запятую', () => {
  const v = ensureSections({ version: 1, sections: {} });
  const a = A.normalizeArchive(null);
  A.addItem(a, 'money', { company: 'Сбер', what: ['вклад', 'счёт', 'брокерский счёт'] });
  A.addItem(a, 'insurance', { company: 'Согаз', what: 'несчастный случай' });
  for (const build of [A.buildSheetModel, A.buildFullModel]) {
    const m = build(a, v, { schema: UI.FIELD_SCHEMA, now: new Date(2026, 9, 27) });
    const lines = m.sections.flatMap((s) => s.rows.flatMap((r) => r.lines));
    assert.deepEqual(lines.find((l) => l[0] === 'Что там'), ['Что там', 'вклад, счёт, брокерский счёт']);
    assert.deepEqual(lines.find((l) => l[0] === 'Что застраховано'), ['Что застраховано', 'жизнь, здоровье']);
  }
  const html = A.renderSheetHtml(A.buildSheetModel(a, v, { schema: UI.FIELD_SCHEMA }));
  assert.match(html, /<td class="k">Что там<\/td><td class="v">вклад, счёт, брокерский счёт<\/td>/);
  assert.equal(A.fieldText(fd('money', 'what'), ['ИИС', 'вклад']), 'вклад, ИИС');
  assert.equal(A.fieldText(fd('property', 'what'), 'дом'), 'дом');
});

test('З1: исходник - своё окно с галочками (не системное), «Готово» и «Отмена»', () => {
  assert.ok(!/<select|type=["']?checkbox["']? data-k/.test(UIJS));
  assert.match(UIJS, /else if \(fd\.type === 'multi'\) r = await openMultiPicker\(\{ title: fd\.label, options: fd\.options, value: A\.multiValues\(fd, vals\[key\]\) \}\);/);
  assert.match(UIJS, /b\.setAttribute\('role', 'checkbox'\);/);
});

test('З2: исходник - «Сохранить» в вопросе о несохранённом не уходит туда, куда шли (крестик), а остаётся в разделе', () => {
  assert.match(UIJS, /if \(r === 'save'\) \{ await form\.save\(\); return; \}/);
  assert.match(UIJS, /screen = sec\.single \? \{ name: 'home' \} : \{ name: 'section', id \};/);
});

// ---------------- часть 2: настоящий DOM ----------------
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
let puppeteer = null;
try { puppeteer = (await import('puppeteer-core')).default; } catch (e) {}
const canDom = !!(EDGE && puppeteer);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serveWww() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      const f = path.join(WWW, p);
      if (!f.startsWith(WWW)) { res.writeHead(403); res.end(); return; }
      fs.readFile(f, (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const MK_VAULT = `(async () => {
  for (let i=0;i<80;i++){ const sp=document.querySelector('#setupPw'); if (sp && sp.offsetParent) break; await new Promise(r=>setTimeout(r,150)); }
  const pw=document.querySelector('#setupPw'), pw2=document.querySelector('#setupPw2'); if(!pw) return 'nosetup';
  pw.value='zam-133 Lampa-Rybka master'; pw.dispatchEvent(new Event('input',{bubbles:true}));
  pw2.value='zam-133 Lampa-Rybka master'; pw2.dispatchEvent(new Event('input',{bubbles:true}));
  const ack=document.querySelector('#setupWarnAck'); if(ack && !ack.checked){ ack.checked=true; ack.dispatchEvent(new Event('change',{bubbles:true})); }
  const acc=document.querySelector('#setupAccept'); const row=document.querySelector('#setupAcceptRow'); if(acc && row && !row.hidden){ acc.checked=true; acc.dispatchEvent(new Event('change',{bubbles:true})); }
  document.querySelector('#setup').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
  for (let i=0;i<80;i++){ const sh=document.querySelector('#shell'); if (sh && !sh.classList.contains('hidden') && document.querySelector('#menuBtn')) break; await new Promise(r=>setTimeout(r,150)); }
  await new Promise(r=>setTimeout(r,400));
  for (const b of document.querySelectorAll('.modal-back')) { const btn = b.querySelector('.save, button:last-child'); if (btn) btn.click(); }
  await new Promise(r=>setTimeout(r,200));
  return 'created';
})()`;
const W = (ms) => `await new Promise(r=>setTimeout(r,${ms}));`;
const OPEN_ARC = `document.querySelector('#menuBtn').click(); ${W(250)} document.querySelector('#mArchive').click(); ${W(400)}`;
// где мы: 'form:<раздел>' | 'section:<заголовок>' | 'home' | 'closed'
const WHERE = `(() => { const m = document.querySelector('.modal.archive'); if (!m) return 'closed';
  if (m.querySelector('.arc-save')) return 'form'; if (m.querySelector('.arc-add')) return 'section:' + m.querySelector('.detail-title').textContent;
  if (m.querySelector('.arc-list')) return 'home'; return '?'; })()`;

const FLOW = `(async () => {
  const App = await import('/js/app.js');
  const out = {};
  const where = () => ${WHERE};
  ${OPEN_ARC}
  // --- З1: Деньги -> «Что там» - два варианта
  document.querySelector('.arc-row[data-sec="money"]').click(); ${W(300)}
  document.querySelector('.arc-add').click(); ${W(250)}
  const inp = document.querySelector('input[data-k="company"]'); inp.value = 'TEST - udalit'; inp.dispatchEvent(new Event('input'));
  document.querySelector('.arc-pickbtn[data-k="what"]').click(); ${W(300)}
  out.multiOpen = { dlg: !!document.querySelector('.modal.arc-multi'), items: [...document.querySelectorAll('.arc-mi')].map((b) => b.dataset.v), select: !!document.querySelector('.modal.arc-multi select') };
  document.querySelector('.arc-mi[data-v="вклад"]').click();
  document.querySelector('.arc-mi[data-v="ИИС"]').click();
  document.querySelector('.arc-mi[data-v="счёт"]').click(); document.querySelector('.arc-mi[data-v="счёт"]').click();   // включил и снял
  out.checked = [...document.querySelectorAll('.arc-mi[aria-checked="true"]')].map((b) => b.dataset.v);
  document.querySelector('.arc-multi-ok').click(); ${W(200)}
  out.btnText = document.querySelector('.arc-pickbtn[data-k="what"] .picker-val').textContent;
  // «Сохранить» кнопкой формы -> список раздела «Деньги»
  document.querySelector('.arc-save').click(); ${W(700)}
  out.afterSave = where();
  out.saved = App.state.vault.archive.items.money.map((x) => x.f);
  out.row = (document.querySelector('.arc-item') || {}).innerText;
  // открыть снова - оба отмечены
  document.querySelector('.arc-item').click(); ${W(250)}
  document.querySelector('.arc-pickbtn[data-k="what"]').click(); ${W(300)}
  out.reopenChecked = [...document.querySelectorAll('.arc-mi[aria-checked="true"]')].map((b) => b.dataset.v);
  // «Назад» на окне выбора закрывает только его, выбор не меняется
  document.querySelector('.arc-mi[data-v="наличные"]').click();
  window.__seyfBack(); ${W(250)}
  out.afterBackMulti = { dlg: !!document.querySelector('.modal.arc-multi'), where: where(), text: document.querySelector('.arc-pickbtn[data-k="what"] .picker-val').textContent };
  // --- З2: правка -> крестик -> «Сохранить изменения?» -> «Сохранить» -> остаёмся в разделе (раньше - главный экран)
  const i2 = document.querySelector('input[data-k="amount"]'); i2.value = '100'; i2.dispatchEvent(new Event('input'));
  document.querySelector('.arc-x').click(); ${W(300)}
  out.ask = (document.querySelector('.modal.confirm') || {}).innerText || '';
  document.querySelector('.modal.confirm .save').click(); ${W(800)}
  out.afterXSave = where();
  out.amount = App.state.vault.archive.items.money[0].f.amount;
  // «Назад» из раздела -> первый экран архива; ещё «Назад» -> архив закрыт
  window.__seyfBack(); ${W(300)}
  out.afterBack1 = where();
  // --- З2 через системную «Назад» на форме: правка -> «Назад» -> «Сохранить» -> раздел
  document.querySelector('.arc-row[data-sec="insurance"]').click(); ${W(300)}
  document.querySelector('.arc-add').click(); ${W(250)}
  const i3 = document.querySelector('input[data-k="company"]'); i3.value = 'TEST - udalit'; i3.dispatchEvent(new Event('input'));
  document.querySelector('.arc-pickbtn[data-k="what"]').click(); ${W(300)}
  out.insItems = [...document.querySelectorAll('.arc-mi')].map((b) => b.dataset.v);
  document.querySelector('.arc-mi[data-v="жизнь"]').click(); document.querySelector('.arc-mi[data-v="здоровье"]').click();
  document.querySelector('.arc-multi-ok').click(); ${W(200)}
  window.__seyfBack(); ${W(300)}
  document.querySelector('.modal.confirm .save').click(); ${W(800)}
  out.afterBackSave = where();
  out.ins = App.state.vault.archive.items.insurance.map((x) => x.f.what);
  // «Не сохранять» на крестике - закрыть архив, как раньше
  document.querySelector('.arc-item').click(); ${W(250)}
  const i4 = document.querySelector('input[data-k="policy"]'); i4.value = 'X'; i4.dispatchEvent(new Event('input'));
  document.querySelector('.arc-x').click(); ${W(300)}
  document.querySelector('.modal.confirm .deny').click(); ${W(400)}
  out.afterXDeny = where();
  out.policy = App.state.vault.archive.items.insurance[0].f.policy || '';
  return out;
})()`;

test('DOM 360x640: З1 несколько вариантов, З3 нет «несчастного случая», З2 после сохранения - раздел архива', { skip: canDom ? false : 'нет Edge/puppeteer-core', timeout: 180000 }, async () => {
  const srv = await serveWww();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-zam133-'));
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, userDataDir: udd, args: ['--no-first-run', '--disable-gpu', '--no-default-browser-check', '--edge-skip-compat-layer-relaunch'] });
  const pid = browser.process() && browser.process().pid;
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (r) => { if (/^https?:\/\/127\.0\.0\.1/.test(r.url()) || /^(data|blob|about):/.test(r.url())) r.continue(); else r.abort(); });
    await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 1, isMobile: true });
    await page.evaluateOnNewDocument('window.SEYF_DEMO = false;');
    await page.goto(base, { waitUntil: 'load' });
    await page.evaluate(`try{localStorage.setItem('seyf_seed_banner_dismissed','1');localStorage.setItem('seyf_onboarded','1');}catch(e){}`);
    assert.equal(await page.evaluate(MK_VAULT), 'created');
    const r = await page.evaluate(FLOW);
    assert.deepEqual(r.multiOpen, { dlg: true, items: fd('money', 'what').options, select: false }, 'З1: своё окно с вариантами');
    assert.deepEqual(r.checked, ['вклад', 'ИИС']);
    assert.equal(r.btnText, 'вклад, ИИС');
    assert.equal(r.afterSave, 'section:Деньги', 'З2: «Сохранить» - список раздела');
    assert.deepEqual(r.saved, [{ company: 'TEST - udalit', what: ['вклад', 'ИИС'] }]);
    assert.match(r.row, /TEST - udalit\s+вклад, ИИС/);
    assert.deepEqual(r.reopenChecked, ['вклад', 'ИИС'], 'З1: открыл снова - оба отмечены');
    assert.deepEqual(r.afterBackMulti, { dlg: false, where: 'form', text: 'вклад, ИИС' }, '«Назад» закрыл только окно выбора');
    assert.match(r.ask, /Сохранить изменения\?/);
    assert.equal(r.afterXSave, 'section:Деньги', 'З2: крестик -> «Сохранить» - остаёмся в разделе, не главный экран');
    assert.equal(r.amount, '100');
    assert.equal(r.afterBack1, 'home', 'З2: «Назад» из раздела - первый экран архива');
    assert.deepEqual(r.insItems, ['жизнь', 'здоровье', 'квартира', 'машина', 'другое'], 'З3: «несчастного случая» нет');
    assert.equal(r.afterBackSave, 'section:Страховки', 'З2: «Назад» -> «Сохранить» - раздел');
    assert.deepEqual(r.ins, [['жизнь', 'здоровье']]);
    assert.equal(r.afterXDeny, 'closed', 'крестик -> «Не сохранять» - закрыть архив, как раньше');
    assert.equal(r.policy, '');
  } finally {
    try { await browser.close(); } catch (e) {}
    if (pid && process.platform === 'win32') { try { execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' }); } catch (e) {} }
    srv.close();
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {}
  }
});

// ---------------- ревью 27.10: ложное «Сохранено» ----------------
test('Архив: если запись на диск не удалась, «Сохранено» не перекрывает тост с ошибкой', () => {
  const src = read('www', 'js', 'archive-ui.js');
  const persist = src.slice(src.indexOf('async function persist()'), src.indexOf('// ---------- главное окно архива'));
  assert.match(persist, /saveFile\(\); return true;/);
  assert.match(persist, /Попробуйте ещё раз\.'\); return false;/);
  assert.match(src, /ok = await persist\(\);/);
  assert.match(src, /if \(ok\) D\.toast\('Сохранено'\);/);
  assert.doesNotMatch(src, /\n\s*D\.toast\('Сохранено'\);/);
});
