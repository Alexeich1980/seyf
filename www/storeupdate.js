/* storeupdate.js - обновление СТОР-сборки «Сейфа» через RuStore App Update SDK (1.3.2).
   Образец - «Карта года» (www/update.js + RuStoreUpdatePlugin.java), проверено вживую 15.10.2026.

   Своего сервера обновлений в стор-сборке по-прежнему нет: приложение само в интернет не ходит
   (CSP connect-src 'none'). Нативный плагин RuStoreUpdate (android/.../RuStoreUpdatePlugin.java)
   спрашивает у установленного на телефоне приложения RuStore, есть ли в магазине версия новее,
   и по кнопке «Обновить» запускает окно обновления RuStore (или открывает карточку приложения).
   - Тихо: не чаще раза в неделю при запуске (метка K_CHECK ставится при любом исходе). Нашлась новее - точка у пункта меню
     «Обновление» (Update.newer()), держится между запусками, пока версию не поставят.
   - По кнопке «Проверить» в окне «Обновление» - всегда.
   - Нет RuStore / не вошли / сбой - честная строка по причине и кнопка «Открыть RuStore».
   Тест-сборки (не стор) этот модуль не используют: у них свой OTA-канал в update.js.

   Здесь только логика без DOM: решение по ответу плагина, неделя, флаг «есть новее», что показать
   в окне (view) и защита от двойного тапа (launcher). Окно рисует update.js. Тесты -
   tests/storeupdate-132.test.mjs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StoreUpdate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var URL_RUSTORE = 'https://www.rustore.ru/catalog/app/ru.dorokhin.seyf';
  var WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  var T_CHECK = 15000;
  var K_CHECK = 'seyf_upd_store_checkAt';
  var K_NEWER = 'seyf_upd_store_newer';     // versionCode найденной в RuStore версии ('?' - номер неизвестен)
  var T_LAUNCH = 30000;   // «Открываю RuStore…»: ответа нет столько - кнопка снова доступна
  var T_LINGER = 2500;    // ответ пришёл - строка ещё столько видна, пока RuStore поднимается поверх

  var MSG_NO_RUSTORE = 'Обновления приходят через RuStore, а на телефоне его нет. Установите RuStore, чтобы обновлять приложение.';
  var MSG_FAIL = 'RuStore сейчас не ответил. Проверьте интернет и попробуйте позже.';
  var MSG_NONE = 'У вас последняя версия.';
  var MSG_HAS = 'В RuStore есть новая версия. Данные сейфа при обновлении остаются на месте.';
  var MSG_IDLE = 'Приложение само проверяет обновления в RuStore раз в неделю.';
  var MSG_CHECKING = 'Проверяю в RuStore…';
  var MSG_OPENING = 'Открываю RuStore…';
  // причина от плагина (RuStoreUpdatePlugin.reasonOf, исключения SDK) -> строка. Неизвестное - MSG_FAIL.
  var REASON_MSG = {
    'no-rustore': MSG_NO_RUSTORE,
    'unauthorized': 'Войдите в RuStore, чтобы проверить обновления.',
    'outdated': 'Обновите RuStore: эта его версия не умеет проверять обновления.',
    'user-banned': 'RuStore ограничил ваш аккаунт, поэтому проверить обновление не получилось. Подробности - в поддержке RuStore.',
    'app-banned': 'RuStore сейчас не даёт проверить обновление из приложения. Откройте страницу приложения в RuStore.',
    'old-android': 'На Android 6 приложение не может само проверить обновление. Откройте страницу приложения в RuStore.',
    'timeout': MSG_FAIL,
    'sdk': MSG_FAIL
  };
  function reasonMessage(reason) {
    return Object.prototype.hasOwnProperty.call(REASON_MSG, reason) ? REASON_MSG[reason] : MSG_FAIL;
  }

  // пора ли тихо проверять: ≥7 дней с последней тихой попытки; метка из будущего - пора
  function dueForCheck(last, now) {
    var l = Number(last) || 0;
    if (l > now) return true;
    return now - l >= WEEK_MS;
  }
  function code(v) { var n = Number(v); return (isFinite(n) && n > 0) ? Math.floor(n) : 0; }

  // ответ плагина -> {kind:'store'|'none'|'error', ...}
  function decide(r) {
    if (!r || typeof r !== 'object') return { kind: 'error', reason: 'sdk', message: MSG_FAIL };
    if (r.ok !== true) {
      var reason = typeof r.reason === 'string' ? r.reason : 'sdk';
      return { kind: 'error', reason: reason, message: reasonMessage(reason) };
    }
    var nv = code(r.versionCode), cur = code(r.currentVersionCode);
    if (r.available === true && (!cur || !nv || nv > cur)) return { kind: 'store', versionCode: nv };
    return { kind: 'none' };
  }

  function plugin(opts) {
    if (opts && 'native' in opts) return opts.native;
    try {
      var NP = (typeof window !== 'undefined') && window.NativePlugins;
      if (NP && NP.RuStoreUpdate) return NP.RuStoreUpdate;
      var C = (typeof window !== 'undefined') && window.Capacitor;
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
      return (C.Plugins && C.Plugins.RuStoreUpdate) || (typeof C.registerPlugin === 'function' ? C.registerPlugin('RuStoreUpdate') : null);
    } catch (e) { return null; }
  }
  function ls(opts) {
    if (opts && opts.storage) return opts.storage;
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; }
  }
  function get(st, k) { try { return st ? st.getItem(k) : null; } catch (e) { return null; } }
  function put(st, k, v) { try { if (!st) return; if (v) st.setItem(k, v); else st.removeItem(k); } catch (e) {} }

  // Найденная новая версия живёт между запусками, пока её не поставят. RuStore может ответить
  // «есть» без versionCode - тогда флаг без номера ('?'): syncNewer его не стирает (точка в меню
  // горит до следующей проверки, которая уточнит или погасит её).
  var UNKNOWN = 'unknown', RAW_UNKNOWN = '?';
  var newer = 0;
  function getNewer() { return newer; }
  function syncNewer(curCode, opts) {
    var st = ls(opts), raw = get(st, K_NEWER);
    if (raw === RAW_UNKNOWN) { newer = UNKNOWN; return newer; }
    var v = code(raw), c = code(curCode);
    if (v && c && v <= c) { v = 0; put(st, K_NEWER, ''); }   // уже обновились
    newer = v; return newer;
  }
  function setNewer(v, opts) {
    newer = (v === UNKNOWN) ? UNKNOWN : code(v);
    put(ls(opts), K_NEWER, newer === UNKNOWN ? RAW_UNKNOWN : (newer ? String(newer) : ''));
  }

  // Проверка через RuStore. Promise<решение>, не бросает. Метку недели ставит вызывающий:
  // тихая weeklyCheck - при ЛЮБОМ исходе, ручная «Проверить» её не трогает (ограничения нет).
  function check(opts) {
    opts = opts || {};
    var p = plugin(opts);
    if (!p || typeof p.checkUpdate !== 'function') return Promise.resolve({ kind: 'error', reason: 'no-rustore', message: MSG_NO_RUSTORE });
    var timer = null;
    var st = opts.setTimeout || setTimeout, ct = opts.clearTimeout || clearTimeout;
    var clock = new Promise(function (res) { timer = st(function () { res(null); }, opts.timeout || T_CHECK); });
    var req = Promise.resolve().then(function () { return p.checkUpdate(); }).then(null, function () { return null; });
    return Promise.race([req, clock]).then(function (r) {
      ct(timer);
      var d = decide(r);
      if (d.kind !== 'error') setNewer(d.kind === 'store' ? (d.versionCode || UNKNOWN) : 0, opts);
      return d;
    });
  }
  // Тихо, не чаще раза в неделю. Promise<решение|null>. Метка недели ставится ДО запроса - при
  // любом исходе (ошибка, не вошли в RuStore, тайм-аут, «есть» без номера): иначе каждое запирание
  // сейфа (location.reload) снова звало бы SDK, а политика обещает «не чаще раза в неделю».
  // Неудачу человек увидит сам по кнопке «Проверить»; найденная новая версия держится флагом K_NEWER.
  function weeklyCheck(opts) {
    opts = opts || {};
    var now = (opts.now != null) ? opts.now : Date.now();
    var st = ls(opts);
    if (!dueForCheck(get(st, K_CHECK), now)) return Promise.resolve(null);
    put(st, K_CHECK, String(now));
    return check(opts);
  }

  // «Обновить»: окно обновления RuStore; любой иной исход плагин закрывает карточкой в RuStore
  // (ok:true, via:'store'|'web'). Плагин не открыл ничего, отказал или его нет - страница в браузере.
  function viaPlugin(method, opts, openExternal) {
    var p = plugin(opts);
    var web = function () { if (typeof openExternal === 'function') openExternal(URL_RUSTORE); return { ok: true, via: 'web' }; };
    if (!p || typeof p[method] !== 'function') return Promise.resolve(web());
    return Promise.resolve().then(function () { return p[method](); })
      .then(function (r) { return (r && r.ok === true && (r.via === 'sdk' || r.via === 'store' || r.via === 'web')) ? r : web(); }, function () { return web(); });
  }
  function startUpdate(opts, openExternal) { return viaPlugin('startUpdate', opts, openExternal); }
  function openStore(opts, openExternal) { return viaPlugin('openStore', opts, openExternal); }

  // Запуск RuStore без двойного тапа: run() - null, если запуск уже идёт; иначе Promise результата.
  function launcher(fn, o) {
    o = o || {};
    var st = o.setTimeout || setTimeout, ct = o.clearTimeout || clearTimeout;
    var busy = false, gen = 0;
    function done(my) { if (my !== gen || !busy) return; busy = false; if (o.onChange) o.onChange(false); }
    return {
      busy: function () { return busy; },
      run: function () {
        if (busy) return null;
        var args = arguments, my = ++gen;
        busy = true; if (o.onChange) o.onChange(true);
        var t = st(function () { done(my); }, o.timeout || T_LAUNCH);
        return Promise.resolve().then(function () { return fn.apply(null, args); }).then(function (r) {
          ct(t); st(function () { done(my); }, o.linger != null ? o.linger : T_LINGER); return r;
        }, function () { ct(t); done(my); return null; });
      }
    };
  }

  // Что показать в окне «Обновление» стор-сборки. s = {has, checking, launching, last}
  // last - решение последней ручной проверки, пока окно открыто (update.js сбрасывает его при
  // каждом открытии окна, как «Карта года»: старый статус в новом окне не показываем).
  // «Проверить» есть всегда, кроме минут, когда проверка идёт или RuStore открывается (1.3.2 ревью:
  // после первой проверки кнопка пропадала, и человек, вошедший в RuStore, не мог проверить снова).
  // Кнопки по id: 'close' Закрыть/Понятно, 'check' Проверить, 'update' Обновить, 'open' Открыть RuStore.
  function view(s) {
    s = s || {};
    var has = !!s.has, last = s.last || null;
    if (s.launching) return { status: MSG_OPENING, buttons: ['close'] };
    if (s.checking) return { status: MSG_CHECKING, buttons: ['close'] };
    if (has) return { status: MSG_HAS, buttons: ['close', 'check', 'update'] };
    if (last && last.kind === 'error') return { status: last.message || MSG_FAIL, buttons: ['close', 'check', 'open'] };
    if (last && last.kind === 'none') return { status: MSG_NONE, buttons: ['close', 'check'] };
    return { status: MSG_IDLE, buttons: ['close', 'check'] };
  }

  return {
    URL_RUSTORE: URL_RUSTORE, WEEK_MS: WEEK_MS, K_CHECK: K_CHECK, K_NEWER: K_NEWER, UNKNOWN: UNKNOWN,
    MSG_NO_RUSTORE: MSG_NO_RUSTORE, MSG_FAIL: MSG_FAIL, MSG_NONE: MSG_NONE, MSG_HAS: MSG_HAS, MSG_IDLE: MSG_IDLE,
    MSG_CHECKING: MSG_CHECKING, MSG_OPENING: MSG_OPENING, REASON_MSG: REASON_MSG, T_LAUNCH: T_LAUNCH, T_LINGER: T_LINGER,
    reasonMessage: reasonMessage, dueForCheck: dueForCheck, decide: decide, check: check, weeklyCheck: weeklyCheck,
    startUpdate: startUpdate, openStore: openStore, launcher: launcher, view: view,
    getNewer: getNewer, syncNewer: syncNewer, _setNewer: function (v, o) { setNewer(v, o); }
  };
});
