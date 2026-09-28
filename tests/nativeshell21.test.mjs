// nativeshell21.test.mjs — заслон корня bug1/bug2: native.js ОБЯЗАН выставлять номер оболочки
// (window.SHELL_VERSION / SHELL_READY). Без него update.js на телефоне не знал версию APK
// (shellVer()===null → «неизвестно»), глушил бесшовный OTA и совал APK-канал на ЛЮБУЮ версию —
// то есть предлагал скачать ту же 1.1.0. Прогоняем native.js в песочнице vm с поддельным
// Capacitor и проверяем оба режима: браузер (номер = веб-сборка) и телефон (номер из App.getInfo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODE = fs.readFileSync(path.join(HERE, '../www/native.js'), 'utf8');

function runNative(win) {
  const ctx = { window: win, console, Promise, setTimeout };
  vm.runInNewContext(CODE, ctx);
  return win;
}

function fakeCapacitor({ native, version }) {
  return {
    registerPlugin(name) {
      if (name === 'App') return { getInfo: () => Promise.resolve({ version }) };
      return {};
    },
    isNativePlatform: () => native,
  };
}

test('bug1/2: в БРАУЗЕРЕ (не телефон) SHELL_VERSION = версия веб-сборки', () => {
  const win = { APP_VERSION: '1.1.0', Capacitor: fakeCapacitor({ native: false }) };
  runNative(win);
  assert.equal(win.SHELL_IS_BROWSER, true);
  assert.equal(win.SHELL_VERSION, '1.1.0');
});

test('bug1/2: на ТЕЛЕФОНЕ SHELL_VERSION приходит из App.getInfo (не из веб-сборки)', async () => {
  const win = { APP_VERSION: '1.1.0', Capacitor: fakeCapacitor({ native: true, version: '1.0.0' }) };
  runNative(win);
  assert.equal(win.SHELL_IS_BROWSER, false);
  assert.equal(win.SHELL_VERSION, null, 'до ответа Android — честное «не знаю» (null)');
  assert.ok(win.SHELL_READY && typeof win.SHELL_READY.then === 'function', 'есть промис ожидания оболочки');
  const v = await win.SHELL_READY;
  assert.equal(v, '1.0.0');
  assert.equal(win.SHELL_VERSION, '1.0.0', 'после ответа — реальный номер оболочки APK');
});

test('bug1/2: App.getInfo упал → SHELL_VERSION остаётся null (update.js подождёт и уведёт на APK)', async () => {
  const cap = {
    registerPlugin(name) {
      if (name === 'App') return { getInfo: () => Promise.reject(new Error('нет плагина')) };
      return {};
    },
    isNativePlatform: () => true,
  };
  const win = { APP_VERSION: '1.1.0', Capacitor: cap };
  runNative(win);
  const v = await win.SHELL_READY;
  assert.equal(v, null);
  assert.equal(win.SHELL_VERSION, null);
});
