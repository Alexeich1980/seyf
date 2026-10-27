// paywall-layout-133.test.mjs - раскладка кнопок окна «Полная версия» (1.3.3, как в «Хомяке»):
// новички путали «Восстановить покупку» с «Купить». В основном ряду (.paywall-actions) только
// «Закрыть» и «Купить за …»; ниже тихий ряд .pw-more: «Есть ключ» (раскрывает поле ключа,
// aria-expanded) и «Восстановить покупку». Поле ключа скрыто, пока не нажали «Есть ключ».
// Часть 1 - исходник окна; часть 2 - настоящий DOM в headless Edge 360x640 (что видит человек).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');

function paywallSrc() {
  const APP = fs.readFileSync(path.join(WWW, 'js', 'app.js'), 'utf8');
  const i = APP.indexOf('function openPaywall(');
  const j = APP.indexOf('\n}\n', i);
  assert.ok(i > 0 && j > i);
  return APP.slice(i, j);
}

test('исходник: основной ряд - только «Закрыть» и «Купить», второстепенные - отдельным рядом', () => {
  const s = paywallSrc();
  const main = s.match(/<div class="modal-actions paywall-actions">([\s\S]*?)<\/div>/);
  assert.ok(main, 'основной ряд есть');
  const btns = [...main[1].matchAll(/<button[^>]*class="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(btns, ['cancel pw-close', 'save pw-buy'], 'в основном ряду только Закрыть и Купить');
  const more = s.match(/<div class="pw-more">([\s\S]*?)<\/div>/);
  assert.ok(more, 'ряд второстепенных есть');
  assert.match(more[1], /class="pw-keytg" aria-expanded="false" aria-controls="pwKeyBox">Есть ключ</);
  assert.match(more[1], /class="pw-restore">Восстановить покупку</);
  assert.ok(s.indexOf('paywall-actions') < s.indexOf('class="pw-more"'), 'второстепенный ряд ниже основного');
  assert.ok(s.indexOf('class="pw-more"') < s.indexOf('class="paywall-free"'), 'таблица «Бесплатно доступно» ниже кнопок (окно до «Купить» без прокрутки)');
  assert.match(s, /<div class="paywall-license" id="pwKeyBox" hidden>/, 'поле ключа скрыто при открытии');
});

// ---------- часть 2: настоящий DOM ----------
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
const FAKE_PAY = `(() => { window.isNativeApp = () => true; window.NativePlugins = { RuStorePay: {
  async getPurchases() { return { owned: false }; }, async purchase() { return { ok: false, cancelled: true }; },
  async precheck() { return { authorized: true, available: true }; }, async acknowledge() { return { ok: true }; },
  async getProducts() { return { ok: true, priceLabel: '690.00 руб.' }; } } }; })();`;
const MK_VAULT = `(async () => {
  for (let i=0;i<80;i++){ const sp=document.querySelector('#setupPw'); if (sp && sp.offsetParent) break; await new Promise(r=>setTimeout(r,150)); }
  const pw=document.querySelector('#setupPw'), pw2=document.querySelector('#setupPw2'); if(!pw) return 'nosetup';
  pw.value='layout-133 secret master'; pw.dispatchEvent(new Event('input',{bubbles:true}));
  pw2.value='layout-133 secret master'; pw2.dispatchEvent(new Event('input',{bubbles:true}));
  const ack=document.querySelector('#setupWarnAck'); if(ack && !ack.checked){ ack.checked=true; ack.dispatchEvent(new Event('change',{bubbles:true})); }
  const acc=document.querySelector('#setupAccept'); const row=document.querySelector('#setupAcceptRow'); if(acc && row && !row.hidden){ acc.checked=true; acc.dispatchEvent(new Event('change',{bubbles:true})); }
  document.querySelector('#setup').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
  for (let i=0;i<80;i++){ const sh=document.querySelector('#shell'); if (sh && !sh.classList.contains('hidden') && document.querySelector('#menuBtn')) break; await new Promise(r=>setTimeout(r,150)); }
  await new Promise(r=>setTimeout(r,400));
  for (const b of document.querySelectorAll('.modal-back')) { const btn = b.querySelector('.save, button:last-child'); if (btn) btn.click(); }
  await new Promise(r=>setTimeout(r,200));
  return 'created';
})()`;
const READ = `(async () => {
  document.querySelector('#menuBtn').click(); await new Promise(r=>setTimeout(r,200));
  document.querySelector('#mPro').click(); await new Promise(r=>setTimeout(r,700));
  const m = document.querySelector('.modal.paywall'); if (!m) return { err: 'нет окна' };
  const vis = (e) => !!(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const names = (sel) => [...m.querySelectorAll(sel + ' > button')].filter(vis).map((b) => b.textContent.trim());
  const key = m.querySelector('.pw-key'), tg = m.querySelector('.pw-keytg'), buy = m.querySelector('.pw-buy');
  const before = { main: names('.paywall-actions'), more: names('.pw-more'), keyVisible: vis(key), expanded: tg.getAttribute('aria-expanded'),
    buyBottom: Math.round(buy.getBoundingClientRect().bottom), vh: Math.min(innerHeight, Math.round(m.getBoundingClientRect().bottom)), scrollTop: m.scrollTop };
  tg.click(); await new Promise(r=>setTimeout(r,200));
  const opened = { keyVisible: vis(key), expanded: tg.getAttribute('aria-expanded') };
  tg.click(); await new Promise(r=>setTimeout(r,100));
  const closed = { keyVisible: vis(key), expanded: tg.getAttribute('aria-expanded') };
  return { before, opened, closed };
})()`;

test('DOM 360x640: «Восстановить» не в основном ряду, ключ скрыт до «Есть ключ», «Купить» без прокрутки', { skip: canDom ? false : 'нет Edge/puppeteer-core', timeout: 120000 }, async () => {
  const srv = await serveWww();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-pwlayout-'));
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, userDataDir: udd, args: ['--no-first-run', '--disable-gpu', '--no-default-browser-check', '--edge-skip-compat-layer-relaunch'] });
  const pid = browser.process() && browser.process().pid;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 1, isMobile: true });
    await page.evaluateOnNewDocument('window.SEYF_DEMO = false;');
    await page.goto(base, { waitUntil: 'load' });
    await page.evaluate(`try{localStorage.setItem('seyf_seed_banner_dismissed','1');localStorage.setItem('seyf_onboarded','1');}catch(e){}`);
    await page.evaluate(FAKE_PAY);
    assert.equal(await page.evaluate(MK_VAULT), 'created');
    const r = await page.evaluate(READ);
    assert.ok(!r.err, r.err);
    assert.equal(r.before.main.length, 2, 'в основном ряду две кнопки: ' + r.before.main.join(' | '));
    assert.equal(r.before.main[0], 'Закрыть');
    assert.match(r.before.main[1], /^Купить за /);
    assert.ok(!r.before.main.includes('Восстановить покупку'), '«Восстановить покупку» не в основном ряду');
    assert.deepEqual(r.before.more, ['Есть ключ', 'Восстановить покупку'], 'второстепенный ряд');
    assert.equal(r.before.keyVisible, false, 'поле ключа скрыто до «Есть ключ»');
    assert.equal(r.before.expanded, 'false');
    assert.equal(r.before.scrollTop, 0);
    assert.ok(r.before.buyBottom <= r.before.vh, `«Купить» видна без прокрутки: низ ${r.before.buyBottom} > ${r.before.vh}`);
    assert.equal(r.opened.keyVisible, true, '«Есть ключ» раскрывает поле');
    assert.equal(r.opened.expanded, 'true');
    assert.equal(r.closed.keyVisible, false, 'повторное нажатие сворачивает');
    assert.equal(r.closed.expanded, 'false');
  } finally {
    try { await browser.close(); } catch (e) {}
    if (pid && process.platform === 'win32') { try { execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' }); } catch (e) {} }
    srv.close();
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {}
  }
});
