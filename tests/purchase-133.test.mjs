// purchase-133.test.mjs - покупка 1.3.3 по регламенту (память android-app-build-checklist «Покупка через
// RuStore Pay: обязательные механики», п.1-14) после адверсариального ревью 27.10.2026:
//   В1 - сессия покупки в плагине (purchaseId из onPurchaseCreated, getPurchase(id) на resume, purchaseLate),
//        «в обработке» (PROCESSING/EXECUTING) - окно и опрос, без JS-таймеров угадывания; сценарии ревьюера
//        A (шторка дольше 75 с, оплата прошла, возврат по иконке) и B (оплата в обработке - вторая шторка
//        не открывается);
//   В2 - до шторки путь закрывают только UserBanned/ApplicationBanned/NotConfigured; RuStore не установлен -
//        окно «Нужен RuStore» с «Открыть RuStore»;
//   М5 - шторка обёрнута в withSystemWindow (долгая оплата не запирает сейф);
//   заслон протокола ошибок: плагин с onPurchaseCreated/handleOnResume, в www нет stuckMs/graceMs/rescue.
// Мок плагина - по контракту Java (tests/pay-mock.mjs). Мутации - scratchpad fix133/mut-purchase.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatPrice, kindOfCode, autoRestorePro, ackPendingPro, finalKind, snapshot, normPurchase } from '../www/js/pay.js';
import { createPurchaseFlow, FAIL_DIALOGS, INFO_DIALOGS, failDialog, payHintLines, PAY_TEXT } from '../www/js/purchase.js';
import { createRuStorePayment, createMockPayment, createUnavailablePayment } from '../www/js/payment.js';
import { isPro, markPro } from '../www/js/gate.js';
import { payPlugin, clock, flush } from './pay-mock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const NB = '\u00a0';

// Ход покупки над мок-плагином: журнал окон (pending / late / precheck), ручные часы.
function flow(pl, extra = {}) {
  const C = clock();
  const log = [];
  const adapter = createRuStorePayment(pl, 'seyf-pro');
  let pro = false;
  const f = createPurchaseFlow({
    getAdapter: () => adapter,
    isPro: () => pro,
    onPending: () => log.push('pending'),
    onLate: (r) => { log.push('late:' + r.kind); pro = true; },
    onPrecheck: (pc) => log.push('precheck:' + (pc && pc.authorized === false ? 'noauth' : 'ok')),
    setTimer: C.setTimer, clearTimer: C.clearTimer, now: C.now,
    ...extra,
  });
  return { f, C, log, adapter, setPro: (v) => { pro = v; } };
}
const kindOf = (r) => r && r.kind;

// ======================= В1: сценарии ревьюера A и B =======================
test('В1 сценарий A: шторка дольше 75 с, оплата прошла, возврат по иконке → Pro открывается сам, без второй шторки', async () => {
  const pl = payPlugin();                                   // шторка открыта и ждёт (новая карта + VK ID + 3DS)
  const { f, C } = flow(pl);
  const p = f.buy();
  await flush();
  assert.equal(pl.calls.purchase, 1);
  assert.equal(C.pending(), 0, 'пока открыта шторка, в JS нет таймеров «зависания»');
  await C.advance(120000);                                  // 2 минуты в банке
  assert.equal(f.busy(), true, 'шторку не «отпустили» по таймеру: замок держит сессия');
  assert.equal(kindOf(await Promise.race([p, flush().then(() => 'ещё ждём')])), undefined);
  pl.session.pay('PAID');                                   // оплата прошла в банке
  pl.appResume();                                           // вернулся по иконке: Task шторки молчит, итог даёт плагин
  const r = await p;
  assert.equal(r.kind, 'ok'); assert.equal(r.granted, true);
  assert.equal(f.busy(), false);
  assert.equal(pl.calls.purchase, 1, 'вторая шторка не открывалась');
  assert.deepEqual(pl.acks, [r.purchaseId], 'выдача товара отмечена (ACKNOWLEDGED)');
});

test('В1 сценарий A2: вернулся по иконке, а банк ещё проводит (PROCESSING) → «Оплата обрабатывается», опрос → «Готово»', async () => {
  const pl = payPlugin();
  const { f, C, log } = flow(pl);
  const p = f.buy();
  await flush();
  pl.session.pay('PROCESSING');
  pl.appResume();
  await flush();
  assert.deepEqual(log.filter((x) => x === 'pending'), ['pending'], 'окно «Оплата обрабатывается»');
  assert.equal(f.state(), 'pending');
  await C.advance(5000);
  assert.equal(f.state(), 'pending', 'пока PROCESSING - ждём дальше');
  pl.setStatus(pl.session.realId, 'PAID');
  await C.advance(5000);
  const r = await p;
  assert.equal(r.kind, 'ok'); assert.equal(r.granted, true);
  assert.equal(pl.calls.purchase, 1);
});

