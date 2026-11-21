import test from 'node:test';
import assert from 'node:assert/strict';
import { startBarcodeScan, barcodePixels, decodeBarcode } from '../www/js/loyalty.js';
const flush = () => new Promise(r => setImmediate(r));
const delay = ms => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
function rig(t, { caps = {}, apply, play, getUserMedia, image, getViewAspect } = {}) {
  let stopped = 0, played = 0, active = true;
  const listeners = new Map(), calls = [], errors = [], results = [], cameras = [], requests = [];
  const state = {focusMode:'none',zoom:1,pointsOfInterest:[]};
  const track = { readyState:'live', stop(){ stopped++; }, getCapabilities:()=>caps, getSettings:()=>state,
    applyConstraints: async c => {calls.push(c); if (apply) await apply(c); Object.assign(state,c.advanced[0]);},
    addEventListener:(n,f)=>listeners.set(n,f), removeEventListener:(n,f)=>{if(listeners.get(n)===f) listeners.delete(n);} };
  const stream = {getTracks:()=>[track],getVideoTracks:()=>[track]};
  const video = {srcObject:null,videoWidth:image?.width || 0,videoHeight:image?.height || 0,readyState:2,
    play:()=>{played++;return play?.();}};
  let rotated = false;
  const draws = [];
  const ctx = {save(){rotated=false;},restore(){},translate(){},rotate(){rotated=true;},drawImage(...args){draws.push(args);},
    getImageData(x,y,width,height){
      const data = new Uint8ClampedArray(width*height*4).fill(255);
      if(image) {
        const [,sx,sy,sw,sh,,,dw,dh]=draws.at(-1);
        for(let y=0;y<dh;y++) for(let x=0;x<dw;x++) {
          const px=Math.min(image.width-1,Math.floor(sx+(x+.5)*sw/dw));
          const py=Math.min(image.height-1,Math.floor(sy+(y+.5)*sh/dh));
          const i=(py*image.width+px)*4, j=rotated ? (x*width+dh-1-y)*4 : (y*width+x)*4;
          data.set(image.data.subarray(i,i+4),j);
        }
      }
      return {data,width,height};
    }};
  const canvas = {width:0,height:0,getContext:()=>ctx};
  const stop = startBarcodeScan(video,canvas,{getViewAspect,isActive:()=>active,onCamera:c=>cameras.push(c),onError:e=>errors.push(e),onResult:r=>results.push(r),
    mediaDevices:{getUserMedia:c=>{requests.push(c);return getUserMedia ? getUserMedia(c,stream) : Promise.resolve(stream);}}});
  t.after(stop);
  return {stop,track,stream,video,canvas,calls,errors,results,cameras,requests,draws,listeners,
    lock(){active=false;},get stopped(){return stopped;},get played(){return played;}};
}
for(const caps of [{},{focusMode:['manual']},{focusMode:['single-shot']}]) test('unsupported continuous mode is not requested: '+JSON.stringify(caps),async t=>{
  const r=rig(t,{caps}); await flush(); assert.equal(r.calls.length,0); assert.equal(r.played,1);
  assert.equal(r.cameras[0].focusAvailable,!!caps.focusMode?.includes('single-shot')); assert.equal(r.cameras[0].zoom,null);
  assert.equal(await r.cameras[0].setTorch(true),false);
});
test('continuous focus applied after acquisition; rejection is nonfatal',async t=>{
  const r=rig(t,{caps:{focusMode:['continuous']},apply:()=>Promise.reject(new Error('unsupported firmware'))});
  await flush(); assert.equal(r.calls[0].advanced[0].focusMode,'continuous'); assert.equal(r.played,1); assert.equal(r.errors.length,0);
  assert.equal(r.cameras[0].focusAvailable,false); assert.equal(r.cameras.at(-1).focusMode,'none');
  assert.equal('advanced' in r.requests[0].video,false);
});
test('synchronous constraint throw is contained',async t=>{
  const r=rig(t,{caps:{focusMode:['continuous']}}); r.track.applyConstraints=()=>{throw Error('sync');};
  await flush(); assert.equal(r.errors.length,0); assert.equal(r.played,1);
});
test('missing/throwing capabilities are compatible',async t=>{
  const r=rig(t);r.track.getCapabilities=()=>{throw Error('old webview');};r.track.applyConstraints=undefined;
  await flush();assert.equal(r.played,1);assert.equal(r.cameras[0].focusAvailable,false);assert.equal(await r.cameras[0].focus(),false);
});
test('controls serialize, preserve state, clamp zoom and reject invalid taps',async t=>{
  const r=rig(t,{caps:{focusMode:['continuous','single-shot'],zoom:{min:1,max:3,step:.5},torch:true}});await flush();
  const c=r.cameras.at(-1);assert.equal(c.focusMode,'continuous'); assert.equal(c.focusAvailable,true);
  assert.equal(await c.focus(-1,0),false);assert.equal(await c.focus(NaN,0),false);
  assert.equal(await c.focus(.2,.8),true);assert.deepEqual(r.calls.at(-1).advanced[0].pointsOfInterest,[{x:.2,y:.8}]);
  const outcomes=await Promise.all([c.setZoom(9),c.setTorch(true)]);assert.deepEqual(outcomes,[true,true]);
  assert.deepEqual(r.calls.at(-1).advanced[0],{focusMode:'single-shot',pointsOfInterest:[{x:.2,y:.8}],zoom:3,torch:true});
  r.stop();const n=r.calls.length;assert.equal(await c.focus(),false);assert.equal(await c.setZoom(2),false);assert.equal(await c.setTorch(false),false);assert.equal(r.calls.length,n);
});
test('rejected UI constraint resolves false without error callback',async t=>{
  const r=rig(t,{caps:{focusMode:['single-shot']},apply:()=>{throw Error('rejected');}});await flush();
  assert.equal(await r.cameras[0].focus(),false);assert.equal(r.errors.length,0);
});
test('stop before microtask does not request camera',async t=>{
  const r=rig(t);r.stop();await flush();assert.equal(r.requests.length,0);
});
test('permission resolves after stop: tracks stop without UI mutation',async t=>{
  const d=deferred(),r=rig(t,{getUserMedia:()=>d.promise});await flush();r.stop();
  const newer={};r.video.srcObject=newer;r.canvas.width=91;r.canvas.height=92;
  d.resolve(r.stream);await flush();assert.equal(r.stopped,1);assert.equal(r.played,0);
  assert.equal(r.video.srcObject,newer);assert.equal(r.canvas.width,91);assert.equal(r.cameras.length,0);assert.equal(r.errors.length,0);
});
for(const rejection of [false,true]) test('pending play '+(rejection?'rejects':'resolves')+' after stop without clearing replacement',async t=>{
  const d=deferred(),r=rig(t,{play:()=>d.promise});await flush();r.stop();const newer={};r.video.srcObject=newer;r.canvas.width=99;
  rejection?d.reject(Error('late')):d.resolve();await flush();assert.equal(r.video.srcObject,newer);assert.equal(r.canvas.width,99);assert.equal(r.errors.length,0);assert.equal(r.stopped,1);
});
test('pending focus + queued torch + lock: release and no late callbacks/apply',async t=>{
  const d=deferred(),r=rig(t,{caps:{focusMode:['continuous'],torch:true},apply:()=>d.promise});await flush();
  const queued=r.cameras[0].setTorch(true),n=r.cameras.length;r.lock();await delay(230);
  assert.equal(r.stopped,1);const newer={};r.video.srcObject=newer;r.canvas.width=66;d.resolve();assert.equal(await queued,false);await flush();
  assert.equal(r.calls.length,1);assert.equal(r.cameras.length,n);assert.equal(r.video.srcObject,newer);assert.equal(r.canvas.width,66);
});
test('ended releases live stream once; stale ended callback cannot affect new UI',async t=>{
  const r=rig(t);await flush();const late=r.listeners.get('ended');late();assert.equal(r.errors.length,1);assert.equal(r.stopped,1);
  const newer={};r.video.srcObject=newer;r.canvas.width=72;late();r.stop();assert.equal(r.video.srcObject,newer);assert.equal(r.canvas.width,72);assert.equal(r.errors.length,1);
});
test('already ended track is rejected before preview',async t=>{
  const r=rig(t);r.track.readyState='ended';await flush();assert.equal(r.played,0);assert.equal(r.stopped,1);assert.equal(r.errors.length,1);
});
test('resolution rejection retries once, permission denial does not retry',async t=>{
  const r=rig(t,{getUserMedia:(c,s)=> c.video.width ? Promise.reject(Object.assign(Error(),{name:'OverconstrainedError'})) : Promise.resolve(s)});
  await flush();assert.equal(r.requests.length,2);assert.equal(r.played,1);assert.equal(r.requests[1].video.facingMode.ideal,'environment');
  const denied=rig(t,{getUserMedia:()=>Promise.reject(Object.assign(Error(),{name:'NotAllowedError'}))});await flush();assert.equal(denied.requests.length,1);assert.equal(denied.errors.length,1);
});
test('stop while resolution request rejects prevents compatibility retry',async t=>{
  const d=deferred(),r=rig(t,{getUserMedia:()=>d.promise});await flush();r.stop();d.reject(Object.assign(Error(),{name:'OverconstrainedError'}));await flush();assert.equal(r.requests.length,1);assert.equal(r.errors.length,0);
});
test('portrait frame bounded by longest side, not width',async t=>{
  const r=rig(t);r.video.videoWidth=1080;r.video.videoHeight=1920;await flush();assert.equal(r.canvas.width,900);assert.equal(r.canvas.height,1600);assert.equal(r.draws.length,1);
});
function pixels(type,value,vertical=false){
  const p=barcodePixels(type,value),width=vertical?p.height:p.width,height=vertical?p.width:p.height;
  const data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(p.black(vertical?y:x,vertical?p.height-1-x:y))data.fill(0,(y*width+x)*4,(y*width+x)*4+3);
  return {width,height,data};
}
test('real vertical CODE128 fails baseline decoder then scanner rotated pass reads exact value',async t=>{
  const image=pixels('CODE128','0001234567',true);assert.equal(decodeBarcode(image),null);
  const r=rig(t,{image});await flush();assert.equal(r.results.length,0);await delay(240);
  assert.deepEqual(r.results,[{barcodeType:'CODE128',barcodeValue:'0001234567'}]);assert.equal(r.stopped,1);assert.equal(r.video.srcObject,null);
});
test('horizontal real code returns once and frees pixels',async t=>{
  const r=rig(t,{image:pixels('EAN13','4601234567893')});await flush();assert.deepEqual(r.results,[{barcodeType:'EAN13',barcodeValue:'4601234567893'}]);assert.equal(r.canvas.width,0);assert.equal(r.stopped,1);
});

