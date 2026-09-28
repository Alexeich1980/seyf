// css-overlay-guard.mjs - машинный заслон класса «невидимый fixed-элемент съедает тапы» (1.2.24 0a:
// спрятанный toast opacity 0 лежал поверх «Сохранить»). 1.2.25 (ревью 1.2.24, п.9): проверка по
// ЭЛЕМЕНТУ, а не по одному блоку CSS. Элемент с position: fixed «бывает прозрачным», если в ЛЮБОМ
// его правиле (сам селектор или его состояние: «#x.hide», «.x:not(.show)») есть:
//   - opacity: 0;
//   - visibility: hidden (переход visibility с задержкой оставляет его кликабельным на время фейда);
//   - animation / animation-name с @keyframes, у которых конечное состояние opacity: 0
//     (для reverse/alternate - и начальное).
// Такой элемент обязан иметь pointer-events: none (в базовом правиле или в правиле-состоянии).
// 1.3.0 (ревью 1.2.25, L4, пруф guard-bypass.mjs) - закрыты обходы:
//   - скрытие ПО КОНТЕКСТУ («body.locked .t { opacity: 0 }»): элемент определяем по ПОСЛЕДНЕМУ
//     составному селектору (простые части базы входят в него, псевдоэлемент совпадает);
//   - отдельный класс-состояние («.t-hidden», «.fab--gone», утилиты «.hidden», «.is-hidden»);
//   - pointer-events: auto в скрытом состоянии (none базы его не спасает) и правило, включающее
//     касания у скрытой в базе плашки, но не возвращающее ей видимость;
//   - регистр: свойства и значения CSS регистронезависимы («OPACITY: 0», «POSITION: FIXED»).
// Запуск: node tools/css-overlay-guard.mjs [файл.css] - exit 1 при нарушении. Тест: tests/fixes-1225.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return s.length - 1;
}

// { rules: [{ sels: [..], body }], keyframes: { name: [{ at: [0..100], body }] } }
export function parseCss(css) {
  const out = { rules: [], keyframes: {} };
  const walk = (s) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const prelude = s.slice(i, open).trim();
      const close = matchBrace(s, open);
      const inner = s.slice(open + 1, close);
      const kf = prelude.match(/^@(?:-webkit-)?keyframes\s+([\w-]+)/);
      if (kf) {
        const steps = [];
        let j = 0;
        while (j < inner.length) {
          const o = inner.indexOf('{', j); if (o < 0) break;
          const c = inner.indexOf('}', o);
          const at = inner.slice(j, o).split(',').map((x) => x.trim()).map((x) => (x === 'from' ? 0 : x === 'to' ? 100 : parseFloat(x)));
          steps.push({ at, body: inner.slice(o + 1, c) });
          j = c + 1;
        }
        out.keyframes[kf[1]] = steps;
      } else if (/^@(media|supports|layer|container)/.test(prelude)) {
        walk(inner);
      } else if (!prelude.startsWith('@')) {
        out.rules.push({ sels: prelude.split(',').map((x) => x.trim()).filter(Boolean), body: inner });
      }
      i = close + 1;
    }
  };
  walk(stripComments(css));
  return out;
}

const decl = (body, prop) => {
  // Свойства CSS регистронезависимы (L4): «OPACITY: 0» - то же, что «opacity: 0». Значения - в нижнем регистре.
  const re = new RegExp('(?:^|[;{\\s])' + prop + '\\s*:\\s*([^;}]+)', 'gi');
  const vals = []; let m;
  while ((m = re.exec(body))) vals.push(m[1].trim().replace(/\s*!important$/i, '').toLowerCase());
  return vals;
};
const isZero = (v) => /^0*(\.0+)?$/.test(v) || /^0%$/.test(v);

function animNames(body) {
  const names = [];
  for (const v of decl(body, 'animation-name')) names.push(...v.split(',').map((x) => x.trim()));
  for (const v of decl(body, 'animation')) for (const part of v.split(',')) {
    for (const tok of part.trim().split(/\s+/)) if (/^[a-zA-Z_][\w-]*$/.test(tok)) names.push(tok);
  }
  return names;
}
function animReversed(body) {
  return decl(body, 'animation').concat(decl(body, 'animation-direction')).some((v) => /\b(reverse|alternate)\b/.test(v));
}
function keyframesEndTransparent(steps, reversed) {
  if (!steps || !steps.length) return false;
  const at = (s) => Math.max(...s.at);
  const last = steps.reduce((a, b) => (at(b) >= at(a) ? b : a));
  const first = steps.reduce((a, b) => (Math.min(...b.at) <= Math.min(...a.at) ? b : a));
  const zero = (s) => decl(s.body, 'opacity').some(isZero);
  return zero(last) || (reversed && zero(first));
}
// decl приводит значения к нижнему регистру, а имена @keyframes в файле - как написаны: ищем без учёта регистра.
const kfByName = (keyframes, n) => keyframes[n] || keyframes[Object.keys(keyframes).find((k) => k.toLowerCase() === n)];

