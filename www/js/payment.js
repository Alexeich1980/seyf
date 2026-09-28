// payment.js — единый seam оплаты полной версии. НЕ core. Интерфейс адаптера:
//   purchase()    → { ok, purchaseId?, cancelled?, error? }   запустить разовую покупку
//   restore()     → { ok, purchased:boolean }                 восстановить ранее купленное
//   isPurchased() → boolean                                   владеет ли пользователь товаром сейчас
// Три реализации: RuStorePay (нативный плагин, боевой Android), MockPayment (ТОЛЬКО тест-сборка, FULL=true)
// и Unavailable («оплата недоступна»: релиз/стор вне нативки - веб-часть APK, открытая в браузере).
// selectPaymentAdapter выбирает нужную по окружению. Разблокировку по факту покупки делает app.js
// (Gate.markPro + сохранение) — здесь только сам платёж/владение.

// Идентификатор товара «полная версия» — ЕДИНЫЙ источник в pay-config.js (там же console_app_id).
// Боевой id заводит Алексей в RuStore Console (тип NON_CONSUMABLE — разовая покупка) и правит
// pay-config.js. Реэкспорт сохраняет прежний import { PRODUCT_ID } from './payment.js'.
export { PRODUCT_ID } from './pay-config.js';
import { PRODUCT_ID } from './pay-config.js';

// Мок для тест-сборки (FULL=true) и юнит-тестов: покупка сразу «успех», владение в замыкании.
// В релизе/сторе не выбирается никогда (mockAllowed), а его отметку source:'mock' Gate.isPro не признаёт.
export function createMockPayment(opts = {}) {
  let owned = !!opts.owned;
  return {
    kind: 'mock',
    async isPurchased() { return owned; },
    async purchase() { owned = true; return { ok: true, purchaseId: 'mock-' + Date.now() }; },
    async restore() { return { ok: true, purchased: owned }; },
  };
}

// Боевая реализация поверх нативного плагина RuStorePay (см. RuStorePayPlugin.java).
// Плагин возвращает уже нормализованный результат (owned / ok+purchaseId / cancelled / error).
export function createRuStorePayment(plugin, productId = PRODUCT_ID) {
  return {
    kind: 'rustore',
    // productId передаём ВСЕГДА: нативный ownsProduct засчитывает только этот товар (без id -
    // «ничего не куплено», чужой товар того же приложения Pro не открывает).
    async isPurchased() {
      const r = await plugin.getPurchases({ productId });
      return !!(r && r.owned);
    },
    async purchase() {
      const r = (await plugin.purchase({ productId })) || {};
      return { ok: !!r.ok, purchaseId: r.purchaseId, cancelled: !!r.cancelled, error: r.error };
    },
    async restore() {
      const r = await plugin.getPurchases({ productId });
      return { ok: true, purchased: !!(r && r.owned) };
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
