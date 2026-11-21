import {test} from 'node:test';
import assert from 'node:assert/strict';
const U=await import('../www/js/trash-ui.js');
const R=await import('../www/js/document-reminders-ui.js');
class Element extends EventTarget {
  constructor(tag){super();this.tagName=tag;this.children=[];this.parentNode=null;this.disabled=false;this.textContent='';}
  appendChild(e){this.children.push(e);e.parentNode=this;return e;}
  append(...es){es.forEach(e=>this.appendChild(e));}
  replaceChildren(...es){this.children.forEach(e=>e.parentNode=null);this.children=[];this.append(...es);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(e=>e!==this);this.parentNode=null;}}
  setAttribute(){} focus(){} get isConnected(){return this===document.body || !!this.parentNode?.isConnected;}
  get all(){return [this,...this.children.flatMap(e=>e.all)];}
}
function setup(){globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{createElement:t=>new Element(t),body:new Element('body'),activeElement:null});const state={vault:{sections:{documents:[{id:'a',title:'Doc',expiry:'19.12.2026'}]}}};return {state,saveFile:async()=>{},toast:()=>{},dlgConfirm:async()=>true,refresh:()=>{}};}
const button=t=>document.body.all.find(e=>e.tagName==='button' && e.textContent===t);
test('trash modal disposes on lock while failed save retains restored entry',async()=>{
 assert.equal(typeof U.openTrash,'function');const d=setup();const T=await import('../www/js/trash.js');T.moveToTrash(d.state.vault,'documents','a');const before=structuredClone(d.state.vault);
 let fail;d.saveFile=()=>new Promise((_,reject)=>{fail=reject;});U.initTrashUI(d);U.openTrash();const promise=button('Восстановить').onclick();await Promise.resolve();window.dispatchEvent(new Event('seyf:locking'));assert.equal(document.body.children.length,0);fail(Error('disk'));await promise;assert.equal(d.state.vault.sections.documents.length,1);assert.equal(d.state.vault.trash.records.length,0);assert.equal(document.body.children.length,0);
});
test('reminder opt-in waits for permission and cannot mutate a replaced vault',async()=>{
 assert.equal(typeof R.openDocumentReminders,'function');const d=setup();let grant;d.requestDocumentReminderPermission=()=>new Promise(r=>grant=r);d.syncDocumentReminders=async()=>{};R.initDocumentRemindersUI(d);R.openDocumentReminders();const original=d.state.vault;const p=button('Включить уведомления').onclick();window.dispatchEvent(new Event('seyf:locking'));d.state.vault={sections:{documents:[]}};grant(true);await p;assert.equal(original.preferences,undefined);assert.equal(document.body.children.length,0);
});
test('reminder banner uses calendar expiry, failed dismissal remains visible and lock removes it',async()=>{
 assert.equal(typeof R.showDocumentReminders,'function');const d=setup();d.saveFile=async()=>false;R.initDocumentRemindersUI(d);R.showDocumentReminders(document.body,new Date(2026,10,19,12).getTime());await button('Скрыть на сегодня').onclick();assert.ok(d.state.vault.preferences.documentReminderDismissed);assert.ok(button('Скрыть на сегодня'));window.dispatchEvent(new Event('seyf:locking'));assert.equal(document.body.children.length,0);
});
test('native opt-in persists before syncing generic timestamps; native failure keeps saved preference',async()=>{
 const d=setup();const calls=[];d.requestDocumentReminderPermission=async()=>true;
 d.saveFile=async()=>{calls.push('save');};d.syncDocumentReminders=async ts=>{calls.push(ts);throw Error('native');};
 R.initDocumentRemindersUI(d);R.openDocumentReminders();await button('Включить уведомления').onclick();
 assert.equal(d.state.vault.preferences.documentReminders,true);assert.equal(calls[0],'save');assert.ok(Array.isArray(calls[1]));assert.ok(calls[1].every(Number.isFinite));assert.ok(button('Выключить уведомления'));
 window.dispatchEvent(new Event('seyf:locking'));
});
test('purge confirmation resolving after lock cannot remove a record',async()=>{
 const d=setup(),T=await import('../www/js/trash.js');T.moveToTrash(d.state.vault,'documents','a');let confirm;d.dlgConfirm=()=>new Promise(r=>confirm=r);
 U.initTrashUI(d);U.openTrash();const p=button('Удалить навсегда').onclick();window.dispatchEvent(new Event('seyf:locking'));confirm(true);await p;assert.equal(d.state.vault.trash.records.length,1);
});
test('unlock pruning retains deletion on save failure for parent retry',async()=>{
 const d=setup(),T=await import('../www/js/trash.js');T.moveToTrash(d.state.vault,'documents','a',0);U.initTrashUI(d);d.saveFile=async()=>false;
 await assert.rejects(U.pruneTrashOnUnlock(30*86400000));assert.equal(d.state.vault.trash.records.length,0);
 d.saveFile=async()=>{};assert.equal(await U.pruneTrashOnUnlock(30*86400000),0);assert.equal(d.state.vault.trash.records.length,0);
});
test('trash uses schema labels without exposing secret fields and provides native-back close hook',()=>{
 const d=setup();d.schema={passwords:[{key:'description',type:'text'}],documents:[{key:'password',type:'secret'}]};
 assert.equal(U.entryLabel(d,'passwords',{description:'Mail',password:'secret'}),'Mail');
 assert.equal(U.entryLabel(d,'documents',{password:'secret',description:'Passport'}),'Passport');
 assert.equal(U.entryLabel(d,'documents',{password:'secret'}),'Запись');
 U.initTrashUI(d);U.openTrash();assert.match(button('Закрыть').className,/modal-close/);window.dispatchEvent(new Event('seyf:locking'));
});
