// update.test.mjs — чистая часть OTA-клиента «Сейфа» (порт по образцу «Хомяка», спека 8b п.3).
// UMD-модули update.js/boot.js подключаем через createRequire. Сетевую/WebView-часть здесь
// не трогаем (проверяется на устройстве) — только разбор манифеста, решение и безопасность путей.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// update.js/boot.js — UMD-модули (в браузере грузятся классическим <script>). Пакет mobile —
// type:module, поэтому require() грузил бы их как ESM и ломал UMD. Выполняем как CommonJS в
// песочнице vm: ветка module.exports = factory() отдаёт чистый объект без обращения к window.
const HERE = path.dirname(fileURLToPath(import.meta.url));
function loadUMD(rel) {
  const code = fs.readFileSync(path.join(HERE, rel), 'utf8');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, globalThis, console });
  return mod.exports;
}
const Update = loadUMD('../www/update.js');
const Boot = loadUMD('../www/boot.js');

const HOST = Update.HOST;                       // боевой домен канала (см. конфиг update.js)
const man = (over = {}) => Object.assign({
  version: '0.7.0', apkUrl: 'https://' + HOST + '/seyf-store/seyf-0.7.0.apk', size: 3000000, notes: 'что нового',
}, over);

test('канал обновлений настроен на боевой домен Алексея (не заглушка)', () => {
  assert.equal(Update.URL, 'https://dorokhin-finance.ru/seyf-store/update.json');
  assert.equal(HOST, 'dorokhin-finance.ru');
  assert.equal(Update.URL_RUSTORE, 'https://www.rustore.ru/catalog/app/ru.dorokhin.seyf');
  assert.ok(!Update.URL.toLowerCase().includes('placeholder'), 'в URL не осталось заглушки');
  assert.ok(!String(HOST).toLowerCase().includes('placeholder'), 'в HOST не осталось заглушки');
});

test('hostOf: только домен канала и его поддомены, только https', () => {
  assert.equal(Update.parseManifest(man()) !== null, true);                 // https + свой домен
  assert.equal(Update.parseManifest(man({ apkUrl: 'https://sub.' + HOST + '/x.apk' })) !== null, true); // поддомен
  assert.equal(Update.parseManifest(man({ apkUrl: 'https://evil-dorokhin-finance.ru/x.apk' })), null);  // чужой хост-обманка
  assert.equal(Update.parseManifest(man({ apkUrl: 'http://' + HOST + '/x.apk' })), null);               // не https
});

test('cmpVer сравнивает по числам, а не по строке', () => {
  assert.equal(Update.cmpVer('0.10.0', '0.9.9'), 1);
  assert.equal(Update.cmpVer('0.6.0', '0.6.0'), 0);
  assert.equal(Update.cmpVer('ерунда', '0.2.0'), -1);
});

test('isVer', () => {
  ['0', '0.6', '0.6.0', '10.20.30'].forEach((v) => assert.equal(Update.isVer(v), true, v));
  ['', 'v0.6.0', '0.6.0.1', '0.6.x', null].forEach((v) => assert.equal(Update.isVer(v), false, String(v)));
});

test('parseManifest: валидный → объект; чужой домен / http / не-apk → null', () => {
  assert.ok(Update.parseManifest(man()));
  assert.equal(Update.parseManifest(man({ apkUrl: 'https://evil.com/x.apk' })), null);   // не наш домен
  assert.equal(Update.parseManifest(man({ apkUrl: 'http://' + HOST + '/x.apk' })), null); // не https
  assert.equal(Update.parseManifest(man({ apkUrl: 'https://' + HOST + '/x.zip' })), null); // не .apk
  assert.equal(Update.parseManifest(null), null);
});

test('parseWeb: sha256 обязателен и ровно 64 hex; чужой домен → null', () => {
  const web = { version: '0.7.1', url: 'https://' + HOST + '/seyf-store/www-0.7.1.zip', sha256: 'a'.repeat(64), size: 500000, minShell: '0.7.0' };
  assert.ok(Update.parseWeb(web));
  assert.equal(Update.parseWeb(Object.assign({}, web, { sha256: 'abc' })), null);
  assert.equal(Update.parseWeb(Object.assign({}, web, { url: 'https://evil.com/a.zip' })), null);
});

test('decide: бесшовное OTA, когда web новее и оболочка тянет minShell', () => {
  const m = Update.parseManifest(man({ web: { version: '0.7.1', url: 'https://' + HOST + '/w.zip', sha256: 'a'.repeat(64), size: 100, minShell: '0.6.0' } }));
  const d = Update.decide(m, '0.6.0', '0.7.0', null);   // webVer=0.6.0, оболочка 0.7.0
  assert.equal(d.kind, 'ota');
  assert.equal(d.version, '0.7.1');
});

