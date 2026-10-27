// archive-ui.js - окна «Архива для близких» (1.3.3). Логика и тексты - js/archive.js (чистые, под тестами);
// здесь только DOM в существующем дизайне «Сейфа»: полноэкранное окно .modal.detail (как редактор записи),
// карточки выдачи .backup-card (как «Резервная копия»), строки-разделы, поля .form-row, выбор из списка -
// stylePicker приложения, дата - своё окно (не системное). Зависимости из app.js приходят через initArchiveUI.
// БЕСПЛАТНО в любой версии и без лимитов: окна гейта/покупки отсюда не зовутся (заслон archive-133).
import * as A from './archive.js';
import { icon } from './icons.js';
import { generatePassphrase } from './generator.js';

let D = null;
export function initArchiveUI(deps) { D = deps; }

const esc = (s) => A.escapeHtml(s);
const vault = () => D.state.vault;
const arc = () => vault().archive;

async function persist() {
  A.touch(arc());
  try { await D.saveFile(); return true; }
  catch (e) { D.toast('Не удалось сохранить архив (' + D.saveErrorLabel(e) + '). Попробуйте ещё раз.'); return false; }
}

// ---------- главное окно архива: экраны home / section / form в одном окне ----------
export function openArchive() {
  if (!D.requireRealVault(() => openArchive())) return;
  A.ensureArchive(vault());
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal detail archive';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-label', A.ARCHIVE_TITLE);
  back.appendChild(m);

  let screen = { name: 'home' };
  let debtKind = 'mine';
  let form = null;               // { dirty, collect(), sectionId, itemId }

  const close = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
  // Уйти с формы: несохранённое - спросить (окно приложения, не системное). «Не сохранять» - уйти туда,
  // куда шли (крестик - закрыть окно). «Сохранить» - сохранить и ВСЕГДА остаться в списке раздела архива,
  // как кнопкой «Сохранить» в форме (замечание Алексея З2, 27.10.2026: крестик -> «Сохранить» закрывал весь
  // архив и выбрасывал на главный экран, а человек вносит записи одну за другой). Не сохранилось (пустая
  // запись) - остаёмся в форме.
  let leaving = false;
  const leaveForm = async (go) => {
    if (leaving) return;
    if (form && form.dirty) {
      leaving = true;
      let r;
      try { r = await D.styledConfirm({ title: 'Несохранённые изменения', message: 'Сохранить изменения?' }); }
      finally { leaving = false; }
      if (r === 'cancel') return;
      if (r === 'save') { await form.save(); return; }   // save сам ведёт в список раздела (или остаётся в форме)
    }
    form = null;
    go();
  };
  const goBack = () => {
    if (screen.name === 'form') return leaveForm(() => { screen = { name: 'section', id: screen.id }; render(); });
    if (screen.name === 'section') return leaveForm(() => { screen = { name: 'home' }; render(); });
    return leaveForm(close);
  };
  const onKey = (e) => { if (e.key === 'Escape' && D.isTopModal(back)) { e.stopPropagation(); goBack(); } };

  const head = (title, withBack) => `<div class="detail-head arc-head">
      ${withBack ? `<button type="button" class="ic-btn arc-back" title="Назад" aria-label="Назад">${icon('back', 22)}</button>` : ''}
      <span class="detail-title">${esc(title)}</span>
      <button type="button" class="dv-close ic-btn arc-x" title="Закрыть" aria-label="Закрыть">${icon('close', 20)}</button>
    </div>`;
  const bindHead = () => {
    const b = m.querySelector('.arc-back'); if (b) b.onclick = goBack;
    m.querySelector('.arc-x').onclick = () => leaveForm(close);
  };

  function render() {
    if (screen.name === 'home') renderHome();
    else if (screen.name === 'section') renderSection(screen.id);
    else renderForm(screen.id, screen.itemId, screen.kind);
    bindHead();
    const body = m.querySelector('.arc-body'); if (body) body.scrollTop = 0;
  }

  function renderHome() {
    form = null;
    const a = arc(), v = vault();
    const rows = A.ARCHIVE_SECTIONS.map((s) => {
      const n = A.sectionCount(a, v, s.id);
      return `<button type="button" class="arc-row" data-sec="${s.id}"><span class="arc-row-t">${esc(s.title)}</span>`
        + (n ? `<span class="arc-row-n">${n}</span>` : '') + '</button>';
    }).join('');
    m.innerHTML = head(A.ARCHIVE_TITLE, false) + `<div class="detail-body arc-body">
      <p class="arc-intro">${esc(A.ARCHIVE_INTRO)}</p>
      <button type="button" class="backup-card backup-save arc-issue" data-issue="sheet">
        <span class="backup-card-ic">${icon('print', 24)}</span>
        <span class="backup-card-txt"><span class="backup-card-t">${esc(A.ISSUE_SHEET.title)}</span><span class="backup-card-d">${esc(A.ISSUE_SHEET_SUB)}</span></span></button>
      <button type="button" class="backup-card backup-restore arc-issue" data-issue="full">
        <span class="backup-card-ic">${icon('file', 24)}</span>
        <span class="backup-card-txt"><span class="backup-card-t">${esc(A.ISSUE_FULL.title)}</span><span class="backup-card-d">${esc(A.ISSUE_FULL_SUB)}</span></span></button>
      <p class="arc-local">${esc(A.ARCHIVE_LOCAL_NOTE)}</p>
      <div class="about-sec">${esc(A.SECTIONS_HEAD)}</div>
      ${A.isFilled(a, v) ? '' : `<p class="arc-cap arc-start">${esc(A.START_HINT)}</p>`}
      <div class="arc-list">${rows}</div>
    </div>`;
    m.querySelectorAll('.arc-row').forEach((b) => { b.onclick = () => { screen = { name: 'section', id: b.dataset.sec }; render(); }; });
    m.querySelector('[data-issue="sheet"]').onclick = () => issueSheet();
    m.querySelector('[data-issue="full"]').onclick = () => issueFull();
  }

  function renderSection(id) {
    const sec = A.sectionById(id);
    if (sec.single) { renderForm(id, null, null); return; }
    form = null;
    const a = arc(), v = vault();
    let html = head(sec.title, true) + `<div class="detail-body arc-body"><p class="arc-hint">${esc(sec.hint)}</p>`;
    if (sec.kinds) {
      html += '<div class="arc-seg">' + sec.kinds.map((k) => `<button type="button" class="arc-seg-b${k.id === debtKind ? ' on' : ''}" data-kind="${k.id}" aria-pressed="${k.id === debtKind}">${esc(k.label)}</button>`).join('') + '</div>';
    }
    if (sec.sources) {
      html += `<div class="about-sec arc-from">${esc(sec.sourceCaption)}</div>`;
      html += `<p class="arc-cap">${esc(A.pickCaption(id))}</p>`;
      let any = false;
      for (const src of sec.sources) {
        const list = (v.sections && v.sections[src]) || [];
        const closed = A.sourceClosed(src, v, { full: D.isFull(), freeLimits: D.freeLimits });
        if (!closed && !list.length) continue;
        any = true;
        if (sec.sources.length > 1) html += `<div class="arc-src">${esc(A.sourceLabel(src))}</div>`;
        if (A.SOURCE_CAPTIONS[src]) html += `<p class="arc-cap">${esc(A.SOURCE_CAPTIONS[src])}</p>`;
        if (closed) { html += `<p class="arc-closed">${esc(A.CLOSED_NOTE)}</p>`; continue; }
        const picked = a.picks[src] || [];
        html += list.map((e) => `<label class="arc-pick"><input type="checkbox" data-src="${src}" data-id="${esc(e.id)}"${picked.includes(e.id) ? ' checked' : ''}><span>${esc(A.pickTitle(src, e))}</span></label>`).join('');
      }
      if (!any) html += '<p class="arc-empty">В сейфе пока нет таких записей.</p>';
    }
    const items = (a.items[id] || []).filter((it) => !sec.kinds || it.kind === debtKind);
    if (items.length) {
      html += (sec.sources ? '<div class="about-sec">Вписано вручную</div>' : '') + '<div class="arc-items">';
      html += items.map((it) => {
        const fields = A.fieldsFor(sec, it.kind);
        const vals = fields.map((fd) => A.fieldText(fd, it.f[fd.key])).filter(Boolean);
        return `<button type="button" class="arc-item" data-id="${esc(it.id)}"><span class="arc-item-t">${esc(vals[0] || 'Без названия')}</span>`
          + (vals[1] ? `<span class="arc-item-s">${esc(vals[1])}</span>` : '') + '</button>';
      }).join('') + '</div>';
    }
    html += `<button type="button" class="arc-add">${esc(A.ADD_MANUAL)}</button></div>`;
    m.innerHTML = html;
    m.querySelectorAll('.arc-seg-b').forEach((b) => { b.onclick = () => { debtKind = b.dataset.kind; render(); D.haptic('light'); }; });
    m.querySelectorAll('.arc-pick input').forEach((cb) => {
      cb.onchange = () => { A.togglePick(arc(), cb.dataset.src, cb.dataset.id, cb.checked); persist(); };
    });
    m.querySelectorAll('.arc-item').forEach((b) => { b.onclick = () => { screen = { name: 'form', id, itemId: b.dataset.id }; render(); }; });
    m.querySelector('.arc-add').onclick = () => { screen = { name: 'form', id, itemId: null, kind: sec.kinds ? debtKind : null }; render(); };
  }

  function renderForm(id, itemId, kind) {
    const sec = A.sectionById(id);
    const a = arc();
    const item = sec.single ? null : (a.items[id] || []).find((x) => x.id === itemId) || null;
    const k = item ? item.kind : kind;
    const fields = A.fieldsFor(sec, k);
    const vals = { ...(sec.single ? a.wishes : (item ? item.f : {})) };
    const kindLabel = sec.kinds ? (sec.kinds.find((x) => x.id === k) || sec.kinds[0]).label : '';
    let html = head(sec.single ? sec.title : (kindLabel || sec.title), true) + '<div class="detail-body arc-body">';
    if (sec.single) html += `<p class="arc-hint">${esc(sec.hint)}</p>`;
    for (const fd of fields) {
      if (fd.type === 'choice' || fd.type === 'multi' || fd.type === 'date') {
        html += `<div class="form-row"><span>${esc(fd.label)}</span><button type="button" class="picker-btn arc-pickbtn" data-k="${fd.key}">`
          + `<span class="picker-val"></span><span class="picker-arrow" aria-hidden="true">▾</span></button></div>`;
      } else if (fd.type === 'area') {
        html += `<label class="form-row"><span>${esc(fd.label)}</span><textarea data-k="${fd.key}" maxlength="2000" placeholder="${esc(fd.placeholder)}"></textarea></label>`;
      } else {
        html += `<label class="form-row"><span>${esc(fd.label)}</span><input type="text" data-k="${fd.key}" maxlength="300" autocomplete="off" placeholder="${esc(fd.placeholder)}"${fd.inputmode ? ` inputmode="${fd.inputmode}"` : ''}></label>`;
      }
      if (sec.notes && sec.notes[fd.key]) html += `<p class="arc-note">${esc(sec.notes[fd.key])}</p>`;
    }
    html += '</div><div class="modal-actions detail-actions arc-actions">'
      + (item ? '<button type="button" class="deny arc-del">Удалить</button>' : '')
      + '<button type="button" class="save arc-save">Сохранить</button></div>';
    m.innerHTML = html;
    const f = { dirty: false };
    form = f;
    m.querySelectorAll('[data-k]').forEach((el) => {
      const key = el.dataset.k;
      if (el.tagName === 'BUTTON') {
        const fd = fields.find((x) => x.key === key);
        const paint = () => {
          const pv = el.querySelector('.picker-val');
          const t = A.fieldText(fd, vals[key]);
          pv.textContent = t || (fd.type === 'date' ? 'Выбрать дату' : 'Выбрать');
          pv.classList.toggle('arc-ph', !t);
        };
        paint();
        el.onclick = async () => {
          let r;
          if (fd.type === 'date') r = await openDatePicker({ title: fd.label, value: vals[key] || '' });
          else if (fd.type === 'multi') r = await openMultiPicker({ title: fd.label, options: fd.options, value: A.multiValues(fd, vals[key]) });
          else r = await D.stylePicker({ title: fd.label, value: vals[key] || '', options: [{ value: '', label: 'Не выбрано' }, ...fd.options.map((o) => ({ value: o, label: o }))] });
          if (r === null || r === undefined) return;
          if (r === '' || (Array.isArray(r) && !r.length)) delete vals[key]; else vals[key] = r;
          f.dirty = true; paint();
        };
      } else {
        el.value = vals[key] || '';
        el.addEventListener('input', () => { f.dirty = true; });
      }
    });
    const collect = () => {
      const out = { ...vals };
      m.querySelectorAll('input[data-k], textarea[data-k]').forEach((el) => { out[el.dataset.k] = el.value.trim(); });
      return out;
    };
    // → true, если сохранено. busy: пока идёт запись, второе касание «Сохранить» ничего не делает
    // (ревью 1.3.3 В1: двойное касание создавало две записи), кнопки выключены.
    const saveBtn = m.querySelector('.arc-save');
    const del = m.querySelector('.arc-del');
    let busy = false;
    const lock = (on) => { busy = on; saveBtn.disabled = on; if (del) del.disabled = on; };
    f.save = async () => {
      if (busy) return false;
      const data = collect();
      const empty = !Object.values(data).some((x) => x && String(x).trim());
      if (!sec.single && empty) {
        D.toast(item ? 'Все поля пустые. Заполните хотя бы одно или удалите запись' : 'Заполните хотя бы одно поле');
        return false;
      }
      lock(true);
      let ok = false;
      try {
        if (sec.single) A.setWishes(arc(), data);
        else if (item) A.updateItem(arc(), id, item.id, data);
        else A.addItem(arc(), id, data, k);
        form = null;
        ok = await persist();
      } finally { lock(false); }
      // запись на диск не удалась - остаётся тост с ошибкой, «Сохранено» его не перекрывает (ревью 27.10)
      if (ok) D.toast('Сохранено');
      screen = sec.single ? { name: 'home' } : { name: 'section', id };
      render();
      return true;
    };
    saveBtn.onclick = () => f.save();
    if (del) del.onclick = async () => {
      if (busy) return;
      if (!await D.dlgConfirm('Удалить эту запись из архива?', { title: 'Удаление', ok: 'Удалить', danger: true })) return;
      if (busy) return;
      lock(true);
      try { A.removeItem(arc(), id, item.id); form = null; await persist(); } finally { lock(false); }
      screen = { name: 'section', id }; render();
    };
  }

  // ---------- выдача 1: лист без секретов (печать Android / файл) ----------
  function issueSheet() {
    if (!A.isFilled(arc(), vault())) { D.dlgAlert(A.EMPTY_ALERT, A.ARCHIVE_TITLE); return; }
    const bk = document.createElement('div'); bk.className = 'modal-back';
    const d = document.createElement('div'); d.className = 'modal confirm arc-issue-dlg';
    d.innerHTML = `<h3>${esc(A.ISSUE_SHEET.title)}</h3>
      <p class="confirm-msg">${esc(A.ISSUE_SHEET.text)}</p>
      <label class="form-row"><span>Кто составил (необязательно)</span><input type="text" class="arc-owner" maxlength="120" autocomplete="off" placeholder="Ваше имя"></label>
      <div class="modal-actions"><button type="button" class="cancel">Отмена</button><button type="button" class="neutral arc-tofile">Сохранить файл</button><button type="button" class="save arc-print">Печать или PDF</button></div>`;
    const inp = d.querySelector('.arc-owner'); inp.value = arc().owner || '';
    const done = () => { document.removeEventListener('keydown', k2, true); bk.remove(); };
    const k2 = (e) => { if (e.key === 'Escape' && D.isTopModal(bk)) { e.stopPropagation(); done(); } };
    const go = async (how) => {
      const owner = inp.value.trim();
      done();
      if (owner !== (arc().owner || '')) { arc().owner = owner; await persist(); }
      const html = A.renderSheetHtml(A.buildSheetModel(arc(), vault(), { schema: D.schema, now: new Date() }));
      if (how === 'print') await printHtml(html);
      else await saveTextFile(fileName('лист'), html, 'text/html', 'Лист сохранён');
    };
    d.querySelector('.cancel').onclick = done;
    d.querySelector('.arc-tofile').onclick = () => go('file');
    d.querySelector('.arc-print').onclick = () => go('print');
    D.closeOnBackdrop(bk, done);
    document.addEventListener('keydown', k2, true);
    bk.appendChild(d); document.body.appendChild(bk);
  }

  // ---------- выдача 2: зашифрованный файл со своим паролем ----------
  function issueFull() {
    if (!A.isFilled(arc(), vault())) { D.dlgAlert(A.EMPTY_ALERT, A.ARCHIVE_TITLE); return; }
    const bk = document.createElement('div'); bk.className = 'modal-back';
    const d = document.createElement('div'); d.className = 'modal confirm arc-pw-dlg';
    d.innerHTML = `<h3>${esc(A.FILE_PW.title)}</h3>
      <p class="confirm-msg arc-opens">${esc(A.FILE_PW.opens)}</p>
      <details class="disclose arc-disc"><summary>${esc(A.FILE_PW.more)}<span class="disc-arr" aria-hidden="true"></span></summary>
        <div class="disc-b"><p>${esc(A.ISSUE_FULL.text)}</p></div></details>
      <div class="form-row"><span class="arc-pwlab"><label for="arcPw1">${esc(A.FILE_PW.label)}</label><button type="button" class="arc-gen">${esc(A.FILE_PW_GEN)}</button></span><input type="password" id="arcPw1" class="arc-pw1" autocomplete="new-password" placeholder="${esc(A.FILE_PW.placeholder)}"></div>
      <label class="form-row"><span>${esc(A.FILE_PW.label2)}</span><input type="password" class="arc-pw2" autocomplete="new-password"></label>
      <p class="arc-note">${esc(A.FILE_PW.hint)}</p>
      <p class="arc-err" role="alert"></p>
      <div class="modal-actions"><button type="button" class="cancel">Отмена</button><button type="button" class="save arc-mkfile">${esc(A.FILE_PW.button)}</button></div>`;
    const p1 = d.querySelector('.arc-pw1'), p2 = d.querySelector('.arc-pw2'), err = d.querySelector('.arc-err'), ok = d.querySelector('.arc-mkfile');
    let busy = false;
    const done = () => { document.removeEventListener('keydown', k2, true); bk.remove(); };
    const k2 = (e) => { if (e.key === 'Escape' && D.isTopModal(bk) && !busy) { e.stopPropagation(); done(); } };
    const run = async () => {
      if (busy) return;
      const pw = p1.value;
      const problem = A.filePasswordProblem(pw, p2.value);
      if (problem) { err.textContent = problem; try { ok.scrollIntoView({ block: 'nearest' }); } catch (e) {} return; }
      busy = true; ok.disabled = true; err.textContent = 'Готовлю файл…';
      try {
        if (await D.isMasterPassword(pw)) { err.textContent = A.FILE_PW_IS_MASTER; return; }
        const model = A.buildFullModel(arc(), vault(), { schema: D.schema, now: new Date() });
        const html = A.buildEncryptedHtml(await A.encryptPayload(model, pw));
        p1.value = ''; p2.value = '';
        done();
        const name = fileName('зашифрован');
        const saved = await saveTextFile(name, html, 'text/html', null);
        if (saved) D.dlgAlert(A.fileSavedText(name), A.ARCHIVE_TITLE);
      } catch (e) {
        err.textContent = 'Не удалось подготовить файл. Попробуйте ещё раз.';
      } finally { busy = false; ok.disabled = false; }
    };
    ok.onclick = run;
    d.querySelector('.arc-gen').onclick = () => {
      if (busy) return;
      const pw = generatePassphrase({ words: 4 });
      p1.type = 'text'; p2.type = 'text';     // показать: пароль нужно записать на бумаге
      p1.value = pw; p2.value = pw;
      err.textContent = '';   // подсказка ниже уже говорит: запишите на бумаге и передайте отдельно (окно - без прокрутки на 360x640)
    };
    d.querySelector('.cancel').onclick = () => { if (!busy) done(); };
    D.closeOnBackdrop(bk, () => { if (!busy) done(); });
    document.addEventListener('keydown', k2, true);
    bk.appendChild(d); document.body.appendChild(bk);
    p1.focus();
  }

  document.addEventListener('keydown', onKey, true);
  D.closeOnBackdrop(back, () => leaveForm(close));
  document.body.appendChild(back);
  render();
  return back;
}

