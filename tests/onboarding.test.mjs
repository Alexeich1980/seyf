// onboarding.test.mjs — логика онбординга «Сейфа» (только мобайл, НЕ core).
// Старт-решение (демо / setup / unlock), правка формы мастер-пароля (8a: одно поле +
// «Показать пароль», повтор нужен только пока скрыт) и оценка сложности (8d п.1:
// жёсткого минимума нет — пользователь принимает слабый пароль на свою ответственность).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideStart, confirmVisible, masterStrength, validateMasterCreation, validateMasterPassword,
} from '../www/js/onboarding.js';

test('decideStart: существующий vault → unlock (демо НЕ показываем)', () => {
  assert.equal(decideStart({ hasVault: true, demoEnabled: true }), 'unlock');
  assert.equal(decideStart({ hasVault: true, demoEnabled: false }), 'unlock');
});

test('decideStart: первый запуск + демо включено → demo', () => {
  assert.equal(decideStart({ hasVault: false, demoEnabled: true }), 'demo');
});

test('decideStart: первый запуск + демо выключено (прод) → setup', () => {
  assert.equal(decideStart({ hasVault: false, demoEnabled: false }), 'setup');
});

test('confirmVisible: скрыто → нужен повтор; показано → повтор исчезает', () => {
  assert.equal(confirmVisible(false), true);
  assert.equal(confirmVisible(true), false);
});

// --- 8d п.1: оценка сложности мастер-пароля ---
test('masterStrength: пустой → level -1, не weak (форму блокирует отдельная проверка)', () => {
  const s = masterStrength('');
  assert.equal(s.level, -1);
  assert.equal(s.weak, false);
});

test('masterStrength: короткий/простой → weak с корректной подписью', () => {
  const s = masterStrength('abc');
  assert.equal(s.level, 0);
  assert.equal(s.label, 'крайне ненадёжный');
  assert.equal(s.weak, true);
});

test('masterStrength: длинная фраза → не weak, «хороший»/«надёжный»', () => {
  const s = masterStrength('Correct-Horse-Battery-Staple-2026');
  assert.ok(s.level >= 2, 'ожидали уровень 2+, получили ' + s.level);
  assert.equal(s.weak, false);
  assert.ok(['хороший', 'надёжный'].includes(s.label));
});

test('validateMasterCreation: пустой пароль не проходит никогда', () => {
  assert.equal(validateMasterCreation('', '', true, true).ok, false);
  assert.equal(validateMasterCreation('', '', false, false).ok, false);
});

test('validateMasterCreation: слабый БЕЗ согласия — не проходит, помечен weak', () => {
  const r = validateMasterCreation('abc', '', true, false);
  assert.equal(r.ok, false);
  assert.equal(r.weak, true);
});

test('validateMasterCreation: слабый С согласием — проходит', () => {
  assert.equal(validateMasterCreation('abc', '', true, true).ok, true);
});

test('validateMasterCreation: надёжный проходит без всякого согласия', () => {
  assert.equal(validateMasterCreation('Correct-Horse-Battery-Staple-2026', '', true, false).ok, true);
});

test('validateMasterCreation: скрыто → повтор обязателен и должен совпасть', () => {
  // сильный пароль, чтобы отсечь только проверку повтора
  const strong = 'Correct-Horse-Battery-Staple-2026';
  assert.equal(validateMasterCreation(strong, strong, false, false).ok, true);
  assert.equal(validateMasterCreation(strong, 'inoe', false, false).ok, false);
  assert.equal(validateMasterCreation(strong, '', false, false).ok, false);
});

test('validateMasterCreation: показано → повтор НЕ требуется', () => {
  const strong = 'Correct-Horse-Battery-Staple-2026';
  assert.equal(validateMasterCreation(strong, '', true, false).ok, true);
  assert.equal(validateMasterCreation(strong, 'что угодно', true, false).ok, true);
});

test('validateMasterPassword (обёртка совместимости): принимает слабый как согласованный', () => {
  assert.equal(validateMasterPassword('abc', 'abc', false).ok, true);
  assert.equal(validateMasterPassword('abc', 'inoe', false).ok, false); // повтор всё равно проверяется
});
