// listorder.js — порядок показа записей раздела (mobile-only, НЕ core: store.js остаётся
// байт-в-байт с десктопом). Правило v1.0 (8f, развилка «ручной порядок главный»):
//   1) ручной порядок = порядок массива vault.sections[section] (его двигает перетаскивание);
//   2) избранные ЗАКРЕПЛЕНЫ сверху (в пределах группы держим ручной порядок);
//   3) новая запись появляется первой — app.js кладёт её в начало массива при создании.
// Чистые функции — на них тест listorder.test.mjs. Вход не мутируется (копия массива).

// Показ = избранные (в ручном порядке) сверху, затем остальные (в ручном порядке).
// Стабильная сортировка сохраняет исходные индексы внутри каждой группы.
export function displayOrder(entries) {
  const arr = (entries || []).map((e, i) => ({ e, i }));
  arr.sort((a, b) => {
    const fa = a.e.favorite ? 1 : 0, fb = b.e.favorite ? 1 : 0;
    if (fa !== fb) return fb - fa;   // избранные выше
    return a.i - b.i;                // внутри группы — ручной (исходный) порядок
  });
  return arr.map((x) => x.e);
}

// Переместить элемент массива id из позиции from в позицию to. Возвращает НОВЫЙ массив
// (вход не мутируем). Основа стрелок ↑/↓ (п.13): тап меняет порядок детерминированно, без
// перетаскивания. Индексы вне диапазона отдают копию входа без изменений (заслон от битого DOM).
export function moveInOrder(ids, from, to) {
  const arr = [...(ids || [])];
  const n = arr.length;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return arr;
  if (from < 0 || from >= n || to < 0 || to >= n) return arr;
  const [it] = arr.splice(from, 1);
  arr.splice(to, 0, it);
  return arr;
}

// Переупорядочить массив записей под порядок id из DOM после перетаскивания. Записи в
// порядке ids идут первыми; не попавшие в ids (теоретически) держат хвост стабильно.
// Возвращает НОВЫЙ массив (вход не мутируем) — вызывающий присваивает его секции.
export function orderByIds(entries, ids) {
  const pos = new Map((ids || []).map((id, i) => [id, i]));
  const arr = (entries || []).map((e, i) => ({ e, i }));
  arr.sort((a, b) => {
    const pa = pos.has(a.e.id) ? pos.get(a.e.id) : Infinity;
    const pb = pos.has(b.e.id) ? pos.get(b.e.id) : Infinity;
    if (pa !== pb) return pa - pb;
    return a.i - b.i;               // хвост без id — стабильно
  });
  return arr.map((x) => x.e);
}

// Стрелки ↑/↓ в режиме порядка (1.2.23, A7). Двигаем запись ТОЛЬКО внутри её группы показа
// (избранные / обычные): избранные закреплены сверху, поэтому ↑ у первой обычной записи
// (или ↓ у последней избранной) ничего не может сделать - такая кнопка неактивна. Считаем по
// id и по ТЕКУЩЕМУ массиву в момент тапа (а не по снимку индексов с прошлой отрисовки: быстрые
// тапы до перерисовки двигали не ту запись).
export function arrowState(entries, id) {
  const disp = displayOrder(entries);
  const i = disp.findIndex((e) => e && e.id === id);
  if (i < 0) return { up: false, down: false };
  const fav = !!disp[i].favorite;
  const up = i > 0 && !!disp[i - 1].favorite === fav;
  const down = i < disp.length - 1 && !!disp[i + 1].favorite === fav;
  return { up, down };
}

// Сдвиг записи id на одну позицию (dir = -1 вверх, +1 вниз) внутри группы. Возвращает
// { moved, entries } - entries НОВЫЙ массив (вход не мутируем); moved=false - двигать некуда.
export function moveWithinGroup(entries, id, dir) {
  const st = arrowState(entries, id);
  if (!(dir < 0 ? st.up : st.down)) return { moved: false, entries: [...(entries || [])] };
  const ids = displayOrder(entries).map((e) => e.id);
  const i = ids.indexOf(id);
  return { moved: true, entries: orderByIds(entries, moveInOrder(ids, i, i + (dir < 0 ? -1 : 1))) };
}
