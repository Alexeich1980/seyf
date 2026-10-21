// ota-sign-1223.test.mjs - подпись OTA-манифеста (1.2.23, блок D). Клиент (www/update.js) принимает
// ТОЛЬКО манифест, подписанный офлайн-ключом ECDSA P-256; подделка любого значимого поля, подмена
// ссылки/sha, отсутствие подписи - отказ ДО скачивания. build-ota подписывает той же канонической
// строкой (build-lib.signManifest) и прогоняет проверку кодом клиента; publish-update.py проверяет
// подпись сам (Python + cryptography) - тест гоняет его на подписанном node-ом манифесте, то есть
// заодно доказывает, что каноническая строка JS и Python совпадает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as L from '../build-lib.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const WWW = path.join(ROOT, 'www');
const KEY_FILE = path.join(ROOT, 'tools', 'ota-sign-key.json');
const subtle = globalThis.crypto.subtle;

function loadUpdate(win) {
  const code = fs.readFileSync(path.join(WWW, 'update.js'), 'utf8');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, globalThis, console, window: win, setTimeout, clearTimeout });
  return mod.exports;
}
const U = loadUpdate(undefined);

const baseManifest = () => ({
  build: 'release', version: '1.2.0', apkUrl: 'https://dorokhin-finance.ru/seyf-store/seyf-1.2.0.apk', size: 9476594,
  notes: '- исправлено то и это', web: { version: '1.2.23', url: 'https://dorokhin-finance.ru/seyf-store/www-1.2.23.zip',
    sha256: 'ab'.repeat(32), size: 2345678, minShell: '1.0.0' },
});
async function keypair() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { kp, pub: Buffer.from(await subtle.exportKey('raw', kp.publicKey)).toString('base64url') };
}
async function sign(m, priv) {
  const data = await U.manifestSigData(m, { subtle });
  return Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(data))).toString('base64url');
}

test('D3: подписанный манифест принимается; без подписи / мусорная подпись / чужой ключ - отказ', async () => {
  const { kp, pub } = await keypair();
  const m = baseManifest(); m.sig = await sign(m, kp.privateKey);
  assert.equal(await U.verifyManifest(m, { otaPubKeyB64: pub }), true, 'валидная подпись - принято');
  assert.equal(await U.verifyManifest({ ...m, sig: undefined }, { otaPubKeyB64: pub }), false, 'нет подписи');
  assert.equal(await U.verifyManifest({ ...m, sig: 'xyz' }, { otaPubKeyB64: pub }), false, 'мусор вместо подписи');
  const other = await keypair();
  assert.equal(await U.verifyManifest(m, { otaPubKeyB64: other.pub }), false, 'подпись чужим ключом');
  assert.equal(await U.verifyManifest(m), false, 'тестовый ключ не совпадает с боевым вшитым');
});

test('D5: подделка ЛЮБОГО значимого поля (и текста «Что нового») - отказ', async () => {
  const { kp, pub } = await keypair();
  const m = baseManifest(); m.sig = await sign(m, kp.privateKey);
  const forgeries = {
    build: (x) => { x.build = 'store'; },
    version: (x) => { x.version = '9.9.9'; },
    apkUrl: (x) => { x.apkUrl = 'https://dorokhin-finance.ru/seyf-store/evil.apk'; },
    size: (x) => { x.size = 1; },
    'web.version': (x) => { x.web.version = '9.9.9'; },
    'web.url (подмена ссылки)': (x) => { x.web.url = 'https://dorokhin-finance.ru/seyf-store/evil.zip'; },
    'web.sha256 (подмена sha)': (x) => { x.web.sha256 = 'cd'.repeat(32); },
    'web.size': (x) => { x.web.size = 1; },
    'web.minShell': (x) => { x.web.minShell = '0'; },
    notes: (x) => { x.notes = 'Срочно скачайте APK по ссылке'; },
    'web удалён': (x) => { delete x.web; },
  };
  for (const [name, f] of Object.entries(forgeries)) {
    const x = JSON.parse(JSON.stringify(m)); f(x);
    assert.equal(await U.verifyManifest(x, { otaPubKeyB64: pub }), false, 'подделка «' + name + '» должна отвергаться');
  }
  const nl = JSON.parse(JSON.stringify(m)); nl.web.url = 'https://a\nweb.url=https://b';
  assert.equal(await U.manifestSigData(nl, { subtle }), null, 'перевод строки в поле - отказ канонизации');
});

test('D3: fetchManifest отклоняет неподписанный манифест понятной ошибкой ДО разбора; подписанный - принят', async () => {
  const { kp, pub } = await keypair();
  const m = baseManifest();
  const fetchOf = (obj) => async () => ({ ok: true, text: async () => JSON.stringify(obj) });
  await assert.rejects(U.fetchManifest({ fetch: fetchOf(m), otaPubKeyB64: pub }), (e) => e.message === U.ERR.sig);
  m.sig = await sign(m, kp.privateKey);
  const got = await U.fetchManifest({ fetch: fetchOf(m), otaPubKeyB64: pub });
  assert.equal(got.web.version, '1.2.23');
  assert.ok(got.web.signed && got.web.signed.sig === m.sig, 'web связан с подписанным манифестом (для apply)');
  assert.ok(!/—/.test(U.ERR.sig), 'без длинного тире');
});

