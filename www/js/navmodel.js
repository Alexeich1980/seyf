// navmodel.js — чистая логика навигации витрина↔раздел и системной кнопки «Назад» (8f,
// mobile-only, НЕ core). Вынесено из app.js, чтобы порядок закрытия слоёв и счётчики плиток
// проверялись тестом, а не «на глаз» (ратчет error-handling-protocol).

// Что делает системная «Назад» при заданном состоянии. Порядок закрытия слоёв важен:
// модалка → меню → раздел(на витрину) → демо-создание пароля(в демо) → выход.
export function backAction({ hasModal, menuOpen, view, demoMasterVisible }) {
  if (hasModal) return 'closeModal';
  if (menuOpen) return 'closeMenu';
  if (view === 'section') return 'toGrid';
  if (demoMasterVisible) return 'toDemo';
  return 'exit';
}

// Что перерисовать после мутации (add/edit/delete/fav), чтобы (а) счётчики плиток витрины
// были свежими и (б) контекст глобального поиска не сбрасывался в полный список раздела.
//   grid без поиска -> перерисовать сетку плиток (счётчики), список не трогаем;
//   grid с поиском  -> обновить и сетку (для возврата), и результаты поиска по запросу;
//   section         -> перерисовать список раздела с текущим запросом (в разделе он пуст).
// Чистая логика (без DOM) - проверяется тестом (ратчет: раньше saveEntry звал голый
// renderList() и «правка из поиска» подменяла результаты полным списком).
export function refreshPlan(view, query) {
  const q = String(query == null ? '' : query).trim();
  if (view === 'grid') return { grid: true, list: q ? q : null };
  return { grid: false, list: q };
}

// Счётчики записей по разделам для плиток витрины. Пустой/битый vault → нули (не падаем).
export function sectionCounts(vault, sections) {
  const out = {};
  for (const s of sections) {
    const arr = vault && vault.sections && vault.sections[s];
    out[s] = Array.isArray(arr) ? arr.length : 0;
  }
  return out;
}
