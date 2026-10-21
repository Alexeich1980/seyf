// navmodel.test.mjs — чистая логика навигации витрина↔раздел и системной «Назад» (8f).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backAction, sectionCounts, refreshPlan } from '../www/js/navmodel.js';
import * as Store from '../www/js/store.js';

test('back: модалка закрывается раньше всего', () => {
  assert.equal(backAction({ hasModal: true, menuOpen: true, view: 'section', demoMasterVisible: true }), 'closeModal');
});
test('back: меню закрывается раньше смены экрана', () => {
  assert.equal(backAction({ hasModal: false, menuOpen: true, view: 'section' }), 'closeMenu');
});
test('back из раздела → на витрину', () => {
  assert.equal(backAction({ hasModal: false, menuOpen: false, view: 'section' }), 'toGrid');
});
test('back с витрины → выход (нативно)', () => {
  assert.equal(backAction({ hasModal: false, menuOpen: false, view: 'grid' }), 'exit');
});
test('back: создание мастер-пароля из демо → назад в демо (только на витрине)', () => {
  assert.equal(backAction({ hasModal: false, menuOpen: false, view: 'grid', demoMasterVisible: true }), 'toDemo');
});

const SECTIONS = ['passwords', 'cards', 'wallets', 'seed', 'documents', 'notes', 'totp'];
test('счётчики плиток: длина массива раздела, нули по умолчанию', () => {
  const vault = { sections: { passwords: [1, 2, 3], cards: [], totp: [{}, {}] } };
  const c = sectionCounts(vault, SECTIONS);
  assert.equal(c.passwords, 3);
  assert.equal(c.cards, 0);
  assert.equal(c.totp, 2);
  assert.equal(c.seed, 0);         // раздел не заведён → 0, не падаем
});
test('счётчики: битый/пустой vault → все нули', () => {
  for (const v of [null, {}, { sections: null }]) {
    const c = sectionCounts(v, SECTIONS);
    for (const s of SECTIONS) assert.equal(c[s], 0);
  }
});

// --- refreshPlan: что перерисовать после мутации (находка ревью: счётчики застывали,
//     а правка из поиска подменяла результаты полным списком) ---
test('refreshPlan: витрина без поиска → перерисовать сетку (счётчики), список не трогаем', () => {
  const p = refreshPlan('grid', '');
  assert.equal(p.grid, true);
  assert.equal(p.list, null);
});
test('refreshPlan: витрина с поиском → сетка + результаты по запросу (поиск не сбрасывается)', () => {
  const p = refreshPlan('grid', 'сбер');
  assert.equal(p.grid, true);
  assert.equal(p.list, 'сбер');       // запрос сохранён, а не заменён полным списком
});
test('refreshPlan: пробельный запрос на витрине = нет поиска', () => {
  const p = refreshPlan('grid', '   ');
  assert.equal(p.grid, true);
  assert.equal(p.list, null);
});
test('refreshPlan: в разделе → список раздела, сетку не трогаем', () => {
  const p = refreshPlan('section', '');
  assert.equal(p.grid, false);
  assert.equal(p.list, '');
});

test('счётчик витрины растёт после добавления записи (add)', () => {
  const vault = Store.emptyVault();
  const before = sectionCounts(vault, SECTIONS).passwords;
  Store.createEntry(vault, 'passwords', { description: 'Почта', login: 'a@b.c' });
  const after = sectionCounts(vault, SECTIONS).passwords;
  assert.equal(after, before + 1);   // источник счётчика плитки видит новую запись
});
