import { makeCard, listCards, drawBarcode, startBarcodeScan, decodeCardImage, LOYALTY_COLORS, LOYALTY_COLOR_NAMES, cardColor, moveFavorite, findDuplicateCard } from './loyalty.js';
import { bindLoyaltyNumber, formatLoyaltyNumber, normalizeLoyaltyNumber } from './loyalty-number.js';
import { attachLoyaltySwipe } from './loyalty-swipe.js';
import { createLoyaltyDrafts } from './loyalty-drafts.js';
import { chooseFiles, filesToPages } from './doc-viewer.js';
import { cleanupCameraTemp } from './camtemp.js';

// Integration: initLoyaltyUI(commonDeps); named exports delegate to that instance.
// Saves use state.vault.sections.loyalty + saveFile; refresh follows a confirmed save or an unconfirmed write retained in memory.
// Parent must load css/loyalty.css. Parent owns canAdd policy and section registration.
let current;
export function initLoyaltyUI(deps) { current?.destroy(); current = createLoyaltyUI(deps); return current; }
export const renderLoyaltyCard = (...args) => current.renderLoyaltyCard(...args);
export const renderList = (...args) => current.renderList(...args);
export const openCard = (...args) => current.openCard(...args);
export const openEditor = (...args) => current.openEditor(...args);
export const resumeDraft = (...args) => current?.resumeDraft(...args);
export const close = () => current?.close();
export const destroy = () => { current?.destroy(); current = null; };
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const button = (text, fn, cls = 'btn') => { const b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; };
function icon(kind) {
  const n=document.createElementNS('http://www.w3.org/2000/svg','svg');n.setAttribute('viewBox','0 0 24 24');n.setAttribute('aria-hidden','true');
  const p=document.createElementNS(n.namespaceURI,'path');p.setAttribute('d',{
    star:'M12 3l2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9z',
    trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    qr:'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6v-3h-3v-6h3z',
    barcode:'M3 5v14m3-14v14m4-14v14m3-14v14m4-14v14m4-14v14',
    edit:'M14 5l5 5M4 20l4-1L20 7a2 2 0 0 0-5-5L3 14l-1 6z'
  }[kind]);n.append(p);return n;
}
function photo(page, label) { const img = el('img', 'loyalty-photo'); img.alt = label; if (['image/jpeg','image/png','image/webp'].includes(page.mime)) img.src = `data:${page.mime};base64,${page.data}`; return img; }

