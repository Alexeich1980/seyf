import * as C from './crypto.js';
import * as UI from './ui.js';
import * as Store from './store.js';
import * as Gen from './generator.js';
import { defaultStore } from './storage.js';
import * as Auth from './auth.js';
import { createAutoLock, resumeDecision, foregroundDecision } from './autolock.js';
import { getHintParagraphs } from './hints.js';
import { validateSeedPhrase, parseSeedWords, SEED_LENGTHS, isSeedBannerDismissed, dismissSeedBanner, seedLengthChangeIsDirty, seedWordValid, invalidSeedWords } from './seed.js';
import { normalizeFieldValue, checkRequisite, hasRequisiteNorm } from './fieldnorm.js';
import { formatExpiry, formatExpiryLive, normalizeExpiryInput, checkCardExpiry } from './cardexp.js';
import { fieldInputProps, liveMaskFor, liveMaskSig, latinOnly, cardNumberValid, groupDigits, defaultMaxLength, INPUT_LIMITS, reformatWithCaret, endOnlyMask, endOnlyMaskField, SECRET_INPUT_ATTRS, editorInputType } from './fieldinput.js';
import { TOTP_DEFAULTS, base32Decode, generateTOTP, totpProgress, parseOtpauth, safeDigits, safePeriod, secretLongEnough } from './totp.js';
import { startQrScan, refocusTrack } from './qr-scan.js';
import * as Docs from './documents.js';
import { openDocViewer, chooseFiles, cameraFileToPage, filesToPages } from './doc-viewer.js';
import { cleanupCameraTemp as cleanCamTemp } from './camtemp.js';
import * as Gate from './gate.js';
import * as Payment from './payment.js';
import * as Access from './access.js';
import { computeAccess, runPurchase, autoRestorePro } from './pay.js';
import { createClipboardGuard, copyNeedsGuard, makeClipFlag, waitForFocus, clearAfterReload } from './clipboard.js';
import { DEFAULT_THEME, THEME_LABELS, normalizeTheme, nextTheme, themeSwatchIcon } from './theme.js';
import * as Demo from './demo.js';
import { decideStart, confirmVisible, masterStrength, validateMasterCreation, validateMasterChange } from './onboarding.js';
import { icon, eyeIconName, swipeCloses } from './icons.js';
import { displayOrder, arrowState, moveWithinGroup } from './listorder.js';
import { SAVE_TIMEOUT_MS, makeSerialSaver, saveErrorLabel, closeThenPersist, withTimeout, drainQueue, DRAIN_MS, drainWithRetry, withIdleTimeout, makeSharedLoader, wrapOnDisk } from './persist.js';
import { resolveIconId, renderCardIcon, sectionDefaultIcon } from './cardicons.js';
import { PICKER_ICON_IDS } from './raster-manifest.js';
import { backAction, sectionCounts as navSectionCounts, refreshPlan } from './navmodel.js';
import { visibleSections, toggleSectionHidden, getHiddenSections, sectionHasSecrets } from './secvis.js';
import { isBioLoginEnabled, setBioLoginEnabled, shouldOfferBio, getPasswordHint, setPasswordHint, hintLeaksPassword } from './biopref.js';
import { plural } from './plural.js';
import { cardFallbackTitle, needsCardFallbackTitle, fallbackTitleFor } from './cardtitle.js';
// batch2: разделы Контакты/Wi-Fi/Реквизиты. Импорт sectionsx дорегистрирует их подписи и
// схемы в UI.* (ядро не трогаем); ensureSections дозаполняет старый vault после апгрейда.
import { ensureSections } from './sectionsx.js';
import { telHref, openableHref, mailtoHref, linkLabel } from './contactlinks.js';
import { scheduleReveal } from './reveal.js';
import { verifyLicense } from './license.js';
import { SEED_NETWORKS, isKnownNetwork } from './seed-networks.js';
import { buildRequisitesShareText } from './share.js';
import { cardOpenMode, nextExpanded, expandActions } from './carddetail.js';

// Единый охранник буфера обмена: копирование секрета + очистка по TTL и при блокировке.
// 1.2.24 (п.1): флаг «буфер надо очистить» переживает перезагрузку при блокировке (секрет туда не
// пишется). После reload буфер очищается при первом фокусе (clearAfterReload).
// 1.2.25 (ревью 1.2.24, п.7): флаг - в localStorage, а не в sessionStorage: Android выгружает
// свёрнутое приложение, и sessionStorage пропадал вместе с процессом - буфер с секретом оставался.
// Во флаге только «1», секрета нет.
const clipFlag = makeClipFlag(lsGet());
const clipboardApi = (typeof navigator !== 'undefined' && navigator.clipboard) ? navigator.clipboard : { readText: async () => '', writeText: async () => {} };
const clip = createClipboardGuard({ clipboard: clipboardApi, flag: clipFlag });
const focusApi = {
  hasFocus: () => document.hasFocus(),
  addListener: (fn) => { window.addEventListener('focus', fn); document.addEventListener('visibilitychange', fn); },
  removeListener: (fn) => { window.removeEventListener('focus', fn); document.removeEventListener('visibilitychange', fn); },
};
clearAfterReload({ clipboard: clipboardApi, flag: clipFlag, ...focusApi }).catch(() => {});

// Адаптер оплаты выбирается лениво (после native.js): нативный RuStore Pay на телефоне; вне
// нативки - MockPayment ТОЛЬКО в тест-сборке (FULL), в релизе/сторе - «оплата недоступна»
// (ревью 1.3.0, п.1a: веб-часть боевого APK в браузере не выдаёт Pro). Один экземпляр на сессию.
let _paymentAdapter = null;
function getAdapter() {
  if (!_paymentAdapter) {
    _paymentAdapter = Payment.selectPaymentAdapter({
      isNativeApp: window.isNativeApp,
      NativePlugins: window.NativePlugins,
      flags: { full: Access.FULL, store: Access.STORE, demo: Access.DEMO },
    });
  }
  return _paymentAdapter;
}
// Pro по vault (ревью 1.3.0, п.1b): в боевой сборке признаётся только отметка RuStore/ключа;
// отметку тест-мока признаёт лишь тест-сборка (Access.FULL). Единая точка для гейта и меню.
function vaultIsPro(v) { return Gate.isPro(v, { anySource: Access.FULL }); }

// ЕДИНЫЙ источник правды о доступе к Полной версии (задание п.24, точки как в «Хомяке»).
// hasFullAccess = Access.FULL (debug/демо-сборка) ИЛИ лицензия/RuStore-покупка (обе персистятся
// в зашифрованный vault.pro → Gate.isPro). Чистая логика — в pay.js computeAccess (под тестом+мутацией).
// На этот источник завязан free-гейт (openEditor): в debug/демо лимиты сняты, в релизе активны.
function hasFullAccess() {
  return computeAccess({ full: Access.FULL, vault: state.vault, isPro: vaultIsPro });
}
// Точки входа как в «Хомяке» (window.UI.buyFullAccess/restorePurchase/hasFullAccess у него в
// purchase.js; здесь флоу-окно — openPaywall в этом же app.js, поэтому обёртки тонкие).
// ret — необязательный колбэк «вернуть, откуда пришли/после покупки» (используется гейтом лимита).
window.Pay = {
  hasFullAccess,
  buyFullAccess(ret) { openProFlow(typeof ret === 'function' ? ret : undefined); },
  restorePurchase(ret) { openPaywall({ reopen: typeof ret === 'function' ? ret : undefined }); },
};

const store = defaultStore();

const state = { file: null, vault: null, dek: null, dekRaw: null, demoMode: false };
let pendingReopen = null;   // что открыть после создания мастер-пароля (обычно редактор из демо)
// Заслон персистентности: в демо-режиме store.save недостижим (мутации перехватываются
// до сохранения), но guardedSave — машинный гарант инварианта «в демо на диск не пишем».
const guardedStoreSave = Demo.guardedSave(store, () => state.demoMode);
const $ = (s) => document.querySelector(s);
// localStorage может быть недоступен (приватный режим/политика) — безопасный доступ.
function lsGet() { try { return window.localStorage; } catch { return null; } }
let current = 'passwords';
// Двухуровневая навигация (8f, витрина): 'grid' — сетка плиток разделов (домашний экран),
// 'section' — список записей выбранного раздела. current — активный раздел в режиме 'section'.
let view = 'grid';
// Текущий поисковый запрос: поле #search живёт только на витрине; в разделе его нет,
// поэтому обращения к нему из общих обработчиков (избранное/удаление) идут через хелпер.
const currentQuery = () => { const s = $('#search'); return s ? s.value : ''; };
let activeEditor = null; // { isDirty(), save() } — открытый редактор с возможными правками
let revealSecrets = false; // глобальный показ/скрытие всех паролей
let totpTimer = null; // живое обновление кодов 2FA (снимается при смене раздела/блокировке)

// C2: это окно - верхнее? Окна добавляются в конец body, значит верхнее - последний .modal-back.
function isTopModal(back) {
  const all = document.querySelectorAll('.modal-back');
  return all.length > 0 && all[all.length - 1] === back;
}

// Закрытие по клику на фон — ТОЛЬКО если и нажатие, и отпускание были на самом фоне.
// Иначе выделение текста внутри окна (протяжка мышью с выходом на фон) ложно закрывало окно.
function closeOnBackdrop(back, handler) {
  let downOnBack = false;
  back.addEventListener('mousedown', (e) => { downOnBack = (e.target === back); });
  back.addEventListener('mouseup', (e) => {
    const ok = downOnBack && e.target === back;
    downOnBack = false;
    if (ok) handler();
  });
}

// Диалог подтверждения в стиле приложения. Возвращает 'save' | 'deny' | 'cancel'.
function styledConfirm({ title, message, confirmText = 'Сохранить', denyText = 'Не сохранять', cancelText = 'Отмена' }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const m = document.createElement('div');
    m.className = 'modal confirm';
    // ЗАСЛОН self-XSS (L2): title/message могут нести пользовательские данные - экранируем,
    // как в appDialog. Тексты кнопок - тоже, на случай передачи данных.
    const esc = UI.escapeHtml;
    m.innerHTML = `<h3>${esc(title)}</h3><p class="confirm-msg">${esc(message)}</p>
      <div class="modal-actions">
        <button class="cancel">${esc(cancelText)}</button>
        <button class="deny">${esc(denyText)}</button>
        <button class="save">${esc(confirmText)}</button>
      </div>`;
    const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done('cancel'); }
      else if (e.key === 'Enter') { e.stopPropagation(); done('save'); }
    };
    m.querySelector('.cancel').onclick = () => done('cancel');
    m.querySelector('.deny').onclick = () => done('deny');
    m.querySelector('.save').onclick = () => done('save');
    closeOnBackdrop(back, () => done('cancel'));
    document.addEventListener('keydown', onKey, true);
    back.appendChild(m);
    document.body.appendChild(back);
    m.querySelector('.save').focus();
  });
}

// Универсальные окна в стиле приложения — замена нативных alert/confirm/prompt.
// ctl (1.2.24): если передан, получает ctl.close(value) - закрыть окно программно (авто-продолжение).
function appDialog({ title, message, buttons, input, ctl }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const m = document.createElement('div');
    m.className = 'modal confirm';
    // ЗАСЛОН self-XSS (v3-1): message/placeholder/label/title могут содержать данные пользователя
    // (напр. список «плохих» seed-слов) - экранируем перед вставкой в innerHTML.
    const esc = UI.escapeHtml;
    let html = '';
    if (title) html += `<h3>${esc(title)}</h3>`;
    if (message) html += `<p class="confirm-msg">${esc(message)}</p>`;
    if (input) html += `<input class="dlg-input" type="${input.password ? 'password' : 'text'}" placeholder="${esc(input.placeholder || '')}">`;
    // Начальное значение поля ставим свойством (не через innerHTML) - безопасно и без экранирования.
    html += '<div class="modal-actions">' + buttons.map((b, i) => `<button data-i="${i}" class="${esc(b.kind || '')}">${esc(b.label)}</button>`).join('') + '</div>';
    m.innerHTML = html;
    const inp = m.querySelector('.dlg-input');
    if (inp && input && input.value != null) inp.value = String(input.value);
    const cancelBtn = buttons.find((b) => b.cancel) || {};
    const primaryBtn = buttons.find((b) => b.primary);
    let closed = false;
    const finish = (val) => { if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true); back.remove(); resolve(val); };
    if (ctl) ctl.close = (val) => finish(val);
    const pick = (b) => finish(input && b.primary ? (inp ? inp.value : null) : b.value);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(cancelBtn.value ?? null); }
      else if (e.key === 'Enter' && primaryBtn) { e.stopPropagation(); pick(primaryBtn); }
    };
    m.querySelectorAll('.modal-actions button').forEach((btn) => { btn.onclick = () => pick(buttons[+btn.dataset.i]); });
    closeOnBackdrop(back, () => finish(cancelBtn.value ?? null));
    document.addEventListener('keydown', onKey, true);
    back.appendChild(m);
    document.body.appendChild(back);
    (inp || m.querySelector('.modal-actions button:last-child')).focus();
  });
}
const dlgAlert = (message, title = 'Сейф') =>
  appDialog({ title, message, buttons: [{ label: 'Закрыть', value: true, primary: true, kind: 'save' }] });
const dlgConfirm = (message, { title = 'Подтверждение', ok = 'Да', cancel = 'Отмена', danger = false } = {}) =>
  appDialog({ title, message, buttons: [
    { label: cancel, value: false, cancel: true, kind: 'cancel' },
    { label: ok, value: true, primary: true, kind: danger ? 'deny' : 'save' },
  ] });
const dlgPrompt = (message, { title = 'Ввод', placeholder = '', password = false, value = '', ok = 'ОК', cancel = 'Отмена' } = {}) =>
  appDialog({ title, message, input: { placeholder, password, value }, buttons: [
    { label: cancel, value: null, cancel: true, kind: 'cancel' },
    { label: ok, value: '__input__', primary: true, kind: 'save' },
  ] });

// Пикер выбора из списка в гамме приложения (8d п.15) — замена нативного <select>.
// options: [{value,label}]; возвращает выбранный value или null (отмена). Стрелка/список
// оформлены в стиле окон приложения, ничего нативного (правило проекта).
function stylePicker({ title, options, value }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const m = document.createElement('div');
    m.className = 'modal picker';
    m.innerHTML = `<h3>${UI.escapeHtml(title)}</h3><div class="picker-list"></div>
      <div class="modal-actions"><button class="cancel">Отмена</button></div>`;
    const list = m.querySelector('.picker-list');
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'picker-item' + (o.value === value ? ' active' : '');
      b.textContent = o.label;
      b.onclick = () => finish(o.value);
      list.appendChild(b);
    }
    const finish = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    m.querySelector('.cancel').onclick = () => finish(null);
    closeOnBackdrop(back, () => finish(null));
    document.addEventListener('keydown', onKey, true);
    back.appendChild(m); document.body.appendChild(back);
  });
}

// Пикер иконки записи (8f B.10) — сетка чипов в гамме приложения. Первый чип «по разделу»
// (value ''), остальные — набор cardicons. Возвращает id, '' (авто) или null (отмена).
function openIconPicker(section, currentId) {
  return new Promise((resolve) => {
    const back = document.createElement('div'); back.className = 'modal-back';
    const m = document.createElement('div'); m.className = 'modal icon-picker';
    const cell = (id, val, label, isAuto) =>
      `<button type="button" class="iconcell${val === currentId ? ' active' : ''}${isAuto ? ' iconcell-auto' : ''}" data-v="${UI.escapeHtml(val)}" title="${UI.escapeHtml(label)}">${renderCardIcon(id, 40)}${isAuto ? '<span class="iconcell-tag">Авто</span>' : ''}</button>`;
    // Первая ячейка - «Авто»: иконка берётся по разделу (value ''). Она рисует тот же глиф,
    // что и явная иконка раздела, поэтому помечаем «Авто» и рамкой - иначе читается как дубль.
    let cells = cell(sectionDefaultIcon(section), '', 'Авто - иконка раздела', true);
    for (const id of PICKER_ICON_IDS) cells += cell(id, id, id);   // все 30 иконок набора
    m.innerHTML = `<h3>Иконка записи</h3>
      <div class="iconcell-grid">${cells}</div>
      <div class="modal-actions"><button class="cancel">Отмена</button></div>`;
    const finish = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    m.querySelectorAll('.iconcell').forEach((b) => { b.onclick = () => finish(b.dataset.v); });
    m.querySelector('.cancel').onclick = () => finish(null);
    closeOnBackdrop(back, () => finish(null));
    document.addEventListener('keydown', onKey, true);
    back.appendChild(m); document.body.appendChild(back);
  });
}

// Живая маска БЕЗ прыжка каретки в конец (1.2.22, баг живого теста: правка даты в середине ->
// каретка улетала в конец, Backspace удалял не тот символ). Расчёт позиции - чистая
// reformatWithCaret (fieldinput.js, тест+мутация). Значение не изменилось - value НЕ
// переприсваиваем (браузер сам держит каретку). Все маски редактора идут только через этот хелпер
// (заслон tests/patch-1222.test.mjs: нет голого «inp.value = mask(inp.value)» в input-обработчиках).
// 1.2.24 (0b): opts.endOnly - маска дат и номера карты работает ТОЛЬКО при наборе в конце строки
// (endOnlyMask); правка в середине значение не трогает (Gboard/IME ломали пересчёт каретки).
// Приведение к формату - на blur (opts.normalize, по умолчанию сама маска) и при сохранении.
function bindCaretMask(inp, formatter, opts = {}) {
  let prev = inp.value;
  let hadSelection = false;   // C11: было ли выделение перед правкой
  inp.addEventListener('beforeinput', () => {
    try { hadSelection = typeof inp.selectionStart === 'number' && inp.selectionStart !== inp.selectionEnd; }
    catch (err) { hadSelection = false; }
  });
  if (opts.endOnly) {
    const norm = opts.normalize || formatter;
    // 1.3.0 (L5): memo - последняя правка маски, дописавшая цифру (Backspace после «01.» -> «1»).
    // (Info): opts.onlyEdited - на blur приводим к формату, только если поле правили (старое
    // значение при одном касании/уходе с поля не переписывается).
    const memo = { auto: null };
    let edited = false;
    inp.addEventListener('input', (e) => {
      edited = true;
      const raw = inp.value;
      const caret = typeof inp.selectionStart === 'number' ? inp.selectionStart : raw.length;
      const r = endOnlyMask(raw, caret, formatter, { hadSelection, composing: !!(e && e.isComposing), inputType: e && e.inputType, memo });
      hadSelection = false;
      if (r.changed) {
        inp.value = r.value;
        try { if (document.activeElement === inp) inp.setSelectionRange(r.caret, r.caret); } catch (err) {}
      }
      if (opts.onInput) opts.onInput(raw);
    });
    inp.addEventListener('blur', () => {
      memo.auto = null;
      if (opts.onlyEdited && !edited) return;
      const v = String(norm(inp.value) ?? '');
      if (v !== inp.value) { inp.value = v; if (opts.onInput) opts.onInput(v); }
    });
    return;
  }
  inp.addEventListener('input', (e) => {
    const raw = inp.value;
    const caret = typeof inp.selectionStart === 'number' ? inp.selectionStart : raw.length;
    const r = reformatWithCaret(raw, caret, formatter, { prev, inputType: e && e.inputType, isSig: opts.isSig, hadSelection });
    hadSelection = false;
    if (r.value !== raw) {
      inp.value = r.value;
      try { if (document.activeElement === inp) inp.setSelectionRange(r.caret, r.caret); } catch (err) {}
    }
    prev = inp.value;
    if (opts.onInput) opts.onInput(raw);
  });
}

// B5 (1.2.23): атрибуты полей-секретов и произвольных полей - клавиатура не запоминает, не
// исправляет и не подсказывает введённое (SECRET_INPUT_ATTRS - fieldinput.js, под тестом).
function applySecretAttrs(inp) {
  for (const [k, v] of Object.entries(SECRET_INPUT_ATTRS)) inp.setAttribute(k, v);
  inp.spellcheck = false;
}
// Поле-секрет в обёртке с кнопкой-глазом «Показать/Скрыть» (в гамме приложения, иконки icons.js).
// holder.revealSecret(true|false) - показать/скрыть программно (генератор пароля показывает).
function wrapSecretInput(input) {
  const box = document.createElement('span');
  box.className = 'secret-wrap';
  const eye = document.createElement('button');
  eye.type = 'button'; eye.className = 'secret-eye';
  const paint = () => {
    const shown = input.type !== 'password';
    eye.innerHTML = icon(eyeIconName(shown), 20);
    const l = shown ? 'Скрыть' : 'Показать';
    eye.title = l; eye.setAttribute('aria-label', l); eye.setAttribute('aria-pressed', shown ? 'true' : 'false');
  };
  box.revealSecret = (on) => { input.type = on ? 'text' : 'password'; paint(); };
  eye.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); box.revealSecret(input.type === 'password'); });
  box.appendChild(input); box.appendChild(eye);
  paint();
  return box;
}

// Навесить на поля редактора клавиатуры/маски/лимиты по типу (8d п.2,3,4,7,8). Мобильная
// специфика — держим здесь, не в схеме ядра. onDirty помечает форму изменённой.
function wireFieldInputs(form, section, onDirty) {
  for (const inp of form.querySelectorAll('[data-key]')) {
    const key = inp.dataset.key;
    const props = fieldInputProps(section, key);
    if (props) {
      if (props.inputMode) inp.inputMode = props.inputMode;
      if (props.type && inp.tagName === 'INPUT') inp.type = props.type;
      if (props.pattern) inp.setAttribute('pattern', props.pattern);
      if (props.maxLength) inp.maxLength = props.maxLength;
      if (props.lang) inp.lang = props.lang;
      if (props.autocapitalize) inp.setAttribute('autocapitalize', props.autocapitalize);
      if (props.autocomplete) inp.autocomplete = props.autocomplete;
      if (props.spellcheck === false) inp.spellcheck = false;
    }
    // Разумный лимит длины даже для Pro (v3): textarea ~10000, обычное поле ~500 - если у поля
    // нет своего явного лимита. Защита от гигантского ввода, душащего шифрование/рендер.
    if (inp.type !== 'hidden') {
      const dl = defaultMaxLength(inp.tagName, !!(props && props.maxLength));
      if (dl) inp.maxLength = dl;
    }
    const mask = liveMaskFor(section, key);
    if (mask) {
      inp.value = mask(inp.value);
      bindCaretMask(inp, mask, { isSig: liveMaskSig(section, key), onInput: onDirty, endOnly: endOnlyMaskField(section, key) });
    }
    if (section === 'cards' && key === 'holder') {
      let warned = false;
      bindCaretMask(inp, (v) => latinOnly(v).value, {
        isSig: (ch) => !/[Ѐ-ӿ]/.test(ch),   // кириллицу маска вырезает, остальное значимо
        onInput: (raw) => {
          if (latinOnly(raw).hadCyrillic && !warned) { warned = true; toast('Имя на карте - латиницей, как на карте'); }
          onDirty();
        },
      });
    }
  }
}

// Панель-подсказка раздела — в гамме приложения (не нативный alert).
function showHint(section) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal hint-panel';
  // Подсказки разбиты на короткие абзацы (18.15) — рендерим каждый отдельным <p>.
  const paras = getHintParagraphs(section)
    .map((p) => `<p class="hint-text">${UI.escapeHtml(p)}</p>`).join('');
  m.innerHTML = `<h3>${UI.SECTION_LABELS[section] || 'Подсказка'} - зачем и как</h3>
    <div class="hint-body">${paras}</div>
    <div class="modal-actions"><button class="save">Понятно</button></div>`;
  const done = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); done(); } };
  m.querySelector('.save').onclick = done;
  closeOnBackdrop(back, done);
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m); document.body.appendChild(back);
  m.querySelector('.save').focus();
}

// Баннер-предупреждение раздела Seed-фраз — в гамме приложения (не нативный alert).
// Сворачивается кнопкой «Понял, принял», состояние запоминается (повторно не всплывает).
// Текст — дословно из спеки 4.2 (расширенный, утверждён Алексеем).
function renderSeedBanner() {
  const b = document.createElement('div');
  b.className = 'seed-banner';
  b.innerHTML = `
    <div class="seed-banner-head">⚠️ <strong>Подумайте дважды</strong></div>
    <p>Мы не рекомендуем хранить seed-фразу в памяти телефона - даже в зашифрованном виде. Телефон можно потерять, разбить или заразить, а seed-фраза - это полный доступ к вашим криптоактивам без возможности восстановления.</p>
    <p>Надёжнее всего - <strong>бумажный носитель в защищённом месте</strong> (домашний сейф, банковская ячейка). В идеале - две копии в разных местах.</p>
    <p>Если всё же храните здесь - это ваш осознанный выбор и ответственность.</p>
    <div class="seed-banner-actions"><button type="button" class="seed-banner-ok">Понял, принял</button></div>`;
  b.querySelector('.seed-banner-ok').onclick = () => { dismissSeedBanner(window.localStorage); b.remove(); };
  return b;
}

