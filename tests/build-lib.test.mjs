import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readVersion, versionCodeOf, resolveVersionCode } from '../build-lib.js';

test('versionCodeOf: релиз-бит и монотонный рост', () => {
  assert.equal(versionCodeOf('0.1.0', false), 200);
  assert.equal(versionCodeOf('0.1.0', true), 201);
  assert.equal(versionCodeOf('1.2.3', true), (10000 + 200 + 3) * 2 + 1); // 20407
  assert.ok(versionCodeOf('0.1.1', true) > versionCodeOf('0.1.0', true));
});

test('readVersion читает X.Y.Z и бракует мусор', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seyf-'));
  const good = path.join(dir, 'good.json');
  fs.writeFileSync(good, JSON.stringify({ version: '0.1.0' }));
  assert.equal(readVersion(good), '0.1.0');
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ version: 'v1' }));
  assert.throws(() => readVersion(bad), /X\.Y\.Z/);
});

test('resolveVersionCode: без флага = versionCodeOf, с флагом - только окно пересборки релиза', () => {
  assert.equal(resolveVersionCode('1.3.1', true, []), 20603);
  assert.equal(resolveVersionCode('1.3.1', false, []), 20602);
  assert.equal(resolveVersionCode('1.3.1', true, ['--store', '--version-code=20604']), 20604);
  assert.equal(resolveVersionCode('1.3.1', true, [], { SEYF_VERSION_CODE: '20604' }), 20604);
  assert.throws(() => resolveVersionCode('1.3.1', true, ['--version-code=20603']), /вне окна/); // не выше прежнего
  assert.throws(() => resolveVersionCode('1.3.1', true, ['--version-code=20605']), /вне окна/); // = релиз 1.3.2
  assert.throws(() => resolveVersionCode('1.3.1', false, ['--version-code=20604']), /только для/);
  assert.throws(() => resolveVersionCode('1.3.1', true, ['--version-code=abc']), /целым/);
});
