// ota-safe-build.test.mjs - безопасная сборка OTA (исправления по code-review 27.09.2026):
// 1) build-ota.js: zip и подписанный манифест собираются в памяти, обе самопроверки (бандл +
//    подпись) - ДО записи; провал → exit≠0, out/store/ байт-в-байт прежний; успех → атомарно
//    zip, затем update.json;
// 2) publish-update.py: sha256 zip на диске ≠ sha в update.json → отказ ДО чтения ключа и заливки.
// Сборку гоняем в песочнице (копия скриптов + www + свежий ключ подписи), настоящий out/ не трогается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as L from '../build-lib.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const subtle = crypto.webcrypto.subtle;
// публичный репозиторий: внутренние build-ota.js и publish-update.py могут отсутствовать - тогда их тесты пропускаются
const NO_OTA = !fs.existsSync(path.join(ROOT, 'build-ota.js')) && 'внутренний файл не входит в публичный репозиторий';
const NO_PUB = !fs.existsSync(path.join(ROOT, 'publish-update.py')) && 'внутренний файл не входит в публичный репозиторий';

async function newKey() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { privateJwk: await subtle.exportKey('jwk', kp.privateKey),
    publicRawB64: Buffer.from(await subtle.exportKey('raw', kp.publicKey)).toString('base64url') };
}
const withPub = (src, pub) => src.replace(/var OTA_PUB_KEY_B64 = '[^']+'/, "var OTA_PUB_KEY_B64 = '" + pub + "'");