for(const [vw,vh,aspect,expected] of [
  [1920,1080,9/16,[656.25,0,607.5,1080,0,0,608,1080]],
  [1080,1920,16/9,[0,656.25,1080,607.5,0,0,1080,608]],
  [3840,2160,1,[840,0,2160,2160,0,0,1600,1600]],
  [1920,1080,16/9,[0,0,1920,1080,0,0,1600,900]]
]) test(`cover source crop ${vw}x${vh} into aspect ${aspect}`,async t=>{
  const r=rig(t,{getViewAspect:()=>aspect});r.video.videoWidth=vw;r.video.videoHeight=vh;
  await flush();assert.deepEqual(r.draws[0].slice(1),expected);assert.equal(r.errors.length,0);
});
for(const aspect of [undefined,null,0,-1,NaN,Infinity,'0.5']) test(`invalid view aspect ${String(aspect)} preserves full frame`,async t=>{
 const r=rig(t,{getViewAspect:()=>aspect});r.video.videoWidth=120;r.video.videoHeight=80;await flush();
 assert.deepEqual(r.draws[0].slice(1),[0,0,120,80,0,0,120,80]);
});
test('throwing view aspect falls back; changing view aspect is read each tick',async t=>{
 let aspect=()=>{throw Error('layout detached');};const r=rig(t,{getViewAspect:()=>aspect()});r.video.videoWidth=120;r.video.videoHeight=80;
 await flush();assert.deepEqual(r.draws[0].slice(1),[0,0,120,80,0,0,120,80]);
 aspect=()=>1;await delay(230);assert.deepEqual(r.draws[1].slice(1),[20,0,80,80,0,0,80,80]);assert.equal(r.errors.length,0);
});
function sceneWithCode(width,height,x,y) {
 const code=pixels('CODE128','0001234567'),data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let row=0;row<code.height;row++)data.set(code.data.subarray(row*code.width*4,(row+1)*code.width*4),((y+row)*width+x)*4);
 return {data,width,height};
}
test('cover excludes readable code outside visible portrait region through both rotations',async t=>{
 const image=sceneWithCode(1600,900,10,340);assert.equal(decodeBarcode(image)?.barcodeValue,'0001234567');
 const r=rig(t,{image,getViewAspect:()=>9/16});await flush();await delay(250);
 assert.ok(r.draws.length>=2);assert.deepEqual(r.results,[]);assert.equal(r.errors.length,0);
});
test('cover visible code still decodes exact value',async t=>{
 const r=rig(t,{image:sceneWithCode(1600,900,600,340),getViewAspect:()=>9/16});await flush();
 assert.deepEqual(r.results,[{barcodeType:'CODE128',barcodeValue:'0001234567'}]);
});
