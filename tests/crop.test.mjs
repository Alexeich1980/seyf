// crop.test.mjs — чистая математика ручной обрезки фото (п.6). DOM-обвязка (openCropEditor)
// проверяется визуально в браузере; здесь — логика рамки: кламп в границы, сдвиг углов с
// минимумом, поворот на 90° и план отрисовки на canvas. Мутация: сорвать кламп/минимум/поворот -
// тесты краснеют (см. отдельные assert-инварианты).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_CROP, defaultCrop, clampCrop, moveCorner, rotateDims, rotateCropCW, rotateCropCCW, cropCanvasPlan,
  framePlacement,
} from '../www/js/crop.js';

test('defaultCrop: рамка на всю картинку', () => {
  assert.deepEqual(defaultCrop(800, 600), { x: 0, y: 0, w: 800, h: 600 });
});

test('clampCrop: не вылезает за границы и не меньше минимума', () => {
  // выходит за правый/нижний край - подрезается внутрь
  assert.deepEqual(clampCrop({ x: 700, y: 500, w: 400, h: 400 }, 800, 600), { x: 400, y: 200, w: 400, h: 400 });
  // отрицательные координаты - к нулю
  assert.deepEqual(clampCrop({ x: -50, y: -30, w: 100, h: 100 }, 800, 600), { x: 0, y: 0, w: 100, h: 100 });
  // слишком маленькая - до минимума
  const c = clampCrop({ x: 10, y: 10, w: 2, h: 2 }, 800, 600);
  assert.equal(c.w, MIN_CROP);
  assert.equal(c.h, MIN_CROP);
});

test('moveCorner: тянем se - противоположный угол (nw) закреплён', () => {
  const r = moveCorner({ x: 100, y: 100, w: 200, h: 200 }, 'se', 50, 30, 800, 600);
  assert.equal(r.x, 100); assert.equal(r.y, 100);
  assert.equal(r.w, 250); assert.equal(r.h, 230);
});

test('moveCorner: тянем nw - правый-нижний угол (se) закреплён', () => {
  const r = moveCorner({ x: 100, y: 100, w: 200, h: 200 }, 'nw', 40, 20, 800, 600);
  // se-угол (300,300) на месте: новая рамка 140..300 x 120..300
  assert.equal(r.x, 140); assert.equal(r.y, 120);
  assert.equal(r.w, 160); assert.equal(r.h, 180);
});

test('moveCorner: перетаскивание за противоположную сторону не «переворачивает» рамку (минимум)', () => {
  // тянем nw далеко вниз-вправо за se (300,300): рамка не схлопывается ниже MIN_CROP
  const r = moveCorner({ x: 100, y: 100, w: 200, h: 200 }, 'nw', 1000, 1000, 800, 600);
  assert.equal(r.w, MIN_CROP);
  assert.equal(r.h, MIN_CROP);
  assert.equal(r.x, 300 - MIN_CROP);
  assert.equal(r.y, 300 - MIN_CROP);
});

test('rotateDims: оси меняются местами', () => {
  assert.deepEqual(rotateDims(800, 600), { w: 600, h: 800 });
});

test('rotateCropCW: полная рамка остаётся полной после поворота', () => {
  const full = defaultCrop(800, 600);
  assert.deepEqual(rotateCropCW(full, 800, 600), { x: 0, y: 0, w: 600, h: 800 });
});

test('rotateCropCW: точка (x,y) → (imgH-(y+h), x); w,h меняются местами', () => {
  // картинка 800x600, рамка {x:100,y:50,w:200,h:150}. После CW: x'=600-(50+150)=400, y'=100, w'=150,h'=200
  const r = rotateCropCW({ x: 100, y: 50, w: 200, h: 150 }, 800, 600);
  assert.deepEqual(r, { x: 400, y: 100, w: 150, h: 200 });
});

// framePlacement (п.15): позиция рамки в координатах сцены с учётом смещения центрированного
// холста. Мутация: убрать offX/offY (вернуть баг «рамка липнет к левому краю») -> тест краснеет.
test('framePlacement: прибавляет смещение центрированного холста к координатам рамки', () => {
  // холст 300px шириной отцентрован в сцене 390px -> offX=45. Рамка внутри картинки на x=100.
  const p = framePlacement({ x: 100, y: 40, w: 120, h: 80 }, 0.5, 45, 12);
  assert.equal(p.left, 45 + 50);   // offX + crop.x*scale = 45 + 50 = 95
  assert.equal(p.top, 12 + 20);    // offY + crop.y*scale = 12 + 20 = 32
  assert.equal(p.width, 60);       // crop.w*scale
  assert.equal(p.height, 40);      // crop.h*scale
});
test('framePlacement: правый край рамки достаёт до правого края картинки', () => {
  // картинка 600px, холст отцентрован offX=45, масштаб 0.5 -> холст 300px, правый край сцены-холста
  // = 45 + 300 = 345. Полная рамка (x=0,w=600) должна дать left=45, right=45+300=345.
  const p = framePlacement({ x: 0, y: 0, w: 600, h: 400 }, 0.5, 45, 0);
  assert.equal(p.left, 45);
  assert.equal(p.left + p.width, 345);
});
test('framePlacement: без смещения (offX=offY=0) - чистое масштабирование', () => {
  const p = framePlacement({ x: 100, y: 100, w: 200, h: 150 }, 0.5);
  assert.equal(p.left, 50); assert.equal(p.top, 50);
  assert.equal(p.width, 100); assert.equal(p.height, 75);
});

