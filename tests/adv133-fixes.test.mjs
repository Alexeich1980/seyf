// adv133-fixes.test.mjs - находки адверсариального ревью 1.3.3 (27.10.2026), кроме покупки (purchase-133):
//   М1 - цена магазина спрашивается один раз за запуск (вход в сейф / меню / окно покупки), меню = окно;
//   М2 - «0.00 руб.» и прочая «цена без цены» = цены нет (запасная по дате), не «Купить за 0 ₽»;
//   В3 - поля seed-фразы не уезжают за правый край при крупном шрифте (сетка minmax(0, 1fr));
//   М4 - QA-скрипт с headless Edge: флаг relaunch, гасит дерево по PID, подметает свои профили в Temp.
// Мутации - scratchpad fix133/mut-adv.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatPrice, priceRub } from '../www/js/pay.js';
import { priceDisplay } from '../www/js/gate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
// публичный репозиторий: внутренний QA-скрипт tools/qa-133-capture.mjs не публикуется - тогда его тесты пропускаются
const NO_QA = !fs.existsSync(path.join(ROOT, 'tools', 'qa-133-capture.mjs')) && 'внутренний файл не входит в публичный репозиторий';
const NB = '\u00a0';

// ---------------- М2 ----------------
test('М2: «0.00 руб.», «-690 руб.», «Бесплатно» - цены нет: в акцию 690 ₽ (990 зачёркнута), после - 990 ₽', () => {
  for (const l of ['0.00 руб.', '0 ₽', '0,00 RUB', '-690 руб.', 'Бесплатно', '   ']) {
    assert.equal(formatPrice(l), null, l);
    assert.equal(priceRub(l), null, l);
    const promo = priceDisplay(priceRub(l), formatPrice(l), new Date(2026, 10, 1));
    assert.equal(promo.now, '690' + NB + '₽', 'акция: ' + l);
    assert.equal(promo.old, '990' + NB + '₽');
    assert.equal(priceDisplay(priceRub(l), formatPrice(l), new Date(2027, 0, 2)).now, '990' + NB + '₽', 'после акции: ' + l);
  }
  // настоящая цена магазина по-прежнему показывается
  assert.equal(formatPrice('690.00 руб.'), '690' + NB + '₽');
  assert.equal(formatPrice('690.00 USD'), '690.00 USD', 'чужая валюта - как пришла');
});

