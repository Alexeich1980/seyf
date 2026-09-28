// integrity-1223.test.mjs - заслоны блока A адверсариального ревью 22.09 (целостность данных, 1.2.23).
// Сценарии перенесены из пруф-скриптов ревьюера (review-data/proof-storage.mjs, proof-persist.mjs):
// там СТАРОЕ поведение (null = «сейфа нет», вечная очередь, reload без ожидания) было «наблюдаемым»,
// здесь - требуемое НОВОЕ. Фейковый FS повторяет семантику Capacitor Filesystem 6.0.4 (Android):
// writeFile = truncate+write, rename = delete(to) + renameTo, readFile бросает «File does not exist».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeStore, makeFsBackend, parseVault, isMissingFileError } from '../www/js/storage.js';
import { makeSerialSaver, drainQueue } from '../www/js/persist.js';
import { arrowState, moveWithinGroup, displayOrder } from '../www/js/listorder.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function capFs({ readdir = true, del = true, stat = false } = {}) {
  const files = new Map();
  const log = [];
  let dieAfter = Infinity, ops = 0;
  const tick = (op) => { ops++; log.push(op); if (ops > dieAfter) throw Object.assign(new Error('PROCESS KILLED/RELOAD'), { killed: true }); };
  const f = {
    files, log, readErr: null,
    killAfter(n) { ops = 0; dieAfter = n; }, revive() { dieAfter = Infinity; },
    async readFile({ path: p }) { if (f.readErr) throw new Error(f.readErr); if (!files.has(p)) throw new Error('File does not exist'); return { data: files.get(p) }; },
    async writeFile({ path: p, data }) { tick('write ' + p); files.set(p, data); },
    async appendFile({ path: p, data }) { tick('append ' + p); files.set(p, (files.get(p) || '') + data); },
    async rename({ from, to }) { tick('rename:delete ' + to); files.delete(to); tick('rename:renameTo'); if (!files.has(from)) throw new Error('File does not exist'); files.set(to, files.get(from)); files.delete(from); },
  };
  if (readdir) f.readdir = async () => ({ files: [...files.keys()].map((name) => ({ name, type: 'file' })) });
  if (del) f.deleteFile = async ({ path: p }) => { if (!files.has(p)) throw new Error('File does not exist'); files.delete(p); };
  if (stat) f.stat = async ({ path: p }) => { if (!files.has(p)) throw new Error('File does not exist'); return { type: 'file' }; };
  return f;
}
const big = (tag) => ({ v: 1, tag, data: { ct: 'Q'.repeat(5000) } });
const small = (tag) => ({ v: 1, tag, data: { ct: 'q'.repeat(50) } });
const CH = { chunk: 1000 };
const tmpNames = (f) => [...f.files.keys()].filter((n) => /^vault\.tmp/.test(n));

// ---------------- A1 ----------------
test('A1/S1: пустой vault.dat (truncate без данных) -> VAULT_CORRUPT, НЕ null «сейфа нет»', async () => {
  assert.equal(parseVault(''), undefined, 'пустая строка = повреждён');
  assert.equal(parseVault(null), null, 'null = файла нет');
  const f = capFs(); f.files.set('vault.dat', '');
  await assert.rejects(makeStore(makeFsBackend(f, CH)).load(), (e) => e.code === 'VAULT_CORRUPT');
});

test('A1/S2: vault.dat нет, временный файл недописан -> VAULT_CORRUPT; null только когда нет НИЧЕГО', async () => {
  for (const name of ['vault.tmp', 'vault.tmp.1', 'vault.tmp.7']) {
    const f = capFs(); f.files.set(name, '{"v":1,"data":{"ct":"QQQ');
    await assert.rejects(makeStore(makeFsBackend(f, CH)).load(), (e) => e.code === 'VAULT_CORRUPT', name);
  }
  assert.equal(await makeStore(makeFsBackend(capFs(), CH)).load(), null);
});

