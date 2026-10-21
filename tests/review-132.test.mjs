// review-132.test.mjs - 1.3.2 Э4: окно оценки RuStore Review SDK (www/js/review.js + RuStoreReviewPlugin).
// Правило показа: только стор, сразу после удачного сохранения новой записи, когда 7-й день пользования
// И 10-я запись; не поверх окна/меню/экрана входа и не в фоне; один раз за запуск; после ответа - не
// спрашиваем, единственный повтор через 60 дней (закрыл или телефон не дал показать); уже оценили /
// лимит / ошибка - навсегда; не больше двух запусков окна. Своей кнопки «Оценить» и «Нравится?» нет.
// Мутации (16.10.2026, каждая -> красный): due без MIN_RECORDS (|| -> только дни); due без MAX_ASKS;
// after без повтора для shown; afterSave без allowed (тест-сборка зовёт окно); launch без busy();
// app.js без review.afterSave в onSaved; MainActivity без registerPlugin(RuStoreReviewPlugin).
// Ревью 1.3.2: launched() без recover (оборванная запиранием попытка) -> красный.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../www/js/review.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 1);

function mkStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
function vaultWith(n, createdAt = new Date(T0 - 8 * DAY).toISOString()) {   // давно пользуется: окно зависит от числа записей
  const passwords = [], cards = [];
  for (let i = 0; i < n; i++) (i % 2 ? cards : passwords).push({ id: 'e' + i, title: 'x', createdAt });
  return { sections: { passwords, cards, notes: [] } };
}

test('countRecords / firstEntryTs: записи всех разделов, самая ранняя дата создания', () => {
  assert.equal(R.countRecords(vaultWith(7)), 7);
  assert.equal(R.countRecords(null), 0);
  const v = { sections: { a: [{ createdAt: '2026-09-01T10:00:00Z' }, { createdAt: 'мусор' }], b: [{ createdAt: '2026-08-15T00:00:00Z' }] } };
  assert.equal(R.firstEntryTs(v, T0), Date.parse('2026-08-15T00:00:00Z'));
  assert.equal(R.firstEntryTs({ sections: { a: [{ createdAt: '1970-01-02T00:00:00Z' }] } }, T0), null, 'мусорная дата не делает «давно пользуется»');
});

test('due: 7-й день И 10-я запись', () => {
  assert.equal(R.due({}, { now: T0, records: 9, firstTs: T0 - 6 * DAY }), false, '6 дней и 9 записей - рано');
  assert.equal(R.due({}, { now: T0, records: 10, firstTs: T0 }), false, '10 записей в первый же день - рано');
  assert.equal(R.due({}, { now: T0, records: 1, firstTs: T0 - 7 * DAY }), false, '7 дней с одной записью - рано');
  assert.equal(R.due({}, { now: T0, records: 10, firstTs: T0 - 7 * DAY }), true, '7-й день и 10-я запись');
  assert.equal(R.due({}, { now: T0, records: 30, firstTs: null }), false);
});

test('after/due: закрыл - больше не спрашиваем, единственный повтор через 60 дней; оценил/лимит - навсегда', () => {
  let st = R.after(R.start({}, T0), { shown: true }, T0);
  assert.equal(st.done, false);
  assert.equal(R.due(st, { now: T0 + 59 * DAY, records: 50, firstTs: T0 - 100 * DAY }), false, 'до 60 дней - молчим');
  assert.equal(R.due(st, { now: T0 + 60 * DAY, records: 50, firstTs: T0 - 100 * DAY }), true, 'через 60 дней - один повтор');
  st = R.after(R.start(st, T0 + 60 * DAY), { shown: true }, T0 + 60 * DAY);
  assert.equal(st.done, true, 'после второго окна - навсегда');
  assert.equal(R.due(st, { now: T0 + 999 * DAY, records: 50, firstTs: T0 - 100 * DAY }), false);
  for (const code of ['REVIEW_EXISTS', 'LIMIT', 'BANNED', 'ERROR']) {
    assert.equal(R.after({}, { shown: false, code }, T0).done, true, code);
  }
  const ph = R.after({}, { shown: false, code: 'UNAUTHORIZED' }, T0);
  assert.equal(ph.done, false, 'не вошли в RuStore - один повтор позже');
  assert.equal(ph.retryAt, T0 + 60 * DAY);
  assert.equal(R.due(R.start({}, T0), { now: T0 + 999 * DAY, records: 50, firstTs: T0 - 99 * DAY }), false, 'запущено без ответа - считаем показанным');
  assert.equal(R.due({ asks: 2 }, { now: T0, records: 50, firstTs: T0 - 99 * DAY }), false, 'не больше двух окон');
});

function mkEnv(over = {}) {
  const timers = [];
  const calls = [];
  const env = Object.assign({
    access: { STORE: true },
    plugin: { requestAndLaunch: async () => { calls.push(1); return { shown: true }; } },
    storage: mkStorage(),
    getVault: () => vaultWith(10),
    busy: () => false,
    visible: () => true,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    now: () => T0,
  }, over);
  return { env, timers, calls };
}

test('createReview: после сохранения при выполненном условии - окно через паузу, один раз за запуск', async () => {
  const { env, timers, calls } = mkEnv();
  const rv = R.createReview(env);
  rv.launched();
  assert.equal(rv.afterSave(), true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, R.REVIEW_DELAY);
  assert.equal(calls.length, 0, 'не сразу, а после паузы');
  await timers[0].f();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.equal(rv.afterSave(), false, 'второй раз за запуск - нет');
  const st = JSON.parse(env.storage.getItem(R.KEY));
  assert.equal(st.code, 'SHOWN');
});

