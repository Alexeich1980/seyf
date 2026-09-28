// fixes-1225.test.mjs - заслоны 1.2.25: пункты 1-9 ревью 1.2.24 (вердикт «можно на тест», закрыть до
// боевого релиза). Пруф-скрипты ревьюера (review3/proofs.mjs P1-P5, clock.mjs, mkbk.cjs+pubcheck.py)
// показывали СТАРОЕ поведение; здесь - требуемое НОВОЕ, машинно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeStore, makeFsBackend, parseVault, newestBySeq, newestFirst } from '../www/js/storage.js';
import { makeSerialSaver, makeSharedLoader, wrapOnDisk, STALE_FACTOR } from '../www/js/persist.js';
import { makeClipFlag } from '../www/js/clipboard.js';
import { endOnlyMask } from '../www/js/fieldinput.js';
import { formatExpiryLive, expiryRawOk, normalizeExpiryInput, checkCardExpiry } from '../www/js/cardexp.js';
import * as Docs from '../www/js/documents.js';
import { transparentFixedOffenders } from '../tools/css-overlay-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const WWW = path.join(ROOT, 'www');
const APP = fs.readFileSync(path.join(WWW, 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(WWW, 'css', 'app.css'), 'utf8');
const tick = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
// Строгий fnBody: конец функции ОБЯЗАН найтись (при CRLF '\n}\n' не находился, и срез молча шёл до
// конца файла - заслон слабел, а не падал).
const fnBody = (name) => {
  const i = APP.indexOf(name); assert.ok(i >= 0, 'нет ' + name);
  const j = APP.indexOf('\n}\n', i); assert.ok(j > i, 'конец функции ' + name + ' не найден (переводы строк?)');
  return APP.slice(i, j);
};

// ============================ заслон: переводы строк исходников (урок 1.2.25) ============================
test('исходники с заслонами-по-тексту - только LF (CRLF молча ослаблял fnBody-заслоны)', () => {
  const files = ['www/js/app.js', 'www/js/storage.js', 'www/js/persist.js', 'www/js/documents.js', 'www/js/cardexp.js',
    'www/js/clipboard.js', 'www/js/fieldinput.js', 'www/update.js', 'www/css/app.css', 'publish-update.py']
    // публичный репозиторий: внутреннего скрипта публикации нет - проверяем только то, что есть
    .filter((f) => f !== 'publish-update.py' || fs.existsSync(path.join(ROOT, f)));
  const bad = files.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('\r\n'));
  assert.deepEqual(bad, [], 'CRLF в: ' + bad.join(', ') + ' (правка из Python в текстовом режиме на Windows? писать с newline="")');
});

