// backlog-130.test.mjs - хвосты ревью 1.2.25 перед релизом 1.3.0 (docs/backlog-pre-release.md):
// M1 смена мастер-пароля (очередь записи до peek + диск сходится с памятью), M2 буфер (флаг с момента
// копирования, слепая очистка на холодном старте в окне), L1 checkGen (gen проверен только при успешном
// readdir), L2 общий загрузчик (второе полное чтение - только после 2 таймаутов подряд), L3 пробел как
// разделитель срока карты, L4 заслон прозрачных fixed-элементов, L5 Backspace после авто-нуля, Info
// нетронутый старый срок карты не переписывается. Поведенческие тесты: функции app.js (doChangeMaster,
// bindCaretMask) извлекаются из исходника и запускаются на фейках, остальное - чистые модули.
// Мутации (возврат бага) - в отчёте исполнителя; каждый пункт краснеет своим тестом ниже.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeStore, makeFsBackend } from '../www/js/storage.js';
import { makeSerialSaver, wrapOnDisk, withTimeout, saveErrorLabel, makeSharedLoader, STALE_TIMEOUTS } from '../www/js/persist.js';
import { createClipboardGuard, makeClipFlag, clearAfterReload, CLIP_FLAG_KEY, CLIP_BLIND_WINDOW_MS } from '../www/js/clipboard.js';
import { formatExpiryLive, normalizeExpiryInput, checkCardExpiry } from '../www/js/cardexp.js';
import { transparentFixedOffenders } from '../tools/css-overlay-guard.mjs';
import { endOnlyMask, reformatWithCaret } from '../www/js/fieldinput.js';
import * as Docs from '../www/js/documents.js';
import { validateMasterChange, masterStrength } from '../www/js/onboarding.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const APP = fs.readFileSync(path.join(ROOT, 'www', 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'www', 'css', 'app.css'), 'utf8');
const fnBody = (name) => {
  const i = APP.indexOf(name); assert.ok(i >= 0, 'нет ' + name);
  const j = APP.indexOf('\n}\n', i); assert.ok(j > i, 'конец функции ' + name + ' не найден');
  return APP.slice(i, j + 2);
};
const tick = () => new Promise((r) => setTimeout(r, 2));
const flush = async (n = 40) => { for (let i = 0; i < n; i++) await tick(); };

// ============================ M1: смена мастер-пароля ============================
// Фейковый Capacitor Filesystem: вызовы моста последовательны (один поток плагина).
function nativeFs({ failRename = null, lostRenameReply = false } = {}) {
  const files = new Map();
  let chain = Promise.resolve();
  const ctl = { files, failReadDat: 0, renameFails: failRename ? 1 : 0 };
  const run = (fn) => { const p = chain.then(async () => { await tick(); return fn(); }); chain = p.then(() => {}, () => {}); return p; };
  Object.assign(ctl, {
    readFile: ({ path: p }) => run(() => {
      if (p === 'vault.dat' && ctl.failReadDat > 0) { ctl.failReadDat--; throw new Error('Unable to read file'); }
      if (!files.has(p)) throw new Error('File does not exist'); return { data: files.get(p) };
    }),
    writeFile: ({ path: p, data }) => run(() => { files.set(p, data); }),
    appendFile: ({ path: p, data }) => run(() => { files.set(p, (files.get(p) || '') + data); }),
    rename: ({ from, to }) => run(() => {
      if (ctl.renameFails > 0 && to === 'vault.dat' && from === failRename) {
        ctl.renameFails--;
        if (lostRenameReply) { files.set(to, files.get(from)); files.delete(from); ctl.failReadDat = 1; throw new Error('bridge: reply lost'); }
        throw new Error('Unable to rename file');
      }
      if (!files.has(from)) throw new Error('does not exist'); files.set(to, files.get(from)); files.delete(from);
    }),
    deleteFile: ({ path: p }) => run(() => { files.delete(p); }),
    readdir: () => run(() => ({ files: [...files.keys()].map((name) => ({ name, mtime: 1 })) })),
    stat: ({ path: p }) => run(() => { if (!files.has(p)) throw new Error('File does not exist'); return { mtime: 1 }; }),
  });
  return ctl;
}
const OLD = { kdf: 'kdf-old', pwWrap: 'wrap-OLD' }, NEW = { kdf: 'kdf-new', pwWrap: 'wrap-NEW' };

