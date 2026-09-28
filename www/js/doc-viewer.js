// doc-viewer.js — DOM-часть раздела «Документы» (только мобайл, не ядро): просмотрщик
// сканов с pinch-zoom и панорамированием, захват фото камерой и выбор файла. Вся чистая
// логика (модель, mime, математика зума) — в documents.js; здесь браузерная обвязка.
// PDF рендерим постранично через вендорный pdf.js (Mozilla, Apache-2.0), без сервисов Google.
import * as D from './documents.js';
import { defaultCrop, moveCorner, rotateDims, rotateCropCW, rotateCropCCW, cropCanvasPlan, framePlacement, cropSourceDims } from './crop.js';

const MAX_IMAGE_DIM = 2000;   // даунскейл вложений-картинок: паспорт читаем/зумируем, вес ~сотни КБ
const JPEG_QUALITY = 0.82;
const MIN_SCALE = 1;
const MAX_SCALE = 6;

// --- pdf.js v4 (ESM): ленивый импорт модуля + module-воркер ---
// В 4.x Mozilla раздаёт ESM-сборку (pdf.min.mjs) с именованными экспортами и ESM-воркером
// (pdf.worker.min.mjs). Грузим динамически при первом PDF: тяжёлый вендор не тянется, пока
// пользователь не открыл скан. Безопасные дефолты рендера задаём в getDocument (isEvalSupported:false).
let pdfLibPromise = null;
async function pdfLib() {
  if (typeof window === 'undefined') return null;
  if (!pdfLibPromise) {
    pdfLibPromise = import('../vendor/pdf.min.js')
      .then((lib) => {
        try { lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.js', import.meta.url).href; } catch (e) {}
        return lib;
      })
      .catch(() => null);
  }
  return pdfLibPromise;
}

// Общие безопасные опции загрузки PDF: eval выключен (заслон CVE-2024-4367 и класса
// eval-based инъекций), внешние ресурсы не тянем — приложение офлайн.
function pdfLoadOptions(bytes) {
  return { data: bytes, isEvalSupported: false, disableAutoFetch: true, disableStream: true };
}

// --- вспомогательное: модалка в гамме приложения (без нативных диалогов) ---
function makeBackdrop(modalClass) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal ' + modalClass;
  back.appendChild(m);
  return { back, m };
}
// C2 (1.2.23): Escape/«Назад» закрывает только ВЕРХНЕЕ окно (последний .modal-back в body): над
// просмотрщиком может стоять подтверждение удаления скана - закрыться должно оно, а не просмотр.
function isTopBack(back) {
  const all = document.querySelectorAll('.modal-back');
  return all.length > 0 && all[all.length - 1] === back;
}
function bindClose(back, onClose) {
  let downOnBack = false;
  back.addEventListener('mousedown', (e) => { downOnBack = (e.target === back); });
  back.addEventListener('mouseup', (e) => { const ok = downOnBack && e.target === back; downOnBack = false; if (ok) onClose(); });
  const onKey = (e) => { if (e.key === 'Escape' && isTopBack(back)) { e.stopPropagation(); onClose(); } };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

// Вписать натуральный размер в сцену (contain), не растягивая свыше сцены при scale=1.
function fitContain(natW, natH, stageW, stageH) {
  if (!natW || !natH) return { w: stageW, h: stageH };
  const k = Math.min(stageW / natW, stageH / natH, 1) || 1;
  return { w: Math.max(1, Math.round(natW * k)), h: Math.max(1, Math.round(natH * k)) };
}

// Контроллер зума/пана над сценой. content — обёртка, куда кладём img/canvas кадра.
function createZoomPan(stage, content) {
  let scale = MIN_SCALE, tx = 0, ty = 0;
  let cw = 0, ch = 0;                 // отображаемый размер кадра (CSS px, при scale=1)
  const pointers = new Map();
  let pinchStart = null;             // { dist, scale }
  let panStart = null;               // { x, y, tx, ty }

  const apply = () => {
    const c = D.constrainTranslate(tx, ty, scale, stage.clientWidth, stage.clientHeight, cw, ch);
    tx = c.tx; ty = c.ty;
    content.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    stage.classList.toggle('zoomed', scale > MIN_SCALE + 0.01);
  };
  const setScale = (s) => { scale = D.clampScale(s, MIN_SCALE, MAX_SCALE); apply(); };

  const setContentSize = (w, h) => {
    cw = w; ch = h;
    content.style.width = w + 'px';
    content.style.height = h + 'px';
    scale = MIN_SCALE; tx = 0; ty = 0; apply();
  };
  const reset = () => { scale = MIN_SCALE; tx = 0; ty = 0; apply(); };

  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onDown = (e) => {
    stage.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { pinchStart = { dist: dist(), scale }; panStart = null; }
    else if (pointers.size === 1 && scale > MIN_SCALE) { panStart = { x: e.clientX, y: e.clientY, tx, ty }; }
  };
  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart) {
      e.preventDefault();
      setScale(pinchStart.scale * (dist() / (pinchStart.dist || 1)));
    } else if (pointers.size === 1 && panStart) {
      e.preventDefault();
      tx = panStart.tx + (e.clientX - panStart.x);
      ty = panStart.ty + (e.clientY - panStart.y);
      apply();
    }
  };
  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) panStart = null;
  };
  const onWheel = (e) => { e.preventDefault(); setScale(scale * (e.deltaY < 0 ? 1.15 : 0.87)); };
  const onDbl = (e) => { e.preventDefault(); setScale(D.doubleTapScale(scale, MIN_SCALE, MAX_SCALE)); };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('dblclick', onDbl);

  return {
    setContentSize, reset,
    destroy() {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('dblclick', onDbl);
    },
  };
}

