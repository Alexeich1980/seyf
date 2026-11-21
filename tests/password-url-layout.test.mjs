import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../www');
const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

test('Длинный URL занимает одну строку, кнопки доступны и копируют полный адрес', async () => {
  const server = http.createServer(async (req, res) => {
    const allowed = {
      '/ui.js': ['js/ui.js', 'text/javascript'],
      '/generator.js': ['js/generator.js', 'text/javascript'],
      '/wordlist.js': ['js/wordlist.js', 'text/javascript'],
      '/app.css': ['css/app.css', 'text/css'],
    };
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<link rel="stylesheet" href="/app.css"><main id="fixture"></main>');
      return;
    }
    const asset = allowed[req.url];
    if (!asset) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', asset[1]);
    res.end(await fs.readFile(path.join(root, asset[0])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: edge, headless: true });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    for (const width of [320, 360, 412, 768]) {
      await page.setViewport({ width, height: 900 });
      for (const expanded of [false, true]) {
        for (const fontSize of [13, 26]) {
          const result = await page.evaluate(async ({ expanded, fontSize }) => {
            const { renderEntryCard } = await import('/ui.js');
            const fixture = document.querySelector('#fixture');
            fixture.style.cssText = 'display:block;padding:12px;width:100%;box-sizing:border-box';
            fixture.replaceChildren();
            const url = 'https://example.com/' + 'long-path/'.repeat(120) + '?query=value#anchor';
            let copied, opened;
            const card = renderEntryCard('passwords', {
              id: 'layout-test', description: 'Тест', url, login: 'demo', password: 'synthetic-only',
            }, {
              onCopyPlain: value => { copied = value; },
              onOpenLink: value => { opened = value; },
            });
            card.dataset.section = 'passwords';
            card.classList.add('expandable');
            if (expanded) card.classList.add('expanded');
            fixture.append(card);
            const value = card.querySelector('.f-link');
            const row = value.parentElement;
            row.style.fontSize = fontSize + 'px';
            const copy = row.querySelector('.copy');
            const open = row.querySelector('.open');
            copy.click();
            open.click();
            const r = value.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(value);
            const lineHeight = range.getBoundingClientRect().height;
            const bounds = card.getBoundingClientRect();
            const buttonsInside = [copy, open].every(button => {
              const b = button.getBoundingClientRect();
              return b.width > 0 && b.left >= bounds.left && b.right <= bounds.right + 1;
            });
            return {
              oneLine: r.height <= lineHeight + 3,
              truncated: value.scrollWidth > value.clientWidth && value.clientWidth > 10,
              ellipsis: getComputedStyle(value).textOverflow,
              intact: copied === url && opened === url && value.textContent === url,
              buttonsInside,
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          }, { expanded, fontSize });
          assert.deepEqual(result, {
            oneLine: true, truncated: true, ellipsis: 'ellipsis', intact: true,
            buttonsInside: true, overflow: false,
          }, JSON.stringify({ width, expanded, fontSize }));
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
