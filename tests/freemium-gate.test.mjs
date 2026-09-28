// freemium-gate.test.mjs — единый источник доступа п.24: чистая логика computeAccess (pay.js),
// fail-closed access.js, единый id товара (pay-config.js) и ПРОВОДКА в app.js (гейт через
// hasFullAccess, window.Pay, buildflags до app.js, тексты статусов на «вы»).
// Мутация подтверждена: ослабить full===true до truthy / убрать Access.FULL из гейта /
// вернуть true в buildflags.js — тест краснеет (см. ниже конкретные assert).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAccess } from '../www/js/pay.js';
import { PRODUCT_ID, isConfigured, PLACEHOLDER } from '../www/js/pay-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');

// ---------- computeAccess: три двери, любая открывает (чистая логика + мутация) ----------

test('computeAccess: Access.FULL (debug/демо) открывает доступ', () => {
  assert.equal(computeAccess({ full: true }), true);
  assert.equal(computeAccess({ full: true, isPro: () => false }), true);
});

test('computeAccess: покупка/лицензия (isPro=true по vault.pro) открывает доступ', () => {
  assert.equal(computeAccess({ full: false, vault: { pro: { purchased: true } }, isPro: (v) => !!(v && v.pro && v.pro.purchased) }), true);
});

test('computeAccess: ни одной двери → НЕ открыт (free)', () => {
  assert.equal(computeAccess({ full: false, vault: {}, isPro: () => false }), false);
  assert.equal(computeAccess({}), false);
  assert.equal(computeAccess({ full: false }), false);
});

test('computeAccess: full строго === true (мутация: truthy не проходит)', () => {
  assert.equal(computeAccess({ full: 'yes' }), false);
  assert.equal(computeAccess({ full: 1 }), false);
  assert.equal(computeAccess({ full: {} }), false);
});

test('computeAccess: сбой isPro не выдаёт доступ (защита)', () => {
  assert.equal(computeAccess({ full: false, isPro: () => { throw new Error('boom'); } }), false);
});

// ---------- access.js: fail-closed ----------

test('access.js (node, флага нет): FULL=false, PAY=true', async () => {
  const mod = await import('../www/js/access.js');
  assert.equal(mod.FULL, false, 'без вшитого флага полный доступ выключен (fail-closed)');
  assert.equal(mod.PAY, true);
});

test('access.js: FULL строго от window.SEYF_FULL_ACCESS===true (свежий импорт с флагом)', async () => {
  const prev = globalThis.window;
  globalThis.window = { SEYF_FULL_ACCESS: true };
  try {
    const mod = await import('../www/js/access.js?withflag=1');
    assert.equal(mod.FULL, true);
  } finally { globalThis.window = prev; }
});

test('access.js: source — сравнение строго === true (мутация: != true открыло бы всё)', () => {
  const src = read('www', 'js', 'access.js');
  assert.match(src, /SEYF_FULL_ACCESS === true/, 'FULL должен требовать строгое === true');
});

// ---------- pay-config.js: единый id товара, плейсхолдер ----------

test('pay-config: PRODUCT_ID = seyf-pro (продукт из задания п.24)', () => {
  assert.equal(PRODUCT_ID, 'seyf-pro');
});

// 1.3.0: Алексей выдал боевой id из Консоли RuStore (https://console.rustore.ru/apps/2063760405);
// build-apk.js --store --app-id=2063760405 вписал его в pay-config.js и strings.xml.
test('pay-config: боевой console_app_id вписан (2063760405) → isConfigured=true', () => {
  assert.equal(isConfigured(), true);
  assert.ok(PLACEHOLDER.length > 0);
  assert.ok(!isConfigured.toString().includes('2063760405'), 'проверка не захардкожена на id');
});

test('payment.js реэкспортирует тот же PRODUCT_ID из pay-config (один источник)', async () => {
  const pay = await import('../www/js/payment.js');
  assert.equal(pay.PRODUCT_ID, PRODUCT_ID);
});

// ---------- buildflags.js: fail-closed по умолчанию в репозитории ----------

test('buildflags.js в репозитории = false (браузер/OTA/релиз не раздают Pro бесплатно)', () => {
  const src = read('www', 'buildflags.js');
  assert.match(src, /window\.SEYF_FULL_ACCESS\s*=\s*false\s*;/, 'коммит должен держать флаг false');
});