// Просмотрщик документа: pinch-zoom + пан, постраничная навигация (картинки и PDF).
// options.onRequestDelete(page) — необязательный колбэк (заход 3 п.9): если задан, в шапке
// появляется кнопка удаления текущего скана. Колбэк сам показывает подтверждение и удаляет
// страницу из записи (app.js: dlgConfirm + Docs.removePage), возвращает Promise<boolean> —
// true, если скан действительно удалён. Просмотрщик после этого пересобирает кадры.
export function openDocViewer(entry, options = {}) {
  const onRequestDelete = typeof options.onRequestDelete === 'function' ? options.onRequestDelete : null;
  const pages = (entry && entry.pages) || [];
  const { back, m } = makeBackdrop('doc-viewer');
  m.innerHTML = `
    <div class="dv-head">
      <span class="dv-title"></span>
      ${onRequestDelete ? '<button type="button" class="dv-del" title="Удалить скан">🗑</button>' : ''}
      <button type="button" class="dv-close" title="Закрыть">✕</button>
    </div>
    <div class="dv-stage"><div class="dv-content"></div></div>
    <div class="dv-foot">
      <button type="button" class="dv-prev" title="Предыдущая">‹</button>
      <span class="dv-count">-</span>
      <button type="button" class="dv-next" title="Следующая">›</button>
      <span class="dv-hint">Двойной тап или щипок - приблизить</span>
    </div>`;
  const stage = m.querySelector('.dv-stage');
  const content = m.querySelector('.dv-content');
  const titleEl = m.querySelector('.dv-title');
  const countEl = m.querySelector('.dv-count');
  const zp = createZoomPan(stage, content);
  const pdfDocs = new Map();   // pageId -> PDFDocumentProxy
  const counts = {};           // pageId -> число кадров (страниц PDF); картинка = 1
  let frames = [];
  let idx = 0;
  let closed = false;

  const close = () => {
    closed = true;
    zp.destroy();
    for (const doc of pdfDocs.values()) { try { doc.destroy(); } catch (e) {} }
    unbindKey();
    back.remove();
  };
  const unbindKey = bindClose(back, close);
  m.querySelector('.dv-close').onclick = close;

  const showFrame = async () => {
    const fr = frames[idx];
    if (!fr) return;
    const page = pages.find((p) => p.id === fr.pageId);
    // Имя скана не показываем (D3): заголовок нейтральный, позиция видна в счётчике ниже.
    titleEl.textContent = 'Документ';
    countEl.textContent = `${idx + 1} / ${frames.length}`;
    content.innerHTML = '';
    if (fr.mime === 'application/pdf') {
      const canvas = document.createElement('canvas');
      content.appendChild(canvas);
      await renderPdfFrame(canvas, page, fr.sub, stage, pdfDocs, zp);
    } else {
      const img = document.createElement('img');
      img.className = 'dv-img';
      img.decoding = 'async';
      img.onload = () => { const f = fitContain(img.naturalWidth, img.naturalHeight, stage.clientWidth, stage.clientHeight); zp.setContentSize(f.w, f.h); };
      img.onerror = () => { content.innerHTML = '<p class="dv-msg">Не удалось показать изображение.</p>'; };
      img.src = `data:${page.mime};base64,${page.data}`;
      content.appendChild(img);
    }
  };

  const go = (d) => { idx = Math.min(frames.length - 1, Math.max(0, idx + d)); showFrame(); };
  m.querySelector('.dv-prev').onclick = () => go(-1);
  m.querySelector('.dv-next').onclick = () => go(1);

  // Удаление текущего скана прямо из окна просмотра (заход 3 п.9). Колбэк сам спрашивает
  // подтверждение и удаляет страницу из записи; здесь пересобираем кадры и остаёмся в
  // просмотре, а если сканов не осталось — закрываем окно.
  const delBtn = onRequestDelete ? m.querySelector('.dv-del') : null;
  if (delBtn) delBtn.onclick = async () => {
    const fr = frames[idx];
    if (!fr) return;
    const page = pages.find((p) => p.id === fr.pageId);
    if (!page) return;
    const before = frames.length;
    const ok = await onRequestDelete(page);
    if (!ok || closed) return;
    const doc = pdfDocs.get(page.id);
    if (doc) { try { doc.destroy(); } catch (e) {} pdfDocs.delete(page.id); }
    delete counts[page.id];
    frames = D.buildFrames(pages, counts);
    if (!frames.length) { close(); return; }
    idx = D.frameIndexAfterRemoval(idx, before - frames.length, frames.length);
    showFrame();
  };

  document.body.appendChild(back);

  // Посчитать страницы PDF (для навигации) до построения кадров.
  (async () => {
    const lib = await pdfLib();
    for (const p of pages) {
      if (p.mime !== 'application/pdf') continue;
      if (!lib) { counts[p.id] = 1; continue; }
      try {
        const doc = await lib.getDocument(pdfLoadOptions(D.unb64(p.data))).promise;
        pdfDocs.set(p.id, doc);
        counts[p.id] = doc.numPages;
      } catch (e) { counts[p.id] = 1; }
    }
    if (closed) return;
    frames = D.buildFrames(pages, counts);
    if (!frames.length) { content.innerHTML = '<p class="dv-msg">В документе пока нет страниц.</p>'; countEl.textContent = '0 / 0'; return; }
    showFrame();
  })();
}