// ---------- раздел «Коды 2FA»: живые карточки ----------
// Код группами для читаемости: чётная длина (6/8) — пополам, иначе по 3 цифры.
function groupTotpCode(code) {
  if (code.length % 2 === 0) { const h = code.length / 2; return code.slice(0, h) + ' ' + code.slice(h); }
  return code.replace(/(\d{3})(?=\d)/g, '$1 ');
}

// Карточка кода 2FA: заголовок + крупный текущий код + кольцо обратного отсчёта.
// Код и отсчёт наполняет mountTotpLive (async, каждую секунду). Тап по коду — копирование.
function renderTotpCard(entry, h) {
  const el = document.createElement('div');
  el.className = 'entry totp-entry';
  el.draggable = true;
  el.dataset.id = entry.id;

  const head = document.createElement('div');
  head.className = 'entry-head';
  head.innerHTML = `
    <span class="entry-title">${UI.escapeHtml(entry.name || '(без названия)')}</span>
    <div class="entry-actions">
      <div class="action-icons">
        <button class="ic fav ${entry.favorite ? 'on' : ''}" title="Избранное">★</button>
        <button class="ic edit" title="Править">✎</button>
        <button class="ic del" title="Удалить">🗑</button>
      </div>
    </div>`;
  head.querySelector('.fav').onclick = () => h.onToggleFav('totp', entry);
  head.querySelector('.edit').onclick = () => h.onEdit('totp', entry);
  head.querySelector('.del').onclick = () => h.onDelete('totp', entry);
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'entry-body totp-body';
  const code = document.createElement('button');
  code.type = 'button';
  code.className = 'totp-code';
  code.title = 'Нажмите, чтобы скопировать';
  code.textContent = '••• •••';
  code.onclick = () => { const c = code.dataset.code; if (c) h.onCopy(c); };
  const ring = document.createElement('div');
  ring.className = 'totp-ring';
  ring.title = 'Секунд до смены кода';
  const rem = document.createElement('span');
  rem.className = 'totp-remaining';
  ring.appendChild(rem);
  body.appendChild(code);
  body.appendChild(ring);
  el.appendChild(body);
  return el;
}

// B6: id записи в CSS-селекторе - через CSS.escape (id из импортированной копии может быть любым).
function cssId(id) {
  const s = String(id == null ? '' : id);
  try { if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s); } catch (e) {}
  const BS = String.fromCharCode(92);
  return s.split('').map((c) => ((c === '"' || c === BS || c === '[' || c === ']') ? BS + c : c)).join('');
}

function stopTotpTimer() { if (totpTimer) { clearInterval(totpTimer); totpTimer = null; } }

// Один таймер на весь список: раз в секунду двигает отсчёт, а на смене 30-сек окна
// перегенерирует код. Секреты в DOM не кладём — запись берём из state.vault по id.
function mountTotpLive() {
  stopTotpTimer();
  const refresh = async () => {
    if (!state.vault || current !== 'totp') { stopTotpTimer(); return; }
    const now = Date.now();
    for (const entry of state.vault.sections.totp || []) {
      const card = document.querySelector(`.totp-entry[data-id="${cssId(entry.id)}"]`);   // B6: id экранируем
      if (!card) continue;
      const period = Number(entry.period) || TOTP_DEFAULTS.period;
      const digits = Number(entry.digits) || TOTP_DEFAULTS.digits;
      const algorithm = entry.algorithm || TOTP_DEFAULTS.algorithm;
      const { remaining } = totpProgress(now, period);
      const remEl = card.querySelector('.totp-remaining');
      const ring = card.querySelector('.totp-ring');
      if (remEl) remEl.textContent = remaining;
      if (ring) {
        const pct = Math.max(0, Math.min(100, (remaining / period) * 100));
        ring.style.background = `conic-gradient(var(--teal) ${pct}%, var(--elevated) 0)`;
        ring.classList.toggle('low', remaining <= 5);
      }
      const counter = Math.floor(now / 1000 / period);
      if (card.dataset.counter !== String(counter)) {
        card.dataset.counter = String(counter);
        const codeEl = card.querySelector('.totp-code');
        try {
          const code = await generateTOTP(entry.secret, { time: now, digits, period, algorithm });
          if (codeEl) { codeEl.dataset.code = code; codeEl.textContent = groupTotpCode(code); codeEl.classList.remove('bad'); }
        } catch {
          if (codeEl) { delete codeEl.dataset.code; codeEl.textContent = 'ключ повреждён'; codeEl.classList.add('bad'); }
        }
      }
    }
  };
  refresh();
  totpTimer = setInterval(refresh, 1000);
}

// Модалка живого сканера QR (в гамме приложения). onParsed получает результат parseOtpauth.
function openQrScanner(onParsed) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal qr-scanner';
  m.innerHTML = `<h3>Наведите камеру на QR-код</h3>
    <div class="qr-view"><video class="qr-video" muted playsinline></video><div class="qr-frame"></div></div>
    <p class="qr-status">Запуск камеры…</p>
    <p class="qr-focus-hint">Изображение размыто? Коснитесь кадра, чтобы навести резкость.</p>
    <div class="modal-actions"><button class="cancel">Отмена</button></div>`;
  const video = m.querySelector('.qr-video');
  const view = m.querySelector('.qr-view');
  const canvas = document.createElement('canvas');
  const status = m.querySelector('.qr-status');
  let stop = null;
  let closed = false;
  let camTrack = null;   // видеодорожка для тап-фокуса (п.16)
  const close = () => { closed = true; if (stop) stop(); document.removeEventListener('keydown', onKey, true); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' && isTopModal(back)) { e.stopPropagation(); close(); } };
  // Тап по кадру = ручная перефокусировка (п.16): на части устройств помогает, когда
  // непрерывный автофокус «залип». Best-effort, без нативных диалогов.
  view.addEventListener('click', () => { if (camTrack && refocusTrack(camTrack)) toast('Навожу резкость…'); });
  const beginScan = () => {
    status.classList.remove('bad');
    status.textContent = 'Ищу QR-код в кадре…';
    stop = startQrScan(video, canvas, {
      onResult: (text) => {
        let parsed;
        try { parsed = parseOtpauth(text); }   // B6: любой сбой разбора - сообщение, а не зависший сканер
        catch (e) { parsed = { ok: false, error: 'QR-код не распознан. Попробуйте ещё раз.' }; }
        if (parsed.ok) { close(); onParsed(parsed); toast('QR распознан'); return; }
        status.textContent = parsed.error;
        status.classList.add('bad');
        setTimeout(() => { if (!closed) beginScan(); }, 900); // не крутить пустой цикл на «мусорном» QR
      },
      onError: (msg) => { status.textContent = msg; status.classList.add('bad'); },
      onTrack: (track) => { camTrack = track; },
    });
  };
  m.querySelector('.cancel').onclick = close;
  closeOnBackdrop(back, close);
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m); document.body.appendChild(back);
  beginScan();
}

// Иконка записи на скруглённом тонированном чипе слева от названия (8f B.10). Ставим ПОВЕРХ
// core-карточки (ui.js не трогаем): вставляем чип в начало .entry-title. Иконка — выбранная
// пользователем (entry.icon) или дефолт раздела; в обеих темах читается (currentColor + чип).
function decorateCardIcon(card, section, entry) {
  const title = card.querySelector('.entry-title');
  if (!title || title.querySelector('.cardicon')) return;
  const chip = document.createElement('span');
  chip.className = 'cardicon';
  chip.innerHTML = renderCardIcon(resolveIconId(entry, section), 26);
  title.insertBefore(chip, title.firstChild);
}

// Финализация заголовка карточки в списке (после decorateCardIcon):
//  1) карта без банка получает осмысленный заголовок «Карта •••• 1234»/«Карта» (не «(без названия)»);
//  2) текст заголовка оборачивается в .entry-title-text - чтобы длинный заголовок без пробелов
//     обрезался многоточием (CSS), а кнопки действий ★/✎/🗑 не выдавливались за экран.
function decorateCardTitle(card, section, entry) {
  const title = card.querySelector('.entry-title');
  if (!title) return;
  if (section === 'cards' && needsCardFallbackTitle(entry)) {
    let textNode = null;
    for (const n of title.childNodes) if (n.nodeType === 3) textNode = n;   // 3 = TEXT_NODE
    if (textNode) textNode.textContent = cardFallbackTitle(entry);
    else title.appendChild(document.createTextNode(cardFallbackTitle(entry)));
  }
  if (!title.querySelector('.entry-title-text')) {
    const wrap = document.createElement('span');
    wrap.className = 'entry-title-text';
    for (const n of [...title.childNodes]) if (n.nodeType === 3) wrap.appendChild(n);   // текст -> в обёртку
    title.appendChild(wrap);
  }
}

// Номер карты в списке/детали показываем группами по 4 (18.7). Меняем ТОЛЬКО отображение:
// значение в копировании берётся из vault сырым (ui.js copyPlain(val)), пробелов туда не
// попадает. Находим строку поля по совпадению текста с сырым номером записи (надёжнее, чем
// по подписи), core-карточку (ui.js) не трогаем.
function decorateCardNumber(card, entry) {
  const raw = entry && entry.number ? String(entry.number) : '';
  if (!raw) return;
  const grouped = groupDigits(raw);
  if (grouped === raw) return;
  for (const val of card.querySelectorAll('.field .f-val')) {
    if (val.classList.contains('secret')) continue;      // секреты не трогаем
    if (val.textContent === raw) { val.textContent = grouped; break; }
  }
}

// Редактор документа (1.2.22): строка «Срок действия» (meta) встаёт сразу после строки
// «Дата выдачи» (data-key="issueDate" из схемы ядра). Нет даты выдачи - перед комментариями,
// нет и их - в конец формы. Так «Комментарии» всегда последнее поле.
function placeDocExpiryRow(form, meta) {
  const rowOf = (key) => form.querySelector(`[data-key="${key}"]`)?.closest('.form-row');
  const issueRow = rowOf('issueDate');
  if (issueRow && issueRow.parentNode) { issueRow.parentNode.insertBefore(meta, issueRow.nextSibling); return; }
  const commentsRow = rowOf('comments') || form.querySelector('textarea')?.closest('.form-row');
  if (commentsRow && commentsRow.parentNode) { commentsRow.parentNode.insertBefore(meta, commentsRow); return; }
  form.appendChild(meta);
}

// Карточка документа (1.2.22): «Комментарии» (textarea-поле ядра) переносим ПОСЛЕ «выдан …» и
// футера со сроком, чтобы порядок читался как в редакторе: дата выдачи → срок → комментарии.
// Миниатюры сканов идут после (добавляются позже). Поле ищем по подписи из схемы ядра.
function moveDocCommentsLast(card) {
  const body = card.querySelector('.entry-body');
  if (!body) return;
  const f = (UI.FIELD_SCHEMA.documents || []).find((x) => x.key === 'comments');
  if (!f) return;
  const row = [...body.querySelectorAll(':scope > .field')].find((r) => {
    const l = r.querySelector('.f-label'); return l && l.textContent.trim() === f.label;
  });
  if (row) body.appendChild(row);
}

// ---------- раздел «Документы»: футер карточки (тип, срок, страницы + просмотр) ----------
// Дорисовываем поверх core-карточки (UI.renderEntryCard не трогаем — это ядро). Base64
// сканов в карточку не попадает: показываем счётчик страниц и кнопку «Открыть».
function decorateDocCard(card, entry) {
  const foot = document.createElement('div');
  foot.className = 'doc-foot';
  // Чип «Тип документа» убран (D1): тип больше не хранится и не показывается.
  if (entry.expiry) {
    const st = Docs.expiryStatus(entry.expiry);
    const exp = document.createElement('span');
    exp.className = 'doc-expiry ' + st;
    // Срок — полная дата ДД.ММ.ГГГГ (18.10); старые ММ/ГГ и ISO показываем как есть/локализованно.
    const ds = Docs.formatDocExpiryDisplay(entry.expiry);
    exp.textContent = (st === 'expired' ? 'истёк ' : 'действует до ') + ds;
    foot.appendChild(exp);
  }
  const n = Docs.pageCount(entry);
  if (n > 0) {
    // Свёрнутая карточка (v4): счётчик «N сканов» - часть опознавательного минимума. Сами
    // миниатюры/номер/дата/комментарии видны только в развёрнутом виде (тап).
    const info = document.createElement('span'); info.className = 'doc-pagecount';
    info.textContent = `${n} ${plural(n, 'скан', 'скана', 'сканов')}`;
    foot.appendChild(info);
  } else {
    const empty = document.createElement('span'); empty.className = 'doc-empty'; empty.textContent = 'Без сканов';
    foot.appendChild(empty);
  }
  card.querySelector('.entry-body')?.appendChild(foot);
  // C3 (1.2.23): строку «выдан …» ядра переписываем - ядро прогоняет дату через new Date() и путает
  // день с месяцем (03.04.2020 -> «выдан 04.03.2020»). Показываем как хранится: ДД.ММ.ГГГГ.
  if (entry.issueDate) {
    const ch = card.querySelector('.entry-body > .changed');
    if (ch) ch.textContent = 'выдан ' + Docs.formatIssueDateDisplay(entry.issueDate);
  }
  // Свёрнутая карточка документа (v4): опознавательный минимум - иконка + Название + «N сканов»
  // + срок-бейдж. Номер, дату выдачи («выдан …») и комментарии прячем до разворота: это тело
  // .field + .changed, помечаем doc-collapse-hide (CSS скрывает пока карточка не .expanded).
  // doc-foot (счётчик + срок) остаётся виден всегда.
  card.querySelectorAll('.entry-body > .field').forEach((f) => f.classList.add('doc-collapse-hide'));
  card.querySelector('.entry-body > .changed')?.classList.add('doc-collapse-hide');
  moveDocCommentsLast(card);   // дата выдачи → срок → комментарии (1.2.22)
  // Миниатюры сканов-картинок: только в развёрнутой карточке (v4, экономия высоты - больше
  // карточек на экран). Тап по миниатюре → полноэкранный скан.
  decorateDocThumbs(card, entry);
}

// Строка миниатюр вложений-картинок под футером документа (18.13). Не огромные, тап
// открывает просмотрщик на нужной странице. PDF-страницы миниатюрой не показываем.
function decorateDocThumbs(card, entry) {
  const pages = (entry && entry.pages) || [];
  if (!pages.length) return;
  const strip = document.createElement('div');
  // doc-collapse-hide: миниатюры видны только когда карточка развёрнута (v4). В детальном
  // просмотре (.detail-card, не .entry.expandable) правило не срабатывает - там миниатюры видны.
  strip.className = 'doc-thumbs doc-collapse-hide';
  const MAX = 4;
  // Кнопки «Открыть сканы» больше нет (D2) - открытие только тапом по превью. Поэтому превью
  // рисуем для КАЖДОГО скана: картинка - миниатюрой, PDF - плиткой-заглушкой 📕. Так любой
  // документ, включая PDF-only, открывается тапом; тап по превью не разворачивает карточку.
  pages.slice(0, MAX).forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'doc-thumb';
    b.title = 'Открыть скан';
    const isPdf = !p || p.mime === 'application/pdf' || !p.data;
    if (isPdf) {
      b.classList.add('doc-thumb-pdf');
      b.textContent = '📕';
    } else {
      const im = document.createElement('img');
      im.loading = 'lazy'; im.decoding = 'async'; im.alt = '';
      im.src = `data:${p.mime};base64,${p.data}`;
      b.appendChild(im);
    }
    b.onclick = (e) => { e.stopPropagation(); openDocViewer(entry); };
    strip.appendChild(b);
  });
  if (pages.length > MAX) {
    const more = document.createElement('span');
    more.className = 'doc-thumb-more';
    more.textContent = '+' + (pages.length - MAX);
    strip.appendChild(more);
  }
  card.querySelector('.entry-body')?.appendChild(strip);
}

// ---------- раздел «Контакты»: кнопки «Позвонить»/«Открыть» (batch2) ----------
// Дорисовываем поверх core-карточки (UI.renderEntryCard — ядро, не трогаем). Схема телефона
// и мессенджер-ссылки безопасно приводятся к tel:/разрешённой схеме в contactlinks.js;
// открытие — через openExternal (системный обработчик). Значения также копируются (core).
// Телефонная трубка (inline-иконка, стиль как у копирования). Своя SVG - в icons.js нет 'phone'.
const PHONE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5c.5 0 .9.3 1 .8l.8 3a1 1 0 0 1-.27 1L6.6 9.6a12 12 0 0 0 5.8 5.8l1.3-1.35a1 1 0 0 1 1-.27l3 .8c.5.13.8.53.8 1.02v3c0 .8-.7 1.45-1.5 1.4C9.7 19.4 4.6 14.3 4.1 6.5 4 5.2 5.2 3.5 6.5 3.5z"/></svg>';
function decorateContactCard(card, entry) {
  const body = card.querySelector('.entry-body');
  if (!body) return;
  // Кнопку набора ставим ПРЯМО в строку телефона, сразу справа от номера (заход 4): раньше
  // «Позвонить» висела блоком внизу карточки - неочевидно. Строку ищем по подписи поля.
  const rowByLabel = (txt) => [...body.querySelectorAll('.field')].find((r) => {
    const l = r.querySelector('.f-label'); return l && l.textContent.trim() === txt;
  });
  const addAct = (row, cls, title, inner, href) => {
    if (!row) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ic ' + cls; b.title = title; b.setAttribute('aria-label', title);
    b.innerHTML = inner;
    b.addEventListener('click', (e) => { e.stopPropagation(); openExternal(href); });
    const copy = row.querySelector('.ic.copy');
    if (copy) row.insertBefore(b, copy); else row.appendChild(b);   // сразу справа от значения, перед «копировать»
  };
  const tel = telHref(entry.phone);
  if (tel) addAct(rowByLabel('Телефон'), 'call', 'Позвонить', PHONE_SVG, tel);
  // E-mail (п.10): «Написать» (mailto) + иконка копирования (core рисует copy у type:copy).
  const mail = mailtoHref(entry.email);
  if (mail) addAct(rowByLabel('E-mail'), 'mail', 'Написать', icon('mail', 16), mail);
  // Мессенджер/ссылка (п.9 + п.14): длинный URL НЕ показываем текстом НИГДЕ в карточке (ни в
  // свёрнутой, ни в РАЗВЁРНУТОЙ) - иначе в узкой ячейке он сыпется столбиком по 2 символа и
  // карточка раздувается. Вместо значения - кнопка «Открыть <короткий лейбл>» (Telegram/WhatsApp/
  // домен). Копирование полного URL: в свёрнутой скрыто (contact-link-collapsed), в развёрнутой
  // доступно. Сам URL правится в редакторе. Класс contact-link-hidden гасит .f-val всегда.
  const open = openableHref(entry.link);
  if (open) {
    const linkRow = rowByLabel('Мессенджер или ссылка');
    addAct(linkRow, 'golink', 'Открыть', icon('globe', 16) + '<span class="golink-label">' + UI.escapeHtml(linkLabel(entry.link)) + '</span>', open);
    if (linkRow) {
      linkRow.classList.add('contact-link-row');
      linkRow.querySelector('.f-val')?.classList.add('contact-link-hidden');
      linkRow.querySelector('.ic.copy')?.classList.add('contact-link-collapsed');
    }
  }
}

// Дорисовываем поверх core-карточки (UI.renderEntryCard — ядро, не трогаем). У поля
// «Сеть / тип» (network) убираем кнопку копирования: название сети (Bitcoin/Ethereum) не
// секрет и копировать его незачем. Ядро рисует копирование у любого text-поля, поэтому
// правим тут, в mobile-слое (как decorateContactCard), а не в схеме/ui.js. Строку ищем по
// подписи поля из схемы seed. Остальные поля seed не трогаем.
function decorateSeedCard(card, entry) {
  const body = card.querySelector('.entry-body');
  if (!body) return;
  const netLabel = (UI.FIELD_SCHEMA.seed.find((f) => f.key === 'network') || {}).label || 'Сеть / тип';
  const row = [...body.querySelectorAll('.field')].find((r) => {
    const l = r.querySelector('.f-label'); return l && l.textContent.trim() === netLabel;
  });
  row?.querySelector('.ic.copy')?.remove();
}

// Поиск строки поля карточки по подписи (общий помощник декораторов).
function fieldRowByLabel(body, txt) {
  return [...body.querySelectorAll('.field')].find((r) => {
    const l = r.querySelector('.f-label'); return l && l.textContent.trim() === txt;
  });
}

// ---------- раздел «Карты»: подпись срока, короткие маски CVV/ПИН, компактная строка ----------
// Поверх core-карточки (ui.js не трогаем). (п.10) в карточке «Срок (ММ/ГГ)» → «Срок» (формат
// виден в самом значении; в редакторе подсказка формата остаётся). (п.9) CVV/ПИН скрываем
// короткой маской по стандартной длине (3 и 4 точки), не 8 - длину настоящих секретов это не
// раскрывает (CVV всегда 3, ПИН 4). (п.9/п.10) Срок+CVV+ПИН выкладываем в одну строку.
function decorateCardCard(card, entry) {
  const body = card.querySelector('.entry-body');
  if (!body) return;
  const expRow = fieldRowByLabel(body, 'Срок (ММ/ГГ)');
  if (expRow) { const l = expRow.querySelector('.f-label'); if (l) l.textContent = 'Срок'; }
  const setMask = (label, mask) => {
    const sec = fieldRowByLabel(body, label)?.querySelector('.f-val.secret');
    if (sec) sec.dataset.mask = mask;
  };
  setMask('CVV', '•••');
  setMask('ПИН', '••••');
  const rows = [expRow, fieldRowByLabel(body, 'CVV'), fieldRowByLabel(body, 'ПИН')].filter(Boolean);
  if (rows.length >= 2) {
    const group = document.createElement('div');
    group.className = 'card-inline-fields';
    body.insertBefore(group, rows[0]);
    for (const r of rows) group.appendChild(r);
  }
}

// ---------- раздел «Заметки»: дата изменения в карточке (п.12) ----------
// Показываем «изменено: дата» ТОЛЬКО в заметках (в остальных разделах updatedAt хранится, но
// не отображается - там это шум). Берём updatedAt, а если его нет (старые записи) - createdAt.
function decorateNoteCard(card, entry) {
  const when = entry.updatedAt || entry.createdAt;
  if (!when) return;
  const d = new Date(when);
  if (isNaN(d)) return;
  const body = card.querySelector('.entry-body');
  if (!body) return;
  const s = document.createElement('span');
  s.className = 'note-updated';
  s.textContent = 'изменено: ' + d.toLocaleDateString('ru-RU');
  body.appendChild(s);
}

// ---------- бейдж срока на карточке (п.3) ----------
// Для записей со сроком (Карты - ММ/ГГ; Документы - ДД.ММ.ГГ(ГГ)) рисуем на карточке компактный
// бейдж: ЯНТАРНЫЙ «истекает через N дн.» при 0<N<=30 и КРАСНЫЙ «истёк» при просрочке. Считается
// от сегодняшней даты (Docs.expiryStatus/expiryDaysLeft - чистые функции под тестом+мутацией).
// Только на карточке (на витрину/пуши не выносим). Бейдж в шапке карточки - виден и в свёрнутом
// виде. 'ok'/'none' бейджа не рисуют (не шумим на не-срочном).
function decorateExpiryBadge(card, section, entry) {
  if (section !== 'cards' && section !== 'documents') return;
  const raw = entry && entry.expiry;
  if (!raw) return;
  const st = Docs.expiryStatus(raw);
  if (st !== 'soon' && st !== 'expired') return;
  const badge = document.createElement('span');
  badge.className = 'exp-badge ' + st;
  badge.textContent = Docs.expiryBadgeText(raw);   // C5: календарные дни, 0 -> «истекает сегодня»
  const head = card.querySelector('.entry-head') || card;
  head.appendChild(badge);
}

// Произвольные (кастомные) поля не показываем в свёрнутом превью (п.15): помечаем последние N
// строк-полей тела (core рисует кастомные поля ПОСЛЕ схемных, в конце) классом cf-preview-hide;
// CSS прячет их, пока карточка не развёрнута. N = число кастомных полей с непустым значением.
function hideCustomFieldsInPreview(card, entry) {
  const cfVals = (entry.customFields || []).filter((c) => c.value);
  if (!cfVals.length) return;
  const fields = [...card.querySelectorAll('.entry-body .field')];
  fields.slice(-cfVals.length).forEach((f) => f.classList.add('cf-preview-hide'));
}