test('createReview: хранилище не пишется - всё равно не больше одного окна за запуск', async () => {
  const broken = { getItem: () => null, setItem: () => { throw new Error('квота'); }, removeItem() {} };
  const { env, timers, calls } = mkEnv({ storage: broken });
  const rv = R.createReview(env);
  assert.equal(rv.afterSave(), true);
  timers[0].f();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.equal(rv.afterSave(), false, 'флаг не записался, но в этом запуске больше не зовём');
});

test('createReview: условие не выполнено / тест-сборка / нет RuStore-плагина - молча ничего', () => {
  let m = mkEnv({ getVault: () => vaultWith(3) });
  const rv = R.createReview(m.env); rv.launched();
  assert.equal(rv.afterSave(), false, '3 записи в первый день - рано');
  m = mkEnv({ access: { STORE: false } });
  assert.equal(R.createReview(m.env).afterSave(), false, 'тест-сборка - окно не зовём');
  m = mkEnv({ plugin: null });
  assert.equal(R.createReview(m.env).afterSave(), false);
  assert.equal(m.timers.length, 0);
});

test('createReview: в момент показа открыто окно/меню/экран входа или приложение в фоне - не показываем', async () => {
  for (const over of [{ busy: () => true }, { visible: () => false }]) {
    const { env, timers, calls } = mkEnv(over);
    const rv = R.createReview(env);
    assert.equal(rv.afterSave(), true);
    await timers[0].f();
    assert.equal(calls.length, 0);
    assert.equal(env.storage.getItem(R.KEY), null, 'ничего не записали - спросим после следующего сохранения');
  }
});

test('createReview: RuStore не установлен / ошибка плагина - тихо, без своих окон', async () => {
  const { env, timers } = mkEnv({ plugin: { requestAndLaunch: () => Promise.reject(new Error('мост')) } });
  const rv = R.createReview(env);
  rv.afterSave();
  timers[0].f();
  await new Promise((r) => setTimeout(r, 0));
  const st = JSON.parse(env.storage.getItem(R.KEY));
  assert.equal(st.code, 'ERROR');
  assert.equal(st.done, true);
});

test('createReview (ревью 1.3.2): сейф заперли, пока RuStore готовил окно - при следующем запуске окно засчитано, не чаще правила', async () => {
  const storage = mkStorage();
  const { env, timers } = mkEnv({ storage, plugin: { requestAndLaunch: () => new Promise(() => {}) } });   // ответ так и не пришёл
  const rv = R.createReview(env);
  rv.launched();
  assert.equal(rv.afterSave(), true);
  timers[0].f();
  await new Promise((r) => setTimeout(r, 0));
  let st = JSON.parse(storage.getItem(R.KEY));
  assert.equal(st.startedAt, T0);
  assert.equal(st.answered, false);
  // location.reload(): новый запуск того же телефона
  let calls = 0;
  const plugin = { requestAndLaunch: async () => { calls++; return { shown: true }; } };
  const run = (t) => { const m = mkEnv({ storage, plugin, now: () => t }); const r = R.createReview(m.env); r.launched(); const ok = r.afterSave(); if (ok) m.timers[0].f(); return ok; };
  assert.equal(run(T0 + 1000), false, 'сразу после перезапуска - не повторяем');
  st = JSON.parse(storage.getItem(R.KEY));
  assert.equal(st.asks, 1, 'оборванная попытка засчитана как окно');
  assert.equal(st.retryAt, T0 + 60 * DAY);
  assert.equal(run(T0 + 59 * DAY), false, 'до 60 дней - молчим');
  assert.equal(run(T0 + 60 * DAY), true, 'через 60 дней - второе (последнее) окно');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
  assert.equal(run(T0 + 999 * DAY), false, 'больше двух окон - никогда');
  assert.equal(JSON.parse(storage.getItem(R.KEY)).done, true);
  // обычный запуск без оборванной попытки recover не трогает
  assert.deepEqual(R.recover({ firstAt: 5 }), { firstAt: 5 });
  const answered = R.after(R.start({}, T0), { shown: true }, T0);
  assert.deepEqual(R.recover(answered), answered);
});

test('приложение: окно оценки зовётся только из onSaved новой записи, без своей кнопки «Оценить»', () => {
  const app = read('www', 'js', 'app.js');
  assert.match(app, /onSaved: \(\) => \{[\s\S]{0,1000}if \(isNew\) \{ try \{ review\.afterSave\(\); \} catch \(e\) \{\} \}/);
  assert.equal((app.match(/review\.afterSave\(/g) || []).length, 1, 'единственный вызов - после сохранения');
  assert.match(app, /try \{ review\.launched\(\); \} catch/);
  const www = [read('www', 'index.html'), app, read('www', 'js', 'review.js')].join('\n');
  assert.doesNotMatch(www, /Оцените приложение|Нравится ли|Вам нравится|Оценить приложение/, 'без своей кнопки и вопроса');
});

test('натив: RuStoreReview зарегистрирован, SDK review подключён', () => {
  const ma = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'MainActivity.java');
  const i = ma.indexOf('registerPlugin(RuStoreReviewPlugin.class)');
  assert.ok(i > 0 && i < ma.indexOf('super.onCreate('));
  const pl = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'RuStoreReviewPlugin.java');
  assert.match(pl, /^package ru\.dorokhin\.seyf;/m);
  assert.match(pl, /@CapacitorPlugin\(name = "RuStoreReview"\)/);
  assert.match(pl, /public void requestAndLaunch\(/);
  assert.match(read('android', 'app', 'build.gradle'), /implementation 'ru\.rustore\.sdk:review'/);
  assert.match(read('www', 'native.js'), /RuStoreReview: C\.registerPlugin\('RuStoreReview'\)/);
});
