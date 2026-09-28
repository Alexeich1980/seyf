// security-1223.test.mjs - заслоны блока B адверсариального ревью 22.09 (безопасность, 1.2.23).
// Сценарии перенесены из пруф-скрипта ревьюера review-sec/poc.mjs (буфер в фоне, ссылки контактов,
// битый QR) - там старое поведение было «наблюдаемым», здесь требуется новое.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClipboardGuard, copyNeedsGuard } from '../www/js/clipboard.js';
import { cleanupCameraTemp, CAM_DIR, CAM_DIRECTORY } from '../www/js/camtemp.js';
import { SECRET_INPUT_ATTRS, editorInputType } from '../www/js/fieldinput.js';
import { openableHref, mailtoHref, telHref, linkLabel } from '../www/js/contactlinks.js';
import { parseOtpauth, safeDigits, safePeriod, secretLongEnough } from '../www/js/totp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const APP = fs.readFileSync(path.join(ROOT, 'www', 'js', 'app.js'), 'utf8');
// публичный репозиторий: build-ota.js (внутренний) может отсутствовать - тогда B1 пропускается
const OTA_PATH = path.join(ROOT, 'build-ota.js');
const OTA = fs.existsSync(OTA_PATH) ? fs.readFileSync(OTA_PATH, 'utf8') : null;

// ---------------- B1 ----------------
test('B1: build-ota --full помечает манифест build:test и ВСЕГДА возвращает buildflags в false', { skip: OTA === null && 'внутренний файл не входит в публичный репозиторий' }, () => {
  assert.match(OTA, /build: FULL \? 'test' : 'release',/);
  assert.match(OTA, /process\.on\('exit', resetFlags\);/, 'сброс и при die()/исключении');
  const pack = OTA.indexOf('fflate.zipSync(bag');
  const reset = OTA.indexOf('resetFlags();   // B1');
  assert.ok(pack > 0 && reset > pack, 'сброс в false - ПОСЛЕ упаковки архива');
  assert.match(fs.readFileSync(path.join(ROOT, 'www', 'buildflags.js'), 'utf8'), /SEYF_FULL_ACCESS\s*=\s*false\s*;/);
});

