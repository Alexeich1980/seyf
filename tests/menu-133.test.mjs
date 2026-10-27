// menu-133.test.mjs - новое меню 1.3.3 (Алексей 27.10.2026): плитки по парам [Вход | Сменить мастер-пароль]
// [Тема | Разделы] [Копия | Архив для близких] [Полная версия | О приложении]; «Обновление» ушло в «О приложении»
// (строка версии + «Проверить», точка о новой версии - на плитке «О приложении»); «Заблокировать» из меню
// убрана, замок - в шапке главного экрана (как в шапке раздела). Знакомство (onboard.js) не указывает на старые места.
// Мутации (27.10.2026, все красные): вернуть mUpdate в index.html; убрать lockBtn из renderGridShell;
// убрать onclick lockNow у lockBtn витрины; точку has-upd вернуть на #mUpdate; «Проверить» в «О приложении»
// звать U.open() всегда (без check); вернуть «обновление» в подсказку меню знакомства.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from '../www/js/onboard.js';
import { hasIcon } from '../www/js/icons.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const HTML = read('www', 'index.html');
const APP = read('www', 'js', 'app.js');
const CSS = read('www', 'css', 'app.css');

function fnSrc(name) {
  const i = APP.indexOf('function ' + name + '(');
  assert.ok(i > 0, 'нет функции ' + name);
  const j = APP.indexOf('\n}\n', i);
  return APP.slice(i, j);
}

test('меню: ровно 8 плиток в порядке Алексея, пары по строкам', () => {
  const ids = [...HTML.matchAll(/<button class="mi[^"]*" id="(m\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['mBio', 'mKey', 'mTheme', 'mSections', 'mBackup', 'mArchive', 'mPro', 'mAbout']);
  const label = (id) => (HTML.match(new RegExp('id="' + id + '"[^>]*>.*?<span class="mi-t">([^<]+)<')) || [])[1];
  assert.equal(label('mArchive'), 'Архив для близких');
  assert.ok(hasIcon('briefcase'), 'значок чемоданчика для плитки архива');
});

test('меню: «Обновления» и «Заблокировать» нет ни в разметке, ни в привязках', () => {
  assert.ok(!/id="mUpdate"|id="mLock"/.test(HTML));
  assert.ok(!/'mUpdate'|'mLock'|#mUpdate|#mLock/.test(APP));
  assert.ok(!/#mUpdate/.test(CSS));
  assert.match(fnSrc('bindMenuOnce'), /on\('mArchive', \(\) => \{ closeMenu\(\); openArchive\(\); \}\)/);
});

test('замок в шапке ГЛАВНОГО экрана: кнопка в renderGridShell и сразу запирает (lockNow)', () => {
  const g = fnSrc('renderGridShell');
  assert.match(g, /<button id="lockBtn" class="ic-btn"[^>]*aria-label="Заблокировать сейф">\$\{icon\('lock', 22\)\}<\/button>\s*<\/header>/);
  assert.match(g, /\$\('#lockBtn'\); if \(lb\) lb\.onclick = \(\) => lockNow\(\);/);
  // и в разделе остаётся, как было
  assert.match(fnSrc('renderSectionShell'), /id="lockBtn"/);
});

test('обновление в «О приложении»: строка версии + «Проверить», точка - на плитке «О приложении»', () => {
  const a = fnSrc('openAbout');
  assert.match(a, /class="about-ver about-upd"><span class="about-upd-t">Версия \$\{UI\.escapeHtml\(window\.APP_VERSION \|\| ''\)\}<\/span><button type="button" class="about-check">Проверить обновления<\/button>/, 'новичок 27.10: «Проверить» что? - кнопка называет действие');
  assert.match(fnSrc('syncAboutUpdate'), /has \? 'Обновить' : 'Проверить обновления'/);
  assert.match(a, /\.about-check'\)\.onclick = checkUpdateFromAbout/);
  const c = fnSrc('checkUpdateFromAbout');
  assert.match(c, /if \(updateNewer\(\) \|\| !U\.check\) U\.open\(\); else U\.check\(\);/, 'нет новее - проверка (та же логика update.js), есть - окно «Обновить»');
  assert.match(fnSrc('syncUpdateDot'), /querySelector\('#mAbout'\)[\s\S]*classList\.toggle\('has-upd', updateNewer\(\)\)/);
  assert.match(CSS, /#mAbout\.has-upd \.mi-ic::after \{/);
  // тихая недельная проверка (update.js -> SeyfUI.renderMenu) обновляет и точку, и открытое окно
  assert.match(APP, /renderMenu: \(\) => \{\s*updateMenuInfo\(\);\s*syncAboutUpdate\(\);/);
});

test('знакомство при первом входе: меню без «обновления», замок «вверху экрана»', () => {
  const menuHint = O.ONBOARD_POINTERS.find((p) => p.cls === 'ob-menu');
  assert.ok(!/обновлен/i.test(menuHint.text), 'обновления в меню больше нет');
  assert.match(menuHint.text, /архив/);
  const lock = O.ONBOARD_ITEMS.find((i) => i.ic === 'lock');
  assert.match(lock.text, /вверху экрана/);
});
