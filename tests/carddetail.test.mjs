// carddetail.test.mjs — логика разворота карточки на месте (заход 2 п.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardOpenMode, nextExpanded, expandActions } from '../www/js/carddetail.js';

test('cardOpenMode: ВСЁ разворачивается на месте, включая документы со сканами (п.11)', () => {
  // Документы больше не открывают полноэкранный скан сразу по тапу - тоже разворот.
  assert.equal(cardOpenMode('documents', { pages: [{ id: 1 }] }), 'expand');
  assert.equal(cardOpenMode('documents', { pages: [] }), 'expand');
  assert.equal(cardOpenMode('documents', {}), 'expand');
  for (const s of ['passwords', 'cards', 'wallets', 'seed', 'notes', 'contacts', 'wifi', 'requisites', 'totp']) {
    assert.equal(cardOpenMode(s, { pages: [{ id: 1 }] }), 'expand', s + ' должен разворачиваться на месте');
  }
});

test('nextExpanded: тумблер сворачивает/разворачивает', () => {
  assert.equal(nextExpanded(false), true);
  assert.equal(nextExpanded(true), false);
});

test('expandActions: правка/удаление всегда; «Копировать все» - у Реквизитов; «Открыть сканы» больше нет (D2)', () => {
  const req = expandActions('requisites', {});
  assert.deepEqual(req, { edit: true, del: true, share: true, open: false });
  // Кнопки «Открыть сканы» нет ни у кого (D2): скан открывается тапом по превью.
  assert.equal(expandActions('documents', { pages: [{ id: 1 }] }).open, false);
  assert.equal(expandActions('documents', { pages: [] }).open, false);
  assert.equal(expandActions('documents', {}).open, false);
  for (const s of ['passwords', 'cards', 'contacts', 'wifi', 'notes']) {
    const a = expandActions(s, {});
    assert.equal(a.edit, true);
    assert.equal(a.del, true);
    assert.equal(a.share, false, s + ' не должен иметь «Копировать все реквизиты»');
    assert.equal(a.open, false, s + ' не должен иметь «Открыть сканы»');
  }
});
