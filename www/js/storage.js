// storage.js — где живёт зашифрованный vault. На телефоне (Capacitor) — приватная
// папка приложения через плагин Filesystem (Directory.Data), файл vault.dat. В браузере
// QA плагина нет — откат на localStorage под ключом seyf-vault. Формат — та же JSON-строка
// файла хранилища (crypto.newVaultFile). Наружу не утекает: DATA — приватный каталог,
// allowBackup=false в манифесте держит его вне Google-автобэкапа.
const FILE = 'vault.dat';
const DIR = 'DATA';
const LS_KEY = 'seyf-vault';

// Ошибка «файл хранилища есть, но не читается» (1.2.20). НЕ то же самое, что «сейфа нет»:
// boot() при ней не уходит в создание/демо и ничего не перезаписывает, а ведёт к восстановлению
// из резервной копии. Иначе любой сбой записи молча превращался бы в «начать с нуля» поверх данных.
export class VaultCorruptError extends Error {
  constructor(detail) { super('Файл хранилища повреждён' + (detail ? ': ' + detail : '')); this.name = 'VaultCorruptError'; this.code = 'VAULT_CORRUPT'; }
}

// 1.2.23 (A5): ошибка ЧТЕНИЯ (файл, возможно, есть и цел, но прочитать сейчас не удалось:
// IOException, нет дескрипторов, мост не ответил). НЕ «сейфа нет» и НЕ «повреждён»: boot()
// показывает экран «Повторить», ничего не создаёт и не перезаписывает.
export class VaultReadError extends Error {
  constructor(detail) { super('Не удалось прочитать файл хранилища' + (detail ? ': ' + detail : '')); this.name = 'VaultReadError'; this.code = 'VAULT_READ'; }
}

const msgOf = (e) => String((e && (e.message || e.code)) || e || '');

// «Файла нет» - ЕДИНСТВЕННАЯ ошибка чтения, которая означает «сейфа нет». Плагин Filesystem
// (Android 6.x) отвечает на FileNotFoundException текстом «File does not exist»; веб-реализация -
// «File does not exist.». Всё остальное (Unable to read file, EMFILE, EACCES...) - ошибка чтения.
export function isMissingFileError(e) {
  return /does not exist|no such file|ENOENT/i.test(msgOf(e));
}

// Разбор сырого содержимого (1.2.23, A1): null - файла НЕТ (read вернул null); undefined - файл
// есть, но это не файл сейфа (пустой, обрезанный, не JSON или нет поля v); иначе - объект файла.
// Пустая строка = повреждён: обрыв записи (truncate без данных) не должен читаться как «сейфа нет».
export function parseVault(raw) {
  if (raw == null) return null;
  if (raw === '') return undefined;
  try { const f = JSON.parse(raw); return (f && typeof f === 'object' && f.v) ? f : undefined; }
  catch (e) { return undefined; }
}

// Сторож записи (1.2.23, A3): запись, которая не завершилась за это время, считается навсегда
// подвисшей (мост Capacitor не ответил). Очередь её бросает и идёт дальше, backend получает
// abandon() - следующая запись пойдёт в НОВЫЙ временный файл, куски не смешаются.
// 1.2.24 (п.4): это время БЕЗ ПРОГРЕССА, а не общее время записи. Каждый записанный кусок
// (backend.write зовёт onChunk) взводит сторожа заново: большой сейф на медленном телефоне
// пишется сколько нужно, а бросается только запись, которая реально встала.
export const WRITE_WATCHDOG_MS = 60000;

export function hungError() {
  const e = new Error('write-hung'); e.code = 'write-hung'; return e;
}

