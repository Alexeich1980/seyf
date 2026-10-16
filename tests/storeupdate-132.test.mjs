// storeupdate-132.test.mjs - 1.3.2 Э3: обновления стор-сборки через RuStore App Update SDK
// (www/storeupdate.js + update.js в сторе + нативный RuStoreUpdatePlugin), образец - «Карта года».
// Проверяет: решение по ответу плагина (есть новее / нет / причина сбоя -> честная строка на «вы»),
// неделю тихой проверки, флаг «есть новее» между запусками, что показывает окно в каждом состоянии,
// защиту от двойного тапа, запасной путь «Открыть RuStore», и что стор по-прежнему не делает ни
// одного fetch, а тест-сборка живёт на своём OTA-канале.
// Мутации (16.10.2026, каждая -> красный нужный тест): decide без проверки nv > cur; check ставит метку
// недели и при ошибке; view без ветки has (нет «Обновить»); launcher без защиты busy; update.js open()
// в сторе снова dlgStoreInfo; MainActivity без registerPlugin(RuStoreUpdatePlugin).
// Ревью 1.3.2 (16.10.2026, мутации -> красный): open() без сброса storeLast (старый статус, нет «Проверить»);
// view без 'check' в ветках error/none; weeklyCheck без метки / с меткой только при успехе (5 запусков = 5
// вызовов SDK); «Проверить» рядом с «Обновить» снова primary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

function mkStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
// таймеры без удержания процесса (launcher держит «Открываю RuStore…» до 30 с)
const softTimeout = (f, ms) => { const t = setTimeout(f, ms); if (t && t.unref) t.unref(); return t; };
function loadSU(ctx = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(read('www', 'storeupdate.js'), Object.assign({ module: mod, exports: mod.exports, setTimeout: softTimeout, clearTimeout }, ctx));
  return mod.exports;
}
// объекты из другого vm-контекста: сравниваем как данные
const plain = (x) => JSON.parse(JSON.stringify(x));
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------- чистая логика ----------------
test('decide: есть новее только когда RuStore сказал available и versionCode больше текущего', () => {
  const S = loadSU();
  assert.deepEqual(plain(S.decide({ ok: true, available: true, versionCode: 20607, currentVersionCode: 20605 })), { kind: 'store', versionCode: 20607 });
  assert.equal(S.decide({ ok: true, available: true, versionCode: 20605, currentVersionCode: 20605 }).kind, 'none', 'та же версия - не обновление');
  assert.equal(S.decide({ ok: true, available: true, versionCode: 20603, currentVersionCode: 20605 }).kind, 'none');
  assert.equal(S.decide({ ok: true, available: false, versionCode: 20607, currentVersionCode: 20605 }).kind, 'none');
  assert.equal(S.decide({ ok: true, available: true }).kind, 'store', 'номер неизвестен - верим RuStore');
});

test('decide: сбой - честная строка по причине, неизвестное - «не ответил»', () => {
  const S = loadSU();
  assert.equal(S.decide({ ok: false, reason: 'no-rustore' }).message, S.MSG_NO_RUSTORE);
  assert.match(S.decide({ ok: false, reason: 'unauthorized' }).message, /Войдите в RuStore/);
  assert.match(S.decide({ ok: false, reason: 'outdated' }).message, /Обновите RuStore/);
  assert.equal(S.decide({ ok: false, reason: 'что-то новое' }).message, S.MSG_FAIL);
  assert.equal(S.decide(null).kind, 'error');
  for (const m of Object.values(S.REASON_MSG).concat([S.MSG_NONE, S.MSG_HAS, S.MSG_IDLE, S.MSG_CHECKING, S.MSG_OPENING])) {
    assert.ok(!/—/.test(m), 'без длинного тире: ' + m);
  }
});

test('dueForCheck: раз в неделю; метка из будущего - пора', () => {
  const S = loadSU();
  const now = 1_000_000_000_000;
  assert.equal(S.dueForCheck(null, now), true);
  assert.equal(S.dueForCheck(now - S.WEEK_MS + 1000, now), false);
  assert.equal(S.dueForCheck(now - S.WEEK_MS, now), true);
  assert.equal(S.dueForCheck(now + 5000, now), true);
});