async function renderPdfFrame(canvas, page, sub, stage, pdfDocs, zp) {
  const lib = await pdfLib();
  if (!lib) { canvas.replaceWith(msg('Просмотр PDF недоступен на этом устройстве.')); return; }
  try {
    let doc = pdfDocs.get(page.id);
    if (!doc) { doc = await lib.getDocument(pdfLoadOptions(D.unb64(page.data))).promise; pdfDocs.set(page.id, doc); }
    const pdfPage = await doc.getPage(sub + 1);
    const base = pdfPage.getViewport({ scale: 1 });
    const fit = fitContain(base.width, base.height, stage.clientWidth, stage.clientHeight);
    const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const renderScale = (fit.w / base.width) * dpr;   // чёткий рендер под плотность экрана
    const viewport = pdfPage.getViewport({ scale: renderScale });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.style.width = fit.w + 'px';
    canvas.style.height = fit.h + 'px';
    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    zp.setContentSize(fit.w, fit.h);
  } catch (e) {
    canvas.replaceWith(msg('Не удалось показать страницу PDF.'));
  }
}
function msg(text) { const p = document.createElement('p'); p.className = 'dv-msg'; p.textContent = text; return p; }

// --- ручная обрезка/поворот фото после съёмки/выбора (п.6) ---
// ЛЁГКИЙ canvas-кроп без тяжёлых библиотек: рамка с перетаскиваемыми углами + поворот 90°.
// Математика в crop.js (тест+мутация), здесь только DOM. Возвращает Promise<dataUrl|null>:
// dataUrl — обрезанный JPEG (уже уменьшенный до MAX_IMAGE_DIM), null — пользователь отменил.
// Работает офлайн (canvas локально), результат уходит в тот же зашифрованный vault.
// 1.2.23 (C8): Promise отклоняется (Error 'crop-broken'), если картинку не удалось открыть или
// canvas не создался (огромное фото) - вызывающий показывает понятное сообщение, а не теряет
// снимок молча. Исходник перед кропом уменьшается до 2*MAX_IMAGE_DIM (cropSourceDims).
export function openCropEditor(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const broken = () => { const e = new Error('crop-broken'); e.code = 'crop-broken'; reject(e); };
    img.onerror = broken;
    img.onload = () => {
      // base — текущая (возможно повёрнутая) картинка, уменьшенная до 2*MAX_IMAGE_DIM (C8)
      let base = document.createElement('canvas');
      const nat = cropSourceDims(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_IMAGE_DIM);
      base.width = nat.w; base.height = nat.h;
      const bctx = base.getContext('2d');
      if (!bctx) { broken(); return; }
      try { bctx.drawImage(img, 0, 0, nat.w, nat.h); } catch (e) { broken(); return; }
      let crop = defaultCrop(base.width, base.height);

      const { back, m } = makeBackdrop('crop-editor');
      m.innerHTML = `
        <div class="crop-head">
          <span class="crop-title">Обрезка фото</span>
          <button type="button" class="crop-rotate crop-rotate-ccw" aria-label="Повернуть влево" title="Повернуть влево"><span aria-hidden="true">↺</span></button>
          <button type="button" class="crop-rotate crop-rotate-cw" aria-label="Повернуть вправо" title="Повернуть вправо"><span aria-hidden="true">↻</span></button>
        </div>
        <div class="crop-stage">
          <canvas class="crop-canvas"></canvas>
          <div class="crop-frame">
            <span class="crop-h nw"></span><span class="crop-h ne"></span>
            <span class="crop-h sw"></span><span class="crop-h se"></span>
          </div>
        </div>
        <p class="crop-hint">Потяните за углы рамки, лишнее по краям (стол, фон) уйдёт. Кнопки поворота - если фото боком.</p>
        <div class="modal-actions">
          <button type="button" class="cancel crop-cancel">Отмена</button>
          <button type="button" class="save crop-done">Готово</button>
        </div>`;
      const stage = m.querySelector('.crop-stage');
      const canvas = m.querySelector('.crop-canvas');
      const frame = m.querySelector('.crop-frame');
      let scale = 1;

      const draw = () => {
        // вписываем base в доступную ширину сцены (высота ограничена CSS max-height). C7: у сцены
        // внутренний отступ под ручки углов - вычитаем его, иначе холст упрётся в край и ручки обрежутся.
        const cs = window.getComputedStyle ? window.getComputedStyle(stage) : null;
        const padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
        const avail = Math.max(120, (stage.clientWidth || 320) - padX);
        const maxH = Math.round((window.innerHeight || 700) * 0.5);
        scale = Math.min(avail / base.width, maxH / base.height, 1) || 1;
        const dw = Math.max(1, Math.round(base.width * scale));
        const dh = Math.max(1, Math.round(base.height * scale));
        canvas.width = dw; canvas.height = dh;
        canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
        canvas.getContext('2d').drawImage(base, 0, 0, dw, dh);
        paintFrame();
      };
      const paintFrame = () => {
        // КОРЕНЬ бага п.15: .crop-stage центрирует холст (place-items:center), поэтому холст
        // сдвинут от левого края сцены на (stage.clientWidth - canvasWidth)/2. Рамка же
        // абсолютна относительно сцены; раньше её left=crop.x*scale считался от левого края
        // СЦЕНЫ -> рамка уезжала влево и не покрывала правый край картинки. Прибавляем реальное
        // смещение холста (canvas.offsetLeft/offsetTop) через framePlacement (тест+мутация).
        const p = framePlacement(crop, scale, canvas.offsetLeft, canvas.offsetTop);
        frame.style.left = p.left + 'px';
        frame.style.top = p.top + 'px';
        frame.style.width = p.width + 'px';
        frame.style.height = p.height + 'px';
      };

      // перетаскивание углов + сдвиг всей рамки за середину
      let drag = null;
      const onDown = (e) => {
        const h = e.target.closest('.crop-h');
        const corner = h ? [...h.classList].find((c) => ['nw', 'ne', 'sw', 'se'].includes(c)) : null;
        drag = { corner, x: e.clientX, y: e.clientY, rect: { ...crop } };
        try { (h || frame).setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault(); e.stopPropagation();
      };
      const onMove = (e) => {
        if (!drag) return;
        const dx = (e.clientX - drag.x) / scale, dy = (e.clientY - drag.y) / scale;
        if (drag.corner) crop = moveCorner(drag.rect, drag.corner, dx, dy, base.width, base.height);
        else {           // тянем всю рамку
          crop = { ...drag.rect };
          crop.x = Math.min(Math.max(0, Math.round(drag.rect.x + dx)), base.width - crop.w);
          crop.y = Math.min(Math.max(0, Math.round(drag.rect.y + dy)), base.height - crop.h);
        }
        paintFrame();
      };
      const onUp = () => { drag = null; };
      frame.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);

      // Поворот на 90° в обе стороны (1.2.22): ↺ влево (против часовой), ↻ вправо (по часовой).
      // Рамка пересчитывается чистой функцией (rotateCropCW/CCW, тест+мутация), холст - тут.
      const rotate = (cw) => {
        const nc = cw ? rotateCropCW(crop, base.width, base.height) : rotateCropCCW(crop, base.width, base.height);
        const rot = document.createElement('canvas');
        const rd = rotateDims(base.width, base.height);
        rot.width = rd.w; rot.height = rd.h;
        const ctx = rot.getContext('2d');
        if (cw) { ctx.translate(rd.w, 0); ctx.rotate(Math.PI / 2); }    // 90° по часовой
        else { ctx.translate(0, rd.h); ctx.rotate(-Math.PI / 2); }       // 90° против часовой
        ctx.drawImage(base, 0, 0);
        base = rot; crop = nc; draw();
      };
      m.querySelector('.crop-rotate-ccw').onclick = () => rotate(false);
      m.querySelector('.crop-rotate-cw').onclick = () => rotate(true);

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        unbind(); back.remove();
      };
      const unbind = bindClose(back, () => { cleanup(); resolve(null); });
      m.querySelector('.crop-cancel').onclick = () => { cleanup(); resolve(null); };
      m.querySelector('.crop-done').onclick = () => {
        const plan = cropCanvasPlan(crop, base.width, base.height, MAX_IMAGE_DIM);
        const out = document.createElement('canvas');
        out.width = plan.canvasW; out.height = plan.canvasH;
        out.getContext('2d').drawImage(base, plan.sx, plan.sy, plan.sw, plan.sh, plan.dx, plan.dy, plan.dw, plan.dh);
        let url = '';
        try { url = out.toDataURL('image/jpeg', JPEG_QUALITY); } catch (e) { url = ''; }
        cleanup();
        if (!/^data:image\/[a-z]+;base64,./.test(url)) { broken(); return; }   // canvas не создался (C8)
        resolve(url);
      };

      document.body.appendChild(back);
      // сцена должна иметь ширину до первого draw
      requestAnimationFrame(draw);
    };
    img.src = dataUrl;
  });
}

