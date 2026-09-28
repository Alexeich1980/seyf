/* native.js — мост к родным возможностям телефона. Грузится сразу после capacitor.js.
   Без явной регистрации Capacitor.Plugins.* пусты. В браузере QA моста нет
   (isNativePlatform()===false) — каждый потребитель держит запасной путь. */
(function () {
  'use strict';
  var C = window.Capacitor;
  if (!C || typeof C.registerPlugin !== 'function') return;
  try {
    window.NativePlugins = {
      App: C.registerPlugin('App'),
      Haptics: C.registerPlugin('Haptics'),
      Filesystem: C.registerPlugin('Filesystem'),
      NativeBiometric: C.registerPlugin('NativeBiometric'),
      SaveFile: C.registerPlugin('SaveFile'),
      RuStorePay: C.registerPlugin('RuStorePay'),
      WebView: C.registerPlugin('WebView'),
    };
  } catch (e) { window.NativePlugins = null; }
  window.isNativeApp = function () {
    try { return !!(C.isNativePlatform && C.isNativePlatform()); } catch (e) { return false; }
  };

  // Версия ОБОЛОЧКИ (APK) — НЕ то же самое, что версия веб-сборки в version.js: бесшовное
  // обновление подменяет www целиком, APP_VERSION уезжает вперёд, а APK остаётся прежним.
  // Номер оболочки спрашиваем у Android (App.getInfo), а не у подменяемого файла.
  //
  // ЗАСЛОН (корень «OTA предлагает ту же версию» и «предлагает скачать APK вместо бесшовного»):
  // без этих полей update.js не знал номер оболочки на телефоне (shellVer()===null),
  // считал его «неизвестным» и уводил на канал APK для ЛЮБОЙ версии > 0 — то есть предлагал
  // скачать ту же 1.1.0. Пока Android не ответил — SHELL_VERSION=null (честное «не знаю»),
  // update.js ждёт до трёх секунд. В браузере (QA на компе) оболочки нет — номер веб-сборки
  // единственный и он же верный.
  window.SHELL_IS_BROWSER = !window.isNativeApp();
  window.SHELL_VERSION = null;
  window.SHELL_READY = Promise.resolve(null);

  if (window.SHELL_IS_BROWSER) {
    window.SHELL_VERSION = String(window.APP_VERSION || '0');
  } else if (window.NativePlugins && window.NativePlugins.App) {
    try {
      window.SHELL_READY = window.NativePlugins.App.getInfo().then(function (info) {
        var v = info && info.version ? String(info.version) : '';
        if (!v) return null;
        window.SHELL_VERSION = v;
        // меню рисует номер версии — обновим, если оболочка отстала от веб-сборки
        try { if (window.SeyfUI && window.SeyfUI.renderMenu) window.SeyfUI.renderMenu(); } catch (e) {}
        return v;
      }, function () { return null; });
    } catch (e) { window.SHELL_READY = Promise.resolve(null); }
  }
})();