// makeStore — ядро без глобалов, чтобы тестировать на поддельном backend.
// 1.2.20: ВСЕ записи идут через ОДНУ очередь: следующая стартует только после РЕАЛЬНОГО
// завершения предыдущей (промис backend.write, не таймаут вызывающего). Без неё две записи
// (сохранение записи + тап ↓ / удаление / избранное) шли параллельно, и на чанковом пути куски
// двух версий перемешивались во временном файле -> rename мусора в vault.dat -> потеря.
// Коалесцинг: пока ожидающая запись не стартовала, новый save лишь подменяет её данные на
// более свежие (каждый файл - полное состояние, последний вызов - самый актуальный).
// 1.2.23: сторож (watchdogMs) - навсегда подвисшая запись не держит очередь вечно.
export function makeStore(backend, { watchdogMs = WRITE_WATCHDOG_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let tail = Promise.resolve();   // завершение последней запущенной записи (или её брошенность)
  let pending = null;             // запись в очереди, ещё не стартовавшая: { data, promise }
  // 1.2.24 (п.4): слушатели прогресса ВСЕХ ожидающих записей. Любой записанный кусок очереди -
  // знак, что мост жив: сторож очереди сохранений (persist.js) тоже взводится заново.
  const listeners = new Set();
  const beatAll = () => { for (const fn of listeners) { try { fn(); } catch (e) {} } };

  // 1.2.25 (ревью 1.2.24, п.4): точка фиксации - успешный rename временного файла в vault.dat
  // (backend.write зовёт onCommit). После неё запись СОСТОЯЛАСЬ: сторож, сработав на зависшей
  // уборке старых tmp, больше не отклоняет запись (раньше - ложное «не записано» + баннер при целом
  // vault.dat), а бросает уборку (abandon: эпоха, она не тронет tmp следующей записи) и резолвит
  // успехом. Ошибка уборки после фиксации - тоже успех. На уборку после фиксации - половина сторожа:
  // очередь сохранений (persist.js, тот же срок) гарантированно узнаёт об успехе раньше своего сторожа.
  function runWrite(data) {
    return new Promise((resolve, reject) => {
      let done = false, t = null, committed = false;
      const finish = (fn, v) => { if (done) return; done = true; if (t != null) clearTimer(t); t = null; fn(v); };
      const hung = () => {
        if (done) return;
        try { if (backend.abandon) backend.abandon(); } catch (e) {}
        if (committed) finish(resolve, undefined);   // vault.dat уже записан: зависла только уборка
        else finish(reject, hungError());
      };
      const arm = (ms = watchdogMs) => {
        if (!(watchdogMs > 0 && Number.isFinite(watchdogMs)) || done) return;
        if (t != null) clearTimer(t);
        t = setTimer(hung, ms);
      };
      // Кусок записан -> сторож заново (пока запись не брошена/не завершена) + пульс слушателям.
      const onChunk = () => { if (done) return; if (!committed) arm(); beatAll(); };
      const onCommit = () => { if (done || committed) return; committed = true; arm(Math.max(1, Math.floor(watchdogMs / 2))); beatAll(); };
      arm();
      const d = data;
      data = null;   // п.10: строку файла держит только backend.write (брошенная запись её отпускает)
      Promise.resolve().then(() => backend.write(d, onChunk, onCommit)).then((v) => finish(resolve, v), (e) => (committed ? finish(resolve, undefined) : finish(reject, e)));
    });
  }

  return {
    // 1.2.23 (A1/A4/A5): null ТОЛЬКО если нет ни vault.dat, ни временного файла. vault.dat есть,
    // но битый/пустой -> VaultCorruptError (устаревший временный файл НЕ подставляем: при записи
    // через tmp+rename vault.dat никогда не бывает полузаписан, а tmp рядом с битым dat - старьё).
    // vault.dat нет, но есть целый временный файл (обрыв ВНУТРИ rename: dat уже удалён, tmp ещё
    // не переименован) -> берём его и СРАЗУ переименовываем в vault.dat (до любых записей).
    // Ошибка чтения (не «файла нет») пробрасывается как VaultReadError.
    // 1.2.24 (п.4): onProgress - пульс после каждого шага чтения (таймаут загрузки в app.js меряет
    // время БЕЗ прогресса, а не общее). 1.2.24 (п.8): временные файлы - самый свежий первым (1.2.25,
    // п.5: при readdir - по номеру, без него - по mtime), после неудачного promote следующая запись идёт в НОВЫЙ временный файл (backend).
    async load({ onProgress = null } = {}) {
      const beat = () => { if (onProgress) { try { onProgress(); } catch (e) {} } };
      const main = await backend.read();
      beat();
      const pm = parseVault(main);
      if (pm) return pm;
      if (pm === undefined) throw new VaultCorruptError(main === '' ? 'vault.dat пустой' : 'vault.dat не читается');
      const tmps = backend.listTmp ? await backend.listTmp(beat) : [];
      beat();
      for (const t of tmps) {
        const pt = parseVault(t.raw);
        if (!pt) continue;
        if (backend.promote) { try { await backend.promote(t.name); } catch (e) { /* данные в памяти, следующая запись всё равно создаст vault.dat */ } }
        return pt;
      }
      if (tmps.length) throw new VaultCorruptError('vault.dat нет, временный файл не читается');
      return null;
    },
    // opts.onProgress (1.2.24, п.4) - пульс на каждом записанном куске очереди, пока эта запись
    // (или та, к которой она присоединилась) не завершилась.
    save(file, { onProgress = null } = {}) {
      const data = JSON.stringify(file);
      let p;
      if (pending) { pending.data = data; p = pending.promise; }
      else {
        const job = { data };
        job.promise = tail.then(() => { pending = null; const d = job.data; job.data = null; return runWrite(d); });
        pending = job;
        tail = job.promise.catch(() => {});
        p = job.promise;
      }
      if (typeof onProgress === 'function') {
        listeners.add(onProgress);
        const off = () => { listeners.delete(onProgress); };
        p.then(off, off);
      }
      return p;
    },
    // 1.2.24 (п.11): «Начать заново» - повреждённый/пропавший сейф ОТКЛАДЫВАЕТСЯ (не удаляется):
    // vault.dat и временные файлы переименовываются в vault.corrupt-<ts>[-<имя>]. После этого
    // load() возвращает null (сейфа нет) и можно создать новый. Возвращает число отложенных файлов.
    async setAsideCorrupt(ts = Date.now()) {
      if (!backend.setAsideCorrupt) return 0;
      return backend.setAsideCorrupt(ts);
    },
    // 1.2.25 (п.4): только ПРОЧИТАТЬ vault.dat (без подстановки tmp и без переименований) - чтобы
    // после сбоя записи узнать, что реально лежит на диске. null - файла нет; undefined - не разбирается.
    async peek() {
      return parseVault(await backend.read());
    },
    // Сырой vault.dat (как есть, даже битый) сохранить отдельным файлом vault.corrupt-<ts>
    // перед восстановлением из копии (A9). true - сохранили; false - сохранять нечего.
    async preserveCorrupt(ts = Date.now()) {
      if (!backend.preserveCorrupt) return false;
      return backend.preserveCorrupt(ts);
    },
  };
}

function nativeFs() {
  try {
    const C = globalThis.Capacitor;
    if (!C || !(C.isNativePlatform && C.isNativePlatform())) return null;
    const NP = globalThis.NativePlugins;
    return (NP && NP.Filesystem) ? NP.Filesystem : null;
  } catch (e) { return null; }
}

// Запись vault (1.2.23, A4): ВСЕГДА через временный файл + rename, и маленький сейф тоже.
// Раньше маленький vault писался writeFile прямо в vault.dat (truncate + write): обрыв посреди
// записи оставлял пустой/обрезанный vault.dat. Теперь vault.dat меняется только атомарным
// rename целиком записанного временного файла. Большой vault по-прежнему идёт кусками
// (writeFile + appendFile, не одним сообщением моста). После успешного rename остатки
// временных файлов удаляются. Формат vault.dat прежний (та же JSON-строка).
//
// Имя временного файла: vault.tmp.<gen>. gen растёт после брошенной (подвисшей, A3) или
// упавшей записи - следующая запись идёт в НОВЫЙ файл: куски двух попыток не смешиваются, а
// целый временный файл от оборванного rename не затирается следующей попыткой. Старое имя
// vault.tmp (до 1.2.23) тоже читается при восстановлении.
export const TMP_LEGACY = 'vault.tmp';
export const TMP_PROBE = 8;                 // без readdir проверяем vault.tmp.1..8
const TMP_RE = /^vault\.tmp(?:\.(\d+))?$/;
const seqOf = (name) => { const m = TMP_RE.exec(name); return m ? (m[1] ? Number(m[1]) : 0) : -1; };
export const WRITE_CHUNK = 256 * 1024;   // символов (vault - ASCII: JSON + base64)

// Нарезка строки на куски <= size, не разрывая суррогатную пару UTF-16 (заслон на случай
// не-ASCII символов: половинка пары в UTF-8 превратилась бы в мусор при записи).
export function splitChunks(s, size = WRITE_CHUNK) {
  const out = [];
  for (let i = 0; i < s.length;) {
    let end = Math.min(i + size, s.length);
    if (end < s.length) {
      const c = s.charCodeAt(end - 1);
      if (c >= 0xD800 && c <= 0xDBFF) end -= 1;   // high surrogate на краю -> переносим в след. кусок
    }
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}

const nameOf = (f) => (typeof f === 'string' ? f : f && f.name);
const mtimeOf = (f) => { const m = f && typeof f === 'object' ? Number(f.mtime) : NaN; return Number.isFinite(m) ? m : NaN; };

// Порядок временных файлов «самый свежий первым».
// 1.2.25 (ревью 1.2.24, п.5): номер записи надёжнее часов. Когда папка читается (readdir), номера
// растут монотонно: первая запись сессии идёт в имя выше любого остатка (checkGen), каждая новая
// попытка - в следующий номер (gen). Часы телефона могут быть сбиты (остаток, записанный при часах
// «впереди», побеждал свежий файл по mtime). Поэтому при readdir - МАКСИМАЛЬНЫЙ номер, mtime - только
// когда номера неразличимы (равны). Без readdir номера между сессиями не согласованы (checkGen не
// видит остатков) - тогда, как в 1.2.24, по mtime (stat), а номер - при равном/неизвестном времени.
export function newestFirst(a, b) {
  const ma = Number(a.mtime), mb = Number(b.mtime);
  if (Number.isFinite(ma) && Number.isFinite(mb) && ma !== mb) return mb - ma;
  return b.seq - a.seq;
}
export function newestBySeq(a, b) {
  if (a.seq !== b.seq) return b.seq - a.seq;
  const ma = Number(a.mtime), mb = Number(b.mtime);
  if (Number.isFinite(ma) && Number.isFinite(mb) && ma !== mb) return mb - ma;
  return 0;
}

export function makeFsBackend(fs, { chunk = WRITE_CHUNK } = {}) {
  let gen = 1;          // номер временного файла текущей записи
  let epoch = 0;        // растёт при abandon(): брошенная запись, проснувшись, ничего не делает
  let genChecked = false;   // 1.2.24 (п.8): перед первой записью сессии gen поднят выше остатков
  const known = new Set([TMP_LEGACY]);   // имена tmp, о которых знаем без readdir (только ЧТЕНИЕ)
  const inflight = new Set();            // п.10: куски текущих записей (брошенная их отпускает)
  const bumpGen = (seq) => { if (Number.isFinite(seq) && seq >= gen) gen = seq + 1; };

  // null ТОЛЬКО для «файла нет» (A5). Иначе - VaultReadError. Сообщение плагина неоднозначно ->
  // уточняем через stat: файла действительно нет -> null; есть (или stat тоже падает) -> ошибка.
  const readOne = async (path) => {
    try {
      const r = await fs.readFile({ path, directory: DIR, encoding: 'utf8' });
      return r && typeof r.data === 'string' ? r.data : '';
    } catch (e) {
      if (isMissingFileError(e)) return null;
      if (typeof fs.stat === 'function') {
        try { await fs.stat({ path, directory: DIR }); }
        catch (e2) { if (isMissingFileError(e2)) return null; }
      }
      throw new VaultReadError(path + ': ' + msgOf(e));
    }
  };

  // Временные файлы в папке: [{ name, mtime }] или null, если readdir недоступен/упал.
  const readTmpDir = async () => {
    if (typeof fs.readdir !== 'function') return null;
    try {
      const r = await fs.readdir({ path: '', directory: DIR });
      const out = [];
      for (const f of (r && r.files) || []) { const n = nameOf(f); if (n && TMP_RE.test(n)) out.push({ name: n, mtime: mtimeOf(f) }); }
      return out;
    } catch (e) { return null; }
  };

  // Имена для восстановления: known + пробы vault.tmp.1..8 + всё из readdir. Map имя -> mtime.
  // names.fromDir (1.2.25, п.5) - папка прочитана (номера монотонны, выбираем по номеру).
  const listNames = async () => {
    const names = new Map();
    for (const n of known) names.set(n, NaN);
    for (let i = 1; i <= TMP_PROBE; i++) names.set('vault.tmp.' + i, NaN);
    const dir = await readTmpDir();
    for (const f of dir || []) names.set(f.name, f.mtime);
    names.fromDir = !!dir;
    return names;
  };

  // Удалить остатки временных файлов после УСПЕШНОЙ записи. Ошибки глотаем: это уборка.
  // 1.2.24 (п.3) - уборка брошенной записи больше не может удалить временный файл НОВОЙ записи:
  //   - список имён ТОЛЬКО из readdir; readdir недоступен или упал - не удаляем ничего (раньше
  //     запасной список known содержал имя новой записи -> её tmp удалялся посреди записи ->
  //     обрезок переименовывался в vault.dat при «ok»);
  //   - перед КАЖДЫМ удалением проверяем, что эпоха записи ещё текущая (не брошена сторожем);
  //   - никогда не удаляем имя текущей/более новой записи (номер >= gen).
  const cleanup = async (myEpoch) => {
    if (typeof fs.deleteFile !== 'function') return;
    const dir = await readTmpDir();
    if (!dir || myEpoch !== epoch) return;
    // Живая запись: всё в списке - остатки (новее её записей нет, очередь последовательная).
    // Следующая запись пойдёт в имя выше любого остатка.
    for (const f of dir) bumpGen(seqOf(f.name));
    for (const f of dir) {
      if (myEpoch !== epoch) return;              // брошена сторожем, пока удаляли, - стоп
      if (seqOf(f.name) >= gen) continue;         // имя текущей/новой записи не трогаем никогда
      try { await fs.deleteFile({ path: f.name, directory: DIR }); known.delete(f.name); } catch (e) {}
    }
  };

  // п.8: первая запись сессии идёт в имя ВЫШЕ любого оставшегося временного файла (остаток
  // прошлой сессии не затирается и не «побеждает» свежий файл по номеру при восстановлении).
  // 1.3.0 (ревью 1.2.25, L1): «проверено» ставим ТОЛЬКО после успешного readdir. Раньше разовый
  // сбой readdir навсегда оставлял gen = 1: запись сессии шла в vault.tmp.1 НИЖЕ старого остатка
  // (напр. vault.tmp.7), и при обрыве внутри rename следующая загрузка (newestBySeq, по номеру)
  // поднимала старый остаток, а уборка удаляла новейший tmp. Теперь при сбое readdir: (1) пробуем
  // имена vault.tmp.1..TMP_PROBE через stat (дёшево, без чтения содержимого) и поднимаем gen выше
  // найденных; (2) genChecked остаётся false - следующая запись снова спросит папку.
  const probeGen = async (myEpoch) => {
    if (typeof fs.stat !== 'function') return;
    for (let i = TMP_PROBE; i >= 1; i--) {
      if (myEpoch !== epoch) return;
      try { await fs.stat({ path: 'vault.tmp.' + i, directory: DIR }); bumpGen(i); return; } catch (e) {}
    }
  };
  const checkGen = async (myEpoch) => {
    if (genChecked) return;
    const dir = await readTmpDir();
    if (myEpoch !== epoch) return;             // брошенная запись gen не двигает
    if (!dir) {
      await probeGen(myEpoch);
      if (typeof fs.readdir !== 'function') genChecked = true;   // readdir нет совсем - лучше проб не будет
      return;
    }
    for (const f of dir) bumpGen(seqOf(f.name));
    genChecked = true;
  };

  return {
    read() { return readOne(FILE); },
    // Все существующие временные файлы, новейший первым: [{ name, raw }]. Для load(), когда
    // vault.dat нет (обрыв внутри rename).
    // 1.2.25 (п.5): папка прочитана - новейший = максимальный номер (newestBySeq), mtime - только
    // при равных номерах; без readdir - по mtime (stat), номер при равном/неизвестном времени.
    // Все найденные номера поднимают gen: если promote не удастся, первая запись пойдёт в НОВОЕ
    // имя и не затрёт единственную копию данных.
    async listTmp(beat) {
      const out = [];
      const names = await listNames();
      for (const [name, dirMtime] of names) {
        const raw = await readOne(name);
        if (beat) beat();
        if (raw == null) continue;
        let mtime = dirMtime;
        if (!Number.isFinite(mtime) && typeof fs.stat === 'function') {
          try { mtime = mtimeOf(await fs.stat({ path: name, directory: DIR })); } catch (e) { mtime = NaN; }
        }
        out.push({ name, raw, seq: seqOf(name), mtime });
        bumpGen(seqOf(name));
      }
      out.sort(names.fromDir ? newestBySeq : newestFirst);   // п.5 (1.2.25): при readdir - по номеру
      return out;
    },
    // Целый временный файл -> vault.dat (A1: сразу при загрузке, до любых записей), остатки прочь.
    async promote(name) {
      const myEpoch = epoch;
      await fs.rename({ from: name, to: FILE, directory: DIR, toDirectory: DIR });
      await cleanup(myEpoch);
    },
    // onChunk (1.2.24, п.4) - после каждого записанного куска: сторож очереди взводится заново.
    // onCommit (1.2.25, п.4) - сразу после успешного rename в vault.dat: запись состоялась, дальше
    // только уборка остатков (её зависание/ошибка запись «незаписанной» не делает).
    async write(s, onChunk, onCommit) {
      const myEpoch = epoch;
      const beat = () => { if (onChunk) { try { onChunk(); } catch (e) {} } };
      const alive = () => { if (myEpoch !== epoch) { const e = new Error('write-abandoned'); e.code = 'write-abandoned'; throw e; } };
      if (!genChecked) { await checkGen(myEpoch); alive(); beat(); }
      const name = 'vault.tmp.' + gen;
      known.add(name);
      // п.10: куски держим в объекте, который брошенная запись опустошает (abandon) - подвисший
      // навсегда мост не держит в памяти копию всего сейфа на каждую брошенную попытку.
      const job = { parts: splitChunks(s, chunk) };
      s = null;
      inflight.add(job);
      try {
        await fs.writeFile({ path: name, directory: DIR, encoding: 'utf8', data: job.parts[0] || '' });
        alive(); beat();
        for (let i = 1; i < job.parts.length; i++) {
          await fs.appendFile({ path: name, directory: DIR, encoding: 'utf8', data: job.parts[i] });
          alive(); beat();
        }
        job.parts = null;
        await fs.rename({ from: name, to: FILE, directory: DIR, toDirectory: DIR });
      } catch (e) {
        // Упала/брошена: следующая попытка - в НОВЫЙ временный файл (целый tmp не затираем).
        if (myEpoch === epoch) gen++;
        throw e;
      } finally {
        job.parts = null;
        inflight.delete(job);
      }
      if (onCommit) { try { onCommit(); } catch (e) {} }   // п.4 (1.2.25): vault.dat записан
      if (myEpoch !== epoch) return;   // брошенная запись проснулась: чужие tmp не трогаем
      known.delete(name);
      beat();
      await cleanup(myEpoch);
    },
    // Сторож очереди бросил зависшую запись (A3): её продолжение ничего не сделает, новая
    // запись пойдёт в новый временный файл. п.10: её куски отпускаем сразу.
    abandon() {
      epoch++; gen++;
      for (const job of inflight) job.parts = null;
      inflight.clear();
    },
    inflightCount() { return inflight.size; },   // для теста п.10
    // 1.2.24 (п.11): «Начать заново» - vault.dat и временные файлы ОТКЛАДЫВАЮТСЯ переименованием
    // (vault.corrupt-<ts>, vault.corrupt-<ts>-<имя tmp>), ничего не удаляется.
    // 1.2.25 (ревью 1.2.24, п.6): сначала временные файлы, ПОСЛЕДНИМ - vault.dat. Раньше vault.dat
    // уходил первым: если потом не переименовался tmp, «Повторить» поднимал устаревший tmp как сейф,
    // а экран писал «ничего не изменено». Теперь при сбое посреди - откат уже сделанных
    // переименований; откат удался - честное «ничего не изменено» (e.partial = false), не удался -
    // e.partial = true и e.moved (что осталось отложенным): приложение говорит «отложено частично».
    async setAsideCorrupt(ts) {
      const plan = [];
      for (const [name] of await listNames()) {
        let raw;
        try { raw = await readOne(name); } catch (e) { raw = ''; }
        if (raw == null) continue;
        plan.push({ from: name, to: 'vault.corrupt-' + ts + '-' + name });
      }
      let main;
      try { main = await readOne(FILE); } catch (e) { main = ''; }
      if (main != null) plan.push({ from: FILE, to: 'vault.corrupt-' + ts });
      const done = [];
      for (const step of plan) {
        try {
          await fs.rename({ from: step.from, to: step.to, directory: DIR, toDirectory: DIR });
          done.push(step);
        } catch (e) {
          const left = [];
          for (const d of done.slice().reverse()) {
            try { await fs.rename({ from: d.to, to: d.from, directory: DIR, toDirectory: DIR }); }
            catch (e2) { left.push(d.from); }
          }
          const err = new Error(msgOf(e) || 'rename failed');
          err.code = 'set-aside-failed';
          err.partial = left.length > 0;
          err.moved = left.reverse();
          throw err;
        }
      }
      for (const d of done) known.delete(d.from);
      return done.length;
    },
    // A9: сохранить сырой vault.dat рядом как vault.corrupt-<ts> перед восстановлением поверх.
    async preserveCorrupt(ts) {
      const raw = await readOne(FILE);
      if (raw == null) return false;
      await fs.writeFile({ path: 'vault.corrupt-' + ts, directory: DIR, encoding: 'utf8', data: raw });
      return true;
    },
  };
}

function lsBackend() {
  return {
    async read() {
      try { return localStorage.getItem(LS_KEY); }
      catch (e) { throw new VaultReadError('localStorage: ' + msgOf(e)); }
    },
    // Ошибку записи НЕ глотаем (раньше catch {} молча терял данные): очередь покажет сбой.
    async write(s) { localStorage.setItem(LS_KEY, s); },
    async preserveCorrupt(ts) {
      const raw = localStorage.getItem(LS_KEY);
      if (raw == null) return false;
      localStorage.setItem(LS_KEY + '-corrupt-' + ts, raw);
      return true;
    },
    // п.11: отложить повреждённый сейф (копия под -corrupt-<ts>) и освободить место под новый.
    async setAsideCorrupt(ts) {
      const raw = localStorage.getItem(LS_KEY);
      if (raw == null) return 0;
      localStorage.setItem(LS_KEY + '-corrupt-' + ts, raw);
      localStorage.removeItem(LS_KEY);
      return 1;
    },
  };
}

export function defaultStore() {
  const fs = nativeFs();
  return makeStore(fs ? makeFsBackend(fs) : lsBackend());
}
