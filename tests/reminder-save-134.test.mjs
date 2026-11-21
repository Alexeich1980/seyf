import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeSerialSaver } from '../www/js/persist.js';

// Execute the production saver callback with controlled I/O, including the real timeout queue.
const app = fs.readFileSync(new URL('../www/js/app.js', import.meta.url), 'utf8');
const start = app.indexOf('const serialSave = makeSerialSaver(async (setStage, alive, beat) => {');
const body = app.slice(app.indexOf('{', start) + 1, app.indexOf('}, { timeoutMs: SAVE_TIMEOUT_MS', start));
const factory = new Function('state', 'C', 'guardedStoreSave', 'documentReminderTimes', 'syncDocumentSchedules',
  'return async (setStage,alive,beat) => {' + body + '}');

test('late successful write synchronizes the saved reminder dates after caller timeout', async () => {
  const state = { vault: { dates: [10] }, dek: {}, file: {}, demoMode: false };
  const scheduled = []; let finish;
  const run = factory(state, { reencryptData: async () => ({ data: 'encrypted' }) },
    () => new Promise(resolve => { finish = resolve; }), v => [...v.dates], async dates => { scheduled.push(dates); });
  const saver = makeSerialSaver(run, { timeoutMs: 15, watchdogMs: 1000 });
  await assert.rejects(saver(), /timeout/);
  state.vault.dates = [20]; // unsaved subsequent edit must not be scheduled by the old write
  finish(); await saver.settled();
  assert.equal(saver.unsaved(), false);
  assert.deepEqual(scheduled, [[10]]);
});

test('failed write schedules nothing; retry synchronizes current dates', async () => {
  const state = { vault: { dates: [10] }, dek: {}, file: {}, demoMode: false };
  const scheduled = []; let fail = true;
  const run = factory(state, { reencryptData: async () => ({ data: 'encrypted' }) },
    async () => { if (fail) throw Error('disk unavailable'); }, v => [...v.dates], async dates => { scheduled.push(dates); });
  const saver = makeSerialSaver(run, { timeoutMs: 100, watchdogMs: 1000 });
  await assert.rejects(saver()); assert.deepEqual(scheduled, []);
  fail = false; state.vault.dates = [20]; await saver();
  assert.deepEqual(scheduled, [[20]]);
});
