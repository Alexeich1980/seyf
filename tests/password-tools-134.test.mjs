import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../www/js/archive.js';

test('1.3.4 rejects human phrases, repeated long chunks and decorated dictionary passwords', () => {
  for (const pw of ['zelenyikotspit', 'Correct horse 42', 'кот Барсик 2027', 'PasswordPassword2026!', 'my very long easy to remember password phrase', 'aB7!xyZaB7!xyZaB7!xyZ']) {
    assert.notEqual(A.filePasswordProblem(pw, pw), '', pw);
  }
});
import * as P from '../www/js/password-tools.js';
import { BIP39_EN } from '../www/js/bip39-wordlist.js';

test('rejection sampling discards biased tail; power-of-two pool accepts UINT32_MAX', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let values = [4294967295, 4294967290, 19, 4294967295], calls = 0;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues(a) { a[0] = values[calls++]; return a; } } });
  try { assert.equal(P.randomIndex(10), 9); assert.equal(calls, 3); assert.equal(P.randomIndex(2048), 2047); }
  finally { Object.defineProperty(globalThis, 'crypto', original); }
  for (const n of [0, -1, 1.5, Infinity, 4294967297]) assert.throws(() => P.randomIndex(n), RangeError);
});

test('six independent BIP39 words have 66 bits; archive provenance is exact, not inferred', () => {
  assert.equal(new Set(BIP39_EN).size, 2048);
  assert.equal(P.PASSPHRASE_ENTROPY_BITS, 66);
  for (let i = 0; i < 30; i++) {
    const pw = P.generateArchivePassword();
    assert.equal(pw.split('-').length, 6);
    assert.ok(pw.split('-').every(w => BIP39_EN.includes(w)));
    assert.equal(A.filePasswordProblem(pw, pw, { generatedPassword: pw }), '');
    assert.notEqual(A.filePasswordProblem(pw, pw), '');
    assert.notEqual(A.filePasswordProblem(pw + '-cat', pw + '-cat', { generatedPassword: pw }), '');
    assert.notEqual(A.filePasswordProblem(pw, pw + 'x', { generatedPassword: pw }), '');
  }
});

test('configurable generator respects bounds and noSymbols, fails closed without crypto', () => {
  for (const length of [8, 18, 32]) for (const noSymbols of [true, false]) {
    const pw = P.generatePassword({ length, noSymbols });
    assert.equal(pw.length, length);
    if (noSymbols) assert.match(pw, /^[A-Za-z0-9]+$/);
  }
  for (const length of [7, 33, NaN, 8.5, '18']) assert.throws(() => P.generatePassword({ length }), RangeError);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try { assert.throws(() => P.generatePassword()); assert.throws(() => P.generateArchivePassword()); }
  finally { Object.defineProperty(globalThis, 'crypto', original); }
});

test('audit excludes trash, returns no secrets, preserves exact duplicate semantics and input', () => {
  const secret = 'a7!Zp9@Tr2#Vm8$Q';
  const vault = { sections: { passwords: [
    {id:'a', description:'Mail', password:secret}, {id:'b', password:secret},
    {id:'c', password:secret.toLowerCase()}, {id:'d', password:secret, deletedAt:'2026-01-01'},
    {id:'e', password:'my long but very predictable phrase'}, {id:'empty',password:''}
  ], wifi:[{id:'w',password:secret,deleted:true}], trash:[{id:'t',password:secret}] }, trash:[{password:secret}] };
  const before = JSON.stringify(vault), report = P.auditPasswords(vault);
  assert.equal(report.checked, 4); assert.equal(report.duplicateCount, 2); assert.equal(report.duplicateGroups, 1);
  assert.equal(report.unknownCount, 1); assert.ok(!report.items.some(r=>r.id==='e'));
  assert.deepEqual(report.items.filter(r=>r.duplicate).map(r=>r.id), ['a','b']);
  assert.ok(!JSON.stringify(report).includes(secret)); assert.equal(JSON.stringify(vault), before);
  assert.deepEqual(Object.keys(report.items[0]).sort(), ['duplicate','id','section','title','weak']);
  assert.equal(P.assessPassword(secret).weak, false); assert.equal(P.assessPassword(secret).entropyBits, null);
});

