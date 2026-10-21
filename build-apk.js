#!/usr/bin/env node
// Сборка APK «Сейф» (режимы - по образцу «Хомяка», 1.3.0).
//
//   node build-apk.js                 тест: полный доступ + демо, debug-подпись → out/test/
//   node build-apk.js --release       релиз: демо и полный доступ выкл (free-гейт), свой ключ
//                                     keys/seyf.jks → out/store/
//   node build-apk.js --store         стор: релиз + SEYF_STORE=true (обновления ТОЛЬКО через
//                                     RuStore: update.js в сеть не ходит, boot.js не откатывается,
//                                     CSP connect-src 'none', MainActivity забывает скачанные
//                                     веб-сборки) → out/store/ и «Рабочий стол/Сейф-RuStore-публикация/»
//   node build-apk.js --store --app-id=<ID>
//                                     стор с боевым console_app_id RuStore: id вписывается ОДНОЙ
//                                     командой в оба места (www/js/pay-config.js и strings.xml).
//                                     Без id (заглушка) стор-сборка = ЧЕРНОВИК: собирается, но
//                                     лежит с пометкой «ЧЕРНОВИК-без-app-id» и громким предупреждением.
//   --version-code=N                  пересборка той же (ещё не опубликованной) версии с кодом выше
//                                     прежнего файла; только релиз/стор, окно (код версии, код след. патча)
//   (то же через env: SEYF_RELEASE=1 / SEYF_STORE=1 / SEYF_APP_ID=<ID> / SEYF_VERSION_CODE=N; store подразумевает release)
//
// Флаги вшиваются в ЧИСТУЮ КОПИЮ www (build/www-ship, build-lib.js makeShip), а не в рабочую
// www/: www/buildflags.js в репозитории всегда false (браузер/OTA/коммит не раздают Pro).
// Тест-канал OTA (build-ota.js --full, seyf-store) этот скрипт не трогает.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as L from './build-lib.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ANDROID = path.join(ROOT, 'android');
const ARGV = process.argv.slice(2);
const MODE = L.buildMode(process.env, ARGV);
const RELEASE = MODE.release;
const WWW = path.join(ROOT, 'www');
const WWW_SHIP = path.join(ROOT, 'build', 'www-ship');
const CAP_CFG = path.join(ROOT, 'capacitor.config.json');
const OUT_DIR = path.join(ROOT, 'out', RELEASE ? 'store' : 'test');
const GRADLE = path.join(ANDROID, 'app', 'build.gradle');
const PKG = path.join(ROOT, 'package.json');
const KEY_PROPS = path.join(ROOT, 'keys', 'seyf.properties');
const KEY_STORE = path.join(ROOT, 'keys', 'seyf.jks');
const PAY_CONFIG = path.join(WWW, 'js', 'pay-config.js');
const STRINGS_XML = path.join(ANDROID, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const DESKTOP_ROOT = path.join(os.homedir(), 'OneDrive', 'Рабочий стол');
// Финальная стор-сборка - в папку публикации (как «Хомяк-RuStore-публикация»); черновик - на стол.
const STORE_DIR = path.join(DESKTOP_ROOT, 'Сейф-RuStore-публикация');

function die(m) { console.error('\n[ОШИБКА] ' + m + '\n'); process.exit(1); }
function say(m) { console.log(m); }
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: true }, opts || {}));
  if (r.error) return { ok: false, why: r.error.message };
  if (r.status !== 0) return { ok: false, why: 'код возврата ' + r.status };
  return { ok: true };
}

// --- console_app_id RuStore: одно значение в двух местах ---
const APP_ID_ARG = L.parseAppIdArg(ARGV, process.env);
let APP_ID;
try {
  if (APP_ID_ARG !== null) {
    if (!RELEASE) die('--app-id имеет смысл только для --store (или --release): в тест-сборке оплата - заглушка.');
    APP_ID = L.stampAppIdFiles(PAY_CONFIG, STRINGS_XML, APP_ID_ARG);
  } else {
    APP_ID = L.readAppIdFiles(PAY_CONFIG, STRINGS_XML);
  }
} catch (e) { die(e.message); }
if (!APP_ID.synced) {
  die('console_app_id разъехался: www/js/pay-config.js = ' + JSON.stringify(APP_ID.js) +
    ', strings.xml = ' + JSON.stringify(APP_ID.xml) + '.\nВпиши один id в оба места: node build-apk.js --store --app-id=<ID>');
}
// стор без боевого id - ЧЕРНОВИК: оплата на устройстве ответит «не сконфигурирована»
const DRAFT = MODE.store && APP_ID.placeholder;
function draftBanner() {
  console.warn(
    '\n##########################################################################\n' +
    '###  ЧЕРНОВИК: console_app_id - ЗАГЛУШКА, оплата НЕ сконфигурирована.   ###\n' +
    '###  На модерацию RuStore такой APK НЕ отправлять.                      ###\n' +
    '###  Финал: node build-apk.js --store --app-id=<ID из Консоли RuStore>   ###\n' +
    '##########################################################################\n');
}

