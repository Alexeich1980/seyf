// persist.js - «неубиваемое» сохранение записи (1.2.20, повтор бага п.1 на «Важных реквизитах»).
// Mobile-only, НЕ core. Чистая логика без DOM: на неё тест с подвисшим моком (tests/persist.test.mjs).
//
// Корень класса: редактор закрывался только ПОСЛЕ await saveFile(). Если запись на устройство
// ПОДВИСАЛА (промис не резолвится: Filesystem/мост Capacitor на большом vault со сканами, WebCrypto),
// try/catch не помогал - окно висело, «Сохранить ничего не делает». Теперь:
//   1) закрываем UI СРАЗУ (правка уже в state.vault), запись на диск - после;
//   2) каждая стадия записи (reencrypt, write) ограничена таймаутом - подвисание превращается
//      в отклонение с кодом стадии, которое показываем toast-ом («...(write-timeout)»), чтобы
//      следующий тап на телефоне сам назвал причину.

export const SAVE_TIMEOUT_MS = 15000;

const msgOf = (e) => String((e && (e.message || e.code)) || e || 'unknown').replace(/\s+/g, ' ').trim();

// Ошибка стадии: code = 'reencrypt' | 'write' | '<stage>-timeout'; cause - исходная ошибка.
export function stageError(code, cause) {
  const e = new Error(cause === undefined ? code : code + ': ' + msgOf(cause));
  e.code = code;
  if (cause !== undefined) e.cause = cause;
  return e;
}

// Промис с потолком по времени: не дождались за ms -> reject stageError(code).
export function withTimeout(promise, ms, code) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(stageError(code)), ms); });
  return Promise.race([Promise.resolve(promise), timer]).finally(() => clearTimeout(t));
}

// Выполнить стадию записи с таймаутом; любая ошибка стадии получает её код.
export async function runStage(stage, fn, ms = SAVE_TIMEOUT_MS) {
  try {
    return await withTimeout(Promise.resolve().then(fn), ms, stage + '-timeout');
  } catch (e) {
    if (e && typeof e.code === 'string' && e.code === stage + '-timeout') throw e;
    throw stageError(stage, e);
  }
}

// Короткая метка причины для toast: таймаут -> его код; иначе «стадия: сообщение» (<=80 симв.).
export function saveErrorLabel(e) {
  const code = e && typeof e.code === 'string' ? e.code : '';
  const text = /-timeout$/.test(code) ? code : (code ? msgOf(e) : 'save: ' + msgOf(e));
  return text.length > 80 ? text.slice(0, 79) + '…' : text;
}

// Последовательный «сохранятор» vault (1.2.20, заслон от потери данных): run(setStage, alive) - одна
// полная запись (перешифровка АКТУАЛЬНОГО состояния + запись на диск). Гарантии:
//   - одновременно идёт не больше ОДНОГО run; следующий стартует только после РЕАЛЬНОГО
//     завершения предыдущего (очередь ждёт настоящий промис, а не таймаут);
//   - коалесцинг: если в очереди уже ждёт запуск, новый вызов к нему присоединяется (ожидающий
//     run при старте перешифрует самое свежее состояние);
//   - таймаут - ТОЛЬКО уведомление вызывающего (reject с кодом стадии для toast); сама запись
//     продолжается, и очередь её дожидается.
// 1.2.23 (A3): СТОРОЖ watchdogMs. Run, не завершившийся за это время, считается навсегда
// подвисшим: очередь его бросает (alive() у него начинает возвращать false - проснувшись, он не
// должен писать устаревшее), вызывающий получает код '<стадия>-hung', и запись сразу
// перезапускается заново (новая попытка перешифрует актуальное состояние). Без сторожа одна
// вечная запись навсегда блокировала все следующие правки.
// Учёт «незаписанного» (A2/A3): unsaved() - есть запрошенные, но ещё не записанные изменения;
// failed() - последняя попытка упала/брошена; late() - вызывающий уже получил таймаут. onChange
// зовётся при каждом изменении этого состояния (баннер «Изменения не записаны»).
// 1.2.24 (п.4): сторож меряет время БЕЗ ПРОГРЕССА: run получает третьим аргументом beat() (и
// setStage тоже считается пульсом) - каждый записанный кусок взводит сторожа заново. Большой сейф
// на медленном телефоне больше не бросается и не перезапускается по кругу.
// 1.2.24 (п.10): повтор после брошенной записи - с паузой, растущей вдвое (первый сразу), и не
// больше maxAutoRetries подряд. Дальше сам не повторяет: остаётся баннер «Изменения не записаны»;
// следующая правка пользователя или блокировка (drainWithRetry) пробуют снова. Успех сбрасывает счёт.
export const WATCHDOG_MS = 60000;
export const RETRY_BASE_MS = 5000;
export const RETRY_MAX_MS = 60000;
export const MAX_AUTO_RETRIES = 4;

