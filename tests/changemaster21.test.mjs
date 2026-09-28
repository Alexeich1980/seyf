// changemaster21.test.mjs — смена мастер-пароля (батч-21, bug4). Порядок: сначала ДЕЙСТВУЮЩИЙ
// пароль с проверкой, потом новый+повтор. Проверка действующего в app.js идёт через
// C.unlockWithPassword(state.file, cur): неверный БРОСАЕТ (не меняем), верный — расшифровывает.
// Тут проверяем сам крипто-примитив, на который опирается заслон, и что rewrap реально
// перевязывает vault на новый пароль (старый больше не открывает, новый открывает).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newVaultFile, unlockWithPassword, rewrapPassword } from '../www/js/crypto.js';

const VAULT = { version: 1, sections: { passwords: [{ id: 'x', login: 'a' }] } };

test('bug4: неверный ДЕЙСТВУЮЩИЙ пароль → unlockWithPassword бросает (смена не проходит)', async () => {
  const file = await newVaultFile('Staryy-Master-Parol-2026', VAULT);
  await assert.rejects(() => unlockWithPassword(file, 'ne-tot-parol'), 'неверный текущий должен бросать');
});

test('bug4: верный действующий пароль → расшифровывает, отдаёт dekRaw для перевязки', async () => {
  const file = await newVaultFile('Staryy-Master-Parol-2026', VAULT);
  const r = await unlockWithPassword(file, 'Staryy-Master-Parol-2026');
  assert.deepEqual(r.vault, VAULT);
  assert.ok(r.dekRaw && r.dekRaw.length === 32, 'dekRaw 32 байта для rewrapPassword');
});

test('bug4: после смены — СТАРЫЙ пароль не открывает, НОВЫЙ открывает, данные те же', async () => {
  const file = await newVaultFile('Staryy-Master-Parol-2026', VAULT);
  const { dekRaw } = await unlockWithPassword(file, 'Staryy-Master-Parol-2026');
  const changed = await rewrapPassword(file, dekRaw, 'Novyy-Dlinnyy-Master-2026');
  await assert.rejects(() => unlockWithPassword(changed, 'Staryy-Master-Parol-2026'), 'старый пароль больше не открывает');
  const r = await unlockWithPassword(changed, 'Novyy-Dlinnyy-Master-2026');
  assert.deepEqual(r.vault, VAULT, 'данные сохранились после перешифровки');
});
