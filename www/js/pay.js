// pay.js — ЕДИНЫЙ источник правды о доступе к Полной версии «Сейфа». НЕ core.
//
// Три двери к Pro, любая открывает (как в «Хомяке»), но адаптировано под БОЛЕЕ строгую модель
// «Сейфа»: факт покупки/лицензии хранится не в localStorage, а ВНУТРИ зашифрованного vault
// (vault.pro под GCM-тегом: без мастер-пароля правкой .dat/localStorage не подделать; владелец свою
// копию расшифровать может, поэтому Gate.isPro ещё проверяет источник отметки, см. gate.js):
//   1) Access.FULL     — флаг debug/демо-сборки (access.js). Fail-closed: в релизе false.
//   2) лицензионный ключ (license.js verifyLicense) — при активации пишется в vault.pro (markPro);
//   3) RuStore-покупка (payment.js) — при успехе тоже пишется в vault.pro (markPro).
// Поэтому «лицензия ИЛИ покупка» на устройстве = Gate.isPro(vault): обе двери персистятся туда.
//
// computeAccess — ЧИСТАЯ, тестируемая функция (без DOM/крипто/vault-формата): на ней держатся
// тесты и мутация. window.Pay (hasFullAccess/buyFullAccess/restorePurchase) собирает app.js,
// подставляя сюда Access.FULL, текущий vault и Gate.isPro.

// Есть ли полный доступ. deps = { full:boolean, vault, isPro:fn }. Любая из дверей открывает.
// Строгость: full только === true; isPro вызывается защищённо (ошибка проверки != доступ).
export function computeAccess(deps = {}) {
  if (deps.full === true) return true;                       // debug/демо-сборка (Access.FULL)
  if (typeof deps.isPro === 'function') {                     // лицензия ИЛИ RuStore (persist в vault.pro)
    try { if (deps.isPro(deps.vault) === true) return true; } catch (e) {}
  }
  return false;
}

// ---------- покупка и тихое восстановление (ревью 1.3.0, п.2) ----------
// Чистая логика поверх адаптера payment.js (без DOM): на ней тесты и мутация, app.js только
// показывает окна по итогу.

// Покупка. Итог: {kind:'ok', purchaseId} | {kind:'owned'} | {kind:'cancelled'} | {kind:'unavailable'}
// | {kind:'failed'}. 'owned' - товар уже куплен в этом аккаунте RuStore: вместо повторной оплаты
// (и ложного «платёж не прошёл») ведём по пути «Восстановить покупку». Проверяем владение ДО оплаты
// и ПОСЛЕ неудачной оплаты (деньги могли списаться, а ответ шторки потеряться). Сбой проверки
// владения - не покупка (идём дальше обычным путём).
export async function runPurchase(adapter) {
  const owns = async () => {
    if (!adapter || adapter.kind !== 'rustore') return false;
    try { return (await adapter.isPurchased()) === true; } catch (e) { return false; }
  };
  if (await owns()) return { kind: 'owned' };
  let r = null;
  try { r = await adapter.purchase(); } catch (e) { r = null; }
  if (r && r.ok === true) return { kind: 'ok', purchaseId: r.purchaseId || null };
  if (r && r.cancelled) return { kind: 'cancelled' };
  if (r && r.error === 'unavailable') return { kind: 'unavailable' };
  if (await owns()) return { kind: 'owned' };
  return { kind: 'failed' };
}

// Тихое восстановление после разблокировки: сейф открыт, Pro не отмечен, адаптер боевой RuStore -
// спрашиваем владение товаром; куплено -> markPro + сохранение. Никаких окон при ошибке/нет покупки.
// deps = { adapter, getVault():vault|null, isPro(vault), markPro(vault, info), save():Promise }.
// getVault зовётся и ПОСЛЕ сетевого ответа: сейф успели запереть/сменить - ничего не пишем.
// Итог: 'restored' | 'saved-failed' | 'skip' | 'none' | 'error'.
export async function autoRestorePro(deps = {}) {
  const { adapter, getVault, isPro, markPro, save } = deps;
  const vault = typeof getVault === 'function' ? getVault() : null;
  if (!vault || !adapter || adapter.kind !== 'rustore') return 'skip';
  try { if (isPro(vault) === true) return 'skip'; } catch (e) { return 'skip'; }
  let owned = false;
  try { owned = (await adapter.isPurchased()) === true; } catch (e) { return 'error'; }
  if (!owned) return 'none';
  if (getVault() !== vault) return 'skip';
  markPro(vault, { source: 'rustore', purchaseId: null });
  try { await save(); } catch (e) { return 'saved-failed'; }
  return 'restored';
}