function pyAvailable() { try { return spawnSync('python', ['--version']).status === 0; } catch (e) { return false; } }
test('B1: publish-update.py отказывается публиковать build:test без явного --test (ничего не заливает)', { skip: (!fs.existsSync(path.join(ROOT, 'publish-update.py')) && 'внутренний файл не входит в публичный репозиторий') || (!pyAvailable() && 'нет python') }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-pub-'));
  fs.copyFileSync(path.join(ROOT, 'publish-update.py'), path.join(tmp, 'publish-update.py'));
  fs.mkdirSync(path.join(tmp, 'out', 'store'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'out', 'store', 'update.json'), JSON.stringify({ build: 'test', version: '1.2.0', apkUrl: 'https://dorokhin-finance.ru/seyf-store/x.apk', web: {} }));
  const r = spawnSync('python', [path.join(tmp, 'publish-update.py')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.notEqual(r.status, 0, 'без --test - отказ');
  assert.match(r.stderr + r.stdout, /ТЕСТОВОЙ сборкой/);
  const r2 = spawnSync('python', [path.join(tmp, 'publish-update.py'), '--test'], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.ok(!/ТЕСТОВОЙ сборкой \(build='test'/.test(r2.stderr + r2.stdout), 'с --test этот отказ не срабатывает (дальше - свои проверки)');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------- B2 ----------------
test('B2: временные JPEG_*.jpg камеры удаляются из внешней папки Pictures, прочее не трогается', async () => {
  const files = new Map([['JPEG_20260922_101010_123.jpg', 1], ['JPEG_20260922_101011_9.JPG', 1], ['keep.png', 1], ['JPEG_dir', 'dir']]);
  const calls = [];
  const fake = {
    async readdir(o) { calls.push(['readdir', o.path, o.directory]); return { files: [...files.keys()].map((name) => ({ name, type: files.get(name) === 'dir' ? 'directory' : 'file' })) }; },
    async deleteFile(o) { calls.push(['del', o.path, o.directory]); files.delete(o.path.split('/').pop()); },
  };
  assert.equal(await cleanupCameraTemp(fake), 2);
  assert.deepEqual([...files.keys()].sort(), ['JPEG_dir', 'keep.png']);
  assert.deepEqual(calls[0], ['readdir', CAM_DIR, CAM_DIRECTORY]);
  assert.equal(CAM_DIRECTORY, 'EXTERNAL', 'getExternalFilesDir - Directory.External плагина');
  assert.ok(calls.slice(1).every((c) => c[1].startsWith('Pictures/') && c[2] === 'EXTERNAL'));
  assert.equal(await cleanupCameraTemp(null), 0, 'нет плагина (браузер) - тихо ничего');
  assert.equal(await cleanupCameraTemp({ readdir: async () => { throw new Error('no dir'); }, deleteFile: async () => {} }), 0);
});

test('B2: app.js чистит временные фото при старте и после каждой съёмки', () => {
  const boot = APP.slice(APP.indexOf('async function boot()'), APP.indexOf('async function boot()') + 300);
  assert.match(boot, /cleanupCameraTemp\(\);/);
  const cam = APP.slice(APP.indexOf("box.querySelector('.doc-cam').onclick"), APP.indexOf("box.querySelector('.doc-file').onclick"));
  assert.match(cam, /finally \{ cleanupCameraTemp\(\); \}/);
});

// ---------------- B3 ----------------
test('B3/poc#2: очистка по таймеру в фоне не удалась -> pending НЕ теряется, при возврате буфер очищается', async () => {
  let clipText = '', focused = true; const timers = [];
  const fake = {
    async readText() { if (!focused) throw Object.assign(new Error('Document is not focused.'), { name: 'NotAllowedError' }); return clipText; },
    async writeText(t) { if (!focused) throw Object.assign(new Error('Document is not focused.'), { name: 'NotAllowedError' }); clipText = t; },
  };
  const g = createClipboardGuard({ clipboard: fake, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  await g.copy('S3cr3t-P@ss');
  focused = false;                      // пользователь ушёл в браузер вставлять
  await timers[0]();                    // TTL сработал в фоне
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(clipText, 'S3cr3t-P@ss', 'в фоне очистить нельзя (как на телефоне)');
  assert.equal(g.hasPending(), true, 'pending сохранён (раньше терялся -> секрет навсегда в буфере)');
  assert.equal(g.needsRetry(), true);
  focused = true;                       // вернулся - onForeground -> retryIfFailed
  assert.equal(await g.retryIfFailed(), true);
  assert.equal(clipText, '', 'буфер очищен');
  assert.equal(g.hasPending(), false);
});

test('B3: retryIfFailed без неудачной попытки буфер НЕ трогает (пользователь мог уйти вставить пароль)', async () => {
  let clipText = '';
  const g = createClipboardGuard({ clipboard: { readText: async () => clipText, writeText: async (t) => { clipText = t; } }, setTimer: () => 1, clearTimer: () => {} });
  await g.copy('P');
  assert.equal(await g.retryIfFailed(), false);
  assert.equal(clipText, 'P');
});

test('B3: app.js повторяет очистку буфера при возврате на передний план (и при блокировке - clearIfOurs)', () => {
  const fg = APP.slice(APP.indexOf('function onForeground()'), APP.indexOf('function onForeground()') + 600);
  assert.match(fg, /clip\.retryIfFailed\(\)/);
  assert.match(APP.slice(APP.indexOf('async function lockNow()'), APP.indexOf('async function lockNow()') + 800), /await clip\.clearIfOurs\(\)/);
});

// ---------------- B4 ----------------
test('B4: номер карты и произвольные поля копируются защищённо (clip.copy), остальное - обычно', () => {
  const card = { number: '2200123412341234', holder: 'IVAN', customFields: [{ name: 'Код', value: '4455' }] };
  assert.equal(copyNeedsGuard('cards', card, '2200123412341234'), true, 'номер карты');
  assert.equal(copyNeedsGuard('cards', card, '4455'), true, 'произвольное поле');
  assert.equal(copyNeedsGuard('cards', card, 'IVAN'), false, 'имя владельца - обычное');
  assert.equal(copyNeedsGuard('passwords', { login: 'me', customFields: [{ value: 'PIN-1' }] }, 'PIN-1'), true);
  assert.equal(copyNeedsGuard('passwords', { login: 'me' }, 'me'), false);
  assert.equal(copyNeedsGuard('documents', { number: '4510 123456' }, '4510 123456'), false, 'номер документа - не карта');
  assert.match(APP, /onCopyPlain: \(v\) => \(copyNeedsGuard\(section, entry, v\) \? copySecret\(v\) : copyPlain\(v\)\),/);
  assert.match(APP, /UI\.renderEntryCard\(current, entry, handlers\(current, entry\)\)/);
  assert.match(APP, /UI\.renderEntryCard\(section, entry, handlers\(section, entry\)\)/);
});

// ---------------- B5 ----------------
test('B5: поля-секреты в редакторе - type=password + глаз; секреты и произвольные поля без автоисправления/словаря', () => {
  assert.deepEqual(SECRET_INPUT_ATTRS, { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' });
  assert.equal(editorInputType('secret'), 'password');
  assert.equal(editorInputType('text'), null);
  assert.equal(editorInputType('textarea'), null);
  assert.ok(!/if \(f\.type === 'secret'\) input\.type = 'text';/.test(APP), 'секрет больше не type=text');
  assert.match(APP, /if \(f\.type === 'secret'\) \{ input\.type = editorInputType\(f\.type\); input\.dataset\.secret = '1'; applySecretAttrs\(input\); \}/);
  assert.match(APP, /const holder = f\.type === 'secret' \? wrapSecretInput\(input\) : input;/);
  assert.match(APP, /for \(const inp of form\.querySelectorAll\('\[data-secret="1"\]'\)\) applySecretAttrs\(inp\);/, 'после wireFieldInputs');
  assert.match(APP, /for \(const inp of r\.querySelectorAll\('input'\)\) applySecretAttrs\(inp\);/, 'произвольные поля');
});

// ---------------- B6 ----------------
test('B6/poc#3: tel: в ссылке - только через telHref (USSD *21*...# не проходит), mailto с «?» отвергается', () => {
  assert.equal(openableHref('tel:*21*+79990000000#'), 'tel:2179990000000', 'звёздочки/решётки вырезаны');
  assert.ok(!/[*#]/.test(openableHref('tel:**62*+7999%23')));
  assert.equal(telHref('+7999;ext=1'), 'tel:+7999', 'хвост после ; не приклеивается к номеру');
  assert.equal(mailtoHref('a@b.com?bcc=x@evil.com'), null);
  assert.equal(mailtoHref('a@b.com?body=hello.ru'), null);
  assert.equal(mailtoHref('a@b.com?subject=x&cc=victim%40mail.ru&body=Pay.now'), null);
  assert.equal(mailtoHref('a@b.com'), 'mailto:a@b.com');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///sdcard', ' javascript:x']) assert.equal(openableHref(bad), null, bad);
});

test('B6/poc#4: битая %-последовательность в QR не бросает (сканер не зависает); digits/period ограничены; ключ >= 16', () => {
  const r = parseOtpauth('otpauth://totp/%E0%A4%A?secret=JBSWY3DPEHPK3PXP');
  assert.equal(r.ok, true);
  const q = parseOtpauth('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=99999999&digits=999');
  assert.equal(q.digits, 6); assert.equal(q.period, 30);
  assert.equal(safeDigits(8), 8); assert.equal(safeDigits(9), 6); assert.equal(safeDigits(5), 6);
  assert.equal(safePeriod(60), 60); assert.equal(safePeriod(5), 30); assert.equal(safePeriod(301), 30);
  assert.equal(parseOtpauth('otpauth://totp/x?secret=JBSWY3DP').ok, false, '8 символов - слишком короткий');
  assert.equal(secretLongEnough('JBSW Y3DP EHPK 3PXP'), true);
  assert.equal(secretLongEnough('JBSWY3DPEHPK3PX'), false);
  assert.match(APP, /if \(!secretLongEnough\(raw\)\)/, 'редактор тоже проверяет длину ключа');
  assert.match(APP, /try \{ parsed = parseOtpauth\(text\); \}/, 'разбор в сканере - в try/catch');
});

test('B6: «О приложении» описывает фактический автоблок; id записи в селекторе экранируется (CSS.escape)', () => {
  assert.ok(!/Сейф запирается сам при уходе в фон\./.test(APP), 'старый неверный текст');
  assert.match(APP, /после 5 минут без действий/);
  assert.match(APP, /\.totp-entry\[data-id="\$\{cssId\(entry\.id\)\}"\]/);
  assert.match(APP, /window\.CSS\.escape\(s\)/);
  assert.equal(linkLabel('@ivan'), 'Telegram');
});
