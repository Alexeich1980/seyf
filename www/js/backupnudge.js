// backupnudge.js - напоминание «сделайте резервную копию» раз в месяц (1.3.3). НЕ core.
// Перенос из десктопа «Сейфа» (js/backupnudge.js, коммит c93358be; донор - Хомяк RuStore guards.js
// backupDue) с поправкой для телефона: первое напоминание не раньше MIN_DAYS после установки
// (firstAt - первый запуск версии с напоминанием), а не сразу после создания сейфа.
// Чистая логика без DOM: app.js читает отметку из localStorage, спрашивает backupDue и показывает
// своё окно в стиле приложения.
//
// Отметки - в localStorage (не секрет: только даты и выключатель), один JSON под ключом seyf_backup:
//   firstAt  - первый запуск с напоминанием (отсчёт для тех, у кого копий ещё не было);
//   lastAt   - когда последний раз успешно сохранили копию (markBackup после экспорта);
//   shownYM / shownAt - когда окно показали (в этом месяце больше не показываем);
//   snoozeYM / snoozeAt - когда нажали «Позже» (до следующего месяца);
//   off      - галочка «Больше не напоминать».
// GAP_DAYS (из донора, ревью Хомяка 1.0.3): показ 31-го + «Позже» не должен всплыть снова 1-го,
// поэтому после показа/«Позже» молчим ещё и не меньше GAP_DAYS дней.

export const BACKUP_KEY = 'seyf_backup';
export const DAY = 24 * 60 * 60 * 1000;
export const BACKUP = Object.freeze({ MIN_DAYS: 30, GAP_DAYS: 25 });

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

// «2026-10» для момента ms (местное время).
export function ymOf(ms) {
  const d = new Date(num(ms));
  const m = d.getMonth() + 1;
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m;
}

export function readStamp(storage) {
  try {
    const o = JSON.parse((storage && storage.getItem(BACKUP_KEY)) || 'null');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}
export function writeStamp(storage, stamp) {
  try { if (storage) storage.setItem(BACKUP_KEY, JSON.stringify(stamp || {})); return true; } catch { return false; }
}

// Метка из будущего (часы перевели назад) паузу не держит.
function recent(at, now, days) { const a = num(at), g = now - a; return a > 0 && g >= 0 && g < days * DAY; }

// Пора ли показать напоминание. stamp - отметка из readStamp; ctx = { now, entryCount }.
// Пустой сейф копировать незачем - молчим. Копий не было - отсчёт от firstAt (нет firstAt -
// не показываем: app.js сначала ставит его через withFirstSeen).
export function backupDue(stamp, ctx) {
  const s = stamp || {}, c = ctx || {};
  const now = num(c.now), ym = ymOf(now);
  if (s.off) return false;
  if (num(c.entryCount) < 1) return false;
  if (s.shownYM === ym || s.snoozeYM === ym) return false;
  if (recent(s.shownAt, now, BACKUP.GAP_DAYS) || recent(s.snoozeAt, now, BACKUP.GAP_DAYS)) return false;
  const last = num(s.lastAt);
  if (last > 0) {
    if (ymOf(last) === ym) return false;
    if (now - last < BACKUP.MIN_DAYS * DAY) return false;
    return true;
  }
  const first = num(s.firstAt);
  if (!(first > 0)) return false;
  return !recent(first, now, BACKUP.MIN_DAYS);
}

// Переходы отметки - возвращают НОВЫЙ объект (исходный не меняем).
export const withFirstSeen = (s, now) => (num((s || {}).firstAt) > 0 ? { ...(s || {}) } : { ...(s || {}), firstAt: num(now) });
export const markShown = (s, now) => ({ ...(s || {}), shownYM: ymOf(now), shownAt: num(now) });
export const markLater = (s, now) => ({ ...(s || {}), snoozeYM: ymOf(now), snoozeAt: num(now) });
export const markBackup = (s, now) => ({ ...(s || {}), lastAt: num(now) });
export const setRemindOff = (s, off) => ({ ...(s || {}), off: !!off });

// Подпись для окна: «Последняя копия: 12.10.2026.» или «Резервных копий ещё не было.»
export function lastBackupText(stamp) {
  const last = num(stamp && stamp.lastAt);
  if (!(last > 0)) return 'Резервных копий ещё не было.';
  const d = new Date(last);
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  return 'Последняя копия: ' + dd + '.' + mm + '.' + d.getFullYear() + '.';
}

export const REMIND_TITLE = 'Резервная копия';
export const REMIND_TEXT = 'Если телефон потеряется или сломается, записи вернутся из копии. Сохраните её вне телефона: на компьютер или в облако. Открыть копию можно только вашим мастер-паролем.';