test('check (ручная): нашлась новее - флаг; сбой - без флага; метку недели не трогает', async () => {
  const S = loadSU();
  const st = mkStorage();
  const d = await S.check({ storage: st, now: 123, native: { checkUpdate: async () => ({ ok: true, available: true, versionCode: 20607, currentVersionCode: 20605 }) } });
  assert.equal(d.kind, 'store');
  assert.equal(S.getNewer(), 20607);
  assert.equal(st.getItem(S.K_NEWER), '20607');
  assert.equal(st.getItem(S.K_CHECK), null, 'ручная проверка без ограничений и метки');
  const st2 = mkStorage();
  const S2 = loadSU();
  const e = await S2.check({ storage: st2, now: 5, native: { checkUpdate: async () => ({ ok: false, reason: 'unauthorized' }) } });
  assert.equal(e.kind, 'error');
  assert.equal(st2.getItem(S2.K_CHECK), null);
  assert.equal(S2.getNewer(), 0);
  const e2 = await S2.check({ storage: st2, native: { checkUpdate: () => Promise.reject(new Error('мост')) } });
  assert.equal(e2.kind, 'error', 'исключение плагина - честная ошибка, не падение');
  const e3 = await S2.check({ storage: st2, native: null });
  assert.equal(e3.reason, 'no-rustore', 'нет плагина (браузер) - «нет RuStore», без сети');
});

test('check: RuStore завис - через таймаут честная ошибка', async () => {
  const S = loadSU();
  const d = await S.check({ storage: mkStorage(), timeout: 5, native: { checkUpdate: () => new Promise(() => {}) } });
  assert.equal(d.kind, 'error');
  assert.equal(d.message, S.MSG_FAIL);
});

test('флаг «есть новее»: без номера живёт до уточнения; после обновления гаснет', async () => {
  const S = loadSU();
  const st = mkStorage();
  await S.check({ storage: st, now: 1, native: { checkUpdate: async () => ({ ok: true, available: true }) } });
  assert.equal(S.getNewer(), S.UNKNOWN);
  assert.equal(loadSU().syncNewer(20605, { storage: st }), 'unknown');
  const st2 = mkStorage({ [S.K_NEWER]: '20607' });
  const S2 = loadSU();
  assert.equal(S2.syncNewer(20605, { storage: st2 }), 20607, 'ещё не обновились');
  assert.equal(S2.syncNewer(20607, { storage: st2 }), 0, 'поставили новую - точка гаснет');
  assert.equal(st2.getItem(S.K_NEWER), null);
});

test('weeklyCheck: чаще раза в неделю RuStore не спрашиваем', async () => {
  const S = loadSU();
  let calls = 0;
  const native = { checkUpdate: async () => { calls++; return { ok: true, available: false }; } };
  const st = mkStorage();
  const T0 = 1_800_000_000_000;
  await S.weeklyCheck({ storage: st, now: T0, native });
  assert.equal(calls, 1);
  assert.equal(await S.weeklyCheck({ storage: st, now: T0 + 1000, native }), null);
  assert.equal(calls, 1);
  await S.weeklyCheck({ storage: st, now: T0 + S.WEEK_MS, native });
  assert.equal(calls, 2);
});

test('view: что видит человек в каждом состоянии окна; «Проверить» есть всегда, кроме хода проверки/запуска', () => {
  const S = loadSU();
  assert.deepEqual(plain(S.view({})), { status: S.MSG_IDLE, buttons: ['close', 'check'] });
  assert.deepEqual(plain(S.view({ checking: true })), { status: S.MSG_CHECKING, buttons: ['close'] });
  assert.deepEqual(plain(S.view({ has: true })), { status: S.MSG_HAS, buttons: ['close', 'check', 'update'] });
  assert.deepEqual(plain(S.view({ last: { kind: 'none' } })), { status: S.MSG_NONE, buttons: ['close', 'check'] });
  assert.deepEqual(plain(S.view({ last: { kind: 'error', message: 'Войдите в RuStore, чтобы проверить обновления.' } })),
    { status: 'Войдите в RuStore, чтобы проверить обновления.', buttons: ['close', 'check', 'open'] });
  assert.deepEqual(plain(S.view({ has: true, launching: true })), { status: S.MSG_OPENING, buttons: ['close'] });
});

test('startUpdate / openStore: результат плагина; отказ или нет плагина - страница в браузере', async () => {
  const S = loadSU();
  const opened = [];
  const ext = (u) => opened.push(u);
  assert.deepEqual(plain(await S.startUpdate({ native: { startUpdate: async () => ({ ok: true, via: 'sdk', code: -1 }) } }, ext)), { ok: true, via: 'sdk', code: -1 });
  assert.equal(opened.length, 0);
  assert.equal((await S.startUpdate({ native: { startUpdate: async () => ({ ok: false }) } }, ext)).via, 'web');
  assert.equal((await S.openStore({ native: null }, ext)).via, 'web');
  assert.equal((await S.startUpdate({ native: { startUpdate: () => Promise.reject(new Error('x')) } }, ext)).via, 'web');
  assert.deepEqual(opened, [S.URL_RUSTORE, S.URL_RUSTORE, S.URL_RUSTORE]);
  assert.equal(S.URL_RUSTORE, 'https://www.rustore.ru/catalog/app/ru.dorokhin.seyf');
});

