export const SECTION_LABELS = {
  passwords: 'Пароли', cards: 'Карты', wallets: 'Электронные кошельки', seed: 'Seed-фразы',
  documents: 'Документы', notes: 'Заметки', totp: 'Коды 2FA',
};

// type: text | link | copy | secret | date | textarea ; gen: true → кнопка генератора
export const FIELD_SCHEMA = {
  passwords: [
    { key: 'description', label: 'Описание', type: 'text' },
    { key: 'url', label: 'Ссылка', type: 'link' },
    { key: 'login', label: 'Логин', type: 'copy' },
    { key: 'password', label: 'Пароль', type: 'secret', gen: true },
    { key: 'passwordChanged', label: 'Пароль изменён', type: 'date', readonly: true },
  ],
  // Форма карты (спека 8b п.6): минимум полей. Срок — ОДНО поле ММ/ГГ (expiry) вместо
  // раздельных месяц/год. Дефолтного «Описание» нет — произвольное поле добавляется кнопкой.
  // Порядок в редакторе: expiry/cvv/pin app.js выкладывает одной компактной строкой.
  cards: [
    { key: 'bank', label: 'Банк', type: 'text' },
    { key: 'number', label: 'Номер карты', type: 'copy' },
    { key: 'holder', label: 'Имя и фамилия', type: 'copy' },
    { key: 'expiry', label: 'Срок (ММ/ГГ)', type: 'text' },
    { key: 'cvv', label: 'CVV', type: 'secret' },
    { key: 'pin', label: 'ПИН', type: 'secret' },
  ],
  wallets: [
    { key: 'description', label: 'Описание', type: 'text' },
    { key: 'url', label: 'Ссылка', type: 'link' },
    { key: 'number', label: 'Номер', type: 'copy' },
    { key: 'password', label: 'Пароль', type: 'secret', gen: true },
  ],
  seed: [
    { key: 'name', label: 'Название кошелька', type: 'text' },
    { key: 'phrase', label: 'Seed-фраза', type: 'secret' },
    { key: 'network', label: 'Сеть / тип', type: 'text' },
    { key: 'passphrase', label: 'Кодовое слово (25-е слово, если задано)', type: 'secret' },
    { key: 'note', label: 'Заметка', type: 'textarea' },
  ],
  documents: [
    { key: 'description', label: 'Описание', type: 'text' },
    { key: 'number', label: 'Номер', type: 'copy' },
    { key: 'issueDate', label: 'Дата выдачи', type: 'date' },
    { key: 'comments', label: 'Комментарии', type: 'textarea' },
  ],
  notes: [
    { key: 'title', label: 'Название', type: 'text' },
    { key: 'text', label: 'Текст', type: 'textarea' },
  ],
  // Коды 2FA: карточка раздела рисуется отдельно (живой код + обратный отсчёт), схема нужна
  // редактору и поиску. digits/period/algorithm — служебные, хранятся в записи вне схемы.
  totp: [
    { key: 'name', label: 'Название сервиса', type: 'text' },
    { key: 'secret', label: 'Секретный ключ', type: 'secret' },
  ],
};

function titleFor(section, entry) {
  const first = FIELD_SCHEMA[section][0].key;
  return entry[first] || '(без названия)';
}

import { estimateStrength } from './generator.js';

// Безопасный http(s)-адрес для кнопки «Открыть» (спека 8b п.8). Уже http(s) — как есть;
// голый домен — дописываем https://; ЛЮБАЯ иная схема (javascript:, data:, file: …) —
// null: в системный браузер такое не пускаем. Так режется javascript:-инъекция.
export function safeHttpUrl(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return 'https://' + s;
}
function isStale(val) {
  const d = new Date(val); if (isNaN(d)) return false;
  const s = new Date(); s.setMonth(s.getMonth() - 6); return d < s;
}
const strengthBucket = (score) => (score <= 1 ? 'weak' : score === 2 ? 'mid' : 'strong');

