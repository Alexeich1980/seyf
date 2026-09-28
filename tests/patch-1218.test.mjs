// patch-1218.test.mjs — исходные заслоны (ratchet) на правки батча 1.2.18, которые живут в
// DOM-слое (app.js/app.css) и не выносятся в чистую функцию. Сканируем текст: содержательная
// регрессия (кто-то вернёт background-attachment:fixed, уберёт try/catch вокруг saveFile,
// потеряет стрелки порядка) сразу краснеет. Живое поведение проверено скриншотами в браузере.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, '..', 'www', 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(HERE, '..', 'www', 'css', 'app.css'), 'utf8');
const norm = (s) => s.replace(/\r\n/g, '\n');

// --- п.1: редактор ВСЕГДА закрывается после сохранения, запись обёрнута try/catch ---
// 1.2.20: модель ужесточена - закрытие ДО записи (не после await saveFile в try/catch: тот вариант
// не спасал от ПОДВИСШЕЙ записи). Поведение на подвисшем моке - tests/persist.test.mjs.
test('п.1: редактор закрывается ВСЕГДА и ДО записи (dirty=false + cleanup() + refresh в close)', () => {
  const a = norm(APP);
  assert.ok(/close: \(\) => \{\s*dirty = false;\s*cleanup\(\);\s*try \{ refreshAfterMutation\(\); \}/.test(a),
    'close() в saveEntry обязан делать dirty=false + cleanup() + refreshAfterMutation()');
  assert.ok(/persist: saveFile,/.test(a), 'запись на устройство - после закрытия (persist: saveFile)');
});

// --- п.2: стрелки порядка ↑/↓ ---
test('п.2: есть стрелки порядка (addReorderArrows) и общий persistAfterRender (A7 1.2.23)', () => {
  assert.ok(/function addReorderArrows\(/.test(APP), 'нет addReorderArrows');
  assert.ok(/function persistAfterRender\(/.test(APP), 'нет persistAfterRender (перерисовка сразу, запись после)');
  assert.ok(/addReorderArrows\(card, current, entry\)/.test(APP), 'стрелки не навешиваются в списке');
  assert.ok(/reorder-up/.test(APP) && /reorder-down/.test(APP), 'нет кнопок ↑/↓');
});
test('п.2: стрелки видны/кликаются в режиме порядка и НЕ гасятся общим mute', () => {
  assert.ok(/button:not\(\.reorder-move button\)/.test(CSS),
    'mute контролов карточки должен исключать .reorder-move (иначе стрелки не нажать)');
  assert.ok(/body\.reorder-mode #cards \.entry \.reorder-move/.test(CSS), 'нет показа стрелок в reorder-mode');
});

// --- п.3: бейдж срока ---
test('п.3: бейдж срока рисуется (decorateExpiryBadge) для карт и документов', () => {
  assert.ok(/function decorateExpiryBadge\(/.test(APP), 'нет decorateExpiryBadge');
  assert.ok(/decorateExpiryBadge\(card, current, entry\)/.test(APP), 'бейдж не вызывается в списке раздела');
  assert.ok(/decorateExpiryBadge\(card, section, entry\)/.test(APP), 'бейдж не вызывается в поиске');
  assert.ok(/\.exp-badge\.soon/.test(CSS) && /\.exp-badge\.expired/.test(CSS), 'нет стилей бейджа');
});

// --- п.4: список снова прокручивается (нет background-attachment:fixed на body) ---
test('п.4 (ratchet): body БЕЗ background-attachment:fixed, фон-градиент на html', () => {
  assert.ok(!/background-attachment:\s*fixed/.test(CSS),
    'background-attachment:fixed убивает прокрутку в Android-WebView - его быть не должно');
  assert.ok(/html\s*\{[^}]*overflow-x:\s*clip[^}]*background:\s*var\(--app-bg\)/.test(CSS),
    'фон-градиент должен нести html (корневой canvas), overflow-x:clip сохранён');
});

// --- п.9: компактная ссылка контакта ---
test('п.9: компактный лейбл ссылки + скрытие длинного URL в свёрнутой карточке', () => {
  assert.ok(/golink-label/.test(APP) && /golink-label/.test(CSS), 'нет короткого лейбла ссылки');
  assert.ok(/contact-link-collapsed/.test(APP) && /contact-link-collapsed/.test(CSS),
    'длинный URL/копирование должны скрываться до разворота');
});

// --- п.10: e-mail «Написать» ---
test('п.10: у контакта действие «Написать» (mailtoHref) на поле E-mail', () => {
  assert.ok(/mailtoHref\(entry\.email\)/.test(APP), 'нет mailto для e-mail контакта');
  assert.ok(/'Написать'/.test(APP), 'нет действия «Написать»');
});

// --- п.11: окно резервной копии ---
test('п.11: окно «Резервная копия» - две карточки-действия + крестик', () => {
  assert.ok(/function openBackupDialog\(/.test(APP), 'нет openBackupDialog');
  assert.ok(/backup-save/.test(APP) && /backup-restore/.test(APP), 'нет двух карточек-действий');
  assert.ok(/\.backup-card/.test(CSS), 'нет стилей карточек бэкапа');
});
