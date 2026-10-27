// promo-133.test.mjs - акция «Полная версия» 690 ₽ вместо 990 ₽ до 31.12.2026 включительно
// (решение Алексея 22.10.2026). Логика - www/js/gate.js (promoActive, priceView, priceDisplay),
// разбор цены магазина - pay.js priceRub, показ - app.js (окно «Полная версия», меню).
// Часть 1 - чистые функции (граница дат по ЛОКАЛЬНОМУ времени: 31.12 23:59 - акция, 01.01 00:00 - нет).
// Часть 2 - настоящий DOM: окно открывается в headless Edge с подставным RuStorePay и подменённой
// датой; проверяем, что «990 ₽» реально зачёркнуто (computed text-decoration), «690 ₽» и срок
// видны в акцию, а после 31.12 слова «акция» в окне нет. Нет Edge - часть 2 пропускается.
// Заслон: число «690» в www только в gate.js (одно место; цену магазин отдаёт сам).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as G from '../www/js/gate.js';
import { priceRub, formatPrice } from '../www/js/pay.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const NB = '\u00a0';
const local = (y, mo, d, h = 12, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms);

test('promoActive: до 31.12.2026 включительно по локальной дате', () => {
  assert.equal(G.promoActive(local(2026, 10, 22)), true, 'день выхода 1.3.3');
  assert.equal(G.promoActive(local(2026, 12, 31, 0, 0)), true, '31.12 00:00');
  assert.equal(G.promoActive(local(2026, 12, 31, 23, 59, 59, 999)), true, '31.12 23:59:59 - ещё акция');
  assert.equal(G.promoActive(local(2027, 1, 1, 0, 0, 0, 0)), false, '01.01 00:00 - уже нет');
  assert.equal(G.promoActive(local(2027, 6, 1)), false);
  assert.equal(G.promoActive(local(2027, 12, 31)), false, 'через год 31.12 - не акция (год учтён)');
  assert.equal(G.promoActive(local(2026, 1, 15)), true, 'раньше конца - акция');
  assert.equal(G.promoActive(new Date(NaN)), false, 'битая дата - без акции');
  assert.equal(G.promoActive(local(2026, 12, 31).getTime()), true, 'число-время тоже понимает');
});

test('priceView: цена магазина 690 / 990 / нет, в акцию и после', () => {
  const IN = local(2026, 11, 15), OUT = local(2027, 1, 2);
  assert.deepEqual(G.priceView(690, IN), { price: 690, old: 990, promo: true });
  assert.deepEqual(G.priceView(990, IN), { price: 990, old: null, promo: false }, 'магазин ещё 990 - без акции');
  assert.deepEqual(G.priceView(null, IN), { price: 690, old: 990, promo: true }, 'нет цены магазина в акцию - 690 с пометкой');
  assert.deepEqual(G.priceView(690, OUT), { price: 690, old: null, promo: false }, 'после 31.12 акции нет, даже если в магазине 690');
  assert.deepEqual(G.priceView(990, OUT), { price: 990, old: null, promo: false });
  assert.deepEqual(G.priceView(null, OUT), { price: 990, old: null, promo: false }, 'нет цены магазина после - 990');
  assert.deepEqual(G.priceView(NaN, OUT), { price: 990, old: null, promo: false });
  assert.deepEqual(G.priceView(0, IN), { price: 690, old: 990, promo: true }, '0 - как нет цены');
  assert.deepEqual(G.priceView(1290, IN), { price: 1290, old: null, promo: false }, 'дороже обычной - не акция');
  // граница
  assert.equal(G.priceView(690, local(2026, 12, 31, 23, 59)).promo, true);
  assert.equal(G.priceView(690, local(2027, 1, 1, 0, 0)).promo, false);
  assert.equal(G.priceView(null, local(2027, 1, 1, 0, 0)).price, 990);
});