function fileName(kind) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return 'Архив для близких (' + kind + ') ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.html';
}

// Сохранить файл: телефон - системное окно «Сохранить как» (SaveFile, как резервная копия);
// браузер QA - showSaveFilePicker. Без сети. → true, если записано.
async function saveTextFile(name, text, mime, okToast) {
  const NP = window.NativePlugins;
  if (window.isNativeApp && window.isNativeApp() && NP && NP.SaveFile) {
    try {
      const base64 = btoa(unescape(encodeURIComponent(text)));
      const r = await D.withSystemWindow(() => NP.SaveFile.save({ name, mime, base64 }));
      if (r && r.ok) { if (okToast) D.toast(okToast); return true; }
      if (!(r && r.cancelled)) D.toast('Не удалось сохранить файл');
    } catch (e) { D.toast('Не удалось сохранить файл'); }
    return false;
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await D.withSystemWindow(() => window.showSaveFilePicker({ suggestedName: name, types: [{ description: A.ARCHIVE_TITLE, accept: { [mime]: ['.html'] } }] }));
      const w = await h.createWritable(); await w.write(text); await w.close();
      if (okToast) D.toast(okToast);
      return true;
    } catch (e) { if (!(e && e.name === 'AbortError')) D.toast('Не удалось сохранить файл'); return false; }
  }
  D.toast('На этом устройстве файл не сохранить');
  return false;
}