test('В1 сценарий B: оплата в обработке → вторая шторка НЕ открывается ни во время ожидания, ни после «Проверим позже»', async () => {
  const pl = payPlugin();
  const { f, C } = flow(pl);
  const p = f.buy();
  await flush();
  pl.session.pay('PROCESSING');
  pl.appResume();
  await flush();
  // во время ожидания «Купить» спрашивает, а не открывает шторку
  assert.equal(kindOf(await f.buy()), 'prevpending');
  assert.equal(pl.calls.purchase, 1);
  await C.advance(180000);                                  // 3 минуты: банк так и не ответил
  assert.equal(kindOf(await p), 'later');
  // после «Проверим позже» магазин всё ещё видит PROCESSING - снова выбор, а не шторка
  assert.equal(kindOf(await f.buy()), 'prevpending');
  assert.equal(pl.calls.purchase, 1, 'вторая шторка не открывалась');
  assert.equal(FAIL_DIALOGS.prevpending.payagain, true, 'выбор «Подождать» / «Оплатить снова»');
});

test('В1: «Оплатить снова» осознанно - шторка открывается, а прошлая оплата опрашивается в фоне и открывает доступ', async () => {
  const pl = payPlugin();
  const { f, C, log } = flow(pl);
  const first = pl.addPurchase('PROCESSING', 60000);       // прошлая оплата «в обработке» с прошлого запуска
  assert.equal(kindOf(await f.buy()), 'prevpending');
  assert.equal(pl.calls.purchase, 0);
  const p2 = f.buy({ again: true });
  await flush();
  assert.equal(pl.calls.purchase, 1, 'по «Оплатить снова» шторка открылась');
  pl.setStatus(first, 'PAID');                              // прошлая оплата подтвердилась поздно
  await C.advance(5000);
  // идёт новая шторка - поздний успех станет её итогом; новая шторка закрыта отменой
  pl.session.end({ status: 'cancelled' });
  const r = await p2;
  assert.equal(r.granted, true, 'поздний успех прошлой оплаты не потерян');
  assert.ok(!log.includes('late:ok') || r.granted);
});

test('В1: оплата «в обработке» старше 30 минут - не ждём её, шторка открывается', async () => {
  const pl = payPlugin({ sheet: { status: 'ok' } });
  const { f } = flow(pl);
  pl.addPurchase('PROCESSING', 31 * 60 * 1000);
  const r = await f.buy();
  assert.equal(r.kind, 'ok');
  assert.equal(pl.calls.purchase, 1);
});

test('В1: начатая оплата («open» при onPaymentStarted) и возврат по иконке - pending, а не «отмена»', async () => {
  const pl = payPlugin();
  const { f, C } = flow(pl);
  const p = f.buy();
  await flush();
  pl.session.started();                                     // ушёл в банк, счёт ещё INVOICE_CREATED
  pl.appResume();
  await flush();
  assert.equal(f.state(), 'pending');
  pl.setStatus(pl.session.realId, 'PAID');
  await C.advance(5000);
  assert.equal((await p).kind, 'ok');
});

test('В1: шторку закрыли без оплаты (open без onPaymentStarted) - «Оплата не прошла» сразу, без ожидания', async () => {
  const pl = payPlugin();
  const { f, log } = flow(pl);
  const p = f.buy();
  await flush();
  pl.appResume();
  const r = await p;
  assert.equal(r.kind, 'cancelled');
  assert.equal(failDialog('cancelled').retry, true, 'окно с «Попробовать снова»');
  assert.ok(!log.includes('pending'));
});

test('В1: поздний успех шторки после итога (событие purchaseLate) открывает доступ', async () => {
  const pl = payPlugin();
  const { f, log } = flow(pl);
  const p = f.buy();
  await flush();
  pl.appResume();                                           // итог «отмена» по resume
  assert.equal((await p).kind, 'cancelled');
  pl.session.end({ status: 'ok' });                         // Task шторки ответил успехом позже
  await flush();
  assert.deepEqual(log.filter((x) => x.startsWith('late')), ['late:ok']);
  pl.session.end({ status: 'ok' });
  await flush();
  assert.equal(log.filter((x) => x.startsWith('late')).length, 1, 'второй раз «Готово» не показываем');
});