test('priceDisplay и подписи: «990 ₽» неразрывно, «Акция до 31 декабря», без «акции» после', () => {
  const IN = local(2026, 11, 15), OUT = local(2027, 1, 2);
  assert.equal(G.rub(990), '990' + NB + '₽');
  assert.equal(G.rub(1290), '1' + NB + '290' + NB + '₽');
  assert.equal(G.promoNote(), 'Акция до 31' + NB + 'декабря');
  assert.deepEqual(G.priceDisplay(690, formatPrice('690.00 руб.'), IN), { now: '690' + NB + '₽', old: '990' + NB + '₽', note: 'Акция до 31' + NB + 'декабря' });
  assert.deepEqual(G.priceDisplay(null, null, IN), { now: '690' + NB + '₽', old: '990' + NB + '₽', note: 'Акция до 31' + NB + 'декабря' });
  assert.deepEqual(G.priceDisplay(690, '690' + NB + '₽', OUT), { now: '690' + NB + '₽', old: null, note: null });
  assert.deepEqual(G.priceDisplay(null, null, OUT), { now: '990' + NB + '₽', old: null, note: null });
  assert.deepEqual(G.priceDisplay(990, '990' + NB + '₽', IN), { now: '990' + NB + '₽', old: null, note: null });
  assert.deepEqual(G.priceDisplay(690.5, formatPrice('690.50 руб.'), IN).now, '690,50' + NB + '₽', 'цена магазина как есть, с копейками');
  assert.deepEqual(G.priceDisplay(null, '5 USD', IN), { now: '5 USD', old: null, note: null }, 'чужая валюта - как пришла, без акции');
  // текст акции спокойный: на «вы»-нейтрально, без длинного тире и призывов
  for (const t of [G.promoNote()]) {
    assert.doesNotMatch(t, /—|Успей|!|только сейчас/i);
  }
});

test('priceRub: строка магазина числом', () => {
  assert.equal(priceRub('690.00 руб.'), 690);
  assert.equal(priceRub('990 ₽'), 990);
  assert.equal(priceRub('1 290,50 ₽'), 1290.5);
  assert.equal(priceRub('1\u00a0290 руб.'), 1290);
  assert.equal(priceRub('5 USD'), null);
  assert.equal(priceRub(''), null);
  assert.equal(priceRub(null), null);
  assert.equal(priceRub('0 руб.'), null);
});

test('заслон: «690» в www только в gate.js; app.js берёт цену через priceDisplay', () => {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); continue; }
      if (!/\.(js|html|css|json)$/.test(e.name)) continue;
      if (path.relative(WWW, p).replace(/\\/g, '/') === 'js/gate.js') continue;
      if (/690/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(WWW, p));
    }
  };
  walk(WWW);
  assert.deepEqual(hits, [], 'цена акции вне gate.js: ' + hits.join(', '));
  const APP = fs.readFileSync(path.join(WWW, 'js', 'app.js'), 'utf8');
  assert.match(APP, /function priceShow\(\) \{ return Gate\.priceDisplay\(storeRub, storePrice\); \}/);
  assert.match(APP, /storeRub = priceRub\(label\)/);
  assert.match(APP, /<div class="pw-price-slot">\$\{pricePromoHtml\(priceShow\(\)\)\}<\/div>/, 'блок цены в окне сразу');
  assert.match(APP, /querySelector\('\.pw-price-slot'\)\.innerHTML = pricePromoHtml\(priceShow\(\)\)/, 'и после ответа магазина');
  assert.match(APP, /pro\.innerHTML = priceMenuHtml\(priceShow\(\)\)/, 'меню «Купить за …» через ту же цену');
  assert.doesNotMatch(APP, /PRO_PRICE_RUB \+/, 'своя цена без акции в обход priceDisplay');
});

// ---------- часть 2: настоящий DOM в headless Edge ----------
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

// Дата в странице: Date/Date.now сдвинуты на заданный ЛОКАЛЬНЫЙ момент (часы идут дальше).
const DATE_SHIM = (y, mo, d, h, mi) => `(() => { const R = Date; const off = new R(${y}, ${mo - 1}, ${d}, ${h}, ${mi}).getTime() - R.now();
  class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } }
  window.Date = D; })();`;
