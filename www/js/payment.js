// payment.js — единый seam оплаты полной версии. НЕ core. Интерфейс адаптера:
//   purchase()    → { status, ok, purchaseId?, cancelled?, code?, paying? }  запустить разовую покупку (pay.js normPurchase)
//   restore()     → { ok, purchased:boolean, purchaseId? }         восстановить ранее купленное
//   isPurchased() → boolean                                        владеет ли пользователь товаром сейчас
//   precheck()    → { authorized, available, code } | null          (1.3.3) вход в RuStore и доступность оплаты
//   acknowledge(id) → boolean                                      (1.3.3) отметить выдачу товара
//   getPriceLabel() → строка цены из магазина | null                (1.3.3)
//   только RuStore: status(opts) (снимок владения), checkPurchase(id), onLate(fn) - сессия покупки в плагине (1.3.3)
// Три реализации: RuStorePay (нативный плагин, боевой Android), MockPayment (ТОЛЬКО тест-сборка, FULL=true)
// и Unavailable («оплата недоступна»: релиз/стор вне нативки - веб-часть APK, открытая в браузере).
// selectPaymentAdapter выбирает нужную по окружению. Разблокировку по факту покупки делает app.js
// (Gate.markPro + сохранение) — здесь только сам платёж/владение.

// Идентификатор товара «полная версия» — ЕДИНЫЙ источник в pay-config.js (там же console_app_id).
// Боевой id заводит Алексей в RuStore Console (тип NON_CONSUMABLE — разовая покупка) и правит
// pay-config.js. Реэкспорт сохраняет прежний import { PRODUCT_ID } from './payment.js'.
export { PRODUCT_ID } from './pay-config.js';
import { PRODUCT_ID } from './pay-config.js';
import { normPurchase } from './pay.js';

// Мок для тест-сборки (FULL=true) и юнит-тестов: покупка сразу «успех», владение в замыкании.
// В релизе/сторе не выбирается никогда (mockAllowed), а его отметку source:'mock' Gate.isPro не признаёт.
export function createMockPayment(opts = {}) {
  let owned = !!opts.owned;
  return {
    kind: 'mock',
    async isPurchased() { return owned; },
    async purchase() { owned = true; return { ok: true, purchaseId: 'mock-' + Date.now() }; },
    async restore() { return { ok: true, purchased: owned }; },
    async precheck() { return null; },          // 1.3.3: проверки до шторки у мока нет
    async acknowledge() { return false; },
    async getPriceLabel() { return null; },     // цены у мока нет - UI берёт свою
  };
}

