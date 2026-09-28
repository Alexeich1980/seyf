// contactlinks.test.mjs — безопасные ссылки раздела «Контакты» (batch2): tel: и «Открыть».
// Заслон: разрешаем только https/http/tel/tg/whatsapp; иную схему (в т.ч. javascript:) режем.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telHref, openableHref, mailtoHref, linkLabel } from '../www/js/contactlinks.js';

test('telHref: нормализует телефон в tel: (+ и цифры)', () => {
  assert.equal(telHref('+7 900 000-00-00'), 'tel:+79000000000');
  assert.equal(telHref('8 (900) 123 45 67'), 'tel:89001234567');
  assert.equal(telHref('+1 (202) 555-0100'), 'tel:+12025550100');
});

test('telHref: пусто/мусор/слишком короткий → null (кнопки не будет)', () => {
  assert.equal(telHref(''), null);
  assert.equal(telHref('   '), null);
  assert.equal(telHref('нет'), null);
  assert.equal(telHref('12'), null);
  assert.equal(telHref(null), null);
});

test('openableHref: разрешённые схемы проходят как есть', () => {
  assert.equal(openableHref('https://t.me/example'), 'https://t.me/example');
  assert.equal(openableHref('http://example.com'), 'http://example.com');
  assert.equal(openableHref('tg://resolve?domain=example'), 'tg://resolve?domain=example');
  assert.equal(openableHref('whatsapp://send?phone=79000000000'), 'whatsapp://send?phone=79000000000');
  assert.equal(openableHref('tel:+79000000000'), 'tel:+79000000000');
});

test('openableHref: голый домен → https://', () => {
  assert.equal(openableHref('t.me/example'), 'https://t.me/example');
  assert.equal(openableHref('example.com/path'), 'https://example.com/path');
});

test('openableHref: опасная/неизвестная схема → null', () => {
  assert.equal(openableHref('javascript:alert(1)'), null);
  assert.equal(openableHref('data:text/html,<script>'), null);
  assert.equal(openableHref('file:///etc/passwd'), null);
  assert.equal(openableHref('mailto:a@b.c'), null); // не в списке разрешённых
});

// C9 (1.2.23): «@ник» - это Telegram, открываем https://t.me/ник (раньше - null, открывать нечего).
test('openableHref: @ник -> https://t.me/ник; произвольный текст -> null (открывать нечего)', () => {
  assert.equal(openableHref('@ivan'), 'https://t.me/ivan');
  assert.equal(openableHref('@a'), null, 'слишком короткий ник - не Telegram');
  assert.equal(openableHref('просто заметка'), null);
  assert.equal(openableHref(''), null);
  assert.equal(openableHref(null), null);
});

// --- п.10: mailto из e-mail ---
test('mailtoHref: валидный e-mail → mailto:, мусор → null', () => {
  assert.equal(mailtoHref('ivan@example.com'), 'mailto:ivan@example.com');
  assert.equal(mailtoHref('  a.b-c@mail.ru '), 'mailto:a.b-c@mail.ru');
  assert.equal(mailtoHref('нет собаки'), null);
  assert.equal(mailtoHref('a@b'), null);          // домен без точки/TLD
  assert.equal(mailtoHref('a b@c.ru'), null);     // пробел внутри
  assert.equal(mailtoHref('a@@b.ru'), null);      // два @
  assert.equal(mailtoHref(''), null);
  assert.equal(mailtoHref(null), null);
});

// --- п.9: короткий умный лейбл ссылки ---
// Мутация: убрать ветку t.me/wa.me или перестать резать домен «…» - тест краснеет.
test('linkLabel: мессенджеры → бренд, mailto → e-mail, иначе домен (с «…» при пути)', () => {
  assert.equal(linkLabel('https://t.me/example'), 'Telegram');
  assert.equal(linkLabel('t.me/ivan'), 'Telegram');
  assert.equal(linkLabel('tg://resolve?domain=x'), 'Telegram');
  assert.equal(linkLabel('https://wa.me/79000000000'), 'WhatsApp');
  assert.equal(linkLabel('https://api.whatsapp.com/send?phone=7'), 'WhatsApp');
  assert.equal(linkLabel('whatsapp://send?phone=7'), 'WhatsApp');
  assert.equal(linkLabel('mailto:a@b.ru'), 'e-mail');
  assert.equal(linkLabel('https://example.com'), 'example.com');       // без пути - чистый домен
  assert.equal(linkLabel('https://www.example.com/very/long/path'), 'example.com…'); // путь → «…»
  assert.equal(linkLabel('example.com/a'), 'example.com…');
  assert.equal(linkLabel(''), '');
});