// handlers: { onEdit, onDelete, onToggleFav, onCopy }
export function renderEntryCard(section, entry, handlers) {
  const el = document.createElement('div');
  el.className = 'entry';
  el.draggable = true;
  el.dataset.id = entry.id;

  const schema = FIELD_SCHEMA[section];
  const titleKey = schema[0].key;                       // первое поле = заголовок карточки

  const head = document.createElement('div');
  head.className = 'entry-head';
  const pwChanged = section === 'passwords' ? entry.passwordChanged : '';
  head.innerHTML = `
    <span class="grip" title="Перетащить">⠿</span>
    <span class="entry-title">${escapeHtml(titleFor(section, entry))}</span>
    <div class="entry-actions">
      <div class="action-icons">
        <button class="ic fav ${entry.favorite ? 'on' : ''}" title="Избранное">★</button>
        <button class="ic edit" title="Править">✎</button>
        <button class="ic del" title="Удалить">🗑</button>
      </div>
      ${pwChanged ? `<span class="pw-date ${isStale(pwChanged) ? 'stale' : ''}" title="Дата последнего изменения пароля">изм. ${formatDate(pwChanged)}</span>` : ''}
    </div>`;
  head.querySelector('.fav').onclick = () => handlers.onToggleFav(section, entry);
  head.querySelector('.edit').onclick = () => handlers.onEdit(section, entry);
  head.querySelector('.del').onclick = () => handlers.onDelete(section, entry);
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'entry-body';
  let dateNote = null;
  for (const f of schema) {
    if (f.key === titleKey || f.key === 'passwordChanged') continue; // заголовок и дата пароля — вне тела
    const val = entry[f.key];
    if (val == null || val === '') continue;
    if (f.type === 'date') { dateNote = { key: f.key, val }; continue; }
    const row = renderField(f, val, handlers, { sec: section, id: entry.id, fk: f.key });
    if (f.gen && val) row.querySelector('.f-label')?.classList.add('str-' + strengthBucket(estimateStrength(val).score));
    body.appendChild(row);
  }
  (entry.customFields || []).forEach((cf, ci) => {
    if (!cf.value) return;
    body.appendChild(renderField({ label: cf.name || 'Поле', type: cf.secret ? 'secret' : 'copy' }, cf.value, handlers, { sec: section, id: entry.id, fk: 'cf:' + ci }));
  });
  if (dateNote) {
    const s = document.createElement('span');
    s.className = 'changed';
    const prefix = dateNote.key === 'passwordChanged' ? 'изменён' : dateNote.key === 'issueDate' ? 'выдан' : '';
    s.textContent = (prefix ? prefix + ' ' : '') + formatDate(dateNote.val);
    body.appendChild(s);
  }
  el.appendChild(body);
  return el;
}

// loc = { sec, id, fk } — координаты значения в state.vault; для секрета кладём в DOM
// только их (не сам секрет), чтобы plaintext не жил в data-атрибуте (findings М-2).
// Раскрытие берёт значение из state.vault по этим координатам (как для карточек TOTP).
function renderField(f, val, handlers, loc = {}) {
  const row = document.createElement('div');
  row.className = 'field';
  const label = `<span class="f-label">${escapeHtml(f.label)}</span>`;
  // Обычное копирование (без авто-очистки буфера) — для несекретных полей (спека 8b п.7).
  // Секреты (пароль/CVV/ПИН/seed/TOTP) идут через onCopy (clipboard.js, авто-очистка).
  // Фолбэки: десктопный app.js может ещё не отдавать onCopyPlain/onOpenLink — не падаем.
  const copyPlain = (v) => (handlers.onCopyPlain || handlers.onCopy || (() => {}))(v);
  const openLink = (u) => (handlers.onOpenLink || ((x) => { try { window.open(x, '_blank', 'noopener'); } catch (e) {} }))(u);
  if (f.type === 'link') {
    const safe = safeHttpUrl(val);
    row.innerHTML = `${label}<span class="f-val f-link">${escapeHtml(val)}</span>`
      + (safe ? `<button class="ic open" title="Открыть в браузере">Открыть</button>` : '')
      + `<button class="ic copy" title="Копировать">⧉</button>`;
    if (safe) row.querySelector('.open').onclick = () => openLink(safe);
    row.querySelector('.copy').onclick = () => copyPlain(val);
  } else if (f.type === 'secret') {
    // Per-field «глаз» убран (8d п.13): раскрытие идёт глобальной кнопкой в шапке
    // (applySecrets) и в детальном просмотре. В списке-плашке отдельного глаза нет.
    row.innerHTML = `${label}<span class="f-val secret" data-sec="${escapeAttr(loc.sec || '')}" data-id="${escapeAttr(loc.id || '')}" data-fk="${escapeAttr(loc.fk || '')}">••••••••</span>
      <button class="ic copy" title="Копировать">⧉</button>`;
    row.querySelector('.copy').onclick = () => handlers.onCopy(val);
  } else if (f.type === 'textarea') {
    row.classList.add('field-block');
    row.innerHTML = `${label}<span class="f-val pre">${escapeHtml(val)}</span><button class="ic copy" title="Копировать">⧉</button>`;
    row.querySelector('.copy').onclick = () => copyPlain(val);
  } else if (f.type === 'date') {
    row.innerHTML = `${label}<span class="f-val">${escapeHtml(formatDate(val))}</span><button class="ic copy" title="Копировать">⧉</button>`;
    row.querySelector('.copy').onclick = () => copyPlain(formatDate(val));
  } else { // text | copy — обычное значение с кнопкой копирования
    row.innerHTML = `${label}<span class="f-val">${escapeHtml(val)}</span><button class="ic copy" title="Копировать">⧉</button>`;
    row.querySelector('.copy').onclick = () => copyPlain(val);
  }
  return row;
}

function formatDate(v) {
  const d = new Date(v);
  return isNaN(d) ? v : d.toLocaleDateString('ru-RU');
}
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