test('В1: после отмены владение перепроверено - оплатил в банке и закрыл шторку → доступ', async () => {
  const pl = payPlugin({ sheet: (s) => { s.pay('PAID'); s.end({ status: 'cancelled' }); } });
  const r = await flow(pl).f.buy();
  assert.equal(r.granted, true);
});

test('В1: магазин не ответил о владении до шторки (unknown) → «Не удалось проверить», шторку не открываем; поздний owned открывает', async () => {
  let release;
  const pl = payPlugin({ getPurchases: (n, def) => (n === 1 ? new Promise((res) => { release = () => res({ owned: true }); }) : def()) });
  const { f, log } = flow(pl, { timings: { ownsMs: 30 } });
  const r = await f.buy();
  assert.equal(r.kind, 'nocheck');
  assert.equal(pl.calls.purchase, 0);
  release(); await flush();
  assert.deepEqual(log.filter((x) => x.startsWith('late')), ['late:owned'], 'поздний ответ «куплено» не потерян');
});

test('В1 (сценарий E ревьюера): после отмены магазин молчит - окно неуспеха, но unknown ≠ «не куплено»: поздний owned открывает', async () => {
  let release;
  const pl = payPlugin({ sheet: { status: 'cancelled' },
    getPurchases: (n, def) => (n === 1 ? def() : new Promise((res) => { release = () => res({ owned: true }); })) });
  const { f, log } = flow(pl, { timings: { ownsMs: 30 } });
  const r = await f.buy();
  assert.equal(r.kind, 'cancelled');
  release(); await flush();
  assert.deepEqual(log.filter((x) => x.startsWith('late')), ['late:owned']);
});

test('В1: CheckFailed (нет сети при возврате) - ждём итога своей покупки, а не «не прошла»', async () => {
  let fail = true;
  const pl = payPlugin({ checkFail: () => fail });
  const { f, C } = flow(pl);
  const p = f.buy();
  await flush();
  pl.session.pay('PAID');
  pl.appResume();
  await flush();
  assert.equal(f.state(), 'pending');
  fail = false;
  await C.advance(5000);
  assert.equal((await p).kind, 'ok');
});

test('В1: двойной тап - одна шторка', async () => {
  const pl = payPlugin();
  const { f } = flow(pl);
  f.buy(); await flush();
  assert.equal(kindOf(await f.buy()), 'busy');
  assert.equal(pl.calls.purchase, 1);
});

test('В1: код ошибки RuStore выбирает окно; 4000020 без покупки в списке → «Восстановить покупку» → честный текст', async () => {
  for (const [code, kind] of [[null, 'failed'], ['4000025', 'nomethod'], ['RuStoreOutdated', 'outdated'],
    ['UserUnauthorized', 'unauthorized'], ['UserBanned', 'banned'], ['4000020', 'already']]) {
    const pl = payPlugin({ sheet: Object.assign({ status: 'error' }, code ? { code } : {}) });
    assert.equal(kindOf(await flow(pl).f.buy()), kind, 'код ' + code);
  }
  assert.equal(failDialog('already').restore, true);
  const pl = payPlugin();
  assert.equal(kindOf(await flow(pl).f.restore({ already: true })), 'alreadyhidden');
  assert.equal(failDialog('alreadyhidden').restore, true);
});

test('В1: восстановление - куплено → restored; «в обработке» → ждём, а не «не найдена»; нет - notfound', async () => {
  const pl = payPlugin();
  const id = pl.addPurchase('PAID');
  const r = await flow(pl).f.restore();
  assert.equal(r.kind, 'restored'); assert.deepEqual(pl.acks, [id]);
  const pl2 = payPlugin();
  const pid = pl2.addPurchase('PROCESSING');
  const { f, C, log } = flow(pl2);
  const p = f.restore();
  await flush();
  assert.deepEqual(log, ['pending']);
  pl2.setStatus(pid, 'PAID');
  await C.advance(5000);
  assert.equal((await p).kind, 'ok');
  assert.equal(kindOf(await flow(payPlugin()).f.restore()), 'notfound');
});

test('В1: при входе в сейф свежая оплата «в обработке» → autoRestorePro зовёт onPending, watch ждёт её итога', async () => {
  const pl = payPlugin();
  const pid = pl.addPurchase('EXECUTING', 1000);
  const vault = { version: 1, sections: {} };
  let got = null;
  const a = createRuStorePayment(pl, 'seyf-pro');
  const st = await autoRestorePro({ adapter: a, getVault: () => vault, isPro, markPro, save: async () => {}, onPending: (id) => { got = id; } });
  assert.equal(st, 'pending'); assert.equal(got, pid);
  const { f, C } = flow(pl);
  const p = f.watch(got);
  await flush();
  assert.equal(f.state(), 'pending');
  assert.equal(kindOf(await f.buy()), 'prevpending', 'во время ожидания «Купить» не открывает шторку');
  pl.setStatus(pid, 'PAID');
  await C.advance(5000);
  assert.equal((await p).kind, 'ok');
  assert.equal(pl.calls.purchase, 0);
});