// Настоящий doChangeMaster из app.js на фейках: store/serialSave - настоящие storage.js/persist.js.
function changeMasterHarness(fsOpts, { concurrentSave = false } = {}) {
  const f = nativeFs(fsOpts);
  f.files.set('vault.dat', JSON.stringify({ v: 1, ...OLD, data: 'd0' }));
  const realStore = makeStore(makeFsBackend(f), { watchdogMs: 0 });
  const state = { file: { v: 1, ...OLD, data: 'd0' }, dekRaw: 'k' };
  const serialSave = makeSerialSaver(async (setStage, alive, beat) => {
    setStage('reencrypt'); await tick(); await tick();
    state.file = { ...state.file, data: 'd1' };
    setStage('write'); await realStore.save(state.file, { onProgress: beat });
  }, { watchdogMs: 0 });
  const log = { toasts: [], alerts: [], saveFile: 0, hint: 0 };
  let first = true;
  const store = {
    save: (file, o) => {
      // Запись serialSave (прошлая правка / автоповтор) оказывается в той же очереди store сразу за нашей.
      if (first && concurrentSave) serialSave().catch(() => {});
      first = false;
      return realStore.save(file, o);
    },
    peek: () => realStore.peek(),
  };
  const prompts = ['cur-pass', 'new-pass-123', 'new-pass-123'];
  const deps = {
    requireRealVault: () => true,
    dlgPrompt: async () => prompts.shift(),
    dlgAlert: async (m) => { log.alerts.push(m); },
    dlgConfirm: async () => true,   // ревью 27.09: согласие на слабый пароль (правило создания)
    validateMasterChange, masterStrength,
    C: { unlockWithPassword: async () => true, rewrapPassword: async () => ({ ...NEW }) },
    state, store, withTimeout, serialSave, wrapOnDisk, saveErrorLabel,
    toast: (m) => { log.toasts.push(m); },
    editPasswordHint: async () => { log.hint++; },
    saveFile: () => { log.saveFile++; return serialSave(); },
  };
  const names = Object.keys(deps);
  const doChangeMaster = new Function(...names, fnBody('async function doChangeMaster()') + '\nreturn doChangeMaster;')(...names.map((n) => deps[n]));
  const disk = () => JSON.parse(f.files.get('vault.dat'));
  return { doChangeMaster, state, serialSave, log, disk };
}

test('M1 (proof-changemaster ревьюера): запись из очереди после упавшей - вердикт по диску ПОСЛЕ очереди', async () => {
  const h = changeMasterHarness({ failRename: 'vault.tmp.1' }, { concurrentSave: true });
  await h.doChangeMaster();
  await h.serialSave.settled(); await flush();
  const disk = h.disk();
  assert.equal(disk.pwWrap, 'wrap-NEW', 'сценарий: запись serialSave унесла новую обёртку на диск');
  assert.deepEqual(h.log.toasts, ['Мастер-пароль изменён'], 'было: «Мастер-пароль не изменён» при новой обёртке на диске');
  assert.equal(h.state.file.pwWrap, disk.pwWrap, 'память = диск');
  assert.equal(h.log.hint, 1, 'пароль изменён - предложена подсказка');
});

test('M1: ответ моста потерян, диск не прочитан (unknown) - откат в памяти И на диске (saveFile)', async () => {
  const h = changeMasterHarness({ failRename: 'vault.tmp.1', lostRenameReply: true });
  await h.doChangeMaster();
  assert.equal(h.log.alerts.length, 1, 'честное «не удалось проверить»');
  assert.match(h.log.alerts[0], /Не удалось проверить/);
  await h.serialSave.settled(); await flush();
  assert.equal(h.state.file.pwWrap, 'wrap-OLD', 'в памяти прежняя обёртка');
  assert.equal(h.disk().pwWrap, 'wrap-OLD', 'на диске тоже прежняя (было: новая на диске, старая в памяти)');
  assert.equal(h.log.saveFile, 1);
});