test('legacy weak-password envelopes still decrypt through module and exported viewer', async () => {
  for (const pw of ['1234', 'Ключ йод ёж 2026']) {
    const model = {old:true};
    const env = await A.encryptPayload(model, pw, {iterations:1000});
    assert.notEqual(A.filePasswordProblem(pw,pw), '');
    assert.deepEqual(await A.decryptPayload(env,pw), model);
    assert.deepEqual(await new Function(A.VIEWER_CORE + ';return seyfOpen')()(env,pw), model);
  }
});
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

test('real browser: generator controls, provenance edits, audit secrecy, lock/dispose and stale vault guards', async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') { res.setHeader('Content-Type','text/html'); return res.end('<!doctype html><link rel="stylesheet" href="/css/app.css"><button id="origin">Open</button>'); }
      if (!/^\/(js|css|fonts)\/[\w./-]+$/.test(url.pathname) || url.pathname.includes('..')) { res.writeHead(404); return res.end(); }
      res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream');
      res.end(await readFile(new URL('../www' + url.pathname, import.meta.url)));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.SEYF_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true });
    const page = await browser.newPage(); await page.setViewport({width:360,height:740});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async () => {
      const UI = await import('/js/password-tools-ui.js');
      const state = {vault:{sections:{passwords:[{id:'1',description:'<img src=x onerror=alert(1)>',password:'Secret-for-test'}, {id:'2',description:'Other',password:'Secret-for-test'}]}}};
      const deps = {get state(){return state;}, isTopModal:b=>[...document.querySelectorAll('.modal-back')].at(-1)===b, closeOnBackdrop(b,fn){b.onclick=e=>{if(e.target===b)fn();};}};
      UI.initPasswordToolsUI(deps); let used = null, opened = null;
      UI.openGenerator({onUse:v=>used=v});
      const length = document.querySelector('.pt-length'); length.value='32'; length.dispatchEvent(new Event('input'));
      document.querySelector('.pt-symbols').click();
      const bounds = /^[A-Za-z0-9]{32}$/.test(document.querySelector('.pt-result').value);
      document.querySelector('.pt-use').click(); const delivered = used?.length===32 && !document.querySelector('.modal-back');
      const handle = UI.openGenerator({onUse:()=>{throw Error('stale callback');}});
      const text = document.querySelector('.pt-result'); window.dispatchEvent(new Event('seyf:locking'));
      const locked = !handle.back.isConnected && text.value==='';
      UI.openGenerator({onUse:()=>{throw Error('stale vault');}}); state.vault={...state.vault}; document.querySelector('.pt-use').click();
      const stale = !document.querySelector('.modal-back');
      UI.openPasswordAudit({vault:state.vault,onOpenEntry:row=>opened=row});
      const safe = !document.body.textContent.includes('Secret-for-test') && !document.querySelector('img');
      document.querySelector('.picker-list button').click();
      const navigation = opened?.id==='1' && opened.section==='passwords';
      UI.openGenerator(); document.querySelector('.pt-phrase').click();
      const phrase = document.querySelector('.pt-result').value.split('-').length===6 && document.querySelector('.pt-length').disabled;
      const overflow = document.documentElement.scrollWidth > 360;
      const removed = document.querySelector('.modal-back'); removed.remove(); await new Promise(r=>setTimeout(r,0));
      const disposed = !removed.querySelector('textarea');
      UI.openGenerator(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      return {bounds,delivered,locked,stale,safe,navigation,phrase,overflow,disposed,escape:!document.querySelector('.modal-back')};
    });
    const archiveResult = await page.evaluate(async () => {
      const A = await import('/js/archive.js'), UI = await import('/js/archive-ui.js');
      const state = {vault:{sections:{}}}; A.ensureArchive(state.vault); A.setWishes(state.vault.archive,{wishes:'Test'});
      let checked = 0, finishCheck;
      UI.initArchiveUI({get state(){return state;}, requireRealVault:()=>true,
        isTopModal:b=>[...document.querySelectorAll('.modal-back')].at(-1)===b,
        closeOnBackdrop(){}, isMasterPassword:()=>{checked++;return new Promise(r=>finishCheck=r);},
        dlgAlert(){throw Error('must not alert after lock');}, schema:{}});
      UI.openArchive(); document.querySelector('[data-issue="full"]').click();
      document.querySelector('.arc-gen').click();
      const p1=document.querySelector('.arc-pw1'), p2=document.querySelector('.arc-pw2'), submit=document.querySelector('.arc-mkfile');
      const generated=p1.value;
      p1.value = generated + 'x'; p1.dispatchEvent(new InputEvent('input',{inputType:'insertText'}));
      p1.value = generated; p1.dispatchEvent(new InputEvent('input',{inputType:'insertFromPaste'})); submit.click();
      const editedRejected=checked===0 && !!document.querySelector('.arc-err').textContent;
      document.querySelector('.arc-gen').click(); submit.click();
      const generatedAccepted=checked===1;
      window.dispatchEvent(new Event('seyf:locking')); finishCheck(false);
      await new Promise(r=>setTimeout(r,20));
      const cleared=!p1.isConnected && p1.value==='' && p2.value==='';
      return {editedRejected,generatedAccepted,cleared};
    });
    assert.deepEqual(archiveResult,{editedRejected:true,generatedAccepted:true,cleared:true});
    assert.deepEqual(result,{bounds:true,delivered:true,locked:true,stale:true,safe:true,navigation:true,phrase:true,overflow:false,disposed:true,escape:true});
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
});
test('short-word human phrases with punctuation do not gain strength from character classes', () => {
  for (const pw of ['cat-dog-sun-moon-red-blue-9!', 'Cat_dog_sun_moon_red_blue_9!']) {
    assert.equal(P.assessPassword(pw).status, 'unknown');
    assert.equal(P.assessPassword(pw).needsReview, true);
    assert.notEqual(A.filePasswordProblem(pw, pw), '');
  }
});
test('unknown phrase strength is distinct from weak evidence and cannot bypass archive validation', () => {
  const phrase = 'abandon-ability-able-about-above-absent';
  const unknown = P.assessPassword(phrase);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.weak, false);
  assert.equal(unknown.needsReview, true);
  assert.equal(unknown.entropyBits, null);
  assert.notEqual(A.filePasswordProblem(phrase, phrase), '');
  assert.equal(A.filePasswordProblem(phrase, phrase, {generatedPassword:phrase}), '');
  assert.equal(P.assessPassword('PasswordPassword2026!').status, 'weak');
  assert.equal(P.assessPassword('a7!Zp9@Tr2#Vm8$Qx').status, 'no-obvious-weakness');
  const report = P.auditPasswords({sections:{passwords:[{id:'phrase',password:phrase}]}});
  assert.equal(report.weakCount, 0);
  assert.equal(report.unknownCount, 1);
  assert.deepEqual(report.items, []);
});
import { pbkdf2Sync, createCipheriv } from 'node:crypto';
test('legacy v1 envelope made independently of archive.js decrypts with a now-disallowed password', async () => {
  const password = '1234', salt = Buffer.alloc(16, 3), iv = Buffer.alloc(12, 7);
  const key = pbkdf2Sync(password, salt, 1000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update('{"legacy":true}', 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const env = {seyfArchive:1,kdf:'PBKDF2-SHA256',it:1000,salt:salt.toString('base64'),iv:iv.toString('base64'),ct:ct.toString('base64')};
  assert.deepEqual(await A.decryptPayload(env,password), {legacy:true});
  assert.deepEqual(await new Function(A.VIEWER_CORE + ';return seyfOpen')()(env,password), {legacy:true});
  assert.notEqual(A.filePasswordProblem(password,password),'');
});