test('В1: «Проверим позже» → на возврат в приложение та покупка перепроверяется и открывает доступ', async () => {
  const pl = payPlugin();
  const { f, C, log } = flow(pl);
  const p = f.buy(); await flush();
  pl.session.pay('PROCESSING'); pl.appResume(); await flush();
  await C.advance(180000);
  assert.equal((await p).kind, 'later');
  assert.equal(f.resume(), true);
  pl.setStatus(pl.session.realId, 'PAID');
  assert.equal(f.resume(), true); await flush();
  assert.deepEqual(log.filter((x) => x.startsWith('late')), ['late:ok']);
});

test('В1: плагин ответил busy (страница перезагрузилась при живой шторке) → окно «Оплата ещё не завершена», не «не прошла»', async () => {
  const a = { kind: 'rustore', status: async () => ({ owned: false }), purchase: async () => normPurchase({ status: 'busy' }) };
  const f = createPurchaseFlow({ getAdapter: () => a });
  assert.equal(kindOf(await f.buy()), 'sheetbusy');
  assert.equal(failDialog('sheetbusy').restore, true);
});

// ======================= В2: проверка до шторки =======================
test('В2 (сценарии C, D ревьюера): сеть/VPN, «не вошёл», устаревший RuStore - шторка открывается', async () => {
  for (const pc of [{ available: false }, { available: false, code: 'UserUnauthorized', authorized: false },
    { available: false, code: 'RuStoreOutdated' }, { authorized: false, available: true }, null]) {
    const pl = payPlugin({ precheck: pc, sheet: { status: 'ok' } });
    const { f, log } = flow(pl);
    const r = await f.buy();
    assert.equal(pl.calls.purchase, 1, 'шторка открыта при ' + JSON.stringify(pc));
    assert.equal(r.kind, 'ok');
    if (pc && pc.authorized === false) assert.ok(log.includes('precheck:noauth'), 'строка про вход перед шторкой');
  }
});

test('В2: путь к оплате закрывают только UserBanned, ApplicationBanned, NotConfigured', async () => {
  for (const [code, kind] of [['UserBanned', 'banned'], ['ApplicationBanned', 'banned'], ['NotConfigured', 'unavailable']]) {
    const pl = payPlugin({ precheck: { available: false, code } });
    assert.equal(kindOf(await flow(pl).f.buy()), kind);
    assert.equal(pl.calls.purchase, 0, code + ': шторка не открывалась');
  }
  assert.equal(finalKind({ available: false, code: '4000025' }), null);
  assert.equal(finalKind({ available: false }), null);
  assert.equal(finalKind({ available: true, code: 'UserBanned' }), null);
});

test('В2: RuStore не установлен - своё окно «Нужен RuStore» с «Открыть RuStore», шторку не открываем', async () => {
  for (const pc of [{ installed: false, authorized: false }, { available: false, code: 'RuStoreNotInstalled' }]) {
    const pl = payPlugin({ precheck: pc });
    assert.equal(kindOf(await flow(pl).f.buy()), 'notinstalled');
    assert.equal(pl.calls.purchase, 0);
  }
  assert.equal(FAIL_DIALOGS.notinstalled.openStore, true);
  const APP = read('www', 'js', 'app.js');
  const fail = APP.slice(APP.indexOf('async function openPayFail('), APP.indexOf('async function openPayFail(') + 1800);
  assert.match(fail, /f\.openStore\) buttons = \[[^\]]*'Открыть RuStore', value: 'store'/);
  assert.match(APP, /store: \(\) => openRuStore\(\)/);
  assert.match(APP, /function openRuStore\(\) \{\s*const S = window\.StoreUpdate;\s*if \(S && typeof S\.openStore === 'function'\) \{ S\.openStore\(null, openExternal\); return; \}/);
});

