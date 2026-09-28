// biopref.test.mjs — выбор способа входа: флаг «вход по отпечатку/лицу» и чистое
// решение shouldOfferBio (показывать ли системный биозапрос при разблокировке).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIO_ENABLED_KEY, isBioLoginEnabled, setBioLoginEnabled, shouldOfferBio,
  PW_HINT_KEY, PW_HINT_MAX, getPasswordHint, setPasswordHint, hintLeaksPassword,
} from '../www/js/biopref.js';

function fakeStorage(initial) {
  const m = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}
// storage, у которого доступ бросает (приватный режим/заблокированные данные).
const throwingStorage = {
  getItem() { throw new Error('нет доступа'); },
  setItem() { throw new Error('нет доступа'); },
};

test('по умолчанию (ключ не задан) вход по отпечатку включён', () => {
  assert.equal(isBioLoginEnabled(fakeStorage()), true);
});

test('битое/недоступное storage → дефолт вкл, не падаем', () => {
  assert.equal(isBioLoginEnabled(null), true);
  assert.equal(isBioLoginEnabled(throwingStorage), true);
});

test('setBioLoginEnabled(false) сохраняет 0 и читается как выкл', () => {
  const st = fakeStorage();
  assert.equal(setBioLoginEnabled(st, false), false);
  assert.equal(st._map.get(BIO_ENABLED_KEY), '0');
  assert.equal(isBioLoginEnabled(st), false);
});

test('setBioLoginEnabled(true) сохраняет 1 и читается как вкл', () => {
  const st = fakeStorage({ [BIO_ENABLED_KEY]: '0' });
  assert.equal(setBioLoginEnabled(st, true), true);
  assert.equal(st._map.get(BIO_ENABLED_KEY), '1');
  assert.equal(isBioLoginEnabled(st), true);
});

test('запись в недоступное storage не бросает, возвращает выбранное значение', () => {
  assert.equal(setBioLoginEnabled(throwingStorage, false), false);
  assert.equal(setBioLoginEnabled(null, true), true);
});

test('shouldOfferBio: все три условия обязательны', () => {
  assert.equal(shouldOfferBio({ hasHelloWrap: true, bioAvailable: true, enabled: true }), true);
});

test('shouldOfferBio: выключено пользователем → сразу мастер-пароль', () => {
  assert.equal(shouldOfferBio({ hasHelloWrap: true, bioAvailable: true, enabled: false }), false);
});

test('shouldOfferBio: нет обёрнутого ключа → нет биозапроса', () => {
  assert.equal(shouldOfferBio({ hasHelloWrap: false, bioAvailable: true, enabled: true }), false);
});

test('shouldOfferBio: биометрия недоступна на телефоне → нет биозапроса', () => {
  assert.equal(shouldOfferBio({ hasHelloWrap: true, bioAvailable: false, enabled: true }), false);
});

test('shouldOfferBio: отсутствующие поля трактуются как false', () => {
  assert.equal(shouldOfferBio({}), false);
});

// --- v3-auth-B: подсказка-напоминание к паролю (хранится в открытом виде) ---
test('подсказка: сохраняется и читается', () => {
  const st = fakeStorage();
  assert.equal(setPasswordHint(st, 'как в старой почте'), 'как в старой почте');
  assert.equal(st._map.get(PW_HINT_KEY), 'как в старой почте');
  assert.equal(getPasswordHint(st), 'как в старой почте');
});

test('подсказка: пустая строка удаляет ключ, нет подсказки → пусто', () => {
  const st = fakeStorage({ [PW_HINT_KEY]: 'что-то' });
  assert.equal(setPasswordHint(st, '   '), '');
  assert.equal(st._map.has(PW_HINT_KEY), false);
  assert.equal(getPasswordHint(fakeStorage()), '');
});

test('подсказка: обрезается до PW_HINT_MAX; storage-ошибки не роняют', () => {
  const st = fakeStorage();
  const long = 'x'.repeat(PW_HINT_MAX + 50);
  assert.equal(setPasswordHint(st, long).length, PW_HINT_MAX);
  assert.equal(getPasswordHint(throwingStorage), '');
  assert.equal(setPasswordHint(throwingStorage, 'a'), 'a');   // не бросает, возвращает применённое
  assert.equal(getPasswordHint(null), '');
});

// --- L3: подсказка не должна выдавать сам пароль ---
test('L3: подсказка = пароль → утечка', () => {
  assert.equal(hintLeaksPassword('correct horse', 'correct horse'), true);
});
test('L3: подсказка содержит пароль как подстроку → утечка (без учёта регистра)', () => {
  assert.equal(hintLeaksPassword('мой пароль Battery123 не забыть', 'battery123'), true);
  assert.equal(hintLeaksPassword('BATTERY', 'battery'), true);
});
test('L3: обычный намёк, не содержащий пароль → не утечка', () => {
  assert.equal(hintLeaksPassword('как в старой почте', 'Tr0ub4dour&3'), false);
});
test('L3: пустой пароль или пустая подсказка → не утечка (сравнивать нечего)', () => {
  assert.equal(hintLeaksPassword('', 'battery123'), false);
  assert.equal(hintLeaksPassword('намёк', ''), false);
  assert.equal(hintLeaksPassword(null, null), false);
  assert.equal(hintLeaksPassword('  ', 'battery'), false);
});
