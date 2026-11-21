import { test } from 'node:test';
import assert from 'node:assert/strict';
const T = await import('../www/js/trash.js');
const R = await import('../www/js/document-reminders.js');
const now = new Date(2026, 10, 19, 12).getTime();
const make = () => ({sections:{documents:[{id:'a',title:'Passport',expiry:'19.12.2026',pages:[{id:'p',data:'secret'}]}],notes:[]}});
test('trash retains attachment bytes and restores without overwriting a colliding ID', () => {
  assert.equal(typeof T.moveToTrash, 'function');
  const v=make(), original=structuredClone(v.sections.documents[0]);
  const r=T.moveToTrash(v,'documents','a',now);
  assert.deepEqual(r.entry,original); assert.equal(v.sections.documents.length,0);
  v.sections.documents.push({id:'a',title:'Other'});
  const restored=T.restoreFromTrash(v,r.trashId);
  assert.notEqual(restored.id,'a'); assert.deepEqual(restored.pages,original.pages);
  assert.equal(v.sections.documents[0].title,'Other'); assert.equal(v.trash.records.length,0);
});
test('pruning expires at exactly 30 days; future records survive; purge is explicit', () => {
  assert.equal(typeof T.pruneTrash,'function');
  const v=make(), r=T.moveToTrash(v,'documents','a',now);
  assert.equal(T.pruneTrash(v,now+30*86400000-1),0);
  assert.equal(T.pruneTrash(v,now-1),0);
  assert.equal(T.pruneTrash(v,now+30*86400000),1);
  assert.equal(T.purgeTrash(v,r.trashId),false);
});
test('invalid and unknown-version trash is preserved, never silently dropped', () => {
  assert.equal(typeof T.ensureTrash,'function');
  for (const trash of [{version:2,records:[]},{version:1,records:[{}]}]) {
    const v={...make(),trash}, before=structuredClone(v);
    assert.throws(()=>T.ensureTrash(v)); assert.deepEqual(v,before);
  }
});
test('mutation exceptions roll back but save failure retains edits for the serial saver', async () => {
 const v=make(),before=structuredClone(v);
 await assert.rejects(T.withVaultTransaction(v,()=>{T.moveToTrash(v,'documents','a',now);throw Error('mutation');},async()=>{}));
 assert.deepEqual(v,before);
 await assert.rejects(T.withVaultTransaction(v,()=>T.moveToTrash(v,'documents','a',now),async()=>false));
 assert.equal(v.sections.documents.length,0);assert.equal(v.trash.records.length,1);
});
test('expiry collection includes expired/today/day30, excludes day31 and missing dates, leaves vault untouched', () => {
  assert.equal(typeof R.collectDocumentExpiry,'function');
  const v=make(); v.sections.documents=[...['18.11.2026','19.11.2026','19.12.2026','20.12.2026','','31.02.2026','2026-02-31'].map((expiry,i)=>({id:String(i),expiry}))];
  const before=structuredClone(v), items=R.collectDocumentExpiry(v,now);
  assert.deepEqual(items.map(x=>[x.id,x.status,x.daysLeft]),[['0','expired',-1],['1','soon',0],['2','soon',30]]);
  assert.deepEqual(v,before);
});
test('native times require opt-in, are future unique sorted and capped at 64', () => {
  assert.equal(typeof R.documentReminderTimes,'function');
  const v=make(); assert.deepEqual(R.documentReminderTimes(v,now),[]);
  v.preferences={documentReminders:true};
  assert.deepEqual(R.documentReminderTimes(v,now),[new Date(2026,11,12).getTime(),new Date(2026,11,20).getTime()]);
  v.sections.documents=Array.from({length:100},(_,i)=>({id:String(i),expiry:`${String(i%28+1).padStart(2,'0')}.${String(1+Math.floor(i/28)).padStart(2,'0')}.2027`}));
  const ts=R.documentReminderTimes(v,now); assert.equal(ts.length,64); assert.deepEqual(ts,[...new Set(ts)].sort((a,b)=>a-b)); assert.ok(ts.every(t=>t>now));
});
test('dismissal is encrypted, day-bound and resurfaces for changed expiry', () => {
  assert.equal(typeof R.dismissDocumentReminders,'function');
  const v=make(); R.dismissDocumentReminders(v,now);
  assert.deepEqual(R.collectDocumentReminders(v,now),[]);
  v.sections.documents[0].expiry='18.12.2026'; assert.equal(R.collectDocumentReminders(v,now).length,1);
  assert.equal(R.collectDocumentReminders(v,now+86400000).length,1);
});
test('trash and reminder preferences survive actual AES-GCM encryption and reload',async()=>{
 const {importDEK,randomBytes,encryptJSON,decryptJSON}=await import('../www/js/crypto.js');
 const v=make();const r=T.moveToTrash(v,'documents','a',now);R.setDocumentRemindersEnabled(v,true);
 const key=await importDEK(randomBytes(32)), encrypted=await encryptJSON(key,v);
 const back=await decryptJSON(key,encrypted.iv,encrypted.ct);
 assert.equal(back.preferences.documentReminders,true);
 assert.deepEqual(T.restoreFromTrash(back,r.trashId).pages,[{id:'p',data:'secret'}]);
});
test('invalid move is inert and successful explicit purge removes only its target',()=>{
 const v=make(),before=structuredClone(v); assert.equal(T.moveToTrash(v,'documents','missing',now),null);assert.deepEqual(v,before);
 assert.throws(()=>T.moveToTrash(v,'__proto__','a',now));assert.deepEqual(v,before);
 const r=T.moveToTrash(v,'documents','a',now);assert.equal(T.purgeTrash(v,r.trashId),true);assert.equal(v.trash.records.length,0);
});
test('overlapping transactions reject before mutation while the first save remains pending',async()=>{
 const v=make();let finish;const first=T.withVaultTransaction(v,()=>T.moveToTrash(v,'documents','a',now),()=>new Promise(r=>finish=r));
 await assert.rejects(T.withVaultTransaction(v,()=>{v.bad=true;},async()=>{}),/progress/);
 assert.equal(v.bad,undefined);finish();await first;assert.equal(v.trash.records.length,1);
});
test('save timeout retains mutation until the real serial saver writes the same state',async()=>{
 const {makeSerialSaver}=await import('../www/js/persist.js');
 const v=make();let release,disk;
 const saver=makeSerialSaver(async()=>{const snapshot=structuredClone(v);await new Promise(r=>release=r);disk=snapshot;},{timeoutMs:5,watchdogMs:0});
 await assert.rejects(T.withVaultTransaction(v,()=>T.moveToTrash(v,'documents','a',now),saver));
 assert.equal(v.sections.documents.length,0);assert.equal(v.trash.records.length,1);
 release();await saver.settled();assert.deepEqual(disk,v);
});
