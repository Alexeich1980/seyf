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
// показывает окна по итогу. Машина состояний самой покупки - purchase.js.

// ---------- 1.3.3: механики покупки по регламенту (п.1-14) ----------
// Память android-app-build-checklist «Покупка через RuStore Pay: обязательные механики», эталон -
// «Понятная пенсия» 1.0.7 и «Хомяк» 1.0.6 (сессия покупки в плагине, снимок владения owned/none/unknown,
// окончательные причины «оплата недоступна» - только finalKind).

// Код ошибки RuStore (плагин: RuStorePaymentNetworkException.getCode() или имя исключения core-SDK)
// → вид итога для окна. Коды - https://www.rustore.ru/help/sdk/pay/kotlin-java/11-1-0.
// Неизвестный код или его нет - 'failed' (общее окно «Оплата не прошла»).
export const CODE_KIND = Object.freeze({
  '4000020': 'already',            // продукт уже приобретён
  '4000025': 'nomethod',           // не найден подходящий способ оплаты
  'RuStoreOutdated': 'outdated',
  'RuStoreNotInstalled': 'notinstalled',
  'UserUnauthorized': 'unauthorized',
  'UserBanned': 'banned',
  'ApplicationBanned': 'banned',
  'NotConfigured': 'unavailable',  // id приложения не вписан в сборку - оплата недоступна
});
export function kindOfCode(code) {
  return (code != null && Object.prototype.hasOwnProperty.call(CODE_KIND, String(code))) ? CODE_KIND[String(code)] : 'failed';
}