// ============================ п.1: срок карты - сырой ввод ============================
test('п.1 (P1 ревьюера): вставка/ввод в середину больше не сохраняется молча неверно', () => {
  // «12/29»: каретка после «/», набрано «30» -> «12/3029»; после «/» «3» -> «12/329»; после «1» «1» -> «112/29»
  // + вставка целиком в конец (маска работает): «1212/29», «12/3029», «1/229» больше не обрезаются до 12/12, 12/29, 12/29
  for (const [raw, caret] of [['12/3029', 5], ['12/329', 4], ['112/29', 2], ['1212/29', 2], ['1212/29', 7], ['12/3029', 7], ['1/229', 5], ['12/295', 6], ['121229', 6]]) {
    const shown = endOnlyMask(raw, caret, formatExpiryLive).value;     // правка в середине - маска не трогает
    const blurred = normalizeExpiryInput(shown);                         // blur не обрезает в «валидное»
    assert.equal(blurred, shown, 'blur оставил «' + shown + '» как есть (было: ' + formatExpiryLive(shown) + ')');
    assert.deepEqual(checkCardExpiry(blurred, ''), { ok: false, reason: 'format' }, raw + ' -> «Проверьте срок»');
  }
});
test('п.1: законные формы по-прежнему проходят и приводятся к ММ/ГГ', () => {
  const now = new Date(2026, 8, 23).getTime();
  const ok = { '12/29': '12/29', '1229': '12/29', '1/29': '01/29', '12/2029': '12/29', '1/2029': '01/29', '122029': '12/29',
    '12 29': '12/29', '12.29': '12/29', '12-2029': '12/29', ' 12/29 ': '12/29' };
  for (const [raw, want] of Object.entries(ok)) {
    const r = checkCardExpiry(raw, '', now);
    assert.equal(r.ok, true, raw); assert.equal(r.value, want, raw); assert.equal(r.passed, false, raw);
  }
  assert.deepEqual(checkCardExpiry('', ''), { ok: true, value: '', passed: false, untouched: false });
  assert.equal(checkCardExpiry('12/20', '', now).passed, true, 'прошедший срок - спросить подтверждение');
});
test('п.1: месяц 13+ и мусор не превращаются в «валидное»', () => {
  for (const raw of ['13/29', '13/2029', '1329', '00/29', '12/3029', '12/329', '1212/29', '112/29', '132029', '12/29x', '1/2/29', '12//29', '12/9', '12/202', 'abc'])
    assert.equal(checkCardExpiry(raw, '').ok, false, raw);
  assert.equal(expiryRawOk('12/3029'), false);
  assert.equal(expiryRawOk('12/2029'), true);
  assert.equal(normalizeExpiryInput('12/3029'), '12/3029');
  assert.equal(normalizeExpiryInput('1/2029'), '01/29');
});
test('п.1: нетронутое старое значение (даже невалидное) не блокирует сохранение', () => {
  assert.deepEqual(checkCardExpiry('13/29', '1329'), { ok: true, value: '13/29', passed: false, untouched: true });
  assert.equal(checkCardExpiry('08/20', '08/20').passed, false, 'нетронутый старый срок не переспрашиваем');
  assert.equal(checkCardExpiry('13/29', '1229').ok, false, 'правленое - проверяется');
});
test('п.1: редактор решает по СЫРОМУ полю ДО formatExpiryLive; на blur - normalizeExpiryInput', () => {
  const i = APP.indexOf("if (section === 'cards') {\n        // 1.2.25 (п.1)");
  assert.ok(i > 0);
  const body = APP.slice(i, i + 1500);
  assert.match(body, /const ce = checkCardExpiry\(patch\.expiry, entry \? \(entry\.expiry \|\| ''\) : ''\);\s*if \(!ce\.ok\) \{\s*await dlgAlert\([^;]*Проверьте срок[^;]*;\s*return;\s*\}\s*patch\.expiry = ce\.value;/);
  assert.ok(!/formatExpiryLive\(patch\.expiry\)/.test(APP), 'сырой ввод больше не форматируется до проверки');
  assert.match(APP, /endOnly: true, normalize: normalizeExpiryInput, onlyEdited: true \}/);   // 1.3.0 (Info)
});

