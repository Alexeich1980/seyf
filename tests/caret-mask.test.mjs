// caret-mask.test.mjs - каретка при живой маске (1.2.22, баг живого теста Алексея: правка даты в
// середине -> каретка улетала в конец, Backspace удалял не тот символ). Чистая reformatWithCaret
// (fieldinput.js): считает значимые символы (цифры) слева от каретки до маски и ставит каретку
// после того же числа цифр в отформатированном значении; Backspace/Delete по разделителю удаляет
// соседнюю цифру. Мутация: вернуть каретку в конец (caret: value.length) -> тесты краснеют.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reformatWithCaret, formatCardNumber, stripSpaces, isNonSpace } from '../www/js/fieldinput.js';
import { formatDocDate } from '../www/js/documents.js';
import { formatExpiry } from '../www/js/cardexp.js';

// Эмуляция браузера: из prev с кареткой/выделением применяем правку, как это делает поле ввода.
function backspace(prev, caret) {
  return { raw: prev.slice(0, caret - 1) + prev.slice(caret), caret: caret - 1, prev, inputType: 'deleteContentBackward' };
}
function del(prev, caret) {
  return { raw: prev.slice(0, caret) + prev.slice(caret + 1), caret, prev, inputType: 'deleteContentForward' };
}
function typeAt(prev, caret, text) {
  return { raw: prev.slice(0, caret) + text + prev.slice(caret), caret: caret + text.length, prev, inputType: 'insertText' };
}
const run = (ev, fmt, isSig) => reformatWithCaret(ev.raw, ev.caret, fmt, { prev: ev.prev, inputType: ev.inputType, isSig });

test('дата: Backspace в середине удаляет нужную цифру, каретка остаётся на месте (не в конце)', () => {
  // «12.05.2024», каретка после «5» (позиция 5) -> Backspace удаляет «5»
  const r = run(backspace('12.05.2024', 5), formatDocDate);
  assert.equal(r.value, '12.02.024');       // цифры 1202024 -> маска
  assert.equal(r.caret, 4);                 // сразу после «0» (1,2,.,0)
  assert.notEqual(r.caret, r.value.length);
});
test('дата: Backspace сразу после точки удаляет цифру ПЕРЕД точкой, а не упирается в точку', () => {
  // «12.05.2024», каретка после первой точки (позиция 3) -> удаляется «2»
  const r = run(backspace('12.05.2024', 3), formatDocDate);
  assert.equal(r.value, '10.52.024');       // цифры 1052024
  assert.equal(r.caret, 1);                 // после «1»
  // после второй точки (позиция 6) -> удаляется «5»
  const r2 = run(backspace('12.05.2024', 6), formatDocDate);
  assert.equal(r2.value, '12.02.024');
  assert.equal(r2.caret, 4);
});
test('дата: Delete перед точкой удаляет цифру ПОСЛЕ точки', () => {
  const r = run(del('12.05.2024', 2), formatDocDate);   // каретка перед первой точкой
  assert.equal(r.value, '12.52.024');                   // удалён «0»
  assert.equal(r.caret, 2);
});
test('дата: вставка цифры в середину - каретка сразу после вставленной цифры', () => {
  // «12.05.2024», убрали «5» ранее -> «12.02.024»; вставляем «5» после «0» (позиция 4)
  const r = run(typeAt('12.02.024', 4, '5'), formatDocDate);
  assert.equal(r.value, '12.05.2024');
  assert.equal(r.caret, 5);                  // после «5», не в конце (10)
});
test('дата: вставка перед точкой перескакивает через авто-точку', () => {
  const r = run(typeAt('12', 2, '0'), formatDocDate);   // печать третьей цифры
  assert.equal(r.value, '12.0');
  assert.equal(r.caret, 4);
});
test('дата: удаление в самом начале - каретка в начале', () => {
  const r = run(backspace('12.05.2024', 1), formatDocDate);   // удаляем «1»
  assert.equal(r.value, '20.52.024');
  assert.equal(r.caret, 0);
});
test('дата: полная строка в конце - каретка в конце, значение не меняется', () => {
  const r = run(typeAt('12.05.202', 9, '4'), formatDocDate);
  assert.equal(r.value, '12.05.2024');
  assert.equal(r.caret, 10);
});
test('дата: короткий год ДД.ММ.ГГ - Backspace в середине года', () => {
  // «01.02.29», каретка между 2 и 9 (позиция 7) -> удаляется «2»
  const r = run(backspace('01.02.29', 7), formatDocDate);
  assert.equal(r.value, '01.02.9');
  assert.equal(r.caret, 6);                  // маска значение не меняла - каретка где была
    const r2 = run(backspace('01.02.29', 6), formatDocDate);
  // «01.02.29», каретка после второй точки (позиция 6): удаляется «2» месяца, цифры 01029
  assert.equal(r2.value, '01.02.9');
  assert.equal(r2.caret, 4);                 // после «0» месяца (0,1,.,0)
});
test('срок карты ММ/ГГ: Backspace после слэша удаляет цифру месяца', () => {
  // «12/29», каретка после слэша (позиция 3) -> удаляется «2» месяца: цифры 129 -> «12/9»
  const r = run(backspace('12/29', 3), formatExpiry);
  assert.equal(r.value, '12/9');
  assert.equal(r.caret, 1);                  // после «1»
});
test('номер карты: Backspace в середине группы не уводит каретку в конец', () => {
  // «1234 5678 9012 3456», удаляем «6» (каретка после «6» = позиция 7)
  const r = run(backspace('1234 5678 9012 3456', 7), formatCardNumber);
  assert.equal(r.value, '1234 5789 0123 456');
  assert.equal(r.caret, 6);
  // Backspace сразу после пробела-разделителя удаляет «4»
  const r2 = run(backspace('1234 5678', 5), formatCardNumber);
  assert.equal(r2.value, '1235 678');
  assert.equal(r2.caret, 3);
});
test('ссылка (stripSpaces): вставленный в середину пробел вырезан, каретка на месте', () => {
  const r = run(typeAt('example.com', 3, ' '), stripSpaces, isNonSpace);
  assert.equal(r.value, 'example.com');
  assert.equal(r.caret, 3);
});
test('значение не изменилось маской - каретка там, где её оставил браузер', () => {
  const r = reformatWithCaret('12.05.2024', 4, formatDocDate, {});
  assert.equal(r.value, '12.05.2024');
  assert.equal(r.caret, 4);
});
