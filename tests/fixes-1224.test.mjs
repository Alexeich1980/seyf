// fixes-1224.test.mjs - заслоны 1.2.24: живой тест Алексея (0a «Сохранить ничего не делает», 0b правка
// даты в середине на Gboard) + пункты 1-11 второго адверсариального ревью 1.2.23 (пруф-скрипты
// ревьюера review2/*.mjs: там СТАРОЕ поведение было наблюдаемым, здесь - требуемое НОВОЕ).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeStore, makeFsBackend, parseVault, newestFirst } from '../www/js/storage.js';
import { makeSerialSaver, drainWithRetry, withIdleTimeout, makeSharedLoader, retryDelayMs } from '../www/js/persist.js';
import { createClipboardGuard, makeClipFlag, waitForFocus, clearAfterReload } from '../www/js/clipboard.js';
import { endOnlyMask, endOnlyMaskField, formatCardNumber } from '../www/js/fieldinput.js';
import { formatExpiryLive, parseExpiry, expiryPassed } from '../www/js/cardexp.js';
import * as Docs from '../www/js/documents.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const APP = fs.readFileSync(path.join(ROOT, 'www', 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'www', 'css', 'app.css'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const fnBody = (name) => { const i = APP.indexOf(name); assert.ok(i >= 0, 'нет ' + name); return APP.slice(i, APP.indexOf('\n}\n', i)); };

