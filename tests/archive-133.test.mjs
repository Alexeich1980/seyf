// archive-133.test.mjs - «Архив для близких» (1.3.3, утверждено Алексеем 27.10.2026).
// Что держит: (1) хранение в vault.archive с миграцией - старые хранилища открываются, данные не теряются;
// (2) лист без секретов - логины, пароли, ПИН, CVV, номера карт/кошельков/счетов, seed, ключи 2FA,
// номера документов и произвольные поля в него НЕ попадают никогда (номер полиса и сумма долга - можно);
// (3) зашифрованный файл: верный пароль открывает (тем самым кодом, что внутри файла), неверный - нет,
// в открытом виде секретов в файле нет; (4) пароль файла: минимальная стойкость, совпадение;
// (5) бесплатно и без лимитов - гейт архив не трогает; (6) своё окно даты; (7) напоминание раз в полгода;
// (8) тексты Алексея дословно; источники-галочки и закрытые в бесплатной версии разделы.
// Мутации (27.10.2026) - см. отчёт задачи; каждая из перечисленных в конце файла краснеет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../www/js/archive.js';
import * as UI from '../www/js/ui.js';
import '../www/js/sectionsx.js';
import * as C from '../www/js/crypto.js';
import * as Gate from '../www/js/gate.js';
import { ensureSections } from '../www/js/sectionsx.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// Хранилище со всеми видами секретов: у каждого секрета уникальная метка SECRET_n.
let n = 0;
const S = () => 'SECRET' + (++n) + 'x';
function bigVault() {
  n = 0;
  const v = { version: 1, sections: {} };
  const add = (sec, e) => { (v.sections[sec] = v.sections[sec] || []).push({ id: sec + (v.sections[sec] ? v.sections[sec].length : 0), customFields: [{ name: 'ПИН домофона', value: S(), secret: true }], ...e }); };
  add('cards', { bank: 'Сбербанк', number: S(), holder: 'IVAN PETROV', expiry: S(), cvv: S(), pin: S() });
  add('requisites', { name: 'Зарплатный', bank: 'ВТБ', account: S(), bik: S(), corr: S(), inn: S(), ogrn: S(), iban: S(), note: S() });
  add('wallets', { description: 'ЮMoney', url: 'https://yoomoney.ru', number: S(), password: S() });
  add('seed', { name: 'Ledger', phrase: S() + ' ' + S(), network: 'Bitcoin', passphrase: S(), note: S() });
  add('documents', { description: 'Паспорт', number: S(), issueDate: S(), comments: S(), expiry: S(), pages: [{ data: S() }] });
  add('contacts', { name: 'Нотариус Иванова', phone: '+79990001122', email: 'not@example.ru', link: S(), note: S() });
  add('passwords', { description: 'Почта Яндекс', url: 'https://mail.yandex.ru', login: S(), password: S() });
  add('totp', { name: 'Госуслуги', secret: S() });
  add('wifi', { name: 'Дом', ssid: 'home', password: S() });
  add('notes', { title: 'Заметка', text: S() });
  return ensureSections(v);
}
function secretsOf() { return Array.from({ length: n }, (_, i) => 'SECRET' + (i + 1) + 'x'); }
function pickAll(arch, v) {
  for (const src of A.PICK_SOURCES) for (const e of v.sections[src] || []) A.togglePick(arch, src, e.id, true);
}
function filledArchive(v) {
  const a = A.normalizeArchive(null);
  pickAll(a, v);
  A.addItem(a, 'insurance', { company: 'Согаз', policy: 'POLICY-777', until: '31.12.2027' });
  A.addItem(a, 'debts', { to: 'Т-Банк', left: '1 200 000 ₽' }, 'mine');
  A.addItem(a, 'debts', { who: 'Петя', sum: '150 000 ₽' }, 'owed');
  A.addItem(a, 'money', { company: 'Брокер-пример', what: 'ИИС', amount: 'около 500 000 ₽' });
  A.setWishes(a, { will: 'есть', wishes: 'Кота забирает сестра' });
  a.owner = 'Алексей';
  return a;
}