// Пауза перед n-м автоповтором (n = 1, 2, ...): 0, base, 2*base, 4*base ... не больше max.
export function retryDelayMs(n, base = RETRY_BASE_MS, max = RETRY_MAX_MS) {
  if (!(n > 1)) return 0;
  return Math.min(max, base * Math.pow(2, n - 2));
}

export function makeSerialSaver(run, { timeoutMs = SAVE_TIMEOUT_MS, watchdogMs = WATCHDOG_MS, onChange = null, setTimer = setTimeout, clearTimer = clearTimeout,
  retryBaseMs = RETRY_BASE_MS, retryMaxMs = RETRY_MAX_MS, maxAutoRetries = MAX_AUTO_RETRIES } = {}) {
  let tail = Promise.resolve();
  let pending = null;
  let stage = 'queue';
  let reqSeq = 0, doneSeq = 0, failed = false, late = false;
  let hungStreak = 0;          // п.10: брошенных сторожем попыток подряд
  let retryTimer = null;       // п.10: запланированный автоповтор
  const status = () => ({ unsaved: doneSeq < reqSeq, failed: failed && doneSeq < reqSeq, late: late && doneSeq < reqSeq });
  const notify = () => { if (onChange) { try { onChange(status()); } catch (e) {} } };
  const scheduleRetry = () => {
    hungStreak++;
    if (hungStreak > maxAutoRetries) return;          // предел: дальше только баннер
    const delay = retryDelayMs(hungStreak, retryBaseMs, retryMaxMs);
    if (delay <= 0) { enqueue().catch(() => {}); return; }   // писать заново: актуальное состояние
    if (retryTimer != null) return;
    retryTimer = setTimer(() => { retryTimer = null; enqueue().catch(() => {}); }, delay);
  };
  const exec = () => {
    const mySeq = reqSeq;             // все запросы до старта этого run он и запишет
    stage = 'start';
    const token = { abandoned: false };
    const alive = () => !token.abandoned;
    let t = null, done = false, onHung = null;
    const arm = () => {
      if (done || !alive() || !onHung || !(watchdogMs > 0 && Number.isFinite(watchdogMs))) return;
      if (t != null) clearTimer(t);
      t = setTimer(onHung, watchdogMs);
    };
    return new Promise((resolve, reject) => {
      const fin = (ok, v) => {
        if (done) return;
        done = true;
        if (t != null) clearTimer(t);
        t = null;
        stage = 'queue';
        if (ok) { doneSeq = Math.max(doneSeq, mySeq); failed = false; hungStreak = 0; if (doneSeq >= reqSeq) late = false; }
        else failed = true;
        notify();
        if (ok) resolve(v); else reject(v);
      };
      onHung = () => {
        if (done) return;
        const code = stage + '-hung';
        token.abandoned = true;
        fin(false, stageError(code));
        scheduleRetry();
      };
      arm();
      const work = (async () => {
        try { await run((s) => { if (alive()) { stage = s; arm(); } }, alive, arm); }
        catch (e) { throw (e && typeof e.code === 'string') ? e : stageError(stage, e); }
      })();
      work.then((v) => fin(true, v), (e) => fin(false, e));
    });
  };
  function enqueue() {
    if (pending) return pending;
    const p = tail.then(() => { pending = null; return exec(); });
    pending = p;
    tail = p.catch(() => {});
    return p;
  }
  function save() {
    reqSeq++;
    const p = enqueue();
    let t;
    const timer = new Promise((_, rej) => { t = setTimeout(() => { late = true; notify(); rej(stageError(stage + '-timeout')); }, timeoutMs); });
    return Promise.race([p, timer]).finally(() => clearTimeout(t));
  }
  save.settled = () => tail;   // реальное завершение всей очереди (lockNow/OTA ждут его, A2)
  save.hungStreak = () => hungStreak;   // для тестов п.10
  save.unsaved = () => status().unsaved;
  save.failed = () => status().failed;
  save.late = () => status().late;
  save.status = status;
  return save;
}