for (const mode of [{ readdir: true, del: true }, { readdir: false, del: false }]) {
  test('A1/S3 (' + (mode.readdir ? 'readdir' : 'без readdir - пробуем имена') + '): обрыв ВНУТРИ rename -> загрузка из tmp, tmp СРАЗУ становится vault.dat; следующая прерванная запись данных не губит', async () => {
    const f = capFs(mode); const st = makeStore(makeFsBackend(f, CH));
    await st.save(big('A'));
    f.log.length = 0;
    f.killAfter(7);   // writeFile + 5 appendFile + delete(vault.dat) -> 8-я операция (renameTo) умирает
    await st.save(big('B')).catch(() => {});
    f.revive();
    assert.ok(!f.files.has('vault.dat'), 'сценарий: vault.dat удалён, rename не завершён');
    const st2 = makeStore(makeFsBackend(f, CH));
    assert.equal((await st2.load()).tag, 'B', 'данные взяты из целого временного файла');
    assert.equal(JSON.parse(f.files.get('vault.dat')).tag, 'B', 'tmp сразу переименован в vault.dat (до любых записей)');
    f.killAfter(2);   // следующая большая запись обрывается на втором appendFile
    await st2.save(big('C')).catch(() => {});
    f.revive();
    assert.equal((await makeStore(makeFsBackend(f, CH)).load()).tag, 'B', 'прерванная запись C не затёрла B (раньше - null)');
  });
}

test('A1: метка «сейф создан» + файла нет -> startCorrupt, а не демо/создание (исходный заслон boot)', () => {
  const i = APP.indexOf('async function boot()');
  const body = APP.slice(i, APP.indexOf('\n}\n', i));
  assert.match(body, /if \(!hasVault && !corrupt && vaultMarked\(\)\) \{ corrupt = true; missing = true; \}/);
  assert.match(body, /if \(hasVault\) markVaultCreated\(\);/, 'существующий сейф получает метку при старте');
  assert.ok(body.indexOf('vaultMarked()') < body.indexOf("route === 'demo'"), 'проверка метки ДО демо');
});