test('index.html грузит buildflags.js ДО app.js (флаг готов к первой отрисовке)', () => {
  const html = read('www', 'index.html');
  const iFlags = html.indexOf('buildflags.js');
  const iApp = html.indexOf('js/app.js');
  assert.ok(iFlags >= 0, 'index.html должен грузить buildflags.js');
  assert.ok(iApp >= 0, 'index.html должен грузить app.js');
  assert.ok(iFlags < iApp, 'buildflags.js должен идти раньше app.js');
});

// ---------- проводка в app.js (source-guard) ----------

const APP = read('www', 'js', 'app.js');

test('app.js: единый hasFullAccess = computeAccess(Access.FULL + vaultIsPro)', () => {
  assert.match(APP, /function hasFullAccess\(\)\s*\{[\s\S]*computeAccess\(\{[\s\S]*full:\s*Access\.FULL[\s\S]*isPro:\s*vaultIsPro[\s\S]*\}\)/,
    'hasFullAccess должен собирать доступ из Access.FULL и vaultIsPro через computeAccess');
});

// Ревью 1.3.0, п.1b: любой Pro по vault в app.js - только через vaultIsPro, а тот признаёт
// отметку тест-мока лишь в тест-сборке (anySource: Access.FULL). Голый Gate.isPro(state.vault)
// (без проверки источника) в app.js запрещён.
test('app.js: vaultIsPro = Gate.isPro(v, { anySource: Access.FULL }); голого Gate.isPro(state.vault) нет', () => {
  assert.match(APP, /function vaultIsPro\(v\)\s*\{\s*return Gate\.isPro\(v,\s*\{\s*anySource:\s*Access\.FULL\s*\}\);\s*\}/);
  const calls = APP.match(/Gate\.isPro\(/g) || [];
  assert.equal(calls.length, 1, 'Gate.isPro зовётся ровно в одном месте - в vaultIsPro');
});

// Ревью 1.3.0, п.1a: адаптер оплаты получает флаги сборки (mock только в тест-сборке).
test('app.js: selectPaymentAdapter получает flags {full, store, demo} из access.js', () => {
  assert.match(APP, /selectPaymentAdapter\(\{[\s\S]*?flags:\s*\{\s*full:\s*Access\.FULL,\s*store:\s*Access\.STORE,\s*demo:\s*Access\.DEMO\s*\}/);
});

// Ревью 1.3.0, п.2: тихое восстановление покупки после разблокировки - без окон.
test('app.js: afterUnlock зовёт autoRestoreQuietly; он без dlgAlert/dlgConfirm', () => {
  const a = APP.slice(APP.indexOf('async function afterUnlock'));
  const aBody = a.slice(0, a.indexOf('\n}\n'));
  assert.match(aBody, /autoRestoreQuietly\(\);/);
  const q = APP.slice(APP.indexOf('function autoRestoreQuietly'));
  const qBody = q.slice(0, q.indexOf('\n}\n'));
  assert.match(qBody, /autoRestorePro\(\{/);
  assert.ok(!/dlgAlert|dlgConfirm|dlgPrompt/.test(qBody), 'тихое восстановление без окон');
});

test('app.js: free-гейт создания идёт через hasFullAccess() (Access.FULL снимает лимиты в debug/демо)', () => {
  assert.match(APP, /Gate\.canAdd\(state\.vault,\s*section,\s*hasFullAccess\(\)\)/,
    'перехват создания в openEditor обязан спрашивать hasFullAccess(), а не голый Gate.isPro');
});

test('app.js: window.Pay даёт точки входа hasFullAccess/buyFullAccess/restorePurchase', () => {
  const m = APP.match(/window\.Pay\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(m, 'window.Pay не определён');
  assert.match(m[1], /hasFullAccess/);
  assert.match(m[1], /buyFullAccess/);
  assert.match(m[1], /restorePurchase/);
});

test('app.js: тексты статусов Pro на «вы» (задание п.24)', () => {
  assert.match(APP, /Полный доступ открыт\. Спасибо, что поддержали разработку!/);
  assert.match(APP, /Покупка восстановлена\. Полный доступ снова открыт\./);
  assert.match(APP, /В этом аккаунте RuStore покупка не найдена\./);
  // Ревью 1.3.0, п.2: при сбое оплаты НЕ обещаем «деньги не списаны» (мы этого не знаем).
  assert.match(APP, /Платёж не прошёл\. Если деньги всё же списались - нажмите «Восстановить покупку»\./);
  assert.ok(!/деньги не списаны/.test(APP), 'ложное обещание «деньги не списаны» убрано');
  assert.match(APP, /Полная версия уже куплена в этом аккаунте RuStore\. Покупка восстановлена, платить ещё раз не нужно\./);
});
