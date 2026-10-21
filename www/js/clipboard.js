// clipboard.js — копирование секрета в буфер с ГАРАНТИРОВАННОЙ очисткой.
// Чистая логика поверх инъектируемого clipboard (в тестах — фейк): очистка по TTL
// И принудительно при блокировке/уходе в фон (lockNow дёргает clearIfOurs ДО reload,
// иначе таймер гибнет вместе со страницей и секрет остаётся в буфере — findings В-2).
// «Наш секрет» отслеживаем, чтобы при очистке не затирать то, что пользователь скопировал сам.
//
// 1.2.23 (B3): неудачная очистка (приложение в фоне: WebView без фокуса отклоняет и чтение, и
// запись буфера) больше НЕ теряет pending. Раньше pending обнулялся ДО попытки -> секрет навсегда
// оставался в буфере, а блокировка думала, что чистить нечего. Теперь pending снимаем только
// после успешной очистки (или когда в буфере уже не наш секрет), иначе поднимаем флаг
// retryNeeded: app.js повторяет очистку при возврате на передний план и при блокировке.
//
// 1.2.24 (п.1): блокировка перезагружает страницу - pending и retry гибли вместе с ней, и секрет
// оставался в буфере навсегда, если очистка при блокировке не прошла (нет фокуса). Теперь неудача
// очистки ставит флаг во flag-хранилище (app.js: localStorage с 1.2.25 - переживает и reload, и
// выгрузку процесса Android; секрет туда НЕ пишется, только факт «надо очистить»). После перезагрузки
// clearAfterReload() при первом фокусе очищает буфер (writeText('')). Успешная очистка флаг снимает.
//
// 1.3.0 (ревью 1.2.25, M2): флаг ставится уже при copy(), а не только после НЕУДАЧНОЙ очистки.
// Раньше: скопировали секрет -> ушли в другое приложение -> Android выгрузил процесс до TTL ->
// таймер умер вместе со страницей, флага нет -> на холодном старте буфер никто не чистил, секрет
// оставался там навсегда. Теперь флаг живёт с момента копирования и снимается ТОЛЬКО после успешной
// очистки или когда в буфере уже не наш секрет. Во флаге - только время (мс), секрета и его хэша нет.
// При неудачной очистке время обновляется: окно холодного старта (CLIP_BLIND_WINDOW_MS) считается от
// последнего момента, когда наш секрет мог лежать в буфере.
export function createClipboardGuard({ clipboard, setTimer = setTimeout, clearTimer = clearTimeout, ttlMs = 30000, flag = null, now = Date.now }) {
  let pending = null;   // последний скопированный нами секрет, ещё не очищенный
  let handle = null;
  let retry = false;    // очистка уже пыталась и не смогла - повторить при первой возможности

  function disarm() { if (handle != null) { clearTimer(handle); handle = null; } }
  const flagSet = () => { if (flag) { try { flag.set(now()); } catch (e) {} } };
  const flagClear = () => { if (flag) { try { flag.clear(); } catch (e) {} } };
  const failed = () => { retry = true; flagSet(); return false; };
  const cleared = (secret) => { if (pending === secret) { pending = null; retry = false; flagClear(); } };

  // Очистить буфер, если там всё ещё наш секрет. Возвращает true, если очистили.
  async function clearIfOurs() {
    if (pending == null) return false;
    const secret = pending;
    disarm();
    let cur;
    try { cur = await clipboard.readText(); }
    catch {
      // Чтение недоступно (фон/нет фокуса) — чистим вслепую: приватность важнее.
      try { await clipboard.writeText(''); }
      catch { return failed(); }                      // и запись недоступна - pending НЕ теряем
      cleared(secret);
      return true;
    }
    if (!sameClip(cur, secret)) {                     // в буфере уже не наш секрет — чужое не трогаем
      cleared(secret);
      return false;
    }
    try { await clipboard.writeText(''); }
    catch { return failed(); }
    cleared(secret);
    return true;
  }

  // Повторить очистку, если прошлая попытка (по TTL в фоне) не удалась. Зовётся при возврате на
  // передний план: если TTL ещё не вышел, буфер НЕ трогаем (пользователь мог уйти вставить пароль).
  async function retryIfFailed() {
    if (!retry || pending == null) return false;
    return clearIfOurs();
  }

  async function copy(secret) {
    await clipboard.writeText(secret);
    pending = secret;
    retry = false;
    flagSet();     // M2: флаг с момента копирования - переживёт выгрузку процесса до TTL
    disarm();
    handle = setTimer(() => { clearIfOurs(); }, ttlMs);
  }

  return { copy, clearIfOurs, retryIfFailed, hasPending: () => pending != null, needsRetry: () => retry };
}

// Сравнение содержимого буфера с нашим секретом без учёта вида переводов строк (1.2.24, п.2:
// многострочные реквизиты - буфер Android может вернуть \r\n вместо \n).
function sameClip(a, b) {
  const n = (x) => String(x == null ? '' : x).replace(/\r\n?/g, '\n');
  return n(a) === n(b);
}

