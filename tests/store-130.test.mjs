// store-130.test.mjs - сторовая сборка «Сейфа» 1.3.0 (выпуск в RuStore, по образцу «Хомяка»).
// Решения Алексея: в сторе свой OTA-канал выключен ЦЕЛИКОМ (update.js в сеть не ходит,
// boot.js не откатывается на скачанные веб-сборки), «Обновление» честно говорит про RuStore;
// в пейволле поле ключа без ссылок «где купить»; релиз/стор вшивают FULL=false, DEMO=false.
// Мутации (проверены scratchpad/mutate-store.mjs): убрать isStore()-заслон в fetchManifest/check,
// store-ветку в boot.decide, строку STORE в flagsSource, проверку STORE в verifyApk, добавить
// ссылку в пейволл - каждый раз краснеет соответствующий тест ниже.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../build-lib.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WWW = path.join(ROOT, 'www');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// ---------- песочница браузера для UMD update.js / boot.js ----------
function mkStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}
function fetchSpy() {
  const calls = [];
  const f = (url) => { calls.push(String(url)); return Promise.reject(new Error('сеть в тесте')); };
  f.calls = calls;
  return f;
}
function loadUpdate(win) {
  const code = read('www', 'update.js');
  const mod = { exports: {} };
  const noTimer = () => 0;
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, console, window: win, document: win.document,
    fetch: win.fetch, setTimeout: noTimer, clearTimeout: () => {}, location: { reload() {} },
  });
  return mod.exports;
}
function mkWin(flags = {}) {
  const dlgs = [];
  const spy = fetchSpy();
  const doc = { addEventListener() {}, getElementById() { return null; }, visibilityState: 'visible' };
  const win = Object.assign({
    localStorage: mkStorage(), fetch: spy, document: doc, addEventListener() {},
    APP_VERSION: '1.3.0', SHELL_VERSION: '1.3.0',
    SeyfUI: { openDlg: (o) => dlgs.push(o), esc: (s) => String(s), openExternal() {}, renderMenu() {} },
  }, flags);
  return { win, dlgs, spy };
}
const WEB = { version: '9.9.9', url: 'https://dorokhin-finance.ru/seyf-store/www-9.9.9.zip', sha256: 'a'.repeat(64), size: 10, minShell: '1.0.0' };

// ============================ update.js: стор в сеть не ходит ============================
test('update.js СТОР: check/silentCheck/fetchManifest/fetchBundle/apply не делают НИ ОДНОГО fetch', async () => {
  const { win, spy } = mkWin({ SEYF_STORE: true });
  const U = loadUpdate(win);
  assert.equal(U.isStore(), true);
  U.mount();                                   // weeklyCheck внутри mount - тоже без сети
  assert.equal(await U.check({ fetch: spy }), null);
  assert.equal(await U.silentCheck({ fetch: spy }), null);
  await assert.rejects(U.fetchManifest({ fetch: spy }), (e) => e.message === U.ERR.store);
  await assert.rejects(U.fetchBundle(WEB, { fetch: spy }), (e) => e.message === U.ERR.store);
  const plugCalls = [];
  const P = new Proxy({}, { get: (t, k) => { plugCalls.push(String(k)); return () => Promise.resolve({}); } });
  assert.equal(await U.apply(Object.assign({ signed: {} }, WEB), { fetch: spy, plugins: { Filesystem: P, WebView: P } }), false);
  assert.deepEqual(spy.calls, [], 'стор-сборка не должна ходить в сеть: ' + spy.calls.join(', '));
  assert.deepEqual(plugCalls, [], 'apply в сторе не трогает Filesystem/WebView');
});