test('D3: apply перепроверяет подпись ДО скачивания: web без подписанного манифеста/с подменённой ссылкой - ничего не качается', async () => {
  const { kp, pub } = await keypair();
  const plugins = { Filesystem: {}, WebView: {} };
  let fetched = 0;
  const fetch = async () => { fetched++; throw new Error('net'); };
  const U2 = loadUpdate({ SeyfSave: { pending: () => false } });
  const m = baseManifest(); m.sig = await sign(m, kp.privateKey);
  assert.equal(await U2.apply({ ...m.web }, { plugins, fetch, otaPubKeyB64: pub }), false, 'нет подписанного манифеста');
  assert.equal(fetched, 0);
  assert.equal(await U2.apply({ ...m.web, url: 'https://dorokhin-finance.ru/seyf-store/evil.zip', signed: m }, { plugins, fetch, otaPubKeyB64: pub }), false, 'ссылка подменена после проверки');
  assert.equal(fetched, 0, 'ничего не скачано');
  await U2.apply({ ...m.web, signed: m }, { plugins, fetch, otaPubKeyB64: pub });
  assert.equal(fetched, 1, 'подписанный и неподменённый - скачивание пошло');
});

test('D1: публичный ключ в www/update.js - от приватного ключа tools/ota-sign-key.json (и ключ не в git)', { skip: !fs.existsSync(KEY_FILE) && 'нет приватного ключа на этой машине' }, async () => {
  const k = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  assert.equal(U.OTA_PUB_KEY_B64, k.publicRawB64);
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^tools\/ota-sign-key\.json$/m);
});

test('D2/D5: build-lib.signManifest подписывает, а selfCheckManifestSig (код клиента) принимает; порча - бросает', { skip: !fs.existsSync(KEY_FILE) && 'нет приватного ключа' }, async () => {
  const k = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const m = baseManifest();
  m.sig = await L.signManifest(m, k, WWW);
  assert.equal(await L.selfCheckManifestSig(m, WWW), true);
  await assert.rejects(L.selfCheckManifestSig({ ...m, version: '9.9.9' }, WWW), /самопроверка/);
});

test('D2: build-ota без ключа падает, подписывает манифест и самопроверяет подпись кодом клиента', { skip: !fs.existsSync(path.join(ROOT, 'build-ota.js')) && 'внутренний файл не входит в публичный репозиторий' }, () => {
  const src = fs.readFileSync(path.join(ROOT, 'build-ota.js'), 'utf8');
  assert.match(src, /if \(!fs\.existsSync\(OTA_KEY\)\) \{\s*die\(/);
  assert.match(src, /manifest\.sig = await L\.signManifest\(manifest,/);
  assert.match(src, /await L\.selfCheckManifestSig\(/);
});

function pyOk() { try { return spawnSync('python', ['-c', 'import cryptography']).status === 0; } catch (e) { return false; } }
test('D4: publish-update.py сам проверяет подпись: неподписанный/подделанный - отказ, подписанный - «проверена» (и ничего не льёт в тесте)', { skip: (!pyOk() || !fs.existsSync(KEY_FILE)) && 'нет python+cryptography или ключа' }, async () => {
  const k = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-d4-'));
  const here = path.join(root, 'x', 'mobile');          // «Ключ Яндекс.txt» ищется в root - его там нет
  fs.mkdirSync(path.join(here, 'out', 'store'), { recursive: true });
  fs.mkdirSync(path.join(here, 'www'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'publish-update.py'), path.join(here, 'publish-update.py'));
  fs.copyFileSync(path.join(WWW, 'update.js'), path.join(here, 'www', 'update.js'));
  const run = (m) => {
    fs.writeFileSync(path.join(here, 'out', 'store', 'update.json'), JSON.stringify(m));
    const r = spawnSync('python', [path.join(here, 'publish-update.py')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    return (r.stdout || '') + (r.stderr || '');
  };
  try {
    const m = baseManifest();
    assert.match(run(m), /нет подписи/);
    m.sig = await L.signManifest(m, k, WWW);
    const ok = run(m);
    assert.match(ok, /подпись манифеста проверена/, 'Python принимает подпись, сделанную node (канонизация совпадает)');
    assert.ok(!/опубликовано/.test(ok), 'в тесте ничего не залито');
    assert.match(run({ ...m, web: { ...m.web, url: 'https://dorokhin-finance.ru/seyf-store/evil.zip' } }), /НЕ сходится/);
    assert.match(run({ ...m, notes: 'подмена' }), /НЕ сходится/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
