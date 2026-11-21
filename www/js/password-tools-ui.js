// Caller initializes with the same modal helpers as archive-ui. No storage or network.
import { generatePassword, generateArchivePassword, auditPasswords } from './password-tools.js';
let D;
const openWindows = new Set();
export function initPasswordToolsUI(deps) { closePasswordTools(); D = deps; }
export function closePasswordTools() { for (const close of [...openWindows]) close(); }

function modal(title) {
  if (!D) throw new Error('initPasswordToolsUI is required');
  const deps = D, originalVault = deps.state?.vault, previous = document.activeElement;
  const back = document.createElement('div'); back.className = 'modal-back';
  const body = document.createElement('div'); body.className = 'modal confirm';
  body.setAttribute('role', 'dialog'); body.setAttribute('aria-modal', 'true'); body.setAttribute('aria-label', title);
  back.append(body);
  let closed = false, cleanups = [];
  const alive = () => !closed && back.isConnected && deps.state?.vault === originalVault;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('seyf:locking', close);
    document.removeEventListener('keydown', onKey, true);
    observer.disconnect();
    for (const fn of cleanups) fn();
    cleanups = [];
    body.querySelectorAll('input,textarea').forEach(el => { el.value = ''; });
    body.replaceChildren(); back.remove(); openWindows.delete(close);
    if (previous?.isConnected) previous.focus();
  };
  const onKey = event => {
    if (event.key === 'Escape' && deps.isTopModal(back)) { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    if (event.key === 'Tab' && deps.isTopModal(back)) {
      const controls = [...body.querySelectorAll('button,input,textarea')].filter(el => !el.disabled && !el.hidden);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  const observer = new MutationObserver(() => { if (!back.isConnected) close(); });
  deps.closeOnBackdrop(back, close);
  window.addEventListener('seyf:locking', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(back); observer.observe(document.body, { childList: true });
  openWindows.add(close);
  return { back, body, close, alive, deps, cleanup: fn => cleanups.push(fn) };
}

export function openGenerator({ onUse } = {}) {
  const m = modal('Генератор паролей');
  m.body.innerHTML = `<h3>Генератор паролей</h3>
    <label class="form-row"><span>Длина: <output class="pt-length-value">18</output></span><input class="pt-length" type="range" min="8" max="32" step="1" value="18"></label>
    <button type="button" class="picker-item pt-symbols" role="switch" aria-checked="false">Без спецсимволов: нет</button>
    <button type="button" class="picker-item pt-phrase" role="switch" aria-checked="false">Фраза из 6 слов: нет</button>
    <label class="form-row"><span>Новый пароль</span><textarea class="pt-result" rows="3" readonly autocomplete="off" spellcheck="false"></textarea></label>
    <p class="arc-note pt-hint"></p><p class="arc-err" role="alert"></p>
    <div class="modal-actions"><button type="button" class="cancel">Закрыть</button><button type="button" class="neutral pt-again">Другой</button><button type="button" class="save pt-use">Использовать</button></div>`;
  const q = s => m.body.querySelector(s), length = q('.pt-length'), symbols = q('.pt-symbols'), phrase = q('.pt-phrase'), result = q('.pt-result'), use = q('.pt-use');
  let noSymbols = false, passphrase = false;
  use.hidden = typeof onUse !== 'function';
  const regenerate = () => {
    if (!m.alive()) return m.close();
    q('.pt-length-value').textContent = length.value;
    length.disabled = passphrase; symbols.disabled = passphrase;
    symbols.setAttribute('aria-checked', String(noSymbols)); symbols.textContent = 'Без спецсимволов: ' + (noSymbols ? 'да' : 'нет');
    phrase.setAttribute('aria-checked', String(passphrase)); phrase.textContent = 'Фраза из 6 слов: ' + (passphrase ? 'да' : 'нет');
    q('.pt-hint').textContent = passphrase ? '6 слов выбраны случайно. Это пароль, не seed-фраза кошелька.' : 'Для важных аккаунтов выбирайте не менее 16 символов.';
    try { result.value = passphrase ? generateArchivePassword() : generatePassword({ length: Number(length.value), noSymbols }); use.disabled = false; q('.arc-err').textContent = ''; }
    catch { result.value = ''; use.disabled = true; q('.arc-err').textContent = 'Не удалось получить безопасные случайные данные.'; }
  };
  length.oninput = regenerate;
  symbols.onclick = () => { noSymbols = !noSymbols; regenerate(); };
  phrase.onclick = () => { passphrase = !passphrase; regenerate(); };
  q('.pt-again').onclick = regenerate; q('.cancel').onclick = m.close;
  m.cleanup(() => { onUse = null; });
  // Capture callback before close, whose cleanup clears the closure.
  use.onclick = () => { if (!m.alive()) return m.close(); const value = result.value, callback = onUse; if (!value) return; m.close(); callback?.(value); };
  regenerate(); length.focus();
  return { back: m.back, close: m.close };
}

export function openPasswordAudit({ vault = D?.state?.vault, onOpenEntry } = {}) {
  const m = modal('Проверка паролей');
  if (vault !== m.deps.state?.vault) { m.close(); return { back: m.back, close: m.close }; }
  const report = auditPasswords(vault);
  m.body.innerHTML = `<h3>Проверка паролей</h3><p class="confirm-msg pt-summary"></p>
    <p class="arc-note">Проверка только на устройстве. Пароли не отправляются в сеть. Длинные фразы тоже могут быть предсказуемыми; отсутствие замечаний не гарантирует надёжность.</p>
    <div class="picker-list"></div><div class="modal-actions"><button type="button" class="cancel">Закрыть</button></div>`;
  m.body.querySelector('.pt-summary').textContent = `Проверено: ${report.checked}. Требуют проверки: ${report.items.length}. Повторяются: ${report.duplicateCount}. Стойкость не оценена: ${report.unknownCount}.`;
  const list = m.body.querySelector('.picker-list');
  for (const item of report.items) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'picker-item';
    row.textContent = item.title + ' · ' + [item.weak && 'нужна проверка', item.duplicate && 'повторяется'].filter(Boolean).join(', ');
    row.disabled = typeof onOpenEntry !== 'function';
    row.onclick = () => { if (!m.alive()) return m.close(); const callback = onOpenEntry; m.close(); callback?.({ section: item.section, id: item.id }); };
    list.append(row);
  }
  if (!report.items.length) list.textContent = report.checked ? (report.unknownCount ? 'Явных признаков слабости и повторов не найдено. Стойкость фраз неизвестна: используйте случайные слова, а не цитаты и известные выражения.' : 'Замечаний не найдено.') : 'Нет сохранённых паролей для проверки.';
  m.body.querySelector('.cancel').onclick = m.close;
  m.cleanup(() => { onOpenEntry = null; vault = null; report.items.length = 0; });
  m.body.querySelector('.cancel').focus();
  return { back: m.back, close: m.close };
}
