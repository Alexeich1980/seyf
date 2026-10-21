// review.js - окно оценки RuStore (Review SDK) «Сейфа», 1.3.2. Решение Алексея 01.10.2026 (память
// rustore-review-prompt), образец - «Карта года» 1.0.1 (www/review.js) и «Хомяк» 1.0.3.
//
// Правила RuStore и наши:
// - только системное окно RuStore (плагин RuStoreReview, android/.../RuStoreReviewPlugin.java); своей
//   кнопки «Оценить» и вопроса «Нравится?» нет и не будет - это запрещено правилами RuStore;
// - один раз, сразу после удачного сохранения НОВОЙ записи (запись дошла до диска), не при запуске, не на
//   экране разблокировки и не посреди действия: через REVIEW_DELAY после сохранения и только если не
//   открыто ни одно окно, сейф не заперт и приложение на экране;
// - условие (как в «Карте года»/«Хомяке»): 7-й день пользования И 10-я сохранённая запись;
// - после ответа окна (SDK не отличает «оценил» от «закрыл») повтор не раньше чем через 60 дней
//   (RETRY_DAYS), и RuStore сам промолчит, если оценка уже есть. Не показалось из-за телефона
//   (RuStore не стоит, не вошли, устарел) - тоже не раньше чем через 60 дней. Уже оценили, лимит, бан,
//   ошибка - молча и навсегда. Всего не больше двух окон (MAX_ASKS);
// - сейф заперли (перезагрузка страницы), пока RuStore готовил окно, - ответ не дошёл: при следующем
//   запуске такая попытка засчитывается как показанное окно (recover), правило выше не нарушается;
// - RuStore нет / не вошёл / уже оценил - молча ничего (плагин отвечает кодом, своих окон нет);
// - только стор-сборка (Access.STORE): у тест-сборки тот же applicationId, на телефоне с RuStore
//   всплыло бы настоящее окно оценки.
// Флаги - отдельный ключ localStorage (не vault: «уже спрашивали» - про этот телефон, в резервную копию
// не уезжает). Чистая часть проверяется в Node (tests/review-132.test.mjs).

const DAY = 86400000;
export const RULES = Object.freeze({ MIN_RECORDS: 10, MIN_DAYS: 7, RETRY_DAYS: 60, MAX_ASKS: 2 });
// ответы плагина, после которых окно не показалось из-за телефона - можно один раз повторить
export const RETRY_CODES = Object.freeze(['NOT_INSTALLED', 'UNAUTHORIZED', 'OUTDATED']);
export const KEY = 'seyf_review_v1';
export const REVIEW_DELAY = 1500;   // после сохранения: редактор закрылся, отклик отыграл
const TS_MIN = Date.UTC(2025, 0, 1);

const obj = (v) => ((v && typeof v === 'object' && !Array.isArray(v)) ? v : {});
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function allowed(access) { return !!(access && access.STORE === true); }

// число записей во всех разделах (vault.sections: { раздел: [записи] })
export function countRecords(vault) {
  const s = obj(obj(vault).sections);
  let n = 0;
  for (const k of Object.keys(s)) if (Array.isArray(s[k])) n += s[k].filter((e) => e && typeof e === 'object').length;
  return n;
}

// самая ранняя createdAt среди записей (для тех, кто пользуется с прошлых версий) или null
export function firstEntryTs(vault, now) {
  const s = obj(obj(vault).sections);
  const top = num(now) || Date.now();
  let best = null;
  for (const k of Object.keys(s)) {
    if (!Array.isArray(s[k])) continue;
    for (const e of s[k]) {
      const t = Date.parse(e && e.createdAt);
      if (!Number.isFinite(t) || t < TS_MIN || t > top) continue;
      if (best === null || t < best) best = t;
    }
  }
  return best;
}

// начало пользования: самое раннее из «первый запуск с этим флагом» и «первая запись»
export function firstUse(st, vault, now) {
  const a = num(obj(st).firstAt), b = firstEntryTs(vault, now);
  if (a > 0 && b !== null) return Math.min(a, b);
  if (a > 0) return a;
  return b;
}