// Печать листа: телефон - системная печать Android (там же «Сохранить как PDF», плагин Print);
// браузер QA - печать скрытой рамки. Лист - статичный HTML без скриптов и сети.
async function printHtml(html) {
  const NP = window.NativePlugins;
  if (window.isNativeApp && window.isNativeApp() && NP && NP.Print) {
    try {
      // окно печати Android живёт дольше вызова: «системное окно» держится до конца печати или возврата
      // в приложение (ревью 1.3.3 М1), иначе долгая печать запирала сейф как уход в фон
      const r = await D.withSystemWindow(() => NP.Print.print({ html, name: A.ARCHIVE_TITLE }), { untilForeground: true });
      if (!(r && r.ok)) D.toast('Печать недоступна. Сохраните лист кнопкой «Сохранить файл».');
    } catch (e) { D.toast('Печать недоступна. Сохраните лист кнопкой «Сохранить файл».'); }
    return;
  }
  try {
    const fr = document.createElement('iframe');
    fr.className = 'arc-printframe';
    fr.setAttribute('aria-hidden', 'true');
    fr.srcdoc = html;
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) {} setTimeout(() => fr.remove(), 60000); };
    document.body.appendChild(fr);
  } catch (e) { D.toast('Печать недоступна. Сохраните лист кнопкой «Сохранить файл».'); }
}

