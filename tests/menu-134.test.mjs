import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const root = new URL('../www/', import.meta.url);
test('1.3.4: все девять пунктов меню помещаются и стоят в согласованном порядке', async () => {
  const source = await fs.readFile(new URL('index.html', root), 'utf8');
  const nav = source.match(/<nav id="menu"[\s\S]*?<\/nav>/)[0];
  const css = await fs.readFile(new URL('css/app.css', root), 'utf8');
  const browser = await puppeteer.launch({executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    const page=await browser.newPage();
    for (const [width,height] of [[320,512],[360,584],[412,859]]) {
      await page.setViewport({width,height});
      for (const scale of [1,1.3,2]) {
        await page.setContent('<meta charset="utf-8"><style>'+css+'</style>'+nav);
        const result=await page.evaluate(scale=>{
          const menu=document.querySelector('#menu');menu.classList.add('open');
          if(scale>1)document.documentElement.dataset.fz=scale>=1.6?'xl':'l';
          else delete document.documentElement.dataset.fz;
          for(const el of menu.querySelectorAll('.mi-t'))el.style.fontSize=(parseFloat(getComputedStyle(el).fontSize)*scale)+'px';
          const body=menu.querySelector('.menu-body');
          const buttons=[...menu.querySelectorAll('.mi')];
          return {ids:buttons.map(b=>b.id),scroll:body.scrollHeight>body.clientHeight+1,
            clipped:buttons.some(b=>{const r=b.getBoundingClientRect();const t=b.querySelector('.mi-t').getBoundingClientRect();return r.height<44||r.bottom>innerHeight||t.left<r.left||t.right>r.right||t.bottom>r.bottom||t.top<r.top;}),
            full:Math.abs(buttons.at(-1).getBoundingClientRect().width-body.querySelector('.menu-list').getBoundingClientRect().width)<2};
        },scale);
        assert.deepEqual(result,{ids:['mBio','mKey','mTheme','mSections','mBackup','mTrash','mPro','mArchive','mAbout'],scroll:false,clipped:false,full:true},JSON.stringify({width,height,scale}));
      }
    }
  } finally {await browser.close();}
});
