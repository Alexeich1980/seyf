// seed-banner-132.test.mjs - 1.3.2 Э6: баннер «Подумайте дважды» в разделе Seed-фраз показывается при
// каждом входе, пока не отмечено «Больше не показывать»; «Понятно» без галочки прячет до следующего
// входа; кто нажал старое «Понял, принял» (seyf_seed_banner_dismissed=1) - считается отметившим.
// Плюс одно короткое напоминание (своё окно dlgAlert) при сохранении ПЕРВОЙ seed-фразы.
// Мутации (16.10.2026, каждая -> красный): seedBannerVisible без hiddenThisVisit; seedBannerOk
// пишет ключ и без галочки; enterSection не сбрасывает seedBannerHidden; firstSeedReminderDue без
// проверки «ровно одна»; напоминание без markFirstSeedReminded; другой ключ старого «Понял, принял».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../www/js/seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(ROOT, 'www', 'js', 'app.js'), 'utf8');
function mkStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

test('баннер: виден при каждом входе, «Понятно» без галочки - только до следующего входа', () => {
  const ls = mkStorage();
  assert.equal(S.seedBannerVisible(ls), true, 'первый вход');
  const after = S.seedBannerOk(ls, false);
  assert.equal(S.seedBannerVisible(ls, { hiddenThisVisit: after.hiddenThisVisit }), false, 'в этом заходе спрятан');
  assert.equal(ls.getItem(S.SEED_BANNER_KEY), null, 'без галочки ничего не запоминаем');
  assert.equal(S.seedBannerVisible(ls, { hiddenThisVisit: false }), true, 'следующий вход - снова виден');
});

test('баннер: с галочкой «Больше не показывать» - навсегда; старое «Понял, принял» = галочка', () => {
  const ls = mkStorage();
  S.seedBannerOk(ls, true);
  assert.equal(S.seedBannerVisible(ls), false);
  const old = mkStorage({ seyf_seed_banner_dismissed: '1' });   // пользователь 1.3.1, нажавший «Понял, принял»
  assert.equal(S.SEED_BANNER_KEY, 'seyf_seed_banner_dismissed');
  assert.equal(S.seedBannerVisible(old), false);
  assert.equal(S.seedBannerVisible(mkStorage(), { query: 'btc' }), false, 'в поиске баннера нет');
});

test('приложение: галочка и «Понятно», сброс при входе в раздел, текст баннера прежний на «вы»', () => {
  const i = APP.indexOf('function renderSeedBanner('), j = APP.indexOf('\n}\n', i);
  const f = APP.slice(i, j);
  assert.match(f, /<input type="checkbox" class="seed-banner-chk"> Больше не показывать<\/label>/);
  assert.match(f, />Понятно<\/button>/);
  assert.doesNotMatch(f, /Понял, принял/);
  assert.match(f, /seedBannerHidden = seedBannerOk\(lsGet\(\), never\)\.hiddenThisVisit;/);
  for (const p of ['Мы не рекомендуем хранить seed-фразу в памяти телефона', 'бумажный носитель в защищённом месте', 'это ваш осознанный выбор и ответственность']) {
    assert.ok(f.includes(p), 'текст баннера по смыслу прежний: ' + p);
  }
  assert.match(APP, /function enterSection\(s\) \{\s*current = s;\s*if \(s === 'seed'\) seedBannerHidden = false;/);
  assert.match(APP, /current === 'seed' && seedBannerVisible\(lsGet\(\), \{ hiddenThisVisit: seedBannerHidden, query \}\)/);
});

test('напоминание: только при сохранении первой seed-фразы и один раз', () => {
  const ls = mkStorage();
  assert.equal(S.firstSeedReminderDue(ls, { isNew: true, seedCount: 2 }), false);
  assert.equal(S.firstSeedReminderDue(ls, { isNew: false, seedCount: 1 }), false, 'правка - не повод');
  assert.equal(S.firstSeedReminderDue(ls, { isNew: true, seedCount: 1 }), true);
  S.markFirstSeedReminded(ls);
  assert.equal(S.firstSeedReminderDue(ls, { isNew: true, seedCount: 1 }), false, 'удалил и добавил снова - не повторяем');
  assert.ok(!/—/.test(S.SEED_FIRST_TEXT + S.SEED_FIRST_TITLE));
  assert.ok(S.SEED_FIRST_TEXT.length < 220, 'коротко');
});

test('приложение: напоминание - своё окно после записи на диск, флаг ставится', () => {
  const i = APP.indexOf('onSaved: () => {'), f = APP.slice(i, i + 1200);
  assert.match(f, /if \(section === 'seed'\) \{[\s\S]*firstSeedReminderDue\(lsGet\(\), \{ isNew, seedCount \}\)[\s\S]*markFirstSeedReminded\(lsGet\(\)\);\s*dlgAlert\(SEED_FIRST_TEXT, SEED_FIRST_TITLE\);/);
  assert.ok(f.indexOf('dlgAlert(SEED_FIRST_TEXT') < f.indexOf('review.afterSave()'), 'напоминание раньше окна оценки (оценка тогда отложится: окно открыто)');
  assert.doesNotMatch(APP, /\balert\(SEED|confirm\(SEED/);
});
