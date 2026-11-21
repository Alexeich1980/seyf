import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {formatLoyaltyNumber as fmt, normalizeLoyaltyNumber as raw} from '../www/js/loyalty-number.js';
const out = 'qa/loyalty-round5-20261120';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
test('numeric-only normalization preserves legacy content and arbitrary lengths',()=>{
  for(const value of ['AB 001 2','  AB 001 2  ','12-34','１２３４','1.23','1e4','   ']) {assert.equal(raw(value),value);assert.equal(fmt(value),value);}
  assert.equal(fmt('00123456789'),'0012 3456 789');
  assert.equal(raw(' 0012\u00a03456\u202f789 '),'00123456789');
  assert.equal(raw(fmt('0'.repeat(2048))), '0'.repeat(2048));
});
test('real Chrome: editing, displays, persistence, payload and favorite control',async t=>{
  const root=path.resolve('www'), files=new Map(), served=new Map();
  async function snapshot(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await snapshot(p);else files.set('/'+path.relative(root,p).replaceAll('\\','/'),await fs.readFile(p));}}
  await snapshot(root);
  if(process.env.NUMBER_BASELINE)files.set('/js/loyalty-ui.js',await fs.readFile(`${out}/number-baseline/loyalty-ui.js`));
  const server=http.createServer((req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/loyalty.css"><div id="list"></div>');return;}
    const b=files.get(req.url);if(!b){res.writeHead(404);res.end();return;}served.set(req.url,hash(b));
    res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':req.url.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(b);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await puppeteer.launch({executablePath:process.env.LOYALTY_BROWSER||process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run']});
    const page=await browser.newPage();await page.setViewport({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const number='[name=number]';
    async function setup(value='00123456789'){
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(async value=>{
        const {initLoyaltyUI}=await import('/js/loyalty-ui.js');
        window.entry={id:'n',description:'Number test',number:value,barcodeType:'QR',barcodeValue:'  raw QR 0012 34  ',images:[],updatedAt:'2026-11-20'};
        window.state={vault:{sections:{loyalty:[entry]}}};window.copies=[];
        window.api=initLoyaltyUI({state,requireRealVault:()=>true,saveFile:async()=>{window.persisted=structuredClone(state.vault)},copyText:v=>copies.push(v),brightness:{maximize:async()=>{},restore:async()=>{}}});
        api.openEditor(entry);
      },value);
    }
    async function caret(a,b=a){await page.$eval(number,(n,[a,b])=>{n.focus();n.setSelectionRange(a,b)},[a,b]);}
    async function current(){return page.$eval(number,n=>({value:n.value,at:n.selectionStart}));}
    await t.test('numeric keypad attributes, no maxlength, middle insert/backspace/delete',async()=>{
      await setup();assert.deepEqual(await page.$eval(number,n=>[n.type,n.inputMode,n.getAttribute('maxlength'),n.value]),['text','numeric',null,'0012 3456 789']);
      await caret(2);await page.keyboard.type('9');assert.deepEqual(await current(),{value:'0091 2345 6789',at:3});
      await page.keyboard.press('Backspace');assert.deepEqual(await current(),{value:'0012 3456 789',at:2});
      await caret(5);await page.keyboard.press('Backspace');assert.deepEqual(await current(),{value:'0013 4567 89',at:3});
      await setup();await caret(4);await page.keyboard.press('Delete');assert.deepEqual(await current(),{value:'0012 4567 89',at:4});
      await caret(4);await page.keyboard.type('3');assert.deepEqual(await current(),{value:'0012 3456 789',at:6});
    });
    if(process.env.NUMBER_BASELINE)return;
    await t.test('selection replacement, native clipboard paste with NBSP, draft lock/resume',async()=>{
      await setup();await caret(3,7);await page.keyboard.type('00');assert.equal((await current()).value,'0010 0567 89');
      await browser.defaultBrowserContext().overridePermissions(`http://127.0.0.1:${server.address().port}`,['clipboard-read','clipboard-write','clipboard-sanitized-write']);
      await page.evaluate(()=>navigator.clipboard.writeText('0000\u00a01234\u202f567'));
      await page.focus(number);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.press('KeyV');await page.keyboard.up('Control');
      await page.waitForFunction(()=>document.querySelector('[name=number]').value==='0000 1234 567');
      assert.equal(await page.evaluate(()=>state.vault.loyaltyDraft.data.number),'00001234567');
      await page.evaluate(()=>{window.dispatchEvent(new Event('seyf:locking'));api.resumeDraft()});
      assert.equal((await current()).value,'0000 1234 567');
      assert.equal(await page.$eval('[name=barcodeValue]',n=>n.value),'  raw QR 0012 34  ');
    });
    await t.test('save, detail/list/cashier grouped; copies raw; payload untouched',async()=>{
      await setup();await caret(13);await page.keyboard.type('0');await page.click('[type=submit]');await page.waitForSelector('.loyalty-detail-card');
      assert.equal(await page.$eval('.loyalty-number',n=>n.textContent),'0012 3456 7890');
      assert.deepEqual(await page.evaluate(()=>{api.renderList(document.querySelector('#list'));const c=state.vault.sections.loyalty[0];return [c.number,c.barcodeValue]}),['001234567890','  raw QR 0012 34  ']);
      assert.equal(await page.$eval('.loyalty-list-number',n=>n.textContent),'0012 3456 7890');
      await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Скопировать номер').click());
      await page.click('.loyalty-checkout-action');assert.equal(await page.$eval('.loyalty-number',n=>n.textContent),'0012 3456 7890');
      await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Скопировать номер').click());
      assert.deepEqual(await page.evaluate(()=>copies),['001234567890','001234567890']);
    });
    await t.test('legacy text survives unrelated save; long digits are not truncated',async()=>{
      await setup('  AB 001-234  ');assert.equal((await current()).value,'  AB 001-234  ');
      await page.click('.loyalty-favorite-toggle');await page.click('[type=submit]');await page.waitForSelector('.loyalty-detail-card');
      assert.equal(await page.evaluate(()=>state.vault.sections.loyalty[0].number),'  AB 001-234  ');
      await setup('0'.repeat(2048));assert.equal((await current()).value.replaceAll(' ','').length,2048);
      await page.click('[type=submit]');await page.waitForSelector('.loyalty-detail-card');assert.equal(await page.evaluate(()=>state.vault.sections.loyalty[0].number.length),2048);
    });
    await t.test('favorite row static; SVG star; keyboard and click toggle only small button',async()=>{
      await setup();await page.click('.loyalty-favorite-row .loyalty-star');assert.equal(await page.$eval('.loyalty-favorite-toggle',n=>n.getAttribute('aria-pressed')),'false');
      await page.focus('.loyalty-favorite-toggle');await page.keyboard.press('Space');
      assert.deepEqual(await page.$eval('.loyalty-favorite-row',n=>[n.tabIndex,n.dataset.favorite,n.querySelector('svg').getAttribute('fill'),n.querySelector('button').textContent,n.querySelector('button').getAttribute('aria-labelledby')]),[-1,'true','currentColor','Убрать из избранного',null]);
      await page.screenshot({path:`${out}/number-favorite-focus.png`});
      await page.hover('.loyalty-favorite-toggle');await page.screenshot({path:`${out}/number-favorite-hover.png`});
      await page.keyboard.press('Enter');assert.equal(await page.$eval('.loyalty-favorite-toggle',n=>n.textContent),'Добавить в избранное');
    });
    assert.deepEqual(errors,[]);
    const drift=[];for(const [url,h] of served){if(hash(await fs.readFile(path.join(root,url)))!==h)drift.push(url)}
    await fs.writeFile(`${out}/number-validation.json`,JSON.stringify({browser:await browser.version(),served:Object.fromEntries(served),drift,scope:'Real browser; synthetic vault; no phone/build',baseline:!!process.env.NUMBER_BASELINE},null,2));
    // Parent owns CSS/crop: report drift, do not silently claim those were checked.
    assert.equal(drift.includes('/js/loyalty-ui.js')||drift.includes('/js/loyalty-number.js'),false);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