// Подставной RuStorePay: цена магазина priceLabel (null - магазин цену не отдал)
const FAKE_PAY = (label) => `(() => { window.isNativeApp = () => true; window.NativePlugins = { RuStorePay: {
  async getPurchases() { return { owned: false }; }, async purchase() { return { ok: false, cancelled: true }; },
  async precheck() { return { authorized: true, available: true }; }, async acknowledge() { return { ok: true }; },
  async getProducts() { return ${label ? `{ ok: true, priceLabel: ${JSON.stringify(label)} }` : `{ ok: false }`}; } } }; })();`;
const MK_VAULT = `(async () => {
  for (let i=0;i<80;i++){ const sp=document.querySelector('#setupPw'); if (sp && sp.offsetParent) break; await new Promise(r=>setTimeout(r,150)); }
  const pw=document.querySelector('#setupPw'), pw2=document.querySelector('#setupPw2'); if(!pw) return 'nosetup';
  pw.value='promo-133 secret master'; pw.dispatchEvent(new Event('input',{bubbles:true}));
  pw2.value='promo-133 secret master'; pw2.dispatchEvent(new Event('input',{bubbles:true}));
  const ack=document.querySelector('#setupWarnAck'); if(ack && !ack.checked){ ack.checked=true; ack.dispatchEvent(new Event('change',{bubbles:true})); }
  const acc=document.querySelector('#setupAccept'); const row=document.querySelector('#setupAcceptRow'); if(acc && row && !row.hidden){ acc.checked=true; acc.dispatchEvent(new Event('change',{bubbles:true})); }
  document.querySelector('#setup').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
  for (let i=0;i<80;i++){ const sh=document.querySelector('#shell'); if (sh && !sh.classList.contains('hidden') && document.querySelector('#menuBtn')) break; await new Promise(r=>setTimeout(r,150)); }
  await new Promise(r=>setTimeout(r,400));
  for (const b of document.querySelectorAll('.modal-back')) { const btn = b.querySelector('.save, button:last-child'); if (btn) btn.click(); }
  await new Promise(r=>setTimeout(r,200));
  return 'created';
})()`;
// Окно «Полная версия» из меню; что видит человек: блок цены, зачёркнутость, кнопка, строка меню
const OPEN_AND_READ = `(async () => {
  document.querySelector('#menuBtn').click(); await new Promise(r=>setTimeout(r,200));
  document.querySelector('#mPro').click(); await new Promise(r=>setTimeout(r,700));
  const m = document.querySelector('.modal.paywall'); if (!m) return { err: 'нет окна' };
  const old = m.querySelector('.pw-price-old'), now = m.querySelector('.pw-price-now'), note = m.querySelector('.pw-price-note');
  const vis = (e) => !!(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const h3 = m.querySelector('h3').getBoundingClientRect();
  const menuInfo = document.querySelector('#mProInfo');
  return {
    old: old && old.textContent, oldVisible: vis(old), oldStrike: old ? getComputedStyle(old).textDecorationLine : null,
    now: now && now.textContent, nowVisible: vis(now), nowStrike: now ? getComputedStyle(now).textDecorationLine : null,
    note: note && note.textContent, noteVisible: vis(note),
    buy: m.querySelector('.pw-buy').textContent,
    text: m.innerText,
    scrollTop: m.scrollTop, h3InView: h3.top >= 0 && h3.bottom <= innerHeight,
    priceInView: old ? old.getBoundingClientRect().bottom <= innerHeight : null,
    menuHtml: menuInfo && menuInfo.innerHTML,
  };
})()`;