// Фолбэк-заголовок для Wi-Fi и Реквизитов (п.20/п.21): если «Название» пусто, core показывает
// «(без названия)». Тогда берём осмысленный заголовок: Wi-Fi - по имени сети (SSID), Реквизиты -
// по первому непустому полю. Миграцию данных не делаем, меняем только отображение.
function applyTitleFallback(card, section, entry) {
  const fb = fallbackTitleFor(section, entry);   // чистая логика вынесена в cardtitle.js (v3-4)
  if (!fb) return;
  const t = card.querySelector('.entry-title .entry-title-text') || card.querySelector('.entry-title');
  if (t) t.textContent = fb;
}

// ---------- загрузка / сохранение ----------
async function loadFile(opts) {
  return (await store.load(opts)) || {};
}
// B2: временные JPEG камеры (Capacitor кладёт их во внешнюю папку приложения) - удалить.
// Только на телефоне; в браузере нечего убирать. Фоном, ошибки молча (это уборка).
function cleanupCameraTemp() {
  try {
    const NP = window.NativePlugins;
    if (!(window.isNativeApp && window.isNativeApp()) || !NP || !NP.Filesystem) return;
    cleanCamTemp(NP.Filesystem).catch(() => {});
  } catch (e) {}
}
// Метка «сейф на этом телефоне создан» (1.2.23, A1). Не секрет - просто факт. Если метка есть,
// а файла сейфа нет, это НЕ первый запуск: файл пропал/не записался. Тогда ведём на экран
// восстановления, а не в демо/создание (они бы начали с нуля поверх пропажи).
const VAULT_MARK_KEY = 'seyf_vault_created';
function markVaultCreated() { try { const ls = lsGet(); if (ls) ls.setItem(VAULT_MARK_KEY, '1'); } catch (e) {} }
function vaultMarked() { try { const ls = lsGet(); return !!(ls && ls.getItem(VAULT_MARK_KEY) === '1'); } catch (e) { return false; } }
// Потолок ожидания чтения сейфа при старте (A5): зависшее чтение не оставляет вечную заставку.
// 1.2.24 (п.4): это время БЕЗ ПРОГРЕССА (каждый шаг чтения - пульс), а «Повторить» ждёт уже
// идущее чтение (bootLoader), а не начинает новое: большой сейф на медленном телефоне дочитается.
const BOOT_LOAD_TIMEOUT_MS = 20000;
const bootLoader = makeSharedLoader((beat) => loadFile({ onProgress: beat }));
// Флаг «при блокировке изменения ещё не записались» (A2): показываем на экране входа после reload.
const UNSAVED_AT_LOCK_KEY = 'seyf_unsaved_at_lock';
// Запись vault на устройство (persist.js, 1.2.20). ВСЕ saveFile идут через одну очередь
// (makeSerialSaver): следующая перешифровка+запись стартует только после РЕАЛЬНОГО завершения
// предыдущей, ожидающие вызовы коалесцируются. Таймаут SAVE_TIMEOUT_MS - только уведомление
// вызывающего (reencrypt-timeout / write-timeout / reencrypt: <msg> / write: <msg>), очередь
// ждёт настоящий промис. Нижний слой (store.save) дополнительно сериализует любые записи файла.
// state.file обновляем ТОЛЬКО полем data поверх актуального state.file: параллельная смена
// пароля/биометрии (pwWrap/kdf/helloWrap) не затирается старой копией файла.
// 1.2.23 (A3): сторож очереди бросает навсегда подвисшую запись и пишет заново; alive() -
// брошенная попытка, проснувшись, не подменяет state.file устаревшей перешифровкой. onChange
// ведёт баннер «Изменения не записаны на устройство» (пока есть незаписанное после сбоя/таймаута).
// 1.2.24 (п.4): beat - пульс сторожа; каждый записанный кусок (store.save onProgress) его взводит.
// п.10: перешифрованные данные не держим в замыкании брошенной попытки (enc = null).
const serialSave = makeSerialSaver(async (setStage, alive, beat) => {
  if (state.demoMode) throw new Error('demo-mode: сохранение запрещено (данные не сохраняются)');
  if (!state.vault || !state.dek) throw new Error('locked: сейф заперт');
  setStage('reencrypt');
  let enc = await C.reencryptData(state.file, state.dek, state.vault);
  if (!alive()) { enc = null; throw new Error('abandoned'); }
  state.file = { ...state.file, data: enc.data };
  enc = null;
  setStage('write');
  await guardedStoreSave(state.file, { onProgress: beat });
}, { timeoutMs: SAVE_TIMEOUT_MS, onChange: (st) => syncUnsavedBanner(st) });
function saveFile() { return serialSave(); }
// Для update.js (A2): OTA-перезапуск запрещён, пока очередь записи не пуста.
window.SeyfSave = {
  pending: () => serialSave.unsaved(),
  // 1.2.24 (п.5): упавшую запись один раз повторяем и ждём очередь (drainWithRetry).
  drain: (ms) => drainWithRetry(serialSave, ms || DRAIN_MS),
};

// Постоянный баннер «Изменения не записаны» (A3): виден, пока есть незаписанные правки ПОСЛЕ
// сбоя/брошенной записи или таймаута. Кнопка - сразу резервная копия (она шифрует ТЕКУЩИЙ
// state.vault, A8, т.е. спасает правки, которые не легли на диск). Снимается сам, как только
// очередь записала всё.
function syncUnsavedBanner(st = serialSave.status()) {
  const show = !!(st && st.unsaved && (st.failed || st.late) && state.vault && !state.demoMode);
  let b = document.querySelector('#unsavedBanner');
  if (!show) { if (b) b.hidden = true; return; }
  if (!b) {
    b = document.createElement('div');
    b.id = 'unsavedBanner'; b.className = 'unsaved-banner'; b.setAttribute('role', 'alert');
    b.innerHTML = '<span class="unsaved-text">Изменения не записаны на устройство. Сделайте резервную копию.</span>'
      + '<button type="button" class="unsaved-backup">Сохранить копию</button>';
    b.querySelector('.unsaved-backup').onclick = () => doExport();
    document.body.appendChild(b);
  }
  b.hidden = false;
}
function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.add('hidden');
  const boot = $('#boot'); if (boot) boot.classList.add('hidden');
  $(id).classList.remove('hidden');
}
// Стартовая заставка (#1): показываем перед системным биозапросом, снимаем по готовности.
function showSplash() { const s = $('#splash'); if (s) s.classList.remove('hidden'); }
function hideSplash() { const s = $('#splash'); if (s) s.classList.add('hidden'); }

// ---------- вход ----------
async function boot() {
  cleanupCameraTemp();   // B2: остатки фото камеры (JPEG_*.jpg во внешней папке приложения)
  // 1.2.20: битый файл хранилища (VAULT_CORRUPT) - НЕ «сейфа нет». Не уходим в демо/создание
  // (они бы перезаписали данные), а ведём к восстановлению из резервной копии.
  // 1.2.23 (A5): ошибка ЧТЕНИЯ или зависшее чтение (таймаут) - экран «Повторить», не демо.
  let corrupt = false;
  try { state.file = await bootLoader.wait(BOOT_LOAD_TIMEOUT_MS, 'load-timeout'); }
  catch (e) {
    if (e && e.code === 'VAULT_CORRUPT') { corrupt = true; state.file = {}; }
    else return startReadError(e);
  }
  const hasVault = !!(state.file && state.file.v);
  if (hasVault) markVaultCreated();               // существующие сейфы (до 1.2.23) получают метку
  let missing = false;
  // A1: метка «сейф создан» есть, а файла нет - это пропажа, а не первый запуск.
  if (!hasVault && !corrupt && vaultMarked()) { corrupt = true; missing = true; }
  // 1.3.0: демо первого запуска - только если его не выключила сборка (релиз/стор вшивают
  // SEYF_DEMO=false в buildflags.js, см. access.js DEMO). Исходник demo.js не трогаем.
  const route = decideStart({ hasVault, demoEnabled: Demo.DEMO_ENABLED && Access.DEMO, corrupt });
  if (route === 'corrupt') return startCorrupt({ missing });  // до demo/setup - ничего не перезаписываем
  if (route === 'demo') return enterDemo();       // первый запуск: сначала посмотреть
  show('#lock');
  if (route === 'setup') return startSetup();     // прод без демо: сразу создание пароля
  return startUnlock();                            // существующий vault: обычный вход
}

// Хранилище повреждено (1.2.20): vault.dat не читается и целого vault.tmp нет. Ничего не пишем
// сами; пользователь либо повторяет чтение, либо восстанавливает сейф из резервной копии (.dat):
// копия проверяется паролем ЭТОЙ копии и записывается как есть, дальше обычный вход её паролем.
async function startCorrupt({ missing = false } = {}) {
  state.storageCorrupt = true;
  show('#lock');
  for (;;) {
    const v = await appDialog({
      title: 'Хранилище повреждено',
      message: missing
        ? 'Сейф на этом телефоне уже создавался, но его файл не найден. Чтобы не потерять данные, приложение само не создаёт новый сейф поверх. Восстановите сейф из резервной копии (файл .dat) или попробуйте прочитать ещё раз. Копии нет - нажмите «Начать заново».'
        : 'Файл сейфа на этом телефоне не читается. Чтобы не потерять данные, приложение само его не перезаписывает и не создаёт новый сейф. Восстановите сейф из резервной копии (файл .dat) или попробуйте прочитать ещё раз. Копии нет - нажмите «Начать заново»: повреждённый файл останется на телефоне отдельно.',
      buttons: [
        { label: 'Повторить', value: 'retry', cancel: true, kind: 'cancel' },
        { label: 'Начать заново', value: 'fresh', kind: 'cancel' },   // красный - только в подтверждении
        { label: 'Восстановить из копии', value: 'restore', primary: true, kind: 'save' },
      ],
    });
    if (v === 'restore') {
      if (await restoreFromBackupOnCorrupt()) { state.storageCorrupt = false; return startUnlock(); }
      continue;
    }
    if (v === 'fresh') {
      if (await startFreshOnCorrupt({ missing })) { state.storageCorrupt = false; return startSetup(); }
      continue;
    }
    try {
      const f = await bootLoader.wait(BOOT_LOAD_TIMEOUT_MS, 'load-timeout');
      if (f && f.v) { state.file = f; state.storageCorrupt = false; markVaultCreated(); return startUnlock(); }
    } catch (e) { /* по-прежнему повреждён - остаёмся на экране восстановления */ }
  }
}

// 1.2.24 (п.11): понятный выход без резервной копии - «Начать заново». Только после подтверждения.
// Повреждённый файл НЕ удаляется: он откладывается рядом (vault.corrupt-<время>), вдруг его ещё
// удастся вытащить. После этого - создание нового пустого сейфа (новый мастер-пароль).
async function startFreshOnCorrupt({ missing = false } = {}) {
  const ok = await dlgConfirm(
    (missing
      ? 'Данные прежнего сейфа будут недоступны в приложении. Если резервная копия (файл .dat) найдётся позже, её можно будет восстановить через меню.'
      : 'Данные в повреждённом файле будут недоступны в приложении. Сам файл не удаляется: он останется на телефоне отдельно. Если резервная копия (файл .dat) найдётся позже, её можно будет восстановить через меню.')
      + ' Создать новый пустой сейф?',
    { title: 'Начать заново?', ok: 'Начать заново', cancel: 'Назад', danger: true });
  if (!ok) return false;
  // 1.2.25 (п.6): сбой посреди откладывания откатывается (storage.setAsideCorrupt). «Ничего не
  // изменено» - только если откат удался (e.partial === false); иначе честно: отложено частично.
  try { await store.setAsideCorrupt(Date.now()); }
  catch (e) {
    const msg = setAsideFailMessage(e);
    await dlgAlert(msg, 'Начать заново');
    return false;
  }
  try { const ls = lsGet(); if (ls) ls.removeItem(VAULT_MARK_KEY); } catch (e) {}
  state.file = {};
  toast('Повреждённый файл отложен. Создайте новый мастер-пароль');
  return true;
}

// Текст сбоя «Начать заново» (1.2.25, п.6): по факту отката, а не всегда «ничего не изменено».
function setAsideFailMessage(e) {
  const why = saveErrorLabel(e);
  if (e && e.partial) return 'Не удалось отложить повреждённый файл целиком (' + why + '). Часть файлов уже отложена и вернуть их на место не получилось. Новый сейф не создан. Нажмите «Повторить» или восстановите сейф из резервной копии.';
  return 'Не удалось отложить повреждённый файл (' + why + '). Ничего не изменено.';
}

// Ошибка чтения хранилища при старте (1.2.23, A5): файл, возможно, цел, но прочитать его
// сейчас не удалось (сбой памяти/моста) или чтение зависло. НЕ демо и НЕ создание нового сейфа:
// только «Повторить» (заново весь старт). Данные не трогаем.
async function startReadError(err) {
  hideSplash();
  show('#lock');
  const code = err && err.code ? String(err.code) : 'read';
  // 1.2.24 (п.4): чтение не упало, а просто идёт долго (большой сейф, медленный телефон) - оно
  // продолжается. «Повторить» ждёт ЭТО же чтение, а закончится оно само - экран закроется сам.
  const slow = code === 'load-timeout' && bootLoader.pending();
  const ctl = {};
  const dlg = appDialog({
    title: slow ? 'Сейф ещё читается' : 'Не удалось прочитать сейф',
    message: slow
      ? 'Файл сейфа читается дольше обычного: на этом телефоне он большой. Данные не тронуты, чтение продолжается. Подождите: когда оно закончится, окно закроется само. Или нажмите «Повторить».'
      : 'Файл сейфа сейчас не читается (' + code + '). Данные не тронуты: приложение ничего не перезаписывает и не создаёт новый сейф. Нажмите «Повторить». Если не помогает, перезапустите телефон.',
    buttons: [{ label: 'Повторить', value: 'retry', primary: true, kind: 'save' }],
    ctl,
  });
  if (slow) bootLoader.settled().then(() => { if (ctl.close) ctl.close('retry'); });
  await dlg;
  return boot();
}

// Выбор файла копии без «вечного» ожидания: change или cancel (закрыли выбор) завершают промис.
function pickBackupFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.dat'; inp.className = 'hidden';
    const done = (f) => { inp.remove(); resolve(f || null); };
    inp.addEventListener('change', () => done(inp.files && inp.files[0]));
    inp.addEventListener('cancel', () => done(null));
    document.body.appendChild(inp);
    inp.click();
  });
}

async function restoreFromBackupOnCorrupt() {
  const f = await pickBackupFile();
  if (!f) return false;
  let file;
  try { file = JSON.parse(await f.text()); if (!file || !file.v) throw 0; }
  catch { await dlgAlert('Файл не распознан как резервная копия «Сейфа».', 'Восстановление'); return false; }
  const pw = await dlgPrompt('Введите мастер-пароль от этой резервной копии.', { title: 'Восстановление', password: true, placeholder: 'Пароль копии', ok: 'Восстановить' });
  if (!pw) return false;
  try { await C.unlockWithPassword(file, pw); }
  catch { await dlgAlert('Неверный пароль для этой копии.', 'Восстановление'); return false; }
  // A9: битый файл не затираем бесследно - сперва сохраняем его рядом (vault.corrupt-<время>):
  // вдруг его ещё можно будет вытащить. Не получилось - спрашиваем, продолжать ли.
  try { await store.preserveCorrupt(Date.now()); }
  catch (e) {
    const go = await dlgConfirm('Не удалось сохранить копию повреждённого файла (' + saveErrorLabel(e) + '). Всё равно восстановить из резервной копии? Повреждённый файл будет заменён.', { title: 'Восстановление', ok: 'Восстановить', danger: true });
    if (!go) return false;
  }
  try { await store.save(file); }
  catch (e) { await dlgAlert('Не удалось записать копию на устройство (' + saveErrorLabel(e) + ').', 'Восстановление'); return false; }
  markVaultCreated();
  state.file = file;
  toast('Сейф восстановлен из копии - войдите паролем копии');
  return true;
}

// Демо-режим: открываемся сразу в рабочей оболочке с примерами. Данные — только в памяти,
// на диск не пишутся (guardedStoreSave + перехват мутаций). Автолок не армим: секретов нет.
function enterDemo() {
  state.vault = Demo.seedDemoVault();
  state.dek = null; state.dekRaw = null; state.demoMode = true;
  view = 'grid';
  renderShell();
  show('#shell');
}

// Единая точка настройки формы создания мастер-пароля (спека 8a): переключатель
// «Показать пароль» синхронизирует тип полей и прячет «повтор», когда пароль виден.
let setupBound = false;
function bindSetup() {
  if (setupBound) return;
  setupBound = true;
  $('#setup').addEventListener('submit', onSetup);
  const showChk = $('#setupShow');
  const confirmRow = $('#setupConfirmRow');
  const pw = $('#setupPw'), pw2 = $('#setupPw2');
  const sync = () => {
    const on = showChk.checked;
    pw.type = on ? 'text' : 'password';
    pw2.type = on ? 'text' : 'password';
    confirmRow.hidden = !confirmVisible(on);      // пароль виден → подтверждать нечего
  };
  showChk.addEventListener('change', sync);
  // Живой индикатор сложности (8d п.1): полоса + подпись; слабый пароль включает чекбокс
  // согласия. Пустой — блок отдельной проверкой в onSetup, чекбокс не показываем.
  const strBox = $('#setupStrength'), strBar = strBox.querySelector('i'), strLabel = strBox.querySelector('.setup-strlabel');
  const acceptRow = $('#setupAcceptRow'), acceptChk = $('#setupAccept');
  const updStrength = () => {
    const s = masterStrength(pw.value);
    if (s.level < 0) { strBox.hidden = true; acceptRow.hidden = true; acceptChk.checked = false; return; }
    strBox.hidden = false;
    strBar.style.width = ((s.level + 1) / 4 * 100) + '%';
    strBox.dataset.level = String(s.level);
    strLabel.textContent = s.label;
    acceptRow.hidden = !s.weak;                   // согласие спрашиваем только на слабом
    if (!s.weak) acceptChk.checked = false;
  };
  pw.addEventListener('input', updStrength);
  sync(); updStrength();
}

function startSetup() {
  $('#setup').classList.remove('hidden');
  bindSetup();
}

// Отложенное создание мастер-пароля: вызывается из демо при первой реальной попытке
// добавить/править/сохранить. Показывает форму создания поверх экрана блокировки.
function startMasterCreation() {
  show('#lock');
  $('#unlock').classList.add('hidden');
  $('#setup').classList.remove('hidden');
  bindSetup();
  $('#setupPw').focus();
}

// Перехват реальной мутации в демо-режиме: вместо записи открываем создание мастер-пароля.
// reopen — что вернуть после создания (например, тот же редактор). Возвращает false, если
// действие перехвачено (вызывающий должен прекратить), true — можно продолжать.
function requireRealVault(reopen) {
  if (!state.demoMode) return true;
  pendingReopen = typeof reopen === 'function' ? reopen : null;
  startMasterCreation();
  return false;
}

let bioFails = 0;
let pwFails = 0;

// Показать поле мастер-пароля (запасной/основной путь). Единая точка - чтобы режимы входа
// (v3-auth) раскрывали поле одинаково.
function revealMasterField() {
  const f = $('#pwForm'); if (f) f.classList.remove('hidden');
  // 1.2.15: ссылка «Показать подсказку» видна на экране мастер-пароля ТОЛЬКО если подсказка
  // задана - чтобы не ошибаться 3 раза ради неё (авто-показ после 3 неудач остаётся запасным).
  const sh = $('#showHint');
  if (sh) {
    const hint = getPasswordHint(lsGet());
    sh.classList.toggle('hidden', !(hint && hint.trim()));
  }
}

async function startUnlock() {
  $('#unlock').classList.remove('hidden');
  $('#pwForm').addEventListener('submit', onPwUnlock);
  const btn = $('#helloBtn');
  btn.addEventListener('click', () => attemptBio(true));
  // Неприметная ссылка «Войти по мастер-паролю» (запасной путь в режиме биометрии).
  const fb = $('#pwFallback');
  if (fb) fb.addEventListener('click', () => { revealMasterField(); btn.classList.add('hidden'); fb.classList.add('hidden'); const u = $('#unlockPw'); if (u) u.focus(); });
  // 1.2.15: показать сохранённую подсказку по запросу (без 3 неудачных вводов).
  const sh = $('#showHint');
  if (sh) sh.addEventListener('click', () => { const h = $('#lockHint'); const t = getPasswordHint(lsGet()); if (h && t && t.trim()) h.textContent = 'Подсказка: ' + t; });
  showUnsavedAtLockNote();
  showSplash();
  const canBio = shouldOfferBio({
    hasHelloWrap: !!state.file.helloWrap,
    bioAvailable: await Auth.bioAvailable(),
    enabled: isBioLoginEnabled(lsGet()),
  });
  // Стартовый экран = следствие настройки (v3-auth), а не экран выбора.
  if (!canBio) {
    // Режим «мастер-пароль»: сразу поле пароля, кнопки биометрии и ссылки-фолбэка нет.
    hideSplash();
    revealMasterField();
    btn.classList.add('hidden');
    if (fb) fb.classList.add('hidden');
    return;
  }
  // Режим «биометрия»: сразу системный био-запрос; поле пароля скрыто, внизу неприметная ссылка.
  $('#pwForm').classList.add('hidden');
  btn.classList.add('hidden');
  if (fb) fb.classList.remove('hidden');
  $('#lockError').textContent = '';
  { const h = $('#lockHint'); if (h) h.textContent = ''; }
  attemptBio(false);                              // авто-попытка при открытии (не в счёт)
}

// A2: блокировка не дождалась записи (очередь висела дольше DRAIN_MS) - честно говорим об этом
// на экране входа после перезапуска страницы. Показываем один раз.
function showUnsavedAtLockNote() {
  let at = null;
  try { const ls = lsGet(); at = ls && ls.getItem(UNSAVED_AT_LOCK_KEY); if (at) ls.removeItem(UNSAVED_AT_LOCK_KEY); } catch (e) {}
  if (!at) return;
  const n = document.createElement('p');
  n.className = 'lock-unsaved';
  n.setAttribute('role', 'alert');
  n.textContent = 'При блокировке последние изменения не удалось записать на устройство, и они, скорее всего, не сохранились. После входа проверьте последние правки и при необходимости внесите их заново.';
  const card = document.querySelector('#lock .lock-card');
  if (card && !card.querySelector('.lock-unsaved')) card.appendChild(n);
}

// Приглашение приложить палец рисует сам системный BiometricPrompt. Наш текст появляется только
// по неудаче/отмене. Порог фолбэка на мастер-пароль (v3-auth): 3 неудачи ИЛИ отмена.
async function attemptBio(counts) {
  try {
    await Auth.bioVerify();
    const bioKey = C.unb64(await Auth.bioGetKey());
    const res = await C.unlockWithHello(state.file, bioKey);
    await afterUnlock(res);
  } catch (e) {
    if (counts) bioFails++;
    hideSplash();
    const btn = $('#helloBtn');
    const hint = $('#lockHint');
    const fb = $('#pwFallback');
    if (bioFails >= 3) {
      // 3 неудачи → только мастер-пароль: раскрываем поле, прячем кнопку биометрии и ссылку.
      btn.classList.add('hidden');
      if (fb) fb.classList.add('hidden');
      revealMasterField();
      if (hint) hint.textContent = '';
      $('#lockError').textContent = 'Вход по биометрии не удался. Введите мастер-пароль.';
      const u = $('#unlockPw'); if (u) u.focus();
    } else if (counts) {
      // Пользователь нажал «Войти по биометрии» и не удалось - реальная ошибка (красным).
      btn.classList.remove('hidden');
      if (hint) hint.textContent = '';
      $('#lockError').textContent = `Биометрия не распознана (${bioFails} из 3). Повторите или войдите по мастер-паролю.`;
    } else {
      // Авто-попытка при запуске не прошла (отмена) - нейтрально, поле пока не раскрываем.
      // Режим уже выбран в настройках (биометрия), поэтому подсказка НЕ про выбор способа:
      // helloBtn остаётся основной кнопкой, «Войти по мастер-паролю» - неприметный запасной путь.
      btn.classList.remove('hidden');
      $('#lockError').textContent = '';
      if (hint) hint.textContent = 'Приложите палец или нажмите «Войти по биометрии».';
    }
  }
}