test('decide: APK-канал, когда новее сама оболочка', () => {
  const d = Update.decide(Update.parseManifest(man({ version: '0.8.0' })), '0.6.0', '0.6.0', null);
  assert.equal(d.kind, 'apk');
  assert.equal(d.version, '0.8.0');
});

test('decide: нет обновления, когда всё на своих версиях', () => {
  const d = Update.decide(Update.parseManifest(man({ version: '0.6.0' })), '0.6.0', '0.6.0', null);
  assert.equal(d.kind, 'none');
});

// --- батч-21: корень «OTA предлагает ту же версию» / «предлагает скачать APK» ---

test('bug1: cmpVer — равные НЕ новее, минор-меньше новее, патч-меньше новее', () => {
  assert.equal(Update.cmpVer('1.1.0', '1.1.0'), 0);   // равные → апдейта быть не должно
  assert.equal(Update.cmpVer('1.0.0', '1.1.0'), -1);  // минор меньше → есть новее
  assert.equal(Update.cmpVer('1.1.0', '1.0.9'), 1);   // минор больше
  assert.equal(Update.cmpVer('1.1.0', '1.1.1'), -1);  // патч меньше → есть новее
});

test('bug1: стоит 1.1.0, оболочка 1.1.0, манифест 1.1.0 → НЕ предлагать (не apk той же версии)', () => {
  const m = Update.parseManifest(man({
    version: '1.1.0', apkUrl: 'https://' + HOST + '/seyf-store/seyf-1.1.0.apk',
    web: { version: '1.1.0', url: 'https://' + HOST + '/seyf-store/www-1.1.0.zip', sha256: 'a'.repeat(64), size: 100, minShell: '1.0.0' },
  }));
  const d = Update.decide(m, '1.1.0', '1.1.0', null);
  assert.equal(d.kind, 'none');
});

test('bug2: shell>=minShell и web новее → путь БЕСШОВНЫЙ (ota), а не APK-скачивание', () => {
  const m = Update.parseManifest(man({
    version: '1.1.0', apkUrl: 'https://' + HOST + '/seyf-store/seyf-1.1.0.apk',
    web: { version: '1.1.1', url: 'https://' + HOST + '/seyf-store/www-1.1.1.zip', sha256: 'a'.repeat(64), size: 100, minShell: '1.0.0' },
  }));
  const d = Update.decide(m, '1.1.0', '1.1.0', null);   // оболочка 1.1.0 >= minShell 1.0.0
  assert.equal(d.kind, 'ota');
  assert.equal(d.version, '1.1.1');
});

test('bug2: shell<minShell → не бесшовно, уводим на APK (обновить оболочку)', () => {
  const m = Update.parseManifest(man({
    version: '1.2.0', apkUrl: 'https://' + HOST + '/seyf-store/seyf-1.2.0.apk',
    web: { version: '1.2.0', url: 'https://' + HOST + '/seyf-store/www-1.2.0.zip', sha256: 'a'.repeat(64), size: 100, minShell: '1.2.0' },
  }));
  const d = Update.decide(m, '1.1.0', '1.1.0', null);   // оболочка 1.1.0 < minShell 1.2.0
  assert.equal(d.kind, 'apk');
  assert.equal(d.version, '1.2.0');
});

test('safeName: режет обходы каталога и абсолютные пути', () => {
  assert.equal(Update.safeName('js/app.js'), 'js/app.js');
  assert.equal(Update.safeName('../secret'), null);
  assert.equal(Update.safeName('/etc/passwd'), null);
  assert.equal(Update.safeName('a\\b'), null);
  assert.equal(Update.safeName('C:/x'), null);
});

test('boot.decide: первый запуск — arm, второй без ok — revert', () => {
  const tryRec = JSON.stringify({ version: '0.7.1', ts: 1, boots: 0, sha256: '' });
  const arm = Boot.decide((k) => (k === Boot.K_TRY ? tryRec : null), '0.7.1');
  assert.equal(arm.action, 'arm');
  assert.equal(arm.mark.boots, 1);
  const tryRec2 = JSON.stringify({ version: '0.7.1', ts: 1, boots: 1, sha256: '' });
  const rev = Boot.decide((k) => (k === Boot.K_TRY ? tryRec2 : null), '0.7.1');
  assert.equal(rev.action, 'revert');
});

test('boot: ключи в пространстве «seyf-ota-*» (не пересекаются с «Хомяком»)', () => {
  assert.equal(Boot.K_TRY, 'seyf-ota-try');
  assert.equal(Boot.K_OK, 'seyf-ota-ok');
  assert.equal(Boot.K_FAIL, 'seyf-ota-fail');
});
