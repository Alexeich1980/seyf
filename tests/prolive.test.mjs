// prolive.test.mjs — «живой» бейдж PRO/FREE после активации Полной версии (правка ревью).
// Баг: после активации лицензионного ключа бейдж #menuPlan оставался FREE, пока меню
// открыто. Фикс: единый путь успеха unlock() сразу перерисовывает статус меню
// (updateMenuInfo). Заслон двухслойный:
//   1) ЛОГИКА: markPro(vault) переводит isPro → true (то, что читает бейдж);
//   2) ПРОВОДКА (source-guard): unlock() обязан звать updateMenuInfo(), а updateMenuInfo
//      обязан рисовать #menuPlan из isPro. Без вызова бейдж снова «застынет».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPro, markPro } from '../www/js/gate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');

test('markPro переводит vault в PRO (состояние, которое читает бейдж)', () => {
  const vault = { sections: {} };
  assert.equal(isPro(vault), false, 'до активации — FREE');
  markPro(vault, { source: 'license', purchaseId: 'test-1' });
  assert.equal(isPro(vault), true, 'после активации ключом — PRO');
});

test('unlock() перерисовывает меню сразу после успеха (updateMenuInfo)', () => {
  const m = APP.match(/const unlock = async \(info(?:, \w+)*\) => \{([\s\S]*?)\n  \};/);
  assert.ok(m, 'нашли тело unlock()');
  assert.match(m[1], /updateMenuInfo\(\)/,
    'unlock() обязан звать updateMenuInfo() — иначе бейдж PRO/FREE застынет при открытом меню');
});

test('updateMenuInfo() рисует бейдж #menuPlan из isPro (PRO/FREE)', () => {
  const m = APP.match(/function updateMenuInfo\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'нашли тело updateMenuInfo()');
  const body = m[1];
  assert.match(body, /#menuPlan/, 'updateMenuInfo трогает бейдж #menuPlan');
  assert.match(body, /vaultIsPro\(/, 'бейдж считается из vaultIsPro (Gate.isPro с проверкой источника)');
  assert.match(body, /'PRO'/, 'есть подпись PRO');
  assert.match(body, /'FREE'/, 'есть подпись FREE');
});
