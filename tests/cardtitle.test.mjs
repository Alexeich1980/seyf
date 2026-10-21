// cardtitle.test.mjs - заголовок карты без банка (находка ревью: карта только с номером
// показывалась как «(без названия)»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardFallbackTitle, needsCardFallbackTitle, fallbackTitleFor } from '../www/js/cardtitle.js';

test('нужен ли фолбэк: карта без непустого банка', () => {
  assert.equal(needsCardFallbackTitle({ number: '4111111111111234' }), true);
  assert.equal(needsCardFallbackTitle({ bank: '', number: '1234' }), true);
  assert.equal(needsCardFallbackTitle({ bank: '   ', number: '1234' }), true);
  assert.equal(needsCardFallbackTitle({ bank: 'Сбер' }), false);
});

test('фолбэк-заголовок: замаскированный номер по последним 4 цифрам', () => {
  assert.equal(cardFallbackTitle({ number: '4111 1111 1111 1234' }), 'Карта •••• 1234');
  assert.equal(cardFallbackTitle({ number: '4111111111111234' }), 'Карта •••• 1234');
});

test('фолбэк-заголовок: номера нет или он короткий → просто «Карта»', () => {
  assert.equal(cardFallbackTitle({}), 'Карта');
  assert.equal(cardFallbackTitle({ number: '' }), 'Карта');
  assert.equal(cardFallbackTitle({ number: '12' }), 'Карта');
  assert.equal(cardFallbackTitle(null), 'Карта');
});

// --- v3-4: чистый выбор фолбэк-заголовка Wi-Fi/Реквизитов ---
test('fallbackTitleFor: название задано → фолбэк не нужен (пустая строка)', () => {
  assert.equal(fallbackTitleFor('wifi', { name: 'Домашний', ssid: 'HomeNet' }), '');
  assert.equal(fallbackTitleFor('requisites', { name: 'Жена', bank: 'Сбер' }), '');
  assert.equal(fallbackTitleFor('wifi', { name: '   ', ssid: 'HomeNet' }), 'HomeNet'); // пробелы = пусто
});

test('fallbackTitleFor: Wi-Fi без названия → по имени сети (SSID)', () => {
  assert.equal(fallbackTitleFor('wifi', { ssid: 'HomeNet-5G' }), 'HomeNet-5G');
  assert.equal(fallbackTitleFor('wifi', { ssid: '' }), '');
  assert.equal(fallbackTitleFor('wifi', {}), '');
});

test('fallbackTitleFor: Реквизиты без названия → первое непустое поле по порядку', () => {
  assert.equal(fallbackTitleFor('requisites', { bank: 'Сбербанк', account: '123' }), 'Сбербанк');
  assert.equal(fallbackTitleFor('requisites', { bank: '', account: '40817' }), '40817');
  assert.equal(fallbackTitleFor('requisites', { inn: '7707' }), '7707');
  assert.equal(fallbackTitleFor('requisites', {}), '');
});

test('fallbackTitleFor: прочие разделы и оба пустых → пустая строка', () => {
  assert.equal(fallbackTitleFor('passwords', { description: 'x' }), '');
  assert.equal(fallbackTitleFor('wifi', null), '');
  assert.equal(fallbackTitleFor('requisites', null), '');
});
