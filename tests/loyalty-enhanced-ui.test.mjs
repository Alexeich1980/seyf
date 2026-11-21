import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// Controlled boundaries: real UI + barcode renderer, synthetic draft repository,
// file chooser and decoding delays. Encryption/serialSave integration belongs to draft tests.
const root = path.resolve('www');
const helpers = `export {makeCard,listCards,drawBarcode,startBarcodeScan,LOYALTY_COLORS,LOYALTY_COLOR_NAMES,cardColor} from './loyalty.js';
export const decodeCardImage=()=>window.decodeResult();
export const findDuplicateCard=(entries,c)=>entries.find(e=>e.id!==c.id&&c.barcodeType&&e.barcodeType===c.barcodeType&&e.barcodeValue===c.barcodeValue);
export function moveFavorite(entries,id,direction){const favorites=entries.filter(e=>e.favorite);const i=favorites.findIndex(e=>e.id===id),j=i+(direction==='up'?-1:1);if(j<0||j>=favorites.length)return false;const a=entries.indexOf(favorites[i]),b=entries.indexOf(favorites[j]);[entries[a],entries[b]]=[entries[b],entries[a]];return true;}`;
const drafts = `export function createLoyaltyDrafts(D){return {
read:(v=D.state.vault)=>v?.draft?structuredClone(v.draft):null,
write:(v,d)=>{if(v!==D.state.vault)return false;v.draft=structuredClone(d);return true},
remove:(v,id)=>{if(v.draft?.id===id)delete v.draft},
flush:async(v)=>{window.events.push('flush');window.persisted=structuredClone(v)},destroy(){}
}}`;
const photos = `export const chooseFiles=async()=>window.cancelPick?[]:[{}];export const filesToPages=async()=>window.cancelCrop?{pages:[],errors:[]}:{pages:[{id:'photo',mime:'image/png',data:'iVBORw0KGgo='}],errors:[]};`;

