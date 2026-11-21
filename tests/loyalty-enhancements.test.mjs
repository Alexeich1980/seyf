import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../www/js/loyalty.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

test('UX fixture: both adjacent QR codes are returned from the actual uploaded PNG', {skip:!process.env.HEAVY_LOCK_HELD,timeout:30000}, async () => {
  const root=path.resolve('www');
  const fixture=await fs.readFile('qa/loyalty-six-ux/synthetic-multiple.png');
  const index=await fs.readFile(path.join(root,'index.html'),'utf8');
  const csp=index.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)?.[0] || '';
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html>'+csp);return;}
    const p=path.resolve(root,'.'+req.url);
    if(!p.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
    try{res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(p));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    const {default:puppeteer}=await import('puppeteer-core');
    browser=await puppeteer.launch({executablePath:process.env.LOYALTY_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
    const page=await browser.newPage();
    const external=[];
    await page.setRequestInterception(true);
    page.on('request',request=>{
      if(request.url().startsWith(`http://127.0.0.1:${server.address().port}/`) || request.url().startsWith('blob:')) request.continue();
      else {external.push(request.url());request.abort();}
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    for(const angle of [0,90,180,270]) {
    const result=await page.evaluate(async ({base64,angle})=>{
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
      const {decodeCardImage}=await import('/js/loyalty.js');
      let file=new File([bytes],'synthetic-multiple.png',{type:'image/png'});
      // At 0 degrees pass the original bytes directly, without regenerating the fixture.
      if(angle) {
        const bitmap=await createImageBitmap(file);
        try {
          const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
          canvas.width=angle%180 ? bitmap.height : bitmap.width;
          canvas.height=angle%180 ? bitmap.width : bitmap.height;
          ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle*Math.PI/180);
          ctx.drawImage(bitmap,-bitmap.width/2,-bitmap.height/2);
          file=new File([await new Promise(r=>canvas.toBlob(r))],'rotated.png',{type:'image/png'});
        } finally {bitmap.close();}
      }
      return decodeCardImage(file);
    },{base64:fixture.toString('base64'),angle});
    assert.deepEqual(result.sort((a,b)=>a.barcodeValue.localeCompare(b.barcodeValue)),[
      {barcodeType:'QR',barcodeValue:'11112222'},
      {barcodeType:'QR',barcodeValue:'33334444'},
    ],`fixture rotation ${angle}`);
    }
    assert.deepEqual(external,[]);
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
});

test('colors are safe, deterministic and survive edits without retaining injected CSS', () => {
  assert.equal(L.LOYALTY_COLORS?.length, 10);
  for (const color of L.LOYALTY_COLORS) {
    assert.match(color, /^#[0-9a-f]{6}$/i);
    assert.equal(L.cardColor({color}), color);
    assert.equal(L.makeCard({description:'Shop',number:'001',color}).color,color);
  }
  const original=L.makeCard({description:'Shop',number:'001',color:L.LOYALTY_COLORS[1]});
  assert.equal(L.makeCard({description:'Shop',number:'001'},original).color,original.color);
  for (const color of ['red','url(https://bad)', '#abc;display:none', '#123456', null]) {
    assert.ok(L.LOYALTY_COLORS.includes(L.cardColor({description:'Shop',color})));
    assert.ok(L.LOYALTY_COLORS.includes(L.makeCard({description:'Shop',number:'001',color}).color));
  }
  assert.equal(L.cardColor({description:'Shop'}),L.cardColor({description:'Shop'}));
});

test('duplicates preserve zeros, type and store identity, exclude own id', () => {
  assert.equal(typeof L.findDuplicateCard,'function');
  const code={id:'a',description:'A',barcodeType:'CODE128',barcodeValue:'00123'};
  assert.equal(L.findDuplicateCard([code],{...code,id:'b'}),code);
  assert.equal(L.findDuplicateCard([code],code),null);
  for (const edit of [{barcodeValue:'123'},{barcodeType:'QR'},{barcodeValue:''}])
    assert.equal(L.findDuplicateCard([code],{...code,id:'b',...edit}),null);
  const number={id:'n',description:'  MY  Shop ',number:'00123'};
  assert.equal(L.findDuplicateCard([number],{description:'my shop',number:'00123'}),number);
  for (const edit of [{description:'Other'},{number:'123'},{number:''},{barcodeType:'QR',barcodeValue:'00123'}])
    assert.equal(L.findDuplicateCard([number],{description:'my shop',number:'00123',...edit}),null);
});

test('favorite moves swap favorite slots only; list stays stable and edges are no-ops', () => {
  assert.equal(typeof L.moveFavorite,'function');
  const rows=[{id:'a',favorite:true},{id:'n'},{id:'b',favorite:true},{id:'m'},{id:'c',favorite:true}];
  assert.equal(L.moveFavorite(rows,'b','up'),true);
  assert.deepEqual(rows.map(x=>x.id),['b','n','a','m','c']);
  assert.deepEqual(L.listCards(rows).map(x=>x.id),['b','a','c','n','m']);
  assert.equal(L.moveFavorite(rows,'a','down'),true);
  assert.deepEqual(rows.map(x=>x.id),['b','n','c','m','a']);
  for (const args of [['b','up'],['a','down'],['n','down'],['missing','up'],['c','sideways']])
    assert.equal(L.moveFavorite(rows,...args),false);
});

test('browser File decoding: actual codecs, multi-code, rotations, blank, corrupt and MIME', {skip:!process.env.HEAVY_LOCK_HELD,timeout:120000}, async t => {
  const root=path.resolve('www');
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/'){
      const index=await fs.readFile(path.join(root,'index.html'),'utf8');
      const csp=index.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)?.[0] || '';
      res.setHeader('Content-Type','text/html');res.end('<!doctype html>'+csp);return;
    }
    const p=path.resolve(root,'.'+req.url);
    if(!p.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
    try{res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(p));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    const {default:puppeteer}=await import('puppeteer-core');
    browser=await puppeteer.launch({executablePath:process.env.LOYALTY_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(()=>{
      window.liveURLs=new Set();
      const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
      URL.createObjectURL=blob=>{const url=create(blob);liveURLs.add(url);return url;};
      URL.revokeObjectURL=url=>{liveURLs.delete(url);revoke(url);};
    });
    assert.equal(await page.evaluate(async()=>typeof (await import('/js/loyalty.js')).decodeCardImage),'function');
    const samples=[['EAN13','4601234567893'],['EAN8','96385074'],['UPC','036000291452'],['CODE128','00012345'],['QR','Карта 000123']];
    const scan=async(codes,rotation=0,mime='image/png')=>page.evaluate(async({codes,rotation,mime})=>{
      const L=await import('/js/loyalty.js');
      const c=document.createElement('canvas');c.width=1200;c.height=1000;
      const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);
      codes.forEach(([type,value],i)=>{const b=document.createElement('canvas');L.drawBarcode(b,type,value);x.drawImage(b,60+(i%2)*600,60+Math.floor(i/2)*480);});
      const r=document.createElement('canvas');r.width=rotation?c.height:c.width;r.height=rotation?c.width:c.height;
      const ctx=r.getContext('2d');if(rotation){ctx.translate(r.width,0);ctx.rotate(Math.PI/2);}ctx.drawImage(c,0,0);
      const blob=await new Promise(resolve=>r.toBlob(resolve,mime));
      const result=await L.decodeCardImage(new File([blob],'photo',{type:mime}));
      if(liveURLs.size) throw Error('Object URL leak');
      return result;
    },{codes,rotation,mime});
    for(const sample of samples) await t.test(sample[0],async()=>assert.deepEqual(await scan([sample]),[{barcodeType:sample[0],barcodeValue:sample[1]}]));
    await t.test('multiple distinct QR and linear codes, repeated QR deduped',async()=>{
      const result=await scan([samples[4],samples[3],samples[4],['QR','SECOND']]);
      assert.deepEqual(result.map(x=>x.barcodeType+':'+x.barcodeValue).sort(),['QR:Карта 000123','CODE128:00012345','QR:SECOND'].sort());
    });
    await t.test('rotated linear',async()=>assert.deepEqual(await scan([samples[3]],90),[{barcodeType:'CODE128',barcodeValue:'00012345'}]));
    await t.test('blank',async()=>assert.deepEqual(await scan([]),[]));
    for(const mime of ['image/jpeg','image/webp']) await t.test(mime,async()=>assert.deepEqual(await scan([samples[4]],0,mime),[{barcodeType:'QR',barcodeValue:'Карта 000123'}]));
    for(const [mime,data] of [['image/svg+xml','<svg/>'],['image/png','broken']]) {
      assert.match(await page.evaluate(async({mime,data})=>{try{await (await import('/js/loyalty.js')).decodeCardImage(new File([data],'bad',{type:mime}));return 'accepted';}catch(e){return e.message;}},{mime,data}),/[А-Яа-я]/);
    }
    await t.test('oversized and empty files reject before decoding',async()=>{
      for(const size of [0,12*1024*1024+1]) assert.match(await page.evaluate(async size=>{
        try{await (await import('/js/loyalty.js')).decodeCardImage(new File([new Uint8Array(size)],'size.png',{type:'image/png'}));return 'accepted';}
        catch(e){return e.message;}
      },size),/12 МБ/);
    });
    await t.test('stalled real worker is terminated at deadline and URLs released',async()=>{
      const result=await page.evaluate(async()=>{
        const NativeWorker=Worker;let terminated=false;
        const hangURL=URL.createObjectURL(new Blob(['onmessage=()=>{while(true){}}'],{type:'text/javascript'}));
        window.Worker=class extends NativeWorker {
          constructor(){super(hangURL);}
          terminate(){terminated=true;super.terminate();}
        };
        const canvas=document.createElement('canvas');canvas.width=canvas.height=10;
        const blob=await new Promise(r=>canvas.toBlob(r));const start=performance.now();let message;
        try{await (await import('/js/loyalty.js')).decodeCardImage(new File([blob],'stall.png',{type:'image/png'}));}
        catch(e){message=e.message;}
        finally{window.Worker=NativeWorker;URL.revokeObjectURL(hangURL);}
        return {message,terminated,elapsed:performance.now()-start,live:liveURLs.size};
      });
      assert.match(result.message,/слишком много времени/);assert.equal(result.terminated,true);
      assert.equal(result.live,0);assert.ok(result.elapsed>=9500 && result.elapsed<15000);
    });
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
});