// Заслоны на входе (а не только глубже, в fetchManifest/fetchBundle): стор не запускает даже
// конвейер проверки (ожидание оболочки) и не показывает окно «Обновляю» (мутации 1.3.0).
test('update.js СТОР: silentCheck не запускает проверку, apply не открывает окно хода работ', async () => {
  const { win, dlgs, spy } = mkWin({ SEYF_STORE: true });
  let shellReads = 0;
  Object.defineProperty(win, 'SHELL_VERSION', { get() { shellReads++; return '1.3.0'; } });
  const U = loadUpdate(win);
  U.mount();
  shellReads = 0;
  assert.equal(await U.silentCheck({ fetch: spy }), null);
  assert.equal(shellReads, 0, 'silentCheck в сторе даже не ждёт номер оболочки');
  dlgs.length = 0;
  assert.equal(await U.apply(Object.assign({ signed: {} }, WEB), { fetch: spy, plugins: { Filesystem: {}, WebView: {} } }), false);
  assert.equal(dlgs.length, 0, 'apply в сторе не открывает окон');
  // контроль: без стора apply открывает окно хода работ (тест умеет краснеть)
  const c = mkWin({});
  const U2 = loadUpdate(c.win); U2.mount(); c.dlgs.length = 0;
  await U2.apply(Object.assign({ signed: {} }, WEB), { fetch: c.spy, plugins: { Filesystem: {}, WebView: {} }, saves: { pending: () => false } });
  assert.ok(c.dlgs.length >= 1);
});

test('update.js КОНТРОЛЬ: без SEYF_STORE та же проверка ходит в сеть (тест умеет краснеть)', async () => {
  const { win, spy } = mkWin({});
  const U = loadUpdate(win);
  assert.equal(U.isStore(), false);
  U.mount();
  await U.check({ fetch: spy });
  assert.ok(spy.calls.length >= 1, 'обычная сборка обращается к каналу');
});

test('update.js СТОР: «Обновление» честно говорит про RuStore, без «Проверить»/«Скачать»', () => {
  const { win, dlgs } = mkWin({ SEYF_STORE: true });
  const U = loadUpdate(win);
  U.mount();
  U.open();
  assert.equal(dlgs.length, 1);
  const d = dlgs[0];
  assert.match(d.body, /обновляется только через него/);
  assert.match(d.body, /в интернет не ходит/);
  const labels = d.buttons.map((b) => b.label);
  assert.equal(labels.join('|'), 'Понятно|Открыть в RuStore');
  assert.ok(!/Проверить|Скачать|Обновить/.test(labels.join(' ')));
  assert.ok(!/—/.test(d.body), 'без длинного тире');
  assert.ok(!/\b(обновись|нажми|открой)\b/i.test(d.body), 'на «вы»');
});

// Ревью 1.3.0, п.5: стор ставит печать, ota/base и карту сборок НЕ строит, а остатки прежнего
// OTA-канала (ota/*) тихо сносит - только когда WebView на встроенных ассетах.
function storePlugins(basePath, { rmdirFails = false, baseFails = false } = {}) {
  const calls = [];
  const F = new Proxy({}, { get: (t, k) => (o) => { calls.push(['F.' + String(k), o]); return (k === 'rmdir' && rmdirFails) ? Promise.reject(new Error('нет папки')) : Promise.resolve({}); } });
  const W = new Proxy({}, { get: (t, k) => (o) => { calls.push(['W.' + String(k), o]); if (k === 'getServerBasePath') return baseFails ? Promise.reject(new Error('мост')) : Promise.resolve({ path: basePath }); return Promise.resolve({}); } });
  return { calls, F, W };
}
test('update.js СТОР: confirmBoot ставит печать; на ассетах только rmdir ota (без ota/base, state.json, fetch)', async () => {
  const { win, spy } = mkWin({ SEYF_STORE: true, isNativeApp: () => true });
  const p = storePlugins('public');
  win.NativePlugins = { Filesystem: p.F, WebView: p.W };
  const U = loadUpdate(win);
  win.localStorage.setItem('seyf-ota-try', '{"version":"1.3.0","boots":1}');
  assert.equal(await U.confirmBoot(), true);
  assert.equal(win.localStorage.getItem('seyf-ota-ok'), '1.3.0');
  assert.equal(win.localStorage.getItem('seyf-ota-try'), null);
  assert.deepEqual(p.calls.map((c) => c[0]), ['W.getServerBasePath', 'F.rmdir']);
  assert.equal(JSON.stringify(p.calls[1][1]), JSON.stringify({ directory: 'DATA', path: 'ota', recursive: true }));
  assert.deepEqual(spy.calls, []);
});
test('update.js СТОР: WebView на OTA-папке или путь не прочитался - ota не трогаем; ошибки молча', async () => {
  for (const [base, opt] of [['/data/user/0/ru.dorokhin.seyf/files/ota/1.2.25', {}], ['public', { baseFails: true }]]) {
    const { win } = mkWin({ SEYF_STORE: true, isNativeApp: () => true });
    const p = storePlugins(base, opt);
    win.NativePlugins = { Filesystem: p.F, WebView: p.W };
    const U = loadUpdate(win);
    assert.equal(await U.confirmBoot(), true);
    assert.ok(!p.calls.some((c) => c[0] === 'F.rmdir'), 'rmdir не звали: ' + base);
  }
  const { win } = mkWin({ SEYF_STORE: true, isNativeApp: () => true });
  const p = storePlugins('public', { rmdirFails: true });
  win.NativePlugins = { Filesystem: p.F, WebView: p.W };
  assert.equal(await loadUpdate(win).confirmBoot(), true, 'нет папки ota - не ошибка');
  const w2 = mkWin({ SEYF_STORE: true, isNativeApp: () => true }).win;
  w2.NativePlugins = {};
  assert.equal(await loadUpdate(w2).confirmBoot(), true, 'нет плагинов - не ошибка');
});