// Боевая реализация поверх нативного плагина RuStorePay (см. RuStorePayPlugin.java).
// Плагин возвращает уже нормализованный результат (owned / ok+purchaseId / cancelled / error).
export function createRuStorePayment(plugin, productId = PRODUCT_ID) {
  // Нормализованный ответ getPurchases: {owned, ackId, revoked, pending, pendingId, pendingAgeMs, unavailable,
  // authorized}. ackId - id оплаченной, но не отмеченной выдачей покупки: её надо отметить (acknowledge),
  // иначе в Консоли «ожидает выдачи». pending - покупка товара «в обработке» (PROCESSING/EXECUTING или оплата
  // начата, плагин помнит это и после перезапуска): её id и возраст (В1, п.11 регламента).
  // opts.auth === false - без вопроса о входе в RuStore (снимку владения он не нужен - лишний вызов SDK).
  async function status(opts) {
    const arg = { productId };
    if (opts && opts.auth === false) arg.auth = false;
    const r = (await plugin.getPurchases(arg)) || {};
    const owned = r.owned === true;
    const pending = !owned && r.pending === true;
    return {
      owned,
      ackId: (owned && r.ackPending === true && r.purchaseId) ? String(r.purchaseId) : null,
      revoked: r.revoked === true,
      pending,
      pendingId: (pending && r.pendingId) ? String(r.pendingId) : null,
      pendingAgeMs: (typeof r.pendingAgeMs === 'number' && Number.isFinite(r.pendingAgeMs)) ? r.pendingAgeMs : null,
      unavailable: r.unavailable === true,
      authorized: r.authorized === true ? true : (r.authorized === false ? false : null),
    };
  }
  const tri = (v) => (v === true ? true : (v === false ? false : null));   // нет поля - «не знаем»
  return {
    kind: 'rustore',
    status,
    // productId передаём ВСЕГДА: нативный ownsProduct засчитывает только этот товар (без id -
    // «ничего не куплено», чужой товар того же приложения Pro не открывает).
    async isPurchased() { return (await status()).owned; },
    // Итог шторки - один (сессия покупки в плагине): ok | pending | cancelled | error(+code) | unavailable | busy.
    // code - код ошибки RuStore из плагина: «4000020», «4000025», «RuStoreOutdated»… (pay.js normPurchase)
    async purchase() { return normPurchase(await plugin.purchase({ productId })); },
    // Статус СВОЕЙ покупки по id (опрос «оплата обрабатывается»). Нет метода/сбой - reject (= «не знаем»).
    async checkPurchase(purchaseId) {
      if (!purchaseId || typeof plugin.checkPurchase !== 'function') throw new Error('no-check');
      const r = await plugin.checkPurchase({ purchaseId: String(purchaseId) });
      const st = r && ['ok', 'pending', 'open', 'cancelled', 'error'].includes(r.status) ? r.status : null;
      if (!st) throw new Error('bad-check');
      return { status: st, code: r.code != null ? String(r.code) : null };
    },
    // Поздний успех шторки (плагин: событие purchaseLate) - итог уже отдан, а Task шторки ответил успехом.
    onLate(fn) {
      if (typeof plugin.addListener !== 'function' || typeof fn !== 'function') return;
      try {
        const h = plugin.addListener('purchaseLate', (d) => fn(normPurchase(d)));
        if (h && typeof h.catch === 'function') h.catch(() => {});
      } catch (e) {}
    },
    async restore() {
      const st = await status();
      return st.ackId ? { ok: true, purchased: st.owned, purchaseId: st.ackId } : { ok: true, purchased: st.owned };
    },
    // 1.3.3: до шторки - вошёл ли человек в RuStore и доступна ли оплата. Старая оболочка без
    // метода или сбой - null: шторку открываем как раньше.
    async precheck() {
      if (typeof plugin.precheck !== 'function') return null;
      try {
        const r = await plugin.precheck({ productId });
        if (!r) return null;
        if (r.code === 'NotConfigured') return { authorized: null, installed: null, available: false, code: 'NotConfigured' };
        return { authorized: tri(r.authorized), installed: tri(r.installed), available: tri(r.available),
                 code: r.code != null ? String(r.code) : null };
      } catch (e) { return null; }
    },
    // 1.3.3: отметка выдачи товара (updateAcknowledgementState ACKNOWLEDGED). Сбой - false.
    async acknowledge(purchaseId) {
      if (!purchaseId || typeof plugin.acknowledge !== 'function') return false;
      try { const r = await plugin.acknowledge({ purchaseId: String(purchaseId) }); return !!(r && r.ok === true); }
      catch (e) { return false; }
    },
    // 1.3.3: цена из магазина как пришла («990.00 руб.»); вид «990 ₽» - pay.js formatPrice.
    async getPriceLabel() {
      if (typeof plugin.getProducts !== 'function') return null;
      try { const r = await plugin.getProducts({ productId }); return (r && r.ok && r.priceLabel) ? String(r.priceLabel) : null; }
      catch (e) { return null; }
    },
  };
}

// «Оплата недоступна» (1.3.0, ревью п.1a): релиз/стор-сборка вне нативного окружения (веб-часть
// APK, открытая в браузере) или нативка без плагина. Покупка НИКОГДА не успешна, владения нет.
// Раньше тут был откат на MockPayment - и веб-часть боевого APK в браузере выдавала Pro бесплатно.
export const PAY_UNAVAILABLE = 'unavailable';
export function createUnavailablePayment() {
  return {
    kind: PAY_UNAVAILABLE,
    async isPurchased() { return false; },
    async purchase() { return { ok: false, error: PAY_UNAVAILABLE }; },
    async restore() { return { ok: false, purchased: false, error: PAY_UNAVAILABLE }; },
    async precheck() { return null; },
    async acknowledge() { return false; },
    async getPriceLabel() { return null; },
  };
}

// Разрешён ли MockPayment (fail-closed): ТОЛЬКО тест-сборка - SEYF_FULL_ACCESS === true И нет
// признаков релиза/стора (SEYF_STORE === true, SEYF_DEMO === false; релиз/стор вшивают их в
// buildflags.js, build-lib.js flagsSource). Нет флага FULL (релиз-APK, OTA, браузер с рабочей www) -
// mock запрещён, адаптер «оплата недоступна».
export function mockAllowed(flags = {}) {
  if (flags.full !== true) return false;
  if (flags.store === true || flags.demo === false) return false;
  return true;
}

// Выбор реализации. Нативное окружение + зарегистрированный плагин RuStorePay → боевой адаптер.
// Иначе: тест-сборка/дев → mock; релиз/стор → «оплата недоступна» (Pro бесплатно не выдаётся).
// env.flags = { full, store, demo } из buildflags.js (app.js); env инъектируется в тестах.
export function selectPaymentAdapter(env = {}) {
  const native = !!(env.isNativeApp && env.isNativeApp());
  const np = env.NativePlugins;
  if (native && np && np.RuStorePay) {
    return createRuStorePayment(np.RuStorePay, env.PRODUCT_ID || PRODUCT_ID);
  }
  return mockAllowed(env.flags || {}) ? createMockPayment() : createUnavailablePayment();
}
