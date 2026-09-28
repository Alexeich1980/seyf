// ota-offline.test.mjs — заслон против «Uncaught (in promise)» при офлайн-проверке обновления.
// Проверка обновления (update.js) — единственный выход в интернет. Офлайн fetch к
// dorokhin-finance.ru РЕДЖЕКТИТСЯ; если промис не заглушить, в консоли всплывает
// необработанный реджект. Тест грузит НАСТОЯЩИЙ www/update.js в песочнице-браузере с
// fetch, который всегда падает, и прогоняет ВСЕ пути выхода в сеть на старте и по кнопке:
//   mount() → weeklyCheck() → silentCheck();  ручной check();  а также «висящую» сеть
//   (fetch без ответа → таймаут+abort). Итог обязан быть: ноль unhandledRejection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.join(HERE, '..', 'www');

function makeSandbox(fetchImpl) {
  const listeners = {};
  const doc = {
    addEventListener: (t, cb) => { (listeners[t] ||= []).push(cb); },
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }),
    head: { appendChild() {} },
    visibilityState: 'visible',
  };
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const win = {
    APP_VERSION: '1.1.0',
    SHELL_IS_BROWSER: true,
    SHELL_VERSION: '1.1.0',
    SHELL_READY: Promise.resolve('1.1.0'),
    isNativeApp: () => false,
    localStorage,
    addEventListener: (t, cb) => { (listeners[t] ||= []).push(cb); },
    setTimeout, clearTimeout,
    location: { reload() {} },
    APP_READY: true,
    SeyfUI: { renderMenu() {}, esc: (s) => s, openDlg() {} },
  };
  win.window = win;
  const sandbox = {
    window: win, document: doc, localStorage, fetch: fetchImpl,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, console, AbortController, crypto: globalThis.crypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    TypeError, Error, JSON, Date, Math, Number, String, Object,
    module: { exports: {} }, exports: {}, self: win, globalThis,
  };
  sandbox.globalThis = sandbox;
  const code = fs.readFileSync(path.join(WWW, 'update.js'), 'utf8');
  vm.runInNewContext(code, sandbox);
  return { Update: win.Update || sandbox.module.exports, store };
}

test('офлайн-проверка обновления не роняет unhandledRejection', async () => {
  const rejections = [];
  const onRej = (r) => { rejections.push(String((r && r.message) || r)); };
  process.on('unhandledRejection', onRej);
  try {
    const offlineFetch = () => Promise.reject(new TypeError('Failed to fetch'));   // офлайн
    const { Update, store } = makeSandbox(offlineFetch);
    assert.equal(typeof Update.mount, 'function');

    store.delete('updCheckAt');   // заставляем еженедельную проверку сработать сейчас
    Update.mount();               // → weeklyCheck() → silentCheck() уходит в офлайн-сеть

    const oFetch = { fetch: offlineFetch };
    const hangFetch = { fetch: () => new Promise(() => {}), timeout: 30 };   // сеть «висит» → таймаут+abort
    await Update.silentCheck(oFetch);
    await Update.check(oFetch);
    await Update.silentCheck(hangFetch);
    await Update.check(hangFetch);
    await new Promise((r) => setTimeout(r, 200));   // даём микро/макро-задачам осесть

    assert.deepEqual(rejections, [], 'офлайн-проверка обязана глушить реджект тихо');
  } finally {
    process.off('unhandledRejection', onRej);
  }
});
