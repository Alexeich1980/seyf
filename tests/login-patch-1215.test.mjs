// login-patch-1215.test.mjs - заслоны на патч экрана входа 1.2.15 (v3-auth регресс оформления)
// + двухшаговая подсказка + ссылка «Показать подсказку» + крупная иконка витрины.
// Геометрию проверяли живым браузером; здесь - заслоны на исходники/CSS + чистые функции.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldOfferBio } from '../www/js/biopref.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, '..', 'www', 'css', 'app.css'), 'utf8');
const HTML = fs.readFileSync(path.join(HERE, '..', 'www', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');

function ruleBody(selector) {
  const re = new RegExp('(^|\\n)\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = CSS.match(re);
  return m ? m[2] : null;
}

// ---- п.1: «Войти по мастер-паролю» - неприметная ССЫЛКА, не равнозначная teal-кнопка ----
test('вход: .pw-fallback оформлена с .lock-card (специфичность), чтобы не стать teal-кнопкой', () => {
  // Регресс был из-за общего `.lock-card button` (0,1,1), перебивавшего `.pw-fallback` (0,1,0).
  assert.ok(/\.lock-card \.pw-fallback\s*\{/.test(CSS), 'нужен селектор .lock-card .pw-fallback (поднять специфичность)');
  const b = ruleBody('.lock-card .pw-fallback');
  assert.ok(b, 'нет правила .lock-card .pw-fallback');
  assert.ok(/background:\s*transparent/.test(b), 'фолбэк-ссылка прозрачная (не залитая кнопка)');
  assert.ok(/border:\s*0/.test(b), 'без рамки кнопки');
  assert.ok(/text-decoration:\s*underline/.test(b), 'подчёркнута как ссылка');
  assert.ok(/color:\s*var\(--muted\)/.test(b), 'приглушённый цвет');
  assert.ok(!/var\(--teal\)/.test(b) && !/var\(--on-accent\)/.test(b), 'НЕ teal-кнопка');
});

test('вход [мутация]: если снять .lock-card, общий .lock-card button (teal) перебьёт ссылку', () => {
  // Фиксируем сам факт наличия квалифицирующего селектора (защита от отката к голому .pw-fallback).
  assert.ok(/\.lock-card \.pw-fallback/.test(CSS), 'без .lock-card ссылка снова станет teal-кнопкой');
});

// ---- п.2: авто-попытка при старте - текст без формулировки выбора ----
test('вход: авто-ветка attemptBio не предлагает «или по мастер-паролю»', () => {
  assert.ok(!/Войдите по биометрии или по мастер-паролю/.test(APP), 'старый текст-выбор удалён');
  assert.ok(/Приложите палец или нажмите «Войти по биометрии»\./.test(APP), 'нейтральный текст про биометрию');
});

// ---- п.3: биометрия недоступна → честно на мастер-пароль (без «выбора») ----
test('вход: shouldOfferBio=false при недоступной биометрии (ключ слетел после переустановки)', () => {
  assert.equal(shouldOfferBio({ hasHelloWrap: true, bioAvailable: false, enabled: true }), false);
  assert.equal(shouldOfferBio({ hasHelloWrap: false, bioAvailable: true, enabled: true }), false);
  assert.equal(shouldOfferBio({ hasHelloWrap: true, bioAvailable: true, enabled: true }), true);
  // startUnlock: при !canBio сразу поле мастер-пароля, кнопка/ссылка биометрии скрыты.
  assert.ok(/if \(!canBio\)/.test(APP), 'режим мастер-пароля - следствие настройки (не экран выбора)');
});

// ---- подсказка: двухшаговый доступ (просмотр → редактирование) ----
test('подсказка: viewPasswordHint показывает текст/статус и предлагает Изменить/Добавить', () => {
  const v = APP.indexOf('async function viewPasswordHint');
  assert.ok(v >= 0, 'нет viewPasswordHint');
  const body = APP.slice(v, v + 800);
  assert.ok(/getPasswordHint\(lsGet\(\)\)/.test(body), 'читает текущую подсказку');
  assert.ok(/'Изменить'/.test(body) && /'Добавить'/.test(body), 'кнопки Изменить/Добавить по наличию подсказки');
  assert.ok(/Подсказка не задана/.test(body), 'статус, когда подсказки нет');
  assert.ok(/editPasswordHint\(knownPw\)/.test(body), 'переход к редактированию вторым шагом');
  assert.ok(/authmode-hint-btn'\)\.onclick = \(\) => viewPasswordHint/.test(APP), 'пункт меню открывает просмотр, не редактор');
});

// ---- «Показать подсказку» на экране мастер-пароля (видна ⇔ hint задан) ----
test('вход: ссылка «Показать подсказку» есть в разметке и это неприметная ссылка', () => {
  assert.ok(/id="showHint"/.test(HTML), 'нет ссылки showHint');
  assert.ok(/class="hint-link hidden"/.test(HTML), 'ссылка изначально скрыта');
  const b = ruleBody('.lock-card .hint-link');
  assert.ok(b && /background:\s*transparent/.test(b) && /text-decoration:\s*underline/.test(b) && !/var\(--teal\)/.test(b),
    '.hint-link - приглушённая ссылка, не teal-кнопка');
});

test('вход: showHint видна только при заданной подсказке; тап выводит «Подсказка: <текст>»', () => {
  // revealMasterField переключает видимость по наличию подсказки.
  const r = APP.indexOf('function revealMasterField');
  const body = APP.slice(r, r + 700);
  assert.ok(/#showHint/.test(body), 'revealMasterField управляет ссылкой showHint');
  assert.ok(/getPasswordHint\(lsGet\(\)\)/.test(body), 'видимость зависит от наличия подсказки');
  assert.ok(/classList\.toggle\('hidden',\s*!\(hint && hint\.trim\(\)\)\)/.test(body), 'скрыта, когда подсказки нет');
  // клик по showHint показывает текст в #lockHint с префиксом «Подсказка: ».
  assert.ok(/#showHint'\);?\s*if \(sh\) sh\.addEventListener\('click'/.test(APP), 'на showHint навешан обработчик клика');
  assert.ok(/h\.textContent = 'Подсказка: ' \+ t/.test(APP), 'тап выводит текст подсказки «Подсказка: <текст>»');
});

// ---- иконка раздела на витрине крупнее ----
test('витрина: иконка раздела крупная (>=50px), гармонично с растянутой плиткой', () => {
  const chip = ruleBody('.cardicon.vtile-ic');
  const svg = ruleBody('.vtile-ic svg');
  assert.ok(chip && svg, 'нет правил иконки витрины');
  const cw = chip.match(/width:\s*(\d+)px/);
  const sw = svg.match(/width:\s*(\d+)px/);
  assert.ok(cw && parseInt(cw[1], 10) >= 50, 'чип иконки витрины >= 50px (был 38px)');
  assert.ok(sw && parseInt(sw[1], 10) >= 48, 'глиф иконки витрины >= 48px (был 34px)');
});