test('M1: запись не удалась, на диске прежняя обёртка (old) - «не изменён» + saveFile сводит диск с памятью', async () => {
  const h = changeMasterHarness({ failRename: 'vault.tmp.1' });
  await h.doChangeMaster();
  assert.equal(h.log.toasts.length, 1);
  assert.match(h.log.toasts[0], /^Мастер-пароль не изменён: не удалось записать/);
  assert.equal(h.log.saveFile, 1, 'после отката в памяти - запись на диск');
  await h.serialSave.settled(); await flush();
  assert.equal(h.disk().pwWrap, 'wrap-OLD');
  assert.equal(h.state.file.pwWrap, 'wrap-OLD');
});

test('M1 (заслон по тексту): очередь записи дожидается ДО peek; saveFile в ветках old и unknown', () => {
  const b = fnBody('async function doChangeMaster()');
  const drain = b.indexOf("await withTimeout(serialSave.settled(), 10000, 'drain');");
  const peek = b.indexOf('store.peek()');
  assert.ok(drain > 0 && drain < peek, 'serialSave.settled() - до store.peek()');
  assert.match(b, /try \{\s*await withTimeout\(serialSave\.settled\(\), 10000, 'drain'\);\s*onDisk = wrapOnDisk\(/, 'таймаут очереди - в том же try (-> unknown)');
  const oldBr = b.slice(b.indexOf("} else if (onDisk === 'old') {"), b.indexOf('} else {', b.indexOf("} else if (onDisk === 'old') {")));
  assert.match(oldBr, /state\.file = \{ \.\.\.state\.file, kdf: prev\.kdf, pwWrap: prev\.pwWrap \};\s*toast\([^\n]*\);\s*saveFile\(\)\.catch\(\(\) => \{\}\);/);
  const unk = b.slice(b.indexOf('} else {', b.indexOf("} else if (onDisk === 'old') {")));
  assert.match(unk, /state\.file = \{ \.\.\.state\.file, kdf: prev\.kdf, pwWrap: prev\.pwWrap \};\s*saveFile\(\)\.catch\(\(\) => \{\}\);/);
});

// ============================ M2: буфер после выгрузки процесса ============================
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; }
const focusOn = { hasFocus: () => true, addListener: () => {}, removeListener: () => {} };

test('M2 (proof-clip ревьюера): скопировали -> процесс выгружен до TTL -> холодный старт чистит буфер', async () => {
  const ls = memStorage(); let board = ''; let t = 1_000_000;
  const clipboard = { readText: async () => board, writeText: async (x) => { board = x; } };
  const g = createClipboardGuard({ clipboard, flag: makeClipFlag(ls), setTimer: () => 1, clearTimer: () => {}, now: () => t });
  await g.copy('S3cr3t-P@ss');
  assert.equal(makeClipFlag(ls).has(), true, 'флаг стоит с момента копирования (было: только после неудачной очистки)');
  assert.equal(ls.getItem(CLIP_FLAG_KEY), String(t), 'во флаге только время');
  assert.ok(![...ls._m.values()].some((v) => v.includes('S3cr3t')), 'секрета в хранилище нет');
  t += 5 * 60 * 1000;   // холодный старт через 5 минут
  const cleared = await clearAfterReload({ clipboard, flag: makeClipFlag(ls), ...focusOn, now: () => t });
  assert.equal(cleared, true);
  assert.equal(board, '', 'буфер очищен');
  assert.equal(makeClipFlag(ls).has(), false, 'флаг снят');
});

test('M2: флаг снимается только после успешной очистки или когда в буфере уже не наш секрет', async () => {
  const ls = memStorage(); let board = ''; let focused = true;
  const clipboard = {
    readText: async () => { if (!focused) throw new Error('Document is not focused'); return board; },
    writeText: async (x) => { if (!focused) throw new Error('Document is not focused'); board = x; },
  };
  const flag = makeClipFlag(ls);
  const g = createClipboardGuard({ clipboard, flag, setTimer: () => 1, clearTimer: () => {} });
  await g.copy('PIN-1');
  focused = false; assert.equal(await g.clearIfOurs(), false); assert.equal(flag.has(), true, 'неудача - флаг остаётся');
  focused = true; assert.equal(await g.retryIfFailed(), true); assert.equal(flag.has(), false, 'успех - снят');
  await g.copy('PIN-2'); assert.equal(flag.has(), true);
  board = 'своё'; assert.equal(await g.clearIfOurs(), false); assert.equal(flag.has(), false, 'в буфере чужое - снят, чужое не тронуто');
  assert.equal(board, 'своё');
});

test('M2: вне окна CLIP_BLIND_WINDOW_MS слепо не чистим (чужое не трогаем), флаг снимаем; флаг «1» (1.2.25) - чистим', async () => {
  assert.equal(CLIP_BLIND_WINDOW_MS, 60 * 60 * 1000);
  const ls = memStorage(); let board = 'своё скопированное позже';
  const clipboard = { readText: async () => board, writeText: async (x) => { board = x; } };
  makeClipFlag(ls).set(1000);
  assert.equal(await clearAfterReload({ clipboard, flag: makeClipFlag(ls), ...focusOn, now: () => 1000 + CLIP_BLIND_WINDOW_MS + 1 }), false);
  assert.equal(board, 'своё скопированное позже');
  assert.equal(makeClipFlag(ls).has(), false);
  makeClipFlag(ls).set();   // старый флаг без времени
  assert.equal(await clearAfterReload({ clipboard, flag: makeClipFlag(ls), ...focusOn, now: () => 9e12 }), true);
  assert.equal(board, '');
});

// ============================ L1: checkGen при сбое readdir ============================
test('L1 (proof-seq ревьюера): readdir упал при первой записи - новейший tmp не проигрывает старому остатку', async () => {
  let clock = 100;
  const files = new Map();
  const mkFs = ({ readdirFailFirst = false, crashRename = false } = {}) => {
    let rdFail = readdirFailFirst;
    return {
      readFile: async ({ path: p }) => { if (!files.has(p)) throw new Error('File does not exist'); return { data: files.get(p).data }; },
      stat: async ({ path: p }) => { if (!files.has(p)) throw new Error('File does not exist'); return { mtime: files.get(p).mtime }; },
      writeFile: async ({ path: p, data }) => { files.set(p, { data, mtime: ++clock }); },
      appendFile: async ({ path: p, data }) => { const o = files.get(p); files.set(p, { data: o.data + data, mtime: ++clock }); },
      rename: async ({ from, to }) => {
        if (crashRename && to === 'vault.dat') { files.delete('vault.dat'); return new Promise(() => {}); }
        files.set(to, files.get(from)); files.delete(from);
      },
      deleteFile: async ({ path: p }) => { files.delete(p); },
      readdir: async () => { if (rdFail) { rdFail = false; throw new Error('readdir failed'); } return { files: [...files.keys()].map((name) => ({ name, mtime: files.get(name).mtime })) }; },
    };
  };
  files.set('vault.dat', { data: JSON.stringify({ v: 1, ver: 'v7-old' }), mtime: ++clock });
  files.set('vault.tmp.7', { data: JSON.stringify({ v: 1, ver: 'v7-old' }), mtime: ++clock });
  const s1 = makeStore(makeFsBackend(mkFs({ readdirFailFirst: true, crashRename: true })), { watchdogMs: 0 });
  s1.save({ v: 1, ver: 'v9-NEWEST' });
  await flush(10);
  const s2 = makeStore(makeFsBackend(mkFs()), { watchdogMs: 0 });
  const loaded = await s2.load();
  await flush(10);
  assert.equal(loaded.ver, 'v9-NEWEST', 'было: поднят старый остаток v7-old, новейший tmp удалён');
  assert.equal(JSON.parse(files.get('vault.dat').data).ver, 'v9-NEWEST');
});

test('L1: после сбоя readdir следующая запись снова спрашивает папку (genChecked не взведён)', async () => {
  // Остаток vault.tmp.20 - вне проб 1..8; readdir падает и при выборе имени, и при уборке первой записи.
  const files = new Map([['vault.dat', '{"v":1}'], ['vault.tmp.20', '{"v":1,"old":true}']]); let rd = 0; const written = [];
  const f = {
    readFile: async ({ path: p }) => { if (!files.has(p)) throw new Error('File does not exist'); return { data: files.get(p) }; },
    stat: async ({ path: p }) => { if (!files.has(p)) throw new Error('File does not exist'); return { mtime: 1 }; },
    writeFile: async ({ path: p, data }) => { written.push(p); files.set(p, data); },
    appendFile: async ({ path: p, data }) => { files.set(p, files.get(p) + data); },
    rename: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); },
    deleteFile: async ({ path: p }) => { files.delete(p); },
    readdir: async () => { rd++; if (rd <= 2) throw new Error('readdir failed'); return { files: [...files.keys()].map((name) => ({ name })) }; },
  };
  const be = makeFsBackend(f);
  await be.write(JSON.stringify({ v: 1, n: 1 }));
  await be.write(JSON.stringify({ v: 1, n: 2 }));
  const second = Number(written[1].split('.').pop());
  assert.ok(second > 20, 'вторая запись выбрала имя выше остатка tmp.20 (папка прочитана заново), а не ' + written[1]);
});