// Дождаться очереди записи перед уходом со страницы (lockNow -> reload, OTA -> перезапуск), A2.
// true - очередь завершилась (успешно или с ошибкой) за ms; false - не дождались (запись висит).
// Вызывающий после этого сам смотрит unsaved(): записалось ли на самом деле.
export const DRAIN_MS = 10000;
export async function drainQueue(settled, ms = DRAIN_MS, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let t;
  const clock = new Promise((res) => { t = setTimer(() => res(false), ms); });
  try {
    return await Promise.race([Promise.resolve().then(settled).then(() => true, () => true), clock]);
  } finally { clearTimer(t); }
}

// Дождаться очереди, а если последняя попытка УПАЛА - один раз записать заново (1.2.24, п.5).
// Раньше после разовой ошибки записи блокировка/OTA только ждали очередь, которая уже стояла
// пустой: правка терялась, хотя повтор записал бы её. Общий потолок ms на всё ожидание.
// true - всё записано; false - незаписанное осталось (вызывающий честно предупреждает).
export async function drainWithRetry(save, ms = DRAIN_MS, { setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
  const until = now() + ms;
  const left = () => Math.max(0, until - now());
  if (!save.unsaved()) return true;
  // Дождаться идущей попытки (если есть); последняя УПАЛА - ровно один повтор и снова ждать.
  await drainQueue(save.settled, left(), { setTimer, clearTimer });
  if (save.unsaved() && save.failed() && left() > 0) {
    try { const r = save(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
    await drainQueue(save.settled, left(), { setTimer, clearTimer });
  }
  return !save.unsaved();
}

// Потолок по времени БЕЗ ПРОГРЕССА (1.2.24, п.4): start(beat) возвращает промис; каждый beat()
// взводит таймер заново. Не было пульса ms - reject stageError(code). Для загрузки сейфа при старте.
export function withIdleTimeout(start, ms, code, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  return new Promise((resolve, reject) => {
    let t = null, done = false;
    const fin = (fn, v) => { if (done) return; done = true; if (t != null) clearTimer(t); t = null; fn(v); };
    const beat = () => { if (done) return; if (t != null) clearTimer(t); t = setTimer(() => fin(reject, stageError(code)), ms); };
    beat();
    let p;
    try { p = Promise.resolve(start(beat)); } catch (e) { p = Promise.reject(e); }
    p.then((v) => fin(resolve, v), (e) => fin(reject, e));
  });
}

// Общее чтение сейфа при старте (1.2.24, п.4). Таймаут загрузки не запускает НОВОЕ чтение:
// «Повторить» ждёт уже идущее (на медленном телефоне большой сейф читается дольше - раньше
// каждое «Повторить» начинало заново и не успевало никогда). load(beat) - само чтение с пульсом.
//   wait(ms) - ждать идущее (или начать, если его нет/прошлое упало); таймаут - по отсутствию
//              пульса; успешный результат отдаётся один раз;
//   settled() - промис окончания идущего чтения (для авто-продолжения с экрана ожидания).
// 1.2.25 (ревью 1.2.24, п.3): чтение, у которого потерялся ответ моста, не завершается НИКОГДА, и
// «Повторить» ждал его вечно. Теперь помним время последнего пульса: если пульса нет дольше
// STALE_FACTOR x таймаута простоя, это чтение бросаем (его поздний результат ни на что не влияет)
// и начинаем новое. Медленное, но живое чтение пульсирует и не бросается.
// 1.3.0 (ревью 1.2.25, L2): одних часов мало. Одно долгое чтение (один вызов моста readFile на
// большом сейфе) внутри себя не пульсирует; пока пользователь читает окно «Не удалось открыть»,
// время без пульса копится, и «Повторить» через минуту запускал ВТОРОЕ полное чтение всего сейфа
// в очередь за первым (двойная нагрузка на тот же медленный мост). Теперь чтение бросаем, только
// если ОБА условия: (1) ожидание именно этого чтения истекло STALE_TIMEOUTS раз подряд (без пульса
// между ними - пульс счёт сбрасывает) и (2) пульса нет дольше STALE_FACTOR x таймаута. Выбрано
// вместо «пульса до/после readFile»: пульс вокруг одного вызова ничего не говорит о ходе ВНУТРИ
// него, а счёт таймаутов меряет реальное ожидание (время, пока окно просто открыто, не в счёт).
// Навсегда повисшее чтение по-прежнему бросается - со второго «Повторить» после двух таймаутов.
export const STALE_FACTOR = 3;
export const STALE_TIMEOUTS = 2;
export function makeSharedLoader(load, timers = {}) {
  const now = (timers && typeof timers.now === 'function') ? timers.now : Date.now;
  let cur = null;   // { p, state: 'pending' | 'ok' | 'err', beat, lastBeat, timeouts }
  function start() {
    const c = { state: 'pending', beat: null, lastBeat: now(), timeouts: 0 };
    c.p = Promise.resolve().then(() => load(() => { c.lastBeat = now(); c.timeouts = 0; if (c.beat) c.beat(); }));
    c.p.then(() => { c.state = 'ok'; }, () => { c.state = 'err'; });
    cur = c;
    return c;
  }
  function get(ms) {
    if (!cur || cur.state === 'err') return start();
    if (cur.state === 'pending' && Number.isFinite(ms) && ms > 0
      && cur.timeouts >= STALE_TIMEOUTS && now() - cur.lastBeat > STALE_FACTOR * ms) {
      cur.state = 'stale';   // брошено: ни результат, ни ошибка этого чтения больше не нужны
      return start();
    }
    return cur;
  }
  return {
    wait(ms, code = 'load-timeout') {
      const c = get(ms);
      return withIdleTimeout((beat) => { c.beat = beat; return c.p; }, ms, code, timers)
        .then((v) => { if (cur === c) cur = null; return v; },
          (e) => { if (e && e.code === code && c.state === 'pending') c.timeouts++; throw e; });
    },
    pending: () => !!(cur && cur.state === 'pending'),
    settled: () => (cur ? cur.p.then(() => true, () => true) : Promise.resolve(true)),
  };
}

// Закрыть UI СРАЗУ, потом записать. close() синхронный и вызывается ДО persist() - поэтому
// подвисшая/упавшая запись не может удержать окно открытым. onFailed получает ошибку стадии.
export async function closeThenPersist({ close, persist, onSaved, onFailed }) {
  close();
  try { await persist(); }
  catch (e) { if (onFailed) onFailed(e); return false; }
  if (onSaved) onSaved();
  return true;
}

// Какая обёртка мастер-ключа реально на диске (1.2.25, ревью 1.2.24, п.4). После сбоя/зависания
// записи при смене мастер-пароля нельзя верить ни «записалось», ни «не записалось»: rename мог
// пройти, а ответ моста - потеряться. disk - перечитанный vault.dat; next/prev - { kdf, pwWrap }
// новой и прежней обёртки. 'new' | 'old' | 'unknown' (диск не прочитан или там ни та, ни другая).
export function wrapOnDisk(disk, next, prev) {
  if (!disk || typeof disk !== 'object' || !disk.pwWrap) return 'unknown';
  const key = (w) => JSON.stringify([w && w.kdf, w && w.pwWrap]);
  const d = key(disk);
  if (next && d === key(next)) return 'new';
  if (prev && d === key(prev)) return 'old';
  return 'unknown';
}
