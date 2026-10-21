// fieldinput.test.mjs — поведение полей ввода на телефоне (спека 8d п.2,3,4,7,8).
// Чистые хелперы: маска номера карты, лимиты ПИН/CVV, латиница имени, strip пробелов в URL,
// клавиатуры по типу поля. Мутационные инварианты: лимит ПИН (4) и strip URL — см. отдельные тесты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onlyDigits, groupDigits, formatCardNumber, cardNumberValid, stripSpaces, latinOnly,
  fieldInputProps, liveMaskFor, CARD_NUMBER_MIN, CARD_NUMBER_MAX,
  INPUT_LIMITS, defaultMaxLength,
} from '../www/js/fieldinput.js';

// --- v3: разумные лимиты ввода даже для Pro ---
test('INPUT_LIMITS: разумные дефолты (заметка 10000, поле 500, сканов 20, записей 1000)', () => {
  assert.equal(INPUT_LIMITS.textarea, 10000);
  assert.equal(INPUT_LIMITS.text, 500);
  assert.equal(INPUT_LIMITS.scansPerDoc, 20);
  assert.equal(INPUT_LIMITS.recordsPerSection, 1000);
});

test('defaultMaxLength: textarea → 10000, input → 500, свой лимит не трогаем', () => {
  assert.equal(defaultMaxLength('TEXTAREA', false), 10000);
  assert.equal(defaultMaxLength('textarea', false), 10000);
  assert.equal(defaultMaxLength('INPUT', false), 500);
  assert.equal(defaultMaxLength('INPUT', true), null);   // у поля уже есть явный maxLength
  assert.equal(defaultMaxLength('SELECT', false), null);
});

// --- п.2 номер карты ---
test('номер карты: буквы отбрасываются, только цифры', () => {
  assert.equal(onlyDigits('4a1b2c'), '412');
  assert.equal(formatCardNumber('1234abcd5678'), '1234 5678');
});

test('номер карты: группировка по 4', () => {
  // синтетический не-Luhn набор (не настоящий номер): проверяем только форматирование
  assert.equal(formatCardNumber('1234567890123456'), '1234 5678 9012 3456');
  assert.equal(groupDigits('123456789'), '1234 5678 9');
});

test('номер карты: 12 цифр невалидно, 16 валидно, 13 и 19 — границы валидны', () => {
  assert.equal(cardNumberValid('4'.repeat(12)), false);
  assert.equal(cardNumberValid('4'.repeat(16)), true);
  assert.equal(cardNumberValid('4'.repeat(CARD_NUMBER_MIN)), true);   // 13
  assert.equal(cardNumberValid('4'.repeat(CARD_NUMBER_MAX)), true);   // 19
  assert.equal(cardNumberValid('4'.repeat(20)), false);
  assert.equal(cardNumberValid(''), false);
});

test('номер карты: маска обрезает по 19 цифр максимум', () => {
  const masked = formatCardNumber('1'.repeat(30));
  assert.equal(onlyDigits(masked).length, CARD_NUMBER_MAX);
});

// --- п.4 ПИН/CVV лимиты (мутационный инвариант: ПИН ровно 4) ---
test('ПИН: 5-я цифра не входит (лимит 4)', () => {
  const pinMask = liveMaskFor('cards', 'pin');
  assert.equal(pinMask('12345'), '1234');
  assert.equal(pinMask('1234'), '1234');
  assert.equal(pinMask('12'), '12');
  assert.equal(onlyDigits('123456789', 4), '1234');
});

test('CVV: лимит 4 цифры (Amex), буквы отброшены', () => {
  const cvvMask = liveMaskFor('cards', 'cvv');
  assert.equal(cvvMask('123'), '123');
  assert.equal(cvvMask('1234'), '1234', 'Amex: 4-значный код не обрезается');
  assert.equal(cvvMask('12345'), '1234');
  assert.equal(cvvMask('9a9a9a9'), '9999');
});

// --- п.8 strip пробелов в URL (мутационный инвариант) ---
test('URL: автоудаление пробелов при вводе', () => {
  assert.equal(stripSpaces('example .com'), 'example.com');
  assert.equal(stripSpaces('example .com / a b c'), 'example.com/abc');
  assert.equal(stripSpaces(' h t t p s://x '), 'https://x');
  const urlMask = liveMaskFor('passwords', 'url');
  assert.equal(urlMask('a b .c'), 'ab.c');
  assert.equal(liveMaskFor('wallets', 'url')('w w w'), 'www');
});

// --- п.3 латиница имени владельца ---
test('имя владельца: кириллица вырезается, латиница остаётся, флаг hadCyrillic', () => {
  const r = latinOnly('Иван IVAN');
  assert.equal(r.value.replace(/\s+/g, ' ').trim(), 'IVAN');
  assert.equal(r.hadCyrillic, true);
  const clean = latinOnly('IVAN IVANOV');
  assert.equal(clean.value, 'IVAN IVANOV');
  assert.equal(clean.hadCyrillic, false);
});

// --- имя владельца: чистка пробелов после вырезания кириллицы (находка ревью) ---
test('имя владельца: ведущий пробел от вырезанной кириллицы убирается', () => {
  assert.equal(latinOnly('Иван IVANOV').value, 'IVANOV');   // «Иван » -> «IVANOV», без ведущего пробела
});
test('имя владельца: двойной пробел между словами схлопывается', () => {
  assert.equal(latinOnly('IVAN ИВАНОВ PETROV').value, 'IVAN PETROV');   // не «IVAN  PETROV»
});
test('имя владельца: хвостовой одиночный пробел сохраняется (чтобы дописать фамилию)', () => {
  assert.equal(latinOnly('IVAN ').value, 'IVAN ');
});

// --- п.7 клавиатуры по типу поля ---
test('fieldInputProps: номерные → numeric, URL → url, лимиты ПИН/CVV', () => {
  assert.equal(fieldInputProps('cards', 'number').inputMode, 'numeric');
  assert.equal(fieldInputProps('cards', 'expiry').inputMode, 'numeric');
  assert.equal(fieldInputProps('cards', 'cvv').maxLength, 4);   // Amex - 4 цифры
  assert.equal(fieldInputProps('cards', 'pin').maxLength, 4);
  assert.equal(fieldInputProps('cards', 'holder').lang, 'en');
  assert.equal(fieldInputProps('passwords', 'url').inputMode, 'url');
  assert.equal(fieldInputProps('wallets', 'url').inputMode, 'url');
  assert.equal(fieldInputProps('notes', 'text'), null); // обычное поле — без спецатрибутов
});

test('liveMaskFor: поля без маски → null', () => {
  assert.equal(liveMaskFor('notes', 'text'), null);
  assert.equal(liveMaskFor('cards', 'bank'), null);
  assert.equal(liveMaskFor('cards', 'holder'), null); // имя идёт через latinOnly (нужен флаг)
});