// ============================ L2: «Повторить» не запускает второе чтение ============================
function fakeClock() {
  let t = 0; const timers = [];
  const setTimer = (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h; };
  const clearTimer = (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); };
  const advance = async (ms) => { const end = t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const h = timers[0]; if (!h || h.at > end) break; timers.shift(); t = h.at; h.fn(); await Promise.resolve(); } t = end; await new Promise((r) => setImmediate(r)); };
  return { setTimer, clearTimer, now: () => t, advance };
}
test('L2 (proof-stale ревьюера): одно долгое живое чтение без пульса - «Повторить» через минуту ждёт его, а не читает заново', async () => {
  assert.equal(STALE_TIMEOUTS, 2);
  const c = fakeClock(); let calls = 0; const resolvers = [];
  const loader = makeSharedLoader(() => { calls++; return new Promise((r) => resolvers.push(r)); }, c);
  const r1 = loader.wait(20000).catch((e) => e.code);
  await c.advance(20001);
  assert.equal(await r1, 'load-timeout');
  await c.advance(41000);                                 // окно «Не удалось открыть» висело минуту
  const r2 = loader.wait(20000);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1, 'было: 2 (второе полное чтение всего сейфа в очередь за первым)');
  resolvers[0]({ v: 1, tag: 'FIRST' });
  assert.equal((await r2).tag, 'FIRST', 'дождались того же чтения');
});
test('L2: навсегда повисшее чтение всё равно бросается - после 2 таймаутов подряд и 3x без пульса', async () => {
  const c = fakeClock(); let calls = 0; const resolvers = [];
  const loader = makeSharedLoader(() => { calls++; return new Promise((r) => resolvers.push(r)); }, c);
  const w1 = loader.wait(20000).catch((e) => e.code); await c.advance(20001); assert.equal(await w1, 'load-timeout');
  const w2 = loader.wait(20000).catch((e) => e.code); await c.advance(20001); assert.equal(await w2, 'load-timeout');
  await c.advance(21000);
  const w3 = loader.wait(20000);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2, 'два таймаута подряд + нет пульса > 3x - новое чтение');
  resolvers[1]({ v: 1, tag: 'FRESH' }); resolvers[0]({ v: 1, tag: 'STALE' });
  assert.equal((await w3).tag, 'FRESH');
});

