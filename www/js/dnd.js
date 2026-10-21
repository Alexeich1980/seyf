// Маленький хелпер перетаскивания списка .entry. Возвращает (from, to) индексы.
export function enableDnd(container, onReorder) {
  let dragEl = null;
  // индекс на старте
  [...container.querySelectorAll('.entry')].forEach((el, i) => (el.dataset.fromIndex = i));

  container.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.entry'); if (!el) return;
    dragEl = el; el.classList.add('dragging');
  });
  container.addEventListener('dragend', async () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    const els = [...container.querySelectorAll('.entry')];
    const to = els.indexOf(dragEl);
    const from = Number(dragEl.dataset.fromIndex);
    dragEl = null;
    if (!Number.isNaN(from) && from !== to) await onReorder(from, to);
  });
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragEl) return;
    const after = getAfter(container, e.clientY);
    if (after == null) container.appendChild(dragEl);
    else container.insertBefore(dragEl, after);
  });

  function getAfter(cont, y) {
    const els = [...cont.querySelectorAll('.entry:not(.dragging)')];
    return els.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: -Infinity, element: null }).element;
  }
}
