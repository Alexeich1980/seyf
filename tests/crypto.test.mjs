import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../www/js/crypto.js';

test('AES round-trip: расшифровка возвращает исходные байты', async () => {
  const salt = C.randomBytes(16);
  const kek = await C.deriveKEK('длинная фраза-пароль', salt, 50000);
  const data = C.enc('секрет 🔐');
  const { iv, ct } = await C.aesEncrypt(kek, data);
  const back = await C.aesDecrypt(kek, iv, ct);
  assert.equal(C.dec(back), 'секрет 🔐');
});

test('DEK wrap/unwrap возвращает те же 32 байта', async () => {
  const salt = C.randomBytes(16);
  const kek = await C.deriveKEK('мастер', salt, 50000);
  const dek = C.randomBytes(32);
  const w = await C.wrapDEK(kek, dek);
  const back = await C.unwrapDEK(kek, w.iv, w.ct);
  assert.deepEqual([...back], [...dek]);
});

test('encryptJSON/decryptJSON сохраняет объект', async () => {
  const dek = await C.importDEK(C.randomBytes(32));
  const obj = { a: 1, s: 'привет', arr: [1, 2, 3] };
  const { iv, ct } = await C.encryptJSON(dek, obj);
  assert.deepEqual(await C.decryptJSON(dek, iv, ct), obj);
});

test('неверный пароль не расшифровывает', async () => {
  const salt = C.randomBytes(16);
  const k1 = await C.deriveKEK('верный', salt, 50000);
  const k2 = await C.deriveKEK('неверный', salt, 50000);
  const { iv, ct } = await C.aesEncrypt(k1, C.enc('данные'));
  await assert.rejects(() => C.aesDecrypt(k2, iv, ct));
});

test('newVaultFile + unlockWithPassword round-trip', async () => {
  const vault = { version: 1, sections: { passwords: [{ id: '1', description: 'X' }] } };
  const file = await C.newVaultFile('мой длинный мастер-пароль', vault);
  assert.equal(file.v, 1);
  assert.ok(file.pwWrap && file.data);
  const { vault: back } = await C.unlockWithPassword(file, 'мой длинный мастер-пароль');
  assert.deepEqual(back, vault);
});

test('unlockWithPassword с неверным паролем падает', async () => {
  const file = await C.newVaultFile('верный-пароль-фраза', { version: 1, sections: {} });
  await assert.rejects(() => C.unlockWithPassword(file, 'другой-пароль'));
});

test('Hello: attach + unlockWithHello round-trip', async () => {
  const vault = { version: 1, sections: { notes: [] } };
  const file = await C.newVaultFile('пароль-фраза-раз-два', vault);
  const { dekRaw } = await C.unlockWithPassword(file, 'пароль-фраза-раз-два');
  const prf = C.randomBytes(32);
  const file2 = await C.attachHelloRaw(file, dekRaw, prf, C.randomBytes(16));
  assert.ok(file2.helloWrap);
  const { vault: back } = await C.unlockWithHello(file2, prf);
  assert.deepEqual(back, vault);
});

test('reencryptData сохраняет новые данные под тем же DEK', async () => {
  const file = await C.newVaultFile('фраза-пароль-для-теста', { version: 1, sections: { notes: [] } });
  const { dek } = await C.unlockWithPassword(file, 'фраза-пароль-для-теста');
  const file2 = await C.reencryptData(file, dek, { version: 1, sections: { notes: [{ id: 'a', title: 'T' }] } });
  const { vault } = await C.unlockWithPassword(file2, 'фраза-пароль-для-теста');
  assert.equal(vault.sections.notes.length, 1);
});