// ============================ L3: пробел как разделитель срока карты ============================
test('L3: «1 29» -> 01/29, «1 2029» -> 01/29 (маска, blur и сохранение)', () => {
  const now = Date.UTC(2020, 0, 1);
  for (const [raw, want] of [['1 29', '01/29'], ['1 2029', '01/29'], ['9 2029', '09/29'], ['12 2029', '12/29'], ['12 29', '12/29'], [' 1  29 ', '01/29']]) {
    assert.equal(formatExpiryLive(raw), want, 'маска ' + JSON.stringify(raw));
    assert.equal(normalizeExpiryInput(raw), want, 'blur ' + JSON.stringify(raw));
    const r = checkCardExpiry(raw, '', now);
    assert.equal(r.ok, true, 'сохранение ' + JSON.stringify(raw));
    assert.equal(r.value, want);
  }
  assert.equal(formatExpiryLive('1 '), '01/', 'набор: пробел после месяца одной цифрой = разделитель');
  assert.equal(checkCardExpiry('1 3029', '', now).ok, false, 'год не 20ГГ - по-прежнему «проверьте срок»');
});

// ============================ L4: заслон прозрачных fixed-элементов ============================
test('L4 (guard-bypass ревьюера): контекст, класс-состояние, pointer-events:auto в скрытом, регистр - ловятся', () => {
  const g = transparentFixedOffenders;
  assert.ok(g('.t{position:fixed} body.locked .t{opacity:0}').length, 'скрытие по контексту');
  assert.ok(g('.t{position:fixed} .t-hidden{opacity:0}').length, 'отдельный класс-состояние');
  assert.ok(g('.t{position:fixed} .hidden{visibility:hidden}').length, 'утилита скрытия');
  assert.ok(g('.t{position:fixed} .t.h{OPACITY:0}').length, 'регистр свойства');
  assert.ok(g('.t{POSITION:FIXED} .t.h{opacity:0}').length, 'регистр position');
  assert.ok(g('.t{position:fixed;pointer-events:none} .t.hide{opacity:0;pointer-events:auto}').length, 'pe:auto в скрытом состоянии');
  assert.ok(g('#x{position:fixed;opacity:0;pointer-events:none} #x.busy{pointer-events:auto}').length, 'касания включены, видимость не возвращена');
  assert.ok(g('.t{position:fixed} body.x .t:not(.show){opacity:0}').length);
});
test('L4: без ложных срабатываний; реальный app.css зелёный', () => {
  const g = transparentFixedOffenders;
  assert.deepEqual(g('.t{position:fixed} .t::before{opacity:0}'), [], 'псевдоэлемент - другой бокс');
  assert.deepEqual(g('.t{position:fixed} .t .child{opacity:0}'), [], 'потомок');
  assert.deepEqual(g('.t{position:fixed} .t-inner{opacity:0}'), [], 'класс с префиксом, но не состояние');
  assert.deepEqual(g('.t{position:fixed} body.locked .t{opacity:0;pointer-events:none}'), []);
  assert.deepEqual(g('#x{position:fixed;opacity:0;pointer-events:none} #x.show{opacity:1;pointer-events:auto}'), [], 'показ с касаниями - норма');
  assert.deepEqual(g('.t{position:fixed;pointer-events:none} body.x .t{opacity:0}'), [], 'none базы действует');
  assert.deepEqual(g(CSS), []);
});

