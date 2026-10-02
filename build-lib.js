// build-lib.js — чистые хелперы сборки «Сейфа». Номер версии живёт в ОДНОМ месте
// (package.json) и растекается отсюда в www/version.js и android/app/build.gradle.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

export function readVersion(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const v = String(pkg.version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) {
    throw new Error('version в package.json должна быть вида X.Y.Z, а не «' + v + '»');
  }
  return v;
}

// minShell — МИНИМАЛЬНАЯ версия нативной оболочки (APK), на которой оживёт текущий веб-бандл.
// Это НЕ «последняя доступная оболочка»: пока правки чисто веб-слоя (темы/разделы/иконки),
// minShell остаётся на базовой оболочке и обновление приезжает БЕСШОВНО (кнопкой), без
// переустановки APK. Поднимать minShell только когда веб-бандл реально начал требовать
// нового нативного кода (новый Capacitor-плагин, новое разрешение и т.п.). Живёт в ОДНОМ
// месте — package.json.minShell; нет поля — базовая '1.0.0' (не номер последнего APK, иначе
// каждый веб-релиз ошибочно форсит установку APK на старых оболочках).
export function readMinShell(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const v = String(pkg.minShell || '1.0.0').trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) {
    throw new Error('minShell в package.json должна быть вида X.Y.Z, а не «' + v + '»');
  }
  return v;
}

// versionCode = (major*10000 + minor*100 + patch)*2 + бит типа сборки (1 — релиз, 0 — тест).
// Тест и релиз одной версии — разный код, ряд релиза монотонно растёт: Capacitor тогда
// считает переустановку новым бинарём и не тащит старый сохранённый путь (как в «Хомяке»).
export function versionCodeOf(v, isRelease) {
  const [ma, mi, pa] = v.split('.').map(Number);
  return (ma * 10000 + mi * 100 + pa) * 2 + (isRelease ? 1 : 0);
}

// Пересборка той же версии, ещё не ушедшей в стор, с кодом выше прежнего файла (чтобы два APK
// одной версии не путались). Только релиз/стор и только строго между кодом этой версии и
// релизным кодом следующего патча: ряд релизов остаётся монотонным, 1.3.2 всё равно будет выше.
// argv: --version-code=N (или env SEYF_VERSION_CODE). Без флага - обычный versionCodeOf.
export function resolveVersionCode(v, isRelease, argv = [], env = {}) {
  const base = versionCodeOf(v, isRelease);
  let raw = null;
  for (const a of argv.map(String)) if (a.startsWith('--version-code=')) raw = a.slice('--version-code='.length).trim();
  if (raw === null && env.SEYF_VERSION_CODE != null) raw = String(env.SEYF_VERSION_CODE).trim();
  if (raw === null || raw === '') return base;
  if (!isRelease) throw new Error('--version-code только для --release/--store');
  if (!/^\d+$/.test(raw)) throw new Error('--version-code должен быть целым числом, а не «' + raw + '»');
  const n = Number(raw);
  const [ma, mi, pa] = v.split('.').map(Number);
  const ceil = versionCodeOf(ma + '.' + mi + '.' + (pa + 1), true);
  if (!(n > base && n < ceil)) {
    throw new Error('--version-code=' + n + ' вне окна (' + base + ', ' + ceil + '): должен быть выше кода ' + v +
      ' и ниже релизного кода следующего патча');
  }
  return n;
}

// ---------- хелперы OTA-сборки (build-ota.js) ----------

// Все файлы папки как относительные пути через «/», по алфавиту (для files.json/zip).
export function listWww(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...listWww(root, r));
    else out.push(r);
  }
  return out.sort();
}

export function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// version.js — единственный источник номера версии на стороне приложения.
export function stampWeb(www, v) {
  fs.writeFileSync(path.join(www, 'version.js'),
    "/* version.js — ГЕНЕРИРУЕТСЯ сборкой из package.json. Руками не правь. */\nwindow.APP_VERSION = '" + v + "';\n");
}

