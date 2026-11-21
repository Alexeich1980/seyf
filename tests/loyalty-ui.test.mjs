import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const root = path.resolve('www');
test('loyalty UI in real Chromium: save, failed persistence, vault races, lock and brightness', async t => {
  const server = http.createServer(async (req,res) => {
    if (req.url === '/') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/loyalty.css"><div id="list"></div>'); return; }
    try { const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0])); if(!p.startsWith(root+path.sep)) throw Error(); res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/plain'); res.end(await fs.readFile(p)); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser=await puppeteer.launch({executablePath:process.env.LOYALTY_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-first-run']});
    const page=await browser.newPage(); await page.setViewport({width:390,height:844});
    const errors=[]; page.on('pageerror',e=>{const trace=e.stack||e.message;if(trace.includes('Web%20of%20Trust.user.js')&&trace.includes('l.onreadystatechange'))console.log('ENVIRONMENT',trace);else errors.push(trace);});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async()=> {
      window.M=await import('/js/loyalty-ui.js'); window.calls=[];
      window.state={vault:{sections:{loyalty:[]}}};
      window.pendingSaves=[];window.finishSave=()=>pendingSaves.splice(0).forEach(resolve=>resolve());
      window.mode='ok';window.allowAdd=true;window.allowDelete=false;window.discard=false;
      window.api=M.initLoyaltyUI({state,withSystemWindow:(fn,opts)=>window.realSys ? realSys.run(fn,opts) : fn(),dlgConfirm:async()=>{calls.push(['confirm']);return discard;},canAdd:()=>{calls.push(['gate']);return allowAdd;},deleteEntry:async()=>allowDelete,requireRealVault:()=>!!state.vault,toast:m=>calls.push(['toast',m]),refresh:()=>calls.push(['refresh']),
        brightness:{maximize:async()=>calls.push(['max']),restore:async()=>calls.push(['restore'])},
        saveFile:async()=>{calls.push(['save']);if(mode==='fail')throw Error('disk');if(mode==='delay')await new Promise(r=>pendingSaves.push(r));}});
    });
    await t.test('manual editor saves exact number and opens card',async()=> {
      await page.evaluate(()=>api.openEditor());
      await page.type('[name=description]','Магазин'); await page.type('[name=number]','0001234');
      await page.click('.loyalty-form button[type=submit]'); await page.waitForSelector('.loyalty-number');
      assert.deepEqual(await page.evaluate(()=>({n:state.vault.sections.loyalty[0].number,t:state.vault.sections.loyalty[0].barcodeType,text:document.querySelector('.loyalty-number').textContent})),{n:'0001234',t:'',text:'0001 234'});
    });
    await t.test('favorite and list photo rendered safely',async()=> {
      await page.evaluate(()=>[...document.querySelectorAll('.loyalty button')].find(b=>b.textContent==='В избранное').click());
      await page.waitForFunction(()=>state.vault.sections.loyalty[0].favorite);
      const out=await page.evaluate(()=>{
        const entry=state.vault.sections.loyalty[0]; entry.description='<script>bad</script>'; entry.images=[{side:'front',mime:'image/png',data:'iVBORw0KGgo='}];
        api.renderList(document.querySelector('#list')); return {favorite:!!document.querySelector('.loyalty-favorite'),img:!!document.querySelector('.loyalty-list-card img'),script:!!document.querySelector('#list script')};
      }); assert.deepEqual(out,{favorite:true,img:true,script:false});
    });
    await t.test('failed save retains memory truth and keeps editor',async()=> {
      await page.evaluate(()=>{mode='fail';api.openEditor(state.vault.sections.loyalty[0]);document.querySelector('[name=description]').value='Changed';document.querySelector('form').requestSubmit();});
      await page.waitForFunction(()=>calls.some(c=>c[0]==='toast'));
      assert.equal(await page.evaluate(()=>state.vault.sections.loyalty[0].description),'Changed'); assert.ok(await page.$('.loyalty-form'));
    });
    await t.test('lock during pending save prevents reopening or refresh',async()=> {
      // Discard the preceding failure-case draft explicitly; this scenario creates a new card.
      await page.evaluate(async()=>{mode='ok';discard=true;await api.close();discard=false;mode='delay';api.openEditor();document.querySelector('[name=description]').value='Pending';document.querySelector('[name=number]').value='001';document.querySelector('form').requestSubmit();});
      await page.waitForFunction(()=>pendingSaves.length>0);
      const count=await page.evaluate(()=>calls.filter(c=>c[0]==='refresh').length);
      await page.evaluate(()=>{window.dispatchEvent(new Event('seyf:locking'));state.vault=null;finishSave();});
      await page.evaluate(()=>new Promise(r=>setTimeout(r,20)));
      assert.equal(await page.$('.loyalty-back'),null); assert.equal(await page.evaluate(()=>document.querySelector('#list').childElementCount),0);
      assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='refresh').length),count);
    });
    await t.test('brightness restores on close and locking, QR canvas is usable',async()=> {
      const out=await page.evaluate(async()=>{
        state.vault={sections:{loyalty:[]}};mode='ok';
        const card={description:'QR',number:'123',barcodeType:'QR',barcodeValue:'hello',images:[]};
        api.openCard(card);const width=document.querySelector('.loyalty-barcode').width;
        await new Promise(r=>setTimeout(r,0));await api.close();await new Promise(r=>setTimeout(r,0));api.openCard(card);await new Promise(r=>setTimeout(r,0));window.dispatchEvent(new Event('seyf:locking'));
        await new Promise(r=>setTimeout(r,0));return {width,calls:calls.filter(c=>['max','restore'].includes(c[0])).map(c=>c[0])};
      });assert.equal(out.width,360);assert.deepEqual(out.calls,['max','restore','max','restore']);
    });
    await t.test('foreign vault during save never reopens old content',async()=> {
      const out=await page.evaluate(async()=>{
        mode='delay';api.openEditor();document.querySelector('[name=description]').value='Old';document.querySelector('[name=number]').value='012';document.querySelector('form').requestSubmit();
        await new Promise(r=>setTimeout(r,0));state.vault={sections:{loyalty:[]}};finishSave();await new Promise(r=>setTimeout(r,0));return {entries:state.vault.sections.loyalty.length,card:!!document.querySelector('.loyalty-number')};
      });assert.deepEqual(out,{entries:0,card:false});
    });
    await t.test('creation gate checked on open and save; failed retry never duplicates', async()=> {
      // The previous case deliberately swapped vault identity without a lock event.
      // End that synthetic session before testing the independent creation gate.
      await page.evaluate(async()=>{window.dispatchEvent(new Event('seyf:locking'));mode='ok';discard=true;await api.close();discard=false;allowAdd=false;api.openEditor();}); assert.equal(await page.$('.loyalty-form'),null);
      await page.evaluate(()=>{allowAdd=true;api.openEditor();document.querySelector('[name=description]').value='Gate';document.querySelector('[name=number]').value='007';allowAdd=false;document.querySelector('form').requestSubmit();});
      await page.evaluate(()=>new Promise(r=>setTimeout(r,0)));assert.equal(await page.evaluate(()=>state.vault.sections.loyalty.length),0);
      await page.evaluate(()=>{allowAdd=true;mode='fail';document.querySelector('form').requestSubmit();});
      await page.waitForFunction(()=>state.vault.sections.loyalty.length===1);
      const id=await page.evaluate(()=>state.vault.sections.loyalty[0].id);
      await page.evaluate(()=>{allowAdd=false;mode='ok';document.querySelector('form').requestSubmit();});
      await page.waitForSelector('.loyalty-number');
      assert.deepEqual(await page.evaluate(()=>state.vault.sections.loyalty.map(c=>c.id)),[id]);
      await page.evaluate(()=>api.openEditor(state.vault.sections.loyalty[0]));assert.ok(await page.$('.loyalty-form'));
    });
    await t.test('delete callback cancellation keeps card, successful boolean closes',async()=> {
      await page.evaluate(async()=>{await api.openCard(state.vault.sections.loyalty[0]);[...document.querySelectorAll('.loyalty button')].find(b=>b.textContent==='Удалить карту').click();});
      await page.evaluate(()=>new Promise(r=>setTimeout(r,0)));assert.ok(await page.$('.loyalty-back'));
      await page.evaluate(()=>{allowDelete=true;[...document.querySelectorAll('.loyalty button')].find(b=>b.textContent==='Удалить карту').click();});
      await page.waitForFunction(()=>!document.querySelector('.loyalty-back'));
    });
    await t.test('real document photo crop is cancelled and removed on lock',async()=> {
      await page.evaluate(()=>api.openEditor(state.vault.sections.loyalty[0]));
      const chooser=page.waitForFileChooser();
      await page.evaluate(()=>[...document.querySelectorAll('.loyalty button')].find(b=>b.textContent==='Из галереи').click());
      await chooser;
      await page.evaluate(async()=>{
        const canvas=document.createElement('canvas');canvas.width=80;canvas.height=50;canvas.getContext('2d').fillRect(0,0,80,50);
        const blob=await new Promise(r=>canvas.toBlob(r));const dt=new DataTransfer();dt.items.add(new File([blob],'fixture.png',{type:'image/png'}));
        const input=document.querySelector('input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change'));
      });
      await page.waitForSelector('.crop-editor');await page.evaluate(()=>window.dispatchEvent(new Event('seyf:locking')));
      assert.equal(await page.$('.crop-editor'),null);assert.equal(await page.$('.loyalty-back'),null);
    });
    await t.test('320px long title/2048-digit number/photo/favorite never overflow; themed 44px actions', async()=> {
      await page.setViewport({width:320,height:740});
      await page.evaluate(async()=>{await api.close();const c={id:'long',description:'М'.repeat(200),number:'0'.repeat(2048),favorite:true,images:[{id:'p',side:'front',mime:'image/png',data:'iVBORw0KGgo='}]};state.vault.sections.loyalty=[c];api.renderList(document.querySelector('#list'));});
      const result=await page.evaluate(()=>{
        const row=document.querySelector('.loyalty-card-open'), title=document.querySelector('.loyalty-list-title'),number=document.querySelector('.loyalty-list-number');
        return {width:row.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>320,ellipsis:getComputedStyle(title).textOverflow,nowrap:getComputedStyle(number).whiteSpace,numberClipped:number.scrollWidth>number.clientWidth,font:getComputedStyle(row).fontFamily,bodyFont:getComputedStyle(document.body).fontFamily};
      });assert.equal(result.overflow,false);assert.ok(result.width<=320);assert.equal(result.ellipsis,'ellipsis');assert.equal(result.nowrap,'nowrap');assert.ok(result.numberClipped);assert.equal(result.font,result.bodyFont);
      await page.hover('.loyalty-card-open');await page.keyboard.press('Tab');await page.focus('.loyalty-card-open');
      assert.notEqual(await page.$eval('.loyalty-card-open',e=>getComputedStyle(e).outlineStyle),'none');
      await page.evaluate(()=>api.openEditor(state.vault.sections.loyalty[0]));
      await page.evaluate(()=>Promise.all(document.querySelector('.loyalty').getAnimations().map(a=>a.finished)));
      const form=await page.evaluate(()=>({width:document.querySelector('.loyalty').getBoundingClientRect().width,scroll:document.querySelector('.loyalty').scrollWidth,buttons:[...document.querySelectorAll('.loyalty .btn')].filter(b=>b.getClientRects().length).map(b=>({height:b.getBoundingClientRect().height,font:getComputedStyle(b).fontFamily})),font:getComputedStyle(document.body).fontFamily}));
      assert.equal(form.width,320);assert.ok(form.scroll<=320);assert.ok(form.buttons.every(b=>b.height>=44 && b.font===form.font));
      if (process.env.LOYALTY_SCREENSHOT) await page.screenshot({path:process.env.LOYALTY_SCREENSHOT});
    });
    await t.test('short background keeps editor; Escape keeps protected draft; resume and explicit discard',async()=> {
      await page.evaluate(()=>{document.querySelector('[name=description]').value='Unsaved';Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await page.$eval('[name=description]',e=>e.value),'Unsaved');
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
      await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.loyalty-form'));
      assert.equal(await page.evaluate(()=>state.vault.loyaltyDraft?.data.description),'Unsaved');
      await page.evaluate(()=>api.resumeDraft());
      assert.equal(await page.$eval('[name=description]',e=>e.value),'Unsaved');
      assert.ok(await page.evaluate(()=>calls.some(c=>c[0]==='confirm')));
      await page.evaluate(()=>{discard=true;document.querySelector('.loyalty-close').click();});await page.waitForFunction(()=>!document.querySelector('.loyalty-back'));
      assert.equal(await page.evaluate(()=>state.vault.loyaltyDraft),undefined);
    });
    await t.test('permission background keeps editor, late stream after lock stops without playing',async()=> {
      await page.evaluate(()=>{
        allowAdd=true;discard=false;api.openEditor();window.trackStops=0;
        Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>new Promise(r=>window.grantCamera=r)});
        [...document.querySelectorAll('.loyalty button')].find(b=>b.textContent==='Сканировать код').click();
      });await page.waitForFunction(()=>!!window.grantCamera);
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert.ok(await page.$('.loyalty-form'));
      await page.evaluate(()=>{grantCamera({getTracks:()=>[{stop:()=>trackStops++}]});});
      await page.evaluate(()=>new Promise(r=>setTimeout(r,0)));
      await page.evaluate(()=>window.dispatchEvent(new Event('seyf:locking')));
      await page.waitForFunction(()=>trackStops>0);assert.equal(await page.$('.loyalty-back'),null);
      await page.evaluate(()=>{delete document.hidden;});
    });
    await t.test('R134-03 real syswindow: lock stops granted tracks before foreground',async()=> {
      const before=await page.evaluate(async()=>{
        const {createSysWindow}=await import('/js/syswindow.js');window.realSys=createSysWindow();
        window.trackStops=0;window.grantCamera=null;api.openEditor();
        Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>new Promise(r=>window.grantCamera=r)});
        [...document.querySelectorAll('.loyalty button')].find(b=>b.textContent==='Сканировать код').click();
        for(let i=0;i<100&&!window.grantCamera;i++)await new Promise(r=>setTimeout(r,10));
        if(!window.grantCamera)throw Error('Camera permission request did not start');realSys.background();
        Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
        grantCamera({getTracks:()=>[{stop:()=>trackStops++}]});await new Promise(r=>setTimeout(r,0));
        const held=realSys.isOpen(), before=trackStops;
        window.dispatchEvent(new Event('seyf:locking'));
        return {held,before,immediate:trackStops,hidden:realSys.isHidden(),modal:!!document.querySelector('.loyalty-back')};
      });assert.deepEqual(before,{held:true,before:0,immediate:1,hidden:true,modal:false});
      const after=await page.evaluate(async()=>{realSys.foreground();delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));await new Promise(r=>setTimeout(r,0));return {stops:trackStops,modal:!!document.querySelector('.loyalty-back')};});assert.deepEqual(after,{stops:1,modal:false});
    });
    await t.test('R134-03 real syswindow: explicit stop and late grant after lock release tracks in background',async()=> {
      for (const late of [false,true]) {
        const result=await page.evaluate(async late=>{
          const {createSysWindow}=await import('/js/syswindow.js');window.realSys=createSysWindow();trackStops=0;grantCamera=null;api.openEditor();
          [...document.querySelectorAll('.loyalty button')].find(b=>b.textContent==='Сканировать код').click();
          for(let i=0;i<100&&!window.grantCamera;i++)await new Promise(r=>setTimeout(r,10));
          if(!window.grantCamera)throw Error('Camera permission request did not start');
          realSys.background();Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
          if (late) window.dispatchEvent(new Event('seyf:locking'));
          grantCamera({getTracks:()=>[{stop:()=>trackStops++}]});await new Promise(r=>setTimeout(r,0));
          if (!late) [...document.querySelectorAll('.loyalty button')].find(b=>b.textContent==='Назад').click();
          const result={stops:trackStops,hidden:realSys.isHidden(),held:realSys.isOpen()};
          realSys.foreground();delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));await new Promise(r=>setTimeout(r,0));
          await api.close();window.realSys=null;return {...result,after:trackStops};
        },late);assert.deepEqual(result,{stops:1,hidden:true,held:true,after:1});
      }
    });
    await page.evaluate(()=>api.destroy());
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
});