// --- захват фото штатной камерой телефона (18.11) ---
// Вместо in-app getUserMedia-превью (оно на многих Android не фокусируется на близком
// документе) открываем СИСТЕМНОЕ приложение камеры через <input type="file" accept="image/*"
// capture="environment">: там штатный автофокус/макро, и пользователь снимает привычным
// интерфейсом. Результат приходит файлом, даунскейлим как обычную картинку и кладём страницей.
//
// 1.2.23 (C1): выбор файла/снимок и обработка (окно обрезки) РАЗДЕЛЕНЫ. chooseFiles() - только
// системное окно (app.js держит на нём флаг «системное окно», чтобы уход в фон не запирал сейф);
// обработка с окном обрезки - отдельно (cameraFileToPage / filesToPages), уже БЕЗ этого флага:
// иначе, пока открыто наше окно обрезки, автоблок не срабатывал вовсе (уход в фон на часы).
export function chooseFiles({ camera = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (camera) {
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');   // задняя камера, штатное приложение
    } else {
      input.accept = 'image/*,application/pdf';
      input.multiple = true;
    }
    input.style.display = 'none';
    let settled = false;
    const finish = (files) => { if (settled) return; settled = true; input.remove(); resolve(files); };
    input.onchange = () => finish(Array.from(input.files || []));
    input.addEventListener('cancel', () => finish([]));
    // Пользователь мог закрыть окно без выбора - не подвешиваем промис.
    window.addEventListener('focus', function onFocus() {
      window.removeEventListener('focus', onFocus);
      setTimeout(() => { if (!settled && !(input.files && input.files.length)) finish([]); }, camera ? 800 : 400);
    });
    document.body.appendChild(input);
    input.click();
  });
}

