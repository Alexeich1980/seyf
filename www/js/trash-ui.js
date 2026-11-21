import * as T from './trash.js';
import { FIELD_SCHEMA, SECTION_LABELS } from './ui.js';
let D, current;
export function entryLabel(deps, section, entry) {
  const field=(deps.schema || FIELD_SCHEMA)[section]?.[0];
  const forbidden=/password|secret|phrase|passphrase|pin|cvv|token|otp/i;
  const key=field && field.type!=='secret' && !forbidden.test(field.key) ? field.key : null;
  return String((key && entry[key]) || entry.description || entry.title || entry.name || 'Запись');
}
export function initTrashUI(deps) { current?.close(); D=deps; }
export const uiElement = (tag, text, className='') => { const e=document.createElement(tag); e.textContent=text; e.className=className; return e; };
export const uiButton = (text, action) => { const b=uiElement('button',text,'btn'); b.type='button'; b.onclick=action; return b; };
// Shared surface lifecycle. No sensitive HTML interpolation or persistent browser storage.
export function createVaultSurface(deps, title, container=null) {
  const original=deps.state.vault, previous=document.activeElement;
  let closed=false;
  const root=uiElement('div','',''+(container?'document-reminders-banner':'modal-back'));
  const panel=uiElement('div','',container?'backup-card-txt':'modal detail'); root.appendChild(panel);
  panel.setAttribute('role',container?'status':'dialog'); panel.setAttribute('aria-label',title);
  if (!container) panel.setAttribute('aria-modal','true');
  const head=uiElement('div','','detail-head'); head.appendChild(uiElement('span',title,'detail-title'));
  const body=uiElement('div','','detail-body');
  const alive=()=>!closed && root.isConnected && deps.state.vault===original;
  const close=()=>{ if(closed)return; closed=true;window.removeEventListener('seyf:locking',onLock);document.removeEventListener('keydown',onKey,true);root.remove();if(previous?.isConnected)previous.focus(); };
  const onLock=()=>close();
  const onKey=e=>{
    if(!alive() || (deps.isTopModal && !deps.isTopModal(root)))return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}
    if(e.key==='Tab' && !container){
      const controls=[...panel.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled && !el.hidden && el.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(!first){e.preventDefault();panel.focus();}
      else if(e.shiftKey && (document.activeElement===first || document.activeElement===panel)){e.preventDefault();last.focus();}
      else if(!e.shiftKey && (document.activeElement===last || document.activeElement===panel)){e.preventDefault();first.focus();}
    }
  };
  if(!container){const closeButton=uiButton('Закрыть',close);closeButton.className+=' modal-close';head.appendChild(closeButton);}panel.append(head,body);
  (container||document.body).appendChild(root);
  window.addEventListener('seyf:locking',onLock);if(!container)document.addEventListener('keydown',onKey,true);
  if(!container){panel.tabIndex=-1;panel.focus();}
  let busy=false;
  async function mutate(fn) {
    if(busy || !alive())return false;busy=true;
    try { await T.withVaultTransaction(original,fn,()=>{if(!alive())throw Error('Vault closed');return deps.saveFile();});return true; }
    catch(e){if(alive())deps.toast?.('Изменения ещё не записаны на устройство. '+(deps.saveErrorLabel?.(e)||'Попробуйте ещё раз.'));return false;}
    finally {busy=false;}
  }
  return {root,body,close,alive,mutate,vault:original};
}
export function openTrash() {
  if(!D)throw Error('Call initTrashUI first');
  if(D.requireRealVault && !D.requireRealVault(()=>openTrash()))return null;
  current?.close(); const deps=D, s=createVaultSurface(deps,'Корзина');current=s;
  function render(){
    if(!s.alive())return;s.body.replaceChildren();
    s.body.appendChild(uiElement('p','Записи хранятся 30 дней. Затем они удаляются при входе в сейф.','arc-intro'));
    const records=s.vault.trash?.records || [];
    if(!records.length)s.body.appendChild(uiElement('p','Корзина пуста.'));
    for(const r of records){
      const row=uiElement('div','','trash-row');
      row.appendChild(uiElement('h3',entryLabel(deps,r.section,r.entry)));
      row.appendChild(uiElement('p',(deps.sectionLabels || SECTION_LABELS)[r.section] || r.section));
      const days=Math.max(0,Math.ceil((Date.parse(r.deletedAt)+T.TRASH_RETENTION_MS-Date.now())/86400000));
      row.appendChild(uiElement('p',days ? 'До удаления навсегда: '+days+' дн.' : 'Будет удалено при следующем входе.'));
      row.appendChild(uiElement('p','Удалено: '+new Date(r.deletedAt).toLocaleDateString('ru-RU')));
      row.appendChild(uiButton('Восстановить',async()=>{
        await s.mutate(()=>T.restoreFromTrash(s.vault,r.trashId));if(s.alive()){render();deps.refresh?.();}
      }));
      let confirming=false;
      row.appendChild(uiButton('Удалить навсегда',async()=>{
        if(!s.alive() || confirming)return;confirming=true;
        try {
          const ok=await deps.dlgConfirm('Удалить запись и вложения без возможности восстановления?',{title:'Удалить навсегда',ok:'Удалить',cancel:'Отмена'});
          if(ok===true && s.alive()){await s.mutate(()=>T.purgeTrash(s.vault,r.trashId));if(s.alive())render();}
        }catch(e){if(s.alive())deps.toast?.('Не удалось удалить запись.');}finally{confirming=false;}
      }));s.body.appendChild(row);
    }
  }
  try { // Validate without creating an unsaved trash structure merely by opening.
    if(s.vault.trash!==undefined)T.ensureTrash(s.vault);render();
  }catch(e){s.close();deps.toast?.('Не удалось прочитать корзину. Данные сохранены без изменений.');return null;}
  return s;
}
// Call after unlock; parent serializes this with all other vault saves.
export async function pruneTrashOnUnlock(now=Date.now()) {
  if(!D?.state.vault)return 0;
  const deps=D,v=deps.state.vault;
  if(!v.trash)return 0;
  T.ensureTrash(v);
  if(!v.trash.records.some(r=>Date.parse(r.deletedAt)<=+now-T.TRASH_RETENTION_MS))return 0;
  return T.withVaultTransaction(v,()=>T.pruneTrash(v,+now),()=>{if(deps.state.vault!==v)throw Error('Vault changed');return deps.saveFile();});
}