// Попытка, оборванная перезагрузкой (запирание сейфа, пока RuStore готовил окно): ответ не дошёл.
// Засчитываем как показанное окно в момент запуска: asks+1, повтор не раньше чем через 60 дней.
export function recover(st) {
  const s = obj(st);
  if (num(s.startedAt) > 0 && s.answered === false) return after(s, { shown: true }, num(s.startedAt));
  return s;
}

// при каждом запуске: отметить первый запуск (один раз)
export function noteLaunch(st, now) {
  const s = { ...obj(st) };
  if (!(num(s.firstAt) > 0)) s.firstAt = num(now);
  return s;
}

// пора ли показать окно. ctx = {now, records, firstTs}
export function due(st, ctx) {
  const s = obj(st), c = obj(ctx);
  if (s.done) return false;
  if (num(s.asks) >= RULES.MAX_ASKS) return false;
  if (s.startedAt && !s.answered) return false;   // окно запускали, ответ не дошёл - считаем показанным
  if (s.retryAt && num(c.now) < num(s.retryAt)) return false;
  const byRecords = num(c.records) >= RULES.MIN_RECORDS;
  const byDays = num(c.firstTs) > 0 && num(c.now) - num(c.firstTs) >= RULES.MIN_DAYS * DAY;
  return byRecords && byDays;   // и 7 дней, и 10 записей (как в Карте года/Хомяке, память rustore-review-prompt)
}
export function start(st, now) {
  return { ...obj(st), startedAt: num(now), answered: false };
}
export function after(st, res, now) {
  const s = { ...obj(st) }, r = obj(res);
  s.answered = true; s.at = num(now); s.code = r.shown ? 'SHOWN' : String(r.code || 'ERROR');
  s.asks = num(s.asks) + 1;
  const again = (r.shown === true || RETRY_CODES.includes(r.code)) && s.asks < RULES.MAX_ASKS;
  if (again) { s.retryAt = num(now) + RULES.RETRY_DAYS * DAY; s.done = false; }
  else s.done = true;
  return s;
}

// ---------- связка с приложением ----------
function load(ls) {
  try { return obj(JSON.parse(ls.getItem(KEY) || 'null')); } catch (e) { return {}; }
}
function put(ls, o) { try { ls.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }

// env = {access, plugin, storage, getVault, busy, visible, setTimeout, now}
// busy() - true, если открыто окно, редактор или экран входа; visible() - приложение на экране.
export function createReview(env = {}) {
  const ls = env.storage;
  let asking = false, askedSession = false;
  const now = env.now || (() => Date.now());
  const later = env.setTimeout || ((f, ms) => setTimeout(f, ms));
  const plugin = () => (allowed(env.access) ? (env.plugin || null) : null);
  const ctx = () => {
    const v = env.getVault ? env.getVault() : null;
    const t = now();
    return { now: t, records: countRecords(v), firstTs: firstUse(load(ls), v, t) };
  };
  // при запуске (boot): оборванную прошлым запуском попытку засчитать, отметить первый запуск
  function launched() { if (ls) put(ls, noteLaunch(recover(load(ls)), now())); }
  function launch(p) {
    if ((env.busy && env.busy()) || (env.visible && !env.visible())) { asking = false; return Promise.resolve(null); }
    if (!due(load(ls), ctx())) { asking = false; return Promise.resolve(null); }
    if (!put(ls, start(load(ls), now()))) askedSession = true;   // хранилище не пишется - помним до конца сессии
    let res;
    try { res = Promise.resolve(p.requestAndLaunch()); } catch (e) { res = Promise.reject(e); }
    return res.then((r) => r || { shown: false, code: 'ERROR' }, () => ({ shown: false, code: 'ERROR' }))
      .then((r) => { put(ls, after(load(ls), r, now())); asking = false; return r; });
  }
  // сразу после удачного сохранения НОВОЙ записи. true - окно запланировано
  function afterSave() {
    const p = plugin();
    if (!p || !ls || asking || askedSession) return false;
    if (!due(load(ls), ctx())) return false;
    asking = true;
    later(() => { launch(p); }, REVIEW_DELAY);
    return true;
  }
  return { launched, afterSave, launch };
}
