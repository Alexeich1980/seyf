// persist.test.mjs - заслон класса «Сохранить ничего не делает» (п.1 1.2.18, повтор 1.2.20 на
// «Важных реквизитах»). Поведенческие тесты чистой логики persist.js на ПОДВИСШЕМ моке записи
// (промис, который никогда не резолвится) + исходные заслоны на связку в app.js.
// Мутация (подтверждена): вернуть в saveEntry закрытие ПОСЛЕ await saveFile() -> краснеет
// «app.js: saveEntry закрывает редактор ДО записи»; убрать close() из начала closeThenPersist ->
// краснеет «подвисшая запись не держит окно».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SAVE_TIMEOUT_MS, withTimeout, runStage, saveErrorLabel, closeThenPersist, stageError, makeSerialSaver } from '../www/js/persist.js';

const APP = fs.readFileSync(new URL('../www/js/app.js', import.meta.url), 'utf8');
const never = () => new Promise(() => {});
const tick = () => new Promise((r) => setImmediate(r));

test('подвисшая запись (never-resolve) НЕ держит окно: close() вызван сразу, до завершения записи', async () => {
  let closed = false, failed = null, saved = false;
  const p = closeThenPersist({
    close: () => { closed = true; },
    persist: () => runStage('write', never, 40),
    onSaved: () => { saved = true; },
    onFailed: (e) => { failed = e; },
  });
  assert.equal(closed, true, 'окно должно закрыться синхронно, ДО записи');
  await tick();
  assert.equal(failed, null, 'ошибка ещё не пришла - запись висит, а окно уже закрыто');
  const r = await p;
  assert.equal(r, false);
  assert.equal(saved, false);
  assert.ok(failed, 'через таймаут должен прийти onFailed');
  assert.equal(failed.code, 'write-timeout');
  assert.equal(saveErrorLabel(failed), 'write-timeout', 'toast получает код стадии');
});

test('отклонённая запись: окно закрыто, onFailed со стадией и сообщением', async () => {
  let closed = false, label = '';
  await closeThenPersist({
    close: () => { closed = true; },
    persist: () => runStage('reencrypt', async () => { throw new Error('OperationError: boom'); }, 1000),
    onFailed: (e) => { label = saveErrorLabel(e); },
  });
  assert.equal(closed, true);
  assert.equal(label, 'reencrypt: OperationError: boom');
});

test('успешная запись: окно закрыто, onSaved (вибро), onFailed не зовётся', async () => {
  const log = [];
  const r = await closeThenPersist({
    close: () => log.push('close'),
    persist: async () => { log.push('persist'); },
    onSaved: () => log.push('saved'),
    onFailed: () => log.push('failed'),
  });
  assert.equal(r, true);
  assert.deepEqual(log, ['close', 'persist', 'saved'], 'порядок: закрыть -> записать -> отклик');
});

test('withTimeout: успел - значение; не успел - код таймаута; таймер снимается', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50, 'x-timeout'), 7);
  await assert.rejects(withTimeout(never(), 20, 'x-timeout'), (e) => e.code === 'x-timeout');
});

test('runStage: синхронное исключение стадии тоже превращается в код стадии', async () => {
  await assert.rejects(runStage('write', () => { throw new Error('FILE_NOTCREATED'); }, 100),
    (e) => e.code === 'write' && /write: FILE_NOTCREATED/.test(e.message));
});

test('saveErrorLabel: длинное сообщение обрезано до 80 символов; без кода - префикс save', () => {
  const long = stageError('write', new Error('x'.repeat(200)));
  assert.ok(saveErrorLabel(long).length <= 80);
  assert.equal(saveErrorLabel(new Error('plain')), 'save: plain');
  assert.equal(SAVE_TIMEOUT_MS, 15000, 'потолок стадии 15 c (синхронно с tools/qa-save-all.mjs)');
});