test('launcher: второй тап, пока RuStore открывается, ничего не делает', async () => {
  const S = loadSU();
  let calls = 0, release;
  const L = S.launcher(() => { calls++; return new Promise((r) => { release = r; }); }, { linger: 0 });
  const p = L.run('update');
  assert.ok(p);
  await flush();
  assert.equal(L.run('update'), null);
  assert.equal(L.busy(), true);
  release({ ok: true, via: 'store' });
  await p; await flush();
  assert.equal(L.busy(), false);
  assert.ok(L.run('update'));
  await flush();
  assert.equal(calls, 2);
});

// ---------------- update.js в сторе вместе со storeupdate.js ----------------
function mkWorld(flags = {}, native = null, { mount = true } = {}) {
  const dlgs = [];
  const fetchCalls = [];
  const fetch = (u) => { fetchCalls.push(String(u)); return Promise.reject(new Error('сеть в тесте')); };
  const doc = {
    addEventListener() {}, getElementById() { return null }, visibilityState: 'visible',
    querySelector: (sel) => (sel === '#updStore' && dlgs.some((d) => d.open && /id="updStore"/.test(d.body))) ? {} : null,
    querySelectorAll: (sel) => (sel === '#updStore' ? dlgs.filter((d) => d.open && /id="updStore"/.test(d.body)).map((d) => ({ closest: () => ({ remove: () => { d.open = false; } }) })) : []),
  };
  const win = Object.assign({
    localStorage: mkStorage(), fetch, document: doc, addEventListener() {},
    APP_VERSION: '1.3.2', SHELL_VERSION: '1.3.2', SHELL_BUILD: 20605,
    SeyfUI: { openDlg: (o) => dlgs.push(Object.assign({ open: true }, o)), esc: (s) => String(s), openExternal() {}, renderMenu() {} },
    NativePlugins: native ? { RuStoreUpdate: native } : null,
  }, flags);
  const ctx = { console, window: win, document: doc, fetch, localStorage: win.localStorage, setTimeout, clearTimeout, Promise, location: { reload() {} } };
  const m1 = { exports: {} };
  vm.runInNewContext(read('www', 'storeupdate.js'), Object.assign({}, ctx, { module: m1, exports: m1.exports, setTimeout: softTimeout }));
  win.StoreUpdate = m1.exports;
  const m2 = { exports: {} };
  vm.runInNewContext(read('www', 'update.js'), Object.assign({}, ctx, { module: m2, exports: m2.exports, setTimeout: () => 0 }));
  if (mount) {   // как app.js: SeyfUI задан, Update.mount(); неделя уже засчитана - тихая проверка молчит
    win.localStorage.setItem(win.StoreUpdate.K_CHECK, String(Date.now()));
    m2.exports.mount();
  }
  return { U: m2.exports, S: win.StoreUpdate, win, dlgs, fetchCalls };
}
const labels = (d) => d.buttons.map((b) => b.label).join('|');
const lastOpen = (dlgs) => dlgs.filter((d) => d.open).pop();

test('СТОР: «Обновление» -> «Проверить» -> RuStore нашёл новее -> «Обновить» запускает RuStore; ноль fetch', async () => {
  let checks = 0, starts = 0;
  const native = {
    checkUpdate: async () => { checks++; return { ok: true, available: true, versionCode: 20607, currentVersionCode: 20605 }; },
    startUpdate: async () => { starts++; return { ok: true, via: 'sdk', code: -1 }; },
  };
  const { U, dlgs, fetchCalls } = mkWorld({ SEYF_STORE: true }, native);
  U.open();
  let d = lastOpen(dlgs);
  assert.equal(labels(d), 'Закрыть|Проверить');
  assert.match(d.body, /Установлена версия 1\.3\.2/);
  d.buttons[1].onClick();                     // «Проверить»
  assert.match(lastOpen(dlgs).body, /Проверяю в RuStore/);
  await flush(); await flush();
  d = lastOpen(dlgs);
  assert.equal(checks, 1);
  assert.equal(labels(d), 'Закрыть|Проверить|Обновить');
  assert.equal(d.buttons[1].cls, 'neutral', '«Проверить» второстепенная рядом с «Обновить»');
  assert.equal(d.buttons[2].cls, 'primary');
  assert.match(d.body, /В RuStore есть новая версия/);
  assert.equal(U.newer(), 'RuStore', 'точка «есть обновление» в меню');
  assert.equal(dlgs.filter((x) => x.open).length, 1, 'одно окно, не стопка');
  d.buttons[2].onClick();                     // «Обновить»
  await flush();
  assert.equal(starts, 1);
  assert.deepEqual(fetchCalls, [], 'стор не ходит в свою сеть');
});

