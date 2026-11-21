import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';

// Isolated real-browser contract fixture: parent CSS/UI are owned by another worker.
test('Chrome swipe contract: reveal only, cancellation, touch scrolling and lifecycle', { timeout: 90000 }, async t => {
  assert.equal(process.env.HEAVY_LOCK_HELD, '1', 'Run through tools/heavy-lock.mjs');
  const source = await fs.readFile(new URL('../www/js/loyalty-swipe.js', import.meta.url));
  console.log('swipe SHA256:', crypto.createHash('sha256').update(source).digest('hex'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/helper.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/helper.js' ? source : `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{margin:0} .loyalty-swipe{position:relative;overflow:hidden;width:360px;height:100px;margin:12px}
      .loyalty-swipe__front{position:relative;z-index:1;touch-action:pan-y;transform:translateX(var(--loyalty-swipe-x,0px));width:100%;height:100%;background:white}
      .loyalty-swipe__action{position:absolute;top:0;bottom:0;width:72px;background:#ddd}
      .loyalty-swipe__action--delete{left:0}.loyalty-swipe__action--edit{right:0}
      [hidden]{display:none!important} .spacer{height:1800px}
      </style><main></main><div class="spacer"></div>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.LOYALTY_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] });
    console.log('Browser:', await browser.version());
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 700, isMobile: true, hasTouch: true });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    async function setup() {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(async () => {
        window.module = await import('/helper.js'); window.calls = { open: 0, edit: 0, delete: 0 }; window.active = true; window.handles = [];
        for (let i = 0; i < 2; i++) {
          const row = document.createElement('div'); row.id = `r${i}`;
          const front = document.createElement('button'); front.id = `f${i}`;
          const text = document.createElement('span'); text.style.cssText = 'display:block;width:100%;height:100%';text.textContent = `Card ${i}`;front.append(text);
          front.onclick = () => calls.open++;
          row.append(front); document.querySelector('main').append(row);
          handles.push(module.attachLoyaltySwipe(row, front, { onEdit: () => calls.edit++, onDelete: () => calls.delete++, isActive: () => active }));
        }
      });
    }
    async function drag(dx, dy = 0, i = 0) {
      const y = 60 + 112 * i;
      await page.mouse.move(180, y); await page.mouse.down();
      await page.mouse.move(180 + dx, y + dy, { steps: 8 }); await page.mouse.up();
    }
    const state = () => page.evaluate(() => ({ calls, rows: [...document.querySelectorAll('.loyalty-swipe')].map(row => ({ x: row.style.getPropertyValue('--loyalty-swipe-x'), buttons: [...row.querySelectorAll('.loyalty-swipe__action')].map(b => ({ label: b.getAttribute('aria-label'), hidden: b.hidden, inert: b.inert, disabled: b.disabled, tab: b.tabIndex })) })) }));
    async function synthetic(type, id, x = 180, y = 60, target = '#f0', primary = true) {
      await page.$eval(target, (node, a) => node.dispatchEvent(new PointerEvent(a.type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: a.id, clientX: a.x, clientY: a.y, isPrimary: a.primary, button: 0 })), { type, id, x, y, primary });
    }
    await t.test('hidden actions, ordinary click and keyboard route', async () => {
      await setup(); const s = await state();
      for (const row of s.rows) for (const b of row.buttons) assert.deepEqual([b.hidden, b.inert, b.disabled, b.tab], [true, true, true, -1]);
      assert.deepEqual(s.rows[0].buttons.map(b => b.label), ['Удалить карту', 'Изменить карту']);
      await page.click('#f0'); await page.focus('#f0'); await page.keyboard.press('Enter');
      assert.equal((await state()).calls.open, 2);
    });
    await t.test('right full swipe reveals trash, ghost click blocked, fresh action click delegates once', async () => {
      await setup(); await drag(200);
      let s = await state(); assert.equal(s.rows[0].x, '72px'); assert.deepEqual(s.calls, { open: 0, edit: 0, delete: 0 });
      assert.deepEqual(s.rows[0].buttons.map(b => b.hidden), [false, true]);
      await page.$eval('#f0', n => n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
      assert.equal((await state()).calls.open, 0);
      await page.click('#r0 .loyalty-swipe__action--delete');
      s = await state(); assert.equal(s.calls.delete, 1); assert.equal(s.rows[0].x, '0px');
      assert.equal(await page.$eval('#r0', n => n.isConnected), true);
      await page.click('#f0'); assert.equal((await state()).calls.open, 1);
    });
    await t.test('left reveals pencil; keyboard action works; only one row open', async () => {
      await setup(); await drag(-100); await drag(100, 0, 1);
      let s = await state(); assert.equal(s.rows[0].x, '0px'); assert.equal(s.rows[1].x, '72px');
      await drag(-100); s = await state(); assert.equal(s.rows[1].x, '0px');
      await page.focus('#r0 .loyalty-swipe__action--edit'); await page.keyboard.press('Enter');
      assert.deepEqual((await state()).calls, { open: 0, edit: 1, delete: 0 });
    });
    await t.test('8px/1.3 axis lock and 36px settle threshold, no diagonal activation', async () => {
      await setup(); await drag(7); assert.equal((await state()).calls.open, 1);
      await drag(25); assert.equal((await state()).rows[0].x, '0px'); assert.equal((await state()).calls.open, 1);
      await drag(80, 80); assert.equal((await state()).rows[0].x, '0px');
      await drag(50, 20); assert.equal((await state()).rows[0].x, '72px');
      await page.keyboard.press('Escape'); assert.equal((await state()).rows[0].x, '0px');
    });
    await t.test('capture release, wrong pointer ignored, cancel and lost capture close safely', async () => {
      for (const event of ['pointercancel', 'lostpointercapture']) {
        await setup(); await page.mouse.move(180, 60); await page.mouse.down(); await page.mouse.move(250, 60, { steps: 5 });
        assert.equal(await page.$eval('#f0', n => n.hasPointerCapture(1)), true);
        await synthetic('pointerup', 99); assert.equal((await state()).rows[0].x, '70px');
        await synthetic(event, 1); await page.mouse.up();
        assert.equal((await state()).rows[0].x, '0px'); assert.deepEqual((await state()).calls, { open: 0, edit: 0, delete: 0 });
        assert.equal(await page.$eval('#f0', n => n.hasPointerCapture(1)), false);
        await page.click('#f0'); assert.equal((await state()).calls.open, 1);
      }
    });
    await t.test('second pointer anywhere cancels owner and cannot activate an action', async () => {
      await setup(); await page.mouse.move(180, 60); await page.mouse.down(); await page.mouse.move(260, 60, { steps: 5 });
      await synthetic('pointerdown', 2, 180, 172, '#f1', false);
      await page.mouse.up(); await synthetic('pointerup', 2, 180, 172, '#f1', false);
      const s = await state(); assert.equal(s.rows[0].x, '0px'); assert.deepEqual(s.calls, { open: 0, edit: 0, delete: 0 });
      await page.click('#f0'); assert.equal((await state()).calls.open, 1);
    });
    await t.test('lock mid-drag, stale exposed action, blur and close-all remain safe', async () => {
      await setup(); await page.mouse.move(180, 60); await page.mouse.down(); await page.mouse.move(270, 60, { steps: 5 });
      await page.evaluate(() => { active = false; window.dispatchEvent(new Event('seyf:locking')); }); await page.mouse.up();
      assert.equal((await state()).rows[0].x, '0px'); assert.deepEqual((await state()).calls, { open: 0, edit: 0, delete: 0 });
      await page.evaluate(() => { active = true; }); await drag(-100);
      await page.evaluate(() => { active = false; }); await page.click('#r0 .loyalty-swipe__action--edit');
      assert.equal((await state()).calls.edit, 0); assert.equal((await state()).rows[0].x, '0px');
      await page.evaluate(() => { active = true; }); await drag(100);
      await page.evaluate(() => window.dispatchEvent(new Event('blur'))); assert.equal((await state()).rows[0].x, '0px');
      await drag(-100); await page.evaluate(() => module.closeLoyaltySwipes()); assert.equal((await state()).rows[0].x, '0px');
      await page.click('#f0'); assert.equal((await state()).calls.open, 1);
    });
    await t.test('real touch horizontal reveal, ordinary fresh tap and native vertical scroll', async () => {
      await setup(); const cdp = await page.createCDPSession();
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      await page.touchscreen.tap(180, 60); assert.equal((await state()).calls.open, 1);
      await page.evaluate(() => { calls.open = 0; }); await touch('touchStart', 180, 60);
      for (let x = 190; x <= 280; x += 10) await touch('touchMove', x, 60);
      await touch('touchEnd'); assert.equal((await state()).rows[0].x, '72px'); assert.equal((await state()).calls.open, 0);
      // Chrome can omit the native click for a tap immediately following a touch drag.
      // Allow its gesture settling; the helper itself has no time-based tap blacklist.
      await new Promise(resolve => setTimeout(resolve, 400));
      await touch('touchStart', 180, 60); await touch('touchEnd');
      await page.waitForFunction(() => calls.open === 1, { timeout: 2000 });
      await page.touchscreen.tap(45, 60); assert.equal((await state()).calls.delete, 1);
      await page.evaluate(() => module.closeLoyaltySwipes());
      await touch('touchStart', 180, 180);
      for (let y = 170; y >= 30; y -= 10) await touch('touchMove', 180, y);
      await touch('touchEnd'); await page.waitForFunction(() => scrollY > 30);
      assert.equal((await state()).rows[1].x, '0px'); assert.equal((await state()).calls.open, 1);
      await cdp.detach();
    });
    await t.test('missing callbacks never reveal unsupported actions', async () => {
      for (const supported of ['none', 'edit', 'delete']) {
        await setup();
        await page.evaluate(supported => {
          handles[0].destroy();
          handles[0] = module.attachLoyaltySwipe(document.querySelector('#r0'), document.querySelector('#f0'), {
            ...(supported === 'edit' ? { onEdit: () => calls.edit++ } : {}),
            ...(supported === 'delete' ? { onDelete: () => calls.delete++ } : {})
          });
        }, supported);
        await drag(100);
        assert.equal((await state()).rows[0].x, supported === 'delete' ? '72px' : '0px');
        await page.evaluate(() => handles[0].close()); await drag(-100);
        assert.equal((await state()).rows[0].x, supported === 'edit' ? '-72px' : '0px');
        assert.deepEqual((await state()).calls, { open: 0, edit: 0, delete: 0 });
      }
    });
    await t.test('destroy removes buttons and shared document/window listeners; reattach has no duplicates', async () => {
      await setup(); const cdp = await page.createCDPSession();
      const listeners = async expression => {
        const { result } = await cdp.send('Runtime.evaluate', { expression });
        return (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length;
      };
      const before = await listeners('document'); assert.ok(before >= 4);
      await page.evaluate(() => { for (const h of handles) { h.destroy(); h.destroy(); } });
      assert.equal(await listeners('document'), 0); assert.equal(await listeners('window'), 0);
      assert.equal(await page.$$eval('.loyalty-swipe__action', n => n.length), 0);
      await page.click('#f0'); assert.equal((await state()).calls.open, 1);
      await page.evaluate(() => {
        const row = document.querySelector('#r0'), front = document.querySelector('#f0');
        for (let i = 0; i < 20; i++) module.attachLoyaltySwipe(row, front, {});
      });
      assert.equal(await page.$$eval('.loyalty-swipe__action', n => n.length), 2);
      assert.equal(await listeners('document'), before); await cdp.detach();
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(await fs.readFile(new URL('../www/js/loyalty-swipe.js', import.meta.url)), source, 'source drifted during browser checks');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