// Цена из магазина приходит строкой amountLabel («990.00 руб.») - показываем как в приложении:
// «990 ₽». Целая сумма - без копеек, копейки не нули - через запятую («1 290,50 ₽»), разряды и
// пробел перед ₽ - неразрывные (escape, не литерал: память nbsp-as-escape-in-code). Незнакомый
// формат (другая валюта) - как пришёл: лучше чужой вид, чем неверная цена. Пусто - null.
// М2 (адв. ревью 1.3.3, 27.10.2026): нулевая, отрицательная или «цена» без цифр («0.00 руб.»,
// «-5 руб.», «Бесплатно») - это «цены нет»: null, и экран берёт свою цену по дате (gate.js
// priceDisplay), а не «Купить за 0 ₽».
const NBSP = '\u00a0';
const PRICE_RE = /^(\d{1,3}(?: \d{3})+|\d+)(?:[.,](\d{1,2}))? ?(?:руб\.?|р\.?|₽|RUB)$/i;
function cleanLabel(label) {
  return String(label).replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function formatPrice(label) {
  if (label == null) return null;
  const s = cleanLabel(label);
  if (!s) return null;
  const m = PRICE_RE.exec(s);
  if (!m) return (/[1-9]/.test(s) && !/^[-\u2212]/.test(s)) ? s : null;
  if (priceRub(s) == null) return null;   // 0 ₽ - цены нет
  const whole = m[1].replace(/ /g, '').replace(/^0+(?=\d)/, '');
  const kop = m[2] ? (m[2].length === 1 ? m[2] + '0' : m[2]) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return grouped + (kop && kop !== '00' ? ',' + kop : '') + NBSP + '₽';
}
// Та же строка магазина числом в рублях (для акции: сравнить с обычной ценой, gate.js priceView).
// Незнакомый формат (другая валюта, текст), ноль или пусто - null: тогда акцию не показываем.
export function priceRub(label) {
  if (label == null) return null;
  const m = PRICE_RE.exec(cleanLabel(label));
  if (!m) return null;
  const n = Number(m[1].replace(/ /g, '') + '.' + (m[2] || '0'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Обещание с потолком по времени: зависший мост не должен держать экран покупки. Ошибка - fallback.
export function withTimeout(p, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    Promise.resolve(p).then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
}
export const PRECHECK_MS = 4000;
export const CHECK_MS = 8000;

// Вход в RuStore и доступность оплаты (до шторки). null - не знаем (браузер, мок, старая оболочка,
// сбой, дольше PRECHECK_MS) - тогда шторку открываем.
export async function precheck(adapter, ms = PRECHECK_MS) {
  if (!adapter || adapter.kind !== 'rustore' || typeof adapter.precheck !== 'function') return null;
  const v = await withTimeout(Promise.resolve().then(() => adapter.precheck()), ms, null);
  return v || null;
}

// В2 (адв. ревью 1.3.3, п.14 регламента): путь к оплате закрывают ТОЛЬКО окончательные причины -
// пользователь заблокирован (UserBanned), приложение заблокировано (ApplicationBanned), монетизация
// не подключена (NotConfigured - нет id приложения). Сеть, VPN, «не вошёл», устаревший RuStore,
// Unavailable без кода - шторку открываем: в ней можно войти через VK ID или оплатить по СБП, а
// настоящую ошибку покажет сама шторка. → вид окна или null (шторку открывать).
const FINAL = Object.freeze({ UserBanned: 'banned', ApplicationBanned: 'banned', NotConfigured: 'unavailable' });
export function finalKind(pc) {
  if (!pc || pc.available !== false || pc.code == null) return null;
  return Object.prototype.hasOwnProperty.call(FINAL, String(pc.code)) ? FINAL[String(pc.code)] : null;
}
// RuStore на телефоне не установлен - шторка не откроется вовсе: своё окно «Нужен RuStore» с кнопкой
// «Открыть RuStore» (В2). Знаем по плагину (installed:false) или по коду причины.
export function notInstalled(pc) {
  return !!pc && (pc.installed === false || String(pc.code) === 'RuStoreNotInstalled');
}

// Итог шторки из плагина → {status, ok, cancelled, unavailable, purchaseId, code, paying}. Старые поля
// (ok/cancelled/error) - запасной путь (мок тест-сборки, «оплата недоступна»). FAIL-CLOSED: 'ok' - только
// при ok === true строго (ok:"true"/1 - не покупка).
const STATUSES = ['ok', 'pending', 'cancelled', 'error', 'unavailable', 'busy'];
export function normPurchase(r) {
  r = r || {};
  let st = STATUSES.includes(r.status) ? r.status
    : (r.ok === true ? 'ok' : (r.unavailable === true || r.error === 'unavailable') ? 'unavailable'
      : r.cancelled === true ? 'cancelled' : r.pending === true ? 'pending' : 'error');
  if (st === 'ok' && r.ok !== true) st = 'error';
  if (st === 'error' && String(r.code) === 'NotConfigured') st = 'unavailable';
  return { status: st, ok: st === 'ok', cancelled: st === 'cancelled', unavailable: st === 'unavailable',
    purchaseId: r.purchaseId ? String(r.purchaseId) : null, code: r.code != null ? String(r.code) : null,
    paying: r.paying === true };
}

// «Оплата в обработке» товара старше PENDING_FRESH_MS - не ждём её (банк столько не думает), иначе
// застрявшая в PROCESSING покупка запирала бы оплату навсегда. Совпадает с плагином STARTED_TTL_MS.
export const PENDING_FRESH_MS = 30 * 60 * 1000;
export function freshPending(st) {
  if (!st || st.pending !== true) return false;
  return st.pendingAgeMs == null || st.pendingAgeMs < PENDING_FRESH_MS;
}

// СНИМОК ВЛАДЕНИЯ - единственная проверка «что магазин знает о товаре» для покупки и восстановления.
// → { state:'owned', ackId } | { state:'none', pending, pendingId, unavailable } | { state:'unknown', late }
// unknown (сбой или таймаут) - НЕ «не куплено». late - тот же запрос, который ещё может ответить:
// поздний owned не теряется (purchase.js откроет доступ). Не RuStore (мок, «недоступно») - none.
export function snapshot(adapter, opts = {}) {
  if (!adapter || adapter.kind !== 'rustore' || typeof adapter.status !== 'function') {
    return Promise.resolve({ state: 'none', pending: false, pendingId: null, unavailable: true });
  }
  const ms = opts.timeoutMs > 0 ? opts.timeoutMs : CHECK_MS;
  const req = Promise.resolve().then(() => adapter.status({ auth: false })).then((st) => {
    if (!st) return { state: 'unknown' };
    if (st.owned === true) return { state: 'owned', ackId: st.ackId || null };
    const fresh = freshPending(st);
    return { state: 'none', pending: fresh, pendingId: fresh ? (st.pendingId || null) : null, unavailable: st.unavailable === true };
  }, () => ({ state: 'unknown' }));
  const TIMEOUT = {};
  return withTimeout(req, ms, TIMEOUT).then((v) => (v === TIMEOUT ? { state: 'unknown', late: req } : v));
}

// Статус СВОЕЙ покупки по id (опрос «оплата обрабатывается»): {status:'ok'|'pending'|'open'|'cancelled'|'error'}
// | reject («не знаем»: сеть, нет метода, таймаут).
export function checkPurchase(adapter, purchaseId, opts = {}) {
  if (!adapter || adapter.kind !== 'rustore' || typeof adapter.checkPurchase !== 'function' || !purchaseId) {
    return Promise.reject(new Error('no-check'));
  }
  const ms = opts.timeoutMs > 0 ? opts.timeoutMs : CHECK_MS;
  const NONE = {};
  return withTimeout(Promise.resolve().then(() => adapter.checkPurchase(purchaseId)), ms, NONE)
    .then((v) => { if (v === NONE || !v) throw new Error('timeout'); return v; });
}

// Отметка выдачи товара (ACKNOWLEDGED). Сбой - не беда: доступ уже открыт, при следующей
// разблокировке autoRestorePro / ackPendingPro увидит ackId и повторит. → boolean
export async function acknowledge(adapter, purchaseId) {
  if (!adapter || !purchaseId || typeof adapter.acknowledge !== 'function') return false;
  try { return (await adapter.acknowledge(purchaseId)) === true; } catch (e) { return false; }
}

// Тихое восстановление после разблокировки: сейф открыт, Pro не отмечен, адаптер боевой RuStore -
// спрашиваем владение товаром; куплено -> markPro + сохранение. Никаких окон при ошибке/нет покупки.
// deps = { adapter, getVault():vault|null, isPro(vault), markPro(vault, info), save():Promise }.
// getVault зовётся и ПОСЛЕ сетевого ответа: сейф успели запереть/сменить - ничего не пишем.
// Итог: 'restored' | 'saved-failed' | 'skip' | 'none' | 'pending' | 'error'.
// 'pending' (В1, п.11 регламента): куплено ещё не значится, но свежая оплата «в обработке» (PROCESSING /
// EXECUTING или начатая до перезапуска) - deps.onPending(purchaseId): app.js ждёт её итога окном «Оплата
// обрабатывается» (purchase.js watch), новую шторку не открываем.
export async function autoRestorePro(deps = {}) {
  const { adapter, getVault, isPro, markPro, save } = deps;
  const vault = typeof getVault === 'function' ? getVault() : null;
  if (!vault || !adapter || adapter.kind !== 'rustore') return 'skip';
  try { if (isPro(vault) === true) return 'skip'; } catch (e) { return 'skip'; }
  let owned = false, ackId = null, st = null;
  try {
    if (typeof adapter.status === 'function') {
      st = await adapter.status();
      owned = !!(st && st.owned === true); ackId = (st && st.ackId) || null;
    } else owned = (await adapter.isPurchased()) === true;
  } catch (e) { return 'error'; }
  if (!owned) {
    if (freshPending(st) && st.pendingId && getVault() === vault) {
      if (typeof deps.onPending === 'function') { try { deps.onPending(String(st.pendingId)); } catch (e) {} }
      return 'pending';
    }
    return 'none';
  }
  if (getVault() !== vault) return 'skip';
  markPro(vault, { source: 'rustore', purchaseId: ackId });
  try { await save(); } catch (e) { return 'saved-failed'; }
  // 1.3.3: оплачена, но не отмечена выдачей - отмечаем (сбой не мешает доступу)
  if (ackId) await acknowledge(adapter, ackId);
  return 'restored';
}

// 1.3.3: уже Pro по покупке RuStore, но в магазине покупка не отмечена выдачей (купили до 1.3.3 -
// тогда отметки не было) - отмечаем ACKNOWLEDGED, чтобы в Консоли не висело «ожидает выдачи товара».
// Только отметка RuStore и боевой адаптер; доступ этим не меняется. Итог: 'acked' | 'none' | 'skip'.
export async function ackPendingPro(deps = {}) {
  const { adapter, vault } = deps;
  if (!vault || !vault.pro || vault.pro.purchased !== true || vault.pro.source !== 'rustore') return 'skip';
  if (!adapter || adapter.kind !== 'rustore' || typeof adapter.status !== 'function') return 'skip';
  let st = null;
  try { st = await adapter.status(); } catch (e) { return 'skip'; }
  if (!st || st.owned !== true || !st.ackId) return 'none';
  return (await acknowledge(adapter, st.ackId)) ? 'acked' : 'none';
}
