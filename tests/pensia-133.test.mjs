// pensia-133.test.mjs - улучшения по опыту «Честной пенсии» в 1.3.3 (TASKS «Улучшения по опыту…»):
//   своя заставка; крупный системный шрифт (textZoom = системный, fontScale в configChanges - смена
//   шрифта не пересоздаёт экран, html[data-fz] перестраивает витрину/меню); числа не рвутся (NBSP
//   только escape, нет «число пробел ₽»); одно число - одно место (лимит в окне покупки).
// Замеры вёрстки (NUMS_CHECK, ROWS_CHECK, меню на 360x640, шрифт 130/200%) - tools/qa-133-capture.mjs.
// Мутации: scratchpad/v133/mut-pensia.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fzLevel, fzScaleFrom, initFontZoom } from '../www/js/fontzoom.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const JAVA = (f) => read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', f);

// ---------------- заставка ----------------
test('заставка: стартовая тема - свой фон и эмблема, без белого; один цвет в теме, CSS и WebView', () => {
  const st = read('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  const launch = st.slice(st.indexOf('name="AppTheme.NoActionBarLaunch"'));
  assert.match(launch, /windowSplashScreenBackground">@color\/seyf_bg/);
  assert.match(launch, /windowSplashScreenAnimatedIcon">@drawable\/splash_icon/);
  assert.match(launch, /postSplashScreenTheme">@style\/AppTheme\.NoActionBar/);
  const col = read('android', 'app', 'src', 'main', 'res', 'values', 'colors_seyf.xml').match(/name="seyf_bg">(#[0-9A-Fa-f]{6})</)[1].toUpperCase();
  const css = read('www', 'css', 'app.css').match(/--bg:(#[0-9A-Fa-f]{6})/)[1].toUpperCase();
  assert.equal(col, css, 'цвет заставки = --bg тёмной темы');
  const cap = JSON.parse(read('capacitor.config.json'));
  assert.equal(String(cap.android.backgroundColor).toUpperCase(), col, 'WebView без белой вспышки');
});

test('заставка: splash.png во всех плотностях - фон приложения по краям, эмблема в центре; splash_icon x5', async () => {
  const files = [];
  for (const d of fs.readdirSync(RES)) { const f = path.join(RES, d, 'splash.png'); if (fs.existsSync(f)) files.push(f); }
  assert.ok(files.length >= 11, 'все плотности/ориентации');
  for (const f of files) {
    const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    assert.deepEqual(px(1, 1), [0x0F, 0x1F, 0x24], f + ': угол - фон приложения, не белый');
    const c = px(info.width >> 1, info.height >> 1);
    assert.ok(c[0] + c[1] + c[2] > 3 * 0x30, f + ': в центре эмблема');
  }
  for (const dn of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) assert.ok(fs.existsSync(path.join(RES, 'drawable-' + dn, 'splash_icon.png')), dn);
});

// ---------------- крупный системный шрифт ----------------
test('шрифт: запрет масштаба снят, textZoom от системы (100-200%), смена шрифта не пересоздаёт экран', () => {
  const MA = JAVA('MainActivity.java');
  assert.ok(!/getSettings\(\)\.setTextZoom\(100\)/.test(MA), 'setTextZoom(100) убран');
  assert.match(MA, /registerPlugin\(FontScalePlugin\.class\)/);
  const FP = JAVA('FontScalePlugin.java');
  assert.match(FP, /int z = Math\.round\(fontScale \* 100f\);\s*return Math\.max\(ZOOM_MIN, Math\.min\(ZOOM_MAX, z\)\);/);
  assert.match(FP, /ZOOM_MAX = 200;/);
  assert.match(FP, /protected void handleOnConfigurationChanged\(Configuration newConfig\) \{[^}]*notifyListeners\("change"/);
  const MF = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const cc = MF.match(/android:configChanges="([^"]+)"/)[1].split('|');
  assert.ok(cc.includes('fontScale'), 'fontScale в configChanges');
  assert.match(read('www', 'native.js'), /FontScale: C\.registerPlugin\('FontScale'\)/);
});

test('fontzoom: уровни 115% / 160%, системный масштаб главнее щупа', () => {
  assert.equal(fzLevel(1), '');
  assert.equal(fzLevel(1.1), '');
  assert.equal(fzLevel(1.15), 'l');
  assert.equal(fzLevel(1.3), 'l');
  assert.equal(fzLevel(1.6), 'xl');
  assert.equal(fzLevel(2), 'xl');
  assert.equal(fzScaleFrom(1.3, 2), 1.3);
  assert.equal(fzScaleFrom(null, 2), 2);
  assert.equal(fzScaleFrom(undefined, NaN), 1);
});

test('fontzoom: data-fz на <html> - по щупу в браузере и по событию плагина на телефоне', async () => {
  const attrs = {};
  let probeH = 100, listener = null, changeCb = null;
  const doc = {
    documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } },
    getElementById: (id) => (id === 'fzProbe' ? { getBoundingClientRect: () => ({ height: probeH }) } : null),
  };
  const win = { addEventListener: (ev, fn) => { if (ev === 'resize') listener = fn; } };
  const detect = initFontZoom(doc, win, null);
  assert.equal(attrs['data-fz'], undefined);
  probeH = 200; listener();
  assert.equal(attrs['data-fz'], 'xl', 'щуп 200px → xl');
  probeH = 100; detect();
  assert.equal(attrs['data-fz'], undefined);
  const plugin = { get: () => Promise.resolve({ fontScale: 1.3 }), addListener: (ev, fn) => { changeCb = fn; } };
  initFontZoom(doc, win, plugin);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(attrs['data-fz'], 'l', 'системные 130%');
  changeCb({ fontScale: 2 });
  assert.equal(attrs['data-fz'], 'xl', 'смена шрифта при открытом приложении');
});

test('шрифт: CSS при 200% на узком экране - витрина и меню в один столбец, при крупном шрифте плитки растут', () => {
  const CSS = read('www', 'css', 'app.css');
  assert.match(CSS, /html\[data-fz="xl"\] \.vitrina \{ grid-template-columns: 1fr;/);
  assert.match(CSS, /html\[data-fz="xl"\] \.menu-list \{ grid-template-columns: 1fr;/);
  assert.match(CSS, /html\[data-fz\] \.menu-list \{ flex: 0 0 auto; grid-auto-rows: auto;/);
  assert.match(CSS, /#fzProbe \{[^}]*font-size: 100px; line-height: 1;/);
  assert.match(read('www', 'index.html'), /<span id="fzProbe" aria-hidden="true">M<\/span>/);
  assert.match(read('www', 'js', 'app.js'), /initFontZoom\(document, window,/);
});

// ---------------- числа не рвутся ----------------
const APP_JS = () => fs.readdirSync(path.join(ROOT, 'www', 'js')).filter((f) => f.endsWith('.js') && f !== 'bip39-wordlist.js' && f !== 'wordlist.js').map((f) => [f, read('www', 'js', f)]);

test('NBSP в коде только escape (\\u00a0), не литералом - литерал молча превращается в пробел', () => {
  for (const [f, src] of APP_JS().concat([['index.html', read('www', 'index.html')], ['app.css', read('www', 'css', 'app.css')]])) {
    assert.ok(!/[\u00a0\u202f]/.test(src), f + ': литеральный неразрывный пробел');
  }
});

test('нет «число пробел ₽» (и «N NNN ₽») с обычным пробелом в текстах приложения (комментарии не в счёт)', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
  for (const [f, src] of APP_JS().concat([['index.html', read('www', 'index.html')]])) {
    assert.ok(!/\d ₽/.test(strip(src)), f + ': «N ₽» с обычным пробелом');
    assert.ok(!/['"`] ₽/.test(strip(src)), f + ': строка « ₽» с обычным пробелом (число подставляется в коде)');
    assert.ok(!/\d \d{3}\u00a0?₽/.test(strip(src)), f + ': разряды цены через обычный пробел');
  }
});

// ---------------- одно число - одно место ----------------
test('окно покупки из упора в лимит: число лимита только в таблице «Бесплатно доступно», не в строке причины', () => {
  const APP = read('www', 'js', 'app.js');
  const pw = APP.slice(APP.indexOf('function openPaywall('), APP.indexOf('const freeRows'));
  const reasons = pw.match(/<p class="paywall-reason">[^`]*<\/p>/g) || [];
  assert.equal(reasons.length, 2);
  for (const r of reasons) assert.ok(!/ctx\.limit/.test(r), 'лимит не повторяется: ' + r.slice(0, 60));
  assert.match(APP, /Gate\.FREE_LIMITS\[s\]/, 'таблица лимитов на месте');
});
