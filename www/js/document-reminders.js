import { expiryEndMs, expiryDaysLeft } from './documents.js';
// All preferences are inside the encrypted vault, never localStorage.
function validExpiry(raw) {
  const s = String(raw ?? '').trim();
  if (!/^(\d{2}\.\d{2}\.(\d{2}|\d{4})|\d{4}-\d{2}-\d{2}|\d{2}\/?\d{2})$/.test(s)) return false;
  const t = expiryEndMs(s); if (!Number.isFinite(t)) return false;
  if (/^\d{4}-/.test(s)) {
    const d = new Date(t), [y,m,day] = s.split('-').map(Number);
    return d.getFullYear()===y && d.getMonth()===m-1 && d.getDate()===day;
  }
  return true;
}
export function collectDocumentExpiry(vault, now = Date.now()) {
  if (!Number.isFinite(+now)) throw new TypeError('Invalid time');
  return (vault?.sections?.documents || []).filter(e=>e && typeof e.id==='string' && validExpiry(e.expiry)).map(entry=>({
    id:entry.id, section:'documents', entry, expiry:entry.expiry,
    expiresAt:expiryEndMs(entry.expiry), daysLeft:expiryDaysLeft(entry.expiry,+now),
    status:expiryDaysLeft(entry.expiry,+now)<0?'expired':'soon',
  })).filter(r=>r.daysLeft<=30).sort((a,b)=>a.expiresAt-b.expiresAt || a.id.localeCompare(b.id));
}
const dayKey = now => { const d=new Date(now); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; };
const itemKey = r => JSON.stringify([r.id,r.expiry]);
export function collectDocumentReminders(vault, now = Date.now()) {
  const dismissed=vault?.preferences?.documentReminderDismissed;
  const keys=new Set(dismissed?.day===dayKey(now) && Array.isArray(dismissed.keys)?dismissed.keys:[]);
  return collectDocumentExpiry(vault,now).filter(r=>!keys.has(itemKey(r)));
}
export function dismissDocumentReminders(vault, now = Date.now()) {
  const keys=collectDocumentExpiry(vault,now).map(itemKey);
  vault.preferences ??= {};
  vault.preferences.documentReminderDismissed={day:dayKey(now),keys};
}
export function setDocumentRemindersEnabled(vault, enabled) {
  vault.preferences ??= {}; vault.preferences.documentReminders=enabled===true;
}
// Native plugin receives timestamps only, earliest 64. Date is valid through end of day.
// 30/7-day warnings use local midnight; expiry fires at the next local midnight.
export function documentReminderTimes(vault, now = Date.now()) {
  if (!Number.isFinite(+now)) throw new TypeError('Invalid time');
  if (vault?.preferences?.documentReminders!==true) return [];
  const times=[];
  for (const e of vault.sections?.documents || []) {
    if (!e || !validExpiry(e.expiry)) continue;
    const end=expiryEndMs(e.expiry);
    for (const days of [30,7]) { const d=new Date(end); d.setHours(0,0,0,0); d.setDate(d.getDate()-days); if (+d>+now) times.push(+d); }
    if (end+1>+now) times.push(end+1);
  }
  return [...new Set(times)].sort((a,b)=>a-b).slice(0,64);
}