// A9: защита от двойного тапа «Создать сейф» (два создания подряд = два разных vault).
let setupBusy = false;
async function onSetup(e) {
  e.preventDefault();
  if (setupBusy) return;
  setupBusy = true;
  const btn = $('#setup button[type="submit"]');
  if (btn) btn.disabled = true;
  try { await onSetupInner(); }
  catch (err) { await dlgAlert('Не удалось создать сейф (' + saveErrorLabel(err) + '). Попробуйте ещё раз.', 'Создание сейфа'); }
  finally { setupBusy = false; if (btn) btn.disabled = false; }
}
async function onSetupInner() {
  const showOn = $('#setupShow').checked;
  const p1 = $('#setupPw').value, p2 = $('#setupPw2').value;
  const acceptedWeak = $('#setupAccept').checked;
  const v = validateMasterCreation(p1, p2, showOn, acceptedWeak);
  if (!v.ok) { await dlgAlert(v.error); if (v.weak) { $('#setupAcceptRow').hidden = false; } return; }
  // v3-auth-A: обязательное подтверждение, что пароль восстановить нельзя (без галочки не продолжаем).
  const warnAck = $('#setupWarnAck');
  if (warnAck && !warnAck.checked) { await dlgAlert('Отметьте галочку: вы понимаете, что мастер-пароль восстановить нельзя.', 'Подтвердите'); return; }
  // v3-auth-B: сохраняем подсказку-напоминание (необязательную, в открытом виде вне vault).
  const hintEl = $('#setupHint');
  const hintVal = hintEl ? hintEl.value : '';
  // L3: подсказка не должна содержать сам пароль (иначе он лежит в открытом виде).
  if (hintLeaksPassword(hintVal, p1)) { await dlgAlert('Подсказка не должна содержать сам пароль - напишите только намёк.', 'Подсказка к паролю'); return; }
  // A1: перед созданием ЗАНОВО читаем диск. Там уже есть сейф (или файл, который не читается) -
  // отказ: новый пустой сейф не должен перезаписать существующий (гонка старта, двойной экран).
  let existing = null;
  try { existing = await withIdleTimeout((beat) => store.load({ onProgress: beat }), BOOT_LOAD_TIMEOUT_MS, 'load-timeout'); }
  catch (err) { existing = err; }
  if (existing) {
    await dlgAlert('На этом телефоне уже есть файл сейфа. Новый сейф не создан, чтобы не перезаписать данные. Перезапустите приложение и войдите в существующий сейф.', 'Сейф уже есть');
    return;
  }
  setPasswordHint(lsGet(), hintVal);
  // Новый пользователь: дефолт режима - мастер-пароль (v3-auth). Биометрию предложим мягко ниже.
  setBioLoginEnabled(lsGet(), false);
  // Демо-данные стираются из памяти, создаётся чистый зашифрованный vault под этим мастер-паролем.
  // store.save идёт мимо демо-заслона, поэтому из демо выходим только после успешной записи.
  const file = await C.newVaultFile(p1, Store.emptyVault());
  await store.save(file);
  markVaultCreated();
  state.demoMode = false;
  state.file = file;
  const res = await C.unlockWithPassword(state.file, p1);
  $('#setupPw').value = ''; $('#setupPw2').value = '';
  if (hintEl) hintEl.value = '';
  await afterUnlock(res, { offerBio: true });   // мягкое предложение включить биометрию - только после создания
  // Пользователь пришёл из демо, пытаясь что-то добавить/править — открываем это сразу.
  if (typeof pendingReopen === 'function') { const r = pendingReopen; pendingReopen = null; r(); }
}

async function onPwUnlock(e) {
  e.preventDefault();
  try {
    const res = await C.unlockWithPassword(state.file, $('#unlockPw').value);
    $('#unlockPw').value = '';
    await afterUnlock(res);
  } catch {
    pwFails++;
    // Подсказку-напоминание показываем ПОСЛЕ 3 неудач (v3-auth-B), если она задана.
    const h = $('#lockHint');
    if (h) {
      const hintText = getPasswordHint(lsGet());
      h.textContent = (pwFails >= 3 && hintText) ? ('Подсказка: ' + hintText) : '';
    }
    $('#lockError').textContent = 'Неверный мастер-пароль.';
  }
}

async function afterUnlock(res, opts = {}) {
  state.dek = res.dek; state.vault = ensureSections(res.vault); state.dekRaw = res.dekRaw || null;
  // Мягкое предложение включить вход по биометрии - ТОЛЬКО после создания пароля (v3-auth),
  // не на каждом входе. Требует разблокированного ключа и доступной биометрии.
  if (opts.offerBio && !state.file.helloWrap && state.dekRaw && await Auth.bioAvailable()) {
    if (await dlgConfirm('Включить вход по биометрии? Дальше сможете открывать сейф одним касанием, а мастер-пароль останется запасным входом.', { title: 'Вход по биометрии', ok: 'Включить', cancel: 'Позже' })) {
      try {
        await Auth.bioVerify();
        const bioKey = C.randomBytes(32);
        await Auth.bioStoreKey(C.b64(bioKey));
        { const hw = await C.attachHelloRaw(state.file, state.dekRaw, bioKey, new Uint8Array(0)); state.file = { ...state.file, helloWrap: hw.helloWrap }; }
        await store.save(state.file);
        setBioLoginEnabled(lsGet(), true);
        toast('Вход по биометрии включён');
      } catch (e) { await dlgAlert('Не удалось включить вход по биометрии: ' + (e && e.message ? e.message : 'отмена') + '.', 'Вход по биометрии'); }
    }
  }
  view = 'grid';
  renderShell();
  show('#shell');
  hideSplash();          // сейф открыт — убираем стартовую заставку (#1)
  haptic('light');       // п.12: тактильный отклик на входе/разблокировке сейфа
  startAutoLock();
  autoRestoreQuietly();
}

// Тихое восстановление покупки после разблокировки (ревью 1.3.0, п.2): Pro не отмечен, адаптер
// боевой RuStore, а товар в аккаунте куплен (переустановка, новый телефон, оплата прошла, а
// ответ шторки потерялся) - отмечаем Pro и записываем. Нет покупки/ошибка сети - молча.
function autoRestoreQuietly() {
  autoRestorePro({
    adapter: getAdapter(),
    getVault: () => (state.demoMode ? null : state.vault),
    isPro: vaultIsPro,
    markPro: Gate.markPro,
    save: saveFile,
  }).then((r) => {
    if (r !== 'restored' && r !== 'saved-failed') return;
    try { updateMenuInfo(); } catch (e) {}
    if (r === 'restored') toast('Покупка найдена в RuStore. Полная версия восстановлена.');
  }).catch(() => {});
}

// ---------- оболочка: витрина разделов ↔ раздел (8f) ----------
// view='grid' — домашний экран: сетка плиток разделов + глобальный поиск в шапке.
// view='section' — список записей раздела: шапка «назад/название/глаз/?/меню» + FAB «+».
// Значок сейфа открывает выезжающее меню (drawer, статичен в index.html) из обоих экранов.
function renderShell() {
  const shell = $('#shell');
  if (view === 'grid') renderGridShell(shell);
  else renderSectionShell(shell);

  // Демо-режим: красный баннер-предупреждение вверху (кликабельный = кнопка). Тап — запуск
  // создания мастер-пароля. Виден на обоих экранах, пока пароль не создан.
  if (state.demoMode) {
    const banner = document.createElement('button');
    banner.type = 'button';
    banner.className = 'demo-banner';
    banner.innerHTML = `<span class="demo-banner-dot">●</span>
      <span class="demo-banner-text"><strong>Демо-режим.</strong> Данные не защищены и не сохранятся. Нажмите, чтобы задать мастер-пароль и начать пользоваться.</span>`;
    banner.onclick = () => startMasterCreation();
    shell.insertBefore(banner, shell.firstChild);
  }

  // Меню-значок есть только на витрине (п.22: из шапки раздела «Меню» убрали, там - «Заблокировать»).
  { const mb = $('#menuBtn'); if (mb) mb.onclick = openMenu; }
  bindMenuOnce();
  bindBackButton();
  window.APP_READY = true;   // сигнал для update.js: сборка дошла до живого экрана (OTA-подтверждение)
}

// Домашний экран — витрина: шапка (меню + глобальный поиск) и сетка плиток разделов.
function renderGridShell(shell) {
  shell.innerHTML = `
    <div class="stickyhead">
      <header class="topbar">
        <button id="menuBtn" class="topbar-menu ic-btn" title="Меню" aria-label="Открыть меню">
          <img class="topbar-safe" src="img/vault-emblem.png" width="30" height="30" alt="Меню"></button>
        <div class="searchwrap">
          <span class="search-ic" aria-hidden="true"></span>
          <input id="search" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" placeholder="Поиск по всем разделам…" aria-label="Поиск по всем разделам">
          <button id="searchClear" class="search-clear" type="button" title="Очистить" aria-label="Очистить поиск" hidden></button>
        </div>
      </header>
    </div>
    <div id="grid" class="vitrina"></div>
    <div id="list" hidden></div>`;
  $('#menuBtn').querySelector('img'); // noop guard (menu bound в renderShell-каркасе)
  const sIc = shell.querySelector('.search-ic'); if (sIc) sIc.innerHTML = icon('search', 18);
  const clr = shell.querySelector('#searchClear'); if (clr) clr.innerHTML = icon('close', 18);
  renderGrid();
  // Поиск глобальный (решение развилки): ввод скрывает плитки и показывает результаты по всем
  // разделам; пустой запрос возвращает витрину. Внутри раздела поиска нет — назад на витрину.
  // ЗАСЛОН device-only (корень «поиск не ищет на телефоне»): раньше слушали ТОЛЬКО 'input'
  // от type="search". На Android WebView экранная клавиатура/IME для type="search" могли не
  // родить полноценный 'input', а нативный крестик слал 'search' без 'input' — строка не
  // очищалась. Теперь: обычный type="text" (IME его не режет) + слушаем 'input' И 'search',
  // плюс свой крупный крестик очистки (тап-зона ≥44px, не микроскопический нативный).
  const input = $('#search');
  const runSearch = () => onGridSearch(input.value);
  input.addEventListener('input', runSearch);
  input.addEventListener('search', runSearch);
  input.addEventListener('compositionend', runSearch);
  if (clr) clr.addEventListener('click', () => { input.value = ''; onGridSearch(''); input.focus(); });
}

function onGridSearch(q) {
  const grid = $('#grid'), list = $('#list'), clr = $('#searchClear');
  if (!grid || !list) return;
  const has = !!q.trim();
  if (clr) clr.hidden = !has;
  if (has) { grid.hidden = true; list.hidden = false; renderList(q); }
  else { stopTotpTimer(); list.hidden = true; list.innerHTML = ''; grid.hidden = false; }
}

// Плитки разделов: иконка на чипе + название + счётчик записей. Тап → вход в раздел.
function renderGrid() {
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';
  const counts = navSectionCounts(state.vault, Store.SECTIONS);
  const shown = visibleSections(Store.SECTIONS, lsGet());   // 18.3: скрытые не показываем
  for (const s of shown) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vtile';
    b.setAttribute('aria-label', UI.SECTION_LABELS[s]);
    b.innerHTML =
      `<span class="cardicon vtile-ic">${renderCardIcon(sectionDefaultIcon(s), 30)}</span>` +
      `<span class="vtile-name">${UI.escapeHtml(UI.SECTION_LABELS[s])}</span>` +
      `<span class="vtile-count">${counts[s]}</span>`;
    b.onclick = () => enterSection(s);
    grid.appendChild(b);
  }
}

// Обновление активного представления после мутации записи (add/edit/delete/fav). Держит
// счётчики плиток витрины свежими и НЕ сбрасывает контекст глобального поиска. Раньше
// saveEntry звал голый renderList() -> счётчики застывали, а правка из поиска подменяла
// результаты полным списком раздела (находка ревью). Логика решения - refreshPlan (тест).
function refreshAfterMutation() {
  const plan = refreshPlan(view, currentQuery());
  if (plan.grid) renderGrid();
  if (plan.list != null) renderList(plan.list);
}

// Экран раздела: шапка назад/название/глаз/подсказка/меню + список записей + FAB «+».
function renderSectionShell(shell) {
  // Глаз «показать всё» рисуем только если в разделе есть что скрывать (18.14): секретное
  // поле по схеме ИЛИ произвольное поле-секрет у записи. В «Документах»/«Заметках» без
  // секретов кнопки нет - она была бы пустышкой.
  const hasSecrets = sectionHasSecrets(UI.FIELD_SCHEMA[current], (state.vault.sections && state.vault.sections[current]) || []);
  const revealBtnHtml = hasSecrets
    ? `<button id="revealBtn" class="ic-btn" title="Показать все пароли" aria-label="Показать все пароли">${icon('eye', 22)}</button>`
    : '';
  shell.innerHTML = `
    <div class="stickyhead">
      <header class="topbar sechead">
        <button id="backBtn" class="ic-btn" title="Назад" aria-label="Назад к разделам">${icon('back', 22)}</button>
        <h1 class="sechead-title">${UI.escapeHtml(UI.SECTION_LABELS[current])}</h1>
        ${revealBtnHtml}
        <button id="reorderBtn" class="ic-btn" title="Изменить порядок" aria-label="Изменить порядок" aria-pressed="false" hidden>${icon('reorder', 22)}</button>
        <button id="helpBtn" class="ic-btn" title="Подсказка по разделу" aria-label="Подсказка">${icon('help', 22)}</button>
        <button id="lockBtn" class="ic-btn" title="Заблокировать" aria-label="Заблокировать сейф">${icon('lock', 22)}</button>
      </header>
    </div>
    <div id="list"></div>
    <button id="fab" class="fab" title="Добавить" aria-label="Добавить запись">+</button>`;
  $('#backBtn').onclick = toGrid;
  $('#helpBtn').onclick = () => showHint(current);
  // «Заблокировать» вынесено отдельной иконкой в шапку раздела (п.22): ручная блокировка -
  // единственное действие меню, полезное прямо внутри раздела; остальное меню - на витрине.
  { const lb = $('#lockBtn'); if (lb) lb.onclick = () => lockNow(); }
  $('#fab').onclick = () => openEditor(current, null);
  const rb = $('#revealBtn');
  if (rb) rb.onclick = () => { revealSecrets = !revealSecrets; syncRevealBtn(); applySecrets(); haptic('light'); };
  const rob = $('#reorderBtn');
  if (rob) rob.onclick = () => toggleReorderMode();
  syncRevealBtn();
  renderList();
}

// ---------- режим порядка карточек (заслон 22) ----------
// Вход/выход через кнопку в шапке и кнопку «Готово» над списком. В режиме body.reorder-mode
// порядок меняется ТОЛЬКО стрелками ↑/↓ (1.2.20: ручное перетаскивание убрано - на телефоне
// попытка прокрутить список срывалась в перенос). Список прокручивается пальцем как обычно
// (touch-action: pan-y), контролы приглушены, тап не разворачивает карточку.
function reorderModeOn() { try { return document.body.classList.contains('reorder-mode'); } catch (e) { return false; } }

function setReorderMode(on) {
  try { document.body.classList.toggle('reorder-mode', !!on); } catch (e) {}
  const rob = $('#reorderBtn');
  if (rob) {
    rob.classList.toggle('on', !!on);
    rob.setAttribute('aria-pressed', on ? 'true' : 'false');
    const lbl = on ? 'Выйти из режима порядка' : 'Изменить порядок';
    rob.title = lbl; rob.setAttribute('aria-label', lbl);
  }
  const bar = $('#reorderBar');
  if (bar) bar.hidden = !on;
}

function toggleReorderMode() {
  const next = !reorderModeOn();
  if (next && (state.vault.sections[current] || []).length < 2) return;   // нечего упорядочивать
  setReorderMode(next);
  haptic('light');
}

// Снять режим порядка (уход из раздела / мало записей). Тихо, без вибро.
function exitReorderMode() { if (reorderModeOn()) setReorderMode(false); }

// Мутация «порядок/избранное» (1.2.23, A7): перерисовываем СРАЗУ, записываем ПОСЛЕ (как
// closeThenPersist у редактора). Раньше перерисовка ждала записи - быстрые тапы по стрелкам
// работали со старым снимком списка. Сбой записи не молчит (toast), правка остаётся в памяти.
function persistAfterRender(failText) {
  if (state.demoMode) { try { refreshAfterMutation(); } catch (e) {} return Promise.resolve(false); }
  return closeThenPersist({
    close: () => { try { refreshAfterMutation(); } catch (e) {} },
    persist: saveFile,
    onFailed: (e) => toast(failText + ' (' + saveErrorLabel(e) + ')'),
  });
}

// Кнопки ↑/↓ на карточке в режиме порядка (п.2): детерминированный обмен с соседом на одну
// позицию ВНУТРИ группы (избранные / обычные, A7). На границе группы кнопка неактивна (избранные
// закреплены сверху - перепрыгнуть их нельзя). Запись двигаем по id и по ТЕКУЩЕМУ массиву в
// момент тапа (listorder.moveWithinGroup), не по индексам прошлой отрисовки. Кнопки видны и
// кликаются только в reorder-mode (CSS), их не гасит общий mute контролов карточки.
function addReorderArrows(card, section, entry) {
  const box = document.createElement('div');
  box.className = 'reorder-move';
  const st = arrowState(state.vault.sections[section] || [], entry.id);
  box.innerHTML =
    `<button type="button" class="reorder-up" title="Выше" aria-label="Переместить выше"${st.up ? '' : ' disabled'}>↑</button>` +
    `<button type="button" class="reorder-down" title="Ниже" aria-label="Переместить ниже"${st.down ? '' : ' disabled'}>↓</button>`;
  const move = (dir) => {
    const r = moveWithinGroup(state.vault.sections[section] || [], entry.id, dir);
    if (!r.moved) return;
    state.vault.sections[section] = r.entries;
    haptic('light');
    persistAfterRender('Не удалось сохранить порядок');
  };
  // Клик по стрелке не всплывает до карточки (stopPropagation).
  box.querySelector('.reorder-up').onclick = (e) => { e.stopPropagation(); move(-1); };
  box.querySelector('.reorder-down').onclick = (e) => { e.stopPropagation(); move(1); };
  const head = card.querySelector('.entry-head') || card;
  head.appendChild(box);
}

// Кнопка порядка видна только когда в разделе 2+ записей и нет активного поиска. Если записей
// стало меньше двух (удаление) — режим сам выключается, чтобы не залипнуть в пустом режиме.
function syncReorderBtn(searching) {
  const rob = $('#reorderBtn'); if (!rob) return;
  const canReorder = !searching && (state.vault.sections[current] || []).length >= 2;
  rob.hidden = !canReorder;
  if (!canReorder) exitReorderMode();
  else setReorderMode(reorderModeOn());   // синхронизировать подпись/бар с текущим состоянием
}

// Вход в раздел с витрины: секреты прячем заново, открываем список раздела.
function enterSection(s) {
  current = s;
  view = 'section';
  revealSecrets = false;
  exitReorderMode();
  renderShell();
  haptic('light');
}

// Возврат на витрину: гасим живые коды 2FA прошлого раздела, перерисовываем оболочку.
function toGrid() {
  stopTotpTimer();
  exitReorderMode();
  view = 'grid';
  renderShell();
  haptic('light');
}

// ---------- резервная копия / смена мастер-пароля (общие для меню) ----------
// Окно «Резервная копия» (п.11, редизайн): две КРУПНЫЕ карточки-действия с иконкой и подписью
// вместо трёх равных кнопок, где «Отмена»/«Восстановить» были неразличимы. «Сохранить копию» -
// основная (мятная), «Восстановить из файла» - вторичная (контурная, визуально другая). «Отмена»
// демотирована в крестик сверху. Логику бэкапа/восстановления НЕ меняем - только представление.
function openBackupDialog() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal backup-modal';
  m.innerHTML = `
    <button type="button" class="backup-x" title="Закрыть" aria-label="Закрыть">✕</button>
    <h3>Резервная копия</h3>
    <button type="button" class="backup-card backup-save" data-act="export">
      <span class="backup-card-ic">${icon('archive', 24)}</span>
      <span class="backup-card-txt">
        <span class="backup-card-t">Сохранить копию</span>
        <span class="backup-card-d">зашифрованный файл на устройство</span>
      </span>
    </button>
    <button type="button" class="backup-card backup-restore" data-act="import">
      <span class="backup-card-ic">${icon('refresh', 24)}</span>
      <span class="backup-card-txt">
        <span class="backup-card-t">Восстановить из файла</span>
        <span class="backup-card-d">заменит текущие данные</span>
      </span>
    </button>`;
  const done = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
  m.querySelector('.backup-x').onclick = done;
  m.querySelector('.backup-save').onclick = () => { done(); doExport(); };
  m.querySelector('.backup-restore').onclick = () => { done(); doImport(); };
  closeOnBackdrop(back, done);
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m);
  document.body.appendChild(back);
}

async function doExport() {
  if (!requireRealVault()) return;   // в демо резервировать нечего — сперва мастер-пароль
  const d = new Date().toISOString().slice(0, 10);
  const name = `vault-backup-${d}.dat`;
  // A8: копия шифрует ТЕКУЩИЙ state.vault (свежая перешифровка в локальную переменную), а не
  // последний ЗАПИСАННЫЙ state.file: если запись на диск упала/висит, копия всё равно содержит
  // все правки. state.file при этом не трогаем (очередь записи ведёт его сама).
  let contents;
  try {
    const enc = await C.reencryptData(state.file, state.dek, state.vault);
    contents = JSON.stringify({ ...state.file, data: enc.data });
  } catch (e) { toast('Не удалось подготовить копию (' + saveErrorLabel(e) + ')'); return; }
  const NP = window.NativePlugins;
  if (window.isNativeApp && window.isNativeApp() && NP && NP.SaveFile) {
    // Системное окно выбора папки: пока оно открыто, автоблок не запирает сейф (косяк #17).
    try {
      const base64 = btoa(unescape(encodeURIComponent(contents)));
      const r = await withSystemWindow(() => NP.SaveFile.save({ name, mime: 'application/octet-stream', base64 }));
      if (r && r.ok) toast('Резервная копия сохранена');
      else if (!(r && r.cancelled)) toast('Не удалось сохранить копию');
    } catch (e) { toast('Не удалось сохранить копию'); }
    return;
  }
  if (window.showSaveFilePicker) {                       // браузер QA на компе
    try {
      const handle = await withSystemWindow(() => window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Резервная копия Сейфа', accept: { 'application/octet-stream': ['.dat'] } }],
      }));
      const w = await handle.createWritable();
      await w.write(contents); await w.close();
      toast('Резервная копия сохранена');
    } catch (e) { if (!(e && e.name === 'AbortError')) toast('Не удалось сохранить копию'); }
    return;
  }
  toast('Сохранение недоступно на этой платформе');
}

function doImport() {
  if (!requireRealVault()) return;
  let inp = document.querySelector('#importFile');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.dat'; inp.id = 'importFile'; inp.className = 'hidden';
    document.body.appendChild(inp);
    inp.onchange = onImportFile;
  }
  inp.click();
}
async function onImportFile(e) {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  let text;
  try { text = await f.text(); } catch (err) { await dlgAlert('Не удалось прочитать файл копии.', 'Восстановление'); return; }
  let file; try { file = JSON.parse(text); if (!file.v) throw 0; } catch { await dlgAlert('Файл не распознан как резервная копия «Сейфа».'); return; }
  const pw = await dlgPrompt('Введите мастер-пароль от этой резервной копии.', { title: 'Восстановление', password: true, placeholder: 'Пароль копии', ok: 'Открыть' });
  if (!pw) return;
  let res;
  try { res = await C.unlockWithPassword(file, pw); }
  catch { await dlgAlert('Неверный пароль для этой копии.'); return; }
  if (!await dlgConfirm('Заменить текущие данные содержимым копии? Текущие записи будут заменены.', { title: 'Восстановление', ok: 'Заменить', danger: true })) return;
  state.vault = ensureSections(res.vault);
  revealSecrets = false; syncRevealBtn();
  // A9: перерисовываем СРАЗУ (данные уже в памяти), запись - после, её сбой не молчит.
  try { if (view === 'grid') renderShell(); else renderList(); } catch (err) {}
  try {
    await saveFile();                 // перешифровка под ТЕКУЩИЙ мастер-пароль
    toast('Данные восстановлены');
  } catch (err) { toast('Данные восстановлены, но не записались на устройство (' + saveErrorLabel(err) + ')'); }
}

// Редактирование подсказки-напоминания к паролю (M1): единый путь из смены пароля и из меню
// «Вход в приложение». Показывает текущую подсказку, предупреждает про открытое хранение,
// держит L3-заслон «не сам пароль» (когда пароль известен - при смене). Пустой ввод очищает.
// knownPw - плейнтекст нового/текущего пароля для проверки утечки; '' если недоступен.
// Двухшаговый доступ к подсказке (1.2.15): сначала ПРОСМОТР (не сразу редактор). Редактирование -
// осознанный второй шаг по кнопке «Изменить»/«Добавить». Текст подсказки - данные пользователя,
// appDialog экранирует message.
async function viewPasswordHint(knownPw = '') {
  const cur = getPasswordHint(lsGet());
  const has = !!(cur && cur.trim());
  const go = await appDialog({
    title: 'Подсказка к паролю',
    message: has ? cur : 'Подсказка не задана.',
    buttons: [
      { label: 'Закрыть', value: null, cancel: true, kind: 'cancel' },
      { label: has ? 'Изменить' : 'Добавить', value: 'edit', primary: true, kind: 'save' },
    ],
  });
  if (go === 'edit') await editPasswordHint(knownPw);
}

