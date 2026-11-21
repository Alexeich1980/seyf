import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../www/js/crypto.js';
import { createLoyaltyDrafts } from '../www/js/loyalty-drafts.js';

const fixture = () => ({ id:'draft-1', entryId:null, baseUpdatedAt:null, data:{description:'PRIVATE SHOP', number:'00123', images:[{side:'front',mime:'image/png',data:'PRIVATE PHOTO'}]} });
function setup(saveFile = async()=>{}) { const state={vault:{sections:{loyalty:[]}},demoMode:false}; return {state,api:createLoyaltyDrafts({state,saveFile})}; }
test('draft survives actual encrypted vault roundtrip and uses same stable id',async()=>{
  const file=await C.newVaultFile('Synthetic-password-134!',{sections:{loyalty:[]}});
  const unlocked=await C.unlockWithPassword(file,'Synthetic-password-134!');
  const state={vault:unlocked.vault,dek:unlocked.dek};let persisted;
  const api=createLoyaltyDrafts({state,saveFile:async()=>{persisted=await C.reencryptData(file,state.dek,state.vault);}});
  api.write(state.vault,fixture()); await api.flush(state.vault);
  assert.ok(!JSON.stringify(persisted).includes('PRIVATE'));
  const resumed=await C.unlockWithPassword({...file,data:persisted.data},'Synthetic-password-134!');
  state.vault=resumed.vault;assert.deepEqual(api.read(),fixture());api.destroy();
});
test('read and write isolate mutable form objects',()=>{const {api,state}=setup();const f=fixture();api.write(state.vault,f);f.data.number='changed';const read=api.read();assert.equal(read.data.number,'00123');read.data.images.length=0;assert.equal(api.read().data.images.length,1);api.destroy();});
test('foreign, locked and demo writes do not reach persistence',async()=>{let n=0;const {api,state}=setup(async()=>n++);const old=state.vault;state.vault={sections:{loyalty:[]}};assert.equal(api.write(old,fixture()),false);await api.flush(old);state.demoMode=true;assert.equal(api.write(state.vault,fixture()),false);state.vault=null;assert.equal(api.write(null,fixture()),false);assert.equal(n,0);api.destroy();});
test('lock flush invokes save synchronously before drain, debounced timer cannot duplicate it',async()=>{let n=0;const {api,state}=setup(async()=>n++);api.write(state.vault,fixture());const pending=api.flush(state.vault);assert.equal(n,1);await pending;await new Promise(r=>setTimeout(r,300));assert.equal(n,1);api.destroy();});
test('failed save preserves draft and can be retried',async()=>{let fail=true;const {api,state}=setup(async()=>{if(fail)throw Error('disk');});api.write(state.vault,fixture());await assert.rejects(api.flush(state.vault),/disk/);assert.equal(api.read().data.number,'00123');fail=false;await api.flush(state.vault);api.destroy();});
test('clear only matching draft; persist deletion and tolerate old vault without draft',async()=>{let last;const {api,state}=setup(async()=>last=structuredClone(state.vault));assert.equal(api.read(),null);api.write(state.vault,fixture());assert.equal(api.remove(state.vault,'other'),false);assert.ok(api.read());assert.equal(api.remove(state.vault,'draft-1'),true);await api.flush(state.vault);assert.equal(api.read(),null);assert.equal(last.loyaltyDraft,undefined);api.destroy();});
test('delayed save never writes to newly opened vault',async()=>{let n=0;const {api,state}=setup(async()=>n++);api.write(state.vault,fixture());state.vault={sections:{loyalty:[]}};await new Promise(r=>setTimeout(r,300));assert.equal(n,0);assert.equal(api.read(),null);api.destroy();});
test('malformed imported draft is not a usable draft',()=>{const {api,state}=setup();for(const value of [null,[],{}, {id:'x',data:null},{id:'x',data:[]}]){state.vault.loyaltyDraft=value;assert.equal(api.read(),null);}api.destroy();});
test('invalid imported draft fields cannot crash editor after successful unlock',()=>{const {api,state}=setup();for(const data of [{images:{}},{images:[null]},{images:[{mime:'text/html',data:'x',side:'front'}]},{number:{}},{description:['bad']},{images:[{mime:'image/png',data:'x',side:'wrong'}]}]){state.vault.loyaltyDraft={id:'bad',data};assert.equal(api.read(),null);}api.destroy();});
