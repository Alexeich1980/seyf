// Loyalty cards: pure schema and offline barcode codec. No storage/network side effects.
import ZXing from './vendor/loyalty/zxing.js';
import JsBarcode from './vendor/loyalty/jsbarcode.js';
export const SECTION = 'loyalty';
export const BARCODE_TYPES = ['', 'EAN13', 'EAN8', 'CODE128', 'UPC', 'QR'];
// Palette is an array of CSS hex strings (not objects); persisted selection: entry.color.
// Keep the original order and modulus for cards without an explicit selection.
const LEGACY_LOYALTY_COLORS = Object.freeze(['#2563eb', '#7c3aed', '#be185d', '#b45309', '#047857', '#0e7490']);
export const LOYALTY_COLORS = Object.freeze([...LEGACY_LOYALTY_COLORS, '#b91c1c', '#65751f', '#795548', '#475569']);
export const LOYALTY_COLOR_NAMES = Object.freeze(['Синий', 'Фиолетовый', 'Розовый', 'Янтарный', 'Зелёный', 'Бирюзовый', 'Красный', 'Оливковый', 'Коричневый', 'Серый']);
export function cardColor(entry) {
  if (LOYALTY_COLORS.includes(entry?.color)) return entry.color;
  let hash = 0;
  for (const c of String(entry?.description || '')) hash = (Math.imul(hash, 31) + c.codePointAt(0)) >>> 0;
  return LEGACY_LOYALTY_COLORS[hash % LEGACY_LOYALTY_COLORS.length];
}
// Exact strings only: identifiers must never pass through Number()/parseInt().
export function findDuplicateCard(entries, card) {
  const store = s => String(s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  const hasCode = e => typeof e.barcodeType === 'string' && !!e.barcodeType && typeof e.barcodeValue === 'string' && !!e.barcodeValue;
  return entries.find(e => {
    if (card.id != null && e.id === card.id) return false;
    if (hasCode(card)) return hasCode(e) && e.barcodeType === card.barcodeType && e.barcodeValue === card.barcodeValue;
    return !card.barcodeType && !card.barcodeValue && !e.barcodeType && !e.barcodeValue &&
      typeof card.number === 'string' && !!card.number && e.number === card.number &&
      !!store(card.description) && store(e.description) === store(card.description);
  }) || null;
}
// 'up'/'down' swap with the previous/next favorite in storage order.
// Nonfavorite positions and relative order remain untouched. Boundary/invalid moves return false.
export function moveFavorite(entries, id, direction) {
  if (!['up', 'down'].includes(direction)) return false;
  const from = entries.findIndex(e => e.id === id && e.favorite);
  if (from < 0) return false;
  const step = direction === 'up' ? -1 : 1;
  for (let to = from + step; to >= 0 && to < entries.length; to += step) {
    if (entries[to].favorite) { [entries[from], entries[to]] = [entries[to], entries[from]]; return true; }
  }
  return false;
}
const formats = { EAN13: 'EAN_13', EAN8: 'EAN_8', CODE128: 'CODE_128', UPC: 'UPC_A', QR: 'QR_CODE' };
export function validateBarcode(type, value) {
  if (!BARCODE_TYPES.includes(type)) throw new Error('Выберите поддерживаемый формат кода.');
  if (!type) { if (value) throw new Error('Выберите формат кода или очистите его значение.'); return; }
  if (!value || value.length > 2048) throw new Error('Введите значение кода (до 2048 символов).');
  const lengths = { EAN13: 13, EAN8: 8, UPC: 12 };
  if (lengths[type]) {
    if (!new RegExp('^\\d{' + lengths[type] + '}$').test(value)) throw new Error('Неверная длина кода ' + type + '.');
    let sum = 0;
    for (let i = value.length - 2, n = 0; i >= 0; i--, n++) sum += Number(value[i]) * (n % 2 ? 1 : 3);
    if ((10 - sum % 10) % 10 !== Number(value.at(-1))) throw new Error('Не совпадает контрольная цифра кода.');
  }
  if (type === 'CODE128' && !/^[\x20-\x7e]{1,160}$/.test(value)) throw new Error('Code 128: до 160 латинских букв, цифр и знаков.');
}
export function makeCard(data, previous = null, now = new Date().toISOString()) {
  const description = String(data.description ?? '').trim();
  const number = String(data.number ?? '').trim();
  const barcodeType = String(data.barcodeType ?? '');
  const barcodeValue = String(data.barcodeValue ?? '');
  if (!description) throw new Error('Введите название магазина.');
  if (description.length > 200 || number.length > 2048) throw new Error('Название или номер слишком длинные.');
  validateBarcode(barcodeType, barcodeValue);
  const images = (data.images ?? []).map(p => ({ ...p }));
  if (images.length > 2 || images.some(p => !['front', 'back'].includes(p.side) || !['image/jpeg', 'image/png', 'image/webp'].includes(p.mime) || !p.data)) throw new Error('Добавьте не больше двух фотографий сторон карты.');
  if (new Set(images.map(p => p.side)).size !== images.length) throw new Error('Для каждой стороны нужна одна фотография.');
  if (!number && !barcodeValue && !images.length) throw new Error('Введите номер, отсканируйте код или добавьте фото карты.');
  return { ...(previous || {}), id: previous?.id || globalThis.crypto.randomUUID(), description, number,
    note: String(data.note ?? ''), barcodeType, barcodeValue, images,
    color: cardColor({ description, color: data.color === undefined ? previous?.color : data.color }),
    favorite: !!data.favorite, tags: previous?.tags || [], customFields: previous?.customFields || [],
    createdAt: previous?.createdAt || now, updatedAt: now };
}
// Serialized into a disposable module worker; all image pixels and ZXing work stay there.
async function scanCardImage(file, width, height) {
  const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tile = new OffscreenCanvas(1, 1);
  const tc = tile.getContext('2d', { willReadFrequently: true });
  const found = new Map();
  try {
    // Full-height/full-width strips preserve large adjacent codes that square grids cut.
    // Each orientation: 1 + 2 + 2 + 4 + 9 + 12 = 30 overlapping windows.
    // The 3x4 grid becomes 4x3 at 90 degrees; total remains 60 attempts / 10 seconds.
    for (let rotation = 0; rotation < 2; rotation++) {
      canvas.width = rotation ? height : width; canvas.height = rotation ? width : height;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (rotation) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
      ctx.drawImage(bitmap, 0, 0); ctx.restore();
      for (const [columns, rows] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 3], [3, 4]]) {
        const w = Math.ceil(canvas.width * (columns === 1 ? 1 : 1.3 / columns));
        const h = Math.ceil(canvas.height * (rows === 1 ? 1 : 1.3 / rows));
        tile.width = w; tile.height = h;
        for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
          const x = columns === 1 ? 0 : Math.round(col * (canvas.width - w) / (columns - 1));
          const y = rows === 1 ? 0 : Math.round(row * (canvas.height - h) / (rows - 1));
          tc.drawImage(canvas, x, y, w, h, 0, 0, w, h);
          const result = decodeBarcode(tc.getImageData(0, 0, w, h));
          if (result) found.set(JSON.stringify([result.barcodeType, result.barcodeValue]), result);
        }
      }
    }
    return [...found.values()];
  } finally { bitmap.close(); canvas.width = canvas.height = tile.width = tile.height = 1; }
}