async function editPasswordHint(knownPw = '') {
  const cur = getPasswordHint(lsGet());
  const val = await dlgPrompt('Подсказка-напоминание к паролю. Хранится незашифрованной - не пишите в неё сам пароль, только намёк. Пустое поле удалит подсказку.', {
    title: 'Подсказка к паролю', placeholder: 'Намёк на пароль (необязательно)', value: cur, ok: 'Сохранить',
  });
  if (val === null) return;   // отмена - подсказку не трогаем
  if (hintLeaksPassword(val, knownPw)) { await dlgAlert('Подсказка не должна содержать сам пароль - напишите только намёк.', 'Подсказка к паролю'); return; }
  const saved = setPasswordHint(lsGet(), val);
  toast(saved ? 'Подсказка сохранена' : 'Подсказка удалена');
}

async function doChangeMaster() {
  if (!requireRealVault()) return;   // в демо менять нечего — сперва создать мастер-пароль
  // ЗАСЛОН (корень «сменить пароль не спросив действующий»): порядок обязателен —
  // сначала ДЕЙСТВУЮЩИЙ пароль с проверкой (расшифровкой vault), и только при верном —
  // новый + повтор. Иначе любой, кто открыл разблокированный сейф, молча переустанавливал
  // мастер-пароль. Проверка идёт через C.unlockWithPassword: неверный бросает — не меняем.
  const cur = await dlgPrompt('Введите действующий мастер-пароль:', { title: 'Смена мастер-пароля', password: true, placeholder: 'Текущий пароль', ok: 'Далее' });
  if (!cur) return;
  try { await C.unlockWithPassword(state.file, cur); }
  catch { await dlgAlert('Неверный текущий пароль. Мастер-пароль не изменён.'); return; }
  const p1 = await dlgPrompt('Новый мастер-пароль (длинная фраза):', { title: 'Смена мастер-пароля', password: true, placeholder: 'Новый пароль', ok: 'Далее' });
  if (!p1) return;
  const p2 = await dlgPrompt('Повторите новый мастер-пароль:', { title: 'Смена мастер-пароля', password: true, placeholder: 'Ещё раз', ok: 'Сменить' });
  if (p2 === null) return;
  // Ревью 27.09: то же правило, что при создании сейфа (спека 8d) - без жёсткого минимума,
  // слабый пароль только с явным согласием (validateMasterChange = validateMasterCreation).
  let v = validateMasterChange(p1, p2, false);
  if (!v.ok && v.weak) {
    const accept = await dlgConfirm('Новый пароль ' + masterStrength(p1).label + ': его проще подобрать. Принять его на свою ответственность?', { title: 'Слабый пароль', ok: 'Принять', cancel: 'Назад' });
    if (!accept) return;
    v = validateMasterChange(p1, p2, true);
  }
  if (!v.ok) { await dlgAlert(v.error); return; }
  // A9: сбой перешифровки/записи не молчит. Если запись не удалась - возвращаем в памяти прежнюю
  // обёртку ключа: иначе следующая обычная запись молча унесла бы на диск пароль, про который
  // пользователю сказали «не изменён».
  // 1.2.25 (ревью 1.2.24, п.4): при сбое/зависании записи НЕ верим ни «записалось», ни «нет» -
  // перечитываем vault.dat (store.peek) и смотрим, какая обёртка реально на диске (wrapOnDisk).
  // Сообщение и state.file - по факту диска: новая на диске -> пароль изменён (память = новая);
  // старая -> не изменён (память = старая); прочитать не удалось -> честно говорим, что неизвестно.
  const prev = { kdf: state.file.kdf, pwWrap: state.file.pwWrap };
  let next = null;
  try {
    const rw = await C.rewrapPassword(state.file, state.dekRaw, p1);
    next = { kdf: rw.kdf, pwWrap: rw.pwWrap };
    state.file = { ...state.file, kdf: rw.kdf, pwWrap: rw.pwWrap };   // поверх актуального (не затираем data)
    await store.save(state.file);
  } catch (e) {
    let onDisk = 'old';
    if (next) {
      // 1.3.0 (ревью 1.2.25, M1): до peek дождаться очереди записи. Запись serialSave (прошлая правка
      // или автоповтор) могла стоять в той же очереди store ПОСЛЕ нашей упавшей и унести на диск
      // state.file с НОВОЙ обёрткой уже после peek: пользователю «не изменён», а на диске новый
      // пароль. Не дождались за 10 с - честное 'unknown'.
      try {
        await withTimeout(serialSave.settled(), 10000, 'drain');
        onDisk = wrapOnDisk(await withTimeout(store.peek(), 10000, 'verify-timeout'), next, prev);
      }
      catch (e2) { onDisk = 'unknown'; }
    }
    if (onDisk === 'new') {
      toast('Мастер-пароль изменён');
    } else if (onDisk === 'old') {
      state.file = { ...state.file, kdf: prev.kdf, pwWrap: prev.pwWrap };
      toast('Мастер-пароль не изменён: не удалось записать (' + saveErrorLabel(e) + ')');
      saveFile().catch(() => {});   // M1: диск сходится с памятью (прежняя обёртка + текущие данные)
      return;
    } else {
      state.file = { ...state.file, kdf: prev.kdf, pwWrap: prev.pwWrap };
      saveFile().catch(() => {});   // M1: на диске могла остаться новая обёртка - пишем прежнюю, как в памяти
      await dlgAlert('Не удалось проверить, записался ли новый мастер-пароль на устройство (' + saveErrorLabel(e) + '). При следующем входе попробуйте прежний пароль, а если он не подойдёт - новый. Смену пароля лучше повторить позже.', 'Смена мастер-пароля');
      return;
    }
    await editPasswordHint(p1);
    return;
  }
  toast('Мастер-пароль изменён');
  // M1: старая подсказка теперь под новый пароль - предлагаем обновить или очистить (L3-проверка внутри).
  await editPasswordHint(p1);
}

function openProFlow(ret) {
  if (!requireRealVault()) return;   // в демо — сперва мастер-пароль (покупать нечего)
  // PRO активна: вместо пустого «версия полная» - осмысленный список «Что открыто» (1.2.16).
  // Полноценное окно покупки (RuStore Pay/ключ) - freemium-гейт п.24 (openPaywall).
  if (vaultIsPro(state.vault)) { openProInfo(); return; }
  openPaywall({ reopen: typeof ret === 'function' ? ret : undefined });
}

// Список возможностей полной версии (1.2.16). Для PRO - «Что открыто» + отметка «активна».
// Тексты статичны (не данные пользователя), но UI.escapeHtml на всякий случай. В гамме, не нативный.
function openProInfo() {
  const isPro = !!(state.vault && vaultIsPro(state.vault));
  const feats = [
    'Без лимитов: сколько угодно паролей, карт, кошельков, документов и заметок',
    'Все разделы открыты: избранные контакты и важные реквизиты; без ограничений 2FA-коды и seed-фразы',
    'Один платёж навсегда, не подписка',
    'Все данные только на телефоне, под мастер-паролем',
    'Поддержка развития приложения',
  ];
  const back = document.createElement('div'); back.className = 'modal-back';
  const m = document.createElement('div'); m.className = 'modal about';
  m.innerHTML = `
    <div class="about-head">
      <span class="about-app"><img src="img/vault-emblem.png" width="40" height="40" alt=""></span>
      <div>
        <div class="about-name">Полная версия - весь сейф без границ</div>
        ${isPro ? '<div class="about-ver pro-active">Полная версия активна</div>' : ''}
      </div>
      <button type="button" class="dv-close ic-btn about-x" title="Закрыть">${icon('close', 20)}</button>
    </div>
    <div class="about-sec">${isPro ? 'Что открыто' : 'Возможности'}</div>
    <ul class="about-list">${feats.map((f) => `<li>${UI.escapeHtml(f)}</li>`).join('')}</ul>
    <div class="modal-actions"><button type="button" class="save about-ok">Понятно</button></div>`;
  const done = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); done(); } };
  m.querySelector('.about-ok').onclick = done;
  m.querySelector('.about-x').onclick = done;
  closeOnBackdrop(back, done);
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m); document.body.appendChild(back);
  m.querySelector('.about-ok').focus();
}

// ---------- выезжающее меню (drawer) ----------
let menuBound = false;
function menuEl() { return document.querySelector('#menu'); }
function menuIsOpen() { const m = menuEl(); return !!(m && m.classList.contains('open')); }
function openMenu() {
  const m = menuEl(); if (!m) return;
  updateMenuInfo();
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  const bg = document.querySelector('#menuBg'); if (bg) bg.hidden = false;
  haptic('light');
}
function closeMenu() {
  const m = menuEl(); if (!m) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  const bg = document.querySelector('#menuBg'); if (bg) bg.hidden = true;
}
// Иконки меню — SVG из icons.js (8e п.5,9): триггер-сейф, крестик, глифы пунктов.
// Красятся темой через currentColor. Ставятся один раз (разметка меню статична).
function paintMenuIcons() {
  const app = document.querySelector('#menuApp'); if (app) app.innerHTML = '<img class="menu-safe" src="img/vault-emblem.png" width="40" height="40" alt="">';
  const x = document.querySelector('#menuClose'); if (x) x.innerHTML = icon('close', 20);
  for (const el of document.querySelectorAll('#menu .mi-ic[data-ic]')) {
    el.innerHTML = icon(el.dataset.ic, 20);
  }
}
function updateMenuInfo() {
  const ver = document.querySelector('#menuVer');
  // Префикс «v.» ТОЛЬКО для отображения в шапке меню (1.2.16): «Сейф v.1.2.16».
  // Сравнение версий в OTA идёт по window.APP_VERSION напрямую и этим не затрагивается.
  if (ver) ver.textContent = ' v.' + (window.APP_VERSION || '');
  const th = document.querySelector('#mThemeInfo');
  if (th) th.textContent = THEME_LABELS[currentTheme()];
  // Свотч темы (v4, как в «Хомяке»): луна = тёмная (bank), солнце = светлая (nord). Значок
  // и подпись синхронно отражают ТЕКУЩУЮ тему; красится тут, а не в paintMenuIcons (там
  // статичные data-ic), потому что зависит от состояния темы.
  const sw = document.querySelector('#mThemeSwatch');
  if (sw) sw.innerHTML = icon(themeSwatchIcon(currentTheme()), 20);
  // Полная версия (8f A.6): понятный статус — активна / цена покупки, без мелких подписей.
  const pro = document.querySelector('#mProInfo');
  const isPro = !!(state.vault && vaultIsPro(state.vault));
  if (pro) pro.textContent = isPro ? 'активна' : ('Купить за ' + Gate.PRO_PRICE_RUB + ' ₽');
  // Бейдж Free/Pro у версии (18.4): Free — нейтральный серый, Pro — золото.
  const plan = document.querySelector('#menuPlan');
  if (plan) {
    plan.hidden = false;
    plan.textContent = isPro ? 'PRO' : 'FREE';
    plan.classList.toggle('is-pro', isPro);
    plan.classList.toggle('is-free', !isPro);
  }
  // Подпись пункта «Обновление» (18.6): при доступном web-OTA — «доступно обновление»,
  // иначе текущая версия. Наличие новее берём из update.js (newer()).
  const upd = document.querySelector('#mUpdateInfo');
  if (upd) {
    const hasNewer = !!(window.Update && window.Update.newer && window.Update.newer());
    upd.textContent = hasNewer ? 'доступно обновление' : ('версия ' + (window.APP_VERSION || ''));
  }
  // Подпись пункта «Вход в приложение»: текущий способ входа простым языком.
  const bio = document.querySelector('#mBioInfo');
  if (bio) bio.textContent = isBioLoginEnabled(lsGet()) ? 'вход по биометрии' : 'мастер-пароль';
}
function bindMenuOnce() {
  if (menuBound) return;
  menuBound = true;
  paintMenuIcons();
  const on = (id, fn) => { const el = document.querySelector('#' + id); if (el) el.onclick = fn; };
  on('menuClose', closeMenu);
  const bg = document.querySelector('#menuBg'); if (bg) closeOnBackdrop(bg, closeMenu);
  // Тап по «Тема оформления» переключает тему, синхронит значок/подпись и закрывает меню
  // (v4, как в «Хомяке»): результат виден сразу на витрине, а не остаётся в открытом меню.
  on('mTheme', () => { toggleTheme(); updateMenuInfo(); closeMenu(); });
  on('mSections', () => { closeMenu(); openSectionVisibility(); });
  on('mUpdate', () => { closeMenu(); if (window.Update && window.Update.open) window.Update.open(); else dlgAlert('Проверка обновлений станет доступна в собранном приложении.', 'Обновление'); });
  on('mBackup', () => {
    // Сначала закрываем меню, потом показываем окно (иначе плашка бэкапа всплывает ЗА меню, #16).
    closeMenu();
    openBackupDialog();
  });
  on('mBio', () => { closeMenu(); openBioLogin(); });
  on('mKey', () => { closeMenu(); doChangeMaster(); });
  on('mPro', () => { closeMenu(); openProFlow(); });
  on('mAbout', () => { closeMenu(); openAbout(); });
  on('mLock', () => { closeMenu(); lockNow(); });
  bindMenuSwipe();
}

// Свайп-закрытие меню влево (по образцу «Хомяка»): жест из любой точки панели/фона;
// вертикальное движение отдаём прокрутке; съедаем клик, прилетевший после смахивания.
let menuG = null, menuSwiped = false;
function bindMenuSwipe() {
  const targets = [menuEl(), document.querySelector('#menuBg')];
  for (const t of targets) {
    if (!t) continue;
    t.addEventListener('pointerdown', (e) => { if (e.button || !menuIsOpen()) return; menuG = { pid: e.pointerId, x: e.clientX, y: e.clientY }; });
  }
  document.addEventListener('pointermove', (e) => {
    if (!menuG || e.pointerId !== menuG.pid) return;
    const dx = e.clientX - menuG.x, dy = e.clientY - menuG.y;
    // вертикальное движение отдаём прокрутке тела меню
    if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { menuG = null; return; }
    if (!swipeCloses(dx, dy, 'left')) return;          // честный горизонтальный жест (перенос Хомяка, 8f A.4)
    menuG = null; menuSwiped = true;
    haptic('light');
    if (menuIsOpen()) closeMenu();
  }, { passive: true });
  for (const t of ['pointerup', 'pointercancel']) {
    document.addEventListener(t, (e) => { if (menuG && e.pointerId === menuG.pid) menuG = null; });
  }
  document.addEventListener('pointerdown', () => { menuSwiped = false; }, true);
  document.addEventListener('click', (e) => { if (!menuSwiped) return; menuSwiped = false; e.stopPropagation(); e.preventDefault(); }, true);
}

// ---------- системная кнопка «Назад» (Android hardware back, 8d п.9) ----------
// Закрывает верхний слой (модалка/меню/детальный/редактор/пикер/просмотрщик), а не выходит
// из приложения. Из экрана создания мастер-пароля, открытого из демо, — возвращает в демо.
// Пусто закрывать нечего → false (нативно свернём/выйдем). Экспонируем для QA в браузере.
function handleBack() {
  const act = backAction({
    hasModal: !!document.querySelector('.modal-back'),
    menuOpen: menuIsOpen(),
    view,
    demoMasterVisible: state.demoMode && !$('#lock').classList.contains('hidden'),
  });
  switch (act) {
    case 'closeModal':
      // Каждая модалка закрывается по Escape (с подтверждением несохранённого, где нужно).
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    case 'closeMenu': closeMenu(); return true;
    case 'toGrid': toGrid(); return true;          // из раздела → на витрину разделов
    case 'toDemo': enterDemo(); return true;       // из создания мастер-пароля → назад в демо
    default: return false;                         // с витрины → нативно свернуть/выйти
  }
}
let backBound = false;
function bindBackButton() {
  if (backBound) return;
  backBound = true;
  window.__seyfBack = handleBack;   // ручной вызов для QA в браузере (на телефоне — Capacitor App)
  try {
    const NP = window.NativePlugins;
    if (NP && NP.App && window.isNativeApp && window.isNativeApp()) {
      NP.App.addListener('backButton', () => {
        if (!handleBack()) { try { NP.App.exitApp && NP.App.exitApp(); } catch (e) {} }
      });
    }
  } catch (e) {}
}

// ---------- именованные темы оформления (bank / nord) ----------
// Дефолт — bank (тёмная банковская). Прежний ключ день/ночь мигрируется в theme.js.
const THEME_KEY = 'seyf_theme';
function currentTheme() {
  try { return normalizeTheme(window.localStorage.getItem(THEME_KEY)); } catch { return DEFAULT_THEME; }
}
function applyTheme(t) { document.documentElement.setAttribute('data-theme', normalizeTheme(t)); }
function toggleTheme() {
  const next = nextTheme(currentTheme());
  try { window.localStorage.setItem(THEME_KEY, next); } catch {}
  applyTheme(next);
}

// ---------- безопасность: автоблокировка ----------
// 8f: настройку таймера убрали (пункт «Безопасность» из меню тоже). Автоблок всегда включён
// с фиксированным таймаутом + мгновенная блокировка при уходе в фон + ручная «Заблокировать».
const AUTOLOCK_MIN = 5;
function autoLockMinutes() { return AUTOLOCK_MIN; }

// ---------- адаптер окон для update.js (OTA) ----------
// update.js рисует свои окна через window.SeyfUI (по образцу window.UI «Хомяка»), но в
// гамме «Сейфа» и без нативных alert. Тело окна — HTML-строка, кнопки — {label,cls,onClick};
// onClick, вернувший false, оставляет окно открытым (ход работ обновления).
function seyfOpenDlg({ title, body, buttons }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal confirm upd-dlg';
  m.innerHTML = (title ? `<h3>${UI.escapeHtml(title)}</h3>` : '') + (body || '') + '<div class="modal-actions"></div>';
  const acts = m.querySelector('.modal-actions');
  const close = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  for (const b of (buttons || [])) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.label;
    btn.className = b.cls === 'primary' ? 'save' : (b.cls === 'ghost' ? 'cancel' : '');
    btn.onclick = () => { const keep = (typeof b.onClick === 'function') && (b.onClick() === false); if (!keep) close(); };
    acts.appendChild(btn);
  }
  if (!buttons || !buttons.length) { const ok = document.createElement('button'); ok.className = 'save'; ok.textContent = 'Закрыть'; ok.onclick = close; acts.appendChild(ok); }
  closeOnBackdrop(back, close);
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m); document.body.appendChild(back);
}
window.SeyfUI = {
  openDlg: seyfOpenDlg,
  esc: UI.escapeHtml,
  toast,
  openExternal,
  closeMenu,
  renderMenu: () => {
    updateMenuInfo();
    const b = document.querySelector('#mUpdate');
    if (b) b.classList.toggle('has-upd', !!(window.Update && window.Update.newer && window.Update.newer()));
  },
};
// ЗАСЛОН bug3: кнопка «Сохранить бэкап» в диалоге обновления (update.js) зовёт
// window.Backup.backup(). В Сейфе этого объекта не было — кнопка молча ничего не делала.
// Экспортируем сохранение бэкапа (doExport) под тем же контрактом, что у «Хомяка».
window.Backup = { backup: () => { try { return doExport(); } catch (e) {} } };
try { if (window.Update && window.Update.mount) window.Update.mount(); } catch (e) {}

// «О приложении» (8f C.12) — структурная карточка в гамме приложения (по образцу «Хомяка»):
// что это, как пользоваться, безопасность, автор и версия. Без нативного alert.
function openAbout() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal about';
  m.innerHTML = `
    <div class="about-head">
      <span class="about-app"><img src="img/vault-emblem.png" width="40" height="40" alt=""></span>
      <div>
        <div class="about-name">Сейф</div>
        <div class="about-ver">версия ${UI.escapeHtml(window.APP_VERSION || '')}</div>
      </div>
      <button type="button" class="dv-close ic-btn about-x" title="Закрыть">${icon('close', 20)}</button>
    </div>
    <p class="about-lead">Личное офлайн-хранилище: пароли, карты, электронные кошельки, seed-фразы, сканы документов, заметки, коды 2FA и др. - всё под одним мастер-паролем, с входом по биометрии.</p>
    <div class="about-sec">Как пользоваться</div>
    <ul class="about-list">
      <li>Разделы - плитками на главном; поиск ищет сразу по всем.</li>
      <li>Кнопка «+» добавляет запись; тап по карточке разворачивает её.</li>
      <li>Секреты скрыты и копируются одним касанием; «Глаз» в верхней панели показывает все разом.</li>
    </ul>
    <div class="about-sec">Безопасность</div>
    <ul class="about-list">
      <li>Данные шифруются на устройстве и не покидают его.</li>
      <li>Сейф запирается сам: после 5 минут без действий, а при возврате в приложение - если оно было в фоне дольше 5 минут. Кнопка с замком запирает сразу. Открыть - по биометрии или мастер-паролем (выбор в настройках).</li>
    </ul>
    <div class="about-sec">Документы</div>
    <div class="about-contacts">
      <button type="button" class="about-link" data-icon="shield" data-url="https://dorokhin-finance.ru/seyf-store/privacy.html">
        <span class="about-link-ic"></span><span class="about-link-t">Политика конфиденциальности</span></button>
      <button type="button" class="about-link" data-icon="doc" data-url="https://dorokhin-finance.ru/seyf-store/terms.html">
        <span class="about-link-ic"></span><span class="about-link-t">Пользовательское соглашение</span></button>
    </div>
    <div class="about-sec">Автор и связь</div>
    <div class="about-contacts">
      <button type="button" class="about-link" data-icon="globe" data-url="https://dorokhin-finance.ru/">
        <span class="about-link-ic"></span><span class="about-link-t">dorokhin-finance.ru</span></button>
    </div>
    <p class="about-author">Автор - Алексей Дорохин.</p>
    <div class="modal-actions"><button type="button" class="save about-ok">Понятно</button></div>`;
  const done = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); done(); } };
  // Значки ссылок по data-icon (не по индексу: порядок кнопок можно менять): документы (shield/doc)
  // и сайт (globe) → системный браузер (почты в окне нет с 1.3.1, I3). Всё через openExternal - интент
  // наружу, в т.ч. в стор-сборке (CSP connect-src 'none' навигацию не режет).
  m.querySelectorAll('.about-link').forEach((b) => {
    b.querySelector('.about-link-ic').innerHTML = icon(b.dataset.icon, 18);
    b.onclick = () => openExternal(b.dataset.url);
  });
  m.querySelector('.about-ok').onclick = done;
  m.querySelector('.about-x').onclick = done;
  closeOnBackdrop(back, done);
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m); document.body.appendChild(back);
  m.querySelector('.about-ok').focus();
}

// «Разделы на витрине» (18.3) — экран настройки видимости разделов в гамме приложения.
// Тумблер у каждого раздела; скрытые исчезают с витрины. Выбор сохраняется в localStorage.
// Заслон: последний видимый раздел спрятать нельзя (витрина не должна пустеть).
function openSectionVisibility() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal secvis';
  m.innerHTML = `
    <div class="detail-head">
      <span class="detail-title">Разделы на витрине</span>
      <button type="button" class="dv-close ic-btn" title="Закрыть">${icon('close', 20)}</button>
    </div>
    <p class="secvis-lead">Спрячьте разделы, которыми не пользуетесь - они исчезнут с витрины. Данные внутри останутся, вернуть раздел можно здесь же.</p>
    <div class="secvis-list"></div>
    <div class="modal-actions"><button type="button" class="save secvis-done">Готово</button></div>`;
  const list = m.querySelector('.secvis-list');
  const counts = navSectionCounts(state.vault, Store.SECTIONS);
  const render = () => {
    const hidden = getHiddenSections(lsGet());
    list.innerHTML = '';
    for (const s of Store.SECTIONS) {
      const on = !hidden.includes(s);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'secvis-row' + (on ? ' on' : '');
      row.setAttribute('role', 'switch');
      row.setAttribute('aria-checked', on ? 'true' : 'false');
      row.innerHTML =
        `<span class="cardicon secvis-ic">${renderCardIcon(sectionDefaultIcon(s), 20)}</span>` +
        `<span class="secvis-name">${UI.escapeHtml(UI.SECTION_LABELS[s])}</span>` +
        `<span class="secvis-count">${counts[s]}</span>` +
        `<span class="secvis-toggle" aria-hidden="true"><i></i></span>`;
      row.onclick = () => {
        const before = getHiddenSections(lsGet()).slice().sort().join(',');
        toggleSectionHidden(lsGet(), Store.SECTIONS, s);
        const after = getHiddenSections(lsGet()).slice().sort().join(',');
        if (on && before === after) toast('Нужен хотя бы один раздел на витрине');
        render();
        haptic('light');
      };
      list.appendChild(row);
    }
  };
  render();
  const done = () => {
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    if (view === 'grid') renderGrid();   // применить изменения к витрине сразу
  };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); done(); } };
  m.querySelector('.dv-close').onclick = done;
  m.querySelector('.secvis-done').onclick = done;
  closeOnBackdrop(back, done);
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m); document.body.appendChild(back);
  m.querySelector('.secvis-done').focus();
}

