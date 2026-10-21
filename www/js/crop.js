// crop.js — ЧИСТАЯ математика ручной обрезки фото документа (п.6, ТОЛЬКО мобайл, не ядро).
// Никакого DOM и никаких тяжёлых библиотек (OpenCV/автокроп отвергнуты - 13 МБ): рамка кропа
// это просто прямоугольник в пикселях исходной картинки, углы двигает пользователь, поворот на
// 90° - перестановка осей. Всё тестируемо и покрыто мутацией; DOM-обвязку (canvas, drag углов)
// делает doc-viewer.openCropEditor. Пиксели всегда целые, рамка не вылезает за картинку и не
// схлопывается меньше минимума.
import { fitDimensions } from './documents.js';

export const MIN_CROP = 24;   // минимальная сторона рамки (px исходника) - чтобы не «схлопнуть»

const r = (n) => Math.round(Number(n) || 0);

// Рамка на всю картинку (старт: ничего не отрезано).
export function defaultCrop(w, h) {
  return { x: 0, y: 0, w: Math.max(1, r(w)), h: Math.max(1, r(h)) };
}

// Загнать рамку в границы [0..imgW]x[0..imgH], не давая ей стать меньше min по любой стороне.
export function clampCrop(rect, imgW, imgH, min = MIN_CROP) {
  imgW = Math.max(1, r(imgW)); imgH = Math.max(1, r(imgH));
  min = Math.min(min, imgW, imgH);
  let w = Math.min(Math.max(min, r(rect.w)), imgW);
  let h = Math.min(Math.max(min, r(rect.h)), imgH);
  let x = Math.min(Math.max(0, r(rect.x)), imgW - w);
  let y = Math.min(Math.max(0, r(rect.y)), imgH - h);
  return { x, y, w, h };
}

// Сдвинуть ОДИН угол рамки на (dx,dy) в пикселях исходника. corner: 'nw'|'ne'|'sw'|'se'.
// Противоположный угол закреплён; результат клампится в границы и по минимуму.
export function moveCorner(rect, corner, dx, dy, imgW, imgH, min = MIN_CROP) {
  dx = r(dx); dy = r(dy);
  let left = rect.x, top = rect.y, right = rect.x + rect.w, bottom = rect.y + rect.h;
  if (corner === 'nw') { left += dx; top += dy; }
  else if (corner === 'ne') { right += dx; top += dy; }
  else if (corner === 'sw') { left += dx; bottom += dy; }
  else if (corner === 'se') { right += dx; bottom += dy; }
  // не даём сторонам «перевернуться»
  if (right - left < min) { if (corner === 'nw' || corner === 'sw') left = right - min; else right = left + min; }
  if (bottom - top < min) { if (corner === 'nw' || corner === 'ne') top = bottom - min; else bottom = top + min; }
  return clampCrop({ x: left, y: top, w: right - left, h: bottom - top }, imgW, imgH, min);
}

// Размеры картинки после поворота на 90° (оси меняются местами).
export function rotateDims(w, h) {
  return { w: Math.max(1, r(h)), h: Math.max(1, r(w)) };
}

// Пересчёт рамки при повороте картинки на 90° ПО часовой. Исходник imgW×imgH → повёрнутый
// imgH×imgW; рамка следует за картинкой (полная рамка остаётся полной). Обратная связь для теста:
// точка (x,y) → (imgH - (y+h), x); w и h меняются местами.
export function rotateCropCW(rect, imgW, imgH) {
  imgW = Math.max(1, r(imgW)); imgH = Math.max(1, r(imgH));
  const x = imgH - (r(rect.y) + r(rect.h));
  const y = r(rect.x);
  return clampCrop({ x, y, w: r(rect.h), h: r(rect.w) }, imgH, imgW);
}

// Пересчёт рамки при повороте картинки на 90° ПРОТИВ часовой (1.2.22, кнопка «повернуть влево»).
// Зеркало rotateCropCW: исходник imgW×imgH → повёрнутый imgH×imgW; точка (x,y) → (y, imgW - x),
// поэтому рамка: x' = y, y' = imgW - (x+w); w и h меняются местами. CW затем CCW = исходная рамка.
export function rotateCropCCW(rect, imgW, imgH) {
  imgW = Math.max(1, r(imgW)); imgH = Math.max(1, r(imgH));
  const x = r(rect.y);
  const y = imgW - (r(rect.x) + r(rect.w));
  return clampCrop({ x, y, w: r(rect.h), h: r(rect.w) }, imgH, imgW);
}

// Позиция рамки в координатах СЦЕНЫ (px экрана). Холст отцентрован в сцене (place-items:center),
// поэтому к масштабированным координатам рамки прибавляем смещение холста (offX/offY =
// canvas.offsetLeft/offsetTop). Заслон п.15 (корень бага «окно обрезки смещено влево»): рамка
// раньше липла к левому краю сцены (offX не учитывался) и не покрывала правый край центрированной
// картинки. DPR тут ни при чём: у кропа displayed-size == canvas.width (нет ретина-масштаба).
export function framePlacement(crop, scale, offX = 0, offY = 0) {
  const s = Number(scale) || 1;
  return {
    left: Math.round(offX + crop.x * s),
    top: Math.round(offY + crop.y * s),
    width: Math.round(crop.w * s),
    height: Math.round(crop.h * s),
  };
}

// План отрисовки на canvas: рамку rect (пиксели исходника srcW×srcH) вырезаем и вписываем в
// canvas, уменьшая до maxDim (вес vault под контролем). Возвращает всё для canvas.width/height и
// ctx.drawImage(img, sx,sy,sw,sh, dx,dy,dw,dh). Пиксели целые; рамка предварительно клампится.
export function cropCanvasPlan(rect, srcW, srcH, maxDim) {
  const c = clampCrop(rect, srcW, srcH);
  const { w: canvasW, h: canvasH } = fitDimensions(c.w, c.h, maxDim);
  return {
    canvasW, canvasH,
    sx: c.x, sy: c.y, sw: c.w, sh: c.h,
    dx: 0, dy: 0, dw: canvasW, dh: canvasH,
  };
}

// Размер ИСХОДНИКА для окна обрезки (1.2.23, C8). Фото с камеры бывает 50-200 Мп: canvas такого
// размера на телефоне не создаётся (молча пустой) или роняет WebView по памяти, и снимок
// «пропадал без ошибки». Перед кропом уменьшаем до factor*maxDim по длинной стороне (запас на
// обрезку: после кропа результат всё равно вписывается в maxDim). Без апскейла.
export const CROP_SRC_FACTOR = 2;
export function cropSourceDims(w, h, maxDim, factor = CROP_SRC_FACTOR) {
  return fitDimensions(w, h, Math.max(1, Math.round(maxDim * factor)));
}