// --- окружение ---
const javaHome = process.env.JAVA_HOME;
if (!javaHome || !fs.existsSync(path.join(javaHome, 'bin', 'java.exe'))) {
  die('не найдена Java (JAVA_HOME) - JDK 17. Настройка - как у «Хомяка», см. Homyak/README-сборка.md.');
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk || !fs.existsSync(sdk)) die('не найден Android SDK (ANDROID_HOME). См. Homyak/README-сборка.md.');
if (!fs.existsSync(path.join(sdk, 'platforms', 'android-34'))) {
  die('нет platforms;android-34. Установи: sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" и прими лицензии.');
}
if (!fs.existsSync(ANDROID)) die('нет папки android/. Сначала: npx cap add android');

if (MODE.store) say('Режим: СТОР (релиз + обновления только через RuStore, своя сеть закрыта) → out/store/');
else if (RELEASE) say('Режим: РЕЛИЗ (демо и полный доступ выключены, free-гейт) → out/store/');
else console.warn('\n=== ТЕСТ-СБОРКА: полный доступ + демо, debug-подпись. НЕ отдавать клиентам и не в стор ===\n' +
  '=== Релиз: node build-apk.js --release   Стор: node build-apk.js --store               ===\n');

// ЗАСЛОН ПОДПИСИ (корень «пакет повреждён»): релиз/стор обязан идти под СТАБИЛЬНЫМ ключом
// keys/seyf.jks. Debug-ключ свой на каждой машине; APK на другом ключе поверх установленного
// Android не ставит («пакет повреждён»), а RuStore не примет обновление. Проверяем ДО сборки.
const hasKey = RELEASE && fs.existsSync(KEY_PROPS) && fs.existsSync(KEY_STORE);
if (RELEASE && !hasKey) {
  die('релиз без своего ключа подписи запрещён (корень «пакет повреждён»).\n' +
    'Нужны keys/seyf.jks и keys/seyf.properties (storeFile/storePassword/keyAlias/keyPassword).\n' +
    'Ключ генерируется ОДИН раз и хранится вне git (см. keys/README.txt). Потерян - восстанови из копии.\n' +
    'Отладочную сборку для себя делай без --release: node build-apk.js (уедет в out/test/).');
}

// --- версия: один источник - package.json ---
const version = L.readVersion(PKG);
let code;
try { code = L.resolveVersionCode(version, RELEASE, ARGV, process.env); } catch (e) { die(e.message); }
L.stampWeb(WWW, version);
let g = fs.readFileSync(GRADLE, 'utf8');
g = g.replace(/versionCode\s+\d+/, 'versionCode ' + code)
     .replace(/versionName\s+"[^"]*"/, 'versionName "' + version + '"');
if (g.indexOf('versionName "' + version + '"') < 0) die('не нашёл versionCode/versionName в ' + GRADLE);
fs.writeFileSync(GRADLE, g);
say('Версия: ' + version + ' (versionCode ' + code + ')');
if (RELEASE) {
  say('console_app_id: ' + (APP_ID.placeholder ? 'ЗАГЛУШКА (оплата не сконфигурирована)' : APP_ID.id) +
    ' - одинаков в pay-config.js и strings.xml');
}
if (DRAFT) draftBanner();

// --- чистая копия www с флагами режима ---
say('\n[1/3] Готовлю чистую копию www (build/www-ship) и переношу в Android-проект (cap sync)...');
let shipFiles;
try { shipFiles = L.makeShip(WWW, WWW_SHIP, MODE, version); } catch (e) { die(e.message); }
say('  buildflags.js: ' + L.flagsSource(MODE).split('\n').filter((l) => l.startsWith('window.')).join(' '));
if (RELEASE) say('  js/demo.js: DEMO_ENABLED = false (в копии; исходник не тронут)');
if (MODE.store) say("  index.html: CSP connect-src 'none' (сеть закрыта)");
say('  files.json: ' + shipFiles.length + ' файлов');

// cap sync берёт папку из webDir: на время сборки подменяем её на чистую копию и возвращаем
// как было в любом случае, даже если что-то упадёт.
const cfgBackup = fs.readFileSync(CAP_CFG, 'utf8');
let restored = false;
function restoreCfg() {
  if (restored) return;
  restored = true;
  try { fs.writeFileSync(CAP_CFG, cfgBackup); } catch (e) { /* ничего не поделать */ }
}
process.on('exit', restoreCfg);
process.on('SIGINT', () => { restoreCfg(); process.exit(1); });
const cfg = JSON.parse(cfgBackup);
cfg.webDir = 'build/www-ship';
fs.writeFileSync(CAP_CFG, JSON.stringify(cfg, null, 2) + '\n');
let r = run('npx', ['cap', 'sync', 'android'], { cwd: ROOT });
restoreCfg();
if (!r.ok) die('не прошёл "npx cap sync android" (' + r.why + ').');

