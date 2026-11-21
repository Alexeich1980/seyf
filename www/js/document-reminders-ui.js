import * as R from './document-reminders.js';
import { createVaultSurface, uiElement, uiButton, entryLabel } from './trash-ui.js';
let D, modal, banner;
export function initDocumentRemindersUI(deps){modal?.close();banner?.close();D=deps;}
function rows(surface, items){
  for(const r of items){
    const text=entryLabel(D,'documents',r.entry)+': '+(r.status==='expired'?'срок истёк':r.daysLeft===0?'срок истекает сегодня':'срок истекает через '+r.daysLeft+' дн.');
    surface.body.appendChild(uiElement('p',text,'doc-expiry '+r.status));
  }
}
export function showDocumentReminders(container, now=Date.now()) {
  banner?.close();
  if(!D?.state.vault)return null;
  const items=R.collectDocumentReminders(D.state.vault,now);if(!items.length)return null;
  const s=createVaultSurface(D,'Сроки документов',container||document.body);banner=s;rows(s,items.slice(0,3));
  if(items.length>3)s.body.appendChild(uiElement('p','Ещё документов со сроком: '+(items.length-3)+'. Полный список в настройках напоминаний.'));
  s.body.appendChild(uiButton('Скрыть на сегодня',async()=>{if(await s.mutate(()=>R.dismissDocumentReminders(s.vault,now)) && s.alive())s.close();}));
  s.body.appendChild(uiButton('Настроить напоминания',()=>{if(s.alive())openDocumentReminders();}));return s;
}
export function openDocumentReminders() {
  if(!D)throw Error('Call initDocumentRemindersUI first');
  if(D.requireRealVault && !D.requireRealVault(()=>openDocumentReminders()))return null;
  modal?.close();const deps=D,s=createVaultSurface(deps,'Сроки документов');modal=s;
  let busy=false;
  function render(){
    if(!s.alive())return;s.body.replaceChildren();
    s.body.appendChild(uiElement('p','Укажите необязательный срок действия в редакторе документа. При входе в сейф появятся документы с истёкшим сроком и сроком в ближайшие 30 дней.','arc-intro'));
    rows(s,R.collectDocumentExpiry(s.vault));
    const available=typeof deps.requestDocumentReminderPermission==='function' && typeof deps.syncDocumentReminders==='function';
    if(!available){s.body.appendChild(uiElement('p','Системные уведомления недоступны. Напоминания появятся внутри сейфа.'));return;}
    const enabled=s.vault.preferences?.documentReminders===true;
    s.body.appendChild(uiElement('p','Уведомления за 30 и 7 дней и после окончания срока. Названия документов в уведомления не попадают.'));
    s.body.appendChild(uiButton(enabled?'Выключить уведомления':'Включить уведомления',async()=>{
      if(busy || !s.alive())return;busy=true;
      try {
        if(!enabled){const allowed=await deps.requestDocumentReminderPermission();if(!s.alive())return;if(allowed!==true){deps.toast?.('Разрешение на уведомления не получено.');return;}}
        if(!s.alive())return;
        const saved=await s.mutate(()=>R.setDocumentRemindersEnabled(s.vault,!enabled));
        if(!s.alive())return;
        if(!saved){render();return;}
        // Preference is already durably saved. A native sync error must not roll it back.
        try {await deps.syncDocumentReminders(R.documentReminderTimes(s.vault));}
        catch(e){if(s.alive())deps.toast?.('Настройка сохранена. Не удалось обновить системные уведомления.');}
        if(s.alive())render();
      }catch(e){if(s.alive())deps.toast?.('Не удалось включить уведомления.');}finally{busy=false;}
    }));
  }
  render();return s;
}
