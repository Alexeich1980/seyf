// no-email-in-docs.test.mjs - нигде, что видит человек, нет адреса почты разработчика (решение Алексея
// 06.10.2026, как в Карте года и Хомяке d08c581): публичная почта для обращений = приём ПДн = статус
// оператора и уведомление РКН. Обращения - через страницу в RuStore и поддержку RuStore.
// 1.3.2 (16.10.2026): заслон расширен на всё приложение (www/), CHANGELOG («Что нового»), исходники
// скриншотов и «Данные для Консоли.txt» - там почта оставалась строкой «E-mail поддержки».
// Функция приложения «Написать» (mailto на адрес из карточки контакта ПОЛЬЗОВАТЕЛЯ) остаётся: адрес
// берётся из записи, в коде его нет. Разрешены только адреса-заглушки на example.com (демо-данные).
// Мутация (16.10.2026): вписать dev@yandex.ru в строку www/js/app.js -> красный тест «www/js/app.js».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESK_SET = path.join(ROOT, '..', '..', '..', 'Сейф-RuStore-публикация', 'Данные для Консоли.txt');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED = /@example\.(?:com|org|net)$/i;
const SKIP = new Set(['capacitor.js']); // сторонний мост Capacitor
const LEGAL = ['legal/privacy.html', 'legal/terms.html'];
const FILES = [
  ...LEGAL, 'store/card-rustore.txt', 'CHANGELOG.md',
  ...fs.readdirSync(path.join(ROOT, 'www')).filter((f) => /\.(js|html|json)$/.test(f) && !SKIP.has(f)).map((f) => 'www/' + f),
  ...fs.readdirSync(path.join(ROOT, 'www', 'js')).filter((f) => /\.js$/.test(f)).map((f) => 'www/js/' + f),
  // публичный репозиторий: исходников скриншотов витрины (Дизайн/) нет - тогда их проверка пропускается
  ...(fs.existsSync(path.join(ROOT, 'Дизайн', 'src')) ? fs.readdirSync(path.join(ROOT, 'Дизайн', 'src')).filter((f) => /^card\d+\.html$/.test(f)).map((f) => 'Дизайн/src/' + f) : []),
];
const INTERNAL = (f) => !fs.existsSync(path.join(ROOT, f)) && 'внутренний файл не входит в публичный репозиторий';
const emails = (s) => (s.match(EMAIL) || []).filter((e) => !ALLOWED.test(e));

test('самопроверка: ловит адрес, пропускает заглушку example.com', () => {
  assert.deepEqual(emails('пишите на dev@yandex.ru или demo@example.com'), ['dev@yandex.ru']);
});

for (const f of FILES) {
  test(`нет адреса почты: ${f}`, { skip: INTERNAL(f) }, () => {
    const found = emails(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    assert.deepEqual(found, [], `${f}: ${found.join(', ')}`);
  });
}

test('нет адреса почты: «Данные для Консоли.txt» (если папка публикации есть на этой машине)', (t) => {
  if (!fs.existsSync(DESK_SET)) return t.skip('нет папки публикации на Рабочем столе');
  const found = emails(fs.readFileSync(DESK_SET, 'utf8'));
  assert.deepEqual(found, [], found.join(', '));
});

test('mailto в приложении - только из адреса записи пользователя (contactlinks.mailtoHref)', () => {
  for (const f of FILES.filter((x) => x.startsWith('www/'))) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(s, /mailto:[A-Za-z0-9]/, f + ': mailto с готовым адресом');
  }
});

test('обращения ведут в RuStore', () => {
  for (const f of LEGAL) {
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /rustore\.ru\/catalog\/app\/ru\.dorokhin\.seyf/, f);
  }
});
