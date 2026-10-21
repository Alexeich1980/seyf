import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipboardGuard } from '../www/js/clipboard.js';

// Фейковый буфер обмена: держит строку, счётчики чтений/записей.
function fakeClipboard(initial = '') {
  let text = initial, reads = 0, writes = 0;
  return {
    async readText() { reads++; return text; },
    async writeText(v) { writes++; text = v; },
    peek: () => text,
    reads: () => reads,
    writes: () => writes,
  };
}
// Ручной таймер: копим последний колбэк, «дёргаем» вручную.
function fakeTimers() {
  let cb = null, id = 0, cleared = 0;
  return {
    set: (fn) => { cb = fn; return ++id; },
    clear: () => { cleared++; cb = null; },
    fire: async () => { const f = cb; cb = null; if (f) await f(); },
    pending: () => cb !== null,
    cleared: () => cleared,
  };
}

test('copy кладёт секрет в буфер и помечает pending', async () => {
  const cb = fakeClipboard();
  const g = createClipboardGuard({ clipboard: cb });
  await g.copy('S3CRET');
  assert.equal(cb.peek(), 'S3CRET');
  assert.ok(g.hasPending());
});

test('при блокировке буфер очищается, если там наш секрет', async () => {
  const cb = fakeClipboard();
  const g = createClipboardGuard({ clipboard: cb });
  await g.copy('S3CRET');
  const did = await g.clearIfOurs();   // то, что дёргает lockNow при блокировке
  assert.equal(did, true, 'должен сообщить, что очистил');
  assert.equal(cb.peek(), '', 'буфер пуст после блокировки');
  assert.ok(!g.hasPending(), 'pending снят');
});

test('clearIfOurs НЕ трогает чужое содержимое буфера', async () => {
  const cb = fakeClipboard();
  const g = createClipboardGuard({ clipboard: cb });
  await g.copy('S3CRET');
  await cb.writeText('пользователь скопировал другое');  // буфер сменился
  const did = await g.clearIfOurs();
  assert.equal(did, false);
  assert.equal(cb.peek(), 'пользователь скопировал другое', 'чужое не затёрто');
});

test('таймер очищает буфер по TTL', async () => {
  const cb = fakeClipboard();
  const t = fakeTimers();
  const g = createClipboardGuard({ clipboard: cb, setTimer: t.set, clearTimer: t.clear, ttlMs: 30000 });
  await g.copy('S3CRET');
  assert.ok(t.pending());
  await t.fire();
  assert.equal(cb.peek(), '', 'по таймеру буфер очищен');
  assert.ok(!g.hasPending());
});

test('нет pending → clearIfOurs ничего не пишет (idempotent)', async () => {
  const cb = fakeClipboard('чужое');
  const g = createClipboardGuard({ clipboard: cb });
  const did = await g.clearIfOurs();
  assert.equal(did, false);
  assert.equal(cb.writes(), 0, 'ни одной записи без нашего секрета');
  assert.equal(cb.peek(), 'чужое');
});

test('повторная копия перезаряжает таймер (старый снят)', async () => {
  const cb = fakeClipboard();
  const t = fakeTimers();
  const g = createClipboardGuard({ clipboard: cb, setTimer: t.set, clearTimer: t.clear });
  await g.copy('A');
  await g.copy('B');
  assert.ok(t.cleared() >= 1, 'старый таймер снят при повторной копии');
  assert.equal(cb.peek(), 'B');
});

test('readText недоступен (throws) → слепая очистка всё равно чистит', async () => {
  let text = 'S3CRET', writes = 0;
  const cb = {
    async readText() { throw new Error('нет доступа к чтению в фоне'); },
    async writeText(v) { writes++; text = v; },
    peek: () => text,
  };
  const g = createClipboardGuard({ clipboard: cb });
  await g.copy('S3CRET');
  const did = await g.clearIfOurs();
  assert.equal(did, true);
  assert.equal(cb.peek(), '', 'при недоступном чтении чистим вслепую');
});