// ---------- САМОПРОВЕРКА OTA-бандла (заслон от повтора «пакет повреждён») ----------
// После сборки zip прогоняем его через ТУ ЖЕ логику, что и клиент на устройстве:
//   1) sha256(zip) == sha в манифесте        (как fetchBundle: сверка целостности);
//   2) размер zip <= MAX_ZIP                  (как fetchBundle);
//   3) Update.unpack(zip, fflate)             (тот самый fflate.unzipSync + safeName +
//      MAX_FILE/MAX_RAW + требование index.html — код клиента, а не его копия);
//   4) внутри есть ключевые файлы приложения (index.html + опорные js).
// Не прошло — бросаем ошибку, и вызывающий (build-ota.js) останавливает публикацию, а не
// выкладывает битьё. «Та же логика» гарантирована тем, что грузим НАСТОЯЩИЕ www/update.js и
// www/vendor/fflate.min.js — если клиент отвергнет бандл, отвергнет и самопроверка.
// Загрузка UMD-модуля клиента в песочнице vm (пакет type:module — require() сломал бы UMD;
// ветка module.exports = factory() отдаёт чистый объект без window).
function loadUMD(file) {
  const code = fs.readFileSync(file, 'utf8');
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, self: {}, globalThis, console });
  return mod.exports;
}

// Обязательный минимум внутри бандла: без них приложение не оживёт на устройстве.
const CORE_IN_BUNDLE = ['index.html', 'boot.js', 'update.js', 'js/app.js', 'js/crypto.js', 'vendor/fflate.min.js'];

export function selfCheckZip(zipBuf, expectedSha, wwwDir) {
  const Update = loadUMD(path.join(wwwDir, 'update.js'));
  const fflate = loadUMD(path.join(wwwDir, 'vendor', 'fflate.min.js'));
  if (!fflate || typeof fflate.unzipSync !== 'function') {
    throw new Error('самопроверка: не загрузился www/vendor/fflate.min.js (нет unzipSync)');
  }
  const zip = Buffer.isBuffer(zipBuf) ? zipBuf : Buffer.from(zipBuf);
  // 1) целостность — ровно как клиентский fetchBundle (sameHash: без регистра/пробелов)
  const sha = sha256hex(zip);
  if (!Update.sameHash(sha, expectedSha)) {
    throw new Error('самопроверка: sha256 бандла (' + sha + ') != sha в манифесте (' + expectedSha + ')');
  }
  // 2) предел на сжатый размер — как клиент (parseWeb/fetchBundle)
  if (zip.length > Update.MAX_ZIP) {
    throw new Error('самопроверка: zip больше MAX_ZIP (' + zip.length + ' > ' + Update.MAX_ZIP + ')');
  }
  // 3) распаковка кодом клиента: fflate.unzipSync + safeName + MAX_FILE/MAX_RAW + index.html.
  //    Update.unpack бросает ту же ошибку (ERR_ZIP/ERR_BIG), что увидел бы хозяин телефона.
  let files;
  try {
    files = Update.unpack(new Uint8Array(zip), fflate);
  } catch (e) {
    throw new Error('самопроверка: клиентский unpack отверг бандл: ' + (e && e.message ? e.message : e));
  }
  // 4) ключевые файлы на месте
  const missing = CORE_IN_BUNDLE.filter((n) => !files[n]);
  if (missing.length) {
    throw new Error('самопроверка: в бандле нет обязательных файлов: ' + missing.join(', '));
  }
  return { files: Object.keys(files).length, sha };
}

// ---- подпись OTA-манифеста (1.2.23, D2/D5) ----
// Подписать манифест приватным ключом (tools/ota-sign-key.json: { privateJwk, publicRawB64 }).
// Каноническая строка - ТОЙ ЖЕ функцией клиента (www/update.js manifestSigData), чтобы сборка и
// телефон не разошлись в формате. Возвращает base64url подписи (64 байта r||s).
export async function signManifest(manifest, keyJson, wwwDir) {
  const Update = loadUMD(path.join(wwwDir, 'update.js'));
  const subtle = crypto.webcrypto.subtle;
  if (!keyJson || !keyJson.privateJwk) throw new Error('в ключе подписи нет privateJwk');
  const data = await Update.manifestSigData(manifest, { subtle });
  if (data == null) throw new Error('манифест не приводится к канонической строке (перевод строки в поле?)');
  const priv = await subtle.importKey('jwk', keyJson.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode(data)));
  return Buffer.from(sig).toString('base64url');
}

// Самопроверка подписи КОДОМ КЛИЕНТА (D5): www/update.js verifyManifest с ВШИТЫМ публичным ключом.
// Не сошлось (ключ сборки не совпадает с ключом в update.js, поле испорчено) - бросаем.
export async function selfCheckManifestSig(manifest, wwwDir) {
  const Update = loadUMD(path.join(wwwDir, 'update.js'));
  const ok = await Update.verifyManifest(manifest);
  if (!ok) throw new Error('самопроверка: подпись манифеста НЕ принимается клиентом (ключ в www/update.js не от этого приватного ключа или манифест испорчен)');
  return true;
}