export function createLoyaltyUI(D) {
  let screen = null, disposed = false, saving = false, generation = 0;
  const lists = new Set();
  const swipeRows = new Map();
  let deletingFromList = null;
  const swipeObserver = new MutationObserver(() => {
    for (const [row, record] of swipeRows) {
      if (row.isConnected) record.mounted = true;
      else if (record.mounted) { record.api.destroy(); swipeRows.delete(row); }
    }
    if (!swipeRows.size) swipeObserver.disconnect();
  });
  const closeSwipes = () => { for (const record of swipeRows.values()) record.api.close(); };
  const clearSwipes = () => { for (const record of swipeRows.values()) record.api.destroy(); swipeRows.clear(); swipeObserver.disconnect(); };
  const drafts = createLoyaltyDrafts(D);
  let brightnessQueue = Promise.resolve();
  const brightness = (action, target) => {
    const plugin = D.brightness || globalThis.window?.NativePlugins?.Brightness;
    brightnessQueue = brightnessQueue.then(() => { if (action === 'maximize' && !active(target)) return; return plugin?.[action]?.(action === 'maximize' && target?.checkout ? { keepScreenOn: true } : undefined); }).catch(() => {});
    return brightnessQueue;
  };
  const active = s => !disposed && screen === s && s.root.isConnected && D.state.vault === s.vault;
  function forceClose() {
    generation++; const old = screen;
    if (old?.editor && active(old)) old.capture?.();
    screen = null;
    if (!old) return;
    clearTimeout(old.timeout); old.stopScan?.(); old.stop?.(); old.closePhotoPanel?.(); old.cancelPhoto?.(); old.layoutCleanup?.(); old.root.remove();
    document.removeEventListener('keydown', old.key, true);
    if (old.bright) brightness('restore');
    if (old.focus?.isConnected && !document.hidden) old.focus.focus();
  }
  function locking() {
    if (screen?.editor && active(screen)) { screen.capture?.(); void drafts.flush(screen.vault).catch(() => {}); screen.capture = null; }
    forceClose(); deletingFromList = null; clearSwipes(); for (const c of lists) c.replaceChildren(); lists.clear(); }
  const background = () => {
    if (!document.hidden || !screen) return;
    if (screen.editor) { screen.capture?.(); void drafts.flush(screen.vault).catch(() => {}); if (!screen.picking && !screen.permissionPending) screen.stopScan?.(); if (screen.bright) { brightness('restore'); screen.bright = false; } }
    else forceClose();
  };
  function close() { return screen ? requestClose(screen) : undefined; }
  async function requestClose(s) {
    if (s.scanner) { s.stopScan?.(); return false; }
    if (s.photoPanel) { s.closePhotoPanel?.(); return false; }
    if (!active(s) || s.confirming || s.submitting) return;
    if (!s.editor || !s.isDirty?.()) { forceClose(); return true; }
    s.confirming = true;
    try {
      s.capture();
      if (!D.dlgConfirm) { await drafts.flush(s.vault); if (active(s)) { s.capture = null; forceClose(); return true; } return; }
      const discard = await D.dlgConfirm('Сохранить незавершённую карту для продолжения после входа или удалить черновик?', { title: 'Незавершённая карта', ok: 'Удалить черновик', cancel: 'Оставить черновик', danger: true });
      if (!active(s)) return;
      if (discard) drafts.remove(s.vault, s.draftId);
      await drafts.flush(s.vault);
      if (active(s)) { s.capture = null; forceClose(); return true; }
    } catch { if (active(s)) { s.capture?.(); D.toast?.('Не удалось записать черновик. Попробуйте ещё раз.'); } }
    finally { s.confirming = false; }
  }
  window.addEventListener('seyf:locking', locking);
  window.addEventListener('pagehide', locking);
  document.addEventListener('visibilitychange', background);
  function destroy() { locking(); drafts.destroy(); disposed = true; window.removeEventListener('seyf:locking', locking); window.removeEventListener('pagehide', locking); document.removeEventListener('visibilitychange', background); }
  function modal(title) {
    closeSwipes();
    forceClose();
    if (disposed || !D.state.vault) return null;
    const root = el('div', 'modal-back loyalty-back');
    const body = el('div', 'modal detail loyalty'); body.setAttribute('role', 'dialog'); body.setAttribute('aria-modal', 'true'); body.setAttribute('aria-label', title);
    root.append(body); body.append(el('h2', '', title));
    const s = { root, body, vault: D.state.vault, focus: document.activeElement };
    s.key = e => {
      if (D.isTopModal && !D.isTopModal(root)) return;
      if (s.scanner && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); s.stopScan?.(); return; }
      if (e.key === 'Escape') { e.stopPropagation(); requestClose(s); }
      if (e.key === 'Tab') {
        const f = [...(s.scanner || s.photoPanel || body).querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(n => !n.disabled && !n.hidden && n.getClientRects().length);
        const first = f[0], last = f.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    body.append(button('Закрыть', () => requestClose(s), 'btn loyalty-close'));
    root.addEventListener('click', e => { if (e.target === root) requestClose(s); });
    document.body.append(root); screen = s; document.addEventListener('keydown', s.key, true); body.querySelector('button').focus(); return s;
  }
  function compactHeader(s) {
    const header = el('header', 'loyalty-editor-header');
    const closeButton = s.body.querySelector('.loyalty-close');
    closeButton.textContent = '×'; closeButton.setAttribute('aria-label', 'Закрыть карту');
    header.append(s.body.querySelector('h2'), closeButton); s.body.prepend(header);
  }
  async function save(s, entry) {
    if (saving || !active(s) || !D.requireRealVault?.() || !active(s)) return false;
    const vault = s.vault, arr = vault.sections.loyalty;
    if (!Array.isArray(arr)) { D.toast?.('Раздел карт недоступен.'); return false; }
    const i = arr.findIndex(x => x.id === entry.id);
    if (i < 0 && D.canAdd) {
      const allowed = await D.canAdd('loyalty');
      if (!allowed || !active(s) || saving) return false;
    }
    if (i < 0) arr.push(entry); else arr[i] = entry;
    saving = true;
    try {
      await D.saveFile();
      if (!active(s)) return false;
      D.refresh?.(); return true;
    } catch (e) {
      // saveFile may time out while disk I/O is still completing. Keep memory truthful;
      // never roll back a write that may already be persisted. Stable draft ID allows retry.
      if (active(s)) {
        D.refresh?.();
        D.toast?.('Карта осталась в памяти, но запись в файл не подтверждена. Повторите сохранение. ' + (D.saveErrorLabel?.(e) || ''));
      }
      return false;
    } finally { saving = false; }
  }
  function renderLoyaltyCard(entry) {
    const row = el('article', 'loyalty-list-card');
    const owner = D.state.vault;
    const open = button('', () => { if (row.isConnected && D.state.vault === owner) openCard(entry); }, 'loyalty-card-open');
    const p = entry.images?.find(p => p.side === 'front') || entry.images?.[0];
    if (p) open.append(photo(p, entry.description || 'Карта'));
    else { const initial = el('span', 'loyalty-initial', (entry.description || 'К').trim().slice(0, 1).toLocaleUpperCase()); initial.style.backgroundColor = cardColor(entry); open.append(initial); }
    const text = el('span', 'loyalty-card-text');
    text.append(el('strong', 'loyalty-list-title', entry.description || 'Карта'), el('span', 'loyalty-list-number', formatLoyaltyNumber(entry.number))); open.append(text);
    if (entry.favorite) { const star = el('span', 'loyalty-favorite', '★'); star.setAttribute('aria-label', 'Избранная'); open.append(star); }
    row.append(open);
    const live = () => !disposed && row.isConnected && D.state.vault === owner
      && owner?.sections?.loyalty?.some(item => item === entry);
    const swipe = attachLoyaltySwipe(row, open, {
      isActive: () => live() && !deletingFromList && !screen,
      onEdit: () => { if (live()) openEditor(entry); },
      onDelete: D.deleteEntry ? async () => {
        if (!live() || deletingFromList) return;
        const pending = {}; deletingFromList = pending;
        try { await D.deleteEntry(entry); }
        catch (e) { if (live()) D.toast?.('Не удалось удалить карту. ' + (D.saveErrorLabel?.(e) || '')); }
        finally { if (deletingFromList === pending) deletingFromList = null; }
      } : undefined,
    });
    swipeRows.set(row, { api: swipe, mounted: false });
    swipeObserver.observe(document.body, { childList: true, subtree: true });
    return row;
  }
  function renderList(container, entries = D.state.vault?.sections?.loyalty || [], options = {}) {
    lists.add(container); container.replaceChildren();
    for (const entry of listCards(entries, options)) container.append(renderLoyaltyCard(entry));
    if (!container.childElementCount) container.append(el('p', '', 'Здесь будут ваши дисконтные карты.'));
    return container;
  }
  function openCard(entry) {
    if (screen?.editor) { const owner = screen.vault; return requestClose(screen).then(closed => { if (closed && !screen && D.state.vault === owner) return openCard(entry); }); }
    const s = modal(entry.description || 'Дисконтная карта'); if (!s) return;
    s.body.classList.add('loyalty-detail-card'); compactHeader(s);
    const hero = el('div', 'loyalty-card-face'); hero.style.setProperty('--card-color', cardColor(entry)); s.body.append(hero);
    const canvas = el('canvas', 'loyalty-barcode');
    if (entry.barcodeType) {
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Код карты');
      try { drawBarcode(canvas, entry.barcodeType, entry.barcodeValue); hero.append(canvas); canvas.tabIndex = 0; canvas.setAttribute('role', 'button'); canvas.setAttribute('aria-label', 'Показать код на кассе'); canvas.onclick = () => openCheckout(entry); canvas.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCheckout(entry); } }; s.bright = true; brightness('maximize', s); }
      catch { hero.append(el('p', '', 'Код не удалось показать. Используйте номер или фото карты.')); }
    }
    if (entry.number) hero.append(el('p', 'loyalty-number', formatLoyaltyNumber(entry.number)));
    s.body.append(button('Показать на кассе', () => openCheckout(entry), 'btn primary loyalty-checkout-action'));
    const pictures = el('div', 'loyalty-detail-photos');
    for (const p of entry.images || []) { const zoom = button('', () => openPhoto(entry, p)); zoom.setAttribute('aria-label', 'Увеличить фото'); const title=p.side === 'back' ? 'Оборотная сторона' : 'Лицевая сторона'; zoom.append(photo(p, title),el('span','',title)); pictures.append(zoom); }
    if (pictures.childElementCount) s.body.append(pictures);
    if (entry.note) s.body.append(el('p', 'loyalty-note', entry.note));
    const quick = el('div', 'loyalty-detail-actions');
    if (entry.number) quick.append(button('Скопировать номер', () => { if (active(s)) D.copyText?.(normalizeLoyaltyNumber(entry.number)); }));
    quick.append(button('Изменить', () => openEditor(entry))); s.body.append(quick);
    const more = el('details', 'loyalty-card-more'); more.append(el('summary','','Другие действия')); s.body.append(more);
    const fav = button(entry.favorite ? 'Убрать из избранного' : 'В избранное', async () => {
      fav.disabled = true;
      try { const updated = makeCard({ ...entry, favorite: !entry.favorite }, entry); updated.number = normalizeLoyaltyNumber(entry.number); await save(s, updated); if (active(s) && s.vault.sections.loyalty.includes(updated)) openCard(updated); }
      catch (e) { if (active(s)) D.toast?.(e.message); }
      finally { if (active(s)) fav.disabled = false; }
    });
    more.append(fav);
    if (entry.favorite) for (const [direction, title] of [['up', 'Выше в избранном'], ['down', 'Ниже в избранном']]) {
      more.append(button(title, async () => {
        if (!active(s) || saving || !D.requireRealVault?.()) return;
        if (!moveFavorite(s.vault.sections.loyalty, entry.id, direction)) return;
        saving = true;
        try { await D.saveFile(); if (active(s)) D.refresh?.(); }
        catch { if (active(s)) { D.refresh?.(); D.toast?.('Порядок изменён в памяти, запись не подтверждена.'); } }
        finally { saving = false; }
      }));
    }
    if (D.deleteEntry) {
      const remove = button('Удалить карту', async () => {
        if (!active(s)) return; remove.disabled = true;
        try { const deleted = await D.deleteEntry(entry); if (active(s) && deleted === true) forceClose(); }
        catch (e) { if (active(s)) D.toast?.('Не удалось удалить карту. ' + (D.saveErrorLabel?.(e) || '')); }
        finally { if (active(s)) remove.disabled = false; }
      }); remove.classList.add('loyalty-danger'); more.append(remove);
    }
    return s.root;
  }
  function openCheckout(entry) {
    const s = modal('На кассе'); if (!s) return;
    s.checkout = true; s.root.classList.add('loyalty-checkout');
    s.body.append(el('p', 'loyalty-store-name', entry.description || 'Дисконтная карта'));
    const canvas = el('canvas', 'loyalty-barcode'); canvas.setAttribute('aria-label', 'Код карты');
    if (entry.barcodeType) {
      try { drawBarcode(canvas, entry.barcodeType, entry.barcodeValue); s.body.append(canvas); }
      catch { s.body.append(el('p', '', 'Код не удалось показать.')); }
    } else if (entry.images?.length) {
      const front = entry.images.find(p => p.side === 'front') || entry.images[0];
      const frame=el('div','loyalty-photo-zoom');frame.append(photo(front,'Фото карты для кассы'));s.body.append(frame);
    }
    if (entry.number) s.body.append(el('p', 'loyalty-number', formatLoyaltyNumber(entry.number)));
    if (entry.number) s.body.append(button('Скопировать номер', () => { if (active(s)) D.copyText?.(normalizeLoyaltyNumber(entry.number)); }));
    s.body.append(button('Вернуться к карте', () => { if (active(s)) openCard(entry); }));
    s.bright = true; brightness('maximize', s);
    s.timeout = setTimeout(() => { if (active(s)) forceClose(); }, 5 * 60 * 1000);
  }
  function openPhoto(entry, page) {
    const s = modal('Фото карты'); if (!s) return;
    const frame = el('div', 'loyalty-photo-zoom'), img = photo(page, 'Фото карты'); frame.append(img); s.body.append(frame);
    const label = el('label', '', 'Масштаб фото'), zoom = el('input'); zoom.type = 'range'; zoom.min = '1'; zoom.max = '4'; zoom.step = '.25'; zoom.value = '1';
    zoom.oninput = () => { img.style.width = `${Number(zoom.value) * 100}%`; }; label.append(zoom); s.body.append(label);
    s.body.append(button('Вернуться к карте', () => { if (active(s)) openCard(entry); }));
  }
  function resumeDraft() {
    if (disposed || !D.state.vault || !D.requireRealVault?.()) return;
    const saved = drafts.read(); if (!saved) return;
    if (screen?.editor && screen.draftId === saved.id) return screen.root;
    const entry = saved.entryId ? D.state.vault.sections.loyalty.find(e => e.id === saved.entryId) : null;
    return launchEditor(entry, saved);
  }
  function openEditor(entry = null) {
    if (!D.requireRealVault?.(() => openEditor(entry))) return;
    if (screen?.editor) return screen.root;
    if (drafts.read()) { D.toast?.('Продолжите незавершённую карту или удалите её черновик.'); return resumeDraft(); }
    if (!entry && D.canAdd) {
      const vault = D.state.vault, token = generation;
      const proceed = allowed => { if (allowed && !disposed && generation === token && D.state.vault === vault) return launchEditor(null); };
      try {
        const allowed = D.canAdd('loyalty');
        if (allowed?.then) return allowed.then(proceed).catch(() => {});
        return proceed(allowed);
      } catch { return; }
    }
    return launchEditor(entry);
  }
  function launchEditor(entry, saved = null) {
    const original = entry;
    entry = saved ? { ...entry, ...saved.data } : entry;
    const s = modal(original ? 'Изменить карту' : 'Добавить карту'); if (!s) return;
    s.root.classList.add('loyalty-editor-back'); s.body.classList.add('loyalty-editor');
    const header = el('header', 'loyalty-editor-header');
    const closeButton = s.body.querySelector('.loyalty-close');
    closeButton.textContent = '×'; closeButton.setAttribute('aria-label', 'Закрыть редактор карты');
    header.append(s.body.querySelector('h2'), closeButton); s.body.prepend(header);
    const viewport = window.visualViewport;
    const fitViewport = () => {
      if (!active(s) || !viewport) return;
      s.root.style.height = `${viewport.height}px`; s.root.style.top = `${viewport.offsetTop}px`;
    };
    viewport?.addEventListener('resize', fitViewport); viewport?.addEventListener('scroll', fitViewport);
    s.layoutCleanup = () => { viewport?.removeEventListener('resize', fitViewport); viewport?.removeEventListener('scroll', fitViewport); };
    fitViewport();
    let images = (entry?.images || []).map(p => ({ ...p }));
    let draft = { ...(original || {}), id: saved?.id || original?.id || crypto.randomUUID() }; s.editor = true;
    s.draftId = draft.id;
    // A previous save may have committed the card before draft cleanup failed.
    // Rebase only if its saved draft contents exactly match that committed card.
    const comparable = (data, key) => key === 'number' ? normalizeLoyaltyNumber(data[key]) : key === 'description' ? String(data[key] || '').trim() : String(data[key] || '');
    const matchesSaved = saved && original && ['description','number','note','barcodeType','barcodeValue','color'].every(k => comparable(original,k) === comparable(saved.data,k))
      && !!original.favorite === !!saved.data.favorite && JSON.stringify(original.images || []) === JSON.stringify(saved.data.images || []);
    const baseUpdatedAt = matchesSaved ? original.updatedAt : saved ? saved.baseUpdatedAt : original?.updatedAt || null;
    const entryId = saved ? saved.entryId : original?.id || null;
    let photoBusy = false, codeRevision = 0;
    const form = el('form', 'loyalty-form'); form.noValidate = true; s.body.append(form);
    const content = el('div', 'loyalty-editor-scroll'); form.append(content);
    const fields = {};
    function field(name, title, tag = 'input') {
      const label = el('label', 'form-row', title), input = el(tag); input.name = name; input.value = entry?.[name] || '';
      if (tag === 'input') input.type = 'text'; label.append(input); content.append(label); fields[name] = input; return input;
    }
    field('description', 'Название карты').required = true;
    fields.description.placeholder = 'Например, Перекрёсток'; fields.description.autocomplete = 'off';
    const actions = el('div', 'loyalty-add-actions'); content.append(actions); content.append(fields.description.parentElement);
    field('number', 'Номер карты'); fields.number.placeholder = 'Номер, напечатанный на карте';
    fields.number.autocomplete = 'off';
    bindLoyaltyNumber(fields.number);
    const optional = el('span', 'loyalty-optional', 'необязательно'); fields.number.parentElement.insertBefore(optional, fields.number);
    field('note', 'Заметка', 'textarea'); fields.note.rows = 2;
    fields.note.placeholder = 'Например: карта оформлена на супругу';
    const type = field('barcodeType', 'Формат кода', 'select');
    for (const [value, text] of [['', 'Только номер'], ['EAN13', 'EAN-13'], ['EAN8', 'EAN-8'], ['CODE128', 'Code 128'], ['UPC', 'UPC-A'], ['QR', 'QR']]) { const opt = el('option', '', text); opt.value = value; type.append(opt); }
    type.value = entry?.barcodeType || '';
    if (type.value !== (entry?.barcodeType || '')) { const opt = el('option', '', entry.barcodeType); opt.value = entry.barcodeType; type.append(opt); type.value = entry.barcodeType; }
    const value = field('barcodeValue', 'Значение кода');
    // Keep raw recognized values in the protected draft without asking the user to choose a symbology.
    const details = el('div', 'loyalty-technical'); details.hidden = true;
    details.append(type.parentElement, value.parentElement);
    value.disabled = !type.value;
    type.onchange = () => { value.disabled = !type.value; if (!type.value) value.value = ''; };
    const favorite = field('favorite', 'Избранная'); favorite.type = 'checkbox'; favorite.checked = !!entry?.favorite;
    favorite.parentElement.hidden = true;
    const favoriteRow = el('div', 'loyalty-favorite-row');
    const favoriteStar = el('span', 'loyalty-star'); favoriteStar.setAttribute('aria-hidden', 'true');
    const starIcon = icon('star'); favoriteStar.append(starIcon);
    const favoriteToggle = button('', () => {
      favorite.checked = !favorite.checked; syncFavorite(); favorite.dispatchEvent(new Event('change', { bubbles: true }));
    }, 'loyalty-favorite-toggle');
    function syncFavorite() {
      favoriteRow.dataset.favorite = String(favorite.checked);
      favoriteToggle.setAttribute('aria-pressed', String(favorite.checked));
      starIcon.setAttribute('fill', favorite.checked ? 'currentColor' : 'none');
      starIcon.setAttribute('stroke', 'currentColor'); starIcon.setAttribute('stroke-width', '1.7');
      favoriteToggle.replaceChildren(el('span', 'loyalty-favorite-state', favorite.checked ? 'Убрать из избранного' : 'Добавить в избранное'));
    }
    syncFavorite(); favoriteRow.append(favoriteStar, favoriteToggle); content.append(favoriteRow);
    const extra = el('details', 'loyalty-extra'), extraTitle = el('summary');
    extraTitle.append(el('strong', '', 'Цвет карты'));
    extra.append(extraTitle);
    const noteOptions = el('details', 'loyalty-note-options'); noteOptions.open = !!entry?.note;
    noteOptions.append(el('summary','','Добавить заметку · необязательно'), fields.note.parentElement);
    const color = field('color', 'Цвет карты', 'select'); color.parentElement.hidden = true;
    const palette = el('div', 'loyalty-palette'); palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', 'Цвет карты');
    const swatches = [];
    for (const [i, c] of LOYALTY_COLORS.entries()) {
      const title = LOYALTY_COLOR_NAMES[i];
      const opt = el('option', '', title); opt.value = c; color.append(opt);
      const swatch = button('', () => { color.value = c; syncPalette(); color.dispatchEvent(new Event('change', { bubbles: true })); }, 'loyalty-swatch');
      swatch.style.setProperty('--swatch', c); swatch.setAttribute('aria-label', title); palette.append(swatch); swatches.push(swatch);
    }
    color.value = cardColor(entry || {});
    function syncPalette() { swatches.forEach((swatch, i) => { const selected = color.value === LOYALTY_COLORS[i]; swatch.setAttribute('aria-pressed', String(selected)); swatch.textContent = selected ? '✓' : ''; }); }
    syncPalette(); extra.append(palette);
    const status = el('p', 'loyalty-status'); status.id = 'loyalty-editor-status'; status.setAttribute('role', 'status');
    const preview = el('canvas', 'loyalty-barcode'); preview.hidden = true;
    preview.setAttribute('role','img');preview.setAttribute('aria-label','Распознанный код карты');
    const codeTools = el('div', 'loyalty-code-tools');
    const codeTitle=el('span','loyalty-code-title');let deletingCode=false;
    const removeCode=button('',async()=>{
      if(!active(s)||deletingCode||photoBusy)return;
      const revision=codeRevision,payload=value.value,format=type.value;
      deletingCode=true;removeCode.disabled=true;
      try{
        const confirmed=await D.dlgConfirm?.('Удалить распознанный код? Номер и фотографии карты останутся.',{title:'Удалить код?',ok:'Удалить',cancel:'Отмена',danger:true});
        if(!confirmed||!active(s)||revision!==codeRevision||payload!==value.value||format!==type.value)return;
        codeRevision++;type.value='';value.value='';value.disabled=true;scanArea.replaceChildren();s.capture?.();updatePreview();scan.focus();
      }catch{if(active(s))D.toast?.('Не удалось подтвердить удаление. Код сохранён.');}
      finally{deletingCode=false;if(active(s))removeCode.disabled=false;}
    },'btn loyalty-remove-code');
    removeCode.setAttribute('aria-label','Удалить код');removeCode.title='Удалить код';removeCode.append(icon('trash'));
    codeTools.append(codeTitle,removeCode);
    function updatePreview() {
      preview.hidden = true;
      codeTools.hidden = !type.value && !value.value;
      codeTitle.replaceChildren(icon(type.value==='QR'?'qr':'barcode'),el('span','',type.value==='QR'?'QR-код':'Штрихкод'));
      if (!type.value) { status.textContent = images.length ? 'Фото добавлено. Если код не распознан, можно показать фотографию на кассе.' : ''; return; }
      try { drawBarcode(preview, type.value, value.value); preview.hidden = false; status.textContent = 'Код распознан и готов для кассы.'; } catch { status.textContent = 'Код не удалось прочитать. Отсканируйте его заново или уберите код и сохраните номер или фото.'; }
    }
    function applyCode(result) { if (!active(s)) return; codeRevision++; type.value = result.barcodeType; value.disabled = false; value.value = result.barcodeValue; updatePreview(); s.capture?.(); }
    const scanArea = el('div', 'loyalty-scan');
    let preferredCamera = '';
    const scan = button('Сканировать код', () => {
      if (photoBusy) { status.textContent='Дождитесь обработки фотографии.'; return; }
      s.stopScan?.(); scanArea.replaceChildren();
      const request = { stopped: false, stream: null, cancel: null };
      s.permissionRequest = request;
      const video = el('video'), scratch = el('canvas'); scratch.hidden = true;
      const camera = el('section', 'loyalty-scan-window'); camera.setAttribute('role','dialog'); camera.setAttribute('aria-label','Сканирование карты');
      const cameraHeader=el('header','loyalty-scan-header');
      const back=button('Назад',()=>s.stopScan?.(),'btn loyalty-scan-back');
      cameraHeader.append(back,el('h2','','Сканировать код'));
      const stage=el('div','loyalty-camera-stage');stage.append(video,scratch);
      const guide=el('div','loyalty-camera-guide');guide.setAttribute('aria-hidden','true');stage.append(guide);
      const cameraMessage=el('p','loyalty-camera-message','Открываем камеру…');cameraMessage.setAttribute('role','status');
      const controls=el('div','loyalty-camera-controls');
      camera.append(cameraHeader,stage,cameraMessage,el('p','loyalty-camera-hint','Держите карту целиком в кадре. Если изображение размыто, немного отведите телефон.'),controls);
      s.scanner=camera;s.body.append(camera);form.inert=true;header.inert=true;
      scan.disabled = true;back.focus();
      s.stopScan = () => {
        request.stopped = true;
        // Own native tracks before the system-window wrapper returns to the scanner.
        const pending = request.stream; request.stream = null;
        pending?.getTracks().forEach(t => t.stop());
        request.cancel?.(); request.cancel = null;
        s.stop?.(); scanArea.replaceChildren(); scan.disabled = false;
        camera.remove(); if(s.scanner===camera)s.scanner=null; form.inert=false;header.inert=false;
        if(active(s)&&!document.hidden)scan.focus();
        if (s.permissionRequest === request) s.permissionPending = false;
      };
      s.stop = startBarcodeScan(video, scratch, {
        deviceId: preferredCamera,
        getViewAspect: () => stage.clientWidth / stage.clientHeight,
        mediaDevices: {
          enumerateDevices: () => navigator.mediaDevices?.enumerateDevices?.() || Promise.resolve([]),
          getUserMedia: async constraints => {
          s.permissionPending = true;
          try {
            const stream = await (D.withSystemWindow || (fn => fn()))(async () => {
              const acquired = await navigator.mediaDevices.getUserMedia(constraints);
              if (!active(s) || request.stopped) {
                acquired.getTracks().forEach(t => t.stop());
                throw new Error('Scan stopped');
              }
              request.stream = acquired;
              return acquired;
            }, { untilForeground: true });
            if (!active(s) || request.stopped) throw new Error('Scan stopped');
            if (active(s) && document.hidden) await new Promise(resolve => {
              const done = () => { document.removeEventListener('visibilitychange', visible); request.cancel = null; resolve(); };
              const visible = () => { if (!document.hidden || !active(s)) done(); };
              request.cancel = done; document.addEventListener('visibilitychange', visible);
            });
            if (!active(s) || request.stopped) throw new Error('Scan stopped');
            request.stream = null; // transfer ownership to startBarcodeScan only now
            return stream;
          } catch (e) {
            const pending = request.stream; request.stream = null;
            pending?.getTracks().forEach(t => t.stop());
            throw e;
          } finally { if (s.permissionRequest === request) s.permissionPending = false; }
        } },
        isActive: () => active(s) && !request.stopped,
        onCamera: control => {
          if(!active(s)||request.stopped)return;
          camera.dataset.focusMode=control.focusMode||'unavailable';
          if(control.cameraId)preferredCamera=control.cameraId;
          if(controls.dataset.ready){const zoom=controls.querySelector('input');if(zoom&&control.zoom)zoom.value=control.zoom.value;return;}
          controls.dataset.ready='true';
          cameraMessage.textContent='Наведите камеру на штрихкод или QR-код.';
          if(control.cameras?.length>1)controls.append(button('Другая камера',()=>{
            if(!active(s)||request.stopped)return;
            // Some WebViews omit the actual ID. Retain the requested cycling position
            // without presenting it as measured metadata; discard vanished candidates.
            const currentId=control.cameraId || (control.cameras.some(c=>c.deviceId===preferredCamera)
              ? preferredCamera : control.cameras[0].deviceId);
            const i=control.cameras.findIndex(c=>c.deviceId===currentId);
            preferredCamera=control.cameras[(i+1)%control.cameras.length].deviceId;
            s.stopScan?.();scan.click();
          },'btn loyalty-switch-camera'));
          if(control.zoom){const label=el('label','','Масштаб');const zoom=el('input');zoom.type='range';zoom.min=control.zoom.min;zoom.max=Math.max(control.zoom.min,Math.min(control.zoom.max,4));zoom.step=control.zoom.step||0.1;zoom.value=control.zoom.value;zoom.setAttribute('aria-label','Масштаб камеры');zoom.onchange=()=>void control.setZoom(Number(zoom.value));label.append(zoom);controls.append(label);}
        },
        onResult: result => { if (!active(s) || request.stopped) return; applyCode(result); s.stopScan?.(); status.scrollIntoView({block:'nearest'}); },
        onError: () => { if (!active(s)||request.stopped) return; cameraMessage.textContent = 'Не удалось открыть камеру. Разрешите доступ к ней или вернитесь к добавлению фото и номера.'; controls.replaceChildren(button('Повторить',()=>{if(!active(s)||request.stopped)return;s.stopScan?.();scan.click();})); }
      });
    }); actions.append(scan);
    for (const [i, action] of [...actions.children].entries()) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', i === 0 ? 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M7 8v8m4-8v8m3-8v8m3-8v8' : 'M3 3h18v18H3z M3 17l5-5 4 4 4-6 5 7 M7 7h2v2H7z'); icon.append(path); action.prepend(icon);
    }
    const attachments = el('section', 'loyalty-attachments');
    const photoHeading = el('div', 'loyalty-photo-heading'); photoHeading.append(el('h3', '', 'Фото карты'), el('span', 'loyalty-optional', 'необязательно'));
    const photos = el('div', 'loyalty-photos'); attachments.append(photoHeading, photos);
    content.insertBefore(attachments, fields.description.parentElement);
    content.append(status, codeTools, preview, scanArea, extra, noteOptions, details);
    function renderPhotos() {
      photos.replaceChildren();
      for (const [side, title] of [['front', 'Лицевая сторона'], ['back', 'Оборотная сторона']]) {
        const box = el('section', 'loyalty-photo-side'); box.append(el('h4', '', title)); const page = images.find(p => p.side === side);
        const pick = async camera => {
          if (photoBusy || !active(s)) return; photoBusy = true;
          const recognitionRevision = codeRevision;
          const recognizePhoto = !type.value && !value.value;
          s.closePhotoPanel?.();
          s.stopScan?.(); scanArea.replaceChildren(); scan.disabled = false;
          try {
            s.picking = true;
            let files;
            try { files = await (D.withSystemWindow || (fn => fn()))(() => chooseFiles({ camera })); }
            finally { s.picking = false; }
            if (!active(s) || !files.length) return;
            let recognitionError = null;
            const codesPromise = recognizePhoto ? decodeCardImage(files[0]).catch(error => { recognitionError = error; return []; }) : Promise.resolve([]);
            // The existing crop picker has its own listeners; invoke its Cancel path on lock,
            // including a crop that mounts after image decoding finishes.
            const prior = new Set(document.querySelectorAll('.crop-editor'));
            const cancelCrop = () => document.querySelectorAll('.crop-editor').forEach(c => { if (!prior.has(c)) c.querySelector('.crop-cancel')?.click(); });
            s.cancelPhoto = cancelCrop;
            const observer = new MutationObserver(() => { if (!active(s)) cancelCrop(); });
            observer.observe(document.body, { childList: true, subtree: true });
            let result;
            try { result = await filesToPages(files.slice(0, 1)); }
            finally { observer.disconnect(); s.cancelPhoto = null; }
            if (!active(s)) return;
            const p = result.pages[0];
            if (result.errors.length || p?.mime === 'application/pdf') { status.textContent = 'Выберите фотографию JPG, PNG или WEBP.'; return; }
            if (p) {
              images = [...images.filter(x => x.side !== side), { ...p, side }]; renderPhotos(); s.capture?.();updatePreview();
              if(!recognizePhoto)return;
              const codes = await codesPromise; if (!active(s) || recognitionRevision !== codeRevision) return;
              scanArea.replaceChildren();
              if (codes.length === 1) applyCode(codes[0]);
              else if (codes.length > 1) { status.textContent = 'На фото несколько кодов. Выберите код карты.'; for (const code of codes) scanArea.append(button(code.barcodeType + ': ' + code.barcodeValue, () => { if (active(s)) { applyCode(code); scanArea.replaceChildren(); } })); }
              else { status.textContent = recognitionError ? 'Не удалось распознать фото. ' + (recognitionError.message || 'Попробуйте другое изображение.') : 'Код не найден. Можно ввести номер или оставить фотографию карты.'; scanArea.append(button('Ввести номер', () => fields.number.focus())); }
            }
          } catch { if (active(s)) status.textContent = 'Не удалось добавить фото. Попробуйте ещё раз.'; }
          finally { photoBusy = false; if (camera) { if (D.cleanupCameraTemp) D.cleanupCameraTemp(); else cleanupCameraTemp(window.NativePlugins?.Filesystem); } }
        };
        if (side === 'front') s.pickFront = pick;
        if(page){
          const open=button('',()=>{
            if(!active(s)||photoBusy)return;
            s.stopScan?.();s.closePhotoPanel?.();
            const panel=el('section','loyalty-photo-panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-label',title);
            const panelHeader=el('header','loyalty-photo-panel-header'),back=button('Назад',()=>s.closePhotoPanel?.());
            panelHeader.append(back,el('h2','',title));
            const panelBody=el('div','loyalty-photo-panel-body');panelBody.append(photo(page,title));
            const actions=el('div','loyalty-photo-panel-actions');
            actions.append(button('Переснять',()=>pick(true)),button('Из галереи',()=>pick(false)));
            let deleting=false;
            const remove=button('Удалить фото',async()=>{
              if(!active(s)||s.photoPanel!==panel||deleting)return;
              deleting=true;remove.disabled=true;
              try{
                const confirmed=await D.dlgConfirm?.('Удалить фотографию этой стороны карты?',{title:'Удалить фото?',ok:'Удалить',cancel:'Отмена',danger:true});
                if(!confirmed||!active(s)||s.photoPanel!==panel||images.find(p=>p.side===side)!==page)return;
                codeRevision++;scanArea.replaceChildren();images=images.filter(p=>p.side!==side);
                s.closePhotoPanel?.();renderPhotos();updatePreview();s.capture?.();photos.querySelector('button')?.focus();
              }catch{if(active(s))D.toast?.('Не удалось подтвердить удаление. Фото сохранено.');}
              finally{deleting=false;if(panel.isConnected)remove.disabled=false;}
            },'btn loyalty-danger');actions.append(remove);panelBody.append(actions);panel.append(panelHeader,panelBody);
            s.photoPanel=panel;s.body.append(panel);form.inert=true;header.inert=true;
            s.closePhotoPanel=()=>{panel.remove();if(s.photoPanel===panel)s.photoPanel=null;form.inert=false;header.inert=false;if(active(s)&&open.isConnected&&!document.hidden)open.focus();};
            back.focus();
          },'loyalty-photo-open');
          open.setAttribute('aria-label',title+': посмотреть или изменить фото');
          const edit=el('span','loyalty-photo-edit');edit.append(icon('edit'));
          open.append(photo(page,title),edit);box.append(open);
        }else box.append(button('Снять фото',()=>pick(true)),button('Из галереи',()=>pick(false)));
        photos.append(box);
      }
    }
    renderPhotos();
    const snapshot = () => JSON.stringify([Object.entries(fields).map(([k,v]) => [k, k === 'favorite' ? v.checked : k === 'number' ? normalizeLoyaltyNumber(v.value) : v.value]), images]);
    const baseline = snapshot(); let captured = !!saved; s.isDirty = () => captured || snapshot() !== baseline;
    s.capture = () => {
      if (!active(s) || (!captured && snapshot() === baseline)) return;
      captured = true;
      const data = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, k === 'favorite' ? v.checked : k === 'number' ? normalizeLoyaltyNumber(v.value) : v.value]));
      drafts.write(s.vault, { id: s.draftId, entryId, baseUpdatedAt, data: { ...data, images } });
    };
    function changed(e) {
      if (!active(s)) return;
      e.target.removeAttribute('aria-invalid');
      if (['barcodeType','barcodeValue'].includes(e.target.name)) { codeRevision++; scanArea.replaceChildren(); s.stopScan?.(); }
      s.capture?.(); updatePreview();
    }
    form.addEventListener('input', changed);
    form.addEventListener('change', changed);
    updatePreview();
    const footer = el('footer', 'loyalty-editor-footer');
    const submit = el('button', 'btn primary', 'Сохранить карту'); submit.type = 'submit'; footer.append(submit); form.append(footer);
    const focusInvalid = input => {
      if (input === type || input === value) { status.textContent = 'Код не удалось прочитать. Отсканируйте его заново или уберите код и сохраните номер или фото.'; codeTools.hidden = false; codeTools.querySelector('button').focus(); codeTools.scrollIntoView({block:'nearest'}); return; }
      for (let parent = input.parentElement; parent && parent !== form; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
      input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', status.id);
      input.focus(); input.scrollIntoView({ block: 'nearest' });
    };
    form.onsubmit = async e => {
      e.preventDefault(); if (!active(s) || saving || s.submitting || s.scanner || s.photoPanel || deletingCode) return;
      if (photoBusy) { status.textContent = 'Дождитесь обработки фото, затем сохраните карту.'; status.scrollIntoView({ block: 'nearest' }); return; }
      let invalidField = null;
      s.stopScan?.(); s.capture?.(); s.submitting = true; form.inert = true;
      try {
        const data = Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'favorite').map(([k, v]) => [k, k === 'number' ? normalizeLoyaltyNumber(v.value) : v.value]));
        const latest = s.vault.sections.loyalty.find(x => x.id === draft.id);
        const sameContent = latest && ['description', 'number', 'note', 'barcodeType', 'barcodeValue', 'color'].every(k => String(latest[k] || '') === String(data[k] || '')) && !!latest.favorite === favorite.checked && JSON.stringify(latest.images || []) === JSON.stringify(images);
        if (entryId && (!latest || (latest.updatedAt !== baseUpdatedAt && latest !== draft && !sameContent))) throw new Error('Карта изменилась после открытия черновика. Закройте редактор и проверьте карту.');
        invalidField = !data.description.trim() || data.description.trim().length > 200 ? fields.description
          : data.number.trim().length > 2048 ? fields.number
          : type.value ? (['EAN13','EAN8','CODE128','UPC','QR'].includes(type.value) ? value : type)
          : value.value ? type : fields.number;
        const card = makeCard({ ...data, favorite: favorite.checked, images }, draft);
        // makeCard trims text; legacy nonnumeric numbers must remain byte-for-byte.
        card.number = data.number;
        invalidField = null;
        const duplicate = findDuplicateCard(s.vault.sections.loyalty, card);
        if (duplicate) {
          if (!D.dlgConfirm) throw new Error('Карта с таким кодом уже есть.');
          const message = 'Такой код уже есть у карты «' + duplicate.description + '».';
          const choice = D.styledConfirm ? await D.styledConfirm({ title: 'Повтор карты', message, confirmText: 'Сохранить ещё одну', denyText: 'Открыть существующую карту', cancelText: 'Назад' })
            : (await D.dlgConfirm(message, { title: 'Повтор карты', ok: 'Сохранить ещё одну', cancel: 'Назад' }) ? 'save' : 'cancel');
          if (!active(s)) return;
          if (choice === 'deny') { forceClose(); openCard(duplicate); return; }
          if (choice !== 'save') { status.textContent = 'Черновик оставлен. Можно открыть существующую карту.'; scanArea.replaceChildren(button('Открыть существующую карту', () => { if (active(s)) { forceClose(); openCard(duplicate); } })); return; }
        }
        draft = card;
        submit.disabled = true; s.stopScan?.();
        const saved = await save(s, card);
        if (saved && active(s)) { drafts.remove(s.vault, s.draftId); await drafts.flush(s.vault); if (active(s)) { s.capture = null; forceClose(); openCard(card); } }
      } catch (e) { if (active(s)) status.textContent = e.message; }
      finally { s.submitting = false; if (active(s)) { submit.disabled = false; form.inert = false; if (invalidField) focusInvalid(invalidField); } }
    };
    return s.root;
  }
  return { renderList, renderLoyaltyCard, openCard, openEditor, resumeDraft, close, destroy };
}