// ============================ п.2: publish-update.py - по умолчанию только основной ключ ============================
function pyOk() { try { return spawnSync('python', ['-c', 'import cryptography']).status === 0; } catch (e) { return false; } }
test('п.2: publish-update.py принимает подпись резервным ключом ТОЛЬКО с --backup-key и предупреждает про 1.2.23', { skip: (!fs.existsSync(path.join(ROOT, 'publish-update.py')) && 'внутренний файл не входит в публичный репозиторий') || (!pyOk() && 'нет python+cryptography') }, async () => {
  const subtle = globalThis.crypto.subtle;
  const mk = async () => { const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); return { kp, pub: Buffer.from(await subtle.exportKey('raw', kp.publicKey)).toString('base64url') }; };
  const main = await mk(), backup = await mk();
  const src = fs.readFileSync(path.join(WWW, 'update.js'), 'utf8')
    .replace(/var OTA_PUB_KEY_B64 = '[^']+'/, "var OTA_PUB_KEY_B64 = '" + main.pub + "'")
    .replace(/var OTA_PUB_KEY_BACKUP_B64 = '[^']+'/, "var OTA_PUB_KEY_BACKUP_B64 = '" + backup.pub + "'");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-p2-'));
  const here = path.join(root, 'x', 'mobile');
  fs.mkdirSync(path.join(here, 'out', 'store'), { recursive: true });
  fs.mkdirSync(path.join(here, 'www'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'publish-update.py'), path.join(here, 'publish-update.py'));
  fs.writeFileSync(path.join(here, 'www', 'update.js'), src);
  const { loadUMD } = { loadUMD: (f) => { const m = { exports: {} }; new Function('module', 'exports', fs.readFileSync(f, 'utf8'))(m, m.exports); return m.exports; } };
  const U = loadUMD(path.join(here, 'www', 'update.js'));
  const man = { build: 'release', version: '1.2.0', apkUrl: 'https://dorokhin-finance.ru/seyf-store/seyf-1.2.0.apk', size: 1, notes: 'n',
    web: { version: '9.9.9', url: 'https://dorokhin-finance.ru/seyf-store/www-9.9.9.zip', sha256: 'a'.repeat(64), size: 1, minShell: '1.0.0' } };
  const sign = async (priv) => { const data = await U.manifestSigData(man, { subtle }); return Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(data))).toString('base64url'); };
  const run = (m, args = []) => {
    fs.writeFileSync(path.join(here, 'out', 'store', 'update.json'), JSON.stringify(m));
    const r = spawnSync('python', [path.join(here, 'publish-update.py'), ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    return (r.stdout || '') + (r.stderr || '');
  };
  try {
    const byBackup = { ...man, sig: await sign(backup.kp.privateKey) };
    const noFlag = run(byBackup);
    assert.match(noFlag, /только с РЕЗЕРВНЫМ ключом/, 'без флага - отказ (было: «проверена»)');
    assert.match(noFlag, /--backup-key/);
    assert.match(noFlag, /1\.2\.23 и старше такое обновление не примут/);
    assert.match(noFlag, /Ничего не залито/);
    assert.ok(!/подпись манифеста проверена/.test(noFlag));
    const withFlag = run(byBackup, ['--backup-key']);
    assert.match(withFlag, /\[!\] манифест подписан РЕЗЕРВНЫМ ключом \(--backup-key\): установленные 1\.2\.23 и старше/);
    assert.match(withFlag, /подпись манифеста проверена \(ECDSA P-256, РЕЗЕРВНЫЙ ключ/);
    assert.ok(!/опубликовано/.test(withFlag), 'в тесте ничего не залито (нет ключа Яндекса)');
    const byMain = run({ ...man, sig: await sign(main.kp.privateKey) });
    assert.match(byMain, /подпись манифеста проверена \(ECDSA P-256, основной ключ/);
    assert.ok(!/\[!\]/.test(byMain));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ============================ п.3: «Повторить» при навсегда повисшем чтении ============================
test('п.3 (P3 ревьюера): чтение без пульса дольше 3x таймаута простоя бросается, «Повторить» начинает новое', async () => {
  assert.equal(STALE_FACTOR, 3);
  let t = 0, starts = 0; const resolvers = [];
  const L = makeSharedLoader(() => { starts++; return new Promise((r) => resolvers.push(r)); }, { now: () => t });
  await assert.rejects(L.wait(20), (e) => e.code === 'load-timeout');
  assert.equal(starts, 1);
  t = 60;                                               // пульса нет 60 мс <= 3x20 - ждём то же чтение
  await assert.rejects(L.wait(20), (e) => e.code === 'load-timeout');
  assert.equal(starts, 1, 'не дольше 3x таймаута - то же чтение');
  t = 61;                                               // > 3x20 - чтение считается потерянным
  const again = L.wait(20);
  await tick();
  assert.equal(starts, 2, 'новое чтение (было: вечно одно и то же, reads started: 1)');
  resolvers[0]({ v: 1, tag: 'STALE' });                 // поздний ответ брошенного чтения ни на что не влияет
  resolvers[1]({ v: 1, tag: 'FRESH' });
  assert.equal((await again).tag, 'FRESH');
});
test('п.3: медленное, но живое чтение (пульс) не бросается', async () => {
  let t = 0, starts = 0, beatFn = null, done = null;
  const L = makeSharedLoader((beat) => { starts++; beatFn = beat; return new Promise((r) => { done = r; }); }, { now: () => t });
  await assert.rejects(L.wait(20), (e) => e.code === 'load-timeout');
  await tick();
  t = 1000; beatFn();                                   // пульс свежий
  t = 1050;
  const w = L.wait(20);
  done({ v: 1, big: true });
  assert.deepEqual(await w, { v: 1, big: true });
  assert.equal(starts, 1);
});

// ============================ п.4: после rename запись состоялась ============================
function memFs({ hangReaddirAt = 0 } = {}) {
  const files = new Map(); let rd = 0; const log = []; let releaseRd = null;
  return {
    files, log, release: () => releaseRd && releaseRd(),
    readFile: async ({ path: p }) => { if (!files.has(p)) throw new Error('File does not exist'); return { data: files.get(p) }; },
    writeFile: async ({ path: p, data }) => { log.push('write ' + p); files.set(p, data); },
    appendFile: async ({ path: p, data }) => { log.push('append ' + p); files.set(p, files.get(p) + data); },
    rename: async ({ from, to }) => { log.push('rename ' + from + '>' + to); if (!files.has(from)) throw new Error('The source object does not exist'); files.delete(to); files.set(to, files.get(from)); files.delete(from); },
    readdir: async () => { rd++; const snap = () => ({ files: [...files.keys()].map((name) => ({ name, mtime: 1 })) }); if (rd === hangReaddirAt) return new Promise((r) => { releaseRd = () => r(snap()); }); return snap(); },
    deleteFile: async ({ path: p }) => { log.push('delete ' + p); files.delete(p); },
  };
}
test('п.4 (P4 ревьюера): уборка зависла ПОСЛЕ rename -> запись успешна, баннера «не записано» нет', async () => {
  const f = memFs({ hangReaddirAt: 2 });                // 1-й readdir - выбор имени, 2-й - уборка: виснет
  f.files.set('vault.dat', '{"v":1,"n":0}');
  const store = makeStore(makeFsBackend(f), { watchdogMs: 30 });
  let st = null;
  const save = makeSerialSaver(async (setStage, alive, beat) => { setStage('write'); await store.save({ v: 1, n: 1 }, { onProgress: beat }); }, { watchdogMs: 500, timeoutMs: 1000, onChange: (s) => { st = s; } });
  await save();                                          // было: write-hung
  assert.equal(f.files.get('vault.dat'), '{"v":1,"n":1}');
  assert.deepEqual(save.status(), { unsaved: false, failed: false, late: false });
  assert.equal(st.unsaved, false);
  // брошенная уборка, проснувшись, не трогает tmp следующей записи (эпоха)
  await store.save({ v: 1, n: 2 });
  f.release(); await tick(60);
  await store.save({ v: 1, n: 3 });
  assert.deepEqual(JSON.parse(f.files.get('vault.dat')), { v: 1, n: 3 });
});
test('п.4: до rename сторож по-прежнему отклоняет (write-hung); ошибка уборки после rename - успех', async () => {
  const hang = makeStore({ read: async () => null, write: () => new Promise(() => {}) }, { watchdogMs: 20 });
  await assert.rejects(hang.save({ v: 1 }), (e) => e.code === 'write-hung');
  const after = makeStore({ read: async () => null, write: async (s, onChunk, onCommit) => { onCommit(); throw new Error('readdir failed'); } }, { watchdogMs: 20 });
  await after.save({ v: 1 });                            // не бросает
  const before = makeStore({ read: async () => null, write: async () => { throw new Error('Unable to rename'); } }, { watchdogMs: 20 });
  await assert.rejects(before.save({ v: 1 }), /Unable to rename/);
});
test('п.4: смена мастер-пароля - по факту диска (wrapOnDisk), не по исходу записи', () => {
  const prev = { kdf: { salt: 'a', n: 1 }, pwWrap: { iv: 'x', ct: 'OLD' } };
  const next = { kdf: { salt: 'b', n: 1 }, pwWrap: { iv: 'y', ct: 'NEW' } };
  assert.equal(wrapOnDisk({ v: 1, ...next, data: 'd' }, next, prev), 'new');
  assert.equal(wrapOnDisk(JSON.parse(JSON.stringify({ v: 1, ...prev })), next, prev), 'old');
  assert.equal(wrapOnDisk({ v: 1, kdf: prev.kdf, pwWrap: { iv: 'z', ct: '?' } }, next, prev), 'unknown');
  assert.equal(wrapOnDisk(null, next, prev), 'unknown');
  assert.equal(wrapOnDisk(undefined, next, prev), 'unknown');
  const cm = fnBody('async function doChangeMaster()');
  assert.match(cm, /onDisk = wrapOnDisk\(await withTimeout\(store\.peek\(\), 10000, 'verify-timeout'\), next, prev\);/);
  assert.match(cm, /if \(onDisk === 'new'\) \{\s*toast\('Мастер-пароль изменён'\);\s*\}/, 'на диске новая - пароль изменён, память НЕ откатываем');
  // 1.3.0 (M1): после отката в памяти - saveFile(), чтобы диск сошёлся с памятью (tests/backlog-130.test.mjs).
  assert.match(cm, /\} else \{\s*state\.file = \{ \.\.\.state\.file, kdf: prev\.kdf, pwWrap: prev\.pwWrap \};\s*saveFile\(\)\.catch\(\(\) => \{\}\);[^\n]*\s*await dlgAlert\('Не удалось проверить/);
});
test('п.4: store.peek читает vault.dat без подстановки tmp и без переименований', async () => {
  const f = memFs(); f.files.set('vault.tmp.1', '{"v":1}');
  const st = makeStore(makeFsBackend(f));
  assert.equal(await st.peek(), null);
  assert.ok(f.files.has('vault.tmp.1') && !f.log.some((l) => l.startsWith('rename')));
  f.files.set('vault.dat', '{"v":1,"pwWrap":{"ct":"A"}}');
  assert.deepEqual(await st.peek(), { v: 1, pwWrap: { ct: 'A' } });
});

// ============================ п.5: номер записи надёжнее часов ============================
test('п.5 (clock.mjs ревьюера): при readdir берётся МАКСИМАЛЬНЫЙ номер, даже если часы остатка «впереди»', async () => {
  const f = memFs();
  f.files.set('vault.tmp.3', '{"v":1,"ver":"OLD"}');
  f.files.set('vault.tmp.4', '{"v":1,"ver":"NEW"}');
  const mt = { 'vault.tmp.3': Date.UTC(2027, 0, 1), 'vault.tmp.4': Date.UTC(2026, 8, 23) };
  f.readdir = async () => ({ files: [...f.files.keys()].map((name) => ({ name, mtime: mt[name] || 0 })) });
  const loaded = await makeStore(makeFsBackend(f)).load();
  assert.equal(loaded.ver, 'NEW', 'было: OLD');
  assert.equal(JSON.parse(f.files.get('vault.dat')).ver, 'NEW');
  assert.deepEqual([{ seq: 3, mtime: 9 }, { seq: 4, mtime: 1 }].sort(newestBySeq).map((x) => x.seq), [4, 3]);
  assert.deepEqual([{ seq: 0, mtime: 1 }, { seq: 0, mtime: 5 }].sort(newestBySeq).map((x) => x.mtime), [5, 1], 'номера равны - по mtime');
  assert.deepEqual([{ seq: 3, mtime: 9 }, { seq: 4, mtime: 1 }].sort(newestFirst).map((x) => x.seq), [3, 4], 'запасной путь без readdir - по mtime');
});

// ============================ п.6: «Начать заново» - tmp первыми, откат при сбое ============================
function renameFs(files, failAt = new Set()) {
  let n = 0; const log = [];
  return {
    log,
    readFile: async ({ path: p }) => { if (!files.has(p)) throw new Error('File does not exist'); return { data: files.get(p) }; },
    rename: async ({ from, to }) => { n++; log.push(n + ':' + from + '>' + to); if (failAt.has(n)) throw new Error('Unable to rename, unknown reason'); if (!files.has(from)) throw new Error('The source object does not exist'); files.delete(to); files.set(to, files.get(from)); files.delete(from); },
    readdir: async () => ({ files: [...files.keys()].map((name) => ({ name })) }),
  };
}
test('п.6: временные файлы откладываются ПЕРВЫМИ, vault.dat - последним', async () => {
  const files = new Map([['vault.dat', 'garbage'], ['vault.tmp.2', '{"v":1'], ['vault.corrupt-1', 'old'], ['ota/state.json', '{}']]);
  const fsx = renameFs(files);
  assert.equal(await makeFsBackend(fsx).setAsideCorrupt(777), 2);
  assert.match(fsx.log.at(-1), /^\d+:vault\.dat>vault\.corrupt-777$/, fsx.log.join(', '));
  assert.deepEqual([...files.keys()].sort(), ['ota/state.json', 'vault.corrupt-1', 'vault.corrupt-777', 'vault.corrupt-777-vault.tmp.2']);
});
test('п.6 (P5 ревьюера): сбой на vault.dat -> откат уже отложенных tmp, «ничего не изменено» - правда', async () => {
  const files = new Map([['vault.dat', 'garbage'], ['vault.tmp.1', '{"v":1,"n":5}']]);
  const fsx = renameFs(files, new Set([2]));            // 1 - tmp (ок), 2 - vault.dat (сбой), 3 - откат tmp
  const e = await makeFsBackend(fsx).setAsideCorrupt(888).then(() => null, (x) => x);
  assert.ok(e); assert.equal(e.partial, false); assert.deepEqual(e.moved, []);
  assert.deepEqual([...files.keys()].sort(), ['vault.dat', 'vault.tmp.1'], 'всё на месте');
  await assert.rejects(makeStore(makeFsBackend(renameFs(files))).load(), (x) => x.code === 'VAULT_CORRUPT', 'устаревший tmp НЕ поднимается как сейф (было: {"v":1,"n":5})');
});
test('п.6: откат не удался -> e.partial и честное «отложено частично» в приложении', async () => {
  const files = new Map([['vault.dat', 'garbage'], ['vault.tmp.1', 'a'], ['vault.tmp.2', 'b']]);
  const fsx = renameFs(files, new Set([3, 4]));         // 1,2 - tmp ок; 3 - vault.dat сбой; 4 - откат tmp.2 сбой; 5 - откат tmp.1 ок
  const e = await makeFsBackend(fsx).setAsideCorrupt(5).then(() => null, (x) => x);
  assert.equal(e.partial, true);
  assert.deepEqual(e.moved, ['vault.tmp.2']);
  assert.ok(files.has('vault.dat') && files.has('vault.tmp.1'));
  const fm = fnBody('function setAsideFailMessage(');
  assert.match(fm, /if \(e && e\.partial\) return 'Не удалось отложить повреждённый файл целиком[^\n]*Часть файлов уже отложена[^\n]*Новый сейф не создан/);
  assert.match(fm, /return 'Не удалось отложить повреждённый файл \(' \+ why \+ '\)\. Ничего не изменено\.';/);
  assert.match(fnBody('async function startFreshOnCorrupt('), /catch \(e\) \{\s*const msg = setAsideFailMessage\(e\);\s*await dlgAlert\(msg, 'Начать заново'\);\s*return false;/);
});

// ============================ п.7: флаг очистки буфера переживает выгрузку процесса ============================
test('п.7: флаг «очистить буфер» - в localStorage (переживает выгрузку процесса, секрета во флаге нет)', () => {
  assert.match(APP, /const clipFlag = makeClipFlag\(lsGet\(\)\);/);
  assert.ok(!/sessionStorage/.test(APP.replace(/\/\/[^\n]*/g, '')), 'в коде app.js sessionStorage больше нет');
  const disk = new Map();
  const ls = () => ({ getItem: (k) => (disk.has(k) ? disk.get(k) : null), setItem: (k, v) => disk.set(k, String(v)), removeItem: (k) => disk.delete(k) });
  makeClipFlag(ls()).set();
  assert.equal(makeClipFlag(ls()).has(), true, 'новый процесс видит флаг');
  assert.deepEqual([...disk.values()], ['1'], 'во флаге только «1»');
});

// ============================ п.8: даты документов ============================
test('п.8: дата выдачи «в будущем» от старых версий сохраняется, если поле не трогали', () => {
  const now = new Date(2026, 8, 23, 12).getTime();
  assert.deepEqual(Docs.checkIssueDate('15.03.2098', '15.03.2098', now), { ok: true, value: '15.03.2098', untouched: true }, 'было: отказ «ещё не наступила»');
  assert.deepEqual(Docs.checkIssueDate('15.03.2097', '15.03.2098', now), { ok: false, reason: 'future', text: '15.03.2097' }, 'правленое - проверяется');
  assert.deepEqual(Docs.checkIssueDate('15.03.98', '', now), { ok: true, value: '15.03.1998' });
  assert.deepEqual(Docs.checkIssueDate('', '15.03.2098', now), { ok: true, value: '' }, 'очистить можно');
  assert.deepEqual(Docs.checkIssueDate('31.02.2020', '', now), { ok: false, reason: 'format' });
  assert.deepEqual(Docs.checkIssueDate('01.01.2099', '', now), { ok: false, reason: 'future', text: '01.01.2099' });
  assert.deepEqual(Docs.checkIssueDate('03.04.2020', '2020-04-03', now), { ok: true, value: '03.04.2020' }, 'старый ISO -> ДД.ММ.ГГГГ');
});
test('п.8: после blur дата всегда ДД.ММ.ГГГГ; ГГ в будущем текущего года -> 19ГГ сразу в поле', () => {
  const now = new Date(2026, 8, 23, 12).getTime();
  assert.equal(Docs.normalizeIssueDateInput('15.03.27', now), '15.03.1927');
  assert.equal(Docs.normalizeIssueDateInput('1.3.98', now), '01.03.1998', 'было «01.03.98»');
  assert.equal(Docs.normalizeIssueDateInput('15.03.26', now), '15.03.2026');
  assert.equal(Docs.normalizeIssueDateInput('150398', now), '15.03.1998');
  assert.equal(Docs.normalizeIssueDateInput('31.02.2020', now), '31.02.2020', 'нереальная - как есть, проверка на сохранении');
  assert.equal(Docs.normalizeIssueDateInput('', now), '');
  assert.equal(Docs.normalizeExpiryDateInput('1.3.29'), '01.03.2029', 'срок действия - 20ГГ');
  assert.equal(Docs.normalizeExpiryDateInput('12/29'), '12/29', 'старый ММ/ГГ срока - как есть');
  const ed = fnBody('function openEditor(');
  assert.match(ed, /normalize: \(v\) => Docs\.normalizeIssueDateInput\(v\)/);
  assert.match(ed, /normalize: Docs\.normalizeExpiryDateInput/);
});
test('п.8: редактор решает дату выдачи через checkIssueDate со старым значением записи', () => {
  const i = APP.indexOf('const ci = Docs.checkIssueDate(patch.issueDate, ');
  assert.ok(i > 0);
  assert.match(APP.slice(i, i + 600), /^const ci = Docs\.checkIssueDate\(patch\.issueDate, entry \? \(entry\.issueDate \|\| ''\) : ''\);\s*if \(!ci\.ok && ci\.reason === 'future'\)[^\n]*return; \}\s*if \(!ci\.ok\) \{[^\n]*return; \}\s*patch\.issueDate = ci\.value;/);
});

// ============================ п.9: CSS-заслон прозрачных fixed-элементов ============================
test('п.9: ссылки на тесты/инструменты в комментариях исходников существуют', () => {
  const dirs = [path.join(WWW, 'js'), path.join(WWW, 'css'), path.join(ROOT, 'tools')];
  const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => /\.(m?js|css)$/.test(f)).map((f) => path.join(d, f)))
    .concat(['build-ota.js', 'build-lib.js', 'build-apk.js'].map((f) => path.join(ROOT, f)))
    // публичный репозиторий: build-ota.js (внутренний) может отсутствовать, остальные обязательны
    .filter((f) => path.basename(f) !== 'build-ota.js' || fs.existsSync(f));
  // публичный репозиторий: внутренние QA-скрипты и генератор ключей не публикуются - ссылки на них
  // в комментариях допустимы, если самого файла нет; все остальные ссылки обязаны существовать
  const INTERNAL = new Set(['tools/qa-save-all.mjs', 'tools/gen-license.mjs', 'tools/qa-align-check.mjs']);
  const missing = [];
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b(tests|tools)\/[A-Za-z0-9_.-]+\.m?js\b/g))
    if (!fs.existsSync(path.join(ROOT, m[0])) && !INTERNAL.has(m[0])) missing.push(path.basename(f) + ' -> ' + m[0]);
  assert.deepEqual(missing, [], 'битые ссылки: ' + missing.join(', '));
  assert.ok(!/toast-overlay\.test\.mjs/.test(CSS));
});
test('п.9: ни один fixed-элемент, который бывает прозрачным (opacity/visibility/@keyframes), не ловит касания', () => {
  assert.deepEqual(transparentFixedOffenders(CSS), []);
});
test('п.9: заслон ловит все формы прозрачности (мутации CSS краснеют)', () => {
  const noPe = CSS.replace(/(#toast \{[^}]*?)pointer-events: none;/, '$1');
  assert.notEqual(noPe, CSS);
  assert.ok(transparentFixedOffenders(noPe).some((x) => x.startsWith('#toast')), 'toast без pointer-events');
  assert.ok(transparentFixedOffenders(CSS + '\n.fab.gone { opacity: 0; }').some((x) => x.startsWith('.fab.gone')), 'состояние в отдельном правиле');
  assert.ok(transparentFixedOffenders(CSS + '\n@keyframes bye { from { opacity: 1; } to { opacity: 0; } }\n.unsaved-banner.leave { animation: bye .2s forwards; }').some((x) => /@keyframes bye/.test(x)), 'анимация до opacity 0');
  assert.ok(transparentFixedOffenders(CSS + '\n@media (max-width: 640px) { #menuBg.closing { visibility: hidden; transition: visibility 0s .2s; } }').some((x) => /visibility/.test(x)), 'visibility внутри @media');
  assert.ok(transparentFixedOffenders(CSS + '\n@keyframes pulse { 0% { opacity: 0; } 100% { opacity: 1; } }\n.fab.p { animation: pulse 1s infinite alternate; }').some((x) => /pulse/.test(x)), 'alternate проходит через opacity 0');
  assert.deepEqual(transparentFixedOffenders(CSS + '\n.modal-back.x { animation: seyf-fade .2s; }'), [], 'появление (0 -> 1) - не прозрачное конечное состояние');
});

// ============================ доработка 1.2.25: точка при наборе даты в конце ============================
// Набор по символу в конец поля (как на телефоне): каждый символ -> endOnlyMask(raw, конец, маска).
const typeEndLive = (fmt, text, start = '') => { let v = start; for (const ch of text) { const raw = v + ch; v = endOnlyMask(raw, raw.length, fmt).value; } return v; };
test('дата с точками по символу: введённая точка уважается («1.3.98» -> «01.03.98», было «13.98»)', () => {
  const F = Docs.formatDocDateLive;
  const cases = {
    '1.': '01.', '1.3.': '01.03.', '1.3.98': '01.03.98', '1.3.1998': '01.03.1998', '01.3.': '01.03.',
    '15.3.2020': '15.03.2020', '5.12.2029': '05.12.2029', '01.03.1998': '01.03.1998',
    '01031998': '01.03.1998', '010398': '01.03.98', '1503': '15.03', '15': '15', '1': '1',
    '0103.98': '01.03.98', '01.031998': '01.03.1998', '1/3/98': '01.03.98', '1-3-1998': '01.03.1998', '1 3 98': '01.03.98',
    '1..3': '01.3', '01.03.19981': '01.03.1998', '12.03.2029.': '12.03.2029',
  };
  for (const [typed, want] of Object.entries(cases)) assert.equal(typeEndLive(F, typed), want, 'набор «' + typed + '»');
  // вставка целиком в конец
  for (const [paste, want] of [['1.3.98', '01.03.98'], ['1.3.1998', '01.03.1998'], ['01031998', '01.03.1998'], ['5/1/2030', '05.01.2030']])
    assert.equal(endOnlyMask(paste, paste.length, F).value, want, 'вставка «' + paste + '»');
  // Backspace в конце не возвращает стёртое
  assert.equal(endOnlyMask('01.', 3, F).value, '01.');
  assert.equal(endOnlyMask('01', 2, F).value, '01', 'стёрли точку - сама не возвращается');
  assert.equal(endOnlyMask('01.03.', 6, F).value, '01.03.');
  // после blur - полный вид
  const now = new Date(2026, 8, 23).getTime();
  assert.equal(Docs.normalizeIssueDateInput(typeEndLive(F, '1.3.98'), now), '01.03.1998');
  assert.equal(Docs.normalizeExpiryDateInput(typeEndLive(F, '1.3.29')), '01.03.2029');
  assert.equal(Docs.checkIssueDate(typeEndLive(F, '1.3.98'), '', now).value, '01.03.1998');
});
test('дата: правка в СЕРЕДИНЕ по-прежнему ничего не переформатирует', () => {
  const F = Docs.formatDocDateLive;
  assert.deepEqual(endOnlyMask('1.03.98', 0, F), { value: '1.03.98', caret: 0, changed: false });
  assert.deepEqual(endOnlyMask('12.3.2029', 4, F), { value: '12.3.2029', caret: 4, changed: false });
  assert.deepEqual(endOnlyMask('12.43.2029', 4, F), { value: '12.43.2029', caret: 4, changed: false });
});
test('срок карты: «1/» -> «01/», «1/29» по символу -> «01/29», «1.» тоже слэш', () => {
  assert.equal(typeEndLive(formatExpiryLive, '1/'), '01/');
  assert.equal(typeEndLive(formatExpiryLive, '1/29'), '01/29');
  assert.equal(typeEndLive(formatExpiryLive, '12/29'), '12/29');
  assert.equal(typeEndLive(formatExpiryLive, '1229'), '12/29');
  assert.equal(typeEndLive(formatExpiryLive, '1.29'), '01/29');
  assert.equal(typeEndLive(formatExpiryLive, '1/2029'), '01/29');
});
test('оба поля даты документа привязаны к formatDocDateLive', () => {
  const ed = fnBody('function openEditor(');
  assert.match(ed, /bindCaretMask\(issueInput, Docs\.formatDocDateLive, /);
  assert.match(ed, /bindCaretMask\(expInput, Docs\.formatDocDateLive, /);
  assert.ok(!/bindCaretMask\([^,]+, Docs\.formatDocDate, /.test(APP), 'старая маска (съедала точку) больше не привязана');
});
