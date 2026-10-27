// adv133b-fixes.test.mjs - находки адверсариального ревью новой части 1.3.3 (архив, меню, вопросы), 27.10.2026.
//   В1 - двойное касание «Сохранить» в форме архива создаёт ОДНУ запись (busy + кнопка выключена);
//   В2 - пароль файла: оценка стойкости приложения + запрет популярных слов, рядов клавиатуры/алфавита, повторов;
//        подсказка «3-4 случайных слова» и кнопка «Придумать пароль» (генератор фраз приложения);
//   В3 - «Назад»/Escape закрывает только верхнее окно («О приложении» -> «Обновление»), окна обновления
//        сменяют друг друга, а не стопкой;
//   М1 - печать: «системное окно» держится до конца печати или возврата в приложение (syswindow.js + плагин);
//   М2 - зашифрованный HTML без скриптов/WebCrypto показывает, где открыть файл;
//   М3 - ссылки в листе без логина и пароля в адресе; точные подписи галочек;
//   М4 - коды 2FA и Wi-Fi: в лист только названия, секреты - только в файл;
//   М5 - стёртая целиком запись не сохраняется «Без названия»; уход с заполненной формы - вопрос;
//   М6 - «это мастер-пароль?» снятием обёртки ключа; пароль файла в NFC;
//   плюс - значок «Резервной копии» не путается с «Архивом для близких».
// Часть 1 - чистая логика и исходники; часть 2 - настоящий DOM в headless Edge 360x640.
// Мутации - scratchpad fix133b/mut.mjs (каждая краснеет).
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
import { ensureSections } from '../www/js/sectionsx.js';
import * as C from '../www/js/crypto.js';
import { generatePassphrase } from '../www/js/generator.js';
import { createSysWindow } from '../www/js/syswindow.js';
import { hasIcon } from '../www/js/icons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const APP = read('www', 'js', 'app.js');
const UIJS = read('www', 'js', 'archive-ui.js');
const fnSrc = (src, name) => { const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, 'нет ' + name); return src.slice(i, src.indexOf('\n}\n', i)); };

// ---------------- В2 ----------------
test('В2: слабые пароли файла отклоняются (популярные слова, ряды, повторы), подсказка ведёт к «Придумать пароль»', () => {
  for (const p of ['Password12', 'qwerty1234', 'aaaaaaaaa1', '1111111111a', 'пароль2026!', 'йцукенгшщз', 'абвгдежзиклмн',
    'Qwerty123456!', 'Zxcvbnm,./2026', 'abababababab12', 'Пароль-пароль-1', 'iloveyou2026', '1234567890', 'aaaaaaaaaaaa',
    'kotrybalam']) {   // последний - без шаблонов, но 10 строчных: слабый по оценке стойкости приложения
    const r = A.filePasswordProblem(p, p);
    assert.match(r, /простой/, 'должен отклоняться: ' + p);
    assert.match(r, /3-4 случайных слова/);
    assert.match(r, /«Придумать пароль»/);
  }
  assert.match(A.filePasswordProblem('Ab1!x', 'Ab1!x'), /короче 10 знаков\. Нажмите «Придумать пароль» или возьмите 3-4 случайных слова/);
  for (const p of ['Correct horse 42', 'кот Барсик 2027', 'Ключ для сестры 2026', 'zelenyikotspit', 'Мама мыла раму 7']) {
    assert.equal(A.filePasswordProblem(p, p), '', 'нормальный пароль: ' + p);
  }
  // кнопка «Придумать пароль» (4 слова генератора) всегда даёт пароль, который проходит планку
  for (let i = 0; i < 300; i++) { const g = generatePassphrase({ words: 4 }); assert.equal(A.filePasswordProblem(g, g), '', g); }
  assert.match(UIJS, /const pw = generatePassphrase\(\{ words: 4 \}\);\s*p1\.type = 'text'; p2\.type = 'text';[^\n]*\n\s*p1\.value = pw; p2\.value = pw;/);
  assert.match(UIJS, /<span class="arc-pwlab"><label for="arcPw1">\$\{esc\(A\.FILE_PW\.label\)\}<\/label><button type="button" class="arc-gen">\$\{esc\(A\.FILE_PW_GEN\)\}<\/button><\/span>/, 'кнопка в строке подписи поля');
  assert.equal(A.FILE_PW_GEN, 'Придумать пароль');
  assert.match(read('www', 'js', 'archive.js'), /import \{ estimateStrength \} from '\.\/generator\.js';/, 'оценка стойкости - приложения (ядро не тронуто)');
});

