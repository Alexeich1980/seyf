// sysbg-133.test.mjs - баг безопасности 1.3.3 (проход на телефоне 27.10, qa/device/REPORT.md п.8):
// печать листа архива → «Домой» больше чем на 5 минут → возврат = сейф открыт без входа.
// Причина: onBackground() в app.js выходил при открытом системном окне (`if (sysWin.isOpen()) return;`) и
// метку ухода не ставил, а foregroundDecision при открытом окне всегда отвечал 'restore'. То же у любого
// системного окна: сохранение копии/файла, выбор файла, камера, оплата RuStore.
// Здесь гоняем НАСТОЯЩИЙ код app.js (кусок от `let bgAt` до `let locking`) с моками телефона: таймер,
// автоблок, состояние сейфа, lockNow - шпион. Плюс: после запирания во время долгой оплаты Pro применяется
// при входе (pay.js autoRestorePro с мок-адаптером RuStore).
// Мутации - scratchpad sysbg/mut.mjs (каждая краснеет).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSysWindow } from '../www/js/syswindow.js';
import { foregroundDecision } from '../www/js/autolock.js';
import { autoRestorePro } from '../www/js/pay.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const APP = read('www', 'js', 'app.js');
const MIN = 60 * 1000;

// Жизненный цикл фона из app.js как есть: bgAt, sysWin, withSystemWindow, onBackground, onForeground.
function lifecycle({ minutes = 5 } = {}) {
  const from = APP.indexOf('let bgAt = 0;');
  const to = APP.indexOf('let locking = false;');
  assert.ok(from > 0 && to > from, 'кусок жизненного цикла найден в app.js');
  const src = APP.slice(from, to);
  const clock = { t: 1_000_000 };
  const log = { lock: 0, arm: 0, disarm: 0 };
  const env = {
    state: { vault: { id: 'v' } },
    autoLock: { arm() { log.arm += 1; }, disarm() { log.disarm += 1; }, activity() {} },
    purchaseFlow: { resume() {} },
    clip: { retryIfFailed: () => Promise.resolve() },
    autoLockMinutes: () => minutes,
    lockNow: () => { log.lock += 1; },
    locking: false,
  };
  const fakeDate = { now: () => clock.t };
  const make = new Function('createSysWindow', 'foregroundDecision', 'env', 'Date',
    'let { state, autoLock, purchaseFlow, clip, autoLockMinutes, lockNow, locking } = env;\n' + src +
    '\nreturn { withSystemWindow, onBackground, onForeground, bg: () => bgAt, sys: () => sysWin };');
  const api = make(createSysWindow, foregroundDecision, env, fakeDate);
  return { ...api, clock, log, env };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('печать → «Домой» 6 мин → возврат = замок (окно печати держится до возврата)', async () => {
  const L = lifecycle();
  let done;
  const p = L.withSystemWindow(() => new Promise((r) => { done = r; }), { untilForeground: true });
  L.onBackground();                       // открылось окно печати - приложение в фоне
  assert.equal(L.bg(), 1_000_000, 'момент открытия системного окна = начало фона');
  done({ ok: true });                     // плагин ответил, окно печати ещё на экране
  await tick();
  L.clock.t += 6 * MIN;                   // человек ушёл «Домой» на 6 минут
  L.onForeground();
  await p;
  assert.equal(L.log.lock, 1, 'сейф заперт при возврате');
});

test('печать дольше окна, возврат в пределах 5 мин → тот же экран, без замка', async () => {
  const L = lifecycle();
  let done;
  const p = L.withSystemWindow(() => new Promise((r) => { done = r; }), { untilForeground: true });
  L.onBackground();
  L.clock.t += 4 * MIN;
  done({ ok: true });
  L.onForeground();
  await p;
  assert.equal(L.log.lock, 0);
  assert.ok(L.log.arm >= 1, 'таймер бездействия взведён заново');
  assert.equal(L.bg(), 0, 'метка фона снята');
});

for (const kind of ['сохранение копии/файла', 'выбор файла', 'камера']) {
  test(`${kind}: из системного окна «Домой» на 6 мин → возврат = замок; 2 мин - без замка`, async () => {
    for (const [mins, locks] of [[6, 1], [2, 0]]) {
      const L = lifecycle();
      let done;
      const p = L.withSystemWindow(() => new Promise((r) => { done = r; }));
      L.onBackground();
      L.clock.t += mins * MIN;
      // Android: результат окна приходит до onResume - промис ответил, пока приложение ещё «в фоне»
      done({ ok: true });
      await tick();
      L.onForeground();
      await p;
      assert.equal(L.log.lock, locks, `${mins} мин`);
    }
  });
}

test('оплата RuStore (holdAutoLock): таймер бездействия стоит, но в банке 7 мин → замок при возврате', async () => {
  const L = lifecycle();
  let done;
  const p = L.withSystemWindow(() => new Promise((r) => { done = r; }), { holdAutoLock: true });
  assert.equal(L.log.disarm, 1, 'таймер бездействия остановлен на время оплаты');
  L.onBackground();
  L.clock.t += 7 * MIN;
  L.onForeground();
  assert.equal(L.log.lock, 1, 'долгая оплата - сейф запирается');
  done({ status: 'ok' });
  await p;
});

test('без системного окна - как раньше: «Домой» 5 мин → замок, 1 мин → тот же экран', () => {
  const L = lifecycle();
  L.onBackground(); L.clock.t += 5 * MIN; L.onForeground();
  assert.equal(L.log.lock, 1);
  const M = lifecycle();
  M.onBackground(); M.clock.t += 1 * MIN; M.onForeground();
  assert.equal(M.log.lock, 0);
});

test('повторное событие фона (visibilitychange + appStateChange) не сдвигает метку', () => {
  const L = lifecycle();
  let done;
  L.withSystemWindow(() => new Promise((r) => { done = r; }));
  L.onBackground();
  L.clock.t += 3 * MIN;
  L.onBackground();                       // второе событие того же ухода
  L.clock.t += 3 * MIN;
  L.onForeground();
  assert.equal(L.log.lock, 1, 'отсчёт от первого ухода (6 мин), а не от второго (3 мин)');
  done();
});

// Долгая оплата заперла сейф (reload) - покупка не теряется: после входа app.js зовёт autoRestoreQuietly →
// pay.js autoRestorePro. Оплачено → Pro записан; ещё «в обработке» (запись плагина «оплата начата») → ожидание.
test('после замка во время оплаты: вход → Pro применяется (оплачено) или ждём итог (в обработке)', async () => {
  const vault = { pro: null };
  let saved = 0; let marked = null;
  const owned = { kind: 'rustore', status: async () => ({ owned: true, ackId: 'p1' }), acknowledge: async () => true };
  const r = await autoRestorePro({ adapter: owned, getVault: () => vault, isPro: (v) => !!v.pro,
    markPro: (v, info) => { v.pro = { purchased: true, ...info }; marked = info; }, save: async () => { saved += 1; } });
  assert.equal(r, 'restored');
  assert.equal(saved, 1);
  assert.deepEqual(marked, { source: 'rustore', purchaseId: 'p1' });
  const v2 = { pro: null }; let waitFor = null;
  const pend = { kind: 'rustore', status: async () => ({ owned: false, pending: true, pendingId: 'p2', pendingAgeMs: 7 * MIN }) };
  const r2 = await autoRestorePro({ adapter: pend, getVault: () => v2, isPro: (v) => !!v.pro, markPro: () => {}, save: async () => {},
    onPending: (id) => { waitFor = id; } });
  assert.equal(r2, 'pending');
  assert.equal(waitFor, 'p2', 'оплата 7 мин назад ещё свежая - ждём её итог, новую шторку не открываем');
  // вход в сейф действительно зовёт autoRestoreQuietly, а тот - autoRestorePro с onPending → purchaseFlow.watch
  const unlock = APP.slice(APP.indexOf('startAutoLock();\n  autoRestoreQuietly();') - 200, APP.indexOf('startAutoLock();\n  autoRestoreQuietly();') + 60);
  assert.match(unlock, /startAutoLock\(\);\n  autoRestoreQuietly\(\);/);
  const q = APP.slice(APP.indexOf('function autoRestoreQuietly('), APP.indexOf('function autoRestoreQuietly(') + 900);
  assert.match(q, /autoRestorePro\(\{/);
  assert.match(q, /onPending: \(pid\) => \{ purchaseFlow\.watch\(pid\)/);
});