test('update.js: isStore строго от SEYF_STORE === true (строка/1 не включают стор)', () => {
  for (const v of ['true', 1, 'yes', {}]) assert.equal(loadUpdate(mkWin({ SEYF_STORE: v }).win).isStore(), false, String(v));
  assert.equal(loadUpdate(mkWin({ Access: { STORE: true } }).win).isStore(), true, 'запасной источник Access.STORE');
});

// ============================ boot.js: стор не откатывается ============================
function loadBoot() {
  const code = read('www', 'boot.js');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, console });
  return mod.exports;
}
function runBoot(win) {
  const code = read('www', 'boot.js');
  // браузерная ветка UMD: module нет → root.Boot = factory(); root.Boot.run()
  const ctx = { window: win, console };
  ctx.self = ctx;
  vm.runInNewContext(code, ctx);
  return ctx;
}
test('boot.js decide: стор при метке попытки (boots>=1) - clear, а не revert', () => {
  const B = loadBoot();
  const get = (k) => (k === B.K_TRY ? JSON.stringify({ version: '1.3.0', boots: 1 }) : null);
  assert.equal(B.decide(get, '1.3.0', false).action, 'revert', 'контроль: обычная сборка откатывается');
  assert.equal(B.decide(get, '1.3.0', true).action, 'clear');
  assert.equal(B.decide(() => null, '1.3.0', true).action, 'none');
});

test('boot.js run(): стор не пишет провал и не трогает WebView даже при «не завелась»', () => {
  const mark = JSON.stringify({ version: '1.3.0', boots: 1, sha256: 'x' });
  const mk = (store) => {
    const reg = [];
    const win = {
      APP_VERSION: '1.3.0', localStorage: mkStorage({ 'seyf-ota-try': mark }),
      Capacitor: { isNativePlatform: () => true, registerPlugin: (n) => { reg.push(n); return new Proxy({}, { get: () => () => new Promise(() => {}) }); } },
    };
    if (store) win.SEYF_STORE = true;
    runBoot(win);
    return { win, reg };
  };
  const s = mk(true);
  assert.equal(s.win.localStorage.getItem('seyf-ota-try'), null, 'метка снята');
  assert.equal(s.win.localStorage.getItem('seyf-ota-fail'), null, 'провал не записан');
  assert.deepEqual(s.reg, [], 'плагины WebView/Filesystem не запрошены');
  const c = mk(false);
  assert.ok(c.reg.includes('WebView'), 'контроль: обычная сборка откатывается через WebView');
  assert.ok(c.win.localStorage.getItem('seyf-ota-fail'));
});

test('index.html: buildflags.js грузится ДО boot.js и update.js (флаг стора готов к их запуску)', () => {
  const html = read('www', 'index.html');
  const iF = html.indexOf('src="buildflags.js"'), iB = html.indexOf('src="boot.js"'), iU = html.indexOf('src="update.js"');
  assert.ok(iF > 0 && iF < iB && iF < iU);
});