test('СТОР: нет обновлений - «У вас последняя версия»; RuStore не вошёл - причина и «Открыть RuStore»', async () => {
  const a = mkWorld({ SEYF_STORE: true }, { checkUpdate: async () => ({ ok: true, available: false, versionCode: 20605, currentVersionCode: 20605 }) });
  await a.U.check();
  await flush();
  let d = lastOpen(a.dlgs);
  assert.match(d.body, /У вас последняя версия/);
  assert.equal(labels(d), 'Закрыть|Проверить');
  assert.equal(a.U.newer(), '');
  const opened = [];
  const b = mkWorld({ SEYF_STORE: true }, { checkUpdate: async () => ({ ok: false, reason: 'unauthorized' }), openStore: async () => ({ ok: true, via: 'store' }) });
  b.win.SeyfUI.openExternal = (u) => opened.push(u);
  await b.U.check();
  await flush();
  d = lastOpen(b.dlgs);
  assert.match(d.body, /Войдите в RuStore/);
  assert.equal(labels(d), 'Закрыть|Проверить|Открыть RuStore');
  const c = mkWorld({ SEYF_STORE: true }, null);   // плагина нет (RuStore не установлен / браузер)
  await c.U.check();
  await flush();
  assert.match(lastOpen(c.dlgs).body, /на телефоне его нет/);
  assert.deepEqual([...a.fetchCalls, ...b.fetchCalls, ...c.fetchCalls], []);
});

test('СТОР: запуск - точка гаснет после обновления и тихая проверка раз в неделю', async () => {
  let checks = 0;
  const native = { checkUpdate: async () => { checks++; return { ok: true, available: true, versionCode: 20607, currentVersionCode: 20605 }; } };
  const w = mkWorld({ SEYF_STORE: true }, native, { mount: false });
  w.U.mount();
  await flush(); await flush(); await flush();
  assert.equal(checks, 1, 'первый запуск - спросили RuStore');
  assert.equal(w.U.newer(), 'RuStore');
  assert.equal(w.dlgs.length, 0, 'тихо, без окон');
  // повторный запуск уже на новой версии: флаг гаснет, неделя не прошла - RuStore не спрашиваем
  const w2 = mkWorld({ SEYF_STORE: true, SHELL_BUILD: 20607, localStorage: w.win.localStorage }, native, { mount: false });
  w2.U.mount();
  await flush(); await flush(); await flush();
  assert.equal(checks, 1);
  assert.equal(w2.U.newer(), '');
});

test('ТЕСТ-СБОРКА (не стор): окно и проверка - свой OTA-канал, RuStore SDK не зовётся', async () => {
  let checks = 0;
  const w = mkWorld({}, { checkUpdate: async () => { checks++; return { ok: true, available: true }; } });
  w.U.open();
  assert.equal(labels(lastOpen(w.dlgs)), 'Закрыть|Проверить');
  assert.doesNotMatch(lastOpen(w.dlgs).body, /RuStore/);
  await w.U.check();
  assert.equal(checks, 0);
  assert.ok(w.fetchCalls.length >= 1, 'тест-сборка проверяет свой канал');
});

