// CSS contract: row .loyalty-swipe (position:relative; overflow:hidden),
// front .loyalty-swipe__front (position:relative; z-index:1; touch-action:pan-y;
// transform:translateX(var(--loyalty-swipe-x, 0px))). Actions are absolute,
// 72px wide: --delete left:0, --edit right:0. Disable transitions while
// .is-swiping; .is-swipe-open marks a settled action. Respect [hidden].
// Owner must destroy before removing/replacing rows; close all on navigation.
const WIDTH = 72;
const controllers = new Set();
const attached = new WeakMap();
const hubs = new WeakMap();

export function closeLoyaltySwipes() {
  for (const controller of controllers) controller.close();
}

// One shared listener set per document, removed when its final row is destroyed.
function acquireHub(doc, controller) {
  let hub = hubs.get(doc);
  if (!hub) {
    const members = new Set(), pointers = new Set(), cleanups = [];
    const listen = (target, type, fn) => {
      target.addEventListener(type, fn, true);
      cleanups.push(() => target.removeEventListener(type, fn, true));
    };
    const close = () => { for (const member of members) member.close(); };
    listen(doc, 'pointerdown', e => { pointers.add(e.pointerId); if (pointers.size > 1) close(); });
    const end = e => pointers.delete(e.pointerId);
    listen(doc, 'pointerup', end);
    listen(doc, 'pointercancel', end);
    const reset = () => { close(); pointers.clear(); };
    listen(doc.defaultView, 'blur', e => { if (e.target === doc.defaultView) reset(); });
    listen(doc.defaultView, 'seyf:locking', reset);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) reset(); });
    hub = { members, pointers, cleanups };
    hubs.set(doc, hub);
  }
  hub.members.add(controller);
  return hub;
}

export function attachLoyaltySwipe(row, open, { onEdit, onDelete, isActive = () => true } = {}) {
  attached.get(row)?.destroy();
  if (open.parentElement !== row) throw new TypeError('Swipe front must be a direct child of row');
  const doc = row.ownerDocument;
  let disposed = false, gesture = null, offset = 0, suppressed = false;
  const listeners = [];
  const originalX = row.style.getPropertyValue('--loyalty-swipe-x');
  const hadRowClass = row.classList.contains('loyalty-swipe');
  const hadFrontClass = open.classList.contains('loyalty-swipe__front');
  const enabled = () => !disposed && row.isConnected && isActive();
  const button = (kind, label, d) => {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = `loyalty-swipe__action loyalty-swipe__action--${kind}`;
    b.setAttribute('aria-label', label); b.title = label;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); b.append(svg);
    row.insertBefore(b, open); return b;
  };
  const trash = button('delete', 'Удалить карту', 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7');
  const edit = button('edit', 'Изменить карту', 'M14 5l5 5M4 16l12-12a2.1 2.1 0 0 1 3 3L7 19l-4 1z');
  row.classList.add('loyalty-swipe'); open.classList.add('loyalty-swipe__front');
  function render(x, settled = false) {
    if ((x > 0 && typeof onDelete !== 'function') || (x < 0 && typeof onEdit !== 'function')) x = 0;
    offset = x; row.style.setProperty('--loyalty-swipe-x', `${x}px`);
    row.classList.toggle('is-swipe-open', settled && x !== 0);
    for (const [b, visible] of [[trash, settled && x === WIDTH], [edit, settled && x === -WIDTH]]) {
      if (!visible && doc.activeElement === b) b.blur();
      b.hidden = !visible; b.inert = !visible; b.disabled = !visible; b.tabIndex = visible ? 0 : -1;
      b.setAttribute('aria-hidden', String(!visible));
    }
  }
  function release() {
    const previous = gesture; gesture = null;
    row.classList.remove('is-swiping');
    if (previous?.axis === 'x' && open.hasPointerCapture(previous.id)) open.releasePointerCapture(previous.id);
  }
  function close() {
    if (gesture) suppressed = true;
    release(); render(0);
  }
  function destroy() {
    if (disposed) return;
    close(); disposed = true;
    for (const cleanup of listeners) cleanup();
    trash.remove(); edit.remove();
    if (!hadRowClass) row.classList.remove('loyalty-swipe');
    if (!hadFrontClass) open.classList.remove('loyalty-swipe__front');
    if (originalX) row.style.setProperty('--loyalty-swipe-x', originalX); else row.style.removeProperty('--loyalty-swipe-x');
    controllers.delete(api); attached.delete(row); hub.members.delete(api);
    if (!hub.members.size) { for (const cleanup of hub.cleanups) cleanup(); hubs.delete(doc); }
  }
  const api = { close, destroy };
  const hub = acquireHub(doc, api);
  controllers.add(api); attached.set(row, api);
  const listen = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  };
  listen(row, 'pointerdown', e => {
    if (!enabled() || hub.pointers.size > 1 || e.isPrimary === false) { suppressed = true; close(); return; }
    if (e.button !== 0) return;
    suppressed = false; // a new physical tap must work, even immediately after dragging
    if (!open.contains(e.target)) return;
    for (const other of controllers) if (other !== api) other.close();
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, start: offset, axis: null };
  });
  listen(open, 'pointermove', e => {
    if (!gesture || gesture.id !== e.pointerId) return;
    if (!enabled() || hub.pointers.size > 1) { close(); return; }
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    if (!gesture.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      suppressed = true;
      if (Math.abs(dx) > 1.3 * Math.abs(dy)) {
        gesture.axis = 'x'; open.setPointerCapture(e.pointerId); row.classList.add('is-swiping');
      } else { gesture.axis = 'y'; render(0); }
    }
    if (gesture.axis !== 'x') return;
    e.preventDefault(); render(Math.max(-WIDTH, Math.min(WIDTH, gesture.start + dx)));
  }, { passive: false });
  listen(open, 'pointerup', e => {
    if (!gesture || gesture.id !== e.pointerId) return;
    const axis = gesture.axis;
    if (!enabled()) { close(); return; }
    release();
    if (axis === 'x') render(Math.abs(offset) >= WIDTH / 2 ? Math.sign(offset) * WIDTH : 0, true);
    else if (axis === 'y') render(0);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) listen(open, type, e => {
    // Taking capture from a touched child emits a bubbling loss on that child.
    // Only loss of our own capture ends this gesture.
    if (type === 'lostpointercapture' && e.target !== open) return;
    if (gesture?.id === e.pointerId) close();
  });
  listen(row, 'click', e => {
    if (!enabled() || (suppressed && e.detail !== 0)) { e.preventDefault(); e.stopImmediatePropagation(); if (!enabled()) close(); }
  }, true);
  listen(row, 'keydown', e => { if (e.key === 'Escape') close(); });
  for (const [b, direction, callback] of [[trash, WIDTH, onDelete], [edit, -WIDTH, onEdit]]) listen(b, 'click', e => {
    e.preventDefault(); e.stopPropagation();
    if (!enabled() || gesture || offset !== direction || b.hidden || b.disabled) return;
    close(); callback?.(); // deletion remains entirely in the owner's confirmation/trash pipeline
  });
  render(0);
  return api;
}
