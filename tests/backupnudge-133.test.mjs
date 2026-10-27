// backupnudge-133.test.mjs - напоминание о резервной копии раз в месяц (1.3.3, перенос из десктопа
// c93358be): не раньше 30 дней после установки/последней копии, раз в месяц, «Позже» - до следующего
// месяца, «Больше не напоминать», пустой сейф - молчим; окно своё (не нативное), после разблокировки.
// Мутации: scratchpad/v133/mut-backup.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as N from '../www/js/backupnudge.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');
const DAY = N.DAY;
const T0 = new Date(2026, 9, 22, 12, 0, 0).getTime();   // 22.10.2026
const ctx = (now, entryCount = 5) => ({ now, entryCount });

test('после установки - не раньше 30 дней (копий ещё не было)', () => {
  const s = N.withFirstSeen({}, T0);
  assert.equal(N.backupDue(s, ctx(T0)), false, 'в день установки');
  assert.equal(N.backupDue(s, ctx(T0 + 20 * DAY)), false, '20 дней');
  assert.equal(N.backupDue(s, ctx(T0 + 29 * DAY)), false, '29 дней');
  assert.equal(N.backupDue(s, ctx(T0 + 31 * DAY)), true, '31 день');
});

test('без отметки установки не показываем (app.js ставит её при входе); повторный withFirstSeen её не сдвигает', () => {
  assert.equal(N.backupDue({}, ctx(T0)), false);
  const s = N.withFirstSeen({}, T0);
  assert.equal(N.withFirstSeen(s, T0 + 50 * DAY).firstAt, T0);
});

test('после копии - следующий раз не раньше 30 дней и не в том же месяце', () => {
  const s = N.markBackup(N.withFirstSeen({}, T0 - 100 * DAY), T0);
  assert.equal(N.backupDue(s, ctx(T0 + 10 * DAY)), false);
  assert.equal(N.backupDue(s, ctx(T0 + 29 * DAY)), false);
  assert.equal(N.backupDue(s, ctx(T0 + 31 * DAY)), true);
});

test('показали - в этом месяце и ближайшие 25 дней молчим; «Позже» - так же', () => {
  const base = N.withFirstSeen({}, T0 - 60 * DAY);
  assert.equal(N.backupDue(base, ctx(T0)), true);
  const shown = N.markShown(base, T0);
  assert.equal(N.backupDue(shown, ctx(T0 + DAY)), false);
  assert.equal(N.backupDue(shown, ctx(T0 + 20 * DAY)), false, 'уже ноябрь, но прошло меньше 25 дней');
  assert.equal(N.backupDue(shown, ctx(T0 + 26 * DAY)), true);
  const later = N.markLater(base, T0);
  assert.equal(N.backupDue(later, ctx(T0 + 10 * DAY)), false);
  assert.equal(N.backupDue(later, ctx(T0 + 26 * DAY)), true);
});

test('показали 1-го числа - 28-го того же месяца снова не показываем (раз в месяц)', () => {
  const d1 = new Date(2026, 9, 1, 10).getTime(), d28 = new Date(2026, 9, 28, 10).getTime();
  const s = N.markShown(N.withFirstSeen({}, d1 - 60 * DAY), d1);
  assert.equal(N.backupDue(s, ctx(d28)), false);
  assert.equal(N.backupDue(N.markLater(N.withFirstSeen({}, d1 - 60 * DAY), d1), ctx(d28)), false);
});

test('«Больше не напоминать» и пустой сейф - не показываем', () => {
  const base = N.withFirstSeen({}, T0 - 60 * DAY);
  assert.equal(N.backupDue(N.setRemindOff(base, true), ctx(T0)), false);
  assert.equal(N.backupDue(base, ctx(T0, 0)), false);
});

test('часы перевели назад: метка из будущего паузу не держит', () => {
  const s = N.markShown(N.withFirstSeen({}, T0 - 90 * DAY), T0 + 40 * DAY);
  assert.equal(N.backupDue(s, ctx(T0)), true);
});

test('отметка в localStorage: битый JSON - пусто, запись/чтение', () => {
  const mem = { v: null, getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
  mem.v = '{bad'; assert.deepEqual(N.readStamp(mem), {});
  N.writeStamp(mem, { lastAt: 5 }); assert.deepEqual(N.readStamp(mem), { lastAt: 5 });
  assert.match(N.lastBackupText({}), /ещё не было/);
  assert.match(N.lastBackupText({ lastAt: T0 }), /22\.10\.2026/);
});

test('тексты: на «вы», без длинного тире', () => {
  const all = N.REMIND_TITLE + N.REMIND_TEXT + N.lastBackupText({});
  assert.ok(!/[—–]/.test(all));
  assert.ok(!/(?<![а-яё])(ты|тебе|твой|твои|сделай|нажми)(?![а-яё])/iu.test(all));
});

test('app.js: напоминание после разблокировки, своё окно «Позже» / «Сделать копию», отметка после успешной копии', () => {
  const APP = read('www', 'js', 'app.js');
  const enter = APP.slice(APP.indexOf('  autoRestoreQuietly();\n'), APP.indexOf('  autoRestoreQuietly();\n') + 400);
  assert.match(enter, /withFirstSeen/);
  assert.match(enter, /maybeRemindBackup\(\)/);
  const fn = APP.slice(APP.indexOf('function maybeRemindBackup('), APP.indexOf('function showBackupReminder('));
  assert.match(fn, /state\.demoMode/);
  assert.match(fn, /\.modal-back/);
  const dlg = APP.slice(APP.indexOf('function showBackupReminder('), APP.indexOf('function markBackupDone('));
  assert.match(dlg, />Позже</);
  assert.match(dlg, />Сделать копию</);
  assert.match(dlg, /Больше не напоминать/);
  assert.ok(!/\b(alert|confirm)\(/.test(dlg), 'не нативное окно');
  const exp = APP.slice(APP.indexOf('async function doExport('), APP.indexOf('function doImport('));
  assert.equal((exp.match(/markBackupDone\(\)/g) || []).length, 2, 'телефон и браузер');
  assert.match(exp, /if \(r && r\.ok\) \{ markBackupDone\(\);/);
});
