// gate.test.mjs — free-гейт «Сейфа»: единая таблица лимитов, canAdd на границах,
// защита Pro-флага от подделки. Логика чистая (без DOM/крипто) — тестируется целиком.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FREE_LIMITS, PRO_PRICE_RUB, PRO_SOURCES, isPro, canAdd, markPro } from '../www/js/gate.js';
import { SECTIONS } from '../www/js/sections.js';

// Vault с заданным числом записей в разделе (остальные пустые). Опционально pro.
function vaultWith(section, count, pro) {
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, []]));
  for (let i = 0; i < count; i++) sections[section].push({ id: 'e' + i });
  const v = { version: 1, sections };
  if (pro !== undefined) v.pro = pro;
  return v;
}

const EXPECTED = {
  passwords: 7, cards: 3, documents: 3, wallets: 3, notes: 3, wifi: 3, totp: 1,
  seed: 1, contacts: 0, requisites: 0,
};

test('FREE_LIMITS: все 10 разделов с финальными числами (задание п.24)', () => {
  assert.deepEqual(FREE_LIMITS, EXPECTED);
  for (const s of SECTIONS) assert.ok(s in FREE_LIMITS, 'нет лимита для раздела ' + s);
  assert.equal(PRO_PRICE_RUB, 990);
});

// Границы для КАЖДОГО раздела: used<limit / used==limit / used>limit.
for (const [section, limit] of Object.entries(EXPECTED)) {
  // used<limit имеет смысл только когда лимит > 0 (для лимита 0 «ниже границы» не бывает).
  if (limit > 0) {
    test(`canAdd (${section}): used<limit → allowed, поля верны`, () => {
      const r = canAdd(vaultWith(section, limit - 1), section, false);
      assert.deepEqual(r, { allowed: true, limit, used: limit - 1 });
    });
  }
  test(`canAdd (${section}): used==limit → НЕ allowed (граница)`, () => {
    const r = canAdd(vaultWith(section, limit), section, false);
    assert.deepEqual(r, { allowed: false, limit, used: limit });
  });
  test(`canAdd (${section}): used>limit (импорт-перебор) → НЕ allowed`, () => {
    const r = canAdd(vaultWith(section, limit + 3), section, false);
    assert.equal(r.allowed, false);
    assert.equal(r.used, limit + 3);
  });
  test(`canAdd (${section}): isPro=true → всегда allowed, лимит снят`, () => {
    for (const used of [0, limit, limit + 10]) {
      const r = canAdd(vaultWith(section, used), section, true);
      assert.equal(r.allowed, true, `pro должен пускать при used=${used}`);
      assert.equal(r.limit, Infinity);
      assert.equal(r.used, used);
    }
  });
}

// Лимит 0 (избранные контакты, важные реквизиты): в FREE раздел закрыт для СОЗДАНИЯ с самой
// первой записи — даже при used=0 добавление не разрешено (ведёт в окно Pro). Pro снимает.
for (const section of ['contacts', 'requisites']) {
  test(`canAdd (${section}): лимит 0 → в FREE даже первая запись НЕ allowed`, () => {
    assert.equal(FREE_LIMITS[section], 0, `${section} должен иметь лимит 0`);
    const r = canAdd(vaultWith(section, 0), section, false);
    assert.deepEqual(r, { allowed: false, limit: 0, used: 0 });
  });
  test(`canAdd (${section}): лимит 0 + Pro → создание разрешено`, () => {
    assert.equal(canAdd(vaultWith(section, 0), section, true).allowed, true);
  });
}

test('canAdd: неизвестный раздел без лимита → безлимит (не блокируем лишнего)', () => {
  const v = { version: 1, sections: { misc: [{ id: 'a' }, { id: 'b' }] } };
  assert.equal(canAdd(v, 'misc', false).allowed, true);
});

// --- Pro-флаг: только строгое покупательское состояние считается Pro ---

test('isPro: true только при vault.pro.purchased === true и боевом источнике', () => {
  assert.equal(isPro(vaultWith('passwords', 0, { purchased: true, source: 'rustore' })), true);
  assert.equal(isPro(vaultWith('passwords', 0, { purchased: true, source: 'license' })), true);
});

// Ревью 1.3.0, п.1b: владелец может расшифровать свою копию и вписать pro; веб-часть APK в браузере
// раньше давала mock-покупку. Боевая сборка признаёт только источники RuStore и лицензии.
test('isPro (боевая сборка): source mock/чужой/нет - НЕ Pro, в т.ч. в уже подделанных копиях', () => {
  assert.deepEqual([...PRO_SOURCES], ['rustore', 'license']);
  for (const source of ['mock', 'MOCK', 'Rustore', '', 'free', undefined, null, 1]) {
    assert.equal(isPro(vaultWith('passwords', 0, { purchased: true, source })), false, 'source=' + String(source));
  }
  // отметка ровно того вида, что оставлял браузерный mock старой сборки (mockpro.mjs ревьюера)
  assert.equal(isPro(vaultWith('passwords', 0, { purchased: true, source: 'mock', purchaseId: 'mock-1', at: '2026-09-01T00:00:00.000Z' })), false);
});

test('isPro (тест-сборка, anySource): mock-отметка признаётся, подделки формы - нет', () => {
  assert.equal(isPro(vaultWith('passwords', 0, { purchased: true, source: 'mock' }), { anySource: true }), true);
  assert.equal(isPro(vaultWith('passwords', 0, { purchased: 'true', source: 'rustore' }), { anySource: true }), false);
  assert.equal(isPro(vaultWith('passwords', 0, { purchased: true, source: 'mock' }), { anySource: 'yes' }), false, 'anySource строго true');
});

test('isPro: подделки не проходят', () => {
  assert.equal(isPro(vaultWith('passwords', 0)), false);                 // нет поля
  assert.equal(isPro(vaultWith('passwords', 0, 'PRO')), false);          // строка
  assert.equal(isPro(vaultWith('passwords', 0, true)), false);           // булев вместо объекта
  assert.equal(isPro(vaultWith('passwords', 0, { purchased: 'true' })), false); // строка вместо true
  assert.equal(isPro(vaultWith('passwords', 0, { purchased: 1 })), false);      // число
  assert.equal(isPro(vaultWith('passwords', 0, { purchased: false })), false);
  assert.equal(isPro(null), false);
  assert.equal(isPro({}), false);
});

test('markPro: делает vault Pro, canAdd снимает лимит по этому же флагу', () => {
  const v = vaultWith('cards', 3);                 // упёрлись в лимит карт
  assert.equal(canAdd(v, 'cards', isPro(v)).allowed, false);
  markPro(v, { source: 'rustore', purchaseId: 'p-1' });
  assert.equal(isPro(v), true);
  assert.equal(v.pro.purchased, true);
  assert.equal(v.pro.source, 'rustore');
  assert.equal(v.pro.purchaseId, 'p-1');
  assert.equal(canAdd(v, 'cards', isPro(v)).allowed, true);
});