// «Что нового» для канала — верхний раздел CHANGELOG.md (## ...). Нет файла — пусто.
export function topNotes(changelogPath) {
  if (!fs.existsSync(changelogPath)) return '';
  const txt = fs.readFileSync(changelogPath, 'utf8');
  const m = txt.match(/^##\s+.*$/m);
  if (!m) return '';
  const rest = txt.slice(m.index + m[0].length);
  const end = rest.search(/^##\s+/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

// ======================= 1.3.0: режимы сборки APK (по образцу «Хомяка») =======================
// Тест / релиз / стор. Флаги доступа вшиваются в ЧИСТУЮ КОПИЮ www (build/www-ship), из которой
// собирается APK; рабочая www/ не трогается (www/buildflags.js в репозитории всегда false -
// tests/freemium-gate.test.mjs). CSP «Сейфа» запрещает инлайн-скрипты (script-src 'self'),
// поэтому флаги едут не тегом <script> в index.html, как у «Хомяка», а файлом buildflags.js.

// --store / SEYF_STORE=1 → стор (+релиз); --release / SEYF_RELEASE=1 → релиз; иначе тест.
export function buildMode(env = {}, argv = []) {
  const on = (v) => !!v && v !== '0' && v !== 'false' && v !== '';
  const store = on(env.SEYF_STORE) || argv.includes('--store');
  const release = store || on(env.SEYF_RELEASE) || argv.includes('--release');
  return { release, store };
}

// Содержимое buildflags.js для режима:
//   тест   → SEYF_FULL_ACCESS=true (демо/QA без упора в лимиты), демо первого запуска включено;
//   релиз  → SEYF_FULL_ACCESS=false, SEYF_DEMO=false (сразу создание мастер-пароля, free-гейт);
//   стор   → то же + SEYF_STORE=true (обновления только через RuStore, update.js в сеть не ходит).
export function flagsSource(mode = {}) {
  const store = !!mode.store;
  const release = !!mode.release || store;
  let body = 'window.SEYF_FULL_ACCESS = ' + (release ? 'false' : 'true') + ';\n';
  if (release) body += 'window.SEYF_DEMO = false;\n';
  if (store) body += 'window.SEYF_STORE = true;\n';
  return '/* buildflags.js - ГЕНЕРИРУЕТСЯ сборкой (как version.js). Руками не правь. */\n' + body;
}

// Отладочный балласт, которому в APK делать нечего: исходники иконок (_orig, в .gitignore) и
// dot-файлы (.gitignore и т.п.; их и так отсеивает aapt, но files.json не должен их называть).
export const SHIP_SKIP = ['_orig'];

function copyClean(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SHIP_SKIP.includes(e.name)) continue;
    const src = path.join(from, e.name), dst = path.join(to, e.name);
    if (e.isDirectory()) copyClean(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

// Демо в релизе выключаем ДВАЖДЫ: флагом SEYF_DEMO=false (access.js DEMO) и штампом исходника
// в КОПИИ (js/demo.js DEMO_ENABLED=false). Исходник www/js/demo.js не трогаем (тест-канал).
export const DEMO_MARK_ON = 'export const DEMO_ENABLED = true;';
export const DEMO_MARK_OFF = 'export const DEMO_ENABLED = false;';
export function stampDemoOff(src) {
  if (src.includes(DEMO_MARK_OFF) && !src.includes(DEMO_MARK_ON)) return src;
  if (src.split(DEMO_MARK_ON).length !== 2) throw new Error('в js/demo.js нет ровно одной строки «' + DEMO_MARK_ON + '» - некуда выключить демо, сборка остановлена');
  return src.replace(DEMO_MARK_ON, DEMO_MARK_OFF);
}

// Стор: CSP connect-src 'none' - update.js и так в сеть не ходит, а браузер не выпустит наружу
// даже случайный fetch. Маркер не найден - сборка падает, а не молчит.
export const CSP_CONNECT_OTA = 'connect-src https://dorokhin-finance.ru';
export const CSP_CONNECT_NONE = "connect-src 'none'";
const CSP_META_RE = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/g;
// Содержимое CSP из index.html (ровно один мета-тег) или бросает.
export function cspOf(html) {
  const all = [...String(html).matchAll(CSP_META_RE)];
  if (all.length !== 1) throw new Error('в index.html должен быть ровно один мета-тег CSP, найдено: ' + all.length);
  return all[0][2];
}
export function shipCsp(html) {
  const csp = cspOf(html);
  if (csp.split(CSP_CONNECT_OTA).length !== 2) throw new Error('в CSP index.html нет ровно одного «' + CSP_CONNECT_OTA + '» - некуда закрыть сеть для стора');
  return String(html).replace(CSP_META_RE, (m, a, c, z) => a + c.replace(CSP_CONNECT_OTA, CSP_CONNECT_NONE) + z);
}

// Чистая копия www под APK (www → ship): флаги режима в buildflags.js, для релиза/стора демо
// выключено, для стора сеть закрыта CSP; files.json - опись именно отгружаемых файлов.
export function makeShip(www, ship, mode = {}, version) {
  fs.rmSync(ship, { recursive: true, force: true });
  copyClean(www, ship);
  const release = !!mode.release || !!mode.store;
  fs.writeFileSync(path.join(ship, 'buildflags.js'), flagsSource(mode));
  if (release) {
    const demo = path.join(ship, 'js', 'demo.js');
    fs.writeFileSync(demo, stampDemoOff(fs.readFileSync(demo, 'utf8')));
  }
  if (mode.store) {
    const idx = path.join(ship, 'index.html');
    fs.writeFileSync(idx, shipCsp(fs.readFileSync(idx, 'utf8')));
  }
  const files = listWww(ship).filter((f) => f !== 'files.json');
  files.push('files.json'); files.sort();
  fs.writeFileSync(path.join(ship, 'files.json'), JSON.stringify({ version: version || '', files }, null, 2) + '\n');
  return files;
}

// ---------- console_app_id RuStore: одна команда вшивает id в ОБА места ----------
// JS читает www/js/pay-config.js (export const CONSOLE_APP_ID), нативный Pay SDK -
// android/app/src/main/res/values/strings.xml (rustore_console_app_id → meta-data
// console_app_id_value в AndroidManifest; RuStorePayPlugin.consoleAppId читает ту же строку).
// `node build-apk.js --store --app-id=<ID>` переписывает оба; рассинхрон - сборка падает.
export const APP_ID_PLACEHOLDER = 'РАЗМЕСТИТЬ_APP_ID_ИЗ_RUSTORE_CONSOLE';
const APP_ID_RE = /^[0-9]{3,20}$/;
export function validAppId(id) { return APP_ID_RE.test(String(id == null ? '' : id)); }

// --app-id=123 / --app-id 123 / env SEYF_APP_ID. null - аргумента нет.
export function parseAppIdArg(argv = [], env = {}) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a.startsWith('--app-id=')) return a.slice('--app-id='.length).trim();
    if (a === '--app-id') return String(argv[i + 1] == null ? '' : argv[i + 1]).trim();
  }
  if (env.SEYF_APP_ID != null) return String(env.SEYF_APP_ID).trim();
  return null;
}

const JS_ID_RE = /export const CONSOLE_APP_ID = (PLACEHOLDER|'[^']*');/;
const XML_ID_RE = /(<string name="rustore_console_app_id">)([^<]*)(<\/string>)/;
export function readAppIdJs(text) {
  const m = String(text).match(JS_ID_RE);
  if (!m) throw new Error('в pay-config.js не найдено «export const CONSOLE_APP_ID = ...;»');
  return m[1] === 'PLACEHOLDER' ? APP_ID_PLACEHOLDER : m[1].slice(1, -1);
}
export function readAppIdXml(text) {
  const m = String(text).match(XML_ID_RE);
  if (!m) throw new Error('в strings.xml не найдена строка rustore_console_app_id');
  return m[2].trim();
}
export function stampAppIdJs(text, id) {
  if (!JS_ID_RE.test(text)) throw new Error('в pay-config.js не найдено поле CONSOLE_APP_ID');
  return String(text).replace(JS_ID_RE, "export const CONSOLE_APP_ID = '" + id + "';");
}
export function stampAppIdXml(text, id) {
  if (!XML_ID_RE.test(text)) throw new Error('в strings.xml не найдена строка rustore_console_app_id');
  return String(text).replace(XML_ID_RE, '$1' + id + '$3');
}
export function appIdState(jsText, xmlText) {
  const js = readAppIdJs(jsText), xml = readAppIdXml(xmlText);
  const synced = js === xml;
  const placeholder = !validAppId(js) || !validAppId(xml);
  return { js, xml, synced, placeholder, id: synced && !placeholder ? js : null };
}
export function readAppIdFiles(payConfigPath, stringsXmlPath) {
  return appIdState(fs.readFileSync(payConfigPath, 'utf8'), fs.readFileSync(stringsXmlPath, 'utf8'));
}
export function stampAppIdFiles(payConfigPath, stringsXmlPath, id) {
  if (!validAppId(id)) {
    throw new Error('console_app_id должен состоять только из цифр (3-20 знаков), а передано: ' +
      JSON.stringify(id) + '. Взять из адреса https://console.rustore.ru/apps/<ID>/versions');
  }
  const js = stampAppIdJs(fs.readFileSync(payConfigPath, 'utf8'), id);
  const xml = stampAppIdXml(fs.readFileSync(stringsXmlPath, 'utf8'), id);
  fs.writeFileSync(payConfigPath, js, 'utf8');
  fs.writeFileSync(stringsXmlPath, xml, 'utf8');
  return readAppIdFiles(payConfigPath, stringsXmlPath);
}

// ---------- самопроверка собранного APK: что вшито - то и лежит в файле ----------
// Читает APK как zip (fflate клиента, www/vendor/fflate.min.js) и проверяет ассеты:
//   buildflags.js несёт флаги режима (релиз: FULL=false + DEMO=false; стор: + STORE=true);
//   в релизе js/demo.js DEMO_ENABLED=false; в сторе CSP connect-src 'none'; pay-config.js
//   несёт тот же id, что и resources.arsc (strings.xml).
// Нарушение - бросает (build-apk.js не раскладывает такой файл).
export function verifyApk(apkBuf, opts = {}, wwwDir) {
  const fflate = loadUMD(path.join(wwwDir, 'vendor', 'fflate.min.js'));
  if (!fflate || typeof fflate.unzipSync !== 'function') throw new Error('не загрузился fflate для самопроверки APK');
  const want = (n) => n === 'resources.arsc' || n.startsWith('assets/public/');
  const files = fflate.unzipSync(new Uint8Array(apkBuf), { filter: (f) => want(f.name) });
  const txt = (n) => {
    if (!files[n]) throw new Error('в APK нет ' + n);
    return Buffer.from(files[n]).toString('utf8');
  };
  const flags = txt('assets/public/buildflags.js');
  const idx = txt('assets/public/index.html');
  const demo = txt('assets/public/js/demo.js');
  const release = !!opts.release || !!opts.store;
  const has = (re) => re.test(flags);
  if (release) {
    if (!has(/window\.SEYF_FULL_ACCESS = false;/) || has(/SEYF_FULL_ACCESS = true/)) throw new Error('в buildflags.js APK нет SEYF_FULL_ACCESS = false');
    if (!has(/window\.SEYF_DEMO = false;/)) throw new Error('в buildflags.js APK нет SEYF_DEMO = false');
    if (!demo.includes(DEMO_MARK_OFF) || demo.includes(DEMO_MARK_ON)) throw new Error('в js/demo.js APK демо не выключено');
  }
  if (opts.store) {
    if (!has(/window\.SEYF_STORE = true;/)) throw new Error('в buildflags.js APK нет SEYF_STORE = true');
    const csp = cspOf(idx);
    if (!csp.includes(CSP_CONNECT_NONE) || /connect-src[^;]*https?:/.test(csp)) throw new Error("в index.html APK CSP не закрыт (нет connect-src 'none')");
  } else if (has(/SEYF_STORE/)) {
    throw new Error('в не-сторовом APK оказался флаг SEYF_STORE');
  }
  const jsId = readAppIdJs(txt('assets/public/js/pay-config.js'));
  if (opts.appId != null && jsId !== String(opts.appId)) {
    throw new Error('в APK pay-config.js id ' + JSON.stringify(jsId) + ', а ожидался ' + JSON.stringify(opts.appId));
  }
  const arsc = Buffer.from(files['resources.arsc'] || []);
  if (!arsc.length) throw new Error('в APK нет resources.arsc');
  let arscEnc = null;
  if (arsc.indexOf(Buffer.from(jsId, 'utf8')) >= 0) arscEnc = 'utf8';
  else if (arsc.indexOf(Buffer.from(jsId, 'utf16le')) >= 0) arscEnc = 'utf16le';
  if (!arscEnc) throw new Error('в resources.arsc (strings.xml) нет id ' + JSON.stringify(jsId) + ' - JS и нативный SDK разъехались');
  return { flags: flags.split('\n').filter((l) => l.startsWith('window.')), jsId, arscEnc, assets: Object.keys(files).length - 1 };
}

// ---------- уборка out/: хранить последние N версий, не больше ----------
// Каждая сборка кладёт в out/<папка>/ файлы с версией в имени (<имя>-1.0.1.apk,
// www-1.0.1.zip), и без уборки они копятся сотнями мегабайт. Оставляем `keep` новейших
// в каждой группе «префикс + хвост + расширение» (homyak-*.apk, www-*.zip,
// homyak-*-кандидат.apk - разные группы). Новизна - по semver числами: 0.1.10 новее
// 0.1.9 (не по строке и не по mtime). Не удаляем НИКОГДА:
//   - файлы без версии в имени (алиасы последней сборки, update.json, last-apk.json,
//     published.json);
//   - то, на что ссылается published.json этой папки: его пишет publish-update.py
//     ТОЛЬКО после успешной заливки на канал, это и есть «что сейчас стоит у людей»,
//     даже если оно старше последних N (1.0.1 опубликован, потом собраны 1.0.2..1.0.4
//     без публикации - 1.0.1 живёт);
//   - то, на что ссылаются update.json / last-apk.json. ВНИМАНИЕ: это НЕ канал - сборка
//     переписывает их на себя ДО уборки, поэтому они защищают только текущую сборку
//     (в том числе когда она самая младшая версия в папке). Опубликованное защищает
//     только published.json;
//   - если любой из манифестов не читается - бросаем, не удалив ничего (лишний файл
//     лучше живого удалённого).
// Зовётся только в самом конце успешной сборки. Возвращает имена удалённых. Если удаление
// упало посередине, ошибка несёт e.removed - что уже удалено, вызывающий это печатает.
const VERSIONED_RE = /^(.+?)-(\d+)\.(\d+)\.(\d+)((?:-[^.]+)?)\.(apk|aab|zip)$/;
const OUT_MANIFESTS = ['update.json', 'last-apk.json', 'published.json'];

function cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}

