// review5-130.test.mjs - находки финального ревью боевого APK 1.3.0 (до загрузки в RuStore).
//   п.2  покупка: уже куплено -> путь «Восстановить покупку», сбой -> проверка владения;
//        тихое восстановление после разблокировки (pay.js runPurchase / autoRestorePro);
//   п.3  нативный ownsProduct засчитывает ТОЛЬКО товар с переданным productId (source-guard Java);
//   п.4  тексты про буфер обмена = поведение (clipboard.js чистит и вслепую).
// Мутации (scratchpad/mutate-review5.mjs): каждое ослабление ниже краснеет своим тестом.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPurchase, autoRestorePro } from '../www/js/pay.js';
import { isPro, markPro } from '../www/js/gate.js';
import { createRuStorePayment, createMockPayment, createUnavailablePayment } from '../www/js/payment.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Фейковый нативный плагин RuStorePay: владение и исход покупки задаются сценарием.
function plugin({ owned = false, ownedAfter = null, purchase = { ok: true, purchaseId: 'rs-1' }, getFails = false, purchaseThrows = false } = {}) {
  const calls = [];
  let bought = false, tried = false;
  return {
    calls,
    async getPurchases(o) {
      calls.push(['get', o]);
      if (getFails) throw new Error('сеть');
      return { owned: owned || bought || (tried && ownedAfter === true) };
    },
    async purchase(o) {
      calls.push(['buy', o]);
      tried = true;
      if (purchaseThrows) throw new Error('шторка');
      if (purchase.ok) bought = true;
      return purchase;
    },
  };
}

// ---------------------------------- runPurchase ----------------------------------
test('runPurchase: уже куплено в аккаунте -> owned, повторной оплаты НЕТ', async () => {
  const p = plugin({ owned: true });
  const r = await runPurchase(createRuStorePayment(p, 'seyf-pro'));
  assert.deepEqual(r, { kind: 'owned' });
  assert.ok(!p.calls.some((c) => c[0] === 'buy'), 'шторку оплаты не открывали');
});

test('runPurchase: обычная покупка -> ok с purchaseId', async () => {
  const p = plugin();
  assert.deepEqual(await runPurchase(createRuStorePayment(p, 'seyf-pro')), { kind: 'ok', purchaseId: 'rs-1' });
});

test('runPurchase: отмена -> cancelled (без проверки «куплено ли» после)', async () => {
  const p = plugin({ purchase: { ok: false, cancelled: true } });
  assert.deepEqual(await runPurchase(createRuStorePayment(p, 'seyf-pro')), { kind: 'cancelled' });
});

test('runPurchase: сбой оплаты, но товар в аккаунте есть (деньги списались) -> owned, не «не прошёл»', async () => {
  const p = plugin({ purchase: { ok: false, error: 'Платёж не прошёл' }, ownedAfter: true });
  assert.deepEqual(await runPurchase(createRuStorePayment(p, 'seyf-pro')), { kind: 'owned' });
});

test('runPurchase: сбой оплаты и покупки нет -> failed; исключение шторки -> failed', async () => {
  assert.deepEqual(await runPurchase(createRuStorePayment(plugin({ purchase: { ok: false, error: 'x' } }), 'seyf-pro')), { kind: 'failed' });
  assert.deepEqual(await runPurchase(createRuStorePayment(plugin({ purchaseThrows: true }), 'seyf-pro')), { kind: 'failed' });
});

test('runPurchase: проверка владения упала -> идём в оплату обычным путём', async () => {
  const p = plugin({ getFails: true });
  assert.deepEqual(await runPurchase(createRuStorePayment(p, 'seyf-pro')), { kind: 'ok', purchaseId: 'rs-1' });
});

test('runPurchase: «оплата недоступна» -> unavailable (никогда не ok)', async () => {
  assert.deepEqual(await runPurchase(createUnavailablePayment()), { kind: 'unavailable' });
});

test('runPurchase: mock (тест-сборка) владение не спрашивает, покупка ok', async () => {
  const r = await runPurchase(createMockPayment({ owned: true }));
  assert.equal(r.kind, 'ok', 'owned-путь только для боевого RuStore');
});

// ---------------------------------- autoRestorePro ----------------------------------
function deps(adapter, vault, saveImpl) {
  const saves = [];
  let cur = vault;
  return {
    saves,
    lock() { cur = null; },
    d: {
      adapter,
      getVault: () => cur,
      isPro,
      markPro,
      save: async () => { saves.push(1); if (saveImpl) await saveImpl(); },
    },
  };
}
const freshVault = () => ({ version: 1, sections: {} });

test('autoRestorePro: не Pro + RuStore + товар куплен -> markPro(rustore) и сохранение', async () => {
  const v = freshVault();
  const x = deps(createRuStorePayment(plugin({ owned: true }), 'seyf-pro'), v);
  assert.equal(await autoRestorePro(x.d), 'restored');
  assert.equal(isPro(v), true);
  assert.equal(v.pro.source, 'rustore');
  assert.equal(x.saves.length, 1);
});