// ============================ access.js: DEMO / STORE ============================
test('access.js: без флагов DEMO=true, STORE=false; сборочные флаги их выключают/включают', async () => {
  const a0 = await import('../www/js/access.js?store130=0');
  assert.equal(a0.DEMO, true);
  assert.equal(a0.STORE, false);
  const prev = globalThis.window;
  globalThis.window = { SEYF_FULL_ACCESS: false, SEYF_DEMO: false, SEYF_STORE: true };
  try {
    const a1 = await import('../www/js/access.js?store130=1');
    assert.equal(a1.DEMO, false);
    assert.equal(a1.STORE, true);
    assert.equal(a1.FULL, false);
  } finally { globalThis.window = prev; }
  globalThis.window = { SEYF_STORE: 'true' };
  try { assert.equal((await import('../www/js/access.js?store130=2')).STORE, false, 'строго === true'); }
  finally { globalThis.window = prev; }
});

test('app.js: демо первого запуска - только если сборка его не выключила (Demo.DEMO_ENABLED && Access.DEMO)', () => {
  assert.match(read('www', 'js', 'app.js'), /decideStart\(\{ hasVault, demoEnabled: Demo\.DEMO_ENABLED && Access\.DEMO, corrupt \}\)/);
});

// ============================ пейволл: ключ без ссылок ============================
function paywallSrc() {
  const APP = read('www', 'js', 'app.js');
  const i = APP.indexOf('function openPaywall(');
  const j = APP.indexOf('\n}\n', i);
  assert.ok(i > 0 && j > i);
  return APP.slice(i, j);
}
test('пейволл: поле ключа как в «Хомяке» - тексты на месте', () => {
  const s = paywallSrc();
  assert.ok(s.includes('Уже есть ключ? Активируйте его'));
  assert.ok(s.includes('Лицензионный ключ приобретается отдельно, вне приложения.'));
  assert.ok(s.includes('class="pw-key"') && s.includes('pw-activate'), 'только поле и кнопка');
});
test('пейволл: НИКАКИХ ссылок и контактов «где купить»', () => {
  const s = paywallSrc();
  const bad = [/href\s*=/i, /https?:\/\//i, /mailto:/i, /t\.me/i, /tel:/i, /openExternal/, /data-url/, /telegram|whatsapp|почт[аеу]|e-mail|сайт/i, /[\w.-]+@[\w-]+\.[a-z]{2,}/i, /напишите|обратитесь|свяжитесь|купить ключ/i];
  const hits = bad.filter((re) => re.test(s)).map(String);
  assert.deepEqual(hits, [], 'в пейволле найдено: ' + hits.join(', '));
});

// ============================ build-lib: режимы и флаги ============================
test('flagsSource: тест / релиз / стор', () => {
  const t = L.flagsSource({}), r = L.flagsSource({ release: true }), s = L.flagsSource({ store: true });
  assert.match(t, /window\.SEYF_FULL_ACCESS = true;/); assert.ok(!/SEYF_DEMO|SEYF_STORE/.test(t));
  assert.match(r, /window\.SEYF_FULL_ACCESS = false;/); assert.match(r, /window\.SEYF_DEMO = false;/); assert.ok(!/SEYF_STORE/.test(r));
  assert.match(s, /window\.SEYF_FULL_ACCESS = false;/); assert.match(s, /window\.SEYF_DEMO = false;/); assert.match(s, /window\.SEYF_STORE = true;/);
});
test('buildMode: --store подразумевает релиз; env SEYF_STORE/SEYF_RELEASE', () => {
  assert.deepEqual(L.buildMode({}, []), { release: false, store: false });
  assert.deepEqual(L.buildMode({}, ['--release']), { release: true, store: false });
  assert.deepEqual(L.buildMode({}, ['--store']), { release: true, store: true });
  assert.deepEqual(L.buildMode({ SEYF_STORE: '1' }, []), { release: true, store: true });
  assert.deepEqual(L.buildMode({ SEYF_STORE: '0', SEYF_RELEASE: 'false' }, []), { release: false, store: false });
});

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-ship-')); }
test('makeShip --store: флаги, демо выкл, CSP connect-src none; рабочая www/ НЕ тронута', () => {
  const flagsBefore = read('www', 'buildflags.js'), demoBefore = read('www', 'js', 'demo.js'), idxBefore = read('www', 'index.html');
  const ship = path.join(tmp(), 'www-ship');
  const files = L.makeShip(WWW, ship, { release: true, store: true }, '1.3.0');
  const f = fs.readFileSync(path.join(ship, 'buildflags.js'), 'utf8');
  assert.match(f, /SEYF_FULL_ACCESS = false;/); assert.match(f, /SEYF_DEMO = false;/); assert.match(f, /SEYF_STORE = true;/);
  assert.ok(fs.readFileSync(path.join(ship, 'js', 'demo.js'), 'utf8').includes(L.DEMO_MARK_OFF));
  const idx = fs.readFileSync(path.join(ship, 'index.html'), 'utf8');
  const csp = L.cspOf(idx);
  assert.ok(csp.includes("connect-src 'none'") && !/https?:/.test(csp), 'в CSP стора нет ни одного внешнего адреса');
  assert.ok(!files.some((n) => n.includes('_orig') || n.split('/').some((p) => p.startsWith('.'))), 'без _orig и dot-файлов');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ship, 'files.json'), 'utf8')).version, '1.3.0');
  assert.equal(read('www', 'buildflags.js'), flagsBefore);
  assert.equal(read('www', 'js', 'demo.js'), demoBefore);
  assert.equal(read('www', 'index.html'), idxBefore);
  assert.match(flagsBefore, /SEYF_FULL_ACCESS\s*=\s*false\s*;/, 'рабочая копия buildflags.js = false');
  assert.ok(!/SEYF_STORE|SEYF_DEMO/.test(flagsBefore), 'рабочая копия не несёт стор/демо-флагов');
});
test('makeShip --release: без STORE, CSP канала не закрыт; тест-сборка: FULL=true, демо включено', () => {
  const r = path.join(tmp(), 'r'); L.makeShip(WWW, r, { release: true }, '1.3.0');
  assert.ok(!/SEYF_STORE/.test(fs.readFileSync(path.join(r, 'buildflags.js'), 'utf8')));
  assert.ok(L.cspOf(fs.readFileSync(path.join(r, 'index.html'), 'utf8')).includes(L.CSP_CONNECT_OTA));
  const t = path.join(tmp(), 't'); L.makeShip(WWW, t, {}, '1.3.0');
  assert.match(fs.readFileSync(path.join(t, 'buildflags.js'), 'utf8'), /SEYF_FULL_ACCESS = true;/);
  assert.ok(fs.readFileSync(path.join(t, 'js', 'demo.js'), 'utf8').includes(L.DEMO_MARK_ON));
});
test('ИНТЕГРАЦИЯ: buildflags.js сторовой копии + update.js этой копии → isStore и ноль сети', async () => {
  const ship = path.join(tmp(), 's'); L.makeShip(WWW, ship, { store: true }, '1.3.0');
  const { win, spy } = mkWin({});
  vm.runInNewContext(fs.readFileSync(path.join(ship, 'buildflags.js'), 'utf8'), { window: win });
  const code = fs.readFileSync(path.join(ship, 'update.js'), 'utf8');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, console, window: win, fetch: spy, setTimeout: () => 0, clearTimeout() {} });
  const U = mod.exports;
  assert.equal(U.isStore(), true);
  assert.equal(await U.check({ fetch: spy }), null);
  assert.deepEqual(spy.calls, []);
});
test('stampDemoOff / shipCsp: нет маркера - сборка падает, а не молчит', () => {
  assert.throws(() => L.stampDemoOff('export const DEMO_ENABLED = maybe;'), /некуда выключить демо/);
  assert.equal(L.stampDemoOff(L.DEMO_MARK_OFF), L.DEMO_MARK_OFF, 'уже выключено - идемпотентно');
  assert.throws(() => L.shipCsp('<meta content="default-src \'self\'">'), /ровно один мета-тег CSP/);
  assert.throws(() => L.shipCsp(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`), /некуда закрыть сеть/);
});

// ============================ console_app_id ============================
test('app-id: разбор аргумента, валидность, боевой id в репозитории синхронен в двух местах', () => {
  assert.equal(L.parseAppIdArg(['--store', '--app-id=2063760325'], {}), '2063760325');
  assert.equal(L.parseAppIdArg(['--app-id', '123'], {}), '123');
  assert.equal(L.parseAppIdArg([], { SEYF_APP_ID: '777' }), '777');
  assert.equal(L.parseAppIdArg([], {}), null);
  assert.equal(L.validAppId('2063760325'), true);
  for (const bad of ['', '12', 'abc123', '12 34', null]) assert.equal(L.validAppId(bad), false, String(bad));
  const st = L.readAppIdFiles(path.join(WWW, 'js', 'pay-config.js'), path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'));
  assert.equal(st.synced, true);
  assert.equal(st.id, '2063760405', 'боевой id из Консоли RuStore в обоих местах');
});
test('app-id: stampAppIdFiles пишет один id в pay-config.js и strings.xml (копии), мусор - отказ', () => {
  const d = tmp();
  const js = path.join(d, 'pay-config.js'), xml = path.join(d, 'strings.xml');
  fs.copyFileSync(path.join(WWW, 'js', 'pay-config.js'), js);
  fs.copyFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'), xml);
  const st = L.stampAppIdFiles(js, xml, '2063760325');
  assert.deepEqual([st.js, st.xml, st.synced, st.placeholder, st.id], ['2063760325', '2063760325', true, false, '2063760325']);
  assert.match(fs.readFileSync(js, 'utf8'), /export const CONSOLE_APP_ID = '2063760325';/);
  assert.throws(() => L.stampAppIdFiles(js, xml, 'abc'), /только из цифр/);
  // RuStorePayPlugin читает именно rustore_console_app_id и бракует заглушку по префиксу «РАЗМЕСТИТЬ»
  const plug = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'RuStorePayPlugin.java');
  assert.ok(plug.includes('"rustore_console_app_id"') && plug.includes('startsWith("РАЗМЕСТИТЬ")'));
  assert.ok(L.APP_ID_PLACEHOLDER.startsWith('РАЗМЕСТИТЬ'));
});

// ============================ verifyApk: самопроверка готового файла ============================
function loadFflate() {
  const code = read('www', 'vendor', 'fflate.min.js');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, self: {}, globalThis, console });
  return mod.exports;
}
function fakeApk(mode, over = {}) {
  const ff = loadFflate();
  const ship = path.join(tmp(), 'w'); L.makeShip(WWW, ship, mode, '1.3.0');
  const id = L.readAppIdJs(read('www', 'js', 'pay-config.js'));
  const bag = { 'resources.arsc': new Uint8Array(Buffer.from('xx' + id + 'yy', 'utf16le')) };
  for (const n of ['buildflags.js', 'index.html', 'js/demo.js', 'js/pay-config.js']) {
    bag['assets/public/' + n] = new Uint8Array(fs.readFileSync(path.join(ship, n)));
  }
  for (const [k, v] of Object.entries(over)) bag['assets/public/' + k] = new Uint8Array(Buffer.from(v));
  return Buffer.from(ff.zipSync(bag));
}
test('verifyApk: правильный сторовый APK проходит; каждая подмена ловится', () => {
  const opts = { release: true, store: true, appId: L.readAppIdJs(read('www', 'js', 'pay-config.js')) };
  const ok = L.verifyApk(fakeApk({ store: true }), opts, WWW);
  assert.equal(ok.flags.join(' '), 'window.SEYF_FULL_ACCESS = false; window.SEYF_DEMO = false; window.SEYF_STORE = true;');
  assert.equal(ok.arscEnc, 'utf16le');
  const bad = (over, re) => assert.throws(() => L.verifyApk(fakeApk({ store: true }, over), opts, WWW), re);
  bad({ 'buildflags.js': 'window.SEYF_FULL_ACCESS = false;\nwindow.SEYF_DEMO = false;\n' }, /SEYF_STORE = true/);
  bad({ 'buildflags.js': 'window.SEYF_FULL_ACCESS = true;\nwindow.SEYF_DEMO = false;\nwindow.SEYF_STORE = true;\n' }, /FULL_ACCESS = false/);
  bad({ 'js/demo.js': L.DEMO_MARK_ON }, /демо не выключено/);
  bad({ 'index.html': `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src https://dorokhin-finance.ru">` }, /CSP не закрыт/);
  bad({ 'index.html': `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'none' https://evil.example">` }, /CSP не закрыт/);
  bad({ 'js/pay-config.js': "export const CONSOLE_APP_ID = '999999';" }, /ожидался/);
  assert.throws(() => L.verifyApk(fakeApk({ release: true }), opts, WWW), /SEYF_STORE = true/, 'релиз вместо стора');
});

// ============================ build-apk.js: исходник ============================
test('build-apk.js: режимы как в «Хомяке», флаги только в копию, самопроверка, стор-флаг Gradle', () => {
  const s = read('build-apk.js');
  assert.match(s, /L\.buildMode\(process\.env, ARGV\)/);
  assert.match(s, /L\.makeShip\(WWW, WWW_SHIP, MODE, version\)/);
  assert.ok(!/writeFileSync\([^)]*buildflags/.test(s), 'build-apk.js не пишет www/buildflags.js');
  assert.match(s, /'-PseyfStore=' \+ \(MODE\.store \? 'true' : 'false'\)/);
  assert.match(s, /L\.verifyApk\(/);
  assert.match(s, /L\.stampAppIdFiles\(PAY_CONFIG, STRINGS_XML, APP_ID_ARG\)/);
  assert.match(s, /ЧЕРНОВИК/);
  assert.match(s, /if \(RELEASE && !hasKey\) \{\s*die\(/, 'релиз без ключа - отказ');
  assert.ok(/cfg\.webDir = 'build\/www-ship'/.test(s) && /restoreCfg\(\)/.test(s));
});

// ============================ Android: релизная безопасность ============================
test('MainActivity: Autofill исключён, FLAG_SECURE и выкл. WebView-отладка в релизе, стор забывает OTA-путь', () => {
  const s = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'MainActivity.java');
  assert.match(s, /setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS\)/);
  assert.match(s, /if \(!debuggable\) \{\s*getWindow\(\)\.setFlags\(WindowManager\.LayoutParams\.FLAG_SECURE/);
  assert.match(s, /setWebContentsDebuggingEnabled\(false\)/);
  assert.match(s, /"seyf_store", "bool"/);
  assert.match(s, /remove\(com\.getcapacitor\.plugin\.WebView\.CAP_SERVER_PATH\)/);
  const iStore = s.indexOf('isStoreBuild()) {'), iSuper = s.indexOf('super.onCreate(');
  assert.ok(iStore > 0 && iStore < iSuper, 'путь забывается ДО super.onCreate (Bridge читает его там)');
});
test('build.gradle: release debuggable false, подпись keys/seyf.properties, resValue seyf_store', () => {
  const g = read('android', 'app', 'build.gradle');
  assert.match(g, /release \{\s*(\/\/[^\n]*\n\s*)*debuggable false/);
  assert.match(g, /resValue "bool", "seyf_store", \(project\.findProperty\('seyfStore'\) == 'true'\)/);
  assert.match(g, /rootProject\.file\('\.\.\/keys\/seyf\.properties'\)/);
  assert.match(g, /enableV2Signing true/); assert.match(g, /enableV3Signing true/);
});
test('RuStore Pay с боевым id: клиент берётся getInstance() ДО provide() (иначе RuStorePayClientAlreadyExist)', () => {
  const p = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'RuStorePayPlugin.java');
  const i = p.indexOf('static RuStorePayClient clientFor(');
  const body = p.slice(i, p.indexOf('\n    }\n', i));
  const iGet = body.indexOf('RuStorePayClient.Companion.getInstance()'), iProv = body.indexOf('.provide(');
  assert.ok(i > 0 && iGet > 0 && iProv > iGet, 'сначала getInstance, потом provide');
  assert.ok(!/private RuStorePayClient client\(\) \{[^}]*\.provide\(/.test(p), 'client() не зовёт provide() напрямую');
});
test('RuStore Pay: одна схема deeplink в плагине, meta-data sdk_pay_scheme_value и intent-filter; MainActivity отдаёт интент SDK', () => {
  const p = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'RuStorePayPlugin.java');
  const man = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const ma = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'MainActivity.java');
  const scheme = (p.match(/PAY_SCHEME = "([^"]+)"/) || [])[1];
  assert.equal(scheme, 'ru.dorokhin.seyf.rustore');
  assert.match(man, new RegExp('android:name="sdk_pay_scheme_value"\\s+android:value="' + scheme.replace(/\./g, '\\.') + '"'));
  assert.match(man, new RegExp('<data android:scheme="' + scheme.replace(/\./g, '\\.') + '" />'));
  assert.match(man, /android:name="console_app_id_value"\s+android:value="@string\/rustore_console_app_id"/, 'id только через ресурс');
  assert.match(ma, /RuStorePayPlugin\.proceedIntent\(getApplicationContext\(\), getIntent\(\)\)/);
  assert.match(ma, /protected void onNewIntent\(Intent intent\) \{\s*super\.onNewIntent\(intent\);\s*RuStorePayPlugin\.proceedIntent/);
});
// Урок 1.3.0 (повтор класса 1.2.25): правка Python в текстовом режиме на Windows молча пишет CRLF.
// Заслон расширен на все файлы, тронутые подготовкой к RuStore (fnBody/regex-заслоны ждут LF).
test('файлы подготовки к RuStore - только LF', () => {
  const files = ['www/update.js', 'www/boot.js', 'www/js/access.js', 'www/js/app.js', 'www/css/app.css', 'build-lib.js', 'build-apk.js',
    'serve.js', 'tools/qa-corrupt-boot.mjs', 'tests/store-130.test.mjs', 'tests/freemium-gate.test.mjs', 'android/app/build.gradle',
    'android/app/src/main/AndroidManifest.xml', 'android/app/src/main/java/ru/dorokhin/seyf/MainActivity.java',
    'android/app/src/main/java/ru/dorokhin/seyf/RuStorePayPlugin.java', 'CHANGELOG.md', 'www/js/pay-config.js',
    'android/app/src/main/res/values/strings.xml']
    // публичный репозиторий: внутренние serve.js и tools/qa-corrupt-boot.mjs могут отсутствовать
    .filter((f) => !['serve.js', 'tools/qa-corrupt-boot.mjs'].includes(f) || fs.existsSync(path.join(ROOT, f)));
  const bad = files.filter((f) => read(f).includes('\r\n'));
  assert.deepEqual(bad, [], 'CRLF в: ' + bad.join(', ') + ' (Python на Windows: open(..., newline=""))');
});
test('keys/ в .gitignore (ключ подписи и пароль не попадают в git)', () => {
  assert.match(read('.gitignore'), /^keys\/$/m);
});
// 1.3.1: версия пошла дальше 1.3.0 - заслон держит, что раздел 1.3.0 (выпуск в RuStore) на месте,
// выше 1.2.25 и про RuStore, а верхний раздел CHANGELOG совпадает с версией package.json.
test('раздел 1.3.0 в CHANGELOG (про RuStore), верхний раздел = версия package.json, без «—»', () => {
  const ver = JSON.parse(read('package.json')).version;
  const log = read('CHANGELOG.md');
  const top = L.topNotes(path.join(ROOT, 'CHANGELOG.md'));
  assert.match(log, /^## 1\.3\.0/m);
  assert.ok(log.indexOf('## 1.3.0') < log.indexOf('## 1.2.25'));
  const firstHead = (log.match(/^## (\d+\.\d+\.\d+)/m) || [])[1];
  assert.equal(firstHead, ver, 'верхний раздел CHANGELOG должен совпадать с версией package.json');
  const s130 = log.slice(log.indexOf('## 1.3.0'), log.indexOf('## 1.2.25'));
  assert.match(s130, /RuStore/);
  assert.ok(top.length > 0 && !top.includes('—'));
});
