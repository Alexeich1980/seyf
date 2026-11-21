import test from 'node:test';
import assert from 'node:assert/strict';
import {straightenPlan,straightenAngle,cropSourceDims} from '../www/js/crop.js';
test('angle bounds, precision and invalid input',()=>{
 for(const [a,b] of [[100,10],[-100,-10],[2.26,2.3],[NaN,0],[Infinity,0]]) assert.equal(straightenAngle(a),b);
});
test('all viewport corners inverse-map inside source at every angle and orientation',()=>{
 for(const [w,h] of [[800,600],[600,800],[4000,100],[1,4000],[4000,4000]])
 for(let q=0;q<4;q++) for(let a=-10;a<=10;a+=.1){
  const p=straightenPlan(w,h,q,a),c=Math.cos(p.radians),s=Math.sin(p.radians);
  for(const x of [-p.w/2,p.w/2])for(const y of [-p.h/2,p.h/2]){
   assert.ok(Math.abs((c*x+s*y)/p.zoom)<=w/2+1e-8);
   assert.ok(Math.abs((-s*x+c*y)/p.zoom)<=h/2+1e-8);
  }
 }
});
test('zero preserves size, full turns restore exact transform, source stays bounded',()=>{
 assert.deepEqual(straightenPlan(800,600,4,0),{w:800,h:600,radians:0,zoom:1});
 assert.deepEqual(straightenPlan(800,600,-1,0),straightenPlan(800,600,3,0));
 assert.deepEqual(cropSourceDims(20000,10000,2000),{w:4000,h:2000});
});
