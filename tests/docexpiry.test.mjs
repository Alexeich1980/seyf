// docexpiry.test.mjs — РАТЧЕТ 18 п.10 (СМЕНА решения 8e п.13): срок действия ДОКУМЕНТА
// вводится полной датой ДД.ММ.ГГГГ цифрами с маской, НЕ календарём и НЕ ММ/ГГ. Карты
// по-прежнему ММ/ГГ (см. cardexp.test.mjs). Тест держит заслоны:
//   1) в редакторе документов НЕТ нативного date-picker (input type="date") для срока;
//   2) поле срока документа — полная дата ДД.ММ.ГГГГ с цифровой клавиатурой;
//   3) статус срока считается из ДД.ММ.ГГГГ (и старые ММ/ГГ и ISO ещё понимаются).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expiryStatus, expiryEndMs, expiryDaysLeft, formatDocDate, parseDocDate, formatDocExpiryDisplay,
} from '../www/js/documents.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');

test('ратчет: в app.js нет date-picker для срока (никакого type="date" на expiry)', () => {
  assert.equal(/type=["']date["'][^>]*data-key=["']expiry["']/.test(APP), false,
    'найден календарный input для срока — срок должен быть текстовой полной датой');
  assert.equal(/data-key=["']expiry["'][^>]*type=["']date["']/.test(APP), false,
    'найден календарный input для срока (обратный порядок атрибутов)');
});

test('ратчет: редактор документа даёт срок как текст ДД.ММ.ГГГГ с цифровой клавиатурой', () => {
  assert.match(APP, /placeholder=["']ДД\.ММ\.ГГГГ["'][^>]*data-key=["']expiry["']|data-key=["']expiry["'][^>]*placeholder=["']ДД\.ММ\.ГГГГ["']/);
  assert.match(APP, /inputmode=["']numeric["']/);
});

// --- маска и разбор полной даты ---

test('formatDocDate: прогрессивная маска цифр в ДД.ММ.ГГГГ', () => {
  assert.equal(formatDocDate(''), '');
  assert.equal(formatDocDate('3'), '3');
  assert.equal(formatDocDate('31'), '31');
  assert.equal(formatDocDate('3112'), '31.12');
  assert.equal(formatDocDate('31122029'), '31.12.2029');
  assert.equal(formatDocDate('31.12.2029'), '31.12.2029');
  assert.equal(formatDocDate('311220291'), '31.12.2029');  // лишнее отбрасывается
});

test('parseDocDate: валидна реальная календарная дата', () => {
  assert.equal(parseDocDate('31.12.2029').valid, true);
  assert.equal(parseDocDate('29.02.2028').valid, true);    // високосный
  assert.equal(parseDocDate('29.02.2027').valid, false);   // не високосный
  assert.equal(parseDocDate('31.04.2029').valid, false);   // в апреле 30 дней
  assert.equal(parseDocDate('00.01.2029').valid, false);
  assert.equal(parseDocDate('10.13.2029').valid, false);   // месяц 13
});

// --- п.5: смягчение валидации даты (2-значный год ДД.ММ.ГГ тоже валиден) ---

test('parseDocDate: короткий год ДД.ММ.ГГ валиден и разворачивается в 20ГГ (п.5)', () => {
  const p = parseDocDate('10.10.29');
  assert.equal(p.valid, true);           // раньше было false («год неполный») - теперь принимаем
  assert.equal(p.text, '10.10.2029');    // канонический вид с полным годом
  assert.equal(parseDocDate('29.02.28').valid, true);   // 2028 високосный
  assert.equal(parseDocDate('29.02.27').valid, false);  // 2027 не високосный
  assert.equal(parseDocDate('10.1.29').valid, false);   // 5 цифр - неполно
  assert.equal(parseDocDate('311229').valid, true);     // без точек, 6 цифр
  assert.equal(parseDocDate('311229').text, '31.12.2029');
});

test('expiryEndMs: короткий год ДД.ММ.ГГ понимается как 20ГГ (п.5)', () => {
  const a = expiryEndMs('31.12.29');
  const bnum = expiryEndMs('31.12.2029');
  assert.equal(a, bnum);
  assert.ok(Number.isNaN(expiryEndMs('31.13.29')));    // месяц 13
});

test('formatDocExpiryDisplay: показ ДД.ММ.ГГГГ, старый ISO → ДД.ММ.ГГГГ, ММ/ГГ как есть', () => {
  assert.equal(formatDocExpiryDisplay('31.12.2029'), '31.12.2029');
  assert.equal(formatDocExpiryDisplay('2029-12-31'), '31.12.2029');
  assert.equal(formatDocExpiryDisplay('12/29'), '12/29');
  assert.equal(formatDocExpiryDisplay(''), '');
});

// --- статус срока ---

test('expiryEndMs: полная дата → конец указанного дня', () => {
  const end = new Date(expiryEndMs('31.12.2029'));
  assert.equal(end.getFullYear(), 2029);
  assert.equal(end.getMonth(), 11);
  assert.equal(end.getDate(), 31);
});

test('expiryEndMs: битая полная дата → NaN', () => {
  assert.ok(Number.isNaN(expiryEndMs('31.13.2029')));   // месяц 13
  assert.ok(Number.isNaN(expiryEndMs('31.04.2029')));   // апрель 31
  assert.ok(Number.isNaN(expiryEndMs('')));
});

test('expiryStatus: истёкший / скоро / в норме по полной дате', () => {
  const now = new Date('2026-09-14T12:00:00Z').getTime();
  assert.equal(expiryStatus('01.01.2020', now), 'expired');
  assert.equal(expiryStatus('20.09.2026', now), 'soon');   // в пределах 30 дней
  assert.equal(expiryStatus('31.12.2030', now), 'ok');
  assert.equal(expiryStatus('', now), 'none');
});

test('совместимость: старый ММ/ГГ и ISO ещё понимаются', () => {
  const now = new Date('2026-09-14T12:00:00Z').getTime();
  assert.equal(expiryStatus('01/20', now), 'expired');
  assert.equal(expiryStatus('12/30', now), 'ok');
  assert.equal(expiryStatus('2020-01-01', now), 'expired');
  assert.equal(expiryStatus('2030-01-01', now), 'ok');
});

// --- п.3: бейдж срока (граничные 30/31/0/-1). expiryStatus решает цвет, expiryDaysLeft — N. ---
// Строим now ОТНОСИТЕЛЬНО конца указанного дня (endMs), чтобы разница была ровно k суток по
// границе бейджа. Мутация: сдвиг границы «diff <= 30*DAY» → «< 30*DAY» или смена знака/округления
// в expiryDaysLeft ломает эти проверки (30 перестаёт быть 'soon', N съезжает) - тест краснеет.
const DAYMS = 86400000;
const DATE = '14.02.2026';
const endMs = expiryEndMs(DATE);   // конец дня 14.02.2026

test('бейдж (п.3): 30 дней → soon, 31 → ok, истекает сегодня(0+) → soon, вчера(-1) → expired', () => {
  assert.equal(expiryStatus(DATE, endMs - 30 * DAYMS), 'soon');   // ровно 30 - ещё янтарный
  assert.equal(expiryStatus(DATE, endMs - 31 * DAYMS), 'ok');     // 31 - уже спокойный
  assert.equal(expiryStatus(DATE, endMs - 1), 'soon');            // истекает сегодня вечером
  assert.equal(expiryStatus(DATE, endMs + DAYMS), 'expired');     // сутки как просрочен
});

// C5 (1.2.23): календарные дни (полночь к полуночи). Срок, кончающийся сегодня, - 0 («истекает
// сегодня»), а не «через 1 дн.» (так было при округлении 24-часовых отрезков вверх).
test('expiryDaysLeft: N календарных дней до дня окончания; сегодня = 0; NaN на мусоре', () => {
  assert.equal(expiryDaysLeft(DATE, endMs - 30 * DAYMS), 30);     // ровно 30 суток
  assert.equal(expiryDaysLeft(DATE, endMs - 1), 0);              // тот же день → «истекает сегодня»
  assert.equal(expiryDaysLeft(DATE, endMs - 15 * DAYMS + 100), 14);  // 31.01 00:00 -> 14.02: 14 календарных дней
  assert.ok(expiryDaysLeft(DATE, endMs + DAYMS) < 0);            // просрочка - отрицательное (бейдж «истёк»)
  assert.ok(Number.isNaN(expiryDaysLeft('', Date.now())));
  assert.ok(Number.isNaN(expiryDaysLeft('не дата', Date.now())));
});