test('A1: onSetup заново читает диск ПЕРЕД store.save и отказывает, если там что-то есть', () => {
  const i = APP.indexOf('async function onSetupInner()');
  const body = APP.slice(i, APP.indexOf('\n}\n', i));
  const load = body.indexOf('store.load('), save = body.indexOf('await store.save(file)');
  assert.ok(load > 0 && save > load, 'store.load() должен идти до store.save()');
  assert.match(body.slice(load, save), /if \(existing\) \{[\s\S]*?return;/, 'существующий/нечитаемый файл - отказ');
  assert.match(body, /await store\.save\(file\);\s*markVaultCreated\(\);/, 'метка ставится после успешной записи');
});

// ---------------- A4 ----------------
test('A4/S4: битый vault.dat + устаревший целый tmp -> VAULT_CORRUPT, старые данные НЕ всплывают', async () => {
  const f = capFs({ readdir: false, del: false });
  f.files.set('vault.tmp', JSON.stringify(big('OLD-big')));     // остаток версии 1.2.22
  f.files.set('vault.dat', JSON.stringify(small('NEW-2')).slice(0, 20));
  await assert.rejects(makeStore(makeFsBackend(f, CH)).load(), (e) => e.code === 'VAULT_CORRUPT');
});

test('A4/S6: обрыв посреди МАЛЕНЬКОЙ записи больше не портит vault.dat (пишем в tmp, потом rename)', async () => {
  const f = capFs(); const st = makeStore(makeFsBackend(f, CH));
  await st.save(small('REAL'));
  f.killAfter(0);                          // первая же операция следующей записи умирает
  await st.save(small('REAL2')).catch(() => {});
  f.revive();
  assert.equal((await makeStore(makeFsBackend(f, CH)).load()).tag, 'REAL', 'vault.dat цел');
});

test('A4: после успешной записи остатки временных файлов удаляются (и старый vault.tmp 1.2.22)', async () => {
  const f = capFs();
  f.files.set('vault.tmp', 'мусор 1.2.22');
  f.files.set('vault.tmp.5', '{"v":1,"da');
  const st = makeStore(makeFsBackend(f, CH));
  await st.save(big('X'));
  await st.save(small('Y'));
  assert.deepEqual(tmpNames(f), [], 'временных файлов не осталось');
  assert.equal(JSON.parse(f.files.get('vault.dat')).tag, 'Y');
});

// ---------------- A5 ----------------
test('A5/S5: ошибка чтения (не «файла нет») -> VAULT_READ, а НЕ null (демо поверх живого сейфа)', async () => {
  const f = capFs(); f.files.set('vault.dat', JSON.stringify(small('REAL')));
  f.readErr = 'Unable to read file';
  await assert.rejects(makeStore(makeFsBackend(f, CH)).load(), (e) => e.code === 'VAULT_READ');
  assert.ok(isMissingFileError(new Error('File does not exist')));
  assert.ok(!isMissingFileError(new Error('Unable to read file')));
});

test('A5: неоднозначная ошибка чтения уточняется через stat: файла нет -> null, есть -> VAULT_READ', async () => {
  const f = capFs({ stat: true }); f.readErr = 'EMFILE: too many open files';
  assert.equal(await makeStore(makeFsBackend(f, CH)).load(), null, 'stat: файла нет - честное «сейфа нет»');
  f.files.set('vault.dat', JSON.stringify(small('REAL')));
  await assert.rejects(makeStore(makeFsBackend(f, CH)).load(), (e) => e.code === 'VAULT_READ');
});

test('A5: boot - таймаут чтения и ошибка чтения ведут на экран «Повторить» (startReadError), не в демо', () => {
  const i = APP.indexOf('async function boot()');
  const body = APP.slice(i, APP.indexOf('\n}\n', i));
  // 1.2.24 (п.4): таймаут по отсутствию прогресса, «Повторить» ждёт уже идущее чтение (bootLoader).
  assert.match(body, /bootLoader\.wait\(BOOT_LOAD_TIMEOUT_MS, 'load-timeout'\)/);
  assert.match(body, /else return startReadError\(e\);/);
  const r = APP.slice(APP.indexOf('async function startReadError('), APP.indexOf('function pickBackupFile()'));
  assert.ok(!/enterDemo\(|startSetup\(|newVaultFile\(|store\.save\(/.test(r), 'экран ошибки чтения ничего не создаёт и не пишет');
  assert.match(r, /label: 'Повторить'/);
});

// ---------------- A3: сторож записи ----------------
test('A3/P1: навсегда подвисшая запись бросается сторожем, следующие правки записываются (раньше - никогда)', async () => {
  let disk = 'v0', calls = 0;
  const backend = { read: async () => disk, write: (s) => { calls++; if (calls === 1) return new Promise(() => {}); disk = s; return Promise.resolve(); } };
  const store = makeStore(backend, { watchdogMs: 40 });
  let mem = 'v1';
  const changes = [];
  const save = makeSerialSaver(async (setStage) => { setStage('write'); await store.save(mem); }, { timeoutMs: 20, watchdogMs: 60, onChange: (s) => changes.push(s) });
  const r = [];
  r.push(await save().then(() => 'ok', (e) => e.code));
  mem = 'v2'; r.push(await save().then(() => 'ok', (e) => e.code));
  mem = 'v3'; save().catch(() => {});
  await sleep(300);
  assert.equal(r[0], 'write-timeout', 'вызывающий уведомлён таймаутом');
  assert.equal(JSON.parse(disk), 'v3', 'последняя правка на диске (было: v0 навсегда)');
  assert.equal(save.unsaved(), false, 'незаписанного не осталось');
  assert.ok(changes.some((s) => s.unsaved && (s.late || s.failed)), 'баннер «не записано» включался');
  assert.equal(changes.at(-1).unsaved, false, 'баннер снят после записи');
});

test('A3: брошенная запись пишет в НОВЫЙ временный файл, проснувшаяся старая НЕ делает rename устаревшего', async () => {
  const f = capFs();
  let hold = null;
  const origAppend = f.appendFile;
  let n = 0;
  f.appendFile = async (o) => { n++; if (n === 1) { await new Promise((r) => { hold = r; }); } return origAppend.call(f, o); };
  const st = makeStore(makeFsBackend(f, CH), { watchdogMs: 30 });
  const p1 = st.save(big('STALE'));
  await assert.rejects(p1, (e) => e.code === 'write-hung');
  await st.save(big('FRESH'));
  assert.equal(JSON.parse(f.files.get('vault.dat')).tag, 'FRESH');
  assert.ok(f.log.some((l) => l === 'write vault.tmp.2'), 'вторая попытка - в новый файл vault.tmp.2');
  hold();                                       // зависшая запись «просыпается»
  await sleep(20);
  assert.equal(JSON.parse(f.files.get('vault.dat')).tag, 'FRESH', 'устаревшая попытка не переименовала себя в vault.dat');
});

test('A3: makeSerialSaver - alive() брошенного run становится false (не подменит state устаревшим)', async () => {
  let aliveFn = null, release;
  let runs = 0;
  const save = makeSerialSaver(async (setStage, alive) => { runs++; if (runs === 1) { aliveFn = alive; await new Promise((r) => { release = r; }); } }, { timeoutMs: 1000, watchdogMs: 30 });
  await assert.rejects(save(), (e) => /-hung$/.test(e.code));
  assert.equal(aliveFn(), false, 'брошенный run знает, что он брошен');
  await save.settled();
  await sleep(10);
  assert.ok(runs >= 2, 'после брошенной записи очередь сама пишет заново');
  release();
});

// ---------------- A2: ожидание очереди перед reload/OTA ----------------
test('A2/P2: блокировка ждёт очередь записи: правка на диске ДО перезагрузки (было: OLD)', async () => {
  let disk = 'OLD';
  const backend = { read: async () => disk, write: async (s) => { await sleep(250); disk = s; } };
  const store = makeStore(backend);
  const save = makeSerialSaver(async () => { await store.save('NEW-EDIT'); }, { timeoutMs: 15000 });
  save().catch(() => {});
  await sleep(100);                                   // пользователь жмёт замок через 100 мс
  const drained = await drainQueue(save.settled, 10000);
  assert.equal(drained, true);
  assert.equal(JSON.parse(disk), 'NEW-EDIT', 'правка записана до reload');
  assert.equal(save.unsaved(), false);
});

test('A2: drainQueue не ждёт вечно подвисшую запись (потолок) и честно говорит «не дождались»', async () => {
  const save = makeSerialSaver(() => new Promise(() => {}), { timeoutMs: 200, watchdogMs: 0 });
  save().catch(() => {});
  const t0 = Date.now();
  assert.equal(await drainQueue(save.settled, 60), false);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(save.unsaved(), true, 'незаписанное остаётся - lockNow покажет предупреждение');
});

test('A2: lockNow ждёт очередь (drain) ДО reload и помечает «не записано» при таймауте', () => {
  const i = APP.indexOf('async function lockNow()');
  const body = APP.slice(i, APP.indexOf('\n}\n', i));
  const d = body.indexOf('await lockDrain()'), r = body.indexOf('location.reload()'), n = body.indexOf('state.vault = null');
  assert.ok(d > 0 && d < n && n < r, 'порядок: дождаться очереди -> обнулить ключи -> reload');
  assert.match(body, /if \(unsaved\) \{[^\n]*UNSAVED_AT_LOCK_KEY/);
  assert.match(APP, /await drainWithRetry\(serialSave, DRAIN_MS\);/, '1.2.24 п.5: упавшая запись повторяется один раз');
});

function loadUpdate(win) {
  const code = fs.readFileSync(path.join(HERE, '..', 'www', 'update.js'), 'utf8');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, globalThis, console, window: win, setTimeout, clearTimeout });
  return mod.exports;
}
test('A2: OTA apply НЕ начинается (и ничего не качает), пока очередь записи не пуста', async () => {
  // Манифест подписан тестовой парой ключей (блок D): иначе apply откажет ещё на подписи, и тест
  // не отличил бы заслон очереди от заслона подписи (мутация «apply не ждёт очередь» прошла бы).
  const subtle = globalThis.crypto.subtle;
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pubB64 = Buffer.from(await subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  const man = { build: 'release', version: '1.2.0', apkUrl: 'https://dorokhin-finance.ru/seyf-store/seyf-1.2.0.apk', size: 1, notes: '',
    web: { version: '9.9.9', url: 'https://dorokhin-finance.ru/seyf-store/www-9.9.9.zip', sha256: 'a'.repeat(64), size: 1, minShell: '1.0.0' } };
  const U0 = loadUpdate({});
  const data = await U0.manifestSigData(man, { subtle });
  man.sig = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(data))).toString('base64url');
  const web = () => ({ ...man.web, signed: man });
  const plugins = { Filesystem: {}, WebView: {} };
  let fetched = 0, drainAsked = 0;
  const fetch = async () => { fetched++; throw new Error('net'); };
  const U = loadUpdate({ SeyfSave: { pending: () => true, drain: async () => { drainAsked++; return false; } } });
  const ok = await U.apply(web(), { plugins, otaPubKeyB64: pubB64, fetch });
  assert.equal(ok, false);
  assert.equal(drainAsked, 1, 'сперва ждём очередь');
  assert.equal(fetched, 0, 'при незаписанных изменениях обновление даже не скачивается (подпись при этом верная)');
  assert.ok(U.ERR.unsaved && !/—/.test(U.ERR.unsaved));
  // очередь пуста -> идём дальше (до скачивания)
  const U2 = loadUpdate({ SeyfSave: { pending: () => false, drain: async () => true } });
  await U2.apply(web(), { plugins, otaPubKeyB64: pubB64, fetch });
  assert.equal(fetched, 1, 'пустая очередь + верная подпись - скачивание началось');
});

// ---------------- A7: стрелки порядка внутри группы ----------------
test('A7: стрелки считаются внутри группы (избранные/обычные); на границе группы кнопка неактивна', () => {
  const E = [{ id: 'a', favorite: true }, { id: 'b' }, { id: 'c', favorite: true }, { id: 'd' }];
  assert.deepEqual(displayOrder(E).map((e) => e.id), ['a', 'c', 'b', 'd']);
  assert.deepEqual(arrowState(E, 'a'), { up: false, down: true });
  assert.deepEqual(arrowState(E, 'c'), { up: true, down: false }, '↓ у последней избранной неактивна');
  assert.deepEqual(arrowState(E, 'b'), { up: false, down: true }, '↑ у первой обычной неактивна (было: активна и ничего не делала)');
  assert.deepEqual(arrowState(E, 'd'), { up: true, down: false });
  assert.equal(moveWithinGroup(E, 'b', -1).moved, false);
  const r = moveWithinGroup(E, 'd', -1);
  assert.equal(r.moved, true);
  assert.deepEqual(displayOrder(r.entries).map((e) => e.id), ['a', 'c', 'd', 'b']);
});

test('A7: два быстрых тапа до перерисовки применяются оба (по id и текущему массиву, не по снимку)', () => {
  let arr = ['A', 'B', 'C', 'D'].map((id) => ({ id }));
  arr = moveWithinGroup(arr, 'C', -1).entries;   // ↑ C
  arr = moveWithinGroup(arr, 'D', -1).entries;   // ↑ D (кнопка со «старой» отрисовки)
  assert.deepEqual(arr.map((e) => e.id), ['A', 'C', 'D', 'B']);
});

test('A7: избранное/порядок/удаление перерисовывают СРАЗУ, запись после (persistAfterRender)', () => {
  const fav = APP.slice(APP.indexOf('onToggleFav:'), APP.indexOf('onEdit:'));
  assert.ok(/persistAfterRender\(/.test(fav) && !/await saveFile\(\)/.test(fav), 'избранное: без ожидания записи перед перерисовкой');
  const p = APP.slice(APP.indexOf('function persistAfterRender('), APP.indexOf('function persistAfterRender(') + 600);
  assert.match(p, /close: \(\) => \{ try \{ refreshAfterMutation\(\); \}[\s\S]*persist: saveFile,[\s\S]*onFailed/);
});

// ---------------- A6, A8, A9 ----------------
test('A6: покупка прошла, а запись упала -> «Покупка прошла, но не записалась - нажмите «Восстановить покупку»», НЕ «платёж не прошёл»', () => {
  const m = APP.match(/const unlock = async \(info(?:, \w+)*\) => \{([\s\S]*?)\n  \};/);
  assert.ok(m);
  assert.match(m[1], /try \{ await saveFile\(\); \}/);
  assert.match(m[1], /Покупка прошла, но не записалась на устройство\. Нажмите «Восстановить покупку»/);
  assert.ok(!/Платёж не прошёл/.test(m[1]));
});

test('A8: резервная копия шифрует ТЕКУЩИЙ state.vault (свежая перешифровка), а не записанный state.file', () => {
  const i = APP.indexOf('async function doExport()');
  const body = APP.slice(i, APP.indexOf('\n}\n', i));
  assert.match(body, /const enc = await C\.reencryptData\(state\.file, state\.dek, state\.vault\);/);
  assert.match(body, /contents = JSON\.stringify\(\{ \.\.\.state\.file, data: enc\.data \}\);/);
  assert.ok(!/const contents = JSON\.stringify\(state\.file\)/.test(body));
  assert.ok(!/state\.file = /.test(body), 'копия не трогает state.file (его ведёт очередь записи)');
});

test('A9: смена пароля - try/catch + toast + откат обёртки в памяти; двойной тап «Создать сейф»; битый файл сохраняется перед восстановлением', () => {
  const cm = APP.slice(APP.indexOf('async function doChangeMaster'), APP.indexOf('function openProFlow'));
  // 1.2.25 (п.4): откат обёртки - по факту диска (wrapOnDisk): на диске старая -> откат + toast «не изменён».
  assert.match(cm, /\} else if \(onDisk === 'old'\) \{\s*state\.file = \{ \.\.\.state\.file, kdf: prev\.kdf, pwWrap: prev\.pwWrap \};\s*toast\('Мастер-пароль не изменён/);
  assert.match(APP, /if \(setupBusy\) return;\s*setupBusy = true;/);
  assert.match(APP, /if \(btn\) btn\.disabled = true;/);
  const rb = APP.slice(APP.indexOf('async function restoreFromBackupOnCorrupt'), APP.indexOf('function enterDemo'));
  assert.ok(rb.indexOf('store.preserveCorrupt(') > 0 && rb.indexOf('store.preserveCorrupt(') < rb.indexOf('await store.save(file)'), 'сначала сохранить битый файл');
});

test('A9: preserveCorrupt сохраняет сырой битый vault.dat как vault.corrupt-<ts>', async () => {
  const f = capFs(); f.files.set('vault.dat', 'garbage{{{');
  const st = makeStore(makeFsBackend(f, CH));
  assert.equal(await st.preserveCorrupt(123), true);
  assert.equal(f.files.get('vault.corrupt-123'), 'garbage{{{');
  assert.equal(await makeStore(makeFsBackend(capFs(), CH)).preserveCorrupt(1), false, 'сохранять нечего');
});
