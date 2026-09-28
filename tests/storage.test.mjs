import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from '../www/js/storage.js';

function fakeBackend() {
  let buf = null;
  return {
    read: async () => buf,
    write: async (s) => { buf = s; },
    _raw: () => buf,
  };
}

test('save затем load возвращает тот же объект', async () => {
  const b = fakeBackend();
  const store = makeStore(b);
  const file = { v: 1, pwWrap: { iv: 'a', ct: 'b' }, data: { iv: 'c', ct: 'd' } };
  await store.save(file);
  assert.deepEqual(await store.load(), file);
});

test('load на пустом хранилище возвращает null', async () => {
  const store = makeStore(fakeBackend());
  assert.equal(await store.load(), null);
});

test('save пишет строку JSON, а не объект', async () => {
  const b = fakeBackend();
  await makeStore(b).save({ v: 1 });
  assert.equal(typeof b._raw(), 'string');
  assert.equal(b._raw(), '{"v":1}');
});

// ---- 1.2.20: большой vault пишется кусками во временный файл + rename (не одним сообщением моста) ----
import { makeFsBackend, splitChunks, WRITE_CHUNK } from '../www/js/storage.js';

// Поддельный Capacitor Filesystem с семантикой Android-плагина 6.x: writeFile перезаписывает,
// appendFile дописывает, rename удаляет цель и переименовывает; readFile бросает, если файла нет.
function fakeCapFs() {
  const files = new Map();
  const calls = [];
  return {
    files, calls,
    async readFile({ path }) { if (!files.has(path)) throw new Error('File does not exist'); return { data: files.get(path) }; },
    async writeFile({ path, data }) { calls.push(['writeFile', path, data.length]); files.set(path, data); return {}; },
    async appendFile({ path, data }) { calls.push(['appendFile', path, data.length]); files.set(path, (files.get(path) || '') + data); return {}; },
    async rename({ from, to }) { calls.push(['rename', from, to]); if (!files.has(from)) throw new Error('no src'); files.delete(to); files.set(to, files.get(from)); files.delete(from); return {}; },
  };
}

// 1.2.23 (A4): маленький vault тоже пишется через временный файл + rename (раньше - writeFile прямо
// в vault.dat: обрыв посреди записи оставлял обрезанный/пустой vault.dat).
test('маленький vault: тоже через tmp + rename (атомарно), vault.dat напрямую НЕ пишется', async () => {
  const fs = fakeCapFs();
  const store = makeStore(makeFsBackend(fs, { chunk: 1000 }));
  await store.save({ v: 1, data: 'x'.repeat(100) });
  assert.deepEqual(fs.calls.map((c) => c[0] + ':' + c[1]), ['writeFile:vault.tmp.1', 'rename:vault.tmp.1']);
  assert.ok(!fs.calls.some((c) => c[0] === 'writeFile' && c[1] === 'vault.dat'), 'vault.dat не пишется напрямую');
  assert.deepEqual(await store.load(), { v: 1, data: 'x'.repeat(100) });
});

test('большой vault: куски <= chunk во vault.tmp.N (writeFile+appendFile), затем rename -> vault.dat; содержимое байт-в-байт', async () => {
  const fs = fakeCapFs();
  const file = { v: 1, data: { iv: 'abc', ct: 'Q'.repeat(10500) } };
  const store = makeStore(makeFsBackend(fs, { chunk: 1000 }));
  await store.save(file);
  const kinds = fs.calls.map((c) => c[0]);
  assert.equal(kinds[0], 'writeFile'); assert.equal(fs.calls[0][1], 'vault.tmp.1');
  assert.ok(kinds.slice(1, -1).every((k) => k === 'appendFile'), 'середина - только appendFile');
  assert.deepEqual(fs.calls.at(-1), ['rename', 'vault.tmp.1', 'vault.dat']);
  assert.ok(fs.calls.filter((c) => c[0] !== 'rename').every((c) => c[2] <= 1000), 'ни один кусок не больше chunk');
  assert.ok(!fs.files.has('vault.tmp.1'), 'tmp после rename убран');
  assert.equal(fs.files.get('vault.dat'), JSON.stringify(file), 'формат vault.dat прежний - та же JSON-строка');
  assert.deepEqual(await store.load(), file);
});

test('обрыв посреди большой записи: старый vault.dat цел (пишем в tmp, а не поверх)', async () => {
  const fs = fakeCapFs();
  fs.files.set('vault.dat', JSON.stringify({ v: 1, old: true }));
  let n = 0;
  const orig = fs.appendFile;
  fs.appendFile = async (o) => { if (++n === 3) throw new Error('crash'); return orig.call(fs, o); };
  const store = makeStore(makeFsBackend(fs, { chunk: 500 }));
  await assert.rejects(store.save({ v: 1, data: 'Z'.repeat(5000) }));
  assert.deepEqual(await store.load(), { v: 1, old: true }, 'прежний vault читается');
});

test('обрыв между удалением vault.dat и rename: чтение берёт целый vault.tmp', async () => {
  const fs = fakeCapFs();
  fs.files.set('vault.tmp', JSON.stringify({ v: 1, fromTmp: true }));
  const store = makeStore(makeFsBackend(fs));
  assert.deepEqual(await store.load(), { v: 1, fromTmp: true });
});