// ============================ L5: Backspace сразу после авто-нуля ============================
// Набор как на телефоне: '\b' - Backspace в конце; memo - как в bindCaretMask (на поле).
const typeSeq = (seq, F) => {
  const memo = { auto: null }; let v = '';
  for (const ch of seq) {
    const del = ch === '\b';
    const raw = del ? v.slice(0, -1) : v + ch;
    v = endOnlyMask(raw, raw.length, F, { inputType: del ? 'deleteContentBackward' : 'insertText', memo }).value;
  }
  return v;
};
test('L5 (fuzz-dates ревьюера): «1.» <- убирает и дописанный ноль; набор после этого не склеивается с нулём', () => {
  const F = Docs.formatDocDateLive;
  assert.equal(typeSeq('1.\b', F), '1', 'было «01»');
  assert.equal(typeSeq('1.\b2', F), '12', 'было «01.2»');
  assert.equal(typeSeq('1.\b\b12', F), '12', 'было «01.2»');
  assert.equal(typeSeq('1.3.\b', F), '01.3', 'авто-ноль месяца уходит вместе с точкой');
  assert.equal(typeSeq('01.\b', F), '01', 'ноль набран руками - остаётся');
  assert.equal(typeSeq('01.03.\b\b', F), '01.0', 'без авто-нуля - как раньше');
  assert.equal(typeSeq('1/\b', formatExpiryLive), '1', 'срок карты: «1/» -> «01/» <- -> «1»');
  // уже покрытое тестами поведение набора не изменилось
  for (const [typed, want] of [['1.3.98', '01.03.98'], ['01031998', '01.03.1998'], ['1/3/98', '01.03.98'], ['12.03.2029.', '12.03.2029']]) assert.equal(typeSeq(typed, F), want);
  assert.equal(endOnlyMask('01', 2, F).value, '01', 'без memo (старые вызовы) - как было');
});