// ---------------- М3 / М4: лист ----------------
let n = 0;
const S = () => 'SECRET' + (++n) + 'x';
function vaultAll() {
  n = 0;
  const v = { version: 1, sections: {} };
  const add = (sec, e) => { (v.sections[sec] = v.sections[sec] || []).push({ id: sec + '0', customFields: [{ name: 'Поле', value: S(), secret: true }], ...e }); };
  add('passwords', { description: 'Почта', url: 'https://' + S() + ':' + S() + '@mail.example.ru/inbox', login: S(), password: S() });
  add('wallets', { description: 'Кошелёк', url: S() + ':' + S() + '@pay.example.ru', number: S(), password: S() });
  add('totp', { name: 'Госуслуги', secret: S(), digits: 8, period: 60, algorithm: 'SHA256' });
  add('wifi', { name: 'Дом', ssid: 'home-net', password: S(), note: S() });
  return ensureSections(v);
}

test('М3: ссылка в листе без логина и пароля в адресе (https://user:pass@host -> https://host), в файле - как есть', () => {
  assert.equal(A.stripUserinfo('https://user:pass@host.ru/x?y=1'), 'https://host.ru/x?y=1');
  assert.equal(A.stripUserinfo('user:pw@mail.ru'), 'mail.ru');
  assert.equal(A.stripUserinfo('http://login@b.ru'), 'http://b.ru');
  assert.equal(A.stripUserinfo('https://mail.yandex.ru/?a=b@c'), 'https://mail.yandex.ru/?a=b@c', '@ в запросе - не логин');
  assert.equal(A.stripUserinfo('vk.com'), 'vk.com');
  const v = vaultAll();
  const a = A.normalizeArchive(null);
  for (const src of A.PICK_SOURCES) for (const e of v.sections[src] || []) A.togglePick(a, src, e.id, true);
  const sheet = A.renderSheetHtml(A.buildSheetModel(a, v, { schema: UI.FIELD_SCHEMA }));
  assert.ok(sheet.includes('https://mail.example.ru/inbox') && sheet.includes('pay.example.ru'), 'адрес сайта в листе остаётся');
  const full = JSON.stringify(A.buildFullModel(a, v, { schema: UI.FIELD_SCHEMA }));
  // М4: коды 2FA и Wi-Fi - в листе только названия
  for (const w of ['Госуслуги', 'Дом']) assert.ok(sheet.includes(w), 'название в листе: ' + w);
  assert.ok(!sheet.includes('home-net'), 'имя сети Wi-Fi - только в файл');
  for (let i = 1; i <= n; i++) {
    const s = 'SECRET' + i + 'x';
    assert.ok(!sheet.includes(s), 'секрет в листе: ' + s);
    assert.ok(full.includes(s), 'секрет должен быть в файле: ' + s);
  }
  assert.match(full, /"Цифр в коде","8"/, 'нестандартные параметры 2FA - в файл');
  assert.ok(full.includes('home-net'));
  assert.deepEqual(A.SHEET_FIELDS.totp, ['name']);
  assert.deepEqual(A.SHEET_FIELDS.wifi, ['name']);
});