test('autoRestorePro: покупки нет / сеть упала -> ничего не пишем', async () => {
  const v1 = freshVault();
  const a = deps(createRuStorePayment(plugin({ owned: false }), 'seyf-pro'), v1);
  assert.equal(await autoRestorePro(a.d), 'none');
  assert.equal(v1.pro, undefined); assert.equal(a.saves.length, 0);
  const v2 = freshVault();
  const b = deps(createRuStorePayment(plugin({ getFails: true }), 'seyf-pro'), v2);
  assert.equal(await autoRestorePro(b.d), 'error');
  assert.equal(v2.pro, undefined); assert.equal(b.saves.length, 0);
});

test('autoRestorePro: уже Pro / не RuStore / нет vault -> skip без сетевого вопроса', async () => {
  const p = plugin({ owned: true });
  const v = freshVault(); markPro(v, { source: 'license' });
  assert.equal(await autoRestorePro(deps(createRuStorePayment(p, 'seyf-pro'), v).d), 'skip');
  assert.equal(p.calls.length, 0);
  assert.equal(await autoRestorePro(deps(createMockPayment({ owned: true }), freshVault()).d), 'skip');
  assert.equal(await autoRestorePro(deps(createUnavailablePayment(), freshVault()).d), 'skip');
  assert.equal(await autoRestorePro(deps(createRuStorePayment(p, 'seyf-pro'), null).d), 'skip');
});

test('autoRestorePro: mock-отметка в боевой сборке не Pro -> восстановление идёт и перезаписывает на rustore', async () => {
  const v = freshVault(); markPro(v, { source: 'mock' });
  const x = deps(createRuStorePayment(plugin({ owned: true }), 'seyf-pro'), v);
  assert.equal(await autoRestorePro(x.d), 'restored');
  assert.equal(v.pro.source, 'rustore');
});

test('autoRestorePro: сейф заперли, пока шёл вопрос в RuStore -> не пишем', async () => {
  const v = freshVault();
  let x;
  const slow = { kind: 'rustore', async isPurchased() { x.lock(); return true; } };
  x = deps(slow, v);
  assert.equal(await autoRestorePro(x.d), 'skip');
  assert.equal(v.pro, undefined); assert.equal(x.saves.length, 0);
});

test('autoRestorePro: запись упала -> saved-failed, без исключения наружу', async () => {
  const v = freshVault();
  const x = deps(createRuStorePayment(plugin({ owned: true }), 'seyf-pro'), v, async () => { throw new Error('write'); });
  assert.equal(await autoRestorePro(x.d), 'saved-failed');
});

// ---------------------------------- п.3: Java ownsProduct ----------------------------------
test('RuStorePayPlugin.ownsProduct: без productId -> false; совпадение id строгое', () => {
  const J = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'RuStorePayPlugin.java');
  const i = J.indexOf('boolean ownsProduct(');
  assert.ok(i >= 0, 'нет ownsProduct');
  const body = J.slice(i, J.indexOf('\n    }\n', i));
  assert.match(body, /productId == null \|\| productId\.isEmpty\(\)\) return false;/, 'без productId - fail-closed');
  assert.match(body, /boolean idMatch = id != null && productId\.equals\(id\.getValue\(\)\);/);
  assert.ok(!/productId == null \|\|\s*\(id/.test(body), 'старое «без id засчитать любой товар» убрано');
  // getPurchases отдаёт в ownsProduct именно productId из вызова
  assert.match(J, /final String productId = call\.getString\("productId"\);[\s\S]*ownsProduct\(purchases, productId\)/);
  // устаревшие комментарии: getInstance реально используется, JS при заглушке не уходит в mock
  assert.ok(!/Никакого RuStorePayClient\.getInstance\(\)/.test(J));
  assert.ok(!/остаётся на MockPayment|JS на Mock/.test(J));
});

// ---------------------------------- п.4: текст буфера = поведение ----------------------------------
// clipboard.js чистит и ВСЛЕПУЮ (нет чтения буфера в фоне; после перезагрузки/выгрузки секрета уже
// не знаем) - значит обещать «очищается, только если там ваш секрет» нельзя.
const CLIP_TEXT = 'Скопированный пароль стирается из буфера обмена через 30 секунд, если приложение открыто, или при возврате в приложение и при блокировке.';
test('буфер: код действительно чистит вслепую (основание для честного текста)', () => {
  const C = read('www', 'js', 'clipboard.js');
  assert.match(C, /чистим вслепую/);
  assert.match(C, /export function clearAfterReload/);
});
test('буфер: CHANGELOG 1.3.0 и карточка RuStore - честная формулировка, без «если в нём всё ещё ваш секрет»', () => {
  const ch = read('CHANGELOG.md');
  const s130 = ch.slice(ch.indexOf('## 1.3.0'), ch.indexOf('## 1.2.25'));
  assert.ok(s130.includes(CLIP_TEXT), 'CHANGELOG 1.3.0');
  assert.ok(!/если в нём всё ещё ваш секрет/.test(s130));
});
test('буфер: карточка RuStore - та же честная формулировка', { skip: !fs.existsSync(path.join(ROOT, 'store', 'card-rustore.txt')) && 'внутренний файл не входит в публичный репозиторий' }, () => {
  const card = read('store', 'card-rustore.txt').replace(/\n\s+/g, ' ');
  assert.ok(card.includes(CLIP_TEXT), 'card-rustore.txt');
  assert.ok(!/—/.test(card), 'без длинного тире');
});