// «Вход в приложение» (v3-auth) — переключатель на ДВА положения: «Мастер-пароль» / «Вход по
// биометрии» (радио, не тумблер вкл/выкл). Под ним примечание про 3 попытки и запасной вход.
// Ядро не трогаем: биометрия = привязать helloWrap + bioKey в Keystore; мастер-пароль = убрать
// bioKey и helloWrap. Мастер-пароль работает всегда. Ошибку сохранения показываем toast (v3-2).
function openBioLogin() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal secvis';
  m.innerHTML = `
    <div class="detail-head">
      <span class="detail-title">Вход в приложение</span>
      <button type="button" class="dv-close ic-btn" title="Закрыть">${icon('close', 20)}</button>
    </div>
    <div class="secvis-list authmode-list"></div>
    <p class="secvis-note">Если приложение не распознает биометрию за три попытки, вход только по мастер-паролю. Держите мастер-пароль отдельно от приложения, в надёжном месте.</p>
    <button type="button" class="authmode-hint-btn">Подсказка к паролю</button>
    <p class="secvis-note">Необязательный намёк, если забудете пароль. Хранится незашифрованной - не пишите в неё сам пароль.</p>
    <div class="modal-actions"><button type="button" class="save secvis-done">Готово</button></div>`;
  const list = m.querySelector('.authmode-list');
  let busy = false;
  const render = () => {
    const bioOn = isBioLoginEnabled(lsGet());
    list.innerHTML = '';
    const mkOpt = (mode, label, sub, active) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'authmode-row' + (active ? ' active' : '');
      row.setAttribute('role', 'radio');
      row.setAttribute('aria-checked', active ? 'true' : 'false');
      row.innerHTML =
        `<span class="authmode-radio" aria-hidden="true"></span>` +
        `<span class="authmode-text"><span class="authmode-name">${label}</span><span class="authmode-sub">${sub}</span></span>`;
      row.onclick = () => choose(mode);
      list.appendChild(row);
    };
    mkOpt('master', 'Мастер-пароль', 'Открывать только длинной фразой-ключом.', !bioOn);
    mkOpt('bio', 'Вход по биометрии', 'Открывать по биометрии телефона; мастер-пароль - запасной.', bioOn);
  };
  const choose = async (mode) => {
    if (busy) return;
    const bioOn = isBioLoginEnabled(lsGet());
    if (mode === 'bio' && bioOn) return;         // уже биометрия
    if (mode === 'master' && !bioOn) return;     // уже мастер-пароль
    // Включение биометрии без разблокированного ключа (демо/нет мастер-пароля) — привязывать
    // нечего: сперва создать мастер-пароль.
    if (mode === 'bio' && (state.demoMode || !state.dekRaw)) { done(); requireRealVault(); return; }
    busy = true;
    try {
      if (mode === 'master') {
        // Только мастер-пароль: убрать bioKey из Keystore и helloWrap из файла.
        setBioLoginEnabled(lsGet(), false);
        try { await Auth.bioDeleteKey(); } catch (e) {}
        if (state.file && state.file.helloWrap) {
          state.file = { ...state.file, helloWrap: null };
          try { await guardedStoreSave(state.file); } catch (e) { toast('Не удалось сохранить настройку входа'); }
        }
        toast('Вход по мастер-паролю');
      } else {
        const avail = await Auth.bioAvailable();
        if (!avail) {
          await dlgAlert('На телефоне не настроена биометрия - включите её в настройках телефона, потом вернитесь сюда.', 'Вход по биометрии');
          return;
        }
        if (state.file && state.file.helloWrap) {
          setBioLoginEnabled(lsGet(), true);   // ключ уже привязан — достаточно вернуть выбор
          toast('Вход по биометрии');
        } else {
          try {
            await Auth.bioVerify();                          // подтверждение перед привязкой
            const bioKey = C.randomBytes(32);
            await Auth.bioStoreKey(C.b64(bioKey));
            { const hw = await C.attachHelloRaw(state.file, state.dekRaw, bioKey, new Uint8Array(0)); state.file = { ...state.file, helloWrap: hw.helloWrap }; }
            try { await guardedStoreSave(state.file); } catch (e) { toast('Не удалось сохранить настройку входа'); return; }
            setBioLoginEnabled(lsGet(), true);
            toast('Вход по биометрии включён');
          } catch (e) {
            await dlgAlert('Не удалось включить вход по биометрии: ' + (e && e.message ? e.message : 'отмена') + '.', 'Вход по биометрии');
            return;
          }
        }
      }
    } finally {
      busy = false;
      render();
      try { updateMenuInfo(); } catch (e) {}
    }
  };
  render();
  const done = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); done(); } };
  m.querySelector('.dv-close').onclick = done;
  m.querySelector('.secvis-done').onclick = done;
  // M1: редактирование подсказки к паролю прямо из настроек входа (пароль здесь неизвестен - '').
  m.querySelector('.authmode-hint-btn').onclick = () => viewPasswordHint('');
  closeOnBackdrop(back, done);
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m); document.body.appendChild(back);
  m.querySelector('.secvis-done').focus();
}

// section/entry (B4): чтобы «обычное» копирование ядра для номера карты и произвольных полей
// шло через защищённое (clip.copy: очистка буфера по таймеру и при блокировке).
function handlers(section, entry) {
  return {
    onCopy: copySecret,
    onCopyPlain: (v) => (copyNeedsGuard(section, entry, v) ? copySecret(v) : copyPlain(v)),
    onOpenLink: openExternal,
    // Избранное плавает наверх через displayOrder (8f B.9): ручной порядок массива НЕ трогаем.
    // A7/A9: перерисовка СРАЗУ, запись после; сбой записи - toast, а не тихий unhandled reject.
    onToggleFav: (section, entry) => { if (!requireRealVault()) return; Store.toggleFavorite(state.vault, section, entry.id); haptic('light'); persistAfterRender('Не удалось сохранить избранное'); },
    onEdit: (section, entry) => openEditor(section, entry),
    onDelete: (section, entry) => deleteEntryFlow(section, entry),
  };
}

// Удаление записи (A9): подтверждение -> удаление в памяти -> перерисовка СРАЗУ -> запись;
// сбой записи - toast (раньше необработанный reject: список не обновлялся, ошибка молчала).
async function deleteEntryFlow(section, entry) {
  if (!requireRealVault()) return;
  if (!(await dlgConfirm('Удалить запись?', { title: 'Удаление', ok: 'Удалить', danger: true }))) return;
  Store.deleteEntry(state.vault, section, entry.id);
  haptic('medium');   // п.12
  persistAfterRender('Запись удалена, но не записалась на устройство');
}