test('В2: строки пейволла - СБП всегда; «не вошёл» - строка про вход; бан/не подключено/нет RuStore - причина', () => {
  assert.deepEqual(payHintLines(null), [PAY_TEXT.sbp]);
  assert.deepEqual(payHintLines({ authorized: false, available: true }), [PAY_TEXT.sbp, PAY_TEXT.auth]);
  assert.deepEqual(payHintLines({ available: false, code: 'UserUnauthorized' }), [PAY_TEXT.sbp, PAY_TEXT.auth]);
  assert.deepEqual(payHintLines({ available: false }), [PAY_TEXT.sbp], 'сеть - не «оплата недоступна»');
  assert.deepEqual(payHintLines({ available: false, code: 'UserBanned' }), [FAIL_DIALOGS.banned.text]);
  assert.deepEqual(payHintLines({ installed: false }), [FAIL_DIALOGS.notinstalled.text]);
  assert.ok(!/выберите/i.test(PAY_TEXT.sbp), 'СБП уже выбран: «оставьте», не «выберите»');
});

test('В2: экран покупки закрыли, пока шли проверки, - шторку не открываем', async () => {
  const pl = payPlugin();
  const r = await flow(pl, { stillHere: () => false }).f.buy();
  assert.equal(r.kind, 'none');
  assert.equal(pl.calls.purchase, 0);
});

// ======================= М5: шторка в withSystemWindow =======================
test('М5: шторка RuStore открывается через wrapSheet (app.js: withSystemWindow с удержанием автоблока)', async () => {
  const pl = payPlugin({ sheet: { status: 'ok' } });
  const seen = [];
  const r = await flow(pl, { wrapSheet: async (fn) => { seen.push('in:' + pl.calls.purchase); const v = await fn(); seen.push('out:' + pl.calls.purchase); return v; } }).f.buy();
  assert.equal(r.kind, 'ok');
  assert.deepEqual(seen, ['in:0', 'out:1'], 'обёрнут ровно вызов шторки');
  const APP = read('www', 'js', 'app.js');
  assert.match(APP, /wrapSheet: \(fn\) => withSystemWindow\(fn, \{ holdAutoLock: true \}\)/);
  const w = APP.slice(APP.indexOf('async function withSystemWindow('), APP.indexOf('function onBackground('));
  assert.match(w, /return await sysWin\.run\(fn, /, 'флаг «системное окно» - syswindow.js (ревью 1.3.3 М1)');
  assert.match(w, /if \(hold\) autoLock\.disarm\(\);/, 'таймер бездействия стоит, пока человек в банке');
  assert.match(w, /finally \{ if \(!sysWin\.isOpen\(\) && !sysWin\.isHidden\(\)\) bgAt = 0; if \(hold && autoLock && state\.vault && !locking\) autoLock\.arm\(\); \}/);
});

// ======================= заслон протокола ошибок (В1 перенесли из донора старым) =======================
test('ЗАСЛОН: плагин - сессия покупки (onPurchaseCreated, handleOnResume → getPurchase(id), purchaseLate, PROCESSING/EXECUTING); в www нет stuckMs/graceMs/rescue', () => {
  const J = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'RuStorePayPlugin.java');
  assert.match(J, /public void onPurchaseCreated\(PurchaseId purchaseId, InvoiceId invoiceId\) \{ seen\(purchaseId, "created"\); \}/);
  assert.match(J, /protected void handleOnResume\(\) \{/);
  assert.match(J, /protected void handleOnPause\(\) \{/);
  assert.match(J, /checkAfterReturn\(s\);/);
  assert.match(J, /getPurchase\(new PurchaseId\(purchaseId\)\)/);
  assert.match(J, /notifyListeners\("purchaseLate", r\)/);
  assert.match(J, /getBridge\(\)\.saveCall\(call\)/);
  assert.match(J, /ProductPurchaseStatus\.PROCESSING, ProductPurchaseStatus\.EXECUTING/);
  assert.match(J, /@PluginMethod\s+public void checkPurchase\(/);
  assert.ok(!/NoopPurchaseEvents/.test(J), 'слушатель шторки не пустой');
  const dir = path.join(ROOT, 'www');
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'vendor') walk(f); } else if (/\.js$/.test(e.name) && !/wordlist/.test(e.name)) files.push(f); } })(dir);
  assert.ok(files.length > 20);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/stuckMs|graceMs|rescue/.test(src), 'таймер угадывания шторки в ' + path.relative(ROOT, f));
  }
});