test('splitChunks: склейка = исходник, суррогатная пара не рвётся на краю куска', () => {
  const s = 'a'.repeat(9) + '😀' + 'b'.repeat(20);   // 😀 = пара на позициях 9-10
  const parts = splitChunks(s, 10);
  assert.equal(parts.join(''), s);
  for (const p of parts) {
    const last = p.charCodeAt(p.length - 1);
    assert.ok(!(last >= 0xD800 && last <= 0xDBFF), 'кусок не заканчивается high surrogate');
  }
  assert.equal(WRITE_CHUNK, 256 * 1024);
});

// ---- 1.2.20 [BLOCKER]: записи сериализованы - параллельные save не перемешивают vault.tmp ----
import { VaultCorruptError } from '../www/js/storage.js';

// Асинхронный fs со СЛУЧАЙНЫМИ задержками на каждой операции (как мост Capacitor): без очереди
// куски двух записей чередуются в vault.tmp. Снимки vault.dat на каждом rename - для проверки,
// что в vault.dat НИ РАЗУ не попал невалидный JSON.
function slowCapFs(seed = 7) {
  const fs = fakeCapFs();
  let x = seed;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const delay = () => new Promise((r) => setTimeout(r, Math.floor(rnd() * 6)));
  const snaps = [];
  for (const k of ['writeFile', 'appendFile', 'rename']) {
    const orig = fs[k];
    fs[k] = async (o) => { await delay(); const r = await orig.call(fs, o); if (k === 'rename' || o.path === 'vault.dat') snaps.push(fs.files.get('vault.dat')); return r; };
  }
  fs.snaps = snaps;
  return fs;
}

test('5 параллельных save на БОЛЬШОМ vault: vault.dat всегда валидный JSON и в конце = последнее состояние', async () => {
  for (const seed of [1, 7, 42, 99, 12345]) {
    const fs = slowCapFs(seed);
    const store = makeStore(makeFsBackend(fs, { chunk: 64 }));
    const states = [1, 2, 3, 4, 5].map((n) => ({ v: 1, n, data: { ct: String(n).repeat(700 + n * 37) } }));
    await Promise.all(states.map((s) => store.save(s)));
    for (const snap of fs.snaps) assert.doesNotThrow(() => JSON.parse(snap), 'в vault.dat попал мусор (seed ' + seed + ')');
    assert.deepEqual(await store.load(), states[4], 'итог - последнее состояние (seed ' + seed + ')');
  }
});

test('коалесцинг: пока идёт запись A, вызовы B,C,D сливаются в ОДНУ запись с последними данными', async () => {
  const writes = [];
  let release;
  const backend = {
    read: async () => null,
    write: (s) => { writes.push(JSON.parse(s).n); return writes.length === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(); },
  };
  const store = makeStore(backend);
  const pA = store.save({ v: 1, n: 'A' });
  await new Promise((r) => setImmediate(r));
  const pB = store.save({ v: 1, n: 'B' }), pC = store.save({ v: 1, n: 'C' }), pD = store.save({ v: 1, n: 'D' });
  assert.deepEqual(writes, ['A'], 'пока A не завершилась, вторая запись НЕ стартует');
  release();
  await Promise.all([pA, pB, pC, pD]);
  assert.deepEqual(writes, ['A', 'D'], 'B и C поглощены свежей D');
});

// ---- 1.2.20 [HIGH]: битый файл - НЕ «сейфа нет» ----
// 1.2.23 (A4): битый vault.dat + целый vault.tmp -> VaultCorruptError, а НЕ tmp. Рядом с битым
// vault.dat целый tmp - всегда устаревший (от брошенной большой записи до мелких правок): раньше
// он молча подставлялся, и сейф откатывался на старые данные без единого слова (ревью S4).
test('load: битый vault.dat + целый (устаревший) vault.tmp -> VaultCorruptError, старьё НЕ подставляется', async () => {
  const fs = fakeCapFs();
  fs.files.set('vault.dat', '{"v":1,"data":{"ct":"AAA');           // обрезан
  fs.files.set('vault.tmp', JSON.stringify({ v: 1, ok: 'tmp' }));
  await assert.rejects(makeStore(makeFsBackend(fs)).load(), (e) => e.code === 'VAULT_CORRUPT');
});

test('load: vault.dat и vault.tmp битые -> VaultCorruptError (код VAULT_CORRUPT), НЕ null', async () => {
  const fs = fakeCapFs();
  fs.files.set('vault.dat', 'garbage{{{');
  fs.files.set('vault.tmp', '{"v":1,"da');
  await assert.rejects(makeStore(makeFsBackend(fs)).load(), (e) => e instanceof VaultCorruptError && e.code === 'VAULT_CORRUPT');
  const fs2 = fakeCapFs();
  fs2.files.set('vault.dat', 'garbage');                             // tmp нет вовсе
  await assert.rejects(makeStore(makeFsBackend(fs2)).load(), (e) => e.code === 'VAULT_CORRUPT');
  const fs3 = fakeCapFs();
  fs3.files.set('vault.dat', '{"hello":1}');                         // JSON, но не файл сейфа
  await assert.rejects(makeStore(makeFsBackend(fs3)).load(), (e) => e.code === 'VAULT_CORRUPT');
});

test('load: файла нет вовсе -> null (честный первый запуск), битого нет - ошибки нет', async () => {
  assert.equal(await makeStore(makeFsBackend(fakeCapFs())).load(), null);
});