// все имена файлов, упомянутые в манифестах папки (из URL берём последний сегмент)
function manifestRefs(dir) {
  const refs = new Set();
  OUT_MANIFESTS.forEach((m) => {
    const p = path.join(dir, m);
    if (!fs.existsSync(p)) return;
    let data;
    try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
      throw new Error('не читается ' + m + ' (' + e.message + ') - уборка отменена, ничего не удалено');
    }
    (function walk(v) {
      if (typeof v === 'string') {
        let name = v.split(/[?#]/)[0].split(/[\/]/).pop();
        try { name = decodeURIComponent(name); } catch (e) { /* как есть */ }
        refs.add(name);
      } else if (v && typeof v === 'object') {
        Object.keys(v).forEach((k) => walk(v[k]));
      }
    })(data);
  });
  return refs;
}

export function pruneOldVersions(dir, keep) {
  keep = keep == null ? 3 : keep;
  if (!fs.existsSync(dir)) return [];
  const refs = manifestRefs(dir);
  const groups = {};
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (!e.isFile()) return;
    const m = e.name.match(VERSIONED_RE);
    if (!m) return;
    const key = m[1] + '|' + m[5] + '|' + m[6];
    (groups[key] = groups[key] || []).push({ name: e.name, v: [+m[2], +m[3], +m[4]] });
  });
  const removed = [];
  try {
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => cmpSemver(b.v, a.v))
        .slice(keep)
        .forEach((f) => {
          if (refs.has(f.name)) return;
          fs.unlinkSync(path.join(dir, f.name));
          removed.push(f.name);
        });
    });
  } catch (e) {
    const err = new Error('удаление прервано (' + e.message + '); уже удалено: ' +
      (removed.length ? removed.slice().sort().join(', ') : 'ничего'));
    err.removed = removed.slice().sort();
    throw err;
  }
  return removed.sort();
}

// ---- атомарная запись в out/ (исправление по code-review 27.09.2026) ----
// Пишем во временный файл В ТОЙ ЖЕ папке и переименовываем: rename в пределах тома атомарен,
// поэтому в out/ никогда не лежит «полузаписанный» zip/манифест, который publish-update.py мог
// бы выложить. Упало посередине - временный файл удаляется, цель прежняя.
export function writeFileAtomic(file, data) {
  const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.tmp-' + process.pid);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* нечего убирать */ }
    throw e;
  }
}