// ---------------- М1 ----------------
test('М1: цена магазина - один запрос за запуск; вход в сейф и меню спрашивают заранее, окно покупки - повтор только после сбоя', () => {
  const APP = read('www', 'js', 'app.js');
  const lp = APP.slice(APP.indexOf('function loadStorePrice('), APP.indexOf('function prefetchStorePrice('));
  assert.match(lp, /if \(!storePriceReq \|\| \(opts\.retry === true && !storePriceOk\)\) \{/, 'запрос запоминается');
  assert.match(lp, /storePriceReq\.then\(\(\) => \{ try \{ updateMenuInfo\(\); \} catch \(e\) \{\} \}\);/, 'пришла цена - меню перерисовано');
  const pf = APP.slice(APP.indexOf('function prefetchStorePrice('), APP.indexOf('function prefetchStorePrice(') + 300);
  assert.match(pf, /if \(!state\.vault \|\| state\.demoMode \|\| vaultIsPro\(state\.vault\)\) return;\s*loadStorePrice\(\);/);
  assert.match(APP, /autoRestoreQuietly\(\);\s*prefetchStorePrice\(\);/, 'при входе в сейф');
  const om = APP.slice(APP.indexOf('function openMenu() {'), APP.indexOf('function closeMenu() {'));
  assert.match(om, /prefetchStorePrice\(\);[\s\S]*updateMenuInfo\(\);/, 'при открытии меню (тот же запрос)');
  const pw = APP.slice(APP.indexOf('function openPaywall('), APP.indexOf('function precheckPay('));
  assert.match(pw, /loadStorePrice\(\{ retry: true \}\)/);
  assert.equal((APP.match(/getPriceLabel\(\)/g) || []).length, 1, 'getPriceLabel зовётся только из loadStorePrice');
});

test('М1: меню и окно покупки берут цену из одного места (priceShow)', () => {
  const APP = read('www', 'js', 'app.js');
  assert.match(APP, /pro\.innerHTML = priceMenuHtml\(priceShow\(\)\)/);
  assert.match(APP, /Купить за \$\{priceText\(\)\}/);
});

// ---------------- В3 ----------------
test('В3: сетка seed-слов не шире окна при крупном шрифте: minmax(0, 1fr), ячейка min-width:0, поле width:100%', () => {
  const CSS = read('www', 'css', 'app.css');
  const blk = CSS.slice(CSS.indexOf('/* ---- 8d п.6: seed-слова'), CSS.indexOf('/* ---- 8d п.12'));
  assert.match(blk, /\.seed-words \{ grid-template-columns: minmax\(0, 1fr\); gap: 7px; \}/);
  assert.match(blk, /\.seed-cell \{ gap: 8px; min-width: 0; \}/);
  assert.match(blk, /\.seed-word \{ padding: 10px 11px; width: 100%; \}/);
  assert.match(blk, /@media \(max-width: 640px\) \{\s*\.seed-words \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  // последнее правило для .seed-words в файле - с minmax (ничто ниже не возвращает 1fr)
  const all = [...CSS.matchAll(/\.seed-words \{[^}]*grid-template-columns:\s*([^;]+);/g)].map((m) => m[1]);
  assert.equal(all.at(-1), 'minmax(0, 1fr)');
});

test('В3: QA-скрипт проверяет экран seed на переполнение при крупном шрифте и падает при находке', { skip: NO_QA }, () => {
  const Q = read('tools', 'qa-133-capture.mjs');
  assert.match(Q, /\{ name: 'font-seed', js:/);
  assert.match(Q, /if \(found\.length\) report\.overflow\+\+;/);
  assert.match(Q, /process\.exitCode = 2;/);
});

// ---------------- М4 ----------------
test('М4: qa-133-capture - флаг relaunch, taskkill /T /F по PID, свой профиль удаляется, старые подметаются', { skip: NO_QA }, () => {
  const Q = read('tools', 'qa-133-capture.mjs');
  assert.match(Q, /'--edge-skip-compat-layer-relaunch'/);
  assert.match(Q, /spawnSync\('taskkill', \['\/PID', String\(pid\), '\/T', '\/F'\]/);
  assert.match(Q, /killTree\(edge\.pid\);/);
  assert.ok(!/edge\.kill\(\)/.test(Q), 'proc.kill() бьёт в один PID');
  assert.match(Q, /fs\.rmSync\(udd, \{ recursive: true, force: true/);
  assert.match(Q, /export async function run\(scenes, \{ extraSetup \} = \{\}\) \{\s*sweepProfiles\(\);/);
});

test('М4: sweepProfiles удаляет только свои профили старше 15 минут', { skip: NO_QA }, async () => {
  const { sweepProfiles } = await import('../tools/qa-133-capture.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-sweep-test-'));
  try {
    const mk = (name, ageMin) => { const d = path.join(dir, name); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'f'), 'x'); const t = (Date.now() - ageMin * 60000) / 1000; fs.utimesSync(d, t, t); return d; };
    const old = mk('seyf-qa133-old', 20), fresh = mk('seyf-qa133-new', 5), other = mk('kr-fit-old', 60);
    assert.equal(sweepProfiles(dir), 1);
    assert.ok(!fs.existsSync(old), 'старый свой - удалён');
    assert.ok(fs.existsSync(fresh), 'свежий (параллельный прогон) - не тронут');
    assert.ok(fs.existsSync(other), 'чужой префикс - не тронут');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