test('М3/М4: подписи галочек - что в лист, что только в файл', () => {
  assert.equal(A.PICK_CAPTION, 'В лист для печати попадут названия и банки, без номеров и паролей. Пароли и номера - только в файл под паролем.');
  assert.equal(A.ACCOUNTS_CAPTION, 'В лист - только название сайта. Логин и пароль - только в файл под паролем.');
  assert.equal(A.pickCaption('money'), A.PICK_CAPTION);
  assert.equal(A.pickCaption('accounts'), A.ACCOUNTS_CAPTION);
  assert.ok(!/номер/.test(A.pickCaption('contacts').split('.')[0]), 'у контактов телефон в листе - подпись не обещает «без номеров»');
  assert.match(UIJS, /html \+= `<p class="arc-cap">\$\{esc\(A\.pickCaption\(id\)\)\}<\/p>`;/);
  assert.match(UIJS, /if \(A\.SOURCE_CAPTIONS\[src\]\) html \+= `<p class="arc-cap">\$\{esc\(A\.SOURCE_CAPTIONS\[src\]\)\}<\/p>`;/);
  assert.deepEqual(Object.keys(A.SOURCE_CAPTIONS), ['totp', 'wifi']);
  assert.match(A.SOURCE_CAPTIONS.wifi, /Имя сети и пароль - только в файл/);
  assert.match(A.ISSUE_FULL.text, /^То же плюс логины, пароли, номера карт и ПИН-коды\. Сохраняется файлом под паролем\. Файл и пароль передайте разными путями/, 'Алексей «ок» 27.10');
  const all = [A.PICK_CAPTION, A.ACCOUNTS_CAPTION, A.DOCS_CAPTION, A.CONTACTS_CAPTION, ...Object.values(A.SOURCE_CAPTIONS), A.FILE_PW_TIP, A.VIEWER_NOJS].join(' ');
  assert.ok(!all.includes('—'), 'без длинного тире');
});

// ---------------- М6 ----------------
test('М6: «это мастер-пароль?» - снятием обёртки ключа (данные сейфа не расшифровываются), NFC', async () => {
  const file = await C.newVaultFile('Мастер-ключ йод 2026', { version: 1, sections: {} });
  assert.equal(await A.opensVaultKey(file, 'Мастер-ключ йод 2026', C), true);
  assert.equal(await A.opensVaultKey(file, 'другой пароль 2026', C), false);
  const broken = { ...file, data: { iv: file.data.iv, ct: btoa('испорчено'.replace(/[^\x00-\x7f]/g, 'x')) } };
  await assert.rejects(() => C.unlockWithPassword(broken, 'Мастер-ключ йод 2026'), 'полная расшифровка тут бы упала');
  assert.equal(await A.opensVaultKey(broken, 'Мастер-ключ йод 2026', C), true, 'проверяется только обёртка ключа');
  assert.match(APP, /isMasterPassword: async \(pw\) => \(await opensVaultKey\(state\.file, pw, C\)\) \|\| \(pw\.normalize\('NFC'\) !== pw && opensVaultKey\(state\.file, pw\.normalize\('NFC'\), C\)\),/);
  // пароль файла: набранный в NFD открывает файл, зашифрованный NFC-паролем, и наоборот (и кодом из файла)
  const nfc = 'Ключ йод ёж 2026'.normalize('NFC'), nfd = nfc.normalize('NFD');
  assert.notEqual(nfc, nfd);
  const env = await A.encryptPayload({ a: 1 }, nfd, { iterations: 1000 });
  assert.deepEqual(await A.decryptPayload(env, nfc), { a: 1 });
  const open = new Function(A.VIEWER_CORE + '\nreturn seyfOpen;')();
  assert.deepEqual(await open(env, nfc), { a: 1 });
  assert.deepEqual(await open(await A.encryptPayload({ b: 2 }, nfc, { iterations: 1000 }), nfd), { b: 2 });
  assert.equal(A.filePasswordProblem(nfc, nfd), '', 'повтор в другой форме Unicode - совпадает');
});

// ---------------- М1 ----------------
test('М1: системное окно печати держится, пока приложение не вернулось; без untilForeground - как раньше', async () => {
  const w = createSysWindow();
  let finish;
  const p = w.run(() => new Promise((r) => { finish = r; }), { untilForeground: true });
  assert.equal(w.isOpen(), true);
  w.background();                       // окно печати открылось - приложение в фоне
  finish({ ok: true });                 // плагин ответил, а окно печати ещё на экране
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(w.isOpen(), true, 'флаг держится до возврата в приложение');
  w.foreground();
  assert.deepEqual(await p, { ok: true });
  assert.equal(w.isOpen(), false);
  // ответ пришёл, когда приложение уже на переднем плане - флаг снимается сразу
  const q = w.run(async () => 7, { untilForeground: true });
  assert.equal(await q, 7);
  assert.equal(w.isOpen(), false);
  // сохранение файла (без untilForeground) - флаг снимается по ответу, как раньше
  w.background();
  assert.equal(await w.run(async () => 1), 1);
  assert.equal(w.isOpen(), false);
  w.foreground();
  // два окна подряд: флаг держится, пока открыто хоть одно
  let f1; const r1 = w.run(() => new Promise((r) => { f1 = r; }));
  let f2; const r2 = w.run(() => new Promise((r) => { f2 = r; }));
  f1(); await r1; assert.equal(w.isOpen(), true); f2(); await r2; assert.equal(w.isOpen(), false);
});