// Проблема картинки (C8) как Error с кодом: 'heic' | 'unsupported' | 'broken'. app.js берёт текст
// из D.IMAGE_PROBLEM_TEXT по коду.
function problem(code) { const e = new Error(code); e.code = code; return e; }

// Снимок камеры -> страница (с ручной обрезкой). null - пользователь отменил обрезку.
// Бросает Error с кодом heic/unsupported/broken - снимок не пропадает молча (C8).
export async function cameraFileToPage(f) {
  if (!f) return null;
  const dataUrl = await readAsDataURL(f);
  const parsed0 = D.parseDataUrl(dataUrl);
  const why = D.imageProblem({ mime: parsed0.mime, declared: f.type, name: f.name });
  if (why) throw problem(why);
  if (parsed0.mime === 'application/pdf') throw problem('unsupported');
  // Ручная обрезка/поворот (п.6): в кадр камеры часто попадает стол/фон - даём отрезать.
  let croppedUrl;
  try { croppedUrl = await openCropEditor(dataUrl); } catch (e) { throw problem('broken'); }
  if (croppedUrl === null) return null;   // отмена = снимок не добавляем
  const out = D.parseDataUrl(croppedUrl); // уже уменьшен до MAX_IMAGE_DIM в кропе
  return D.createPage({ name: 'Скан ' + new Date().toLocaleString('ru-RU'), mime: out.mime, data: D.b64(out.bytes) });
}