// --- селекторы (L4): последний составной селектор и его простые части ---
// Делим по комбинаторам (пробел > + ~) вне скобок () и [].
function lastCompound(sel) {
  let depth = 0, cut = 0;
  const s = String(sel).trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) cut = i + 1;
  }
  return s.slice(cut).trim();
}
// Простые селекторы составного: тип/*, #id, .класс, [атрибут], :псевдокласс(...), ::псевдоэлемент.
function simples(compound) {
  const out = [];
  const re = /::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?|[.#][\w-]+|\[[^\]]*\]|\*|[a-zA-Z][\w-]*/g;
  let m;
  while ((m = re.exec(compound))) out.push(/^[a-zA-Z*]/.test(m[0]) ? m[0].toLowerCase() : m[0]);
  return out;
}
const pseudoEl = (parts) => parts.filter((x) => x.startsWith('::') || /^:(before|after)$/i.test(x)).map((x) => x.replace(/^::?/, '::').toLowerCase()).join('');

// Селектор x относится к тому же элементу, что base: все простые части последнего составного базы
// входят в последний составной x, псевдоэлемент совпадает («body.locked .t», «.t.hide», «.t:not(.show)»
// - да; «.t::before», «.t .child», «.t-inner» - нет).
function sameElement(x, base) {
  if (x === base) return true;
  const bx = simples(lastCompound(base)), xx = simples(lastCompound(x));
  if (!bx.length) return false;
  if (pseudoEl(bx) !== pseudoEl(xx)) return false;
  return bx.every((t) => xx.includes(t));
}

// Отдельный класс-состояние (L4): «.t-hidden», «.t--gone», «.t__out» для базы с классом «.t», или общая
// утилита скрытия («.hidden», «.is-hidden», «.invisible», «.fade-out»), которую можно повесить на
// fixed-элемент. Такой класс в скрытом состоянии обязан сам нести pointer-events: none.
const STATE_WORD = '(?:hidden|hide|hiding|gone|invisible|out|fade|fading|fade-?out|leave|leaving|exit|exiting|closing|closed|off|inactive|collapsed)';
const UTILITY_STATE = new RegExp('^\\.(?:is-|u-|js-)?' + STATE_WORD + '$', 'i');
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function stateClassOf(x, base) {
  const xx = simples(lastCompound(x));
  const classes = xx.filter((t) => t.startsWith('.'));
  if (!classes.length || xx.some((t) => !t.startsWith('.') && !t.startsWith(':'))) return false;
  if (pseudoEl(xx)) return false;
  if (classes.every((c) => UTILITY_STATE.test(c))) return true;
  const baseClasses = simples(lastCompound(base)).filter((t) => t.startsWith('.'));
  return classes.some((c) => baseClasses.some((b) => new RegExp('^' + reEsc(b) + '(?:-{1,2}|_{1,2})' + STATE_WORD + '$', 'i').test(c)));
}

function hideReasons(body, keyframes) {
  const why = [];
  if (decl(body, 'opacity').some(isZero)) why.push('opacity:0');
  if (decl(body, 'visibility').some((v) => v === 'hidden' || v === 'collapse')) why.push('visibility:hidden');
  const rev = animReversed(body);
  for (const n of animNames(body)) if (keyframesEndTransparent(kfByName(keyframes, n), rev)) why.push('@keyframes ' + n + ' -> opacity:0');
  return why;
}
const peVals = (body) => decl(body, 'pointer-events');
const peNone = (body) => peVals(body).includes('none');
const peOn = (body) => peVals(body).some((v) => v !== 'none');   // auto / all / visible... - касания включены

export function transparentFixedOffenders(css) {
  const { rules, keyframes } = parseCss(css);
  const bases = new Set();
  for (const r of rules) if (decl(r.body, 'position').includes('fixed')) for (const s of r.sels) bases.add(s);
  const bad = [];
  for (const base of bases) {
    const baseRules = rules.filter((r) => r.sels.includes(base));
    const baseHasPe = baseRules.some((r) => peNone(r.body));
    const baseHidden = baseRules.map((r) => hideReasons(r.body, keyframes)).flat();
    for (const r of rules) {
      const own = r.sels.find((x) => sameElement(x, base));
      const sel = own || r.sels.find((x) => stateClassOf(x, base));
      if (!sel) continue;
      const isState = !own;
      const why = hideReasons(r.body, keyframes);
      // Скрыто этим правилом: касания выключены в нём самом или в базе - и НЕ включены этим же
      // правилом (pointer-events: auto в скрытом состоянии перебивает none базы).
      if (why.length) {
        const ok = peNone(r.body) || (!isState && baseHasPe && !peOn(r.body));
        if (!ok) bad.push(sel + ' (' + why.join(', ') + (peOn(r.body) ? ', pointer-events:auto' : '') + ')');
        continue;
      }
      // Правило включает касания (auto) у элемента, скрытого в базе, и само видимость не возвращает.
      if (!isState && baseHidden.length && peOn(r.body)) {
        const same = rules.filter((q) => q.sels.includes(sel));
        const opBack = same.some((q) => decl(q.body, 'opacity').some((v) => !isZero(v)));
        const visBack = same.some((q) => decl(q.body, 'visibility').includes('visible'));
        const stillHidden = baseHidden.some((w) => (w === 'visibility:hidden' ? !visBack : !opBack));
        if (stillHidden) bad.push(sel + ' (pointer-events:auto при скрытой базе: ' + baseHidden.join(', ') + ')');
      }
    }
  }
  return [...new Set(bad)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'www', 'css', 'app.css');
  const bad = transparentFixedOffenders(fs.readFileSync(file, 'utf8'));
  console.log(bad.length ? 'FAIL прозрачный fixed-элемент без pointer-events:none: ' + bad.join('; ') : 'ok: все прозрачные fixed-элементы с pointer-events:none');
  process.exit(bad.length ? 1 : 0);
}