test('М1: app.js и плагин - печать ждёт конца, метка фона не обнуляется, пока приложение в фоне', () => {
  assert.match(UIJS, /NP\.Print\.print\(\{ html, name: A\.ARCHIVE_TITLE \}\), \{ untilForeground: true \}\)/);
  const w = APP.slice(APP.indexOf('async function withSystemWindow('), APP.indexOf('function onForeground('));
  assert.match(w, /return await sysWin\.run\(fn, \{ untilForeground: opts\.untilForeground === true \}\);/);
  assert.match(w, /finally \{ if \(!sysWin\.isOpen\(\) && !sysWin\.isHidden\(\)\) bgAt = 0;/);
  // баг 1.3.3 (REPORT п.8): метка фона ставится и при открытом системном окне - выхода по sysWin.isOpen() нет
  assert.match(w, /function onBackground\(\) \{\s*sysWin\.background\(\);\s*if \(!autoLock \|\| !state\.vault\) return;\s*if \(!bgAt\) bgAt = Date\.now\(\);/);
  const fg = APP.slice(APP.indexOf('function onForeground('), APP.indexOf('let locking = false;'));
  assert.match(fg, /const sysOpen = sysWin\.isOpen\(\); sysWin\.foreground\(\);/);
  assert.match(fg, /foregroundDecision\(\{ systemWindowOpen: sysOpen,/);
  const J = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'PrintPlugin.java').replace(/\r\n/g, '\n');
  const afterPrint = J.slice(J.indexOf('pm.print(job, adapter, attrs);'), J.indexOf('} catch (Exception e)', J.indexOf('pm.print(job, adapter, attrs);')));
  assert.ok(!/resolve/.test(afterPrint), 'ответ не сразу после pm.print');
  assert.match(J, /public void onFinish\(\) \{\s*inner\.onFinish\(\);\s*if \(pending == call\) finishPending\(\);/);
  assert.match(J, /protected void handleOnResume\(\) \{\s*super\.handleOnResume\(\);\s*if \(pending != null && paused\) finishPending\(\);/);
  assert.match(J, /protected void handleOnPause\(\) \{\s*super\.handleOnPause\(\);\s*if \(pending != null\) paused = true;/);
});

// ---------------- М2 ----------------
test('М2: файл без скриптов или без WebCrypto говорит, где его открыть', () => {
  assert.equal(A.VIEWER_NOJS, 'Здесь файл не открыть. Откройте этот файл в браузере (Chrome, Яндекс Браузер, Safari).');
  const html = A.buildEncryptedHtml({ seyfArchive: 1, kdf: 'PBKDF2-SHA256', it: 1, salt: 'AA==', iv: 'AA==', ct: 'AA==' });
  assert.match(html, /<noscript><style>#gate\{display:none!important\}<\/style><div class="nojs"><h1>Архив для близких<\/h1><p>Здесь файл не открыть\. Откройте этот файл в браузере \(Chrome, Яндекс Браузер, Safari\)\.<\/p><\/div><\/noscript>/);
  assert.match(html, /<p id="nocrypto" hidden>Здесь файл не открыть/);
  assert.match(html, /if\(!\(typeof crypto!=="undefined"&&crypto\.subtle&&typeof TextEncoder!=="undefined"\)\)\{document\.getElementById\("nocrypto"\)\.hidden=false;/);
});

// ---------------- В3 (исходник) ----------------
test('В3: окна обновления и «О приложении» реагируют на «Назад», только если они верхние; окна обновления не стопкой', () => {
  const dlg = fnSrc(APP, 'seyfOpenDlg');
  assert.match(dlg, /const onKey = \(e\) => \{ if \(e\.key === 'Escape' && isTopModal\(back\)\) \{ e\.stopPropagation\(\); close\(\); \} \};/);
  assert.match(dlg, /for \(const old of document\.querySelectorAll\('\.modal-back\.upd-back'\)\) \{ if \(typeof old\.seyfClose === 'function'\) old\.seyfClose\(\); else old\.remove\(\); \}/);
  assert.match(fnSrc(APP, 'openAbout'), /const onKey = \(e\) => \{ if \(!isTopModal\(back\)\) return;/);
  // окна, поверх которых открываются другие (подсказка, копия, полная версия, разделы, вход)
  assert.ok(!/const onKey = \(e\) => \{ if \(e\.key === 'Escape' \|\| e\.key === 'Enter'\) \{/.test(APP), 'Escape/Enter без проверки «верхнее»');
  assert.match(fnSrc(APP, 'openBackupDialog'), /if \(e\.key === 'Escape' && isTopModal\(back\)\)/);
  // все окна архива
  const keys = [...UIJS.matchAll(/=> \{ if \(e\.key === 'Escape'([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(keys.length, 6, 'окна архива: главное, лист, пароль файла, дата, несколько вариантов (З1), напоминание');
  for (const k of keys) assert.match(k, /&& D\.isTopModal\(/);
});

test('плюс: значок «Резервной копии» - не коробка-архив и не чемоданчик архива для близких', () => {
  const HTML = read('www', 'index.html');
  const ic = (id) => (HTML.match(new RegExp('id="' + id + '"[^>]*><span class="mi-ic" data-ic="(\\w+)"')) || [])[1];
  assert.equal(ic('mBackup'), 'backup');
  assert.equal(ic('mArchive'), 'briefcase');
  assert.ok(hasIcon('backup'));
  assert.ok(!['archive', 'briefcase'].includes(ic('mBackup')));
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
  pw.value='adv-133b Lampa-Rybka master'; pw.dispatchEvent(new Event('input',{bubbles:true}));
  pw2.value='adv-133b Lampa-Rybka master'; pw2.dispatchEvent(new Event('input',{bubbles:true}));
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
const CLOSE_ALL = `for (let i=0;i<6 && document.querySelector('.modal-back');i++){ window.__seyfBack(); ${W(150)} const c=document.querySelector('.modal.confirm button.deny, .modal.confirm .deny'); if (c) { c.click(); ${W(150)} } }`;

// В1 / М5 / В3 в архиве: один сценарий на страницу
const ARC_FLOW = `(async () => {
  const App = await import('/js/app.js');
  const out = {};
  ${OPEN_ARC}
  document.querySelector('.arc-row[data-sec="insurance"]').click(); ${W(300)}
  document.querySelector('.arc-add').click(); ${W(250)}
  const inp = document.querySelector('input[data-k="company"]'); inp.value = 'Согаз'; inp.dispatchEvent(new Event('input'));
  const save = document.querySelector('.arc-save'); save.click(); save.click();   // двойное касание
  ${W(900)}
  out.afterDouble = App.state.vault.archive.items.insurance.length;
  // М5: открыть запись, стереть все поля, «Сохранить» - запись не превращается в «Без названия»
  document.querySelector('.arc-item').click(); ${W(250)}
  const i2 = document.querySelector('input[data-k="company"]'); i2.value = ''; i2.dispatchEvent(new Event('input'));
  document.querySelector('.arc-save').click(); ${W(500)}
  out.afterEmpty = App.state.vault.archive.items.insurance.map((x) => x.f.company || '');
  out.stillForm = !!document.querySelector('.arc-save');
  // М5: крестик на заполненной форме - вопрос «Сохранить изменения?»
  const i3 = document.querySelector('input[data-k="company"]'); i3.value = 'Ингосстрах'; i3.dispatchEvent(new Event('input'));
  document.querySelector('.arc-x').click(); ${W(300)}
  out.ask = (document.querySelector('.modal.confirm') || {}).innerText || '';
  // В3: «Назад» на вопросе закрывает только вопрос, форма архива остаётся
  window.__seyfBack(); ${W(300)}
  out.afterBackAsk = { confirm: !!document.querySelector('.modal.confirm'), form: !!document.querySelector('.modal.archive .arc-save') };
  // В3: окно даты поверх формы - «Назад» закрывает только его
  document.querySelector('.arc-pickbtn[data-k="until"]').click(); ${W(300)}
  out.dateOpen = !!document.querySelector('.arc-date');
  window.__seyfBack(); ${W(300)}
  out.afterBackDate = { date: !!document.querySelector('.arc-date'), form: !!document.querySelector('.modal.archive .arc-save') };
  ${CLOSE_ALL}
  return out;
})()`;

// В3: «О приложении» -> «Проверить обновления» -> окно «Обновление» -> «Назад»
const ABOUT_FLOW = `(async () => {
  const out = { maxUpd: 0 };
  document.querySelector('#menuBtn').click(); ${W(250)} document.querySelector('#mAbout').click(); ${W(350)}
  document.querySelector('.about-check').click();
  for (let i = 0; i < 40; i++) { ${W(100)} out.maxUpd = Math.max(out.maxUpd, document.querySelectorAll('.upd-dlg').length); }
  out.updOpen = document.querySelectorAll('.upd-dlg').length;
  window.__seyfBack(); ${W(250)}
  out.afterBack = { upd: document.querySelectorAll('.upd-dlg').length, about: !!document.querySelector('.modal.about') };
  // окна обновления сменяют друг друга: два вызова подряд - одно окно
  window.SeyfUI.openDlg({ title: 'Обновление', body: '<p>1</p>' });
  window.SeyfUI.openDlg({ title: 'Обновление', body: '<p>2</p>' });
  out.twice = { n: document.querySelectorAll('.upd-dlg').length, text: (document.querySelector('.upd-dlg') || {}).innerText };
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }); document.dispatchEvent(ev); ${W(200)}
  out.afterEsc = { upd: document.querySelectorAll('.upd-dlg').length, about: !!document.querySelector('.modal.about') };
  window.__seyfBack(); ${W(250)}
  out.afterBack2 = { about: !!document.querySelector('.modal.about') };
  return out;
})()`;

test('DOM 360x640: двойное «Сохранить» - одна запись; стёртая запись не сохраняется; «Назад» закрывает только верхнее', { skip: canDom ? false : 'нет Edge/puppeteer-core', timeout: 180000 }, async () => {
  const srv = await serveWww();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-adv133b-'));
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, userDataDir: udd, args: ['--no-first-run', '--disable-gpu', '--no-default-browser-check', '--edge-skip-compat-layer-relaunch'] });
  const pid = browser.process() && browser.process().pid;
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (r) => { if (/^https?:\/\/127\.0\.0\.1/.test(r.url()) || /^(data|blob|about):/.test(r.url())) r.continue(); else r.abort(); });   // без сети наружу
    await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 1, isMobile: true });
    await page.evaluateOnNewDocument('window.SEYF_DEMO = false;');
    await page.goto(base, { waitUntil: 'load' });
    await page.evaluate(`try{localStorage.setItem('seyf_seed_banner_dismissed','1');localStorage.setItem('seyf_onboarded','1');}catch(e){}`);
    assert.equal(await page.evaluate(MK_VAULT), 'created');
    const r = await page.evaluate(ARC_FLOW);
    assert.equal(r.afterDouble, 1, 'В1: двойное касание «Сохранить» - одна запись');
    assert.deepEqual(r.afterEmpty, ['Согаз'], 'М5: стёртая запись не сохранена пустой');
    assert.equal(r.stillForm, true, 'М5: остаёмся в форме');
    assert.match(r.ask, /Сохранить изменения\?/, 'М5: крестик на заполненной форме спрашивает');
    assert.deepEqual(r.afterBackAsk, { confirm: false, form: true }, 'В3: «Назад» закрыл только вопрос');
    assert.equal(r.dateOpen, true);
    assert.deepEqual(r.afterBackDate, { date: false, form: true }, 'В3: «Назад» закрыл только окно даты');
    const b = await page.evaluate(ABOUT_FLOW);
    assert.ok(b.maxUpd <= 1, 'В3: окна «Обновление» не стопкой: ' + b.maxUpd);
    assert.equal(b.updOpen, 1, 'окно обновления открыто');
    assert.deepEqual(b.afterBack, { upd: 0, about: true }, 'В3: «Назад» закрыл «Обновление», «О приложении» на месте');
    assert.equal(b.twice.n, 1, 'два окна обновления подряд - одно окно');
    assert.match(b.twice.text, /2/);
    assert.deepEqual(b.afterEsc, { upd: 0, about: true });
    assert.deepEqual(b.afterBack2, { about: false });
  } finally {
    try { await browser.close(); } catch (e) {}
    if (pid && process.platform === 'win32') { try { execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' }); } catch (e) {} }
    srv.close();
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {}
  }
});