function renderList(query = '') {
  stopTotpTimer();                       // прошлый раздел мог держать живые коды 2FA
  const list = $('#list');
  list.innerHTML = '';
  syncReorderBtn(!!query.trim());        // кнопка порядка: видна только в разделе с 2+ записями
  // Название раздела теперь в шапке раздела (8f), поэтому строку-заголовок показываем только
  // для результатов глобального поиска («Поиск»); в списке раздела она была бы дублем.
  if (query.trim()) {
    const bar = document.createElement('div'); bar.className = 'list-bar';
    bar.innerHTML = '<h2>Поиск</h2>';
    list.appendChild(bar);
  }

  if (!query.trim() && current === 'seed' && !isSeedBannerDismissed(window.localStorage)) {
    list.appendChild(renderSeedBanner());
  }

  if (query.trim()) {
    const res = Store.searchEntries(state.vault, query);
    const barH2 = list.querySelector('.list-bar h2');
    // Явное состояние «ничего не найдено» — с иконкой и подсказкой, а не сухая строка.
    if (!res.length) {
      if (barH2) barH2.textContent = 'Поиск';
      const box = document.createElement('div'); box.className = 'search-empty';
      box.innerHTML = `<div class="search-empty-ic">${icon('search', 30)}</div>`
        + `<p class="search-empty-title">Ничего не найдено</p>`
        + `<p class="search-empty-hint">По запросу «${UI.escapeHtml(query.trim())}» совпадений нет. Проверьте раскладку или введите часть слова либо номера.</p>`;
      list.appendChild(box);
      return;
    }
    if (barH2) barH2.textContent = 'Найдено: ' + res.length;
    // Результаты сгруппированы по разделам в порядке витрины (Store.SECTIONS) — так выдача
    // читается, а не сваливается в общий столбец. Заголовок раздела + счётчик над его картами.
    const bySection = new Map();
    for (const r of res) { if (!bySection.has(r.section)) bySection.set(r.section, []); bySection.get(r.section).push(r.entry); }
    for (const section of Store.SECTIONS) {
      const entries = bySection.get(section);
      if (!entries || !entries.length) continue;
      const gh = document.createElement('div'); gh.className = 'search-group';
      gh.innerHTML = `<span class="search-group-ic">${renderCardIcon(sectionDefaultIcon(section), 18)}</span>`
        + `<span class="search-group-name">${UI.escapeHtml(UI.SECTION_LABELS[section])}</span>`
        + `<span class="search-group-count">${entries.length}</span>`;
      list.appendChild(gh);
      for (const entry of entries) {
        const card = UI.renderEntryCard(section, entry, handlers(section, entry));
        decorateCardIcon(card, section, entry);
        decorateCardTitle(card, section, entry);
        applyTitleFallback(card, section, entry);  // Wi-Fi/Реквизиты: заголовок по SSID/полю (п.20/21)
        card.dataset.section = section;
        if (section === 'documents') decorateDocCard(card, entry);
        if (section === 'cards') { decorateCardNumber(card, entry); decorateCardCard(card, entry); }
        if (section === 'contacts') decorateContactCard(card, entry);
        if (section === 'seed') decorateSeedCard(card, entry);
        if (section === 'notes') decorateNoteCard(card, entry);   // дата изменения (п.12)
        decorateExpiryBadge(card, section, entry);   // бейдж срока (п.3)
        hideCustomFieldsInPreview(card, entry);    // кастомные поля - только в развороте (п.15)
        card.draggable = false;
        bindCardExpand(card, section, entry);      // тап → разворот на месте (заход 2 п.6)
        list.appendChild(card);
      }
    }
    applySecrets();
    return;
  }

  const raw = state.vault.sections[current];
  if (!raw.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Пусто. Нажмите «+».'; list.appendChild(p); return; }
  // Порядок показа (8f B.9): ручной порядок массива главный, избранные закреплены сверху.
  const arr = displayOrder(raw);
  // Панель режима порядка (заслон 22): подсказка + «Готово». Видна только когда режим включён
  // (CSS + hidden). Порядок меняется только стрелками ↑/↓, список прокручивается обычно.
  if (arr.length >= 2) {
    const bar = document.createElement('div');
    bar.id = 'reorderBar'; bar.className = 'reorder-bar'; bar.hidden = !reorderModeOn();
    bar.innerHTML = `<span class="reorder-bar-hint">Меняйте порядок стрелками</span>`
      + `<button type="button" class="reorder-done">Готово</button>`;
    bar.querySelector('.reorder-done').onclick = () => { exitReorderMode(); haptic('light'); };
    list.appendChild(bar);
  }
  const cont = document.createElement('div'); cont.id = 'cards';
  const isTotp = current === 'totp';
  const isDocs = current === 'documents';
  arr.forEach((entry, i) => {
    const card = isTotp ? renderTotpCard(entry, handlers('totp', entry)) : UI.renderEntryCard(current, entry, handlers(current, entry));
    decorateCardIcon(card, current, entry);            // иконка записи на чипе (8f B.10)
    decorateCardTitle(card, current, entry);           // фолбэк-заголовок карты + обрезка длинного
    applyTitleFallback(card, current, entry);          // Wi-Fi/Реквизиты: заголовок по SSID/полю (п.20/21)
    card.dataset.section = current;
    if (isDocs) decorateDocCard(card, entry);
    if (current === 'cards') { decorateCardNumber(card, entry); decorateCardCard(card, entry); }   // номер по 4 (18.7) + срок/CVV/ПИН (п.9/10)
    if (current === 'contacts') decorateContactCard(card, entry);
    if (current === 'seed') decorateSeedCard(card, entry);      // у «Сеть / тип» убрать копирование
    if (current === 'notes') decorateNoteCard(card, entry);     // дата изменения (п.12)
    decorateExpiryBadge(card, current, entry);         // бейдж срока «истекает через N дн.»/«истёк» (п.3)
    hideCustomFieldsInPreview(card, entry);            // кастомные поля - только в развороте (п.15)
    // Разворот на месте для ВСЕХ, включая коды 2FA (п.17): карандаш уходит с шапки, правка -
    // кнопкой «Редактировать» в развёрнутом виде. Живой код и копирование по тапу сохраняются.
    bindCardExpand(card, current, entry);
    addReorderArrows(card, current, entry);            // стрелки ↑/↓ (п.2, A7), видны в режиме порядка
    card.style.setProperty('--i', i);                  // ступенчатое появление (anim.js)
    cont.appendChild(card);
  });
  list.appendChild(cont);
  applySecrets();
  if (isTotp) mountTotpLive();
  scheduleReveal(cont);  // старт stagger-анимации (rAF) + setTimeout-страховка (ревью-20 п.3)
}

// ---------- полная версия (free-гейт + разовая покупка) ----------
// Paywall в гамме приложения (не нативный alert). ctx.section/limit — если пришли из упора в лимит;
// ctx.reopen — что открыть после успешной покупки (обычно вернуть редактор добавления).
function openPaywall(ctx = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const m = document.createElement('div');
  m.className = 'modal paywall';
  const reason = ctx.section
    ? (ctx.limit === 0
      ? `<p class="paywall-reason">Раздел «${UI.escapeHtml(UI.SECTION_LABELS[ctx.section])}» доступен в полной версии.</p>`
      : `<p class="paywall-reason">В бесплатной версии в разделе «${UI.escapeHtml(UI.SECTION_LABELS[ctx.section])}» можно хранить до ${ctx.limit} ${plural(ctx.limit, 'записи', 'записей', 'записей')}. Чтобы добавлять без ограничений - откройте полную версию.</p>`)
    : '';
  const freeRows = Store.SECTIONS
    .map((s) => `<li><span>${UI.escapeHtml(UI.SECTION_LABELS[s])}</span><b>${Gate.FREE_LIMITS[s]}</b></li>`)
    .join('');
  // Офлайн-активация лицензионным ключом (1.3.0, как в «Хомяке»): только поле и кнопка. НИКАКИХ
  // ссылок, адресов и контактов «где купить» - требование Алексея и модерации RuStore
  // (тест tests/store-130.test.mjs ловит ссылки/контакты в окне).
  m.innerHTML = `
    <h3>Полная версия - весь сейф без границ</h3>
    <p class="paywall-lead">Один платёж навсегда, не подписка. Работает офлайн.</p>
    ${reason}
    <ul class="paywall-benefits">
      <li>Без лимитов на число записей во всех разделах</li>
      <li>Все разделы открыты: избранные контакты и важные реквизиты; без ограничений 2FA-коды и seed-фразы</li>
      <li>Все данные только на вашем телефоне, под мастер-паролем</li>
      <li>Вы поддерживаете развитие приложения</li>
    </ul>
    <div class="paywall-free">
      <div class="paywall-free-h">Бесплатно доступно:</div>
      <ul class="paywall-free-list">${freeRows}</ul>
    </div>
    <div class="paywall-license">
      <div class="paywall-license-h">Уже есть ключ? Активируйте его</div>
      <div class="paywall-license-sub">Лицензионный ключ приобретается отдельно, вне приложения.</div>
      <div class="paywall-license-row">
        <input type="text" class="pw-key" placeholder="Вставьте ключ" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="text">
        <button type="button" class="save pw-activate">Активировать</button>
      </div>
      <p class="pw-key-msg" hidden></p>
    </div>
    <div class="modal-actions paywall-actions">
      <button type="button" class="cancel pw-close">Закрыть</button>
      <button type="button" class="pw-restore">Восстановить покупку</button>
      <button type="button" class="save pw-buy">Купить за ${Gate.PRO_PRICE_RUB} ₽</button>
    </div>`;
  const done = () => { document.removeEventListener('keydown', onKey, true); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' && isTopModal(back)) { e.stopPropagation(); done(); } };
  const buyBtn = m.querySelector('.pw-buy');
  const restoreBtn = m.querySelector('.pw-restore');
  const setBusy = (b) => { buyBtn.disabled = b; restoreBtn.disabled = b; };
  const PAY_UNAVAILABLE_MSG = 'Оплата и восстановление покупки работают только в приложении, установленном из RuStore. Есть лицензионный ключ - активируйте его в этом окне.';
  // okMsg — тексты статусов на «вы» (задание п.24). По умолчанию — успех покупки/активации ключа.
  // failMsg (A6): что сказать, если оплата/ключ ПРОШЛИ, а запись на устройство упала. Это НЕ
  // «платёж не прошёл» (деньги списаны!): доступ уже открыт в памяти, но может не пережить
  // перезапуск - честно просим восстановить покупку/активировать ключ ещё раз.
  const unlock = async (info, okMsg, failMsg) => {
    Gate.markPro(state.vault, info);
    try { await saveFile(); }         // флаг pro попадает под GCM-тег vault - офлайн и не подделать
    catch (e) {
      try { updateMenuInfo(); } catch (err) {}
      done();
      await dlgAlert((failMsg || 'Покупка прошла, но не записалась на устройство. Нажмите «Восстановить покупку» в окне полной версии.') + ' (' + saveErrorLabel(e) + ')', 'Полная версия');
      if (typeof ctx.reopen === 'function') ctx.reopen();
      return;
    }
    // Бейдж PRO/FREE и строку статуса в меню перерисовываем сразу: если меню открыто
    // (или откроется до перезагрузки), оно уже показывает «активна»/PRO, а не старое FREE.
    try { updateMenuInfo(); } catch (e) {}
    done();
    toast(okMsg || 'Полный доступ открыт. Спасибо, что поддержали разработку!');
    if (typeof ctx.reopen === 'function') ctx.reopen();
  };
  // Покупка (ревью 1.3.0, п.2): итог считает pay.js runPurchase. Уже куплено в этом аккаунте
  // RuStore - не «платёж не прошёл», а путь «Восстановить покупку» (Pro восстанавливается сразу).
  // При сбое НЕ обещаем, что оплата не списалась - этого мы не знаем.
  buyBtn.onclick = async () => {
    setBusy(true);
    const r = await runPurchase(getAdapter());
    if (r.kind === 'ok') { await unlock({ source: getAdapter().kind, purchaseId: r.purchaseId }, 'Полный доступ открыт. Спасибо, что поддержали разработку!'); return; }
    if (r.kind === 'owned') { await unlock({ source: getAdapter().kind, purchaseId: null }, 'Полная версия уже куплена в этом аккаунте RuStore. Покупка восстановлена, платить ещё раз не нужно.', 'Покупка найдена, но не записалась на устройство. Нажмите «Восстановить покупку» ещё раз.'); return; }
    if (r.kind === 'cancelled') toast('Покупка отменена');
    else if (r.kind === 'unavailable') await dlgAlert(PAY_UNAVAILABLE_MSG, 'Оплата');
    else await dlgAlert('Платёж не прошёл. Если деньги всё же списались - нажмите «Восстановить покупку».', 'Оплата');
    setBusy(false);
  };
  restoreBtn.onclick = async () => {
    setBusy(true);
    try {
      const r = await getAdapter().restore();
      if (r && r.error === Payment.PAY_UNAVAILABLE) { await dlgAlert(PAY_UNAVAILABLE_MSG, 'Восстановление'); setBusy(false); return; }
      if (r && r.ok && r.purchased) { await unlock({ source: getAdapter().kind, purchaseId: null }, 'Покупка восстановлена. Полный доступ снова открыт.', 'Покупка найдена, но не записалась на устройство. Нажмите «Восстановить покупку» ещё раз.'); return; }
      await dlgAlert('В этом аккаунте RuStore покупка не найдена. Проверьте, что вошли в тот же аккаунт, которым покупали. Есть лицензионный ключ - активируйте его в этом окне.', 'Восстановление');
    } catch (e) {
      await dlgAlert('Не удалось проверить покупку. Проверьте связь и попробуйте ещё раз.', 'Восстановление');
    }
    setBusy(false);
  };
  // Активация Полной версии лицензионным ключом (8f заход 2 п.9): офлайн-проверка подписи
  // (в приложение вшит публичный ключ ECDSA P-256; ключ = подписанный токен). Валидный →
  // Pro тем же путём, что покупка. Ключ нельзя подделать, вытащив что-либо из APK.
  const keyInput = m.querySelector('.pw-key');
  const activateBtn = m.querySelector('.pw-activate');
  const keyMsg = m.querySelector('.pw-key-msg');
  const showKeyMsg = (text, bad) => { keyMsg.hidden = false; keyMsg.textContent = text; keyMsg.classList.toggle('bad', !!bad); };
  activateBtn.onclick = async () => {
    const raw = (keyInput.value || '').trim();
    if (!raw) { showKeyMsg('Вставьте лицензионный ключ.', true); keyInput.focus(); return; }
    activateBtn.disabled = true; keyInput.disabled = true;
    showKeyMsg('Проверяю ключ…', false);
    let r;
    try { r = await verifyLicense(raw); }
    catch { r = { valid: false, reason: 'crypto' }; }
    if (r && r.valid) {
      await unlock({ source: 'license', purchaseId: (r.payload && r.payload.id) || null }, undefined, 'Ключ принят, но не записался на устройство. Активируйте ключ ещё раз.');
      return;   // окно закрыто в unlock()
    }
    activateBtn.disabled = false; keyInput.disabled = false;
    const why = r && r.reason === 'no-webcrypto'
      ? 'Проверка ключа недоступна на этом устройстве. Обновите приложение.'
      : 'Ключ недействителен. Проверьте, что вставили его целиком и без изменений.';
    showKeyMsg(why, true);
  };
  m.querySelector('.pw-close').onclick = done;
  closeOnBackdrop(back, done);
  document.addEventListener('keydown', onKey, true);
  back.appendChild(m); document.body.appendChild(back);
  buyBtn.focus();
}

// ---------- разворот карточки на месте (заход 2 п.6) ----------
// Тап по карточке разворачивает её на месте: показывает секреты ЭТОЙ записи и футер действий
// (Открыть сканы у документов / Копировать все реквизиты / Редактировать / Удалить). Повторный
// тап сворачивает. Промежуточного экрана нет (п.11: документы теперь тоже разворачиваются, а не
// открывают скан сразу; полноэкранный просмотр - явным действием: тап по миниатюре или «Открыть
// сканы»). Клики по кнопкам/ссылкам/грипу карточку не разворачивают. hardware-back не трогаем.
function bindCardExpand(card, section, entry) {
  // Разворот: правку/удаление уводим с шапки в футер действий (появляется при развороте).
  card.querySelector('.entry-head .ic.edit')?.remove();
  card.querySelector('.entry-head .ic.del')?.remove();
  card.classList.add('tappable', 'expandable');

  const acts = document.createElement('div');
  acts.className = 'card-actions';
  const A = expandActions(section, entry);
  const mkBtn = (cls, label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'card-act ' + cls; b.textContent = label;
    b.onclick = (e) => { e.stopPropagation(); onClick(); };
    acts.appendChild(b);
  };
  if (A.open) mkBtn('open', 'Открыть сканы', () => openDocViewer(entry));
  if (A.share) mkBtn('copyall', 'Копировать все реквизиты', () => copyAllRequisites(entry));
  if (A.edit) mkBtn('edit', 'Редактировать', () => openEditor(section, entry));
  if (A.del) mkBtn('del', 'Удалить', () => deleteEntryFlow(section, entry));
  card.appendChild(acts);

  let expanded = false;
  const applyCardSecrets = () => {
    for (const el of card.querySelectorAll('.f-val.secret')) {
      el.textContent = (expanded || revealSecrets) ? (secretValueOf(el) ?? maskFor(el)) : maskFor(el);
    }
  };
  card.addEventListener('click', (e) => {
    if (reorderModeOn()) return;                               // в режиме порядка тап не разворачивает
    if (e.target.closest('button, a, input, textarea, select')) return;
    expanded = nextExpanded(expanded);
    card.classList.toggle('expanded', expanded);
    applyCardSecrets();
    haptic('light');
  });
}

// Копировать все реквизиты (п.21): собирает поля построчно «подпись: значение» (банк/счёт/БИК/
// корр/ИНН/IBAN, без заметки и «Названия») и кладёт в буфер.
// 1.2.24 (п.2): с C10 сюда входят и произвольные поля (туда кладут что угодно, в т.ч. коды и
// пароли), поэтому копируем ВСЕГДА защищённо: буфер очищается через 30 сек и при блокировке.
async function copyAllRequisites(entry) {
  const text = buildRequisitesShareText(entry);
  if (!text) { toast('Нет реквизитов для копирования'); return; }
  await copySecret(text);
}

// ---------- редактор ----------
function openEditor(section, entry) {
  // Демо-режим: любая попытка добавить/править реальную запись → создание мастер-пароля.
  // Демо-записи после этого стёрты, поэтому возвращаем пользователя к созданию НОВОЙ записи
  // в том же разделе (правка несуществующей демо-записи смысла не имеет).
  if (!requireRealVault(() => openEditor(section, null))) return;
  const isNew = !entry;
  // Free-гейт: добавление новой записи сверх лимита в бесплатной версии → paywall (правку
  // существующей записи и просмотр импортированного перебора не трогаем).
  if (isNew) {
    // Жёсткий предел записей в разделе (v3) - даже для Pro (защита рендера/шифрования).
    const cur = (state.vault.sections[section] || []).length;
    if (cur >= INPUT_LIMITS.recordsPerSection) {
      dlgAlert('В этом разделе достигнут предел - ' + INPUT_LIMITS.recordsPerSection + ' записей. Удалите ненужные, чтобы добавить новые.', 'Предел записей');
      return;
    }
    // Единый источник доступа (п.24): Access.FULL (debug/демо) ИЛИ покупка/лицензия (vault.pro).
    const g = Gate.canAdd(state.vault, section, hasFullAccess());
    if (!g.allowed) { openPaywall({ section, limit: g.limit, reopen: () => openEditor(section, null) }); return; }
  }
  const data = entry ? { ...entry } : {};
  const cfs = entry ? (entry.customFields || []).map((c) => ({ ...c })) : [];
  let dirty = false;
  let iconId = data.icon || '';   // '' = иконка раздела по умолчанию (8f B.10)
  let seedPhraseGetter = null;   // раздел seed: собрать фразу из полей-слов (иначе null)
  // раздел totp: служебные параметры кода (из QR или дефолты 6/30/SHA-1), хранятся отдельно от схемы
  let totpMeta = section === 'totp'
    ? { digits: Number(data.digits) || TOTP_DEFAULTS.digits, period: Number(data.period) || TOTP_DEFAULTS.period, algorithm: data.algorithm || TOTP_DEFAULTS.algorithm }
    : null;
  // раздел documents: рабочая копия страниц-сканов (правим её, на сохранении кладём в patch.pages)
  const docEntry = section === 'documents'
    ? { pages: entry && Array.isArray(entry.pages) ? entry.pages.map((p) => ({ ...p })) : [] }
    : null;

  const back = document.createElement('div');
  back.className = 'modal-back';
  const modal = document.createElement('div');
  modal.className = 'modal editor';
  modal.innerHTML = `<h3>${isNew ? 'Новая запись' : 'Правка'} - ${UI.SECTION_LABELS[section]}</h3><div class="form"></div>
    <div class="cf"><h4>Произвольные поля</h4><div class="cf-list"></div><button type="button" class="add-cf">+ поле</button></div>
    <div class="modal-actions"><button class="cancel">Отмена</button><button class="save">Сохранить</button></div>`;
  const form = modal.querySelector('.form');

  // Иконка записи (8f B.10) — первым рядом формы; по умолчанию иконка раздела.
  const iconRow = document.createElement('div');
  iconRow.className = 'form-row icon-row';
  // Подпись «по разделу/своя иконка» убрана (заход 2 п.13): чип иконки + стрелка, без текста.
  iconRow.innerHTML = `<span>Иконка</span>
    <button type="button" class="picker-btn icon-pick-btn">
      <span class="icon-pick-chip"></span>
      <span class="picker-arrow" aria-hidden="true">▾</span></button>`;
  const iconChip = iconRow.querySelector('.icon-pick-chip');
  const paintIconChip = () => {
    iconChip.innerHTML = renderCardIcon(resolveIconId({ icon: iconId }, section), 24);
  };
  paintIconChip();
  iconRow.querySelector('.icon-pick-btn').onclick = async () => {
    const v = await openIconPicker(section, iconId);
    if (v === null) return;
    iconId = v; paintIconChip(); dirty = true;
  };
  form.appendChild(iconRow);

  for (const f of UI.FIELD_SCHEMA[section]) {
    if (f.readonly) continue;

    // Seed-фраза: ввод по словам с проверкой количества (12/18/24) — защита от опечатки.
    if (section === 'seed' && f.key === 'phrase') {
      const wrap = document.createElement('div');
      wrap.className = 'form-row seed-phrase-row';
      wrap.innerHTML = `<span>${f.label} - вводите по одному слову в каждое поле</span>`;
      const lenBar = document.createElement('div'); lenBar.className = 'seed-len';
      const grid = document.createElement('div'); grid.className = 'seed-words';
      const counter = document.createElement('div'); counter.className = 'seed-counter';
      let words = parseSeedWords(data.phrase);
      let len = SEED_LENGTHS.includes(words.length) ? words.length : (SEED_LENGTHS.find((n) => n >= words.length) || 24);
      const currentWords = () => Array.from(grid.querySelectorAll('.seed-word'))
        .map((i) => i.value.trim().toLowerCase()).filter(Boolean);
      const updateCounter = () => {
        const n = currentWords().length;
        const ok = n === len;
        counter.textContent = `Заполнено ${n} из ${len}${ok ? ' - можно сохранять' : ''}`;
        counter.className = 'seed-counter' + (ok ? ' ok' : (n ? ' warn' : ''));
      };
      // Количество слов — выпадающий список (п.6): компактнее пяти чипов, меньше скролла.
      // Кнопка-пикер в гамме приложения (stylePicker), значение хранит len.
      const lenBtn = document.createElement('button');
      lenBtn.type = 'button'; lenBtn.className = 'picker-btn seed-len-btn';
      lenBtn.innerHTML = '<span class="picker-val"></span><span class="picker-arrow" aria-hidden="true">▾</span>';
      const lenVal = lenBtn.querySelector('.picker-val');
      function syncChips() { lenVal.textContent = `${len} ${plural(len, 'слово', 'слова', 'слов')}`; }
      lenBtn.onclick = async () => {
        const options = SEED_LENGTHS.map((n) => ({ value: String(n), label: `${n} ${plural(n, 'слово', 'слова', 'слов')}` }));
        const v = await stylePicker({ title: 'Сколько слов в seed-фразе', options, value: String(len) });
        if (v === null) return;
        words = currentWords();
        // Смена длины сама по себе не «правка» (18.9): dirty только если уже введено слово.
        if (seedLengthChangeIsDirty(words.length)) dirty = true;
        len = Number(v); syncChips(); renderSlots();
      };
      const renderSlots = () => {
        grid.innerHTML = '';
        for (let i = 0; i < len; i++) {
          const cell = document.createElement('label'); cell.className = 'seed-cell';
          const num = document.createElement('span'); num.className = 'seed-num'; num.textContent = i + 1;
          const inp = document.createElement('input');
          inp.type = 'text'; inp.className = 'seed-word';
          inp.autocapitalize = 'off'; inp.autocomplete = 'off'; inp.spellcheck = false;
          inp.lang = 'en'; inp.inputMode = 'text';   // латинская раскладка BIP-39 (заход 2 п.16)
          inp.value = words[i] || '';
          // Живая подсветка: слово вне списка BIP-39 (или не заполнено) — класс bad снимаем на пустом.
          const markWord = () => inp.classList.toggle('bad', !!inp.value && !seedWordValid(inp.value));
          markWord();
          // принудительная латиница: seed-слова BIP-39 — только [a-z], убираем пробелы/кириллицу/цифры
          // (каретка остаётся на месте - bindCaretMask, 1.2.22)
          bindCaretMask(inp, (v) => String(v).toLowerCase().replace(/[^a-z]/g, ''), {
            isSig: (ch) => /[a-z]/i.test(ch),
            onInput: () => { markWord(); dirty = true; updateCounter(); },
          });
          inp.addEventListener('paste', (e) => {
            const text = ((e.clipboardData || window.clipboardData) || { getData: () => '' }).getData('text');
            const parts = parseSeedWords(text);
            if (parts.length <= 1) return;               // одно слово — обычная вставка
            e.preventDefault();
            if (SEED_LENGTHS.includes(parts.length)) { words = parts; len = parts.length; syncChips(); renderSlots(); }
            else { const inputs = grid.querySelectorAll('.seed-word'); parts.forEach((w, k) => { if (inputs[i + k]) inputs[i + k].value = w; }); updateCounter(); }
            dirty = true;
          });
          cell.appendChild(num); cell.appendChild(inp); grid.appendChild(cell);
        }
        updateCounter();
      };
      const lenLabel = document.createElement('span'); lenLabel.className = 'seed-len-label'; lenLabel.textContent = 'Количество слов';
      lenBar.appendChild(lenLabel); lenBar.appendChild(lenBtn);
      syncChips(); renderSlots();
      wrap.appendChild(lenBar); wrap.appendChild(grid); wrap.appendChild(counter);
      form.appendChild(wrap);
      seedPhraseGetter = () => currentWords().join(' ');
      continue;
    }

    const wrap = document.createElement('label');
    wrap.className = 'form-row';
    const input = f.type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    // B5 (1.2.23): поле-секрет - type=password (клавиатура не запоминает и не подсказывает пароли)
    // + кнопка-глаз «показать». Раньше type=text: Gboard учил пароли в словарь подсказок.
    if (f.type === 'secret') { input.type = editorInputType(f.type); input.dataset.secret = '1'; applySecretAttrs(input); }
    input.value = data[f.key] || '';
    input.dataset.key = f.key;
    wrap.innerHTML = `<span>${f.label}</span>`;
    const holder = f.type === 'secret' ? wrapSecretInput(input) : input;
    if (f.gen) {
      const pwRow = document.createElement('div'); pwRow.className = 'pw-row';
      const strength = document.createElement('span'); strength.className = 'strength';
      pwRow.appendChild(holder); pwRow.appendChild(strength);
      wrap.appendChild(pwRow);
      const g = document.createElement('div'); g.className = 'gen';
      g.innerHTML = `<span class="gen-label">Сгенерировать новый:</span>
        <button type="button" class="gen-rnd">🎲 пароль</button>
        <button type="button" class="gen-phrase">🔤 фразу</button>`;
      const upd = () => { const s = Gen.estimateStrength(input.value); strength.textContent = input.value ? s.label : ''; strength.dataset.score = s.score; };
      input.addEventListener('input', upd);
      // Сгенерированный пароль сразу показываем (глаз открыт): его нужно видеть, чтобы запомнить/проверить.
      const showGen = () => { if (holder.revealSecret) holder.revealSecret(true); };
      g.querySelector('.gen-rnd').onclick = () => { input.value = Gen.generatePassword({ length: 18 }); showGen(); upd(); };
      g.querySelector('.gen-phrase').onclick = () => { input.value = Gen.generatePassphrase({ words: 5 }); showGen(); upd(); };
      wrap.appendChild(g); upd();
    } else {
      wrap.appendChild(holder);
    }
    form.appendChild(wrap);
  }

  // раздел cards (спека 8b п.6): цифровые клавиатуры на номер/CVV/ПИН, живой формат
  // срока ММ/ГГ, и компактная строка [Срок][CVV][ПИН] в одну линию (тап-зона на телефоне).
  if (section === 'cards') {
    // Срок ММ/ГГ цифрами, авто-слэш (8d п.5). Клавиатуры/лимиты остальных полей — wireFieldInputs.
    const exp = form.querySelector('[data-key="expiry"]');
    if (exp) {
      exp.placeholder = 'ММ/ГГ';
      // 1.3.0 (ревью 1.2.25, Info): старый срок при открытии НЕ переписываем (было formatExpiry: «1/29»
      // показывалось как «12/9» и так же сохранялось без единой правки). Формат - только после правки
      // пользователем: маска при наборе, на blur - лишь если поле правили (onlyEdited). Сохранение
      // без правки оставляет исходное значение (checkCardExpiry: поле == старое -> value = старое).
      // C4: «1/» -> «01/», вставка «12/2029» -> «12/29» (formatExpiryLive, тест).
      // 1.2.25 (п.1): на blur приводим к ММ/ГГ только законную форму (normalizeExpiryInput): «12/3029»
      // после правки в середине больше не превращается молча в «12/29» - остаётся видно, а на
      // сохранении - «Проверьте срок».
      bindCaretMask(exp, formatExpiryLive, { onInput: () => { dirty = true; }, endOnly: true, normalize: normalizeExpiryInput, onlyEdited: true });   // 0b: маска только в конце
    }
    const rowOf = (key) => form.querySelector(`[data-key="${key}"]`)?.closest('.form-row');
    const expRow = rowOf('expiry'), cvvRow = rowOf('cvv'), pinRow = rowOf('pin');
    // Короткая подпись «Срок» в тройной строке (ММ/ГГ уже в плейсхолдере) — чтобы три поля
    // реально влезли в одну линию на 390px (8d п.11).
    if (expRow) { const sp = expRow.querySelector('span'); if (sp) sp.textContent = 'Срок'; }
    if (expRow && cvvRow && pinRow) {
      const triple = document.createElement('div');
      triple.className = 'card-triple';
      expRow.parentNode.insertBefore(triple, expRow);
      triple.appendChild(expRow); triple.appendChild(cvvRow); triple.appendChild(pinRow);
    }
  }

  // раздел totp: кнопка живого скана QR над полями (основной путь), ручной ввод — ниже.
  if (section === 'totp') {
    const nameInput = form.querySelector('[data-key="name"]');
    const secretInput = form.querySelector('[data-key="secret"]');
    const scanRow = document.createElement('div');
    scanRow.className = 'totp-scan-row';
    scanRow.innerHTML = `<button type="button" class="totp-scan-btn">📷 Сканировать QR-код</button>
      <span class="totp-scan-hint">или впишите ключ вручную ниже</span>`;
    scanRow.querySelector('.totp-scan-btn').onclick = () => openQrScanner((parsed) => {
      if (nameInput && !nameInput.value) nameInput.value = parsed.name;
      if (secretInput) secretInput.value = parsed.secret;
      totpMeta = { digits: parsed.digits, period: parsed.period, algorithm: parsed.algorithm };
      dirty = true;
    });
    form.insertBefore(scanRow, form.firstChild);
  }

  // раздел requisites: МЯГКАЯ валидация длины (v4). Подсветка ЯНТАРНЫМ + счётчик «{N}/{норма}»
  // + текст-подсказка под полем. Ничего НЕ блокирует - сохранить можно всегда (checkRequisite
  // возвращает level, реального гейта нет). Нормы: р/с 20, корр 20, БИК 9, ИНН 10/12, КПП 9.
  if (section === 'requisites') {
    for (const inp of form.querySelectorAll('[data-key]')) {
      const key = inp.dataset.key;
      if (!hasRequisiteNorm(key)) continue;
      inp.setAttribute('inputmode', 'numeric');
      const row = inp.closest('.form-row');
      if (!row) continue;
      const meta = document.createElement('div');
      meta.className = 'req-meta';
      const counter = document.createElement('span'); counter.className = 'req-counter';
      const hint = document.createElement('span'); hint.className = 'req-hint';
      meta.appendChild(counter); meta.appendChild(hint);
      row.appendChild(meta);
      const paint = () => {
        const r = checkRequisite(key, inp.value);
        counter.textContent = `${r.count}/${r.expected}`;
        hint.textContent = r.message || '';
        row.classList.toggle('req-warn', r.level === 'warn');
      };
      inp.addEventListener('input', paint);
      paint();
    }
  }

  // раздел documents: срок действия + вложения-сканы (фото/файл, просмотр, порядок).
  if (section === 'documents') {
    const meta = document.createElement('div');
    meta.className = 'doc-meta';
    // «Тип документа» убран целиком (D1): он дублировал «Описание» (первое поле-заголовок).
    // Срок действия — полной датой ДД.ММ.ГГГГ цифрами с маской (18.10; у КАРТ остаётся ММ/ГГ),
    // а НЕ календарём (8e п.13). Клавиатура — цифровая (inputmode).
    meta.innerHTML = `
      <label class="form-row"><span>Срок действия</span>
        <input type="text" inputmode="numeric" maxlength="10" placeholder="ДД.ММ.ГГГГ" data-key="expiry" value="${UI.escapeHtml(Docs.formatDocExpiryDisplay(data.expiry || ''))}"></label>`;
    // Порядок полей (1.2.22): «Срок действия» сразу ПОД «Дата выдачи», «Комментарии» последним.
    // Раньше срок шёл appendChild в конец формы - после комментариев. Схему ядра (ui.js) не
    // трогаем: вставляем строку срока в DOM после строки issueDate; фолбэк - перед комментариями.
    placeDocExpiryRow(form, meta);
    // C3 (1.2.23): дата выдачи - маска и разбор как у срока (ДД.ММ.ГГ(ГГ)), хранится ДД.ММ.ГГГГ.
    const issueInput = form.querySelector('[data-key="issueDate"]');
    if (issueInput) {
      issueInput.placeholder = 'ДД.ММ.ГГГГ';
      issueInput.value = Docs.formatIssueDateDisplay(issueInput.value);
      // 1.2.25 (п.8): на blur - сразу ДД.ММ.ГГГГ с 4-значным годом («15.03.27» -> «15.03.1927»).
      // 1.2.25: при наборе в конце введённая точка уважается (formatDocDateLive): «1.3.98» -> «01.03.98».
      bindCaretMask(issueInput, Docs.formatDocDateLive, { onInput: () => { dirty = true; }, endOnly: true, normalize: (v) => Docs.normalizeIssueDateInput(v) });   // 0b
    }
    const expInput = meta.querySelector('[data-key="expiry"]');
    if (expInput) bindCaretMask(expInput, Docs.formatDocDateLive, { onInput: () => { dirty = true; }, endOnly: true, normalize: Docs.normalizeExpiryDateInput });   // 0b: маска только в конце

    const box = document.createElement('div');
    box.className = 'doc-attach';
    box.innerHTML = `
      <div class="doc-attach-head">
        <span>Сканы документа</span>
        <div class="doc-attach-btns">
          <button type="button" class="doc-cam">📷 Сфотографировать</button>
          <button type="button" class="doc-file">📎 Выбрать файл</button>
        </div>
      </div>
      <div class="doc-pages"></div>`;
    const pagesEl = box.querySelector('.doc-pages');
    const renderPages = () => {
      pagesEl.innerHTML = '';
      if (!docEntry.pages.length) {
        const p = document.createElement('p'); p.className = 'doc-pages-empty';
        p.textContent = 'Пока нет сканов. Сфотографируйте документ или выберите файл (картинка или PDF).';
        pagesEl.appendChild(p); return;
      }
      docEntry.pages.forEach((page, i) => {
        const row = document.createElement('div');
        row.className = 'doc-page-row';
        const isPdf = page.mime === 'application/pdf';
        // Имя скана убрано совсем (D3-fix): только миниатюра-кнопка + счётчик «N из M» + стрелки/корзина.
        row.innerHTML = `
          <button type="button" class="doc-page-thumb" title="Открыть">${isPdf ? '📕' : '🖼'}</button>
          <span class="doc-page-name">${i + 1} из ${docEntry.pages.length}</span>
          <span class="doc-page-ord">
            <button type="button" class="doc-up" title="Выше"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="doc-down" title="Ниже"${i === docEntry.pages.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="doc-del" title="Удалить скан">🗑</button>
          </span>`;
        // Открыть скан в просмотрщике; из него можно и удалить именно этот скан (заход 3 п.9),
        // убедившись, что удаляешь нужное. Подтверждение и удаление — здесь, окно пересоберётся.
        row.querySelector('.doc-page-thumb').onclick = () => openDocViewer(docEntry, {
          onRequestDelete: async (pg) => {
            if (!(await dlgConfirm('Удалить этот скан из документа?', { title: 'Удаление скана', ok: 'Удалить', danger: true }))) return false;
            const removed = Docs.removePage(docEntry, pg.id);
            if (removed) { dirty = true; renderPages(); }
            return removed;
          },
        });
        row.querySelector('.doc-up').onclick = () => { Docs.reorderPages(docEntry, i, i - 1); dirty = true; renderPages(); };
        row.querySelector('.doc-down').onclick = () => { Docs.reorderPages(docEntry, i, i + 1); dirty = true; renderPages(); };
        row.querySelector('.doc-del').onclick = async () => {
          if (await dlgConfirm('Удалить этот скан из документа?', { title: 'Удаление скана', ok: 'Удалить', danger: true })) {
            Docs.removePage(docEntry, page.id); dirty = true; renderPages();
          }
        };
        pagesEl.appendChild(row);
      });
    };
    box.querySelector('.doc-cam').onclick = async () => {
      // Предел сканов на документ (v3): защита рендера/шифрования.
      if (docEntry.pages.length >= INPUT_LIMITS.scansPerDoc) { await dlgAlert('В одном документе не больше ' + INPUT_LIMITS.scansPerDoc + ' сканов. Удалите лишние.', 'Предел сканов'); return; }
      // Системная камера уводит приложение в фон — автоблок при этом не запирает (косяк #17).
      // C1: флаг «системное окно» держим ТОЛЬКО на время камеры; окно обрезки - уже без него
      // (иначе, пока открыт кроп, уход в фон на часы не запирал сейф).
      const files = await withSystemWindow(() => chooseFiles({ camera: true }));
      let page = null;
      try { page = await cameraFileToPage(files[0]); }
      catch (e) { await dlgAlert(Docs.IMAGE_PROBLEM_TEXT[e && e.code] || Docs.IMAGE_PROBLEM_TEXT.broken, 'Фото не добавлено'); }
      finally { cleanupCameraTemp(); }    // B2: временный JPEG камеры во внешней папке - удалить
      if (!page) return;
      // Имя скана больше не спрашиваем (D3): названия сканов убраны везде, снимок добавляется сразу.
      Docs.addPage(docEntry, page); dirty = true; renderPages();
    };
    box.querySelector('.doc-file').onclick = async () => {
      if (docEntry.pages.length >= INPUT_LIMITS.scansPerDoc) { await dlgAlert('В одном документе не больше ' + INPUT_LIMITS.scansPerDoc + ' сканов. Удалите лишние.', 'Предел сканов'); return; }
      // Системный выбор файла уводит в фон — автоблок при этом не запирает (косяк #17).
      // C1: флаг держим только на системном окне выбора, обработка/кроп - после, без флага.
      const picked = await withSystemWindow(() => chooseFiles({ camera: false }));
      const { pages, errors, heic, broken } = await filesToPages(picked);
      const room = INPUT_LIMITS.scansPerDoc - docEntry.pages.length;
      const accepted = pages.slice(0, Math.max(0, room));
      for (const p of accepted) Docs.addPage(docEntry, p);
      if (accepted.length) { dirty = true; renderPages(); }
      if (pages.length > accepted.length) await dlgAlert('Добавлены не все: предел ' + INPUT_LIMITS.scansPerDoc + ' сканов на документ.', 'Предел сканов');
      if (heic) await dlgAlert(Docs.IMAGE_PROBLEM_TEXT.heic, 'Фото не добавлено');
      else if (broken) await dlgAlert(Docs.IMAGE_PROBLEM_TEXT.broken, 'Фото не добавлено');
      else if (errors.length) await dlgAlert('Не добавлены (нужны картинка или PDF): ' + errors.join(', '));
    };
    renderPages();
    form.appendChild(box);
  }

  // раздел seed: поле «Сеть / тип» — выпадающий список в гамме приложения (заход 2 п.17),
  // не свободный текст и не нативный select. 8 сетей + «Другое» с ручным вводом.
  if (section === 'seed') {
    const netInput = form.querySelector('[data-key="network"]');
    if (netInput) {
      const NETWORKS = SEED_NETWORKS;
      const row = netInput.closest('.form-row');
      const cur = String(netInput.value || '').trim();
      const known = isKnownNetwork(cur);
      // скрытое поле — источник значения для saveEntry; кнопка-пикер + ручной ввод для «Другое»
      const hidden = document.createElement('input');
      hidden.type = 'hidden'; hidden.dataset.key = 'network'; hidden.value = cur;
      netInput.removeAttribute('data-key');
      netInput.remove();
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'picker-btn net-pick-btn';
      btn.innerHTML = '<span class="picker-val"></span><span class="picker-arrow" aria-hidden="true">▾</span>';
      const custom = document.createElement('input');
      custom.type = 'text'; custom.className = 'net-custom'; custom.placeholder = 'Название сети';
      custom.value = known ? '' : cur;
      custom.hidden = known || !cur;
      const val = btn.querySelector('.picker-val');
      const setLabel = () => {
        const v = hidden.value.trim();
        val.textContent = !v ? 'Не указано' : (NETWORKS.includes(v) ? v : 'Другое: ' + v);
      };
      setLabel();
      custom.addEventListener('input', () => { hidden.value = custom.value.trim(); setLabel(); dirty = true; });
      btn.onclick = async () => {
        const options = [{ value: '', label: 'Не указано' }, ...NETWORKS.map((n) => ({ value: n, label: n })), { value: '__other__', label: 'Другое (вписать)' }];
        const pickVal = (!hidden.value ? '' : (NETWORKS.includes(hidden.value) ? hidden.value : '__other__'));
        const v = await stylePicker({ title: 'Сеть / тип', options, value: pickVal });
        if (v === null) return;
        if (v === '__other__') { custom.hidden = false; hidden.value = custom.value.trim(); custom.focus(); }
        else { custom.hidden = true; custom.value = ''; hidden.value = v; }
        setLabel(); dirty = true;
      };
      row.appendChild(hidden); row.appendChild(btn); row.appendChild(custom);
    }
  }

  // Клавиатуры/маски/лимиты по типам полей (8d п.2,3,4,7,8) — после того как все поля собраны.
  wireFieldInputs(form, section, () => { dirty = true; });
  // B5: атрибуты «не запоминать/не исправлять» для полей-секретов - ПОСЛЕ wireFieldInputs (его
  // PROPS могли выставить autocapitalize, напр. у ключа 2FA), чтобы секрет всегда был закрыт.
  for (const inp of form.querySelectorAll('[data-secret="1"]')) applySecretAttrs(inp);

  const cfList = modal.querySelector('.cf-list');
  const drawCf = () => {
    cfList.innerHTML = '';
    cfs.forEach((c, i) => {
      const r = document.createElement('div'); r.className = 'cf-row';
      // Чекбокс «секрет» убран (п.14): всё приложение под мастер-паролем, а произвольные поля
      // не показываются в свёрнутом превью (п.15), поэтому маскировать их точками незачем.
      r.innerHTML = `<input class="cf-name" placeholder="Название" value="${UI.escapeHtml(c.name || '')}">
        <input class="cf-val" placeholder="Значение" value="${UI.escapeHtml(c.value || '')}">
        <button type="button" class="cf-del" title="Удалить это поле" aria-label="Удалить это поле">🗑</button>`;
      // B5: произвольные поля (туда кладут коды/пароли) - без автоисправления/словаря клавиатуры.
      for (const inp of r.querySelectorAll('input')) applySecretAttrs(inp);
      r.querySelector('.cf-name').oninput = (e) => c.name = e.target.value;
      r.querySelector('.cf-val').oninput = (e) => c.value = e.target.value;
      // Удаляет ТОЛЬКО это поле (пару имя+значение) по индексу i, не весь список (v3).
      r.querySelector('.cf-del').onclick = () => { cfs.splice(i, 1); dirty = true; drawCf(); };
      cfList.appendChild(r);
    });
  };
  drawCf();
  modal.querySelector('.add-cf').onclick = () => { cfs.push({ name: '', value: '', secret: false }); dirty = true; drawCf(); };

  // Любой ввод/переключатель в редакторе помечает запись как изменённую.
  modal.addEventListener('input', () => { dirty = true; });
  modal.addEventListener('change', () => { dirty = true; });

  const cleanup = () => {
    activeEditor = null;
    document.removeEventListener('keydown', onEsc, true);
    back.remove();
  };
  const saveEntry = async () => {
    // 1.2.20: ЛЮБОЕ исключение до закрытия (сбор/валидация/применение к vault) не висит молча, а
    // даёт toast со стадией и e.message; окно тогда остаётся открытым (ввод не теряется).
    let stage = 'collect';
    let savedOk = false;
    try {
      // updatedAt пишем для ВСЕХ разделов (дёшево), но показываем только в карточке заметки (п.12).
      const patch = { customFields: cfs.filter((c) => c.name || c.value), icon: iconId, updatedAt: Store.nowISO() };
      // Регистры/формат по полям (спека 8b п.5): нормализуем значения схемных полей на сохранении.
      // Адрес кошелька и пароли правил не имеют → возвращаются как есть.
      for (const inp of form.querySelectorAll('[data-key]')) {
        patch[inp.dataset.key] = normalizeFieldValue(section, inp.dataset.key, inp.value);
      }
      if (section === 'cards') {
        // 1.2.25 (п.1): решение по СЫРОМУ значению поля (checkCardExpiry), ДО formatExpiryLive. Правка в
        // середине («12/3029», «12/329», «1212/29») раньше молча обрезалась в «валидное» (12/29, 12/32,
        // 12/12). Теперь больше 4 цифр не в форме «год 20ГГ», месяц 13+ и прочий мусор - «Проверьте
        // срок», окно остаётся открытым. C4: нетронутое старое значение записи не блокируем.
        const ce = checkCardExpiry(patch.expiry, entry ? (entry.expiry || '') : '');
        if (!ce.ok) {
          await dlgAlert('Срок карты вводится как ММ/ГГ: месяц от 01 до 12 и две цифры года. Проверьте срок.', 'Проверьте срок карты');
          return;
        }
        patch.expiry = ce.value;   // канонический вид ММ/ГГ
        // 1.2.24 (п.6): срок уже прошёл - предупреждаем (опечатка «12/20» вместо «12/29» частая),
        // но сохранить можно после подтверждения. Нетронутый старый срок записи не переспрашиваем.
        if (ce.passed) {
          const go = await dlgConfirm('Срок карты ' + patch.expiry + ' уже прошёл. Проверьте, нет ли опечатки в годе. Всё равно сохранить?', { title: 'Срок карты истёк', ok: 'Сохранить', cancel: 'Исправить' });
          if (!go) return;
        }
        // Номер карты, если введён, — 13-19 цифр (8d п.2). Пустой номер допускаем (не всё поле обязательно).
        if (patch.number && !cardNumberValid(patch.number)) {
          await dlgAlert('Номер карты должен содержать от 13 до 19 цифр. Проверьте ввод.', 'Проверьте номер карты');
          return;
        }
      }
      if (section === 'seed' && seedPhraseGetter) {
        const phrase = seedPhraseGetter();
        const v = validateSeedPhrase(phrase);
        if (!v.valid) { await dlgAlert(v.message, 'Проверьте seed-фразу'); return; }
        // Проверка каждого слова по списку слов seed-фразы (заход 2 п.16): защита от опечатки.
        const bad = invalidSeedWords(phrase.split(/\s+/));
        if (bad.length) {
          const list = bad.slice(0, 6).map((b) => `«${b.word}»`).join(', ');
          await dlgAlert('Таких слов нет в списке слов для seed-фразы, проверьте написание: ' + list + (bad.length > 6 ? ' и другие' : '') + '.', 'Проверьте seed-фразу');
          return;
        }
        patch.phrase = normalizeFieldValue('seed', 'phrase', phrase);
      }
      if (section === 'totp') {
        const raw = (patch.secret || '').trim();
        try { base32Decode(raw); }
        catch { await dlgAlert('Ключ должен состоять из букв A-Z и цифр от 2 до 7. Отсканируйте QR-код или проверьте ключ.', 'Проверьте ключ'); return; }
        // B6: ключ короче 16 символов - почти наверняка обрезан (коды не совпадут с сервисом).
        if (!secretLongEnough(raw)) { await dlgAlert('Ключ слишком короткий: нужно не меньше 16 символов. Отсканируйте QR-код или проверьте ключ.', 'Проверьте ключ'); return; }
        patch.secret = raw.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
        patch.digits = safeDigits(totpMeta.digits);
        patch.period = safePeriod(totpMeta.period);
        patch.algorithm = totpMeta.algorithm;
      }
      if (section === 'documents') {
        // Осиротевшие поля старых записей чистим при сохранении (v3-3): имена сканов (D3) и тип
        // документа (D1) больше не используются - выпиливаем, чтобы не таскать мусор в vault.
        for (const p of docEntry.pages) { if (p && 'name' in p) delete p.name; }
        patch.pages = docEntry.pages;
        patch.docType = undefined;   // saveEntry ниже вычистит undefined-ключи из patch и записи
        // Срок — полная дата ДД.ММ.ГГГГ (18.10). Пусто допускаем (поле необязательное); заполнено —
        // должно быть реальной датой. Нетронутый старый формат (ММ/ГГ/ISO) не блокируем.
        const rawExp = Docs.normalizeDocDateInput(String(patch.expiry || '').trim());   // 0b: правка в середине
        if (!rawExp) patch.expiry = '';
        else {
          const p = Docs.parseDocDate(rawExp);
          if (p.valid) patch.expiry = p.text;
          else if (entry && (rawExp === String(entry.expiry || '') || String(patch.expiry || '').trim() === String(entry.expiry || ''))) patch.expiry = String(entry.expiry || '');
          else { await dlgAlert('Срок действия вводится полной датой в формате ДД.ММ.ГГГГ. Проверьте дату.', 'Проверьте срок'); return; }
        }
        // C3: дата выдачи - как срок: пусто можно, иначе реальная дата, хранится ДД.ММ.ГГГГ.
        // 1.2.24 (п.7): короткий год - в прошлом («15.03.98» -> 1998); дата в будущем - отказ.
        // 1.2.25 (п.8): решение - Docs.checkIssueDate (тест+мутация). Нетронутое старое значение не
        // блокирует: запись с датой выдачи «в будущем» от старых версий (15.03.2098) сохраняется как была.
        const ci = Docs.checkIssueDate(patch.issueDate, entry ? (entry.issueDate || '') : '');
        if (!ci.ok && ci.reason === 'future') { await dlgAlert('Дата выдачи ' + ci.text + ' ещё не наступила. Проверьте дату.', 'Проверьте дату выдачи'); return; }
        if (!ci.ok) { await dlgAlert('Дата выдачи вводится в формате ДД.ММ.ГГГГ. Проверьте дату.', 'Проверьте дату выдачи'); return; }
        patch.issueDate = ci.value;
      }
      stage = 'apply';
      // createdAt для нового (8e п.16, newest-first). Ставим тут, mobile-only: store.js — core,
      // его не трогаем; порядок показа считает listorder.displayOrder по этой метке.
      let savedId;
      if (isNew) {
        Store.createEntry(state.vault, section, { ...patch, createdAt: Store.nowISO() });
        // Новая запись — первой (8f B.9). createEntry кладёт в конец массива; двигаем в начало.
        const a = state.vault.sections[section];
        savedId = a[a.length - 1] && a[a.length - 1].id;
        Store.reorderEntry(state.vault, section, a.length - 1, 0);
      } else { Store.updateEntry(state.vault, section, entry.id, patch); savedId = entry.id; }
      // Чистка осиротевших/undefined-ключей прямо в сохранённой записи (v3-3): Store.updateEntry
      // делает merge и не умеет удалять ключи, поэтому подчищаем тут перед шифрованием.
      const saved = (state.vault.sections[section] || []).find((e) => e.id === savedId);
      if (saved) {
        for (const k of Object.keys(saved)) if (saved[k] === undefined) delete saved[k];
        if (section === 'documents') { delete saved.docType; if (Array.isArray(saved.pages)) for (const p of saved.pages) { if (p && 'name' in p) delete p.name; } }
      }
      savedOk = true;
    } catch (e) {
      toast('Не удалось сохранить запись (' + stage + ': ' + saveErrorLabel(e) + ')');
      return;
    }
    if (!savedOk) return;
    // [БАГ п.1, повтор 1.2.20] Редактор ОБЯЗАН закрыться сразу после применения правки к vault.
    // В 1.2.18 закрытие стояло ПОСЛЕ await saveFile() в try/catch - это спасало от ОТКЛОНЕНИЯ
    // записи, но не от ПОДВИСАНИЯ (промис не резолвится -> окно висит, «Сохранить ничего не
    // делает»). Теперь closeThenPersist: close() синхронно ДО записи, запись - после, со стадийным
    // таймаутом; сбой/таймаут -> toast с кодом (write-timeout, reencrypt: <msg>...). Заслоны:
    // tests/persist.test.mjs (подвисший мок) + tools/qa-save-all.mjs [--hang] по всем разделам.
    await closeThenPersist({
      close: () => {
        dirty = false;
        cleanup();
        try { refreshAfterMutation(); } catch (e) { toast('Запись сохранена, но список не обновился (render: ' + saveErrorLabel(e) + ')'); }
      },
      persist: saveFile,
      onSaved: () => haptic('light'),   // п.12: тактильный отклик на успешном сохранении записи
      onFailed: (e) => toast('Не удалось записать на устройство (' + saveErrorLabel(e) + ')'),
    });
  };
  const requestClose = async () => {
    if (!dirty) { cleanup(); return; }
    const r = await styledConfirm({
      title: 'Несохранённые изменения',
      message: 'В записи есть правки. Сохранить их перед закрытием?',
    });
    if (r === 'cancel') return;          // остаёмся в редакторе
    if (r === 'save') { await saveEntry(); return; }
    if (r === 'deny') cleanup();         // закрыть без сохранения
  };
  // C2 (1.2.23): «Назад»/Escape закрывает только ВЕРХНЕЕ окно. Если поверх редактора открыто
  // вложенное (пикер иконки, кроп, просмотр скана, QR, подтверждение) - его закроет свой
  // обработчик, а редактор остаётся. Раньше редактор ловил тот же Escape и закрывался вместе с ним.
  const onEsc = (e) => {
    if (e.key !== 'Escape') return;
    if (!isTopModal(back)) return;                         // поверх есть другое окно - оно само
    if (document.querySelector('.modal.confirm')) return; // диалог сам себя закроет
    e.stopPropagation(); requestClose();
  };

  modal.querySelector('.cancel').onclick = requestClose;
  modal.querySelector('.save').onclick = saveEntry;
  closeOnBackdrop(back, requestClose);
  document.addEventListener('keydown', onEsc, true);
  activeEditor = { isDirty: () => dirty, save: saveEntry };

  back.appendChild(modal);
  document.body.appendChild(back);
}

// ---------- копирование с очисткой буфера ----------
async function copySecret(text) {
  try {
    await clip.copy(text);
    toast('Скопировано - буфер очистится через 30 сек или при блокировке');
    haptic('light');   // п.12: тактильный отклик на копировании (один отклик = одно действие)
  } catch { toast('Не удалось скопировать'); }
}
// Обычное копирование (несекретные поля, спека 8b п.7): без авто-очистки буфера.
async function copyPlain(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(String(text ?? ''));
    else throw new Error('no clipboard');
    toast('Скопировано');
    haptic('light');   // п.12
  } catch { toast('Не удалось скопировать'); }
}
// Открыть ссылку в СИСТЕМНОМ браузере (спека 8b п.8), не во встроенном WebView (там
// расшифрованный vault). В APK Capacitor уводит window.open с чужим target в интент;
// запасной путь — скрытый <a target="_blank">. Схему уже проверил safeHttpUrl в ui.js.
function openExternal(url) {
  let w = null;
  try { w = window.open(url, '_system'); } catch (e) {}
  if (!w) { try { w = window.open(url, '_blank'); } catch (e) {} }
  if (w) return;
  try {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast('Не удалось открыть ссылку'); }
}
function toast(msg) {
  let t = document.querySelector('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2500);
}

// Значение секрета берём из state.vault по координатам (data-sec/id/fk), а не из DOM —
// plaintext в data-атрибуте не живёт (findings М-2). fk вида 'cf:<i>' — кастомное поле.
function secretValueOf(el) {
  const sec = el.dataset.sec, id = el.dataset.id, fk = el.dataset.fk;
  if (!sec || !id || !fk || !state.vault) return null;
  const entry = (state.vault.sections[sec] || []).find((e) => e.id === id);
  if (!entry) return null;
  if (fk.startsWith('cf:')) {
    const cf = (entry.customFields || [])[Number(fk.slice(3))];
    return cf ? cf.value : null;
  }
  return entry[fk];
}

// Маска скрытого секрета. Для CVV/ПИН - короткая по стандартной длине (п.9): 3 и 4 точки,
// data-mask ставит decorateCardMasks. Для настоящих секретов (пароль/seed/ключ) длину НЕ
// раскрываем - фикс-маска 8 точек.
function maskFor(el) { return el.dataset.mask || '••••••••'; }

// Применить глобальное состояние показа/скрытия ко всем секретным полям.
function applySecrets() {
  for (const el of document.querySelectorAll('.f-val.secret')) {
    el.textContent = revealSecrets ? (secretValueOf(el) ?? maskFor(el)) : maskFor(el);
  }
}

// Кнопка «глаз» в шапке: иконка соответствует состоянию (8f A.3). Пароль ВИДЕН
// (revealSecrets) → открытый «eye»; скрыт → зачёркнутый «eyeOff». Класс on красит акцентом.
function syncRevealBtn() {
  const rb = $('#revealBtn'); if (!rb) return;
  rb.classList.toggle('on', revealSecrets);
  rb.innerHTML = icon(eyeIconName(revealSecrets), 22);
  const lbl = revealSecrets ? 'Скрыть все пароли' : 'Показать все пароли';
  rb.title = lbl; rb.setAttribute('aria-label', lbl);
}

// Вибро-отклик на ключевых действиях (перенос идеи Хомяка). Через Capacitor Haptics
// на телефоне; в браузере/без плагина — тихий фолбнек на navigator.vibrate или ничего.
// Уважает reduced-motion — при нём вибрации не шлём.
function haptic(kind = 'light') {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const native = window.isNativeApp && window.isNativeApp();
    const NP = window.NativePlugins;
    // Capacitor Haptics — ТОЛЬКО на телефоне: в вебе плагин бросает UNIMPLEMENTED (обещание
    // отклоняется → «Uncaught in promise»), поэтому .catch глушим и в браузер не лезем.
    // 1.2.21: сила возвращена к 1.2.19 по просьбе Алексея (×3 из 1.2.20 оказалось слишком):
    // импакт light→MEDIUM, medium/heavy/success→HEAVY + vibrate 40/80/120 мс.
    // Удаление (medium) заметнее рутины (light): 80 против 40 мс.
    const dur = hapticMs(kind);
    if (native && NP && NP.Haptics) {
      const style = (kind === 'heavy' || kind === 'medium' || kind === 'success') ? 'HEAVY' : 'MEDIUM';
      try { const p = NP.Haptics.impact && NP.Haptics.impact({ style }); if (p && p.catch) p.catch(() => {}); } catch (e) {}
      try { const v = NP.Haptics.vibrate && NP.Haptics.vibrate({ duration: dur }); if (v && v.catch) v.catch(() => {}); } catch (e) {}
      return;
    }
    if (navigator.vibrate) navigator.vibrate(kind === 'success' ? [16, 40, 16] : dur);
  } catch (e) {}
}
// Длительность вибро-отклика (мс) по силе, как в 1.2.19. Отдельно - чтобы заслон-тест видел числа.
function hapticMs(kind) {
  return kind === 'success' || kind === 'heavy' ? 120 : kind === 'medium' ? 80 : 40;
}

// ---------- автоблокировка и паника ----------
let autoLock = null;
let autoLockBound = false;
function startAutoLock() {
  if (!autoLock) autoLock = createAutoLock({ timeoutMs: autoLockMinutes() * 60 * 1000, onLock: lockNow });
  else autoLock.setTimeoutMs(autoLockMinutes() * 60 * 1000);
  autoLock.arm();
  if (autoLockBound) return;
  autoLockBound = true;
  for (const ev of ['mousemove', 'keydown', 'click', 'input', 'touchstart']) {
    document.addEventListener(ev, () => autoLock && autoLock.activity(), { passive: true });
  }
  document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') lockNow(); });
  // Уход в фон / возврат (18.8): НЕ запираем мгновенно. Запоминаем момент ухода; при возврате
  // в пределах окна автоблока оставляем тот же экран (DOM не трогаем), за окном — запираем.
  // Фоновые таймеры на телефоне заморожены, поэтому решение считаем по прошедшему времени.
  document.addEventListener('visibilitychange', () => { if (document.hidden) onBackground(); else onForeground(); });
  try {
    const NP = window.NativePlugins;
    if (NP && NP.App && window.isNativeApp && window.isNativeApp()) {
      NP.App.addListener('appStateChange', (s) => { if (!s) return; if (s.isActive === false) onBackground(); else onForeground(); });
    }
  } catch (e) {}
}
let bgAt = 0;    // метка ухода в фон (мс), 0 — на переднем плане
// Флаг «сейчас открыто НАШЕ системное окно» (сохранение копии, выбор файла, камера). Пока он
// поднят, уход в фон не считается уходом пользователя и не запирает сейф (корень косяка #17).
let sysWindowOpen = false;
// Обёртка вокруг вызова, открывающего системное окно: поднимает флаг на время ожидания и
// снимает его вместе с меткой фона, когда окно закрылось (успех, отмена или ошибка).
async function withSystemWindow(fn) {
  sysWindowOpen = true;
  try { return await fn(); }
  finally { sysWindowOpen = false; bgAt = 0; }
}
function onBackground() {
  if (sysWindowOpen) return;              // наше системное окно — это не уход пользователя
  if (!autoLock || !state.vault) return;
  if (!bgAt) bgAt = Date.now();
}
function onForeground() {
  if (!autoLock || !state.vault) { bgAt = 0; return; }   // не разблокировано/уже заперто
  const away = bgAt; bgAt = 0;
  // B3: очистка буфера по таймеру в фоне могла не пройти (WebView без фокуса) - повторяем сейчас.
  try { clip.retryIfFailed().catch(() => {}); } catch (e) {}
  const dec = foregroundDecision({ systemWindowOpen: sysWindowOpen, backgroundedAt: away, now: Date.now(), autolockMs: autoLockMinutes() * 60 * 1000 });
  if (dec === 'lock') { lockNow(); return; }
  autoLock.arm();   // в пределах окна: тот же экран остаётся, таймер бездействия взводим заново
}
let locking = false;
async function lockNow() {
  if (locking) return;                  // защита от двойного входа (фон + таймер)
  locking = true;                       // блокировка важнее несохранённой правки
  stopTotpTimer();
  if (autoLock) autoLock.disarm();
  // Очищаем буфер ДО reload: иначе таймер очистки гибнет со страницей и секрет
  // остаётся в буфере после ухода в фон/блокировки (findings В-2).
  // 1.2.24 (п.1): без фокуса WebView запись в буфер отклоняет - ждём фокус (не дольше 1,5 с).
  // Не вышло - флаг в localStorage (clip сам его ставит), после reload буфер очистится при фокусе.
  if (clip.hasPending()) { try { await waitForFocus({ ...focusApi, ms: 1500 }); } catch (e) {} }
  try { await clip.clearIfOurs(); } catch (e) {}
  // A2: reload обрывает JS - незавершённая запись (редактор уже закрыт, правка в очереди) до
  // диска не дойдёт. Прячем экран сразу (секреты не видны, пока ждём), ждём очередь записи
  // (не дольше DRAIN_MS) и только потом запираем. Не дождались - запираем всё равно, но честно:
  // на экране входа будет предупреждение, что последние изменения могли не записаться.
  hideShellForLock();
  const unsaved = await lockDrain();
  if (unsaved) { try { const ls = lsGet(); if (ls) ls.setItem(UNSAVED_AT_LOCK_KEY, String(Date.now())); } catch (e) {} }
  state.vault = null; state.dek = null; state.dekRaw = null;
  location.reload();
}
// true - после ожидания всё ещё есть незаписанные изменения.
// 1.2.24 (п.5): если последняя попытка записи упала, один раз записываем заново и ждём очередь
// (drainWithRetry) - разовая ошибка записи больше не теряет правку при блокировке.
async function lockDrain() {
  if (!state.vault || state.demoMode) return false;
  if (!serialSave.unsaved()) return false;
  await drainWithRetry(serialSave, DRAIN_MS);
  return serialSave.unsaved();
}
function hideShellForLock() {
  try {
    for (const b of document.querySelectorAll('.modal-back')) b.remove();
    const sh = $('#shell'); if (sh) sh.classList.add('hidden');
    const ub = $('#unsavedBanner'); if (ub) ub.hidden = true;
    closeMenu();
    showSplash();
  } catch (e) {}
}

// Страховка на реальное закрытие вкладки/окна: если в открытом редакторе есть
// несохранённые правки — браузер спросит подтверждение (это его системное окно,
// стилизовать его нельзя; наш стилизованный запрос — при закрытии редактора внутри).
window.addEventListener('beforeunload', (e) => {
  if (locking) return;
  if (activeEditor && activeEditor.isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// Глушим «висячие» отклонения от веб-заглушек Capacitor: в браузере плагины (Haptics и др.)
// бросают UNIMPLEMENTED, обещание отклоняется -> «Uncaught (in promise)» засоряет консоль QA.
// На устройстве плагины реальны и сюда не попадают. Гасим ТОЛЬКО такие безопасные отклонения
// (по сигнатуре сообщения) - настоящие ошибки по-прежнему логируются.
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason;
  const msg = String((r && (r.message || r.code)) || r || '');
  if (/UNIMPLEMENTED|not implemented on web|not available|Haptics|Capacitor/i.test(msg)) {
    e.preventDefault();
  }
});

applyTheme(currentTheme());   // тема из настроек до первой отрисовки — без вспышки
boot();
export { state, saveFile, toast };   // toast - для QA 0a (tools/qa-save-all.mjs)
