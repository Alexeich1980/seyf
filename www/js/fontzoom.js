// fontzoom.js - крупный системный шрифт (1.3.3, образец «Карта года» detectFontZoom). НЕ core.
// До 1.3.3 масштаб текста был запрещён (setTextZoom(100)). Теперь WebView увеличивает текст вслед за
// настройкой телефона (FontScalePlugin.java, 100-200%), а здесь на <html> ставится data-fz:
//   'l'  - от 115% (130%: раскладка та же, всё помещается - замер qa-133 font);
//   'xl' - от 160% (200%: на узком экране витрина и меню в один столбец, см. app.css «крупный шрифт»).
// Масштаб: на телефоне - от системы (плагин FontScale: get() и событие "change"), в браузере - щуп
// #fzProbe (буква 100px, интерлиньяж 1: её высота / 100 = множитель шрифта).

export function fzLevel(k) {
  k = Number(k) || 1;
  return k >= 1.6 ? 'xl' : (k >= 1.15 ? 'l' : '');
}

// Системный fontScale, если он есть и разумный; иначе показание щупа; иначе 1.
export function fzScaleFrom(nativeScale, probeK) {
  const n = Number(nativeScale);
  if (nativeScale != null && isFinite(n) && n > 0) return n;
  const k = Number(probeK);
  return (isFinite(k) && k > 0) ? k : 1;
}

// Подключение к странице: doc - document, win - window, plugin - NativePlugins.FontScale или null.
export function initFontZoom(doc, win, plugin) {
  let native = null;
  const detect = () => {
    let probe = 1;
    if (native == null) { const p = doc.getElementById('fzProbe'); if (p) probe = p.getBoundingClientRect().height / 100; }
    const lv = fzLevel(fzScaleFrom(native, probe));
    const root = doc.documentElement;
    if (lv) root.setAttribute('data-fz', lv); else root.removeAttribute('data-fz');
    return lv;
  };
  const fromNative = (r) => { const n = Number(r && r.fontScale); if (isFinite(n) && n > 0) { native = n; detect(); } };
  detect();
  try { win.addEventListener('resize', detect); } catch (e) {}
  try {
    if (plugin && typeof plugin.get === 'function') {
      const p = plugin.get(); if (p && p.then) p.then(fromNative, () => {});
      if (typeof plugin.addListener === 'function') plugin.addListener('change', fromNative);
    }
  } catch (e) {}
  return detect;
}