// ---------- своё окно выбора даты (не системное) ----------
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export function openDatePicker({ title, value }) {
  return new Promise((resolve) => {
    const cur = A.parseDate(value);
    const now = new Date();
    let y = cur ? cur.y : now.getFullYear(), mo = cur ? cur.m : now.getMonth() + 1;
    const bk = document.createElement('div'); bk.className = 'modal-back';
    const d = document.createElement('div'); d.className = 'modal confirm arc-date';
    bk.appendChild(d);
    const finish = (v) => { document.removeEventListener('keydown', onKey, true); bk.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && D.isTopModal(bk)) { e.stopPropagation(); finish(null); } };
    const draw = () => {
      const weeks = A.monthGrid(y, mo);
      d.innerHTML = `<h3>${esc(title)}</h3>
        <div class="dp-head">
          <button type="button" class="ic-btn dp-nav" data-d="-12" aria-label="Предыдущий год">«</button>
          <button type="button" class="ic-btn dp-nav" data-d="-1" aria-label="Предыдущий месяц">‹</button>
          <span class="dp-t">${A.MONTHS[mo - 1]} ${y}</span>
          <button type="button" class="ic-btn dp-nav" data-d="1" aria-label="Следующий месяц">›</button>
          <button type="button" class="ic-btn dp-nav" data-d="12" aria-label="Следующий год">»</button>
        </div>
        <div class="dp-grid">${WD.map((w) => `<span class="dp-wd">${w}</span>`).join('')}${weeks.flat().map((n) => n
          ? `<button type="button" class="dp-day${cur && cur.y === y && cur.m === mo && cur.d === n ? ' on' : ''}" data-n="${n}">${n}</button>`
          : '<span class="dp-empty"></span>').join('')}</div>
        <div class="modal-actions"><button type="button" class="cancel">Отмена</button><button type="button" class="neutral dp-clear">Очистить</button></div>`;
      d.querySelectorAll('.dp-nav').forEach((b) => { b.onclick = () => { const t = A.shiftMonth(y, mo, Number(b.dataset.d)); y = t.y; mo = t.m; draw(); }; });
      d.querySelectorAll('.dp-day').forEach((b) => { b.onclick = () => finish(A.formatDate({ y, m: mo, d: Number(b.dataset.n) })); });
      d.querySelector('.cancel').onclick = () => finish(null);
      d.querySelector('.dp-clear').onclick = () => finish('');
    };
    draw();
    D.closeOnBackdrop(bk, () => finish(null));
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bk);
  });
}