// bindCaretMask из app.js на фейковом поле ввода (без DOM).
function fakeInput(value) {
  const ls = {};
  const inp = {
    value, selectionStart: value.length, selectionEnd: value.length,
    addEventListener: (t, fn) => { (ls[t] = ls[t] || []).push(fn); },
    setSelectionRange: (a, b) => { inp.selectionStart = a; inp.selectionEnd = b; },
    fire: (t, e = {}) => { for (const fn of ls[t] || []) fn(e); },
    type(ch) { this.value += ch; this.selectionStart = this.selectionEnd = this.value.length; this.fire('input', { inputType: 'insertText' }); },
    back() { this.value = this.value.slice(0, -1); this.selectionStart = this.selectionEnd = this.value.length; this.fire('input', { inputType: 'deleteContentBackward' }); },
  };
  return inp;
}
const bindCaretMask = new Function('endOnlyMask', 'reformatWithCaret', 'document', fnBody('function bindCaretMask(') + '\nreturn bindCaretMask;')(endOnlyMask, reformatWithCaret, { activeElement: null });

test('L5: bindCaretMask передаёт inputType и memo - Backspace после «01.» даёт «1» в живом поле', () => {
  const inp = fakeInput('');
  bindCaretMask(inp, Docs.formatDocDateLive, { endOnly: true, normalize: Docs.normalizeExpiryDateInput });
  inp.type('1'); inp.type('.');
  assert.equal(inp.value, '01.');
  inp.back();
  assert.equal(inp.value, '1');
  inp.type('2');
  assert.equal(inp.value, '12');
});

// ============================ Info: нетронутый старый срок карты ============================
test('Info: редактор не переписывает старый срок при открытии; blur без правки не трогает; сохранение - исходное значение', () => {
  const i0 = APP.indexOf("if (section === 'cards') {\n    // Срок ММ/ГГ");
  const ed = APP.slice(i0, APP.indexOf('const rowOf = (key) =>', i0));
  assert.ok(ed.length > 0);
  assert.ok(!/exp\.value = formatExpiry\(exp\.value\)/.test(ed), 'при открытии поле не форматируется');
  assert.match(ed, /bindCaretMask\(exp, formatExpiryLive, \{[^}]*\}, endOnly: true, normalize: normalizeExpiryInput, onlyEdited: true \}\)/);
  // поведение поля: фокус/уход без правки - значение как было; после правки - формат на blur
  for (const old of ['1/29', '12/2029', '2029-12', '1229', '12.29', '12 / 29']) {
    const inp = fakeInput(old); let dirty = false;
    bindCaretMask(inp, formatExpiryLive, { onInput: () => { dirty = true; }, endOnly: true, normalize: normalizeExpiryInput, onlyEdited: true });
    inp.fire('blur');
    assert.equal(inp.value, old, 'blur без правки: ' + old);
    assert.equal(dirty, false, 'dirty не взводится без правки');
    const r = checkCardExpiry(inp.value, old, Date.UTC(2020, 0, 1));
    assert.deepEqual([r.ok, r.value, r.untouched], [true, old, true], 'сохранение без правки оставляет «' + old + '» (было: 12/9, 12/20, 20/29...)');
  }
  const inp = fakeInput('1/29'); let dirty = false;
  bindCaretMask(inp, formatExpiryLive, { onInput: () => { dirty = true; }, endOnly: true, normalize: normalizeExpiryInput, onlyEdited: true });
  inp.back(); inp.type('9');                                // правка: стёр и вернул ту же цифру
  inp.fire('blur');
  assert.equal(inp.value, '01/29', 'после правки - канонический вид');
  assert.equal(dirty, true);
  assert.equal(checkCardExpiry('13/29', '1/29').ok, false, 'правленое - проверяется');
});