// ======================= отметка выдачи, адаптеры =======================
test('getPurchases с ackPending → status.ackId; «в обработке» → pending/pendingId; restore отдаёт purchaseId', async () => {
  const p = payPlugin();
  const id = p.addPurchase('PAID');
  const a = createRuStorePayment(p, 'seyf-pro');
  const st = await a.status();
  assert.equal(st.owned, true); assert.equal(st.ackId, id);
  assert.deepEqual(await a.restore(), { ok: true, purchased: true, purchaseId: id });
  assert.equal(await a.acknowledge(id), true);
  const p2 = payPlugin(); const pid = p2.addPurchase('PROCESSING', 5);
  const s2 = await createRuStorePayment(p2, 'seyf-pro').status({ auth: false });
  assert.equal(s2.pending, true); assert.equal(s2.pendingId, pid); assert.equal(s2.pendingAgeMs, 5);
  assert.equal(p2.gpArgs.at(-1).auth, false, 'снимку вход в RuStore не нужен');
  assert.equal((await snapshot(createRuStorePayment(p2, 'seyf-pro'))).pending, true);
});

test('autoRestorePro: восстановил покупку без отметки выдачи → отмечает ACKNOWLEDGED', async () => {
  const p = payPlugin();
  const id = p.addPurchase('PAID');
  const vault = { version: 1, sections: {} };
  const r = await autoRestorePro({ adapter: createRuStorePayment(p, 'seyf-pro'), getVault: () => vault, isPro, markPro, save: async () => {} });
  assert.equal(r, 'restored');
  assert.deepEqual(p.acks, [id]);
});

test('ackPendingPro: Pro по RuStore, покупка не отмечена → отметка; ключ/мок/уже отмечено → нет', async () => {
  const p = payPlugin(); p.addPurchase('PAID');
  const a = createRuStorePayment(p, 'seyf-pro');
  assert.equal(await ackPendingPro({ adapter: a, vault: markPro({}, { source: 'rustore' }) }), 'acked');
  assert.equal(await ackPendingPro({ adapter: a, vault: markPro({}, { source: 'license' }) }), 'skip');
  assert.equal(await ackPendingPro({ adapter: createMockPayment(), vault: markPro({}, { source: 'rustore' }) }), 'skip');
  assert.equal(await ackPendingPro({ adapter: a, vault: markPro({}, { source: 'rustore' }) }), 'none', 'уже отмечено');
});

test('мок тест-сборки: покупка идёт без снимка владения и даёт ok; «оплата недоступна» - никогда не ok', async () => {
  assert.equal((await createPurchaseFlow({ getAdapter: () => createMockPayment() }).buy()).kind, 'ok');
  assert.equal((await createPurchaseFlow({ getAdapter: () => createUnavailablePayment() }).buy()).kind, 'unavailable');
  assert.equal((await createPurchaseFlow({ getAdapter: () => createRuStorePayment(payPlugin({ unavailable: true }), 'seyf-pro') }).buy()).kind, 'unavailable');
  for (const a of [createMockPayment(), createUnavailablePayment()]) {
    assert.equal(await a.precheck(), null);
    assert.equal(await a.acknowledge('x'), false);
    assert.equal(await a.getPriceLabel(), null);
  }
});

test('normPurchase: ok только при ok === true; NotConfigured → unavailable', () => {
  assert.equal(normPurchase({ status: 'ok', ok: 'true' }).status, 'error');
  assert.equal(normPurchase({ ok: 1 }).status, 'error');
  assert.equal(normPurchase({ ok: false, error: 'x', code: 'NotConfigured' }).status, 'unavailable');
  assert.equal(normPurchase({ ok: false, error: 'unavailable' }).status, 'unavailable');
  assert.equal(normPurchase({ ok: false, cancelled: true }).status, 'cancelled');
});

// ======================= цена из магазина =======================
test('formatPrice: «990.00 руб.» → «990 ₽» (неразрывные пробелы), копейки, незнакомый формат как есть', () => {
  assert.equal(formatPrice('990.00 руб.'), '990' + NB + '₽');
  assert.equal(formatPrice('990 руб.'), '990' + NB + '₽');
  assert.equal(formatPrice('1290.50 руб.'), '1' + NB + '290,50' + NB + '₽');
  assert.equal(formatPrice('1 290,00 ₽'), '1' + NB + '290' + NB + '₽');
  assert.equal(formatPrice('5 USD'), '5 USD');
  assert.equal(formatPrice(''), null);
  assert.equal(formatPrice(null), null);
});

test('цена из плагина getProducts доходит до адаптера как пришла', async () => {
  assert.equal(await createRuStorePayment(payPlugin({ priceLabel: '990.00 руб.' }), 'seyf-pro').getPriceLabel(), '990.00 руб.');
  assert.equal(await createRuStorePayment(payPlugin({}), 'seyf-pro').getPriceLabel(), null);
});

test('kindOfCode: незнакомый код - общее окно', () => {
  assert.equal(kindOfCode('999'), 'failed');
  assert.equal(kindOfCode(undefined), 'failed');
  assert.equal(kindOfCode('4000020'), 'already');
});

