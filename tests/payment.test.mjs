// payment.test.mjs — адаптер оплаты. MockPayment покрывает логику разблокировки без девайса;
// selectPaymentAdapter выбирает нативный RuStore только в нативном окружении с плагином.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_ID, createMockPayment, createRuStorePayment, selectPaymentAdapter,
  createUnavailablePayment, mockAllowed, PAY_UNAVAILABLE,
} from '../www/js/payment.js';

test('PRODUCT_ID задан одной строкой-константой', () => {
  assert.equal(typeof PRODUCT_ID, 'string');
  assert.ok(PRODUCT_ID.length > 0);
});

test('MockPayment: не куплено → покупка → куплено', async () => {
  const p = createMockPayment();
  assert.equal(p.kind, 'mock');
  assert.equal(await p.isPurchased(), false);
  const r = await p.purchase();
  assert.equal(r.ok, true);
  assert.equal(await p.isPurchased(), true);
});

test('MockPayment: restore отражает владение', async () => {
  const p = createMockPayment();
  assert.deepEqual(await p.restore(), { ok: true, purchased: false });
  await p.purchase();
  assert.deepEqual(await p.restore(), { ok: true, purchased: true });
});

test('MockPayment({owned:true}): уже куплено (симуляция восстановления)', async () => {
  const p = createMockPayment({ owned: true });
  assert.equal(await p.isPurchased(), true);
  assert.equal((await p.restore()).purchased, true);
});

// --- selectPaymentAdapter: выбор реализации по окружению ---

// Ревью 1.3.0, п.1a (HIGH): веб-часть боевого APK, открытая в браузере, выдавала Pro через mock.
// Теперь mock - ТОЛЬКО тест-сборка (FULL=true без признаков релиза/стора); иначе «оплата недоступна».
test('selectPaymentAdapter: тест-сборка (FULL=true) вне нативки → mock', () => {
  const flags = { full: true, store: false, demo: true };
  assert.equal(selectPaymentAdapter({ flags }).kind, 'mock');
  assert.equal(selectPaymentAdapter({ isNativeApp: () => false, flags }).kind, 'mock');
  assert.equal(selectPaymentAdapter({ isNativeApp: () => true, NativePlugins: {}, flags }).kind, 'mock');
});

test('selectPaymentAdapter: релиз/стор/без флагов вне нативки → «оплата недоступна», НЕ mock', () => {
  const cases = [
    {},                                                    // нет флагов вообще (fail-closed)
    { full: false },                                       // рабочая www / OTA
    { full: false, demo: false },                          // релиз-APK
    { full: false, demo: false, store: true },             // стор-APK (как у mockpro.mjs ревьюера)
    { full: true, store: true },                           // FULL, но признак стора - всё равно нет
    { full: true, demo: false },                           // FULL, но признак релиза - нет
    { full: 'true' },                                      // не строго true
  ];
  for (const flags of cases) {
    assert.equal(selectPaymentAdapter({ flags }).kind, PAY_UNAVAILABLE, JSON.stringify(flags));
    assert.equal(selectPaymentAdapter({ isNativeApp: () => false, flags }).kind, PAY_UNAVAILABLE, JSON.stringify(flags));
    assert.equal(selectPaymentAdapter({ isNativeApp: () => true, NativePlugins: {}, flags }).kind, PAY_UNAVAILABLE, 'нативка без плагина ' + JSON.stringify(flags));
  }
  assert.equal(selectPaymentAdapter().kind, PAY_UNAVAILABLE);
});

test('mockAllowed: только full===true и нет store/demo:false', () => {
  assert.equal(mockAllowed({ full: true }), true);
  assert.equal(mockAllowed({ full: true, demo: true, store: false }), true);
  assert.equal(mockAllowed({}), false);
  assert.equal(mockAllowed({ full: 1 }), false);
  assert.equal(mockAllowed({ full: true, store: true }), false);
  assert.equal(mockAllowed({ full: true, demo: false }), false);
});

test('«оплата недоступна»: покупка никогда не ok, восстановление не находит, владения нет', async () => {
  const a = createUnavailablePayment();
  assert.equal(a.kind, PAY_UNAVAILABLE);
  const r = await a.purchase();
  assert.equal(r.ok, false);
  assert.equal(r.error, PAY_UNAVAILABLE);
  const rs = await a.restore();
  assert.equal(rs.purchased, false);
  assert.equal(rs.ok, false);
  assert.equal(await a.isPurchased(), false);
});

// Ревью 1.3.0, п.3: владение спрашиваем с productId - нативный ownsProduct без id не засчитывает ничего.
test('createRuStorePayment: getPurchases всегда с {productId}', async () => {
  const calls = [];
  const plugin = { async purchase() { return { ok: false }; }, async getPurchases(o) { calls.push(o); return { owned: false }; } };
  const a = createRuStorePayment(plugin, 'seyf-pro');
  await a.isPurchased();
  await a.restore();
  assert.deepEqual(calls, [{ productId: 'seyf-pro' }, { productId: 'seyf-pro' }]);
});

test('selectPaymentAdapter: нативное + плагин RuStorePay → rustore, зовёт плагин', async () => {
  const calls = [];
  const fakePlugin = {
    async purchase(opts) { calls.push(['purchase', opts]); return { ok: true, purchaseId: 'rs-1' }; },
    async getPurchases(o) { calls.push(['getPurchases', o]); return { owned: true }; },
  };
  const adapter = selectPaymentAdapter({
    isNativeApp: () => true,
    NativePlugins: { RuStorePay: fakePlugin },
  });
  assert.equal(adapter.kind, 'rustore');

  const r = await adapter.purchase();
  assert.equal(r.ok, true);
  assert.equal(r.purchaseId, 'rs-1');
  assert.deepEqual(calls[0], ['purchase', { productId: PRODUCT_ID }]);

  assert.equal(await adapter.isPurchased(), true);
  assert.deepEqual(await adapter.restore(), { ok: true, purchased: true });
  assert.deepEqual(calls[1], ['getPurchases', { productId: PRODUCT_ID }]);
});

test('createRuStorePayment: отмена и ошибка проброшены наружу', async () => {
  const cancelPlugin = { async purchase() { return { ok: false, cancelled: true }; }, async getPurchases() { return { owned: false }; } };
  const a = createRuStorePayment(cancelPlugin, PRODUCT_ID);
  const r = await a.purchase();
  assert.equal(r.ok, false);
  assert.equal(r.cancelled, true);
  assert.equal(await a.isPurchased(), false);
});
