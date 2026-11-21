import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const root=path.resolve('www');
test('camera choice UI with real video tracks and controlled device catalog',async t=>{
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/loyalty.css">');return;}
  try{const p=path.resolve(root,'.'+req.url);if(!p.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');res.end(await fs.readFile(p));}catch{res.writeHead(404);res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await puppeteer.launch({executablePath:process.env.LOYALTY_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run']});
  const page=await browser.newPage();await page.setViewport({width:320,height:568});const errors=[];
  page.on('pageerror',e=>{const s=e.stack||e.message;if(!(s.includes('Web%20of%20Trust.user.js')&&s.includes('l.onreadystatechange')))errors.push(s);});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async()=>{
   window.state={vault:{sections:{loyalty:[]}}};window.requests=[];window.tracks=[];window.defer=false;
   window.cameras=[{kind:'videoinput',deviceId:'tele',label:'camera 4, facing back'},{kind:'videoinput',deviceId:'front',label:'camera 1, facing front'},{kind:'videoinput',deviceId:'main',label:'camera 0, facing back'}];
   window.makeStream=id=>{const c=document.createElement('canvas');c.width=640;c.height=480;c.getContext('2d').fillRect(0,0,640,480);const s=c.captureStream(5),tr=s.getVideoTracks()[0];tr.getSettings=()=>({deviceId:id,facingMode:'environment',focusMode:'continuous'});tr.getCapabilities=()=>({focusMode:['single-shot','continuous']});tr.applyConstraints=async()=>{};tracks.push(tr);return s;};
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{enumerateDevices:async()=>cameras,getUserMedia:async constraints=>{
    if(tracks.some(t=>t.readyState!=='ended'))throw Error('old camera still active');
    const id=constraints.video.deviceId?.exact||'tele';requests.push(id);
    if(defer)return new Promise(r=>window.grant=()=>r(makeStream(id)));
    return makeStream(id);
   }}});
   const M=await import('/js/loyalty-ui.js');window.api=M.createLoyaltyUI({state,requireRealVault:()=>true,canAdd:()=>true,saveFile:async()=>{},dlgConfirm:async()=>false});
   window.clickText=s=>[...document.querySelectorAll('button')].find(b=>b.textContent===s).click();
   api.openEditor();const n=document.querySelector('[name=description]');n.value='Synthetic unfinished card';n.dispatchEvent(new Event('input',{bubbles:true}));clickText('Сканировать код');
  });
  await t.test('reversed multi-camera catalog opens main with automatic focus and visible switch/Back',async()=>{
   await page.waitForSelector('.loyalty-switch-camera');
   assert.equal(await page.evaluate(()=>requests.at(-1)),'main');
   assert.equal(await page.evaluate(()=>requests.includes('front')),false);
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.loyalty-camera-controls button')].some(b=>/резкост|фокус/i.test(b.textContent))),false);
   await page.hover('.loyalty-switch-camera');await page.focus('.loyalty-switch-camera');
   const r=await page.evaluate(()=>{const b=document.querySelector('.loyalty-switch-camera'),stage=document.querySelector('.loyalty-camera-stage').getBoundingClientRect();return {height:b.getBoundingClientRect().height,focus:getComputedStyle(b).outlineStyle,overflow:document.documentElement.scrollWidth>320,stage:stage.height};});
   assert.ok(r.height>=44);assert.notEqual(r.focus,'none');assert.equal(r.overflow,false);assert.ok(r.stage>=100);
   await page.screenshot({path:'qa/loyalty-round3-20261120/camera-controls-320.png'});
  });
  await t.test('switch releases old track, avoids front camera, Back preserves form and selection',async()=>{
   await page.click('.loyalty-switch-camera');await page.waitForFunction(()=>requests.at(-1)==='tele'&&!!document.querySelector('.loyalty-switch-camera'));
   assert.equal(await page.evaluate(()=>tracks.filter(t=>t.readyState==='live').length),1);
   await page.click('.loyalty-scan-back');assert.equal(await page.evaluate(()=>tracks.every(t=>t.readyState==='ended')),true);
   assert.equal(await page.$eval('[name=description]',e=>e.value),'Synthetic unfinished card');
   await page.evaluate(()=>clickText('Сканировать код'));await page.waitForSelector('.loyalty-switch-camera');
   assert.equal(await page.evaluate(()=>requests.at(-1)),'tele');
  });
  await t.test('late switched-camera permission after lock releases tracks and keeps protected draft',async()=>{
   await page.evaluate(()=>{defer=true;clickText('Другая камера');});await page.waitForFunction(()=>!!window.grant);
   await page.evaluate(()=>{window.dispatchEvent(new Event('seyf:locking'));grant();});
   await page.waitForFunction(()=>tracks.every(t=>t.readyState==='ended'));
   assert.equal(await page.$('.loyalty-scan-window'),null);
   assert.equal(await page.evaluate(()=>state.vault.loyaltyDraft.data.description),'Synthetic unfinished card');
  });
  await page.evaluate(()=>api.destroy());assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
