// reveal.js — гарантированное появление списка карточек (ревью-20 п.3, робастность).
// Stagger-анимация прячет карточки (CSS: #cards .entry{opacity:0}) и показывает их, когда
// на контейнере #cards появляется класс .in. Класс ставится в requestAnimationFrame после
// вставки списка. ЗАСЛОН: если rAF подвиснет (throttle в фоне, свёрнутое окно, редкий баг
// движка) — карточки останутся невидимыми навсегда. Поэтому дублируем установку .in
// setTimeout-фолбэком: что сработает раньше, то и покажет список. Обе ветки идемпотентны.
//
// prefers-reduced-motion не ломаем: CSS для этого режима форсит #cards .entry{opacity:1}
// независимо от .in — эта функция лишь добавляет класс и на «уменьшить движение» безвредна.
//
// Логика вынесена в чистые функции (без прямых глобалей — raf/setTimeout инъектируются),
// чтобы «фолбэк помечает видимым» проверялось тестом в node без DOM.

// Через сколько мс страховка ставит .in, если rAF так и не пришёл.
export const REVEAL_FALLBACK_MS = 500;

// Помечает контейнер видимым (ставит .in). Идемпотентно: true — только если класс реально
// добавлен впервые (для теста и чтобы не дёргать layout повторно). Пустой/битый узел — no-op.
export function markRevealed(cont) {
  if (!cont || !cont.classList || typeof cont.classList.add !== 'function') return false;
  if (typeof cont.classList.contains === 'function' && cont.classList.contains('in')) return false;
  cont.classList.add('in');
  return true;
}

// Планирует появление списка: rAF (нормальный старт stagger) + setTimeout-страховка.
// raf/setTimeout/ms инъектируются в тестах; по умолчанию — глобальные функции среды.
export function scheduleReveal(cont, opts = {}) {
  const raf = opts.raf
    || (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0));
  const setT = opts.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null);
  const ms = opts.ms != null ? opts.ms : REVEAL_FALLBACK_MS;
  raf(() => markRevealed(cont));
  if (setT) setT(() => markRevealed(cont), ms);
  return cont;
}