async function scenario(browser, base, { date, label }) {
  const ctx = await browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 1, isMobile: true });
    await page.evaluateOnNewDocument('window.SEYF_DEMO = false;' + DATE_SHIM(...date));
    await page.goto(base, { waitUntil: 'load' });
    await page.evaluate(`try{localStorage.setItem('seyf_seed_banner_dismissed','1');localStorage.setItem('seyf_onboarded','1');}catch(e){}`);
    await page.evaluate(FAKE_PAY(label));
    assert.equal(await page.evaluate(MK_VAULT), 'created', 'сейф создан');
    return await page.evaluate(OPEN_AND_READ);
  } finally { await ctx.close(); }
}

test('DOM: окно «Полная версия» в акцию и после (headless Edge, подмена даты)', { skip: canDom ? false : 'нет Edge/puppeteer-core', timeout: 180000 }, async () => {
  const srv = await serveWww();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-promo-'));
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, userDataDir: udd, args: ['--no-first-run', '--disable-gpu', '--no-default-browser-check', '--edge-skip-compat-layer-relaunch'] });
  const pid = browser.process() && browser.process().pid;
  const P690 = '690' + NB + '₽', P990 = '990' + NB + '₽';
  try {
    // 1) акция, магазин 690: 990 зачёркнуто, 690 и срок видны; окно с начала
    const a = await scenario(browser, base, { date: [2026, 11, 15, 12, 0], label: '690.00 руб.' });
    assert.equal(a.old, P990); assert.equal(a.oldVisible, true);
    assert.match(a.oldStrike, /line-through/, '«990 ₽» реально зачёркнуто');
    assert.equal(a.now, P690); assert.equal(a.nowVisible, true);
    assert.doesNotMatch(a.nowStrike, /line-through/, 'новая цена не зачёркнута');
    assert.equal(a.note, 'Акция до 31' + NB + 'декабря'); assert.equal(a.noteVisible, true);
    assert.equal(a.buy, 'Купить за ' + P690);
    assert.equal(a.scrollTop, 0, 'окно открыто с начала'); assert.equal(a.h3InView, true); assert.equal(a.priceInView, true, 'цена акции видна без прокрутки');
    assert.match(a.menuHtml, /^Купить за <s>990(?:&nbsp;| )₽<\/s> 690(?:&nbsp;| )₽$/, 'меню: обычная зачёркнута');
    // 2) последние минуты акции 31.12 (23:50), магазина нет (офлайн): по дате - 690 с пометкой
    const b = await scenario(browser, base, { date: [2026, 12, 31, 23, 50], label: null });
    assert.equal(b.old, P990); assert.match(b.oldStrike, /line-through/);
    assert.equal(b.now, P690); assert.equal(b.buy, 'Купить за ' + P690);
    // 3) после акции, в магазине ещё 690 (Алексей не успел вернуть): без слова «акция», без зачёркнутого
    const c = await scenario(browser, base, { date: [2027, 1, 1, 0, 1], label: '690.00 руб.' });
    assert.equal(c.old, null); assert.equal(c.note, null);
    assert.doesNotMatch(c.text, /акци/i, 'после 31.12 слова «акция» нет');
    assert.equal(c.buy, 'Купить за ' + P690);
    assert.doesNotMatch(c.menuHtml, /<s>/);
    // 4) после акции, магазина нет: 990, без акции
    const d = await scenario(browser, base, { date: [2027, 1, 2, 12, 0], label: null });
    assert.equal(d.old, null); assert.doesNotMatch(d.text, /акци/i); assert.equal(d.buy, 'Купить за ' + P990);
    // 5) акция по дате, но магазин отдаёт 990 (цену ещё не снизили): обычный вид, честно 990
    const e = await scenario(browser, base, { date: [2026, 11, 15, 12, 0], label: '990.00 руб.' });
    assert.equal(e.old, null); assert.doesNotMatch(e.text, /акци/i); assert.equal(e.buy, 'Купить за ' + P990);
  } finally {
    try { await browser.close(); } catch (e) {}
    // сироты headless Edge: добиваем дерево процессов по PID (память headless-edge-orphans-relaunch-flag)
    if (pid && process.platform === 'win32') { try { execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' }); } catch (e) {} }
    srv.close();
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {}
  }
});