// ---------- своё окно выбора нескольких вариантов (З1, не системное) ----------
// Строки-галочки в стиле пикера приложения (.picker-item; отмеченная - .active с галочкой), «Готово» - список
// отмеченных в порядке вариантов, «Отмена»/«Назад»/фон - null (ничего не меняется).
export function openMultiPicker({ title, options, value }) {
  return new Promise((resolve) => {
    const on = new Set(Array.isArray(value) ? value : []);
    const bk = document.createElement('div'); bk.className = 'modal-back';
    const d = document.createElement('div'); d.className = 'modal picker arc-multi';
    d.innerHTML = `<h3>${esc(title)}</h3><p class="arc-cap">Можно выбрать несколько.</p><div class="picker-list"></div>
      <div class="modal-actions"><button type="button" class="cancel">Отмена</button><button type="button" class="save arc-multi-ok">Готово</button></div>`;
    const list = d.querySelector('.picker-list');
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'picker-item arc-mi'; b.dataset.v = o;
      b.setAttribute('role', 'checkbox');
      b.innerHTML = `<span class="arc-mi-box" aria-hidden="true"></span><span class="arc-mi-t">${esc(o)}</span>`;
      const paint = () => { const c = on.has(o); b.classList.toggle('active', c); b.setAttribute('aria-checked', String(c)); };
      paint();
      b.onclick = () => { if (on.has(o)) on.delete(o); else on.add(o); paint(); };
      list.appendChild(b);
    }
    const finish = (v) => { document.removeEventListener('keydown', onKey, true); bk.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && D.isTopModal(bk)) { e.stopPropagation(); finish(null); } };
    d.querySelector('.cancel').onclick = () => finish(null);
    d.querySelector('.arc-multi-ok').onclick = () => finish(options.filter((o) => on.has(o)).concat([...on].filter((x) => !options.includes(x))));
    D.closeOnBackdrop(bk, () => finish(null));
    document.addEventListener('keydown', onKey, true);
    bk.appendChild(d); document.body.appendChild(bk);
  });
}

