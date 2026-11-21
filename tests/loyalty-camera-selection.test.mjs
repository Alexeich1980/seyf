import test from 'node:test';
import assert from 'node:assert/strict';
import {startBarcodeScan} from '../www/js/loyalty.js';
const flush=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const dev=(id,label)=>({kind:'videoinput',deviceId:id,label});
const tele=dev('opaque-A','camera 4, facing back'),main=dev('opaque-Z','camera 0, facing back'),front=dev('opaque-F','camera 1, facing front');
function rig(t,{devices=[tele,front,main],enumerate,acquire,deviceId}={}){
 let active=true,enumerations=0,playing=0,open=0;
 const streams=[],calls=[],events=[],errors=[],changes=[];
 const makeStream=id=>{
  open++;assert.equal(open,1,'never acquire two live cameras');let stopped=false;
  const track={readyState:'live',getSettings:()=>({deviceId:id,focusMode:'continuous'}),getCapabilities:()=>({focusMode:['continuous'],torch:true}),
   applyConstraints:async c=>changes.push({id,c}),stop(){assert.equal(stopped,false,'stop once');stopped=true;open--;events.push('stop:'+id);}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};streams.push(stream);return stream;
 };
 const video={srcObject:null,play:async()=>{playing++;}},canvas={width:0,height:0};
 const stop=startBarcodeScan(video,canvas,{deviceId,isActive:()=>active,onCamera:c=>calls.push(c),onError:e=>errors.push(e),mediaDevices:{
  enumerateDevices:()=>{enumerations++;return enumerate?enumerate(enumerations):Promise.resolve(devices);},
  getUserMedia:c=>{events.push(c.video.deviceId?.exact||'default');return acquire?acquire(c,makeStream):Promise.resolve(makeStream(c.video.deviceId?.exact||tele.deviceId));}
 }});
 t.after(stop);return {stop,video,canvas,calls,events,errors,changes,streams,makeStream,lock(){active=false;},get playing(){return playing;},get open(){return open;},get enumerations(){return enumerations;}};
}
for(const devices of [[tele,front,main],[main,front,tele]])test('main Android label wins independent of enumeration order '+devices[0].deviceId,async t=>{
 const r=rig(t,{devices});await flush();assert.equal(r.events[0],main.deviceId);assert.equal(r.calls[0].cameraId,main.deviceId);assert.deepEqual(r.calls[0].cameras,[{deviceId:main.deviceId,label:main.label},{deviceId:tele.deviceId,label:tele.label}]);
});
test('explicit primary rear outranks tele macro and arbitrary numeric device IDs',async t=>{
 const d=[dev('0','Rear telephoto'),dev('1','Back macro'),dev('999','Primary back camera')];const r=rig(t,{devices:d});await flush();assert.equal(r.calls[0].cameraId,'999');
});
test('caller preferred ID overrides auto ranking; controls belong to that stream',async t=>{
 const r=rig(t,{deviceId:tele.deviceId});await flush();assert.equal(r.events[0],tele.deviceId);assert.equal(r.calls[0].cameraId,tele.deviceId);await r.calls[0].setTorch(true);assert.ok(r.changes.every(c=>c.id===tele.deviceId));
});
test('labels exposed after permission: release tele before opening main; only final status',async t=>{
 const r=rig(t,{enumerate:n=>Promise.resolve(n===1?[dev('','')]:[tele,main,front])});await flush();
 assert.deepEqual(r.events,['default','stop:'+tele.deviceId,main.deviceId]);assert.equal(r.playing,1);assert.ok(r.calls.every(c=>c.cameraId===main.deviceId));assert.ok(r.changes.every(c=>c.id===main.deviceId));
});
for(const enumerate of [()=>Promise.resolve([dev('a',''),dev('b','')]),()=>Promise.reject(Error('blocked'))])test('missing labels or rejected enumeration keep platform default without cycling',async t=>{
 const r=rig(t,{enumerate});await flush();assert.deepEqual(r.events,['default']);assert.deepEqual(r.calls[0].cameras,[]);assert.equal(r.errors.length,0);
});
test('only front camera is usable when no other device exists',async t=>{const r=rig(t,{devices:[front]});await flush();assert.equal(r.calls[0].cameraId,front.deviceId);assert.equal(r.calls[0].cameras.length,1);});
for(const name of ['NotFoundError','OverconstrainedError'])test('vanished preferred '+name+' falls back once and removes stale choice',async t=>{
 const r=rig(t,{deviceId:main.deviceId,acquire:(c,make)=>c.video.deviceId?Promise.reject(Object.assign(Error(),{name})):Promise.resolve(make(tele.deviceId))});await flush();
 assert.deepEqual(r.events,[main.deviceId,'default']);assert.equal(r.calls[0].cameraId,tele.deviceId);assert.ok(!r.calls[0].cameras.some(c=>c.deviceId===main.deviceId));
});
for(const name of ['NotAllowedError','SecurityError','NotReadableError'])test('selected camera '+name+' is not retried',async t=>{
 const r=rig(t,{deviceId:main.deviceId,acquire:()=>Promise.reject(Object.assign(Error(),{name}))});await flush();assert.deepEqual(r.events,[main.deviceId]);assert.equal(r.errors.length,1);
});
test('fallback failure ends once without further acquisition',async t=>{
 const r=rig(t,{deviceId:main.deviceId,acquire:()=>Promise.reject(Object.assign(Error(),{name:'NotFoundError'}))});await flush();assert.deepEqual(r.events,[main.deviceId,'default']);assert.equal(r.errors.length,1);
});
for(const lock of [false,true])test('stale initial enumeration after '+(lock?'lock':'stop')+' never acquires or mutates',async t=>{
 const d=deferred(),r=rig(t,{enumerate:()=>d.promise});await flush();lock?r.lock():r.stop();const newer={};r.video.srcObject=newer;r.canvas.width=91;d.resolve([main]);await flush();assert.deepEqual(r.events,[]);assert.equal(r.video.srcObject,newer);assert.equal(r.canvas.width,91);assert.equal(r.calls.length,0);
});
test('lock during post-permission enumeration releases initial stream and never reopens',async t=>{
 const d=deferred(),r=rig(t,{enumerate:n=>n===1?Promise.resolve([]):d.promise});await flush();r.lock();await new Promise(r=>setTimeout(r,230));assert.equal(r.open,0);d.resolve([main]);await flush();assert.deepEqual(r.events,['default','stop:'+tele.deviceId]);assert.equal(r.calls.length,0);
});
test('late replacement stream after stop cannot alter new scanner',async t=>{
 const d=deferred();let make;
 const r=rig(t,{enumerate:n=>Promise.resolve(n===1?[]:[main,tele]),acquire:(c,m)=>{make=m;return c.video.deviceId?d.promise:Promise.resolve(m(tele.deviceId));}});await flush();r.stop();const newer={};r.video.srcObject=newer;r.canvas.width=72;d.resolve(make(main.deviceId));await flush();assert.equal(r.open,0);assert.equal(r.video.srcObject,newer);assert.equal(r.canvas.width,72);assert.equal(r.calls.length,0);
});
test('post-permission auto selected device disappears: default fallback is bounded',async t=>{
 const r=rig(t,{enumerate:n=>Promise.resolve(n===1?[]:[main,tele]),acquire:(c,m)=>c.video.deviceId?Promise.reject(Object.assign(Error(),{name:'NotFoundError'})):Promise.resolve(m(tele.deviceId))});await flush();assert.deepEqual(r.events,['default','stop:'+tele.deviceId,main.deviceId,'default']);assert.equal(r.calls[0].cameraId,tele.deviceId);
});
test('old controls after UI restart cannot affect new scanner',async t=>{
 const first=rig(t);await flush();const controls=first.calls[0];first.stop();const next=rig(t,{deviceId:tele.deviceId});await flush();const count=first.changes.length;assert.equal(await controls.setTorch(true),false);assert.equal(first.changes.length,count);assert.equal(next.calls[0].cameraId,tele.deviceId);
});

test('single anonymous device does not invent identity or override environment',async t=>{
 const r=rig(t,{devices:[dev('unknown','')]});await flush();assert.deepEqual(r.events,['default']);assert.deepEqual(r.calls[0].cameras,[]);
});
test('stop between acquisition return and adoption releases acquired stream',async t=>{
 let stop;const r=rig(t,{deviceId:main.deviceId,acquire:(c,make)=>{
  const acquired=make(main.deviceId);queueMicrotask(()=>queueMicrotask(()=>stop()));return Promise.resolve(acquired);
 }});stop=r.stop;await flush();assert.equal(r.open,0);assert.equal(r.playing,0);assert.equal(r.calls.length,0);
});
