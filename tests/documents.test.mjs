import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOC_TYPES, docTypeLabel, detectMime, isAccepted, parseDataUrl,
  createPage, addPage, removePage, reorderPages, pageCount,
  fitDimensions, captureCanvasPlan, clampScale, doubleTapScale, constrainTranslate,
  buildFrames, expiryStatus, b64, unb64, scanDefaultName, frameIndexAfterRemoval,
} from '../www/js/documents.js';
import { encryptJSON, decryptJSON, importDEK, randomBytes } from '../www/js/crypto.js';

// --- индекс кадра после удаления скана из просмотрщика (заход 3 п.9) ---

test('frameIndexAfterRemoval: удаление скана держит индекс в пределах', () => {
  // был кадр 2 из 3, удалили один кадр перед ним? нет — удалили текущий (1 кадр): idx смещаем
  assert.equal(frameIndexAfterRemoval(2, 1, 2), 1);   // 3→2 кадра, остаёмся в пределах
  assert.equal(frameIndexAfterRemoval(0, 1, 2), 0);   // были на первом — остаёмся на первом
  assert.equal(frameIndexAfterRemoval(1, 2, 3), 0);   // PDF из 2 кадров удалён спереди — не уходим в минус
});

test('frameIndexAfterRemoval: сканов не осталось → -1 (окно закрыть)', () => {
  assert.equal(frameIndexAfterRemoval(0, 1, 0), -1);
  assert.equal(frameIndexAfterRemoval(3, 1, 0), -1);
});

// --- определение типа по магическим байтам ---