// Флаг «буфер надо очистить» в хранилище, переживающем перезагрузку страницы (1.2.24, п.1).
// storage - localStorage (1.2.25; или фейк в тестах). Любая ошибка хранилища - молча: флаг - страховка.
// 1.3.0 (M2): значение - время копирования/последней неудачной очистки в мс (строка цифр); '1' -
// флаг без времени (1.2.25 и set() без аргумента), считается «в окне». Секрет не хранится никогда.
export const CLIP_FLAG_KEY = 'seyf_clip_clear_pending';
export function makeClipFlag(storage, key = CLIP_FLAG_KEY) {
  const raw = () => { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } };
  return {
    set(at) {
      const v = Number.isFinite(at) && at > 0 ? String(Math.floor(at)) : '1';
      try { if (storage) storage.setItem(key, v); } catch (e) {}
    },
    clear() { try { if (storage) storage.removeItem(key); } catch (e) {} },
    has() { const v = raw(); return v === '1' || (typeof v === 'string' && /^\d+$/.test(v)); },
    // Время флага в мс; null - флага нет или он без времени ('1').
    at() { const v = raw(); return typeof v === 'string' && /^\d+$/.test(v) && v !== '1' ? Number(v) : null; },
  };
}

// Окно слепой очистки на холодном старте (M2). Секрета после выгрузки процесса мы уже не знаем, и
// сравнить буфер не с чем: чистим вслепую, а это может стереть то, что человек позже скопировал сам.
// 60 минут: Android 13+ сам очищает буфер примерно через час после копирования, так что позже на
// новых телефонах нашего секрета там уже нет и слепая очистка только портила бы чужое; в пределах
// часа пароль в буфере (его видят клавиатура с историей буфера и другие приложения) опаснее, чем
// потеря чужого скопированного текста. TTL (30 с) как окно не годится: холодный старт почти всегда
// позже TTL, и защита не срабатывала бы никогда.
export const CLIP_BLIND_WINDOW_MS = 60 * 60 * 1000;

// Дождаться фокуса окна не дольше ms (1.2.24, п.1): без фокуса WebView отклоняет запись в буфер.
// true - фокус есть (сразу или дождались), false - не дождались. Слушатель снимается всегда.
export function waitForFocus({ hasFocus, addListener, removeListener, ms = 1500, setTimer = setTimeout, clearTimer = clearTimeout }) {
  try { if (hasFocus && hasFocus()) return Promise.resolve(true); } catch (e) {}
  return new Promise((resolve) => {
    let t = null;
    const done = (v) => { if (t != null) clearTimer(t); t = null; try { removeListener(on); } catch (e) {} resolve(v); };
    const on = () => done(true);
    try { addListener(on); } catch (e) { resolve(false); return; }
    t = setTimer(() => done(false), ms);
  });
}

// После перезагрузки (блокировка): флаг стоит - при первом фокусе очистить буфер вслепую
// (writeText(''); секрета мы уже не знаем, а оставить его в буфере нельзя). Не вышло (снова без
// фокуса) - ждём следующего фокуса. Успех снимает флаг. Возвращает промис «очищено ли».
// 1.3.0 (M2): флаг старше CLIP_BLIND_WINDOW_MS (по времени во флаге) - буфер не трогаем, флаг снимаем.
export function clearAfterReload({ clipboard, flag, hasFocus, addListener, removeListener, now = Date.now, windowMs = CLIP_BLIND_WINDOW_MS }) {
  if (!flag || !flag.has()) return Promise.resolve(false);
  const at = typeof flag.at === 'function' ? flag.at() : null;
  if (at != null) {
    const age = now() - at;
    // Часы отмотали назад (age < 0) - считаем «в окне»: приватность важнее.
    if (age > windowMs) { try { flag.clear(); } catch (e) {} return Promise.resolve(false); }
  }
  const attempt = async () => {
    try { await clipboard.writeText(''); flag.clear(); return true; }
    catch (e) { return false; }
  };
  return new Promise((resolve) => {
    let busy = false;
    const on = async () => {
      if (busy || !flag.has()) return;
      busy = true;
      const ok = await attempt();
      busy = false;
      if (ok || !flag.has()) { try { removeListener(on); } catch (e) {} resolve(ok); }
    };
    try { addListener(on); } catch (e) {}
    let focused = false;
    try { focused = !!(hasFocus && hasFocus()); } catch (e) {}
    if (focused) on();
  });
}

// Какое копирование нужно значению из карточки (1.2.23, B4). Ядро (ui.js) отдаёт номер карты и
// произвольные поля в «обычное» копирование (без автоочистки). Номер карты и произвольные поля
// (туда кладут что угодно, в т.ч. коды и пароли) копируем ЗАЩИЩЁННО: с очисткой буфера по TTL и
// при блокировке. true - защищённое копирование.
export function copyNeedsGuard(section, entry, value) {
  const v = String(value == null ? '' : value);
  if (!v || !entry) return false;
  if (section === 'cards' && entry.number != null && String(entry.number) === v) return true;
  for (const cf of entry.customFields || []) {
    if (cf && cf.value != null && String(cf.value) === v) return true;
  }
  return false;
}
