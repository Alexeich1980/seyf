// fieldnorm.test.mjs — регистры/формат по полям (спека 8b п.5). Под мутацию: seed lower,
// адрес кошелька без смены регистра.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFieldValue, digitsOnly, base32Normalize } from '../www/js/fieldnorm.js';

test('seed.phrase → строчные (trim + lower) [мутация]', () => {
  assert.equal(normalizeFieldValue('seed', 'phrase', '  Alpha BETA GamMa '), 'alpha beta gamma');
});

test('wallets.number (адрес EVM) — регистр НЕ меняется [мутация]', () => {
  const addr = '0xAbC12dEF34aB99Cd00eeFf1122334455667788Aa';
  assert.equal(normalizeFieldValue('wallets', 'number', addr), addr);
});

test('seed.passphrase (25-е слово) — регистр НЕ трогаем (BIP-39 passphrase чувствительна)', () => {
  assert.equal(normalizeFieldValue('seed', 'passphrase', 'MySecret Word'), 'MySecret Word');
});

test('пароль — регистр не трогаем', () => {
  assert.equal(normalizeFieldValue('passwords', 'password', 'Aa-Bb_Cc'), 'Aa-Bb_Cc');
});

test('карта: номер/CVV/ПИН — только цифры', () => {
  assert.equal(normalizeFieldValue('cards', 'number', '1234 5678 90ab 1111'), '12345678901111');
  assert.equal(normalizeFieldValue('cards', 'cvv', 'a1b2c3'), '123');
  assert.equal(normalizeFieldValue('cards', 'pin', ' 0 0 0 0 '), '0000');
  assert.equal(digitsOnly('a1-2 3'), '123');
});

test('TOTP-секрет → верхний регистр base32, без пробелов/дефисов/=', () => {
  assert.equal(normalizeFieldValue('totp', 'secret', 'jbsw y3dp-ehpk3pxp==='), 'JBSWY3DPEHPK3PXP');
  assert.equal(base32Normalize('a b-c='), 'ABC');
});

test('поле без правила → как есть (только приведение к строке)', () => {
  assert.equal(normalizeFieldValue('notes', 'text', 'Любой Текст'), 'Любой Текст');
  assert.equal(normalizeFieldValue('notes', 'text', null), '');
});
