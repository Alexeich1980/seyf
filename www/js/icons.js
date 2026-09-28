// icons.js — линейные SVG-иконки «Сейфа» (mobile-only, НЕ core). Адаптировано из
// Homyak/www/icons.js: тот же приём — каждая иконка это тело <path>/<rect>/<circle>
// в кадре 24×24, линия 1.8, обёртку <svg> накручивает svg(). Цвет наследуется
// (currentColor) — иконка красится темой через color. Финансовый набор Хомяка не тащим,
// берём только нужные «Сейфу» глифы. ESM — импортируется app.js и тестами (node).
export const ICON_PATHS = {
  // Сейф/хранилище — триггер меню (8e п.9). Из набора Хомяка (safe): дверца с ручкой.
  safe: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="10.3" cy="12" r="3.2"/><path d="m10.3 12 2.3-2.3"/><path d="M16.6 10.2h2.2M16.6 13.8h2.2"/>',
  // Глаз открыт / закрыт — РАЗНЫЕ (8e п.1).
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.5 5.9A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 3.9"/><path d="M6.4 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.15 2.7-.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  // Обновление — круговые стрелки (8e п.5, чинит «крест» ⭯).
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.3M4 5v3.5h3.5"/><path d="M4 13a8 8 0 0 0 14.3 4.3M20 19v-3.5h-3.5"/>',
  // Служебные глифы меню/шапки — единый линейный стиль.
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 2-1 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7.3-9-7.3z"/><circle cx="7.5" cy="12" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="14.5" cy="8" r="1"/><circle cx="17" cy="12" r="1"/>',
  archive: '<rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M4.5 8.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5"/><path d="M10 12h4"/>',
  key: '<circle cx="8" cy="8" r="4"/><path d="m10.8 10.8 8 8M16 15.5l2-2M18.5 18l1.8-1.8"/>',
  shield: '<path d="M12 3.2 20 6v6c0 4.5-3.3 7.6-8 8.8C7.3 19.6 4 16.5 4 12V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  star: '<path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4L12 16.2 7.2 18.8l1-5.4-4-3.7 5.4-.7z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.7" r="0.9" fill="currentColor" stroke="none"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10" rx="2.2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.4 2-2.4 3.6"/><circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4.5 4.5"/>',
  // Витрина/сетка разделов — «Разделы на витрине» в меню (18.3).
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
  // Назад — стрелка влево (шапка раздела, витрина 8f): возврат на витрину разделов.
  back: '<path d="M15 5 8 12l7 7M8 12h12"/>',
  // Изменить порядок — две стрелки вверх-вниз (кнопка режима порядка карточек, заслон 22).
  reorder: '<path d="M8 19V6"/><path d="M4.5 9.5 8 6l3.5 3.5"/><path d="M16 5v13"/><path d="M12.5 14.5 16 18l3.5-3.5"/>',
  fingerprint: '<path d="M12 4.5c-3.6 0-6.5 2.9-6.5 6.5v2.2"/><path d="M18.5 13.2V11a6.5 6.5 0 0 0-3.3-5.7"/><path d="M8.7 11a3.3 3.3 0 0 1 6.6 0c0 3 .3 5 1 6.6"/><path d="M12 11v2.5c0 2 .4 4 1.3 5.7"/><path d="M8.7 13.5c0 2.2.5 4.3 1.6 6.1"/><path d="M5.6 16.5c.5 1 .8 2 .9 3"/>',
  // Сайт/почта — для строки контактов в «О приложении» (заход 2 п.10, как у «Хомяка»).
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.6 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.2"/><path d="m4 7 8 6 8-6"/>',
  // Документ (1.3.1): ссылка на пользовательское соглашение в «О приложении» (лист с загнутым углом и строками).
  doc: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 12.5h6M9 16h6"/>',
  // Свотч темы (v4): луна = тёмная тема, солнце = светлая. По образцу «Хомяка» (mThemeSwatch).
  moon: '<path d="M20 14.4A8 8 0 0 1 9.6 4 8 8 0 1 0 20 14.4z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6"/>',
};

// Тело <svg> с наследуемым цветом. size по умолчанию 22 (шапка/меню «Сейфа»).
export function icon(name, size = 22) {
  const body = ICON_PATHS[name] || '';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}
export function hasIcon(name) { return Object.prototype.hasOwnProperty.call(ICON_PATHS, name); }

// Имя иконки «глаза» по состоянию показа секретов (8f A.3, ратчет — на этом баге тест).
// Пароль ВИДЕН (revealed=true) → открытый глаз «eye»; скрыт → зачёркнутый «eyeOff».
// Чистая функция, чтобы соответствие состояния проверялось тестом, а не «на глаз».
export function eyeIconName(revealed) { return revealed ? 'eye' : 'eyeOff'; }

// Порог закрывающего свайпа (перенос рабочего Хомяка, 8f A.4). Жест влево засчитывается,
// только если он честно горизонтальный (длиннее вертикали в SWIPE_RATIO раз) и не короче
// SWIPE_SIDE — иначе вертикальная прокрутка тела меню ложно закрывала бы drawer. Чистая —
// на ней тест swipe.test.mjs; сам жест проверяется в браузере.
export const SWIPE_SIDE = 60;
export const SWIPE_RATIO = 1.5;
export function swipeCloses(dx, dy, dir) {
  dx = Number(dx) || 0; dy = Number(dy) || 0;
  if (dir === 'left') return dx <= -SWIPE_SIDE && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO;
  if (dir === 'down') return dy >= 80 && Math.abs(dy) > Math.abs(dx);
  return false;
}