// ---- исходные заслоны связки в app.js ----
test('app.js: saveEntry закрывает редактор ДО записи (closeThenPersist, close перед persist: saveFile)', () => {
  const i = APP.indexOf('const saveEntry = async');
  const body = APP.slice(i, APP.indexOf('const requestClose', i));
  assert.ok(/await closeThenPersist\(\{\s*close: \(\) => \{\s*dirty = false;\s*cleanup\(\);/.test(body),
    'saveEntry обязан закрывать окно через closeThenPersist({ close: dirty=false; cleanup() ... })');
  assert.ok(/persist: saveFile,/.test(body), 'запись - persist: saveFile (после закрытия)');
  // закрытие НЕ должно стоять после await saveFile (ровно тот баг)
  const code = body.replace(/\/\/.*$/gm, '');   // без комментариев
  assert.ok(!/await saveFile\(\)[\s\S]*cleanup\(\)/.test(code), 'cleanup() после await saveFile() - окно снова может зависнуть');
  assert.ok(/toast\('Не удалось записать на устройство \(' \+ saveErrorLabel\(e\) \+ '\)'\)/.test(body), 'нет toast с кодом стадии');
  assert.ok(/toast\('Не удалось сохранить запись \(' \+ stage \+ ': '/.test(body), 'исключение до закрытия должно давать toast со стадией');
});

test('app.js: saveFile идёт через ОДНУ очередь makeSerialSaver (стадии reencrypt/write, data поверх актуального файла)', () => {
  assert.ok(/const serialSave = makeSerialSaver\(async \(setStage(?:, alive(?:, beat)?)?\) => \{/.test(APP), 'нет очереди makeSerialSaver');
  assert.ok(/function saveFile\(\) \{ return serialSave\(\); \}/.test(APP), 'saveFile обязан идти через serialSave');
  const i = APP.indexOf('const serialSave = makeSerialSaver');
  const body = APP.slice(i, APP.indexOf('{ timeoutMs: SAVE_TIMEOUT_MS', i));
  assert.ok(/setStage\('reencrypt'\)[\s\S]*C\.reencryptData\(/.test(body) && /setStage\('write'\)[\s\S]*guardedStoreSave\(state\.file[,)]/.test(body), 'стадии reencrypt/write');
  assert.ok(/state\.file = \{ \.\.\.state\.file, data: enc\.data \}/.test(body), 'state.file обновляется только полем data (не затирает pwWrap/helloWrap)');
});

// ---- 1.2.20 [BLOCKER]: очередь записи ----
test('makeSerialSaver: одновременно не больше ОДНОГО run, ожидающие вызовы коалесцируются', async () => {
  let running = 0, maxRunning = 0, runs = 0;
  const gates = [];
  const save = makeSerialSaver(async () => { runs++; running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => gates.push(r)); running--; }, { timeoutMs: 10000 });
  const ps = [save()];
  await tick();
  assert.equal(runs, 1, 'первый run стартовал');
  ps.push(save(), save(), save(), save());   // пришли, пока первый идёт
  await tick();
  assert.equal(runs, 1, 'пока первый не завершился, второй НЕ стартует');
  gates.shift()();                       // завершили первый
  await tick(); await tick();
  assert.equal(runs, 2, 'вызовы 2..5 слились в ОДИН следующий run');
  gates.shift()();
  await Promise.all(ps);
  assert.equal(maxRunning, 1, 'параллельных run не было');
  assert.equal(runs, 2);
});

test('makeSerialSaver: таймаут - только уведомление, следующая запись НЕ стартует, пока висит реальная', async () => {
  let runs = 0, release;
  const save = makeSerialSaver(async (setStage) => { runs++; setStage('write'); if (runs === 1) await new Promise((r) => { release = r; }); }, { timeoutMs: 30 });
  await assert.rejects(save(), (e) => e.code === 'write-timeout', 'вызывающий получил код стадии по таймауту');
  const p2 = save().catch((e) => e);   // тоже уведомится таймаутом - это нормально
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(runs, 1, 'вторая запись ждёт РЕАЛЬНОГО завершения первой, а не её таймаута');
  release();
  await p2.catch(() => {});
  await save.settled();
  assert.equal(runs, 2, 'после реального завершения очередь пошла дальше');
});

test('makeSerialSaver: ошибка run получает код стадии, очередь не ломается', async () => {
  let n = 0;
  const save = makeSerialSaver(async (setStage) => { n++; setStage('reencrypt'); if (n === 1) throw new Error('OperationError'); }, { timeoutMs: 1000 });
  await assert.rejects(save(), (e) => e.code === 'reencrypt' && saveErrorLabel(e) === 'reencrypt: OperationError');
  await save();
  assert.equal(n, 2);
});