// ---------- 1. хранение и миграция ----------
test('миграция: старое хранилище без архива получает пустой архив, остальное не тронуто', () => {
  const v = { version: 1, sections: { passwords: [{ id: 'p1', login: 'a' }] }, pro: { purchased: true, source: 'rustore' }, extra: 7 };
  const before = JSON.stringify({ ...v });
  A.ensureArchive(v);
  assert.deepEqual(JSON.parse(before), { version: 1, sections: v.sections, pro: v.pro, extra: 7 });
  assert.deepEqual(v.archive.items.money, []);
  assert.deepEqual(v.archive.picks.passwords, []);
  assert.equal(v.archive.v, A.ARCHIVE_V);
  assert.equal(A.isFilled(v.archive, v), false);
});

test('миграция: сохранённый архив переживает повторную нормализацию без потерь; мусор отбрасывается поштучно', () => {
  const v = bigVault();
  const a = filledArchive(v);
  a.items.money.push(null, { f: 'bad' }, { id: 'x', f: { company: 'Ок' }, future: 1 });
  a.picks.cards.push(5, 'cards0');
  a.unknownTop = { keep: true };
  const b = A.normalizeArchive(JSON.parse(JSON.stringify(a)));
  assert.equal(b.items.money.length, 2, 'битые записи выброшены, нормальные - на месте');
  assert.equal(b.items.money[1].future, 1, 'неизвестное поле записи сохранено');
  assert.deepEqual(b.picks.cards, ['cards0'], 'дубль и не-строка выброшены');
  assert.deepEqual(b.unknownTop, { keep: true });
  assert.equal(b.wishes.wishes, 'Кота забирает сестра');
  assert.equal(b.owner, 'Алексей');
  assert.deepEqual(A.normalizeArchive(b), b, 'нормализация идемпотентна');
});

test('миграция: настоящий зашифрованный файл старого формата (без archive) открывается и шифруется обратно с архивом', async () => {
  const old = { version: 1, sections: { passwords: [{ id: 'p1', description: 'Почта', password: 'pw' }] } };
  const file = await C.newVaultFile('master pass phrase', old);
  const res = await C.unlockWithPassword(file, 'master pass phrase');
  const v = A.ensureArchive(ensureSections(res.vault));
  A.addItem(v.archive, 'documents', { doc: 'Свидетельство', original: 'синяя папка' });
  const enc = await C.reencryptData(file, res.dek, v);
  const again = await C.unlockWithPassword({ ...file, data: enc.data }, 'master pass phrase');
  assert.equal(again.vault.sections.passwords[0].password, 'pw', 'старые записи на месте');
  assert.equal(A.normalizeArchive(again.vault.archive).items.documents[0].f.original, 'синяя папка', 'архив лёг в тот же зашифрованный файл');
});

test('app.js: архив дозаполняется при входе и при восстановлении из копии', () => {
  const APP = read('www', 'js', 'app.js');
  assert.match(APP, /state\.vault = ensureArchive\(ensureSections\(res\.vault\)\); state\.dekRaw/);
  assert.match(APP, /state\.vault = ensureArchive\(ensureSections\(res\.vault\)\);\n\s+revealSecrets = false/);
});

// ---------- 2. лист без секретов ----------
test('ЛИСТ: ни один секрет не попадает в лист (модель и HTML), полис и суммы долга - попадают', () => {
  const v = bigVault();
  const a = filledArchive(v);
  const model = A.buildSheetModel(a, v, { schema: UI.FIELD_SCHEMA, now: new Date(2026, 9, 27) });
  const html = A.renderSheetHtml(model);
  const text = JSON.stringify(model) + html;
  for (const s of secretsOf()) assert.ok(!text.includes(s), 'секрет в листе: ' + s);
  for (const w of ['Сбербанк', 'Нотариус Иванова', '+79990001122', 'Почта Яндекс', 'Паспорт', 'Ledger', 'ЮMoney', 'Зарплатный',
    'POLICY-777', '1 200 000 ₽', '150 000 ₽', 'около 500 000 ₽', 'Кота забирает сестра', 'Кто составил: Алексей', '27.10.2026']) {
    assert.ok(html.includes(w), 'в листе нет: ' + w);
  }
  assert.ok(html.includes(A.SHEET.leadSheet) && html.includes(A.SHEET.lead2));
  assert.ok(/Сведения на 27\.10\.2026\. Если с тех пор что-то поменялось/.test(html), 'подвал с датой');
});

