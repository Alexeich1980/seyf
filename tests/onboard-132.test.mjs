// onboard-132.test.mjs - 1.3.2 Э5: знакомство при первом входе (www/js/onboard.js + openOnboard в app.js).
// Один раз, только сразу после создания сейфа; кто обновился с прежней версии (сейф уже есть, экран
// создания не проходит) - не видит; «назад»/Escape/фон = «Понятно»; подсказки разделов (hints.js) не
// повторяются. Визуальная проверка - headless Edge 375/820, тёмная/светлая (scratchpad, Э5).
// Мутации (16.10.2026, каждая -> красный): shouldOnboard без justCreated; без проверки флага;
// openOnboard не ставит флаг; вызов openOnboard из afterUnlock (вход существующего пользователя);
// Escape не закрывает знакомство. Ревью 1.3.2: флаг снова по «Понятно» (не при показе); вызов знакомства
// из startUnlock (поверх экрана входа после запирания) -> красный.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from '../www/js/onboard.js';
import { getHintParagraphs } from '../www/js/hints.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(ROOT, 'www', 'js', 'app.js'), 'utf8');
const HINTS = fs.readFileSync(path.join(ROOT, 'www', 'js', 'hints.js'), 'utf8');
function mkStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const fnBody = (name) => {
  const i = APP.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'нет функции ' + name);
  const j = APP.indexOf('\n}\n', i);
  return APP.slice(i, j);
};

test('shouldOnboard: только сразу после создания сейфа и только один раз', () => {
  const ls = mkStorage();
  assert.equal(O.shouldOnboard(ls, { justCreated: false }), false, 'вход в существующий сейф (обновились) - нет');
  assert.equal(O.shouldOnboard(ls, {}), false);
  assert.equal(O.shouldOnboard(ls, { justCreated: true }), true);
  O.markOnboarded(ls);
  assert.equal(ls.getItem(O.ONBOARD_KEY), '1');
  assert.equal(O.shouldOnboard(ls, { justCreated: true }), false, 'сейф создали заново - не повторяем');
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  assert.equal(O.markOnboarded(broken), false, 'хранилище не пишется - не падаем');
});

test('приложение: знакомство зовётся только из создания сейфа (onSetupInner), не при входе', () => {
  const calls = APP.match(/(?<!function )openOnboard\(\)/g) || [];
  assert.equal(calls.length, 1, 'один вызов');
  const setup = fnBody('onSetupInner');
  assert.match(setup, /await afterUnlock\(res, \{ offerBio: true \}\);[\s\S]*if \(shouldOnboard\(lsGet\(\), \{ justCreated: true \}\)\) await openOnboard\(\);[\s\S]*pendingReopen/,
    'после предложения биометрии и до открытия редактора из демо');
  assert.doesNotMatch(fnBody('afterUnlock'), /Onboard/, 'обычный вход (существующий пользователь) знакомства не показывает');
});

test('окно знакомства: «Понятно, начать», флаг в момент показа, «назад»/Escape/фон = «Понятно»', () => {
  const f = fnBody('openOnboard');
  assert.match(f, /back\.className = 'modal-back onboard-back'/, 'это модалка: handleBack -> closeModal -> Escape');
  // ревью 1.3.2: флаг ставится при показе, до Promise/окна - запирание посреди знакомства его не теряет
  assert.match(f, /^function openOnboard\(\) \{\s*markOnboarded\(lsGet\(\)\);\s*return new Promise/, 'флаг первым делом');
  assert.equal((f.match(/markOnboarded\(/g) || []).length, 1, 'не по «Понятно»');
  assert.match(f, /e\.key === 'Escape' && isTopModal\(back\)\) \{ e\.stopPropagation\(\); close\(\); \}/);
  assert.match(f, /closeOnBackdrop\(back, close\)/);
  assert.match(f, /#obDone'\)\.onclick = close/);
  assert.equal(O.ONBOARD_DONE, 'Понятно, начать');
  assert.match(APP, /hasModal: !!document\.querySelector\('\.modal-back'\)/, '«назад» на телефоне закрывает верхнюю модалку');
});

test('содержание: меню, поиск, «+», глаз, «?», замок; на «вы», без тире; не повторяет подсказки разделов', () => {
  const all = [O.ONBOARD_TITLE, O.ONBOARD_LEAD, ...O.ONBOARD_POINTERS.flatMap((p) => [p.title, p.text]), ...O.ONBOARD_ITEMS.map((i) => i.text)].join(' ');
  for (const w of ['Меню', 'Поиск', '«+»', 'Глаз', '«?»', 'Замок']) assert.ok(all.includes(w), w);
  assert.deepEqual(O.ONBOARD_ITEMS.map((i) => i.ic), ['+', 'eye', 'help', 'lock']);
  assert.ok(!/—/.test(all));
  const plain = (s) => s.replace(/<[^>]+>/g, '').toLowerCase();
  const hintText = plain(HINTS);
  for (const it of O.ONBOARD_ITEMS) {
    const phrase = plain(it.text).replace(/[«»"?.+]/g, ' ').trim().split(/\s+/).slice(1, 5).join(' ');
    assert.ok(!hintText.includes(phrase), 'фраза из подсказок разделов: ' + phrase);
  }
  assert.ok(getHintParagraphs('passwords').length > 0, 'подсказки разделов на месте (кнопка «?»)');
});

test('после запирания/перезагрузки знакомство не всплывает поверх экрана входа (ревью 1.3.2)', () => {
  // единственный вход в знакомство - onSetupInner (создание сейфа); boot/вход/afterUnlock его не зовут
  const body = (name) => {   // тело функции до первой «}» в начале строки (CRLF или LF)
    const i = APP.indexOf('function ' + name + '(');
    assert.ok(i >= 0, 'нет функции ' + name);
    const m = /\r?\n\}\r?\n/.exec(APP.slice(i));
    return APP.slice(i, i + m.index);
  };
  for (const fn of ['boot', 'afterUnlock', 'onPwUnlock', 'lockNow', 'startUnlock']) assert.doesNotMatch(body(fn), /Onboard/, fn);
  // флаг поставлен при показе: даже повторный вызов создания на этом телефоне знакомство не повторит
  const ls = mkStorage();
  O.markOnboarded(ls);   // что делает openOnboard в первой строке
  assert.equal(O.shouldOnboard(ls, { justCreated: true }), false);
});