// ============================ 0a: невидимый toast съедал тап по «Сохранить» ============================
function cssRule(sel) {
  const re = new RegExp('(^|\\n)' + sel.replace(/[.#]/g, (c) => '\\' + c) + '\\s*\\{([^}]*)\\}');
  const m = CSS.match(re);
  return m ? m[2] : null;
}
test('0a: #toast НИКОГДА не перехватывает касания (pointer-events:none), спрятанный - visibility:hidden', () => {
  const t = cssRule('#toast');
  assert.ok(t, 'правило #toast');
  assert.match(t, /pointer-events:\s*none/, 'toast лежит поверх окон (z 60) - без pointer-events:none он съедает тап по кнопке под ним');
  assert.match(t, /visibility:\s*hidden/);
  assert.match(t, /opacity:\s*0/);
  const s = cssRule('#toast.show');
  assert.ok(s && /visibility:\s*visible/.test(s) && /opacity:\s*1/.test(s));
  assert.ok(!/pointer-events:\s*auto/.test(s), 'и показанный toast касаний не перехватывает');
});
test('0a: ни один fixed-оверлей с opacity:0 в CSS не ловит касания (общий заслон класса)', () => {
  const blocks = CSS.split('}');
  const bad = [];
  for (const b of blocks) {
    if (/position:\s*fixed/.test(b) && /(^|[;{\s])opacity:\s*0\s*[;}\n]/.test(b + ';') && !/pointer-events:\s*none/.test(b)) bad.push(b.trim().split('{')[0].trim());
  }
  assert.deepEqual(bad, [], 'прозрачный fixed-элемент без pointer-events:none: ' + bad.join(', '));
});
test('0a: QA-заслон qa-save-all перед сохранением показывает toast и проверяет, что каждая кнопка сверху', { skip: !fs.existsSync(path.join(ROOT, 'tools', 'qa-save-all.mjs')) && 'внутренний файл не входит в публичный репозиторий' }, () => {
  const QA = fs.readFileSync(path.join(ROOT, 'tools', 'qa-save-all.mjs'), 'utf8');
  assert.match(QA, /app\.toast\(/);
  assert.match(QA, /const covered = await evalJs\(cdp, ACTIONS_ON_TOP\);/);
  assert.match(QA, /tap\.onTop && !covered\.length && closed/);
  assert.match(APP, /export \{ state, saveFile, toast \};/);
});

// ============================ 0b: маска дат/номера только при наборе в конце ============================
test('0b: правка в СЕРЕДИНЕ даты не меняет ничего, кроме удалённого/вставленного символа', () => {
  // Backspace после «0» в «12.03.2029» (каретка 4 -> браузер удалил «0», каретка 3)
  let r = endOnlyMask('12.3.2029', 4, Docs.formatDocDate);
  assert.deepEqual(r, { value: '12.3.2029', caret: 4, changed: false });
  r = endOnlyMask('12.3.2029', 3, Docs.formatDocDate);
  assert.equal(r.changed, false); assert.equal(r.value, '12.3.2029');
  // вставка цифры в середину
  r = endOnlyMask('12.053.2029', 4, Docs.formatDocDate);
  assert.equal(r.changed, false); assert.equal(r.value, '12.053.2029');
  // срок карты и номер карты - так же
  assert.equal(endOnlyMask('1/29', 1, formatExpiryLive).changed, false);
  assert.equal(endOnlyMask('2200 123 5678 9010', 7, formatCardNumber).changed, false);
});
test('0b: набор в КОНЦЕ по-прежнему ставит точки/слэш/пробелы; при выделении или композиции IME - не трогаем', () => {
  const typeEnd = (fmt, text) => { let v = ''; for (const ch of text) { const raw = v + ch; v = endOnlyMask(raw, raw.length, fmt).value; } return v; };
  assert.equal(typeEnd(Docs.formatDocDate, '15031998'), '15.03.1998');
  assert.equal(typeEnd(formatExpiryLive, '1229'), '12/29');
  assert.equal(typeEnd(formatExpiryLive, '1/29'), '01/29');
  assert.equal(typeEnd(formatCardNumber, '2200123412341234'), '2200 1234 1234 1234');
  assert.equal(endOnlyMask('1203', 4, Docs.formatDocDate, { hadSelection: true }).changed, false);
  assert.equal(endOnlyMask('1203', 4, Docs.formatDocDate, { composing: true }).changed, false);
  assert.deepEqual(endOnlyMask('1203', 4, Docs.formatDocDate), { value: '12.03', caret: 5, changed: true });
});
test('0b: нормализация на blur/сохранении - части даты дополняются нулём, а не склеиваются по цифрам', () => {
  assert.equal(Docs.normalizeDocDateInput('12.3.2029'), '12.03.2029', 'было бы «12.32.029» по цифрам');
  assert.equal(Docs.normalizeDocDateInput('1.3.29'), '01.03.29');
  assert.equal(Docs.normalizeDocDateInput('12032029'), '12.03.2029');
  assert.equal(Docs.normalizeDocDateInput(''), '');
  assert.equal(Docs.normalizeDocDateInput('abc'), 'abc', 'мусор - как есть (проверка на сохранении)');
});
test('0b: поля дат и номера карты привязаны маской «только в конце» + нормализация на blur', () => {
  assert.equal(endOnlyMaskField('cards', 'number'), true);
  assert.equal(endOnlyMaskField('cards', 'expiry'), true);
  assert.equal(endOnlyMaskField('documents', 'expiry'), true);
  assert.equal(endOnlyMaskField('documents', 'issueDate'), true);
  assert.equal(endOnlyMaskField('cards', 'cvv'), false);
  // 1.2.25 (п.1, п.8): на blur - normalizeExpiryInput (мусор не обрезается в «валидное») и дата ДД.ММ.ГГГГ
  assert.match(APP, /bindCaretMask\(exp, formatExpiryLive, \{ onInput: \(\) => \{ dirty = true; \}, endOnly: true, normalize: normalizeExpiryInput, onlyEdited: true \}\)/);   // 1.3.0 (Info): blur - только после правки
  assert.match(APP, /bindCaretMask\(issueInput, Docs\.formatDocDateLive, \{[^}]*\}, endOnly: true, normalize: \(v\) => Docs\.normalizeIssueDateInput\(v\) \}\)/);
  assert.match(APP, /bindCaretMask\(expInput, Docs\.formatDocDateLive, \{[^}]*\}, endOnly: true, normalize: Docs\.normalizeExpiryDateInput \}\)/);
  assert.match(APP, /endOnly: endOnlyMaskField\(section, key\)/);
  const b = fnBody('function bindCaretMask(');
  assert.match(b, /if \(opts\.endOnly\) \{[\s\S]*endOnlyMask\(raw, caret, formatter[\s\S]*addEventListener\('blur'/);
  assert.match(APP, /const rawExp = Docs\.normalizeDocDateInput\(/);
  assert.match(APP, /const ci = Docs\.checkIssueDate\(patch\.issueDate, /, '1.2.25: дата выдачи - через checkIssueDate (нормализация внутри)');
});

// ============================ п.1: очистка буфера переживает блокировку ============================
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; }
function fakeClip() {
  const c = { value: '', focused: false, writes: [] };
  c.readText = async () => { if (!c.focused) throw new Error('Document is not focused'); return c.value; };
  c.writeText = async (v) => { if (!c.focused) throw new Error('Document is not focused'); c.value = v; c.writes.push(v); };
  return c;
}
function fakeFocus(clip) {
  const ls = new Set();
  return { hasFocus: () => clip.focused, addListener: (fn) => ls.add(fn), removeListener: (fn) => ls.delete(fn), fire: () => { clip.focused = true; for (const fn of [...ls]) fn(); }, count: () => ls.size };
}
test('п.1: неудачная очистка при блокировке ставит флаг; после reload буфер очищается при первом фокусе', async () => {
  const ss = memStorage(); const flag = makeClipFlag(ss); const cb = fakeClip();
  cb.focused = true;
  const g = createClipboardGuard({ clipboard: cb, flag, setTimer: () => 1, clearTimer: () => {} });
  await g.copy('SECRET-PIN');
  assert.equal(flag.has(), true, '1.3.0 (M2): флаг ставится уже при копировании (было false - выгрузка процесса до TTL оставляла секрет)');
  cb.focused = false;                                  // блокировка из фона: фокуса нет
  assert.equal(await g.clearIfOurs(), false);
  assert.equal(flag.has(), true, 'флаг в sessionStorage - переживёт location.reload()');
  assert.equal(cb.value, 'SECRET-PIN', 'сценарий: секрет ещё в буфере');
  // --- reload: новая страница, pending потерян, есть только флаг ---
  const fc = fakeFocus(cb);
  const p = clearAfterReload({ clipboard: cb, flag: makeClipFlag(ss), ...fc });
  await tick();
  assert.equal(cb.value, 'SECRET-PIN', 'без фокуса ждём');
  fc.fire();
  assert.equal(await p, true);
  assert.equal(cb.value, '', 'буфер очищен при первом фокусе');
  assert.equal(makeClipFlag(ss).has(), false, 'флаг снят');
  assert.equal(fc.count(), 0, 'слушатель снят');
});
test('п.1: успешная очистка снимает флаг; нет флага - после reload буфер не трогаем', async () => {
  const ss = memStorage(); const flag = makeClipFlag(ss); const cb = fakeClip(); cb.focused = true;
  const g = createClipboardGuard({ clipboard: cb, flag, setTimer: () => 1, clearTimer: () => {} });
  await g.copy('X'); cb.focused = false; await g.clearIfOurs(); assert.equal(flag.has(), true);
  cb.focused = true; assert.equal(await g.retryIfFailed(), true); assert.equal(flag.has(), false);
  cb.value = 'своё'; assert.equal(await clearAfterReload({ clipboard: cb, flag, ...fakeFocus(cb) }), false);
  assert.equal(cb.value, 'своё');
});
test('п.1: waitForFocus - сразу при фокусе, по событию, или false по таймауту (слушатель снят)', async () => {
  const cb = fakeClip(); const fc = fakeFocus(cb);
  cb.focused = true; assert.equal(await waitForFocus({ ...fc, ms: 50 }), true);
  cb.focused = false;
  const p = waitForFocus({ ...fc, ms: 500 }); fc.fire(); assert.equal(await p, true);
  cb.focused = false; const t0 = Date.now(); assert.equal(await waitForFocus({ ...fc, ms: 40 }), false);
  assert.ok(Date.now() - t0 < 400); assert.equal(fc.count(), 0);
});
test('п.1: lockNow ждёт фокус (1,5 с) перед очисткой; флаг в localStorage (1.2.25, п.7); очистка после reload при старте', () => {
  const b = fnBody('async function lockNow()');
  const w = b.indexOf('waitForFocus({ ...focusApi, ms: 1500 })'), c = b.indexOf('clip.clearIfOurs()');
  assert.ok(w > 0 && w < c, 'сначала ждём фокус, потом чистим');
  assert.match(APP, /const clip = createClipboardGuard\(\{ clipboard: clipboardApi, flag: clipFlag \}\);/);
  assert.match(APP, /makeClipFlag\(lsGet\(\)\)/);
  assert.match(APP, /clearAfterReload\(\{ clipboard: clipboardApi, flag: clipFlag, \.\.\.focusApi \}\)/);
});

// ============================ п.2 - в share.test.mjs (copySecret) ============================

// ============================ п.3: уборка брошенной записи не трогает tmp новой ============================
function gatedFs({ serial = false } = {}) {
  const files = new Map(); const log = []; const gates = [];
  const f = { files, log, gate: null };
  f._g = async (op) => { log.push(op); if (f.gate && f.gate(op)) await new Promise((res, rej) => gates.push({ op, res, rej })); };
  f.release = (op, err) => { const i = gates.findIndex((g) => g.op === op); const g = gates.splice(i, 1)[0]; err ? g.rej(new Error(err)) : g.res(); };
  f.readFile = async ({ path: p }) => { if (!files.has(p)) throw new Error('File does not exist'); return { data: files.get(p) }; };
  f.writeFile = async ({ path: p, data }) => { await f._g('write ' + p); files.set(p, data); };
  f.appendFile = async ({ path: p, data }) => { await f._g('append ' + p); files.set(p, (files.get(p) || '') + data); };
  f.rename = async ({ from, to }) => { await f._g('rename ' + from); files.delete(to); if (!files.has(from)) throw new Error('The source object does not exist'); files.set(to, files.get(from)); files.delete(from); };
  f.readdir = async () => { await f._g('readdir'); return { files: [...files.keys()].map((name) => ({ name, type: 'file' })) }; };
  f.deleteFile = async ({ path: p }) => { await f._g('delete ' + p); if (!files.has(p)) throw new Error('File does not exist'); files.delete(p); };
  return f;
}
const V = (tag, n = 3000) => ({ v: 1, tag, data: { ct: tag.repeat(n) } });
test('п.3 (PoC1 ревьюера): readdir брошенной записи падает -> НИЧЕГО не удаляем; vault.dat цел при «ok»', async () => {
  const f = gatedFs(); const timers = [];
  const st = makeStore(makeFsBackend(f, { chunk: 1000 }), { setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  f.files.set('vault.dat', JSON.stringify(V('A')));
  let n = 0;
  f.gate = (op) => op === 'readdir' && ++n === 2;       // 1-й readdir - выбор имени, 2-й - уборка W1: виснет
  const p1 = st.save(V('B')); p1.catch(() => {});
  await tick(60);
  assert.equal(JSON.parse(f.files.get('vault.dat')).tag, 'B');
  timers.at(-1)();                                       // сторож бросает W1 (висит в уборке)
  await p1.catch(() => {});
  let held = false;
  f.gate = (op) => op.startsWith('append vault.tmp.') && !held && (held = true);
  const p2 = st.save(V('C')); p2.catch(() => {});
  await tick(60);
  f.release('readdir', 'bridge error');                  // уборка W1 проснулась с ошибкой readdir
  await tick(60);
  f.release(f.log.filter((l) => l.startsWith('append vault.tmp.'))[0]);
  await p2;
  const raw = f.files.get('vault.dat');
  assert.ok(parseVault(raw), 'vault.dat - целый JSON (было: обрезок «CCCC...» при w2 «ok»)');
  assert.equal(JSON.parse(raw).tag, 'C');
  assert.ok(!f.log.some((l) => /^delete vault\.tmp\.[2-9]/.test(l)), 'tmp новой записи не удалялся: ' + f.log.join(','));
});
test('п.3: уборка без readdir (или readdir упал) не удаляет ничего; перед удалением - проверка эпохи', async () => {
  const f = gatedFs(); delete f.readdir;
  f.files.set('vault.tmp.5', 'остаток');
  f.files.set('vault.tmp', 'остаток 1.2.22');          // имя из known - раньше удалялось «по догадке»
  const st = makeStore(makeFsBackend(f, { chunk: 1000 }));
  await st.save(V('X', 10));
  assert.equal(JSON.parse(f.files.get('vault.dat')).tag, 'X');
  assert.ok(f.files.has('vault.tmp.5') && f.files.has('vault.tmp'), 'без readdir - не удаляем по догадке');
  assert.ok(!f.log.some((l) => l.startsWith('delete')));
  const SRC = fs.readFileSync(path.join(ROOT, 'www', 'js', 'storage.js'), 'utf8');
  const c = SRC.slice(SRC.indexOf('const cleanup = async (myEpoch)'), SRC.indexOf('const checkGen'));
  assert.match(c, /if \(!dir \|\| myEpoch !== epoch\) return;/);
  assert.match(c, /for \(const f of dir\) \{\s*if \(myEpoch !== epoch\) return;[^\n]*\n\s*if \(seqOf\(f\.name\) >= gen\) continue;/);
  assert.ok(!/known\]/.test(c), 'запасного пути на known больше нет');
});
test('п.3: запись брошена ВО ВРЕМЯ уборки - следующие удаления уже не выполняются (эпоха проверяется перед каждым)', async () => {
  const f = gatedFs(); const timers = [];
  f.files.set('vault.dat', JSON.stringify(V('A', 10)));
  const st = makeStore(makeFsBackend(f, { chunk: 1000 }), { setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  await st.save(V('B', 10));                                // первая запись сессии (выбор имени сделан)
  f.files.set('vault.tmp.10', 'x'); f.files.set('vault.tmp.11', 'y');
  f.gate = (op) => op === 'delete vault.tmp.10';            // уборка второй записи зависла на удалении
  const p = st.save(V('C', 10)); p.catch(() => {});
  await tick(60);
  timers.at(-1)();                                          // сторож бросает запись посреди уборки
  await p.catch(() => {});
  f.release('delete vault.tmp.10');
  await tick(60);
  assert.ok(f.files.has('vault.tmp.11'), 'после брошенности уборка остановилась: ' + f.log.join(','));
  assert.equal(JSON.parse(f.files.get('vault.dat')).tag, 'C');
});
test('п.3 (PoC ревьюера, последовательный мост): vault.dat после «ok» разбирается', async () => {
  const files = new Map(); const q = []; let busy = false; let stall = null;
  const native = (op, fn) => new Promise((res, rej) => { q.push({ op, fn, res, rej }); pump(); });
  async function pump() { if (busy) return; busy = true; while (q.length) { const j = q.shift(); if (stall && stall.match(j.op)) { const s = stall; stall = null; await s.wait; if (s.err) { j.rej(new Error(s.err)); continue; } } try { j.res(j.fn()); } catch (e) { j.rej(e); } } busy = false; }
  const cfs = {
    readFile: ({ path: p }) => native('read ' + p, () => { if (!files.has(p)) throw new Error('File does not exist'); return { data: files.get(p) }; }),
    writeFile: ({ path: p, data }) => native('write ' + p, () => { files.set(p, data); }),
    appendFile: ({ path: p, data }) => native('append ' + p, () => { files.set(p, (files.get(p) || '') + data); }),
    rename: ({ from, to }) => native('rename ' + from, () => { files.delete(to); if (!files.has(from)) throw new Error('src'); files.set(to, files.get(from)); files.delete(from); }),
    readdir: () => native('readdir', () => ({ files: [...files.keys()].map((name) => ({ name })) })),
    deleteFile: ({ path: p }) => native('delete ' + p, () => { if (!files.has(p)) throw new Error('File does not exist'); files.delete(p); }),
  };
  const timers = [];
  const st = makeStore(makeFsBackend(cfs, { chunk: 1000 }), { setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  let release; let nrd = 0;
  stall = { match: (op) => op === 'readdir' && ++nrd === 2, wait: new Promise((r) => { release = r; }), err: 'Unable to read directory' };
  st.save(V('B')).catch(() => {});
  await tick(60);
  timers.at(-1)();
  const p2 = st.save(V('C')); p2.catch(() => {});
  await tick(60); release(); await tick(300);
  await p2;
  assert.ok(parseVault(files.get('vault.dat')));
  assert.equal(JSON.parse(files.get('vault.dat')).tag, 'C');
});

// ============================ п.4: сторож по отсутствию прогресса ============================
test('п.4: большая медленная запись (кусок за куском) НЕ бросается сторожем, пока идёт прогресс', async () => {
  let writes = 0;
  const backend = { read: async () => null, write: async (s, onChunk) => { writes++; for (let i = 0; i < 8; i++) { await sleep(25); onChunk(); } } };
  const st = makeStore(backend, { watchdogMs: 60 });
  await st.save({ v: 1 });                               // 200 мс всего > 60 мс сторожа
  assert.equal(writes, 1);
  let runs = 0;
  const save = makeSerialSaver(async (setStage, alive, beat) => { runs++; setStage('write'); await st.save({ v: 2 }, { onProgress: beat }); }, { timeoutMs: 5000, watchdogMs: 60 });
  await save();
  assert.equal(runs, 1, 'очередь сохранений тоже не перезапускала запись');
  assert.equal(save.unsaved(), false);
});
test('п.4: без прогресса сторож по-прежнему бросает запись', async () => {
  const st = makeStore({ read: async () => null, write: () => new Promise(() => {}) }, { watchdogMs: 40 });
  await assert.rejects(st.save({ v: 1 }), (e) => e.code === 'write-hung');
});
test('п.4: загрузка - таймаут по отсутствию прогресса; «Повторить» ждёт ИДУЩЕЕ чтение, а не запускает новое', async () => {
  let loads = 0, finish;
  const L = makeSharedLoader((beat) => { loads++; return new Promise((r) => { finish = r; }); });
  await assert.rejects(L.wait(30, 'load-timeout'), (e) => e.code === 'load-timeout');
  assert.equal(L.pending(), true);
  const again = L.wait(1000, 'load-timeout');
  finish({ v: 1, big: true });
  assert.deepEqual(await again, { v: 1, big: true });
  assert.equal(loads, 1, 'чтение одно');
  const r = await withIdleTimeout(async (beat) => { for (let i = 0; i < 6; i++) { await sleep(20); beat(); } return 'ok'; }, 50, 'x');
  assert.equal(r, 'ok', 'пульс продлевает ожидание');
  assert.match(APP, /const bootLoader = makeSharedLoader\(\(beat\) => loadFile\(\{ onProgress: beat \}\)\);/);
  assert.match(fnBody('async function startReadError('), /bootLoader\.settled\(\)\.then\(\(\) => \{ if \(ctl\.close\) ctl\.close\('retry'\); \}\)/);
  assert.match(APP, /await guardedStoreSave\(state\.file, \{ onProgress: beat \}\);/);
});

// ============================ п.5: разовая ошибка записи - повтор при блокировке/OTA ============================
test('п.5 (lock-poc ревьюера): после разовой ошибки записи блокировка повторяет запись и дожидается её', async () => {
  let disk = 'v0', mem = 'v0', failNext = true, runs = 0;
  const save = makeSerialSaver(async () => { runs++; if (failNext) { failNext = false; throw new Error('Unable to rename'); } disk = mem; }, { timeoutMs: 1000 });
  mem = 'v1-edit'; await save().catch(() => {});
  assert.equal(save.failed(), true);
  const ok = await drainWithRetry(save, 2000);
  assert.equal(ok, true);
  assert.equal(disk, 'v1-edit', 'было: v0 (правка терялась при reload)');
  assert.equal(runs, 2);
  assert.equal(save.unsaved(), false);
});
test('п.5: повтор ровно один; упало снова - честное «не записано» (false), общий потолок времени', async () => {
  let runs = 0;
  const save = makeSerialSaver(async () => { runs++; throw new Error('disk full'); }, { timeoutMs: 1000 });
  await save().catch(() => {});
  assert.equal(await drainWithRetry(save, 500), false);
  assert.equal(runs, 2);
  assert.match(fnBody('async function lockDrain()'), /await drainWithRetry\(serialSave, DRAIN_MS\);/);
  assert.match(APP, /drain: \(ms\) => drainWithRetry\(serialSave, ms \|\| DRAIN_MS\),/);
  assert.match(APP, /последние изменения не удалось записать на устройство, и они, скорее всего, не сохранились/);
});

// ============================ п.6: срок карты ============================
test('п.6: вставка «1/2029» -> «01/29» (было «01/20»); набор года целиком не обрывается', () => {
  assert.equal(formatExpiryLive('1/2029'), '01/29');
  assert.equal(formatExpiryLive('5/2030'), '05/30');
  assert.equal(formatExpiryLive('12/2029'), '12/29');
  assert.equal(formatExpiryLive('12/202'), '12/202', 'промежуточный вид при наборе года из 4 цифр');
  assert.equal(parseExpiry('12/202').valid, false, 'недописанный год не сохраняется как «12/20»');
  const typeEnd = (text) => { let v = ''; for (const ch of text) { const raw = v + ch; if (raw.length > 7) continue; v = endOnlyMask(raw, raw.length, formatExpiryLive).value; } return v; };
  assert.equal(typeEnd('12/2029'), '12/29');
  assert.equal(typeEnd('1/2029'), '01/29');
  assert.equal(typeEnd('122029'), '12/29');
});
test('п.6: срок прошёл - предупреждение на сохранении, сохранить можно после подтверждения', () => {
  const now = new Date(2026, 8, 23).getTime();
  assert.equal(expiryPassed('08/26', now), true);
  assert.equal(expiryPassed('09/26', now), false, 'карта действует до конца месяца');
  assert.equal(expiryPassed('12/20', now), true);
  assert.equal(expiryPassed('13/29', now), false);
  const i = APP.indexOf("const ce = checkCardExpiry(patch.expiry, ");
  assert.ok(i > 0, '1.2.25: срок карты решает checkCardExpiry');
  const body = APP.slice(i, i + 1800);
  assert.match(body, /if \(ce\.passed\) \{\s*const go = await dlgConfirm\([^;]*уже прошёл[^;]*;\s*if \(!go\) return;/);
});

// ============================ п.7: дата выдачи ============================
test('п.7: дата выдачи «15.03.98» -> 1998 (было 2098); ГГ не позже текущего года -> 20ГГ; будущее - future', () => {
  const now = new Date(2026, 8, 23, 12).getTime();
  assert.equal(Docs.parseIssueDate('15.03.98', now).text, '15.03.1998');
  assert.equal(Docs.parseIssueDate('15.03.26', now).text, '15.03.2026');
  assert.equal(Docs.parseIssueDate('15.03.27', now).text, '15.03.1927');
  assert.equal(Docs.parseIssueDate('24.09.2026', now).future, true);
  assert.equal(Docs.parseIssueDate('23.09.2026', now).future, false, 'сегодня - можно');
  assert.equal(Docs.parseDocDate('10.10.29').text, '10.10.2029', 'срок действия по-прежнему 20ГГ');
  assert.equal(Docs.formatIssueDateDisplay('03.04.98'), '03.04.1998');
  const i = APP.indexOf('const ci = Docs.checkIssueDate(patch.issueDate, ');
  assert.ok(i > 0);
  assert.match(APP.slice(i, i + 400), /if \(!ci\.ok && ci\.reason === 'future'\) \{ await dlgAlert\([^;]*ещё не наступила[^;]*;\s*return; \}/);
});

// ============================ п.8: восстановление из самого свежего tmp ============================
// 1.2.25 (ревью 1.2.24, п.5): при readdir номер надёжнее часов (номера монотонны через checkGen/gen),
// поэтому этот сценарий теперь - БЕЗ readdir (номера между сессиями не согласованы): там по mtime (stat).
// Сценарий с readdir и сбитыми часами - tests/fixes-1225.test.mjs (п.5).
test('п.8 (PoC2): без readdir при обрыве внутри rename берётся САМЫЙ СВЕЖИЙ tmp по mtime (stat), а не по номеру', async () => {
  const f = gatedFs(); delete f.readdir;
  f.files.set('vault.tmp.2', JSON.stringify(V('OLD', 10)));
  f.files.set('vault.tmp.1', JSON.stringify(V('NEW', 10)));
  const mt = { 'vault.tmp.2': 1000, 'vault.tmp.1': 2000 };
  f.stat = async ({ path: p }) => { if (!f.files.has(p)) throw new Error('File does not exist'); return { mtime: mt[p] || 0 }; };
  const loaded = await makeStore(makeFsBackend(f, { chunk: 1000 })).load();
  assert.equal(loaded.tag, 'NEW');
  assert.equal(JSON.parse(f.files.get('vault.dat')).tag, 'NEW');
  assert.deepEqual([{ seq: 1, mtime: 5 }, { seq: 2, mtime: 3 }].sort(newestFirst).map((x) => x.seq), [1, 2]);
  assert.deepEqual([{ seq: 1, mtime: NaN }, { seq: 2, mtime: NaN }].sort(newestFirst).map((x) => x.seq), [2, 1], 'без времени - по номеру');
});
test('п.8 (PoC3): promote не удался -> первая запись идёт в НОВОЕ имя; обрыв записи не губит единственную копию', async () => {
  const f = gatedFs();
  f.files.set('vault.tmp.1', JSON.stringify(V('ONLY', 3000)));
  const realRename = f.rename; let fail = true;
  f.rename = async (a) => { if (fail) { fail = false; throw new Error('Unable to rename'); } return realRename(a); };
  const st = makeStore(makeFsBackend(f, { chunk: 1000 }));
  assert.equal((await st.load()).tag, 'ONLY');
  f.gate = (op) => op.startsWith('append ');           // приложение убито на первом куске
  st.save(V('EDIT', 3000)).catch(() => {});
  await tick(40);
  assert.ok(f.log.includes('write vault.tmp.2'), 'запись в vault.tmp.2, не поверх vault.tmp.1: ' + f.log.join(','));
  const f2 = gatedFs(); for (const [k, v] of f.files) f2.files.set(k, v);
  assert.equal((await makeStore(makeFsBackend(f2, { chunk: 1000 })).load()).tag, 'ONLY', 'было: VAULT_CORRUPT');
});
test('п.8: без readdir (только пробы имён) - после неудачного promote запись всё равно в НОВОЕ имя', async () => {
  const f = gatedFs(); delete f.readdir;
  f.files.set('vault.tmp.1', JSON.stringify(V('ONLY', 3000)));
  const realRename = f.rename; let fail = true;
  f.rename = async (a) => { if (fail) { fail = false; throw new Error('Unable to rename'); } return realRename(a); };
  const st = makeStore(makeFsBackend(f, { chunk: 1000 }));
  assert.equal((await st.load()).tag, 'ONLY');
  f.gate = (op) => op.startsWith('append ');
  st.save(V('EDIT', 3000)).catch(() => {});
  await tick(40);
  assert.ok(f.log.includes('write vault.tmp.2'), f.log.join(','));
  assert.equal(f.files.get('vault.tmp.1'), JSON.stringify(V('ONLY', 3000)), 'единственная копия не затёрта');
});
test('п.8: первая запись сессии идёт в имя выше остатка прошлой сессии', async () => {
  const f = gatedFs();
  f.files.set('vault.dat', JSON.stringify(V('A', 10)));
  f.files.set('vault.tmp.3', 'остаток');
  const st = makeStore(makeFsBackend(f, { chunk: 1000 }));
  await st.save(V('B', 10));
  assert.ok(f.log.includes('write vault.tmp.4'), f.log.join(','));
  assert.ok(!f.files.has('vault.tmp.3'), 'остаток убран живой записью');
});

// ============================ п.9: тестовое обновление и резервный ключ ============================
function loadUpdate(win) {
  const code = fs.readFileSync(path.join(ROOT, 'www', 'update.js'), 'utf8');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, globalThis, console, window: win, setTimeout, clearTimeout });
  return mod.exports;
}
async function signedManifest(U, priv, build) {
  const subtle = globalThis.crypto.subtle;
  const man = { build, version: '1.2.0', apkUrl: 'https://dorokhin-finance.ru/seyf-store/seyf-1.2.0.apk', size: 1, notes: 'n',
    web: { version: '9.9.9', url: 'https://dorokhin-finance.ru/seyf-store/www-9.9.9.zip', sha256: 'a'.repeat(64), size: 1, minShell: '1.0.0' } };
  const data = await U.manifestSigData(man, { subtle });
  man.sig = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(data))).toString('base64url');
  return man;
}
test('п.9: боевая сборка тестовый манифест не предлагает и не применяет; тестовая ставит и test, и release', async () => {
  const REL = loadUpdate({ SEYF_FULL_ACCESS: false });
  const TST = loadUpdate({ SEYF_FULL_ACCESS: true });
  const base = { version: '1.2.0', apkUrl: 'https://dorokhin-finance.ru/seyf-store/seyf-1.2.0.apk', size: 1, notes: '',
    web: { version: '9.9.9', url: 'https://dorokhin-finance.ru/seyf-store/www-9.9.9.zip', sha256: 'a'.repeat(64), size: 1, minShell: '1.0.0' } };
  const mt = REL.parseManifest({ ...base, build: 'test' });
  const mr = REL.parseManifest({ ...base, build: 'release' });
  assert.equal(mt.build, 'test');
  assert.equal(REL.decide(mt, '1.2.23', '1.2.0', null).kind, 'none', 'было: ota');
  assert.equal(REL.decide(mr, '1.2.23', '1.2.0', null).kind, 'ota');
  assert.equal(TST.decide(TST.parseManifest({ ...base, build: 'test' }), '1.2.23', '1.2.0', null).kind, 'ota');
  assert.equal(TST.decide(TST.parseManifest({ ...base, build: 'release' }), '1.2.23', '1.2.0', null).kind, 'ota');
  assert.equal(REL.decideStore(mt, '1.0.0').kind, 'none');
  // apply - второй заслон: на боевой сборке тестовый архив даже не качается
  const subtle = globalThis.crypto.subtle;
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pubB64 = Buffer.from(await subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  const man = await signedManifest(REL, kp.privateKey, 'test');
  let fetched = 0;
  const fetch = async () => { fetched++; throw new Error('net'); };
  const ok = await REL.apply({ ...man.web, signed: man }, { plugins: { Filesystem: {}, WebView: {} }, otaPubKeyB64: pubB64, fetch });
  assert.equal(ok, false); assert.equal(fetched, 0, 'тестовый архив на боевую сборку не скачивается');
  await TST.apply({ ...man.web, signed: man }, { plugins: { Filesystem: {}, WebView: {} }, otaPubKeyB64: pubB64, fetch });
  assert.equal(fetched, 1, 'тестовая сборка идёт дальше (до скачивания)');
});
test('п.9: подпись принимается основным ИЛИ резервным ключом; чужим - нет', async () => {
  const U = loadUpdate({});
  const subtle = globalThis.crypto.subtle;
  const mk = async () => { const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); return { kp, pub: Buffer.from(await subtle.exportKey('raw', kp.publicKey)).toString('base64url') }; };
  const main = await mk(), backup = await mk(), stranger = await mk();
  const keys = [main.pub, backup.pub];
  assert.equal(await U.verifyManifest(await signedManifest(U, main.kp.privateKey, 'release'), { otaPubKeys: keys }), true);
  assert.equal(await U.verifyManifest(await signedManifest(U, backup.kp.privateKey, 'release'), { otaPubKeys: keys }), true, 'резервный ключ принят');
  assert.equal(await U.verifyManifest(await signedManifest(U, stranger.kp.privateKey, 'release'), { otaPubKeys: keys }), false);
  assert.deepEqual([...U.OTA_PUB_KEYS], [U.OTA_PUB_KEY_B64, U.OTA_PUB_KEY_BACKUP_B64], 'вшиты оба ключа');
  assert.notEqual(U.OTA_PUB_KEY_B64, U.OTA_PUB_KEY_BACKUP_B64);
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^tools\/ota-sign-key-backup\.json$/m, 'резервный приватный ключ не в git');
});
const BK = path.join(ROOT, 'tools', 'ota-sign-key-backup.json');
test('п.9: публичный резервный ключ в update.js - от tools/ota-sign-key-backup.json; им подписанное принимается', { skip: !fs.existsSync(BK) && 'нет резервного ключа на этой машине' }, async () => {
  const U = loadUpdate({});
  const k = JSON.parse(fs.readFileSync(BK, 'utf8'));
  assert.equal(U.OTA_PUB_KEY_BACKUP_B64, k.publicRawB64);
  const priv = await globalThis.crypto.subtle.importKey('jwk', k.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  assert.equal(await U.verifyManifest(await signedManifest(U, priv, 'release')), true, 'вшитые ключи принимают подпись резервным');
});

// ============================ п.10: предел и пауза автоповторов ============================
test('п.10: вечно висящий мост - автоповторы с растущей паузой и не больше предела; дальше только баннер', async () => {
  assert.equal(retryDelayMs(1, 100, 1000), 0);
  assert.equal(retryDelayMs(2, 100, 1000), 100);
  assert.equal(retryDelayMs(3, 100, 1000), 200);
  assert.equal(retryDelayMs(9, 100, 1000), 1000, 'потолок');
  let runs = 0; const states = [];
  const save = makeSerialSaver(() => { runs++; return new Promise(() => {}); }, { timeoutMs: 5000, watchdogMs: 15, retryBaseMs: 10, retryMaxMs: 40, maxAutoRetries: 3, onChange: (s) => states.push(s) });
  save().catch(() => {});
  await sleep(600);
  assert.equal(runs, 4, 'первая попытка + 3 автоповтора (было: бесконечно)');
  assert.equal(save.hungStreak(), 4);
  assert.equal(save.unsaved(), true); assert.equal(save.failed(), true, 'баннер «не записано» остаётся');
});
test('п.10: брошенная запись отпускает свои куски (не держит копию сейфа в памяти)', async () => {
  const f = gatedFs();
  f.gate = (op) => op.startsWith('append ');
  const be = makeFsBackend(f, { chunk: 1000 });
  const st = makeStore(be, { watchdogMs: 30 });
  await assert.rejects(st.save(V('BIG', 5000)), (e) => e.code === 'write-hung');
  assert.equal(be.inflightCount(), 0, 'куски брошенной записи отпущены');
});

// ============================ п.11: «Начать заново» на экране повреждения ============================
test('п.11: setAsideCorrupt откладывает vault.dat и tmp (переименование, НЕ удаление); после - «сейфа нет»', async () => {
  const f = gatedFs();
  f.files.set('vault.dat', 'garbage{{{');
  f.files.set('vault.tmp.2', '{"v":1,"da');
  const st = makeStore(makeFsBackend(f, { chunk: 1000 }));
  await assert.rejects(st.load(), (e) => e.code === 'VAULT_CORRUPT');
  assert.equal(await st.setAsideCorrupt(777), 2);
  assert.equal(f.files.get('vault.corrupt-777'), 'garbage{{{', 'повреждённый файл сохранён байт-в-байт');
  assert.equal(f.files.get('vault.corrupt-777-vault.tmp.2'), '{"v":1,"da');
  assert.ok(!f.log.some((l) => l.startsWith('delete')), 'ничего не удалено');
  assert.equal(await st.load(), null, 'теперь можно создать новый сейф');
});
test('п.11: «Начать заново» - только после подтверждения; файл откладывается до создания нового сейфа', () => {
  const sc = fnBody('async function startCorrupt(');
  assert.match(sc, /\{ label: 'Начать заново', value: 'fresh'/);
  assert.match(sc, /Копии нет - нажмите «Начать заново»/, 'подсказка на экране');
  const fr = fnBody('async function startFreshOnCorrupt(');
  const c = fr.indexOf('await dlgConfirm('), a = fr.indexOf('store.setAsideCorrupt(');
  assert.ok(c > 0 && c < a, 'сначала подтверждение, потом откладываем');
  assert.match(fr, /будут недоступны/);
  assert.match(fr, /if \(!ok\) return false;/);
  assert.ok(!/deleteFile|removeItem\(LS_KEY|preserveCorrupt/.test(fr), 'файл не удаляется');
});