// песочница: ключ подписи свежий, его публичная часть вшита в копию www/update.js
async function sandbox({ pubOverride } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-ota-safe-'));
  ['build-ota.js', 'build-lib.js', 'package.json', 'CHANGELOG.md'].forEach((f) =>
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)));
  fs.cpSync(path.join(ROOT, 'www'), path.join(dir, 'www'), { recursive: true });
  const key = await newKey();
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.writeFileSync(path.join(dir, 'tools', 'ota-sign-key.json'), JSON.stringify(key));
  const upd = path.join(dir, 'www', 'update.js');
  const src = withPub(fs.readFileSync(upd, 'utf8'), pubOverride || key.publicRawB64);
  assert.ok(src.indexOf(pubOverride || key.publicRawB64) > 0, 'не удалось вшить публичный ключ в update.js');
  fs.writeFileSync(upd, src);
  const out = path.join(dir, 'out', 'store');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'last-apk.json'), JSON.stringify({ version: '1.3.0', apkUrl: 'https://dorokhin-finance.ru/seyf-store/seyf-1.3.0.apk', size: 5 }));
  // прошлое состояние: манифест и zip ТОЙ ЖЕ версии - именно его старый код перезаписывал битым
  fs.writeFileSync(path.join(out, 'update.json'), JSON.stringify({ build: 'release', web: { sha256: 'b'.repeat(64) } }));
  fs.writeFileSync(path.join(out, 'www-' + VERSION + '.zip'), 'СТАРЫЙ АРХИВ');
  return dir;
}
function snapshot(dir) {
  const out = path.join(dir, 'out', 'store');
  const s = {};
  fs.readdirSync(out).sort().forEach((f) => {
    s[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, f))).digest('hex');
  });
  return s;
}
function build(dir) {
  const r = spawnSync(process.execPath, [path.join(dir, 'build-ota.js'), '--release'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
  return { status: r.status, text: (r.stdout || '') + (r.stderr || '') };
}

test('build-ota: битый www → exit≠0, out/store/ байт-в-байт прежний (ни zip, ни подписанный манифест)', { skip: NO_OTA }, async () => {
  const dir = await sandbox();
  try {
    fs.rmSync(path.join(dir, 'www', 'js', 'crypto.js'));    // без js/crypto.js самопроверка отвергнет бандл
    const before = snapshot(dir);
    const r = build(dir);
    assert.notEqual(r.status, 0, 'сборка обязана упасть:\n' + r.text);
    assert.match(r.text, /САМОПРОВЕРКА НЕ ПРОЙДЕНА/);
    assert.match(r.text, /js\/crypto\.js/);
    assert.deepEqual(snapshot(dir), before, 'out/store/ изменился при проваленной самопроверке');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build-ota: подпись не принимается клиентом → exit≠0, out/store/ байт-в-байт прежний', { skip: NO_OTA }, async () => {
  const other = await newKey();
  const dir = await sandbox({ pubOverride: other.publicRawB64 });   // в update.js чужой публичный ключ
  try {
    const before = snapshot(dir);
    const r = build(dir);
    assert.notEqual(r.status, 0, 'сборка обязана упасть:\n' + r.text);
    assert.match(r.text, /САМОПРОВЕРКА ПОДПИСИ НЕ ПРОЙДЕНА/);
    assert.deepEqual(snapshot(dir), before, 'out/store/ изменился при проваленной проверке подписи');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('build-ota: исправный www → zip и подписанный манифест записаны, sha сходится, временных файлов нет', { skip: NO_OTA }, async () => {
  const dir = await sandbox();
  try {
    const r = build(dir);
    assert.equal(r.status, 0, r.text);
    const out = path.join(dir, 'out', 'store');
    const man = JSON.parse(fs.readFileSync(path.join(out, 'update.json'), 'utf8'));
    assert.equal(L.sha256hex(fs.readFileSync(path.join(out, 'www-' + VERSION + '.zip'))), man.web.sha256);
    assert.ok(man.sig, 'манифест без подписи');
    assert.deepEqual(fs.readdirSync(out).filter((f) => /\.tmp-/.test(f)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeFileAtomic: пишет целиком, при ошибке цель не тронута и хвоста .tmp нет', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-atomic-'));
  try {
    const f = path.join(dir, 'a.json');
    fs.writeFileSync(f, 'old');
    L.writeFileAtomic(f, 'new');
    assert.equal(fs.readFileSync(f, 'utf8'), 'new');
    fs.mkdirSync(path.join(dir, 'd'));                      // rename файла поверх папки невозможен
    assert.throws(() => L.writeFileAtomic(path.join(dir, 'd'), 'x'));
    assert.deepEqual(fs.readdirSync(dir).sort(), ['a.json', 'd']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function pyOk() { try { return spawnSync('python', ['-c', 'import cryptography']).status === 0; } catch (e) { return false; } }
test('publish-update.py: sha zip ≠ sha в подписанном update.json → отказ до ключа и заливки; совпал → «целостность»',
  { skip: NO_PUB || (!pyOk() && 'нет python+cryptography') }, async () => {
    const key = await newKey();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-pub-sha-'));
    const here = path.join(root, 'x', 'mobile');            // «Ключ Яндекс.txt» ищется в root - его там нет
    fs.mkdirSync(path.join(here, 'out', 'store'), { recursive: true });
    fs.mkdirSync(path.join(here, 'www'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'publish-update.py'), path.join(here, 'publish-update.py'));
    fs.writeFileSync(path.join(here, 'www', 'update.js'), withPub(fs.readFileSync(path.join(ROOT, 'www', 'update.js'), 'utf8'), key.publicRawB64));
    const zip = Buffer.from('архив');
    fs.writeFileSync(path.join(here, 'out', 'store', 'www-9.9.9.zip'), zip);
    const run = async (sha) => {
      const m = { build: 'release', version: '1.3.0', apkUrl: 'https://dorokhin-finance.ru/seyf-store/seyf-1.3.0.apk', size: 1, notes: 'n',
        web: { version: '9.9.9', url: 'https://dorokhin-finance.ru/seyf-store/www-9.9.9.zip', sha256: sha, size: zip.length, minShell: '1.0.0' } };
      m.sig = await L.signManifest(m, key, path.join(here, 'www'));
      fs.writeFileSync(path.join(here, 'out', 'store', 'update.json'), JSON.stringify(m));
      const r = spawnSync('python', [path.join(here, 'publish-update.py')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      return { status: r.status, text: (r.stdout || '') + (r.stderr || '') };
    };
    try {
      const bad = await run('c'.repeat(64));
      assert.notEqual(bad.status, 0);
      assert.match(bad.text, /подпись манифеста проверена/, 'подпись честная - отказ именно по sha');
      assert.match(bad.text, /sha256 www-9\.9\.9\.zip на диске .* != sha в манифесте/);
      assert.match(bad.text, /Ничего не залито/);
      assert.ok(!/Ключ Яндекс|FileNotFoundError/.test(bad.text), 'ключ хранилища читался до сверки sha');
      const good = await run(L.sha256hex(zip));
      assert.match(good.text, /\[✓\] целостность www-9\.9\.9\.zip: sha256 совпал/);
      assert.ok(!/опубликовано/.test(good.text), 'в тесте ничего не залито (ключа Яндекса нет)');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
