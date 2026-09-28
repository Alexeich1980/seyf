// seed-networks.test.mjs — список сетей для поля «Сеть / тип» seed-фраз (заход 2 п.17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_NETWORKS, isKnownNetwork } from '../www/js/seed-networks.js';

test('5 сетей в нужном порядке (заход 3 п.8: BNB/Litecoin/Dogecoin убраны)', () => {
  assert.deepEqual(SEED_NETWORKS, ['Bitcoin', 'Ethereum', 'TON', 'Tron', 'Solana']);
});

test('isKnownNetwork: известная сеть → true, иное/пусто → false («Другое»)', () => {
  assert.equal(isKnownNetwork('Bitcoin'), true);
  assert.equal(isKnownNetwork(' Solana '), true);
  assert.equal(isKnownNetwork('MyChain'), false);
  assert.equal(isKnownNetwork(''), false);
  assert.equal(isKnownNetwork(null), false);
});
