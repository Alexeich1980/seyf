import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../www/js/crypto.js';

// Биометрия хранит случайный bioKey в Keystore; сам DEK обёрнут этим ключом в helloWrap.
// Здесь проверяем именно крипто-контракт, на котором стоит auth.js (нативную часть — на устройстве).
test('bioKey оборачивает и разворачивает DEK через helloWrap', async () => {
  const vault = { version: 1, sections: { passwords: [{ id: '1', description: 'X' }] } };
  const file = await C.newVaultFile('длинный-мастер-пароль', vault);
  const { dekRaw } = await C.unlockWithPassword(file, 'длинный-мастер-пароль');
  const bioKey = C.randomBytes(32);                       // то, что ляжет в Keystore
  const file2 = await C.attachHelloRaw(file, dekRaw, bioKey, new Uint8Array(0));
  assert.ok(file2.helloWrap, 'привязка проставила helloWrap');
  const { vault: back } = await C.unlockWithHello(file2, bioKey);
  assert.deepEqual(back, vault);
});

test('чужой bioKey не разворачивает DEK', async () => {
  const file = await C.newVaultFile('пароль-фраза-раз-два', { version: 1, sections: {} });
  const { dekRaw } = await C.unlockWithPassword(file, 'пароль-фраза-раз-два');
  const file2 = await C.attachHelloRaw(file, dekRaw, C.randomBytes(32), new Uint8Array(0));
  await assert.rejects(() => C.unlockWithHello(file2, C.randomBytes(32)));
});