test('cropCanvasPlan: вырезает рамку и вписывает в maxDim (без апскейла)', () => {
  const p = cropCanvasPlan({ x: 100, y: 100, w: 400, h: 300 }, 800, 600, 200);
  assert.equal(p.sx, 100); assert.equal(p.sy, 100);
  assert.equal(p.sw, 400); assert.equal(p.sh, 300);
  // 400x300 уменьшается до 200 по большей стороне: 200x150
  assert.equal(p.canvasW, 200); assert.equal(p.canvasH, 150);
  assert.equal(p.dw, 200); assert.equal(p.dh, 150);
  // без maxDim - размер рамки как есть
  const q = cropCanvasPlan({ x: 0, y: 0, w: 300, h: 200 }, 800, 600, 0);
  assert.equal(q.canvasW, 300); assert.equal(q.canvasH, 200);
});

// rotateCropCCW (1.2.22): поворот ВЛЕВО (против часовой). Зеркало CW: 4×CCW = исходное,
// CW затем CCW = исходное, рамка всегда внутри повёрнутой картинки. Мутация: подменить формулу
// (например y' = imgH - (x+w) вместо imgW - (x+w), или вернуть CW-формулу) -> тесты краснеют.
const IMG_W = 800, IMG_H = 600;
const RECTS = [
  { x: 0, y: 0, w: 800, h: 600 },       // полная
  { x: 100, y: 50, w: 200, h: 150 },    // внутри
  { x: 560, y: 400, w: 240, h: 200 },   // у правого-нижнего края
  { x: 0, y: 330, w: 24, h: 270 },      // узкая у левого края
];
const inside = (r, W, H) => r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= W && r.y + r.h <= H;

test('rotateCropCCW: точка (x,y) → (y, imgW-(x+w)); w,h меняются местами', () => {
  // 800x600, рамка {x:100,y:50,w:200,h:150}: x'=50, y'=800-(100+200)=500, w'=150, h'=200
  assert.deepEqual(rotateCropCCW({ x: 100, y: 50, w: 200, h: 150 }, 800, 600), { x: 50, y: 500, w: 150, h: 200 });
});
test('rotateCropCCW: полная рамка остаётся полной', () => {
  assert.deepEqual(rotateCropCCW(defaultCrop(800, 600), 800, 600), { x: 0, y: 0, w: 600, h: 800 });
});
test('rotateCropCCW: 4 поворота влево = исходная рамка', () => {
  for (const r0 of RECTS) {
    let r = r0, W = IMG_W, H = IMG_H;
    for (let k = 0; k < 4; k++) { r = rotateCropCCW(r, W, H); [W, H] = [H, W]; }
    assert.deepEqual(r, r0);
  }
});
test('rotateCropCW затем rotateCropCCW (и наоборот) = исходная рамка', () => {
  for (const r0 of RECTS) {
    const a = rotateCropCW(r0, IMG_W, IMG_H);                 // картинка стала 600x800
    assert.deepEqual(rotateCropCCW(a, IMG_H, IMG_W), r0);
    const b = rotateCropCCW(r0, IMG_W, IMG_H);
    assert.deepEqual(rotateCropCW(b, IMG_H, IMG_W), r0);
  }
});
test('rotateCropCCW: рамка остаётся в пределах повёрнутой картинки (на каждом шаге)', () => {
  for (const r0 of RECTS) {
    let r = r0, W = IMG_W, H = IMG_H;
    for (let k = 0; k < 4; k++) {
      r = rotateCropCCW(r, W, H); [W, H] = [H, W];
      assert.ok(inside(r, W, H), `рамка ${JSON.stringify(r)} вне ${W}x${H}`);
    }
  }
});
test('rotateCropCCW ≠ rotateCropCW для несимметричной рамки (кнопки не дублируют друг друга)', () => {
  const r0 = { x: 100, y: 50, w: 200, h: 150 };
  assert.notDeepEqual(rotateCropCCW(r0, IMG_W, IMG_H), rotateCropCW(r0, IMG_W, IMG_H));
});