// ---------- напоминание раз в полгода «проверьте архив» ----------
// По образцу напоминания о копии: только в открытом настоящем сейфе, когда поверх ничего нет.
export function maybeRemindArchive(now = Date.now()) {
  const v = vault();
  if (!v || D.state.demoMode) return false;
  if (document.querySelector('.modal-back')) return false;
  const lock = document.querySelector('#lock'); if (lock && !lock.classList.contains('hidden')) return false;
  const bg = document.querySelector('#menuBg'); if (bg && !bg.hidden) return false;
  A.ensureArchive(v);
  const ls = D.lsGet();
  const stamp = A.readNudge(ls);
  if (!A.archiveDue({ archive: v.archive, vault: v, stamp, now })) return false;
  A.writeNudge(ls, A.nudgeLater(stamp, now));          // закрыли фоном/назад - как «Позже»
  const back = document.createElement('div'); back.className = 'modal-back';
  const m = document.createElement('div'); m.className = 'modal confirm arc-remind';
  m.innerHTML = `<h3>${esc(A.REMIND.title)}</h3><p class="confirm-msg">${esc(A.REMIND.text)}</p>
    <div class="modal-actions"><button type="button" class="cancel">${esc(A.REMIND.later)}</button><button type="button" class="save">${esc(A.REMIND.open)}</button></div>`;
  let closed = false;
  const finish = (open) => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey, true); back.remove();
    if (open) { A.writeNudge(D.lsGet(), A.nudgeReviewed(A.readNudge(D.lsGet()), Date.now())); openArchive(); }
  };
  const onKey = (e) => { if (e.key === 'Escape' && D.isTopModal(back)) { e.stopPropagation(); finish(false); } };
  m.querySelector('.cancel').onclick = () => finish(false);
  m.querySelector('.save').onclick = () => finish(true);
  D.closeOnBackdrop(back, () => finish(false));
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m); document.body.appendChild(back);
  return true;
}
