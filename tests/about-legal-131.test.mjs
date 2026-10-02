// about-legal-131.test.mjs - 1.3.1: в «О приложении» есть ссылки на юр-документы (требование витрины
// RuStore). Заслон текстом по телу openAbout: обе ссылки на месте, блок «Документы» стоит перед
// «Автор и связь», значки ставятся по data-icon (не по хрупким индексам links[0]/links[1]),
// открытие через openExternal (системный браузер, не WebView с расшифрованным сейфом).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasIcon } from '../www/js/icons.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');

// Тело функции openAbout - от объявления до следующего объявления верхнего уровня.
function aboutBody() {
  const start = APP.indexOf('function openAbout()');
  assert.ok(start >= 0, 'нет function openAbout()');
  const next = APP.indexOf('\nfunction ', start + 10);
  return APP.slice(start, next < 0 ? undefined : next);
}

const DOCS = [
  { url: 'https://dorokhin-finance.ru/seyf-store/privacy.html', title: 'Политика конфиденциальности' },
  { url: 'https://dorokhin-finance.ru/seyf-store/terms.html', title: 'Пользовательское соглашение' },
];

test('openAbout: обе ссылки на юр-документы с подписями', () => {
  const body = aboutBody();
  for (const d of DOCS) {
    const re = new RegExp('<button[^>]*class="about-link"[^>]*data-url="' + d.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '"[^>]*>\\s*<span class="about-link-ic"></span><span class="about-link-t">' + d.title + '</span>');
    assert.ok(re.test(body), 'нет кнопки «' + d.title + '» -> ' + d.url);
  }
});

test('openAbout: блок «Документы» стоит перед «Автор и связь»', () => {
  const body = aboutBody();
  const docs = body.indexOf('<div class="about-sec">Документы</div>');
  const author = body.indexOf('<div class="about-sec">Автор и связь</div>');
  assert.ok(docs >= 0, 'нет раздела «Документы»');
  assert.ok(author > docs, '«Документы» должны идти перед «Автор и связь»');
});

test('openAbout: значки по data-icon, у каждой ссылки есть существующая иконка, открытие через openExternal', () => {
  const body = aboutBody();
  assert.ok(!/links\[\d\]/.test(body), 'значки не должны ставиться по индексу links[N]');
  assert.ok(/icon\(b\.dataset\.icon, 18\)/.test(body), 'значок должен браться из data-icon');
  assert.ok(/openExternal\(b\.dataset\.url\)/.test(body), 'ссылки открываются через openExternal');
  const buttons = body.match(/<button[^>]*class="about-link"[^>]*>/g) || [];
  assert.equal(buttons.length, 3, 'ожидаем 3 ссылки: 2 документа + сайт (почту убрали, I3)');
  for (const b of buttons) {
    const m = b.match(/data-icon="([^"]+)"/);
    assert.ok(m, 'у ссылки нет data-icon: ' + b);
    assert.ok(hasIcon(m[1]), 'иконки «' + m[1] + '» нет в наборе');
  }
});

test('I3: в openAbout нет почты, сайт dorokhin-finance.ru на месте', () => {
  const body = aboutBody();
  assert.ok(!/mailto:/i.test(body), 'в «О приложении» не должно быть mailto');
  assert.ok(!/avdorohin@/i.test(body), 'в «О приложении» не должно быть адреса почты');
  assert.ok(!/data-icon="mail"/.test(body), 'в «О приложении» не должно быть кнопки почты');
  assert.ok(/data-icon="globe" data-url="https:\/\/dorokhin-finance\.ru\/"/.test(body), 'кнопка сайта dorokhin-finance.ru пропала');
  assert.ok(body.includes('<span class="about-link-t">dorokhin-finance.ru</span>'), 'нет подписи сайта');
});

// Не зависит от точной версии: следующее повышение (1.3.2, 1.4.0...) тест не ломает. Держим, что
// раздел 1.3.1 существует, стоит выше 1.3.0, содержит строки про документы и почту, а версия
// package.json не ниже 1.3.1 (документы в «О приложении» есть во всех версиях начиная с неё).
test('раздел 1.3.1 в CHANGELOG (документы, почта), версия не ниже 1.3.1, «—» в заметках нет', () => {
  const ROOT = path.join(HERE, '..');
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const n = ver.split('.').map(Number);
  assert.ok(n[0] * 1e6 + n[1] * 1e3 + n[2] >= 1 * 1e6 + 3 * 1e3 + 1, 'версия package.json ' + ver + ' ниже 1.3.1');
  const log = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const i131 = log.search(/^## 1\.3\.1(?![\d.])/m);
  const i130 = log.search(/^## 1\.3\.0(?![\d.])/m);
  assert.ok(i131 >= 0, 'нет раздела 1.3.1');
  assert.ok(i130 > i131, 'раздел 1.3.1 должен стоять выше 1.3.0');
  const sec = log.slice(i131, i130);
  assert.match(sec, /Политик[а-я]* конфиденциальности/);
  assert.match(sec, /Пользовательское соглашение/);
  assert.match(sec, /почт/i, 'в 1.3.1 нет строки про убранную почту');
  assert.ok(!sec.includes('—'));
});