// Offline File -> distinct supported codes. Blank/no readable code resolves []; malformed input rejects.
// Limits: JPEG/PNG/WebP, 12 MiB, 40 megapixels, longest processed side 1600px, 60 attempts, 10s.
export async function decodeCardImage(file) {
  if (!(file instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Выберите изображение JPEG, PNG или WebP.');
  if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('Размер изображения должен быть от 1 байта до 12 МБ.');
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined')
    throw new Error('Распознавание фото недоступно в этом браузере. Введите код вручную.');
  return new Promise((resolve, reject) => {
    let worker, imageURL, workerURL, finished = false;
    const img = new Image();
    const finish = (error, result) => {
      if (finished) return; finished = true;
      clearTimeout(timer); worker?.terminate(); img.onload = img.onerror = null; img.src = '';
      if (imageURL) URL.revokeObjectURL(imageURL);
      if (workerURL) URL.revokeObjectURL(workerURL);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Распознавание заняло слишком много времени. Обрежьте фото до области кода.')), 10000);
    img.onerror = () => finish(new Error('Не удалось прочитать изображение. Выберите другое фото.'));
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h || w * h > 40000000) throw new Error('Слишком большое изображение. Уменьшите его до 40 мегапикселей.');
        const scale = Math.min(1, 1600 / Math.max(w, h));
        const source = `import { decodeBarcode } from ${JSON.stringify(import.meta.url)};\n${scanCardImage.toString()}\nonmessage = async ({data}) => { try { postMessage({result: await scanCardImage(...data)}); } catch { postMessage({error: true}); } };`;
        workerURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        worker = new Worker(workerURL, { type: 'module' });
        worker.onmessage = ({ data }) => finish(data.error ? new Error('Не удалось распознать изображение. Попробуйте другое фото.') : null, data.result);
        worker.onerror = () => finish(new Error('Не удалось запустить распознавание фото. Введите код вручную.'));
        worker.postMessage([file, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]);
      } catch (e) { finish(e); }
    };
    try { imageURL = URL.createObjectURL(file); img.src = imageURL; } catch (e) { finish(e); }
  });
}
export function listCards(entries, { favoritesOnly = false, query = '' } = {}) {
  const q = query.trim().toLocaleLowerCase();
  return entries.filter(e => (!favoritesOnly || e.favorite) && (!q || [e.description, e.number, e.note].some(s => String(s || '').toLocaleLowerCase().includes(q))))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
}
// The very same matrix powers canvas rendering and synthetic round-trip tests.
export function barcodePixels(type, value) {
  validateBarcode(type, value);
  if (!type) return null;
  if (type === 'QR') {
    const hints = new Map([[ZXing.EncodeHintType.CHARACTER_SET, 'UTF-8'], [ZXing.EncodeHintType.MARGIN, 4]]);
    const m = new ZXing.QRCodeWriter().encode(value, ZXing.BarcodeFormat.QR_CODE, 360, 360, hints);
    return { width: m.getWidth(), height: m.getHeight(), black: (x, y) => m.get(x, y) };
  }
  const out = {};
  JsBarcode(out, value, { format: type, displayValue: false, width: 3, height: 160, margin: 30 });
  const bits = out.encodings.map(e => e.data).join('');
  return { width: bits.length * 3 + 60, height: 220, black: (x, y) => y >= 30 && y < 190 && x >= 30 && x < bits.length * 3 + 30 && bits[Math.floor((x - 30) / 3)] === '1' };
}
export function drawBarcode(canvas, type, value) {
  const p = barcodePixels(type, value);
  if (!p) { canvas.width = canvas.height = 0; return; }
  canvas.width = p.width; canvas.height = p.height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(p.width, p.height);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const i = (y * p.width + x) * 4, v = p.black(x, y) ? 0 : 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
export function decodeBarcode({ data, width, height }) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (data[i * 4] + 2 * data[i * 4 + 1] + data[i * 4 + 2]) >> 2;
  const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, Object.values(formats).map(f => ZXing.BarcodeFormat[f])], [ZXing.DecodeHintType.TRY_HARDER, true]]);
  const reader = new ZXing.MultiFormatReader();
  try {
    const result = reader.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(gray, width, height))), hints);
    const barcodeType = Object.keys(formats).find(t => ZXing.BarcodeFormat[formats[t]] === result.getBarcodeFormat());
    if (!barcodeType) return null;
    const barcodeValue = result.getText(); validateBarcode(barcodeType, barcodeValue);
    return { barcodeType, barcodeValue };
  } catch (e) {
    if (e instanceof ZXing.NotFoundException || e instanceof ZXing.ChecksumException || e instanceof ZXing.FormatException) return null;
    throw e;
  } finally { reader.reset(); }
}
// Returns stop immediately, even during permission/play/constraint promises.
// onCamera snapshots expose only reported capabilities; controls resolve false on rejection/stop.
export function startBarcodeScan(video, canvas, { onResult, onError, onCamera, getViewAspect, deviceId, isActive = () => true, mediaDevices = globalThis.navigator?.mediaDevices } = {}) {
  let stopped = false, stream, track, timer, watch, frame = 0, attached = false;
  let caps = {}, applied = {}, queue = Promise.resolve(), cameras = [];
  const unavailable = new Set();
  const active = () => !stopped && isActive();
  const stopTracks = s => s?.getTracks().forEach(t => t.stop());
  const ended = () => fail(new Error('Камера отключилась. Откройте сканер снова.'));
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); clearTimeout(watch);
    track?.removeEventListener?.('ended', ended);
    // A late completion of this session must never clear a newer session's video/canvas.
    if (attached && video.srcObject === stream) {
      video.srcObject = null; canvas.width = canvas.height = 0;
    }
    stopTracks(stream); stream = null;
  };
  const fail = e => { const notify = active(); stop(); if (notify) onError?.(e); };
  const live = () => {
    if (!active()) { stop(); return false; }
    if (track?.readyState === 'ended') { ended(); return false; }
    return true;
  };
  const settings = () => { try { return track?.getSettings?.() || {}; } catch { return {}; } };
  const canApply = () => typeof track?.applyConstraints === 'function';
  const modes = () => Array.isArray(caps.focusMode) ? caps.focusMode : [];
  const zoomRange = () => {
    const z = caps.zoom, value = settings().zoom;
    return canApply() && z && Number.isFinite(z.min) && Number.isFinite(z.max) && z.max > z.min && Number.isFinite(value)
      ? { min: z.min, max: z.max, step: z.step > 0 ? z.step : 0.1, value } : null;
  };
  const torchAvailable = () => canApply() && (caps.torch === true ||
    (Array.isArray(caps.torch) && caps.torch.includes(true) && caps.torch.includes(false)));
  const publish = () => { if (live()) onCamera?.({
    cameras: cameras.map(c => ({ ...c })), cameraId: settings().deviceId || null,
    focus, focusAvailable: canApply() && modes().includes('single-shot'),
    focusMode: settings().focusMode || null,
    zoom: zoomRange(), setZoom, torch: torchAvailable(), setTorch
  }); };
  // Serialize UI changes so zoom/torch do not replace the selected focus mode or each other.
  const apply = patch => {
    const job = queue.then(async () => {
      if (!live() || !canApply()) return false;
      const next = { ...applied, ...patch };
      try { await track.applyConstraints({ advanced: [next] }); }
      catch { return false; } // Older WebViews may expose a capability but reject it.
      if (!live()) return false;
      applied = next; publish(); return true;
    });
    queue = job.catch(() => false);
    return queue;
  };
  const focus = (x = 0.5, y = 0.5) => {
    if (!live() || !canApply() || !modes().includes('single-shot') ||
        !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return Promise.resolve(false);
    const patch = { focusMode: 'single-shot' };
    // pointsOfInterest has no per-track capabilities member. Only use it if settings expose it.
    if (Array.isArray(settings().pointsOfInterest)) patch.pointsOfInterest = [{ x, y }];
    return apply(patch);
  };
  const setZoom = value => {
    const z = zoomRange();
    if (!live() || !z || !Number.isFinite(value)) return Promise.resolve(false);
    const quantized = z.min + Math.round((value - z.min) / z.step) * z.step;
    return apply({ zoom: Math.max(z.min, Math.min(z.max, quantized)) });
  };
  const setTorch = value => !live() || !torchAvailable() || typeof value !== 'boolean'
    ? Promise.resolve(false) : apply({ torch: value });
  const tick = () => {
    if (!live()) return;
    try {
      if (video.videoWidth && video.videoHeight && video.readyState >= 2) {
        // One bounded decode per tick. Alternate orientation because RGBLuminanceSource
        // cannot rotate, so ZXing TRY_HARDER alone does not read vertical linear codes.
        // Match centered object-fit: cover exactly; never scan invisible outer pixels.
        // Read on each frame so resizing/orientation changes do not leave a stale crop.
        let aspect;
        try { aspect = getViewAspect?.(); } catch { /* Unavailable layout: whole frame. */ }
        let sw = video.videoWidth, sh = video.videoHeight;
        if (Number.isFinite(aspect) && aspect > 0) {
          if (sw / sh > aspect) sw = sh * aspect;
          else sh = sw / aspect;
        }
        const sx = (video.videoWidth - sw) / 2, sy = (video.videoHeight - sh) / 2;
        const k = Math.min(1, 1600 / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
        const rotated = frame++ % 2 === 1;
        canvas.width = rotated ? h : w; canvas.height = rotated ? w : h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.save();
        try {
          if (rotated) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
        } finally { ctx.restore(); }
        const result = decodeBarcode(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (!live()) return;
        if (result) { stop(); if (isActive()) onResult?.(result); return; }
      }
      timer = setTimeout(tick, 200);
    } catch (e) { fail(e); }
  };
  const checkLife = () => { if (live()) watch = setTimeout(checkLife, 200); };
  Promise.resolve().then(async () => {
    if (!live()) return;
    checkLife(); // Also release the camera if play()/applyConstraints() never settles on lock.
    if (!mediaDevices?.getUserMedia) throw new Error('Камера недоступна. Введите номер вручную.');
    // Labels are browser-provided; deviceId is opaque and never interpreted as a number.
    const enumerate = async () => {
      try {
        const devices = await mediaDevices.enumerateDevices();
        if (!live()) return [];
        const seen = new Set();
        const videoDevices = devices.filter(d => d.kind === 'videoinput' && d.deviceId &&
          !unavailable.has(d.deviceId) && !seen.has(d.deviceId) && seen.add(d.deviceId));
        const rear = videoDevices.filter(d => /\b(back|rear|environment)\b/i.test(d.label) &&
          !/\b(front|user|facetime)\b/i.test(d.label));
        const rank = d => /\b(telephoto|tele|macro|ultra[ -]?wide)\b/i.test(d.label) ? 4 :
          /\b(main|primary)\b/i.test(d.label) ? 0 :
          /^camera 0, facing back(?:\b|,)/i.test(d.label) ? 1 :
          /\bwide\b/i.test(d.label) ? 3 : 2;
        // Ambiguous multi-camera labels do not justify offering a possible front camera.
        const candidates = rear.length ? rear.sort((a, b) => rank(a) - rank(b)) :
          videoDevices.length === 1 && videoDevices[0].label ? videoDevices : [];
        return candidates.map(d => ({ deviceId: d.deviceId, label: d.label || 'Камера' }));
      } catch { return []; } // Enumeration is optional, including privacy/permission failures.
    };
    const acquire = async id => {
      const constraints = { audio: false, video: {
        ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' } }),
        width: { ideal: 1920 }, height: { ideal: 1080 }
      } };
      let acquired;
      try { acquired = await mediaDevices.getUserMedia(constraints); }
      catch (e) {
        if (!live()) return null;
        // A vanished selected camera gets ONE default attempt. Never retry denial/busy.
        const fallback = id ? ['NotFoundError', 'OverconstrainedError'].includes(e?.name) :
          ['OverconstrainedError', 'TypeError'].includes(e?.name);
        if (!fallback) throw e;
        if (id) unavailable.add(id);
        acquired = await mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      }
      if (!live()) { stopTracks(acquired); return null; }
      return acquired;
    };
    const preferred = typeof deviceId === 'string' && deviceId ? deviceId : null;
    if (!preferred && typeof mediaDevices.enumerateDevices === 'function') cameras = await enumerate();
    if (!live()) return;
    const initialId = preferred || cameras[0]?.deviceId;
    const first = await acquire(initialId);
    if (!live()) { stopTracks(first); return; }
    stream = first;
    if (!stream) return;
    // Own the permission stream while labels are being exposed: stop/lock releases it.
    if (typeof mediaDevices.enumerateDevices === 'function') {
      cameras = await enumerate();
      if (!live()) return;
      let currentId;
      try { currentId = stream.getVideoTracks?.()[0]?.getSettings?.().deviceId; } catch { /* optional */ }
      const selected = cameras[0]?.deviceId;
      if (!initialId && selected && selected !== currentId) {
        const previous = stream; stream = null;
        stopTracks(previous); // Mobile camera hardware may allow only one open stream.
        const replacement = await acquire(selected);
        if (!live()) { stopTracks(replacement); return; }
        stream = replacement;
        if (!stream) return;
      }
    }
    cameras = cameras.filter(c => !unavailable.has(c.deviceId));
    track = stream.getVideoTracks?.()[0];
    track?.addEventListener?.('ended', ended);
    if (!live()) return;
    try { caps = track?.getCapabilities?.() || {}; } catch { caps = {}; }
    video.srcObject = stream; attached = true; video.muted = true; video.playsInline = true;
    publish();
    if (!live()) return;
    // Best effort, after acquisition; never delay preview/decoding for camera firmware.
    if (canApply() && modes().includes('continuous')) void apply({ focusMode: 'continuous' });
    await video.play(); if (!live()) return; tick();
  }).catch(fail);
  return stop;
}