test('detectMime распознаёт PDF/PNG/JPEG/WEBP и отвергает мусор', () => {
  assert.equal(detectMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), 'application/pdf');
  assert.equal(detectMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(detectMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'image/webp');
  assert.equal(detectMime(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(detectMime(new Uint8Array([])), null);
});

test('isAccepted пропускает только картинки и PDF', () => {
  assert.equal(isAccepted('application/pdf'), true);
  assert.equal(isAccepted('image/jpeg'), true);
  assert.equal(isAccepted('text/html'), false);
});

test('DOC_TYPES: подписи и фолбэк', () => {
  assert.ok(DOC_TYPES.length >= 6);
  assert.equal(docTypeLabel('snils'), 'СНИЛС');
  assert.equal(docTypeLabel('visa'), 'Виза');       // 8d п.15 — дополнен
  assert.equal(docTypeLabel('dms'), 'Полис ДМС');   // 8d п.15 — дополнен
  assert.equal(docTypeLabel('nope'), '');
});

test('parseDataUrl разбирает base64 data:URL и уточняет mime по содержимому', () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const url = 'data:application/octet-stream;base64,' + b64(bytes);
  const r = parseDataUrl(url);
  assert.equal(r.mime, 'application/pdf'); // по байтам, не по заявленному
  assert.deepEqual(Array.from(r.bytes), Array.from(bytes));
});

// --- модель страниц + мутационный инвариант A (счётчик) ---

test('createPage требует допустимый mime и заполняет поля', () => {
  const p = createPage({ name: 'Паспорт', mime: 'image/jpeg', data: 'AAAA' });
  assert.ok(p.id);
  assert.equal(p.mime, 'image/jpeg');
  assert.equal(p.name, 'Паспорт');
  assert.ok(p.addedAt);
  assert.throws(() => createPage({ name: 'x', mime: 'text/plain', data: 'AA' }));
});

test('счётчик страниц: add/remove/reorder держат count и порядок', () => {
  const entry = {};
  assert.equal(pageCount(entry), 0);
  const a = createPage({ name: 'a', mime: 'image/png', data: 'A' });
  const b = createPage({ name: 'b', mime: 'image/png', data: 'B' });
  const c = createPage({ name: 'c', mime: 'application/pdf', data: 'C' });
  addPage(entry, a); addPage(entry, b); addPage(entry, c);
  assert.equal(pageCount(entry), 3);
  reorderPages(entry, 0, 2); // a в конец
  assert.deepEqual(entry.pages.map((p) => p.name), ['b', 'c', 'a']);
  assert.equal(pageCount(entry), 3, 'порядок не меняет число страниц');
  assert.equal(removePage(entry, b.id), true);
  assert.equal(pageCount(entry), 2);
  assert.equal(removePage(entry, 'missing'), false);
  assert.equal(pageCount(entry), 2);
});

// --- мутационный инвариант B: байты blob переживают шифр/дешифр без потерь ---

test('байты скана сохраняются после round-trip через AES-GCM внутри vault', async () => {
  const original = randomBytes(4096); // «скан» как случайные байты
  const page = createPage({ name: 'scan', mime: 'image/jpeg', data: b64(original) });
  const vault = { version: 1, sections: { documents: [{ id: 'x', pages: [page] }] } };

  const dek = await importDEK(randomBytes(32));
  const enc = await encryptJSON(dek, vault);
  const back = await decryptJSON(dek, enc.iv, enc.ct);

  const restored = unb64(back.sections.documents[0].pages[0].data);
  assert.equal(restored.length, original.length);
  for (let i = 0; i < original.length; i++) {
    assert.equal(restored[i], original[i], 'байт ' + i + ' совпадает');
  }
});

// --- даунскейл ---

test('fitDimensions только уменьшает, сохраняет пропорции', () => {
  assert.deepEqual(fitDimensions(4000, 3000, 2000), { w: 2000, h: 1500 });
  assert.deepEqual(fitDimensions(1000, 800, 2000), { w: 1000, h: 800 }, 'без апскейла');
  assert.deepEqual(fitDimensions(2000, 2000, 2000), { w: 2000, h: 2000 });
  assert.deepEqual(fitDimensions(3000, 4000, 1000), { w: 750, h: 1000 });
});

// --- захват кадра камеры в canvas (полный кадр, без уголка и без искажения) ---

test('captureCanvasPlan: весь кадр в весь canvas, пропорции сохранены', () => {
  // ландшафтный сенсор 2560x1440 (16:9), лимит 2000 по большей стороне
  const p = captureCanvasPlan(2560, 1440, 2000);
  // canvas = fitDimensions → 2000x1125
  assert.equal(p.canvasW, 2000);
  assert.equal(p.canvasH, 1125);
  // источник — ВЕСЬ кадр (заслон «уголок»: не 0-размер, не половина)
  assert.deepEqual([p.sx, p.sy, p.sw, p.sh], [0, 0, 2560, 1440]);
  // назначение — ВЕСЬ canvas (dw/dh не меньше canvas → не уголок)
  assert.deepEqual([p.dx, p.dy, p.dw, p.dh], [0, 0, 2000, 1125]);
  // пропорции canvas ≈ пропорции кадра (не искажение)
  const arSrc = 2560 / 1440, arDst = p.canvasW / p.canvasH;
  assert.ok(Math.abs(arSrc - arDst) < 0.01, 'aspect сохранён');
});

test('captureCanvasPlan: разные соотношения — dw=canvasW, dh=canvasH всегда (не уголок)', () => {
  for (const [w, h] of [[4000, 3000], [1080, 1920], [1000, 1000], [3000, 1000], [640, 480]]) {
    const p = captureCanvasPlan(w, h, 2000);
    assert.equal(p.dw, p.canvasW, `dw заполняет canvas для ${w}x${h}`);
    assert.equal(p.dh, p.canvasH, `dh заполняет canvas для ${w}x${h}`);
    assert.equal(p.sw, w, 'источник по ширине — весь кадр');
    assert.equal(p.sh, h, 'источник по высоте — весь кадр');
    assert.ok(p.canvasW <= 2000 && p.canvasH <= 2000, 'не больше лимита');
    // aspect сохранён в пределах округления
    const arSrc = w / h, arDst = p.canvasW / p.canvasH;
    assert.ok(Math.abs(arSrc - arDst) / arSrc < 0.02, `aspect сохранён для ${w}x${h}`);
  }
});

test('captureCanvasPlan: мелкий кадр не апскейлится', () => {
  const p = captureCanvasPlan(800, 600, 2000);
  assert.deepEqual([p.canvasW, p.canvasH], [800, 600]);
  assert.deepEqual([p.dw, p.dh], [800, 600]);
});

// --- математика зума/пана ---

test('clampScale держит масштаб в границах', () => {
  assert.equal(clampScale(0.2, 1, 5), 1);
  assert.equal(clampScale(9, 1, 5), 5);
  assert.equal(clampScale(2.5, 1, 5), 2.5);
  assert.equal(clampScale(NaN, 1, 5), 1);
});

test('doubleTapScale — тумблер приблизить/вернуть', () => {
  assert.equal(doubleTapScale(1, 1, 5), Math.min(5, 2.5));
  assert.equal(doubleTapScale(2.5, 1, 5), 1);
});

test('constrainTranslate не даёт улететь за пределы, центрирует мелкое', () => {
  // контент меньше вида → сдвиг 0
  assert.deepEqual(constrainTranslate(50, 50, 1, 1000, 1000, 500, 500), { tx: 0, ty: 0 });
  // контент 2000x2000 при scale 1 в виде 1000x1000 → макс сдвиг 500
  assert.deepEqual(constrainTranslate(9999, -9999, 1, 1000, 1000, 2000, 2000), { tx: 500, ty: -500 });
});

// --- навигация по кадрам ---

test('buildFrames: картинка=1 кадр, PDF=N кадров', () => {
  const pages = [
    { id: 'i1', mime: 'image/jpeg' },
    { id: 'p1', mime: 'application/pdf' },
    { id: 'i2', mime: 'image/png' },
  ];
  const frames = buildFrames(pages, { p1: 3 });
  assert.equal(frames.length, 5);
  assert.deepEqual(frames.map((f) => f.pageId), ['i1', 'p1', 'p1', 'p1', 'i2']);
  assert.deepEqual(frames.filter((f) => f.pageId === 'p1').map((f) => f.sub), [0, 1, 2]);
});

test('buildFrames: PDF без известного счётчика — 1 кадр', () => {
  const frames = buildFrames([{ id: 'p1', mime: 'application/pdf' }]);
  assert.equal(frames.length, 1);
});

// --- срок действия ---

test('expiryStatus: нет/истёк/скоро/ок', () => {
  const now = Date.parse('2026-09-12T00:00:00Z');
  assert.equal(expiryStatus('', now), 'none');
  assert.equal(expiryStatus('не дата', now), 'none');
  assert.equal(expiryStatus('2026-09-01', now), 'expired');
  assert.equal(expiryStatus('2026-09-20', now), 'soon');
  assert.equal(expiryStatus('2027-09-12', now), 'ok');
});

// --- имя скана по умолчанию (заход 2 п.18): «Скан ДД.ММ.ГГГГ», без времени ---
test('scanDefaultName: «Скан ДД.ММ.ГГГГ» без времени', () => {
  assert.equal(scanDefaultName(new Date(2026, 8, 15)), 'Скан 15.09.2026');   // месяц 8 = сентябрь
  assert.equal(scanDefaultName(new Date(2026, 0, 3)), 'Скан 03.01.2026');
  const now = scanDefaultName();
  assert.match(now, /^Скан \d{2}\.\d{2}\.\d{4}$/);
  assert.ok(!/:/.test(now), 'в имени скана нет времени (двоеточия)');
});