test('enhanced loyalty UI transitions (Chromium, controlled external boundaries)', async t => {
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/loyalty.css"><div id="list"></div>');return;}
    res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');
    const fixtures={'/js/ui-test-helpers.js':helpers,'/js/ui-test-drafts.js':drafts,'/js/ui-test-photos.js':photos};
    if(fixtures[req.url]){res.end(fixtures[req.url]);return;}
    try {const file=path.resolve(root,'.'+req.url);if(!file.startsWith(root+path.sep))throw Error();let content=await fs.readFile(file,'utf8');if(req.url==='/js/loyalty-ui.js')content=content.replace("from './loyalty.js'","from './ui-test-helpers.js'").replace("from './loyalty-drafts.js'","from './ui-test-drafts.js'").replace("from './doc-viewer.js'","from './ui-test-photos.js'");res.end(content);}catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await puppeteer.launch({executablePath:process.env.LOYALTY_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-first-run']});
    const page=await browser.newPage();await page.setViewport({width:390,height:844});
    const errors=[];page.on('pageerror',e=>{const trace=e.stack||e.message;if(trace.includes('Web%20of%20Trust.user.js')&&trace.includes('l.onreadystatechange'))console.log('ENVIRONMENT',trace);else errors.push(trace);});
    async function setup(){await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(async()=>{
      window.M=await import('/js/loyalty-ui.js');window.events=[];window.answers=[];window.state={vault:{sections:{loyalty:[]}}};window.fail=false;window.decodeResult=async()=>[];
      window.deps={state,requireRealVault:()=>!!state.vault,canAdd:()=>true,dlgConfirm:async()=>answers.shift()??false,copyText:n=>events.push(['copy',n]),refresh:()=>events.push('refresh'),toast:m=>events.push(m),saveFile:async()=>{events.push('save');if(fail)throw Error('disk');},brightness:{maximize:async opts=>events.push(['max',opts]),restore:async()=>events.push('restore')}};
      window.api=M.initLoyaltyUI(deps);
      window.fill=(name,value)=>{const n=document.querySelector('[name='+name+']');n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));};
      window.clickText=text=>[...document.querySelectorAll('.loyalty button')].find(b=>b.textContent===text).click();
    });}
    await t.test('lock flushes raw fields and photos; reconstructed vault resumes same ID',async()=>{
      await setup();await page.evaluate(()=>{api.openEditor();fill('description','Магазин');fill('number','0007');clickText('Из галереи');});
      await page.waitForFunction(()=>state.vault.draft?.data.images.length===1);
      const id=await page.evaluate(()=>{const id=state.vault.draft.id;window.dispatchEvent(new Event('seyf:locking'));state.vault=null;return id;});
      assert.equal(await page.$('.loyalty-back'),null);
      await page.evaluate(()=>{api.destroy();state.vault=structuredClone(persisted);api=M.initLoyaltyUI(deps);api.resumeDraft();});
      assert.equal(await page.$eval('[name=number]',e=>e.value),'0007');assert.equal(await page.$$eval('.loyalty-photo',e=>e.length),1);
      await page.click('[type=submit]');await page.waitForSelector('.loyalty-number');
      assert.deepEqual(await page.evaluate(()=>state.vault.sections.loyalty.map(e=>e.id)),[id]);assert.equal(await page.evaluate(()=>state.vault.draft),undefined);
    });
    await t.test('close keeps draft; other editor cannot overwrite; explicit discard removes',async()=>{
      await setup();await page.evaluate(async()=>{api.openEditor();fill('description','Draft');fill('number','1');await api.close();api.openEditor({id:'other',description:'Other'});});
      assert.equal(await page.$eval('[name=description]',e=>e.value),'Draft');
      await page.evaluate(async()=>{answers.push(true);await api.close();});assert.equal(await page.evaluate(()=>state.vault.draft),undefined);
    });
    await t.test('late close-dialog answer after lock cannot open old card in new vault',async()=>{
      await setup();await page.evaluate(()=>{deps.dlgConfirm=()=>new Promise(r=>window.answerClose=r);api.openEditor();fill('description','Draft');api.openCard({description:'Private old card',number:'secret',images:[]});});
      await page.waitForFunction(()=>!!window.answerClose);
      await page.evaluate(()=>{window.dispatchEvent(new Event('seyf:locking'));state.vault={sections:{loyalty:[]}};answerClose(false);});
      await page.evaluate(()=>new Promise(r=>setTimeout(r,20)));assert.equal(await page.$('.loyalty-back'),null);
    });
    await t.test('failed save retries with same ID and preserves raw editor draft',async()=>{
      await setup();await page.evaluate(()=>{api.openEditor();fill('description','Retry');fill('number','000');fail=true;document.querySelector('form').requestSubmit();});
      await page.waitForFunction(()=>events.some(e=>typeof e==='string'&&e.includes('не подтверждена')));
      const id=await page.evaluate(()=>state.vault.sections.loyalty[0].id);
      await page.evaluate(()=>{fail=false;document.querySelector('form').requestSubmit();});await page.waitForSelector('.loyalty-number');
      assert.deepEqual(await page.evaluate(()=>state.vault.sections.loyalty.map(e=>e.id)),[id]);
    });
    await t.test('multiple photo codes require choice; exact chosen format and payload previewed',async()=>{
      await setup();await page.evaluate(()=>{decodeResult=async()=>[{barcodeType:'QR',barcodeValue:'first'},{barcodeType:'CODE128',barcodeValue:'00012'}];api.openEditor();clickText('Из галереи');});
      await page.waitForFunction(()=>document.body.textContent.includes('CODE128: 00012'));
      assert.equal(await page.$eval('[name=barcodeType]',e=>e.value),'');
      await page.evaluate(()=>clickText('CODE128: 00012'));
      assert.deepEqual(await page.evaluate(()=>[state.vault.draft.data.barcodeType,state.vault.draft.data.barcodeValue,document.querySelector('canvas.loyalty-barcode').hidden]),['CODE128','00012',false]);
    });
    await t.test('photo decode completion after lock or vault switch is inert',async()=>{
      await setup();await page.evaluate(()=>{decodeResult=()=>new Promise(r=>window.finishDecode=r);api.openEditor();fill('description','Old');clickText('Из галереи');});
      await page.waitForFunction(()=>!!window.finishDecode);
      await page.evaluate(()=>{window.dispatchEvent(new Event('seyf:locking'));state.vault={sections:{loyalty:[]}};api.openEditor();fill('description','New');finishDecode([{barcodeType:'QR',barcodeValue:'secret'}]);});
      await page.evaluate(()=>new Promise(r=>setTimeout(r,20)));
      assert.equal(await page.$eval('[name=barcodeValue]',e=>e.value),'');assert.equal(await page.evaluate(()=>state.vault.draft.data.description),'New');
    });
    await t.test('duplicate cancellation retains draft; opening existing never merges',async()=>{
      await setup();await page.evaluate(()=>{state.vault.sections.loyalty=[{id:'existing',description:'Existing',barcodeType:'QR',barcodeValue:'same',images:[]}];api.openEditor();fill('description','New');fill('barcodeType','QR');fill('barcodeValue','same');document.querySelector('form').requestSubmit();});
      await page.waitForFunction(()=>document.body.textContent.includes('Открыть существующую карту'));
      assert.equal(await page.evaluate(()=>state.vault.sections.loyalty.length),1);assert.ok(await page.evaluate(()=>state.vault.draft));
      await page.evaluate(()=>clickText('Открыть существующую карту'));assert.ok(await page.$('.loyalty-detail-card'));assert.equal(await page.$('.loyalty-number'),null);assert.ok(await page.evaluate(()=>state.vault.draft));
    });
    await t.test('duplicate explicitly saved as another; photo zoom preserves original',async()=>{
      await setup();await page.evaluate(()=>{state.vault.sections.loyalty=[{id:'existing',description:'Existing',barcodeType:'QR',barcodeValue:'same',images:[]}];api.openEditor();fill('description','New');fill('barcodeType','QR');fill('barcodeValue','same');answers.push(true);document.querySelector('form').requestSubmit();});
      await page.waitForSelector('.loyalty-detail-card');assert.equal(await page.evaluate(()=>state.vault.sections.loyalty.length),2);
      await page.evaluate(()=>api.openCard({description:'Photo',images:[{mime:'image/png',data:'iVBORw0KGgo=',side:'back'}]}));
      await page.click('[aria-label="Увеличить фото"]');await page.$eval('input[type=range]',e=>{e.value='3';e.dispatchEvent(new Event('input'))});
      assert.equal(await page.$eval('.loyalty-photo-zoom img',e=>e.style.width),'300%');
    });
    await t.test('checkout uses bounded screen-on, copies number, restores on timeout and lock',async()=>{
      await setup();await page.evaluate(()=>{window.realTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>{if(ms===300000){window.checkoutTimeout=fn;return realTimeout(()=>{},300000)}return realTimeout(fn,ms,...args)};api.openCard({description:'Checkout',number:'0012',barcodeType:'QR',barcodeValue:'payload',images:[]});clickText('Показать на кассе');clickText('Скопировать номер');});
      await page.waitForFunction(()=>events.some(e=>Array.isArray(e)&&e[1]?.keepScreenOn));
      assert.deepEqual(await page.evaluate(()=>events.find(e=>Array.isArray(e)&&e[0]==='copy')),['copy','0012']);
      assert.equal(await page.$eval('.loyalty-checkout .loyalty',e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
      await page.evaluate(()=>checkoutTimeout());await page.waitForFunction(()=>events.includes('restore'));assert.equal(await page.$('.loyalty-back'),null);
      await page.evaluate(()=>{api.openCard({description:'Lock',number:'1',barcodeType:'QR',barcodeValue:'lock',images:[]});clickText('Показать на кассе');});
      await page.evaluate(()=>new Promise(r=>setTimeout(r,0)));
      await page.evaluate(()=>window.dispatchEvent(new Event('seyf:locking')));assert.equal(await page.$('.loyalty-back'),null);
    });
    await t.test('favorites move within favorites, initial palette and controls fit narrow screen',async()=>{
      await setup();await page.setViewport({width:320,height:740});await page.evaluate(()=>{state.vault.sections.loyalty=[{id:'a',description:'A',favorite:true,images:[]},{id:'n',description:'Normal',images:[]},{id:'b',description:'B',favorite:true,images:[]}];api.renderList(document.querySelector('#list'));api.openCard(state.vault.sections.loyalty[2]);clickText('Выше в избранном');});
      await page.waitForFunction(()=>events.includes('save'));assert.deepEqual(await page.evaluate(()=>state.vault.sections.loyalty.map(e=>e.id)),['b','n','a']);
      await page.evaluate(async()=>{await api.close();api.openEditor();});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>320),false);assert.equal(await page.$$eval('.loyalty-add-actions button',e=>e.length),1);assert.equal(await page.$eval('details',e=>e.open),false);
      await page.hover('.loyalty-add-actions button');await page.focus('.loyalty-add-actions button');assert.notEqual(await page.$eval('.loyalty-add-actions button',e=>getComputedStyle(e).outlineStyle),'none');
    });
    await t.test('approved editor: keyboard favorite and six colors survive lock/re-entry and save', async()=>{
      await setup(); await page.setViewport({width:390,height:844});
      await page.evaluate(()=>{api.openEditor();fill('description','Проверка');fill('number','00008');});
      await page.focus('.loyalty-favorite-toggle'); await page.keyboard.press('Space');
      assert.equal(await page.$eval('[name=favorite]',e=>e.checked),true);
      assert.equal(await page.$eval('.loyalty-favorite-toggle',e=>e.getAttribute('aria-pressed')),'true');
      await page.click('.loyalty-extra summary');
      assert.equal(await page.$$eval('.loyalty-swatch',e=>e.length),10);
      await page.focus('.loyalty-swatch:last-child'); await page.keyboard.press('Enter');
      const chosen=await page.$eval('[name=color]',e=>e.value);
      await page.evaluate(()=>{window.dispatchEvent(new Event('seyf:locking'));state.vault=structuredClone(persisted);api.destroy();api=M.initLoyaltyUI(deps);api.resumeDraft();});
      assert.equal(await page.$eval('.loyalty-favorite-toggle',e=>e.getAttribute('aria-pressed')),'true');
      assert.equal(await page.$eval('[name=color]',e=>e.value),chosen);
      assert.equal(await page.$$eval('.loyalty-swatch[aria-pressed=true]',e=>e.length),1);
      assert.equal(await page.$eval('.loyalty-extra',e=>e.open),false);
      await page.click('[type=submit]'); await page.waitForSelector('.loyalty-number');
      assert.deepEqual(await page.evaluate(()=>[state.vault.sections.loyalty[0].favorite,state.vault.sections.loyalty[0].color]),[true,chosen]);
    });
    await t.test('invalid saved code offers removal without technical fields; footer remains visible', async()=>{
      await setup(); await page.setViewport({width:390,height:844});
      await page.evaluate(()=>api.openEditor());
      for(const theme of ['bank','nord']) {
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        await fs.mkdir('qa/loyalty-round4-20261120',{recursive:true});
        await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
        await page.screenshot({path:`qa/loyalty-round4-20261120/unit-editor-${theme}.png`});
      }
      await page.click('[type=submit]');
      assert.equal(await page.evaluate(()=>document.activeElement.name),'description');
      await page.evaluate(()=>{fill('description','Ошибка кода');fill('barcodeType','EAN13');document.querySelector('[name=barcodeType]').dispatchEvent(new Event('change',{bubbles:true}));fill('barcodeValue','123');});
      assert.equal(await page.$eval('.loyalty-technical',e=>e.hidden),true);
      await page.click('[type=submit]');
      assert.equal(await page.$eval('.loyalty-technical',e=>e.hidden),true);
      assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Удалить код');
      assert.equal(await page.$eval('.loyalty-code-tools',e=>e.hidden),false);await page.evaluate(()=>answers.push(true));await page.click('.loyalty-code-tools button');assert.equal(await page.$eval('[name=barcodeValue]',e=>e.value),'');
      for(const theme of ['bank','nord']) {
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        await page.setViewport({width:320,height:360});
        await page.waitForFunction(()=>Math.abs(document.querySelector('.loyalty-editor-back').getBoundingClientRect().height-360)<2);
        for(const scroll of [0,10000]) {
          await page.$eval('.loyalty-editor-scroll',(e,n)=>e.scrollTop=n,scroll);
          const geometry=await page.$eval('[type=submit]',e=>{const r=e.getBoundingClientRect();return {visible:r.top>=0&&r.bottom<=innerHeight,width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth};});
          assert.equal(geometry.visible,true);assert.equal(geometry.overflow,false);assert.ok(geometry.height>=44);
        }
        await page.hover('[type=submit]');await page.focus('[type=submit]');await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
        assert.notEqual(await page.$eval('[type=submit]',e=>getComputedStyle(e).outlineStyle),'none');
      }
      await page.evaluate(()=>{fill('number','4006381333931');document.querySelector('form').requestSubmit();});
      await page.waitForSelector('.loyalty-number');assert.equal(await page.evaluate(()=>state.vault.sections.loyalty.length),1);
    });
    await t.test('photo QR URL stays separate from blank/printed number through save and checkout',async()=>{
      await setup();await page.evaluate(()=>{api.openEditor();fill('description','QR member');decodeResult=async()=>[{barcodeType:'QR',barcodeValue:'https://cards.example.test/id/007'}];clickText('Из галереи');});
      await page.waitForFunction(()=>document.querySelector('[name=barcodeValue]').value.includes('example.test'));
      assert.equal(await page.$eval('[name=number]',e=>e.value),'');
      await page.evaluate(()=>{fill('number','000123');document.querySelector('form').requestSubmit();});await page.waitForSelector('.loyalty-detail-card');
      assert.deepEqual(await page.evaluate(()=>{const c=state.vault.sections.loyalty[0];return[c.number,c.barcodeValue]}),['000123','https://cards.example.test/id/007']);
      await page.evaluate(()=>clickText('Показать на кассе'));await page.evaluate(()=>clickText('Скопировать номер'));
      assert.equal(await page.$eval('.loyalty-number',e=>e.textContent),'0001 23');assert.deepEqual(await page.evaluate(()=>events.find(e=>Array.isArray(e)&&e[0]==='copy')),['copy','000123']);
    });
    await t.test('code-only detail/checkout never exposes payload as number or copy-number action',async()=>{
      await setup();await page.evaluate(()=>api.openCard({description:'QR only',number:'',barcodeType:'QR',barcodeValue:'https://cards.example.test/private',images:[]}));
      for(let i=0;i<2;i++){assert.equal(await page.$('.loyalty-number'),null);assert.equal(await page.evaluate(()=>document.body.textContent.includes('https://cards.example.test')),false);assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Скопировать номер')),false);if(i===0)await page.evaluate(()=>clickText('Показать на кассе'));}
    });
    await t.test('code removal confirms, cancellation preserves all; confirmed removal retains printed number/photos',async()=>{
      await setup();await page.evaluate(()=>{api.openEditor({id:'old',description:'Old',number:'00077',barcodeType:'CODE128',barcodeValue:'999888',images:[{id:'front',side:'front',mime:'image/png',data:'iVBORw0KGgo='}]});});
      await page.click('.loyalty-remove-code');assert.equal(await page.$eval('[name=barcodeValue]',e=>e.value),'999888');
      await page.evaluate(()=>answers.push(true));await page.click('.loyalty-remove-code');
      assert.equal(await page.$eval('[name=barcodeValue]',e=>e.value),'');assert.equal(await page.$eval('[name=number]',e=>e.value),'0007 7');assert.equal(await page.$$eval('.loyalty-photos img',e=>e.length),1);
    });
    await t.test('late remove-code confirmation after lock cannot touch new editor',async()=>{
      await setup();await page.evaluate(()=>{deps.dlgConfirm=()=>new Promise(r=>window.resolveDelete=r);api.openEditor({id:'old',description:'Old',barcodeType:'QR',barcodeValue:'old'});document.querySelector('.loyalty-remove-code').click();});
      await page.waitForFunction(()=>!!window.resolveDelete);
      await page.evaluate(()=>{window.dispatchEvent(new Event('seyf:locking'));state.vault={sections:{loyalty:[]}};api.openEditor({id:'new',description:'New',barcodeType:'QR',barcodeValue:'new'});resolveDelete(true);});
      assert.equal(await page.$eval('[name=barcodeValue]',e=>e.value),'new');
    });
    await t.test('photo actions appear on tap; cancel/replace/delete are side-specific and never replace existing code',async()=>{
      await setup();await page.evaluate(()=>{api.openEditor({id:'c',description:'Photo card',number:'0012',barcodeType:'CODE128',barcodeValue:'999000',images:[{id:'front',side:'front',mime:'image/png',data:'iVBORw0KGgo='},{id:'back',side:'back',mime:'image/png',data:'iVBORw0KGgo='}]});window.decodeCalls=0;decodeResult=async()=>{decodeCalls++;return[{barcodeType:'QR',barcodeValue:'unrelated'}]};});
      assert.equal(await page.$$eval('.loyalty-photo-side .btn',e=>e.length),0);
      await page.click('.loyalty-photo-open');await page.waitForSelector('.loyalty-photo-panel');
      assert.equal(await page.$eval('form',e=>e.inert),true);await page.keyboard.press('Escape');assert.equal(await page.$('.loyalty-photo-panel'),null);assert.equal(await page.$eval('form',e=>e.inert),false);
      await page.click('.loyalty-photo-open');await page.evaluate(()=>{cancelPick=true;clickText('Из галереи');});assert.equal(await page.$$eval('.loyalty-photos img',e=>e.length),2);
      await page.click('.loyalty-photo-open');await page.evaluate(()=>{cancelPick=false;clickText('Из галереи');});await page.waitForFunction(()=>state.vault.draft.data.images.some(p=>p.id==='photo'));
      assert.equal(await page.evaluate(()=>decodeCalls),0);assert.equal(await page.$eval('[name=barcodeValue]',e=>e.value),'999000');assert.equal(await page.$eval('[name=number]',e=>e.value),'0012');
      await page.click('.loyalty-photo-open');await page.evaluate(()=>clickText('Удалить фото'));assert.ok(await page.$('.loyalty-photo-panel'));assert.equal(await page.$$eval('.loyalty-photos img',e=>e.length),2);
      await page.evaluate(()=>{answers.push(true);clickText('Удалить фото');});await page.waitForFunction(()=>!document.querySelector('.loyalty-photo-panel'));
      assert.deepEqual(await page.evaluate(()=>state.vault.draft.data.images.map(p=>p.side)),['back']);assert.equal(await page.$eval('[name=barcodeValue]',e=>e.value),'999000');
    });
    await t.test('late photo deletion after panel closes cannot remove side',async()=>{
      await setup();await page.evaluate(()=>{deps.dlgConfirm=()=>new Promise(r=>window.resolvePhotoDelete=r);api.openEditor({id:'old',description:'Old',number:'001',images:[{id:'front',side:'front',mime:'image/png',data:'iVBORw0KGgo='}]});});
      await page.click('.loyalty-photo-open');await page.evaluate(()=>clickText('Удалить фото'));await page.waitForFunction(()=>!!window.resolvePhotoDelete);
      await page.evaluate(()=>{clickText('Назад');resolvePhotoDelete(true);});assert.equal(await page.$$eval('.loyalty-photos img',e=>e.length),1);
    });
    await t.test('typing printed number during photo decoding preserves both independent results',async()=>{
      await setup();await page.evaluate(()=>{api.openEditor();fill('description','Concurrent photo');decodeResult=()=>new Promise(r=>window.finishPhotoCode=r);clickText('Из галереи');});
      await page.waitForFunction(()=>!!window.finishPhotoCode);
      await page.evaluate(()=>{fill('number','000456');finishPhotoCode([{barcodeType:'CODE128',barcodeValue:'999111'}]);});
      await page.waitForFunction(()=>document.querySelector('[name=barcodeValue]').value==='999111');
      assert.equal(await page.$eval('[name=number]',e=>e.value),'0004 56');
    });
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
