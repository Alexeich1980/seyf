import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTP_DEFAULTS, base32Decode, generateTOTP, totpProgress, parseOtpauth,
} from '../www/js/totp.js';

const ascii = (bytes) => String.fromCharCode(...bytes);

// --- base32 (RFC 4648) ---

test('base32Decode: JBSWY3DP → «Hello»', () => {
  assert.equal(ascii(base32Decode('JBSWY3DP')), 'Hello');
});

test('base32Decode: эталонный секрет RFC → «12345678901234567890»', () => {
  assert.equal(ascii(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')), '12345678901234567890');
});

test('base32Decode: регистр, пробелы и дефисы игнорируются', () => {
  assert.equal(ascii(base32Decode('jbsw y3dp')), 'Hello');
  assert.equal(ascii(base32Decode('JBSW-Y3DP')), 'Hello');
});

test('base32Decode: недопустимый символ → бросок', () => {
  assert.throws(() => base32Decode('JBSW0Y3DP1'));   // 0 и 1 не в алфавите base32
  assert.throws(() => base32Decode('!!!!'));
});

// --- генерация TOTP: официальные векторы RFC 6238 (SHA-1, 8 цифр) ---
// Секрет "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ, T0=0, шаг 30.

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_VECTORS = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

for (const [sec, expected] of RFC_VECTORS) {
  test(`generateTOTP RFC 6238 (SHA-1, 8 цифр): T=${sec} → ${expected}`, async () => {
    const code = await generateTOTP(RFC_SECRET, { time: sec * 1000, digits: 8, period: 30, algorithm: 'SHA-1' });
    assert.equal(code, expected);
  });
}

test('generateTOTP: 6-значное усечение = последние 6 цифр 8-значного (T=59 → 287082)', async () => {
  const code = await generateTOTP(RFC_SECRET, { time: 59 * 1000, digits: 6, period: 30 });
  assert.equal(code, '287082');
});

test('generateTOTP: дефолты — 6 цифр, шаг 30', async () => {
  const code = await generateTOTP(RFC_SECRET, { time: 59 * 1000 });
  assert.equal(code.length, 6);
  assert.equal(code, '287082');
});

// --- обратный отсчёт ---

test('totpProgress: остаток в диапазоне (0..period] и корректен на границе', () => {
  assert.deepEqual(totpProgress(59 * 1000, 30), { remaining: 1, period: 30 });   // 59 % 30 = 29, осталось 1
  assert.deepEqual(totpProgress(30 * 1000, 30), { remaining: 30, period: 30 });  // ровно граница окна
  assert.deepEqual(totpProgress(45 * 1000, 30), { remaining: 15, period: 30 });
  const p = totpProgress(Date.now(), 30);
  assert.ok(p.remaining > 0 && p.remaining <= 30);
});

// --- разбор otpauth:// URI (парсер QR) ---

test('parseOtpauth: валидный TOTP URI → поля', () => {
  const r = parseOtpauth('otpauth://totp/GitHub:alex?secret=JBSWY3DPEHPK3PXP&issuer=GitHub');
  assert.equal(r.ok, true);
  assert.ok(r.name.includes('GitHub'));
  assert.equal(r.secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(r.digits, 6);
  assert.equal(r.period, 30);
  assert.equal(r.algorithm, 'SHA-1');
});

test('parseOtpauth: параметры URI переопределяют дефолты', () => {
  const r = parseOtpauth('otpauth://totp/Acme?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256');
  assert.equal(r.ok, true);
  assert.equal(r.digits, 8);
  assert.equal(r.period, 60);
  assert.equal(r.algorithm, 'SHA-256');
});

test('parseOtpauth: секрет нормализуется (регистр, пробелы, дефисы)', () => {
  const r = parseOtpauth('otpauth://totp/x?secret=jbswy3dp-ehpk3pxp');
  assert.equal(r.ok, true);
  assert.equal(r.secret, 'JBSWY3DPEHPK3PXP');
});

test('parseOtpauth: issuer из label, если нет параметра issuer', () => {
  const r = parseOtpauth('otpauth://totp/Google:me@example.com?secret=JBSWY3DPEHPK3PXP');
  assert.equal(r.ok, true);
  assert.ok(r.name.includes('Google'));
});

test('parseOtpauth: отклонения (мусор, hotp, https, без секрета, битый секрет)', () => {
  for (const bad of [
    '',
    'not a uri',
    'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1',
    'https://example.com/?secret=JBSWY3DPEHPK3PXP',
    'otpauth://totp/x',
    'otpauth://totp/x?secret=',
    'otpauth://totp/x?secret=0011!!',
  ]) {
    const r = parseOtpauth(bad);
    assert.equal(r.ok, false, 'должно быть отклонено: ' + JSON.stringify(bad));
    assert.ok(r.error && r.error.trim().length > 0, 'есть понятная причина отказа');
  }
});

test('TOTP_DEFAULTS — 6 цифр / 30 сек / SHA-1', () => {
  assert.equal(TOTP_DEFAULTS.digits, 6);
  assert.equal(TOTP_DEFAULTS.period, 30);
  assert.equal(TOTP_DEFAULTS.algorithm, 'SHA-1');
});