// ======================= тексты =======================
test('тексты покупки: на «вы», без длинного тире, без e-mail и обещания «деньги не списаны»; VPN-строка есть', () => {
  const all = Object.values(PAY_TEXT)
    .concat(Object.values(FAIL_DIALOGS).map((d) => d.title + ' ' + d.text))
    .concat(Object.values(INFO_DIALOGS).map((d) => d.title + ' ' + d.text)).join('\n');
  assert.ok(!/[—–]/.test(all));
  // \b в JS только ASCII - для кириллицы границы слова через lookbehind/lookahead
  assert.ok(!/(?<![а-яё])(ты|тебе|твой|твоя|нажми|выбери|подожди|оплати)(?![а-яё])/iu.test(all));
  assert.ok(!/(?<=[а-яё,] )Вы(?![а-яё])/u.test(all), '«Вы» с заглавной посреди фразы');
  assert.ok(!/деньги не списаны/i.test(all));
  assert.ok(!/@|mailto/i.test(all));
  assert.match(PAY_TEXT.vpn, /VPN/);
  assert.ok(FAIL_DIALOGS.failed.vpn && FAIL_DIALOGS.nomethod.vpn);
  assert.match(INFO_DIALOGS.pending.text, /Не платите второй раз/);
});

// ======================= источник: плагин и окно покупки =======================
test('RuStorePayPlugin: код ошибки в JS, precheck c installed, acknowledge, getProducts, ackPending, appUserId не уходит', () => {
  const J = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'RuStorePayPlugin.java');
  assert.match(J, /String code = errorCode\(t\);\s*if \(code != null\) base\.put\("code", code\);/);
  assert.match(J, /RuStorePaymentNetworkException\) c\)\.getCode\(\)/);
  for (const m of ['precheck', 'acknowledge', 'getProducts', 'checkPurchase']) assert.match(J, new RegExp('@PluginMethod\\s+public void ' + m + '\\('));
  assert.match(J, /RuStoreUtils\.INSTANCE\.isRuStoreInstalled\(getContext\(\)\)/);
  assert.match(J, /getPurchaseAvailability\(\)/);
  assert.match(J, /updateAcknowledgementState\(new PurchaseId\(id\), AcknowledgementState\.ACKNOWLEDGED, null\)/);
  assert.match(J, /ret\.put\("ackPending", true\)/);
  assert.match(J, /\/\* appUserId \*\/ null/);
});

