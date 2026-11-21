import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCard, barcodePixels, decodeBarcode, validateBarcode, listCards, startBarcodeScan } from '../www/js/loyalty.js';
const samples = [['EAN13', '4601234567893'], ['EAN8', '96385074'], ['UPC', '036000291452'], ['CODE128', 'CARD-0012345'], ['QR', 'Карта 000123 / loyalty']];
for (const [type, value] of samples) test(`${type}: real encoded pixels decode back to original`, () => {
  const p = barcodePixels(type, value), data = new Uint8ClampedArray(p.width * p.height * 4);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) { const i = (y * p.width + x) * 4; data.fill(p.black(x,y) ? 0 : 255, i, i+3); data[i+3] = 255; }
  const result = decodeBarcode({ data, width: p.width, height: p.height });
  assert.deepEqual(result, { barcodeType: type, barcodeValue: value });
});
test('manual number stays a number, including leading zeroes', () => {
  const c = makeCard({ description: ' Shop ', number: '00001234' });
  assert.equal(c.description, 'Shop'); assert.equal(c.barcodeType, ''); assert.equal(c.barcodeValue, ''); assert.equal(c.number, '00001234');
  assert.ok(c.id); assert.equal(c.createdAt, c.updatedAt);
  const edit = makeCard({ ...c, note: 'n' }, c, 'later'); assert.equal(edit.id, c.id); assert.equal(edit.createdAt, c.createdAt); assert.equal(edit.updatedAt, 'later');
});
test('invalid checksum, ambiguous format and unsupported content rejected', () => {
  assert.throws(() => validateBarcode('EAN13', '4601234567894'));
  assert.throws(() => validateBarcode('UPC', '123'));
  assert.throws(() => validateBarcode('', '123'));
  assert.throws(() => validateBarcode('AUTO', '123'));
  assert.throws(() => validateBarcode('CODE128', 'Карта'));
  assert.throws(() => makeCard({ description: 'x' }));
});
test('photo sides and favorite ordering; source array untouched', () => {
  const photo = { id: 'p', side: 'front', mime: 'image/png', data: 'abc' };
  const c = makeCard({ description: 'Photo only', images: [photo] }); assert.notEqual(c.images[0], photo);
  assert.throws(() => makeCard({ ...c, images: [photo, photo] }));
  assert.throws(() => makeCard({ ...c, images: [{ ...photo, mime: 'application/pdf' }] }));
  const rows = [{id:1,number:'001'}, {id:2,favorite:true}, {id:3,favorite:true}];
  assert.deepEqual(listCards(rows).map(x=>x.id), [2,3,1]); assert.equal(rows[0].id,1);
  assert.equal(listCards(rows,{query:'001'}).length,1);
});
test('camera permission resolving after close stops every track without playing', async () => {
  let resolve, stopped = 0, played = 0;
  const video = { srcObject: null, play: () => { played++; } }, canvas = {};
  const stop = startBarcodeScan(video, canvas, {mediaDevices: {getUserMedia: () => new Promise(r=>resolve=r)}});
  await Promise.resolve(); stop(); resolve({getTracks:()=>[{stop:()=>stopped++}]});
  await new Promise(r=>setTimeout(r,0)); assert.equal(stopped,1); assert.equal(played,0); assert.equal(video.srcObject,null);
});