test('СТОР (ревью 1.3.2, сценарий upd-stale): повторное открытие окна - без старого статуса и с «Проверить»', async () => {
  let reply = { ok: false, reason: 'unauthorized' }, checks = 0;
  const w = mkWorld({ SEYF_STORE: true }, { checkUpdate: async () => { checks++; return reply; }, openStore: async () => ({ ok: true, via: 'store' }) });
  w.U.open();
  let d = lastOpen(w.dlgs);
  assert.equal(labels(d), 'Закрыть|Проверить');
  d.buttons[1].onClick();                     // «Проверить» - не вошёл в RuStore
  await flush(); await flush();
  d = lastOpen(w.dlgs);
  assert.match(d.body, /Войдите в RuStore/);
  assert.equal(labels(d), 'Закрыть|Проверить|Открыть RuStore', '«Проверить» не пропадает и после ответа');
  d.open = false;                             // закрыл окно, вошёл в RuStore, вернулся
  reply = { ok: true, available: false, versionCode: 20605, currentVersionCode: 20605 };
  w.U.open();
  d = lastOpen(w.dlgs);
  assert.doesNotMatch(d.body, /Войдите в RuStore/, 'старый статус сброшен при открытии');
  assert.match(d.body, /раз в неделю/);
  assert.equal(labels(d), 'Закрыть|Проверить');
  d.buttons[1].onClick();
  await flush(); await flush();
  assert.equal(checks, 2);
  d = lastOpen(w.dlgs);
  assert.match(d.body, /У вас последняя версия/);
  assert.equal(labels(d), 'Закрыть|Проверить', 'проверить ещё раз можно всегда');
  d.buttons[1].onClick();
  await flush(); await flush();
  assert.equal(checks, 3, 'ручная проверка без ограничения по времени');
});

test('weeklyCheck (ревью 1.3.2, сценарий weekly): метка недели при ЛЮБОМ исходе - 5 запусков = 1 вызов SDK', async () => {
  const T0 = 1_800_000_000_000;
  const replies = {
    'не вошли': async () => ({ ok: false, reason: 'unauthorized' }),
    'ошибка SDK': () => Promise.reject(new Error('мост')),
    'есть без номера': async () => ({ ok: true, available: true, currentVersionCode: 20605 }),
    'нет обновлений': async () => ({ ok: true, available: false }),
    'мусор': async () => null,
  };
  for (const [name, fn] of Object.entries(replies)) {
    const S = loadSU();
    const st = mkStorage();
    let calls = 0;
    const native = { checkUpdate: () => { calls++; return fn(); } };
    for (let i = 0; i < 5; i++) await S.weeklyCheck({ storage: st, now: T0 + i * 60000, native });
    assert.equal(calls, 1, name + ': за 5 запусков (запирание сейфа = перезагрузка) RuStore спросили один раз');
    assert.equal(st.getItem(S.K_CHECK), String(T0), name + ': метка недели стоит');
    await S.weeklyCheck({ storage: st, now: T0 + S.WEEK_MS, native });
    assert.equal(calls, 2, name + ': через неделю - снова');
  }
  // тайм-аут (RuStore завис) - тоже метка
  const S = loadSU();
  const st = mkStorage();
  let calls = 0;
  const hang = { checkUpdate: () => { calls++; return new Promise(() => {}); } };
  for (let i = 0; i < 3; i++) await S.weeklyCheck({ storage: st, now: T0 + i, timeout: 5, native: hang });
  assert.equal(calls, 1, 'тайм-аут: один вызов');
  // «есть без номера» - точка в меню всё равно горит до следующей проверки
  const S2 = loadSU();
  await S2.weeklyCheck({ storage: mkStorage(), now: T0, native: { checkUpdate: async () => ({ ok: true, available: true }) } });
  assert.equal(S2.getNewer(), S2.UNKNOWN);
});

// ---------------- нативная часть и подключение ----------------
test('натив: плагин RuStoreUpdate зарегистрирован, SDK appupdate подключён, RuStore виден (queries)', () => {
  const ma = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'MainActivity.java');
  const iReg = ma.indexOf('registerPlugin(RuStoreUpdatePlugin.class)');
  assert.ok(iReg > 0 && iReg < ma.indexOf('super.onCreate('), 'регистрация до super.onCreate');
  const pl = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'RuStoreUpdatePlugin.java');
  assert.match(pl, /^package ru\.dorokhin\.seyf;/m);
  assert.match(pl, /@CapacitorPlugin\(name = "RuStoreUpdate"\)/);
  for (const m of ['checkUpdate', 'startUpdate', 'openStore']) assert.match(pl, new RegExp('public void ' + m + '\\('));
  assert.match(read('android', 'app', 'build.gradle'), /implementation 'ru\.rustore\.sdk:appupdate'/);
  assert.match(read('android', 'app', 'src', 'main', 'AndroidManifest.xml'), /<package android:name="ru\.vk\.store" \/>/);
  const nj = read('www', 'native.js');
  assert.match(nj, /RuStoreUpdate: C\.registerPlugin\('RuStoreUpdate'\)/);
  assert.match(nj, /window\.SHELL_BUILD = Math\.floor\(b\)/);
  const html = read('www', 'index.html');
  const a = html.indexOf('<script src="storeupdate.js">'), b = html.indexOf('<script src="update.js">');
  assert.ok(a > 0 && a < b, 'storeupdate.js грузится до update.js');
});