test('окно покупки: ход через purchaseFlow, итог через showPayResult, «в обработке» - своё окно, возврат в приложение перепроверяет', () => {
  const APP = read('www', 'js', 'app.js');
  const pw = APP.slice(APP.indexOf('function openPaywall('), APP.indexOf('function bindCardExpand('));
  assert.match(pw, /buyBtn\.onclick = \(\) => \{[\s\S]*?startBuy\(\);/);
  assert.match(pw, /restoreBtn\.onclick = \(\) => \{[\s\S]*?startRestore\(\);/);
  assert.match(pw, /class="pw-hint"/);
  assert.match(pw, /Купить за \$\{priceText\(\)\}/);
  assert.match(APP, /purchaseFlow\.buy\(opts\)\.then\(\(r\) => showPayResult\(r\)/);
  assert.match(APP, /onPending: \(\) => showPayPending\(\)/);
  assert.match(APP, /onLate: \(r\) => showPayResult\(r, \{ away: true \}\)/);
  assert.match(APP, /onPending: \(pid\) => \{ purchaseFlow\.watch\(pid\)/, 'оплата «в обработке» при входе - ожидание');
  const fg = APP.slice(APP.indexOf('function onForeground('), APP.indexOf('function onForeground(') + 400);
  assert.match(fg, /purchaseFlow\.resume\(\)/);
  const fail = APP.slice(APP.indexOf('async function openPayFail('), APP.indexOf('async function openPayFail(') + 1800);
  for (const l of ['Попробовать снова', 'Позже', 'Восстановить покупку', 'Оплатить снова', 'Подождать', 'Открыть RuStore']) assert.ok(fail.includes(`'${l}'`), l);
  assert.match(fail, /note: f\.vpn \? PAY_TEXT\.vpn/);
  assert.ok(!/Покупка отменена/.test(APP), 'отмена - окно, не тост');
});

test('мелочь 1.3.2: окно «Полная версия» открывается с начала (фокус без прокрутки к «Купить»)', () => {
  const APP = read('www', 'js', 'app.js');
  const pw = APP.slice(APP.indexOf('function openPaywall('), APP.indexOf('function precheckPay('));
  assert.ok(!/buyBtn\.focus\(\);/.test(pw), 'голый focus() прокручивает окно к кнопке');
  assert.match(pw, /buyBtn\.focus\(\{ preventScroll: true \}\)/);
  assert.match(pw, /m\.scrollTop = 0;/);
});

test('цена в меню и на кнопке - одна функция priceText (магазин или своя, с неразрывным пробелом)', () => {
  const APP = read('www', 'js', 'app.js');
  assert.match(APP, /function priceText\(\) \{ return priceShow\(\)\.now; \}/);
  assert.match(APP, /Купить за \$\{priceText\(\)\}/);
  assert.match(APP, /'Купить за ' \+ \(p\.old \?/);
  assert.ok(!/PRO_PRICE_RUB \+ ' ₽'/.test(APP));
});

// ======================= добивка по мутациям =======================
test('В1: «Подождать» в окне «Предыдущая оплата ещё проверяется» - прошлая оплата опрашивается в фоне и открывает доступ сама', async () => {
  const pl = payPlugin();
  const { f, C, log } = flow(pl);
  const first = pl.addPurchase('PROCESSING', 60000);
  assert.equal(kindOf(await f.buy()), 'prevpending');
  assert.equal(f.polling(), true, 'фоновый опрос запущен');
  pl.setStatus(first, 'PAID');
  await C.advance(5000);
  assert.deepEqual(log.filter((x) => x.startsWith('late')), ['late:ok']);
  assert.equal(pl.calls.purchase, 0);
});

test('В1: плагин не знает id покупки и ответил «отмена», а магазин видит оплату → доступ (перепроверка в JS)', async () => {
  const pl = payPlugin({ noId: true, sheet: (s) => { s.pay('PAID'); s.end({ status: 'cancelled' }); } });
  const r = await flow(pl).f.buy();
  assert.equal(r.granted, true);
  assert.equal(r.kind, 'ok');
});

test('В1: CheckFailed без начатой оплаты - первый ответ «open» сразу заканчивает ожидание (не держим 3 минуты)', async () => {
  let fail = true;
  const pl = payPlugin({ checkFail: () => fail });
  const { f, C } = flow(pl);
  const p = f.buy();
  await flush();
  pl.appResume();                                           // оплата не начиналась, проверка упала
  await flush();
  assert.equal(f.state(), 'pending');
  fail = false;
  await C.advance(5000);
  assert.equal((await p).kind, 'cancelled');
});

// Проход «новичок» 1.3.3 (27.10.2026): человек боится второго списания и не знает, что делать, если деньги ушли.
test('новичок 1.3.3: окна после неуспеха говорят, что делать, если деньги всё же списались; отмена - не «не прошла»', () => {
  for (const k of ['failed', 'cancelled']) {
    assert.match(FAIL_DIALOGS[k].text, /Если деньги всё же списались, нажмите «Восстановить покупку»/, k);
    assert.equal(FAIL_DIALOGS[k].retry, true, k + ': «Попробовать снова» по регламенту');
  }
  assert.equal(failDialog('cancelled').title, 'Оплата не завершена', 'сам закрыл окно оплаты - не «Оплата не прошла»');
  assert.match(FAIL_DIALOGS.nocheck.text, /окно оплаты не открылось/i, 'до шторки: ясно, что оплаты не было');
  // выбор при прошлой оплате: каждая кнопка названа в тексте, «не платите второй раз» стоит первым
  const pp = FAIL_DIALOGS.prevpending.text;
  assert.ok(pp.includes('Не платите второй раз') && pp.indexOf('Не платите второй раз') < pp.indexOf('«Оплатить снова»'), pp);
  assert.match(pp, /«Подождать»/);
  // в окнах, где нужно восстановить покупку, называется сама кнопка, а не действие своими словами
  for (const k of ['already', 'alreadyhidden', 'sheetbusy']) assert.match(FAIL_DIALOGS[k].text, /«Восстановить покупку»/, k);
  assert.match(INFO_DIALOGS.error.text, /«Восстановить покупку» ещё раз/);
  // без технических слов, которых новичок не знает
  const all = Object.values(FAIL_DIALOGS).map((d) => d.title + ' ' + d.text).concat(Object.values(INFO_DIALOGS).map((d) => d.title + ' ' + d.text), Object.values(PAY_TEXT)).join('\n');
  assert.ok(!/сборк|устройств[оа] |записалась на устройство|просто оставьте/i.test(all), 'слова «сборка», «записалась на устройство», «просто оставьте» убраны');
});