test('ЛИСТ: белый список полей - только несекретные; лист без скриптов и сети', () => {
  const secretKeys = ['number', 'cvv', 'pin', 'password', 'login', 'phrase', 'passphrase', 'account', 'bik', 'corr', 'inn', 'ogrn', 'iban', 'secret', 'expiry', 'issueDate', 'comments', 'note', 'link'];
  for (const [src, keys] of Object.entries(A.SHEET_FIELDS)) {
    for (const k of keys) assert.ok(!secretKeys.includes(k), src + '.' + k + ' не должен идти в лист');
  }
  const html = A.renderSheetHtml(A.buildSheetModel(filledArchive(bigVault()), bigVault(), { schema: UI.FIELD_SCHEMA }));
  assert.ok(!/<script/i.test(html), 'в листе нет скриптов');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/);
});

test('ЛИСТ: содержимое экранируется (запись с HTML не ломает лист)', () => {
  const v = bigVault();
  const a = A.normalizeArchive(null);
  A.addItem(a, 'documents', { doc: '<img src=x onerror=alert(1)>' });
  const html = A.renderSheetHtml(A.buildSheetModel(a, v, { schema: UI.FIELD_SCHEMA }));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

// ---------- 3. зашифрованный файл ----------
const runViewer = () => new Function(A.VIEWER_CORE + '\nreturn seyfOpen;')();
function envFromHtml(html) {
  const m = /<script type="application\/json" id="seyf-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'в файле есть блок данных');
  return JSON.parse(m[1]);
}

test('ФАЙЛ: полная модель содержит логины, пароли, номера, ПИН и seed (для доверенного лица)', () => {
  const v = bigVault();
  const full = JSON.stringify(A.buildFullModel(filledArchive(v), v, { schema: UI.FIELD_SCHEMA }));
  // все секреты отмеченных записей источников архива (поля и произвольные поля), кроме сканов документов
  const expected = [];
  for (const src of A.PICK_SOURCES) {
    for (const e of v.sections[src]) {
      for (const [k, val] of Object.entries(e)) if (typeof val === 'string' && /^SECRET/.test(val)) expected.push(...val.split(' '));
      for (const cf of e.customFields) expected.push(cf.value);
    }
  }
  assert.ok(expected.length >= 30, 'проверяется много секретов: ' + expected.length);
  for (const s of expected) assert.ok(full.includes(s), 'нет в полном файле: ' + s);
  for (const s of [v.sections.totp[0].secret, v.sections.wifi[0].password]) assert.ok(full.includes(s), 'ключ 2FA и пароль Wi-Fi - в файл (ревью М4): ' + s);
  assert.ok(!full.includes(v.sections.notes[0].text), 'заметки - не источник архива');
  assert.ok(!full.includes(v.sections.documents[0].pages[0].data), 'сканы документов в файл не идут');
});

test('ФАЙЛ: верный пароль открывает (кодом из самого файла), неверный - нет; секретов в открытом виде нет', async () => {
  const v = bigVault();
  const model = A.buildFullModel(filledArchive(v), v, { schema: UI.FIELD_SCHEMA });
  const env = await A.encryptPayload(model, 'Correct horse 42', { iterations: 2000 });
  const html = A.buildEncryptedHtml(env);
  for (const s of secretsOf()) assert.ok(!html.includes(s), 'секрет открытым текстом в файле: ' + s);
  for (const w of ['Сбербанк', 'Почта Яндекс', 'POLICY-777', 'Кота']) assert.ok(!html.includes(w), 'содержимое открытым текстом: ' + w);
  const open = runViewer();
  const back = await open(envFromHtml(html), 'Correct horse 42');
  assert.deepEqual(back, model);
  await assert.rejects(() => open(envFromHtml(html), 'Correct horse 43'));
  await assert.rejects(() => A.decryptPayload(env, 'wrong password'));
  assert.deepEqual(await A.decryptPayload(env, 'Correct horse 42'), model);
});

test('ФАЙЛ: по умолчанию PBKDF2-SHA256 600 000 повторов, соль и вектор новые на каждый файл; сеть закрыта CSP', async () => {
  const e1 = await A.encryptPayload({ a: 1 }, 'Correct horse 42');
  const e2 = await A.encryptPayload({ a: 1 }, 'Correct horse 42');
  assert.equal(e1.it, 600000);
  assert.equal(e1.kdf, 'PBKDF2-SHA256');
  assert.notEqual(e1.salt, e2.salt);
  assert.notEqual(e1.iv, e2.iv);
  const html = A.buildEncryptedHtml(e1);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"/);
  assert.ok(!/https?:\/\//.test(html), 'в файле нет внешних адресов');
  assert.ok(!/innerHTML/.test(html), 'расшифрованное рисуется только через textContent');
});

// ---------- 4. пароль файла ----------
test('пароль файла: пусто, коротко, просто, не совпадает - отказ; нормальный - да', () => {
  assert.match(A.filePasswordProblem('', ''), /Придумайте/);
  assert.match(A.filePasswordProblem('Ab1!x', 'Ab1!x'), /короче 10/);
  assert.match(A.filePasswordProblem('aaaaaaaaaaaa', 'aaaaaaaaaaaa'), /простой/);
  assert.match(A.filePasswordProblem('1234567890', '1234567890'), /простой/);
  assert.match(A.filePasswordProblem('abcdefghij', 'abcdefghij'), /простой/);
  assert.match(A.filePasswordProblem('abcdefghijklmn', 'abcdefghijklmn'), /простой/, 'алфавит подряд - нет (ревью В2)');
  assert.equal(A.filePasswordProblem('zelenyikotspit', 'zelenyikotspit'), '', '14 знаков одного вида - можно (фраза)');
  assert.match(A.filePasswordProblem('Correct horse 42', 'Correct horse 43'), /не совпадают/);
  assert.equal(A.filePasswordProblem('Correct horse 42', 'Correct horse 42'), '');
  assert.equal(A.filePasswordProblem('кот Барсик 2027', 'кот Барсик 2027'), '');
});

test('пароль файла ≠ мастер-паролю: проверка до шифрования, тем же путём, что вход', () => {
  const UIJS = read('www', 'js', 'archive-ui.js');
  const APP = read('www', 'js', 'app.js');
  assert.match(UIJS, /if \(await D\.isMasterPassword\(pw\)\) \{ err\.textContent = A\.FILE_PW_IS_MASTER; return; \}[\s\S]*A\.encryptPayload\(model, pw\)/);
  assert.match(APP, /isMasterPassword: async \(pw\) => \(await opensVaultKey\(state\.file, pw, C\)\)/, 'снятием обёртки ключа (ревью М6)');
  assert.match(UIJS, /const problem = A\.filePasswordProblem\(pw, p2\.value\);\s*if \(problem\)/);
});

// ---------- 5. бесплатно и без лимитов ----------
test('БЕСПЛАТНО: архив без лимитов - 500 записей в разделе добавляются, гейт сейфа не меняется', () => {
  const v = { version: 1, sections: { passwords: [] } };
  A.ensureArchive(v);
  for (let i = 0; i < 500; i++) assert.ok(A.addItem(v.archive, 'money', { company: 'Банк ' + i }));
  assert.equal(v.archive.items.money.length, 500);
  assert.deepEqual(Gate.canAdd(v, 'passwords', false), { allowed: true, limit: 7, used: 0 }, 'архив не считается в лимиты разделов');
});

test('БЕСПЛАТНО: окна архива не зовут гейт и окно покупки', () => {
  for (const f of ['archive.js', 'archive-ui.js']) {
    const src = read('www', 'js', f);
    assert.ok(!/canAdd|openPaywall|openProFlow|isPro\(|Gate\./.test(src), f + ': без гейта');
  }
  const APP = read('www', 'js', 'app.js');
  assert.match(APP, /on\('mArchive', \(\) => \{ closeMenu\(\); openArchive\(\); \}\)/, 'пункт меню открывает архив напрямую');
});

test('закрытые в бесплатной версии разделы (реквизиты, контакты) - строка «впишите вручную»', () => {
  const v = { version: 1, sections: { requisites: [], contacts: [], passwords: [] } };
  const opts = { full: false, freeLimits: Gate.FREE_LIMITS };
  assert.equal(A.sourceClosed('requisites', v, opts), true);
  assert.equal(A.sourceClosed('contacts', v, opts), true);
  assert.equal(A.sourceClosed('passwords', v, opts), false, 'пароли в бесплатной открыты');
  assert.equal(A.sourceClosed('contacts', v, { ...opts, full: true }), false, 'полная версия - галочки');
  v.sections.contacts.push({ id: 'c1', name: 'Иванова' });
  assert.equal(A.sourceClosed('contacts', v, opts), false, 'созданные раньше записи можно отметить');
  assert.match(A.CLOSED_NOTE, /кнопкой «Добавить вручную»/);
  assert.equal(A.ADD_MANUAL, '+ Добавить вручную');
});

test('источники галочек по разделам архива - как утверждено', () => {
  assert.deepEqual(A.sectionById('money').sources, ['cards', 'requisites', 'wallets', 'seed']);
  assert.deepEqual(A.sectionById('documents').sources, ['documents']);
  assert.deepEqual(A.sectionById('contacts').sources, ['contacts']);
  assert.deepEqual(A.sectionById('accounts').sources, ['passwords', 'totp', 'wifi'], 'ревью М4: коды 2FA и Wi-Fi - в «Аккаунты»');
  assert.deepEqual(A.SECTION_IDS, ['money', 'documents', 'contacts', 'insurance', 'debts', 'property', 'payments', 'accounts', 'wishes']);
  assert.deepEqual(A.sectionById('debts').kinds.map((k) => k.label), ['Мои долги', 'Мне должны']);
  // удалённая из сейфа запись тихо выпадает из архива
  const v = bigVault(); const a = filledArchive(v);
  v.sections.cards = [];
  assert.equal(A.pickedEntries(a, v, 'cards').length, 0);
});

// ---------- 6. своё окно даты ----------
test('дата: сетка месяца с понедельника, разбор и формат ДД.ММ.ГГГГ, сдвиг месяца', () => {
  const oct = A.monthGrid(2026, 10);
  assert.deepEqual(oct[0], [null, null, null, 1, 2, 3, 4], '1 октября 2026 - четверг');
  assert.equal(oct.flat().filter(Boolean).length, 31);
  assert.equal(A.monthGrid(2028, 2).flat().filter(Boolean).length, 29);
  assert.deepEqual(A.parseDate('31.12.2027'), { y: 2027, m: 12, d: 31 });
  assert.equal(A.parseDate('31.02.2027'), null);
  assert.equal(A.formatDate({ y: 2027, m: 3, d: 5 }), '05.03.2027');
  assert.deepEqual(A.shiftMonth(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(A.shiftMonth(2026, 1, -1), { y: 2025, m: 12 });
  assert.deepEqual(A.shiftMonth(2026, 5, -12), { y: 2025, m: 5 });
  assert.equal(A.sectionById('insurance').fields.find((f) => f.key === 'until').type, 'date');
});

test('нет системных окон выбора: в архиве нет type=date и <select>, выбор - своё окно', () => {
  for (const f of ['archive.js', 'archive-ui.js']) {
    const src = read('www', 'js', f);
    assert.ok(!/type=["']?(date|time|month)|<select/.test(src), f);
  }
  const UIJS = read('www', 'js', 'archive-ui.js');
  assert.match(UIJS, /openDatePicker\(\{ title: fd\.label/);
  assert.match(UIJS, /D\.stylePicker\(\{ title: fd\.label/);
});

// ---------- 7. напоминание раз в полгода ----------
test('напоминание: только заполненный архив, через полгода после правки; «Позже» - через месяц; «Открыть» - отсчёт заново', () => {
  const v = bigVault();
  const empty = A.normalizeArchive(null);
  const day = 864e5, t0 = Date.UTC(2026, 9, 1);
  assert.equal(A.archiveDue({ archive: empty, vault: v, stamp: {}, now: t0 + 400 * day }), false, 'пустой - молчим');
  A.touch(empty, t0);   // всё удалили - правка была, но архив пуст
  assert.equal(A.archiveDue({ archive: empty, vault: v, stamp: {}, now: t0 + 400 * day }), false, 'опустевший - молчим');
  const a = filledArchive(v); A.touch(a, t0);
  assert.equal(A.archiveDue({ archive: a, vault: v, stamp: {}, now: t0 + 181 * day }), false);
  assert.equal(A.archiveDue({ archive: a, vault: v, stamp: {}, now: t0 + 183 * day }), true);
  const later = A.nudgeLater({}, t0 + 183 * day);
  assert.equal(A.archiveDue({ archive: a, vault: v, stamp: later, now: t0 + 200 * day }), false);
  assert.equal(A.archiveDue({ archive: a, vault: v, stamp: later, now: t0 + 214 * day }), true);
  const rev = A.nudgeReviewed(later, t0 + 214 * day);
  assert.equal(A.archiveDue({ archive: a, vault: v, stamp: rev, now: t0 + 300 * day }), false);
  assert.equal(A.archiveDue({ archive: a, vault: v, stamp: rev, now: t0 + 397 * day }), true);
});

test('напоминание: своё окно, не поверх других окон/меню/входа, после напоминания о копии', () => {
  const UIJS = read('www', 'js', 'archive-ui.js');
  const fn = UIJS.slice(UIJS.indexOf('export function maybeRemindArchive'));
  assert.match(fn, /if \(document\.querySelector\('\.modal-back'\)\) return false;/);
  assert.match(fn, /#lock/);
  assert.match(fn, /#menuBg/);
  assert.match(read('www', 'js', 'app.js'), /if \(!maybeRemindBackup\(\)\) maybeRemindArchive\(\);/);
});

// ---------- 8. тексты ----------
test('тексты: первый экран дословно (Алексей 27.10), строка «хранится только на вашем устройстве»', () => {
  assert.equal(A.ARCHIVE_INTRO, 'Внимание! Если о вашем вкладе, брокерском счёте, активах или долгах не знает никто из родных, они не смогут вступить в наследство: по закону на это есть 6 месяцев, и искать наследников никто не будет. Соберите здесь, где что лежит и к кому обращаться, и передайте доступ одному-двум доверенным людям. Доступны 2 варианта:');
  assert.equal(A.ARCHIVE_LOCAL_NOTE, 'Архив хранится только на вашем устройстве и никуда не отправляется - в интернет он попадёт, только если вы сами его кому-то отправите.');
  assert.match(A.ISSUE_FULL.text, /Деньги со счетов наследники получают через нотариуса/);
  const all = JSON.stringify([A.ARCHIVE_SECTIONS, A.ISSUE_SHEET, A.ISSUE_FULL, A.FILE_PW, A.REMIND, A.SHEET, A.PICK_CAPTION, A.CLOSED_NOTE]);
  assert.ok(!/похорон/i.test(all), 'без слова «похороны» (Алексей 27.10)');
  assert.ok(!all.includes('—'), 'без длинного тире');
  assert.ok(!/\d \d{3}/.test(all), 'числа в заглушках - с неразрывным пробелом');
  assert.match(read('www', 'js', 'archive.js'), /const NBSP = '\\u00a0';/, 'NBSP - только escape');
});

test('первый экран: текст, затем 2 кнопки выдачи, затем строка про устройство', () => {
  const UIJS = read('www', 'js', 'archive-ui.js');
  const home = UIJS.slice(UIJS.indexOf('function renderHome'), UIJS.indexOf('function renderSection'));
  const i1 = home.indexOf('A.ARCHIVE_INTRO'), i2 = home.indexOf('data-issue="sheet"'), i3 = home.indexOf('data-issue="full"'), i4 = home.indexOf('A.ARCHIVE_LOCAL_NOTE');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3 && i3 < i4, 'порядок: текст, «Только основная», «+ логины и пароли», строка');
  assert.match(home, /A\.ISSUE_SHEET\.title/);
  assert.match(home, /A\.ISSUE_FULL\.title/);
});

test('печать листа: системная печать Android (плагин Print, без JS и сети) или файл', () => {
  const JAVA = read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'PrintPlugin.java');
  assert.match(JAVA, /setJavaScriptEnabled\(false\)/);
  assert.match(JAVA, /setBlockNetworkLoads\(true\)/);
  assert.match(JAVA, /createPrintDocumentAdapter/);
  assert.match(read('android', 'app', 'src', 'main', 'java', 'ru', 'dorokhin', 'seyf', 'MainActivity.java'), /registerPlugin\(PrintPlugin\.class\)/);
  assert.match(read('www', 'native.js'), /Print: C\.registerPlugin\('Print'\)/);
  const UIJS = read('www', 'js', 'archive-ui.js');
  assert.match(UIJS, /NP\.Print\.print\(\{ html, name: A\.ARCHIVE_TITLE \}\)/);
  assert.match(UIJS, /const html = A\.renderSheetHtml\(A\.buildSheetModel\(/, 'печатается ТОЛЬКО лист без секретов');
  assert.match(UIJS, /const html = A\.buildEncryptedHtml\(await A\.encryptPayload\(model, pw\)\)/, 'полная модель уходит только зашифрованной');
});