// --- gradle ---
const task = hasKey ? 'assembleRelease' : 'assembleDebug';
const APK_SRC = hasKey
  ? path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  : path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
// -PseyfStore=true → ресурс bool/seyf_store: стор-оболочка на старте забывает путь к скачанной
// веб-сборке и всегда грузит встроенную (MainActivity) - заслон от самоподмены кода.
const gradleArgs = [task, '-PseyfStore=' + (MODE.store ? 'true' : 'false')];
say('\n[2/3] gradlew ' + gradleArgs.join(' ') + ' (первый раз долго - Gradle качает себя)...');
r = run('"' + path.join(ANDROID, 'gradlew.bat') + '"', gradleArgs, { cwd: ANDROID });
if (!r.ok) die('сборка Gradle упала (' + r.why + '). Смотри ошибку выше.');
if (!fs.existsSync(APK_SRC)) die('Gradle отработал, но APK не найден: ' + APK_SRC);

// --- самопроверка APK: что вшито, то и лежит в файле ---
if (RELEASE) {
  try {
    const chk = L.verifyApk(fs.readFileSync(APK_SRC), { release: true, store: MODE.store, appId: APP_ID.js }, WWW);
    say('Самопроверка APK: ' + chk.flags.join(' ') + '; pay-config.js id = ' + chk.jsId +
      ', resources.arsc содержит его же (' + chk.arscEnc + '); ассетов ' + chk.assets + '.');
  } catch (e) { die('самопроверка APK не прошла: ' + e.message); }
}

// --- копии ---
say('\n[3/3] Раскладываю готовый файл...');
fs.mkdirSync(OUT_DIR, { recursive: true });
const outName = 'seyf-' + version + (MODE.store ? '-store' : '') + (DRAFT ? '-draft' : '') + '.apk';
const outApk = path.join(OUT_DIR, outName);
fs.copyFileSync(APK_SRC, outApk);
fs.copyFileSync(APK_SRC, path.join(OUT_DIR, MODE.store ? 'Seyf-store.apk' : 'Seyf.apk'));
let desk = null;
try {
  if (MODE.store) {
    // финал - в папку публикации RuStore; черновик (без app-id) - отдельно на стол, не спутать
    const draft = path.join(DESKTOP_ROOT, 'Сейф-' + version + '-ЧЕРНОВИК-без-app-id.apk');
    if (DRAFT) {
      desk = draft;
    } else {
      fs.mkdirSync(STORE_DIR, { recursive: true });
      desk = path.join(STORE_DIR, 'Сейф-' + version + '.apk');
      if (fs.existsSync(draft)) { fs.unlinkSync(draft); say('  убрал черновик: ' + draft); }
    }
    fs.copyFileSync(APK_SRC, desk);
  } else {
    desk = path.join(DESKTOP_ROOT, 'Seyf.apk');
    fs.copyFileSync(APK_SRC, desk);
  }
} catch (e) { desk = null; console.warn('  ! не смог положить копию на рабочий стол: ' + e.message); }

const size = (fs.statSync(outApk).size / 1024 / 1024).toFixed(2);
say('\nГотово. APK ' + size + ' МБ\n  ' + outApk + (desk ? '\n  ' + desk : ''));
if (DRAFT) draftBanner();
else if (MODE.store) say('\nДальше: этот APK - в Консоль RuStore. Напрямую клиентам его не отдавать.');
if (!RELEASE) console.warn('=== ТЕСТ-СБОРКА: для себя на проверку, не в стор ===');

// --- уборка out/: последние 3 версии APK/zip, остальное - прочь ---------------------
// Только здесь, в самом конце успешной сборки: при любой осечке выше die() уже вышел.
// Алиасы без версии, манифесты и всё, на что они ссылаются (published.json = опубликованное
// на канале), не трогаются (build-lib.js).
try {
  const gone = L.pruneOldVersions(OUT_DIR, 3);
  say('Уборка ' + path.relative(ROOT, OUT_DIR).split(path.sep).join('/') + '/: ' + (gone.length ? 'удалены старые версии - ' + gone.join(', ') : 'старше последних 3 версий ничего нет'));
} catch (e) {
  // e.removed - что уборка успела удалить до осечки: «пропущена» при удалённых файлах врёт
  console.warn('  ! уборка старых версий ' + (e.removed && e.removed.length
    ? 'прервана, уже удалены: ' + e.removed.join(', ') + '. Причина: ' : 'пропущена, ничего не удалено: ') + e.message);
}