// Выбранные файлы -> страницы. Один снимок-картинка - с ручной обрезкой (как у камеры);
// несколько файлов или PDF - как есть (пакетно кадрировать неудобно). errors - имена
// непринятых файлов; heic/broken - для понятного сообщения (C8).
export async function filesToPages(files) {
  files = files || [];
  const pages = [];
  const errors = [];
  let heic = false, broken = false;
  if (files.length === 1) {
    const f = files[0];
    let dataUrl = null, parsed0 = null;
    try { dataUrl = await readAsDataURL(f); parsed0 = D.parseDataUrl(dataUrl); } catch (e) { parsed0 = null; }
    if (parsed0) {
      const why = D.imageProblem({ mime: parsed0.mime, declared: f.type, name: f.name });
      if (why === 'heic') return { pages, errors: [f.name], heic: true, broken };
      if (!why && parsed0.mime !== 'application/pdf') {
        let croppedUrl;
        try { croppedUrl = await openCropEditor(dataUrl); }
        catch (e) { return { pages, errors: [f.name], heic, broken: true }; }
        if (croppedUrl === null) return { pages, errors, heic, broken };
        const out = D.parseDataUrl(croppedUrl);
        pages.push(D.createPage({ name: f.name, mime: out.mime, data: D.b64(out.bytes) }));
        return { pages, errors, heic, broken };
      }
    }
  }
  for (const f of files) {
    try {
      const dataUrl = await readAsDataURL(f);
      let parsed = D.parseDataUrl(dataUrl);
      const why = D.imageProblem({ mime: parsed.mime, declared: f.type, name: f.name });
      if (why) { if (why === 'heic') heic = true; errors.push(f.name); continue; }
      if (parsed.mime !== 'application/pdf') parsed = await downscaleImage(dataUrl, parsed.mime);
      pages.push(D.createPage({ name: f.name, mime: parsed.mime, data: D.b64(parsed.bytes) }));
    } catch (e) { errors.push(f.name); }
  }
  return { pages, errors, heic, broken };
}

// Совместимые обёртки (прежний контракт): выбор + обработка одним вызовом. app.js с 1.2.23
// зовёт части по отдельности (C1), эти оставлены для QA-харнесов.
export async function captureFromCamera() {
  const files = await chooseFiles({ camera: true });
  try { return await cameraFileToPage(files[0]); } catch (e) { return null; }
}
export async function pickFiles() {
  return filesToPages(await chooseFiles({ camera: false }));
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(file);
  });
}

// Даунскейл картинки через canvas → JPEG (контроль веса vault). PDF не трогаем.
function downscaleImage(dataUrl, mime) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const fit = D.fitDimensions(img.naturalWidth, img.naturalHeight, MAX_IMAGE_DIM);
      if (fit.w === img.naturalWidth && fit.h === img.naturalHeight && mime === 'image/jpeg') {
        resolve(D.parseDataUrl(dataUrl)); return;    // уже мелкий JPEG — как есть
      }
      const canvas = document.createElement('canvas');
      canvas.width = fit.w; canvas.height = fit.h;
      canvas.getContext('2d').drawImage(img, 0, 0, fit.w, fit.h);
      resolve(D.parseDataUrl(canvas.toDataURL('image/jpeg', JPEG_QUALITY)));
    };
    img.onerror = () => resolve(D.parseDataUrl(dataUrl));  // не смогли — исходник
    img.src = dataUrl;
  });
}
