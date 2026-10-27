// purchase.js — ход покупки полной версии (1.3.3). НЕ core. Чистая логика без DOM: окна показывает
// app.js по итогу, таймеры опроса и время инъектируются (тесты подставляют свои и мок-плагин по контракту).
//
// Адверсариальное ревью 1.3.3 (27.10.2026, В1): раньше здесь стоял перенесённый из донора старый вариант -
// JS угадывал судьбу шторки таймерами «зависания» и возврата в приложение. Шторку дольше 75 с (новая карта +
// VK ID + 3DS) он «отпускал», заплативший видел пустоту; оплата «в обработке» считалась «не куплено», и
// «Купить» открывал вторую шторку. Теперь - схема регламента (память android-app-build-checklist «Покупка
// через RuStore Pay», п.11-14; эталон - «Понятная пенсия» 1.0.7 и «Хомяк» 1.0.6):
//   ОДНА МАШИНА СОСТОЯНИЙ: idle → precheck → sheet → ok | pending (опрос СВОЕЙ покупки) | failed | cancelled
//   - Сессия (S) - единственный замок: снимает только она сама (done). Таймера «зависания» нет: шторку не
//     отпускаем. Вернулся из банка по иконке, а шторка убита, - итог даёт ПЛАГИН (RuStorePayPlugin: purchaseId
//     из onPurchaseCreated, на handleOnResume - getPurchase(id), итог ровно один раз).
//   - Снимок владения (pay.js snapshot): owned | none | unknown. unknown - НЕ «не куплено»: перед шторкой -
//     окно «Не удалось проверить», после неуспеха - окно неуспеха, а поздний owned всё равно откроет доступ.
//   - «В обработке» (PROCESSING/EXECUTING, начатая оплата) - окно «Оплата обрабатывается», опрос checkPurchase
//     каждые 5 с до 3 мин → «Готово» / «Оплата не прошла» / «Проверим позже»; новую шторку не открываем.
//     Прошлая оплата ещё проверяется, а человек снова жмёт «Купить» - выбор «Подождать» / «Оплатить снова»
//     (решение Алексея 24.10 для «Хомяка» и «Карты года»), опрос прошлой идёт в фоне.
//   - Поздний успех не теряется: событие плагина purchaseLate, фоновый опрос, поздний ответ снимка.
//   - До шторки путь к оплате закрывают только окончательные причины (pay.js finalKind: бан, не подключено);
//     RuStore не установлен - окно «Нужен RuStore» с кнопкой «Открыть RuStore» (В2).

import { acknowledge, snapshot, precheck as payPrecheck, finalKind, notInstalled, checkPurchase, normPurchase, kindOfCode } from './pay.js';

// Тайминги: опрос своей покупки 5 с до 3 мин; снимок владения перед шторкой - до 8 с; восстановление - до 15 с.
export const PURCHASE_TIMINGS = Object.freeze({ pollMs: 5000, waitMs: 180000, ownsMs: 8000, restoreMs: 15000 });

// Тексты окон и строк пейволла (на «вы», дефис вместо длинного тире). Одно место для app.js и тестов.
export const PAY_TEXT = Object.freeze({
  sbp: 'Проще всего оплатить через СБП, в окне оплаты он уже выбран.',
  auth: 'RuStore может попросить войти в аккаунт. Через СБП можно оплатить без входа.',
  vpn: 'Если включён VPN, выключите его на время оплаты.',
  thanks: 'Полный доступ открыт. Спасибо, что поддержали разработку!',
  ownedAlready: 'Вы уже покупали полную версию в этом аккаунте RuStore. Полный доступ открыт, второй раз платить не нужно.',
  restored: 'Покупка восстановлена. Полный доступ снова открыт.',
});

// Итог неуспешной покупки → окно. retry: «Позже» / «Попробовать снова»; restore: «Позже» /
// «Восстановить покупку» (кнопка в самом окне - текст не ссылается на то, чего на экране нет);
// openStore: «Позже» / «Открыть RuStore»; payagain: «Подождать» / «Оплатить снова»;
// ни того, ни другого - одна «Понятно». vpn: строка про VPN под текстом.
export const FAIL_DIALOGS = Object.freeze({
  failed:       { title: 'Оплата не прошла', retry: true, vpn: true, text: 'Попробуйте ещё раз через СБП, в окне оплаты он выбран сразу. Если деньги всё же списались, нажмите «Восстановить покупку» в окне «Полная версия».' },
  // окно оплаты закрыли (сам человек или RuStore) - не «не прошла»: проход «новичок» 1.3.3
  cancelled:    { title: 'Оплата не завершена', retry: true, vpn: true, text: 'Окно оплаты закрылось раньше, чем прошла оплата. Если деньги всё же списались, нажмите «Восстановить покупку» в окне «Полная версия».' },
  nomethod:     { title: 'Оплата не прошла', retry: true, vpn: true, text: 'RuStore не смог принять оплату этим способом. Попробуйте через СБП.' },
  unauthorized: { title: 'Оплата не прошла', retry: true, vpn: false, text: 'RuStore просит войти в аккаунт. Войдите или оплатите через СБП, там вход не нужен.' },
  outdated:     { title: 'Обновите RuStore', retry: true, vpn: false, text: 'Эта версия RuStore не принимает оплату. Обновите приложение RuStore и попробуйте снова.' },
  notinstalled: { title: 'Нужен RuStore', openStore: true, vpn: false, text: 'Оплата идёт через приложение RuStore, а на этом устройстве его нет. Установите RuStore и вернитесь к покупке.' },
  banned:       { title: 'Оплата недоступна', retry: false, vpn: false, text: 'RuStore сейчас не принимает оплату в этом аккаунте или приложении. Причину подскажет поддержка: приложение RuStore, раздел «Помощь».' },
  unavailable:  { title: 'Оплата недоступна', retry: false, vpn: false, text: 'В этой версии «Сейфа» оплата не подключена. Купить полную версию можно в «Сейфе», установленном из RuStore.' },
  // магазин не ответил, куплено ли (снимок unknown): шторку не открываем - могла идти оплата
  nocheck:      { title: 'RuStore не отвечает', retry: true, vpn: true, text: 'Окно оплаты не открылось. Проверьте интернет и попробуйте снова.' },
  already:      { title: 'Покупка уже есть', restore: true, vpn: false, text: 'Полная версия уже куплена в этом аккаунте RuStore. Платить ещё раз не нужно, нажмите «Восстановить покупку».' },
  // 4000020, а список покупок её не видит: честный выход - аккаунт и поддержка RuStore, без тупика
  alreadyhidden:{ title: 'RuStore не показал покупку', restore: true, vpn: false, text: 'RuStore пишет, что полная версия уже куплена, но не находит покупку в этом аккаунте. Проверьте, что в RuStore вы вошли в тот же аккаунт, где покупали, и нажмите «Восстановить покупку». Не помогло - напишите в поддержку: приложение RuStore, раздел «Помощь».' },
  // плагин ответил 'busy': прошлое окно оплаты RuStore ещё живо (страница перезагрузилась при открытой шторке)
  sheetbusy:    { title: 'Оплата ещё не завершена', restore: true, vpn: false, text: 'Прошлая оплата в RuStore ещё не закончилась, второй раз платить не нужно. Уже оплатили - нажмите «Восстановить покупку». Не оплачивали - закройте «Сейф» и откройте снова, записи не пропадут.' },
  // прошлая оплата «в обработке» (п.11): новую шторку молча не открываем - спрашиваем
  prevpending:  { title: 'Прошлая оплата ещё проверяется', payagain: true, vpn: false, text: 'Уже заплатили в банке? Не платите второй раз: нажмите «Подождать», полный доступ откроется сам. Не платили - нажмите «Оплатить снова».' },
});
// Окна-сообщения с одной кнопкой «Понятно» (ожидание, «проверим позже», восстановление)
export const INFO_DIALOGS = Object.freeze({
  pending:  { title: 'Оплата обрабатывается', text: 'RuStore ещё проверяет оплату. Не платите второй раз: когда оплата пройдёт, полный доступ откроется сам.' },
  later:    { title: 'Проверим позже', text: 'RuStore пока не подтвердил оплату. «Сейф» проверит её снова, когда вы его откроете. Если деньги списались, а доступ не открылся, нажмите «Восстановить покупку» в окне «Полная версия».' },
  notfound: { title: 'Покупка не найдена', text: 'В этом аккаунте RuStore покупки нет. Если вы покупали, проверьте, что в RuStore выполнен вход в тот же аккаунт. Есть лицензионный ключ - введите его в окне «Полная версия».' },
  error:    { title: 'Не удалось проверить покупку', text: 'RuStore не ответил. Проверьте интернет и нажмите «Восстановить покупку» ещё раз.' },
});
export function failDialog(reason) { return FAIL_DIALOGS[reason] || FAIL_DIALOGS.failed; }
// Итоги, после которых окно не нужно: двойной тап (busy), снятое ожидание (none).
export const SILENT_KINDS = Object.freeze(['busy', 'none']);

// Строки пейволла по проверке до шторки (В2): всегда совет про СБП; не вошёл в RuStore - ещё строка про
// вход (шторку всё равно откроем); RuStore устарел - совет обновить; окончательная причина (бан, не
// подключено) или RuStore не установлен - вместо совета причина. pc = null (не знаем) - только СБП.
export function payHintLines(pc) {
  const fk = finalKind(pc);
  if (fk) return [failDialog(fk).text];
  if (notInstalled(pc)) return [failDialog('notinstalled').text];
  const lines = [PAY_TEXT.sbp];
  const k = pc && pc.code != null ? kindOfCode(pc.code) : null;
  if (pc && (pc.authorized === false || k === 'unauthorized')) lines.push(PAY_TEXT.auth);
  if (k === 'outdated') lines.push(FAIL_DIALOGS.outdated.text);
  return lines;
}

// Ход покупки. deps:
//   getAdapter()      - адаптер оплаты (payment.js)
//   isPro()           - доступ уже открыт (поздний успех второй раз «Готово» не показывает)
//   onPending()       - показать окно «Оплата обрабатывается» (идёт опрос своей покупки)
//   onLate(r)         - доступ открылся вне итога сессии (поздний успех): r = {kind, granted:true, purchaseId}
//   onPrecheck(pc)    - проверка до шторки ответила (строка «RuStore может попросить войти» до шторки)
//   stillHere()       - экран покупки ещё открыт (закрыли во время проверок - шторку не открываем)
//   wrapSheet(fn)     - обёртка вызова шторки (app.js: withSystemWindow - таймер бездействия стоит на время оплаты, М5;
//                     в фоне дольше окна автоблока сейф запрётся при возврате, Pro после входа - autoRestorePro)
//   setTimer/clearTimer/now, timings - для тестов
// Итог buy/restore/watch: { kind, granted, purchaseId?, code? }. granted:true - kind 'ok' | 'owned' |
// 'restored' (app.js записывает Pro в сейф); иначе kind - ключ FAIL_DIALOGS / INFO_DIALOGS / SILENT_KINDS.
export function createPurchaseFlow(deps = {}) {
  const setTimer = deps.setTimer || setTimeout;
  const clearTimer = deps.clearTimer || clearTimeout;
  const now = deps.now || (() => Date.now());
  const T = Object.assign({}, PURCHASE_TIMINGS, deps.timings || {});
  const call = (fn, ...a) => { try { if (typeof fn === 'function') return fn(...a); } catch (e) {} return undefined; };

  let S = null;          // сессия: { mode:'buy'|'restore'|'watch', state, pid, settle, late }
  const waited = {};     // purchaseId, чьё ожидание уже истекло («Проверим позже»): второй раз 3 минуты не ждём
  let laterId = null;    // последняя «Проверим позже»: на возврат в приложение перепроверить её
  let given = false;     // доступ уже выдан этим ходом (поздний успех не повторяет «Готово»)
  let bg = null;         // фоновый опрос прошлой оплаты «в обработке» (не замок)
  let subscribed = null; // адаптер, на чьё событие purchaseLate подписаны

  function ad() {
    const a = deps.getAdapter ? deps.getAdapter() : null;
    if (a && a !== subscribed && typeof a.onLate === 'function') { subscribed = a; a.onLate(onLate); }
    return a;
  }
  const hasPro = () => given || call(deps.isPro) === true;
  function begin(mode) { const s = { mode, state: mode === 'buy' ? 'precheck' : mode }; S = s; return s; }
  // Поздний успех пришёл, пока сессия ещё не дала итог (снимок после неуспеха, восстановление) - итог сессии
  // = этот успех: окно «Оплата не прошла» поверх выданного доступа не показываем.
  function done(s, r) { if (S === s) S = null; return (s.late && !(r && r.granted)) ? s.late : r; }
  function res(kind, code) { return { kind, granted: false, code: code || null }; }
  // Выдача доступа: только по подтверждению магазина; отметка выдачи (ACKNOWLEDGED) - сразу.
  function grant(kind, purchaseId) {
    given = true;
    if (purchaseId) acknowledge(ad(), purchaseId).catch(() => {});
    if (purchaseId && purchaseId === laterId) laterId = null;
    return { kind, granted: true, purchaseId: purchaseId || null, code: null };
  }
  const BUSY = Object.freeze({ kind: 'busy', granted: false, code: null });

  // Доступ открыт вне итога сессии: идёт ожидание - завершить его этим успехом; идёт другая стадия - успех
  // станет её итогом (done); сессии нет - отдельное «Готово» (app.js).
  function lateGrant(g) {
    if (S && S.state === 'pending' && S.settle) S.settle(g);
    else if (S) S.late = g;
    else call(deps.onLate, g);
  }
  // поздний owned из снимка, который не уложился в таймаут: доступ всё равно открыть
  function watchLate(sn) {
    if (!sn || !sn.late) return;
    sn.late.then((v) => { if (v && v.state === 'owned' && !hasPro()) lateGrant(grant('owned', v.ackId || null)); }, () => {});
  }
  // поздний успех шторки (плагин: purchaseLate)
  function onLate(r) {
    if (!r || r.status !== 'ok' || hasPro()) return;
    lateGrant(grant('ok', r.purchaseId));
  }

  // Ожидание итога СВОЕЙ покупки (pid): окно «Оплата обрабатывается», опрос checkPurchase каждые pollMs до waitMs.
  // pid нет - опрос снимком товара. Сбой связи - не вывод, ждём дальше. notPaying - плагин знает, что оплата НЕ
  // начиналась: счёт «open» = не оплачен, ждать нечего. Оплата начата - «open» значит «банк ещё проводит».
  function wait(s, pid, notPaying) {
    if (s.late) return Promise.resolve(done(s, s.late));
    if (pid && waited[pid]) {   // уже ждали 3 минуты: на «Купить» - выбор, иначе честное «позже»
      if (s.mode === 'buy') { startBg(pid); return Promise.resolve(done(s, res('prevpending'))); }
      return Promise.resolve(done(s, res('later')));
    }
    s.state = 'pending'; s.pid = pid || null; s.paying = notPaying !== true;
    call(deps.onPending);
    return new Promise((resolve) => {
      const t0 = now();
      let timer = null, fin = false;
      s.settle = (r) => { if (fin) return; fin = true; if (timer != null) clearTimer(timer); resolve(done(s, r)); };
      const step = () => { timer = setTimer(check, T.pollMs); };
      const timeUp = () => {
        if (now() - t0 < T.waitMs) return false;
        if (pid) { waited[pid] = true; laterId = pid; }
        s.settle(res('later'));
        return true;
      };
      function check() {
        timer = null;
        if (fin) return;
        const a = ad();
        const q = pid ? checkPurchase(a, pid, { timeoutMs: T.ownsMs }).then((c) => c.status)
          : snapshot(a, { timeoutMs: T.ownsMs }).then((sn) => (sn.state === 'owned' ? 'ok' : sn.state === 'unknown' ? null : (sn.pending ? 'pending' : 'cancelled')));
        q.then((st) => {
          if (fin) return;
          if (st === 'ok') { s.settle(grant('ok', pid)); return; }
          if (st === 'cancelled' || st === 'error') { s.settle(res('failed')); return; }
          if (st === 'open' && !s.paying) { s.settle(res('cancelled')); return; }
          if (!timeUp()) step();
        }, () => { if (!fin && !timeUp()) step(); });
      }
      step();
    });
  }

  // Итог шторки → ok | pending | неуспех (с перепроверкой: закрыл шторку после оплаты в банке - это не отмена).
  function afterSheet(s, raw) {
    const r = normPurchase(raw);
    if (r.status === 'ok') return done(s, grant('ok', r.purchaseId));
    if (r.status === 'pending') return wait(s, r.purchaseId);
    if (r.status === 'unavailable') return done(s, res('unavailable'));
    if (r.status === 'busy') return done(s, res('sheetbusy'));
    // плагин не смог спросить статус своей покупки после возврата (сеть) - ждём её итога, а не «не прошла»
    if (r.status === 'error' && r.code === 'CheckFailed' && r.purchaseId) return wait(s, r.purchaseId, !r.paying);
    const kind = r.status === 'cancelled' ? 'cancelled' : kindOfCode(r.code);
    if (kind === 'unavailable') return done(s, res('unavailable'));
    s.state = 'precheck';
    return snapshot(ad(), { timeoutMs: T.ownsMs }).then((sn) => {
      // отметка выдачи - только оплаченной покупке из снимка (ackId), не неудавшейся покупке из ошибки шторки
      if (sn.state === 'owned') return done(s, grant(kind === 'already' ? 'owned' : 'ok', sn.ackId));
      if (sn.pending) return wait(s, sn.pendingId || r.purchaseId);
      if (sn.state === 'unknown') watchLate(sn);
      return done(s, res(kind, r.code));
    });
  }

  // Фоновый опрос прошлой оплаты «в обработке» (окно «Предыдущая оплата ещё проверяется»): НЕ замок -
  // «Оплатить снова» не блокирует. Оплатилась - доступ и «Готово»; отменена/ошибка или прошло waitMs - снят.
  function stopBg() { if (bg) { if (bg.timer != null) clearTimer(bg.timer); bg = null; } }
  function startBg(pid) {
    if (!pid || (bg && bg.pid === pid)) return;
    stopBg();
    const b = { pid, t0: now(), timer: null };
    bg = b;
    const next = () => {
      if (bg !== b) return;
      if (now() - b.t0 >= T.waitMs) { stopBg(); return; }
      b.timer = setTimer(check, T.pollMs);
      if (b.timer && typeof b.timer.unref === 'function') b.timer.unref();   // node (тесты): опрос не держит процесс
    };
    function check() {
      b.timer = null;
      if (bg !== b) return;
      checkPurchase(ad(), pid, { timeoutMs: T.ownsMs }).then((c) => {
        if (bg !== b) return;
        if (c && c.status === 'ok') { stopBg(); if (!hasPro()) lateGrant(grant('ok', pid)); return; }
        if (c && (c.status === 'cancelled' || c.status === 'error')) { stopBg(); return; }
        next();
      }, next);
    }
    next();
  }

  // «Купить». opts.again - «Оплатить снова» из окна «Предыдущая оплата ещё проверяется»: ожидание прошлой
  // оплаты уходит в фон, шторка открывается.
  function buy(opts = {}) {
    const again = opts.again === true;
    if (S && S.state === 'pending') {
      // ждём прошлую оплату - «Купить» спрашивает (новую шторку молча не открываем)
      if (!again) return Promise.resolve(res('prevpending'));
      const ws = S;
      if (ws.pid) startBg(ws.pid);
      ws.settle(res('none'));
    }
    if (S) return Promise.resolve(BUSY);   // двойной тап / идёт другая стадия - вторая шторка не открывается
    const s = begin('buy');
    const a = ad();
    if (!a) return Promise.resolve(done(s, res('unavailable')));
    return snapshot(a, { timeoutMs: T.ownsMs }).then((sn) => {
      if (sn.state === 'owned') return done(s, grant('owned', sn.ackId));
      if (sn.state === 'unknown') { watchLate(sn); return done(s, res('nocheck')); }
      if (sn.pending && !again) { startBg(sn.pendingId); return done(s, res('prevpending')); }
      return payPrecheck(a).then((pc) => {
        const fk = finalKind(pc);
        if (fk) return done(s, res(fk, pc.code));                       // бан / не подключено - шторку не открываем
        if (notInstalled(pc)) return done(s, res('notinstalled', pc.code));   // шторке негде открыться
        call(deps.onPrecheck, pc);
        if (s.late) return done(s, s.late);                             // пока проверяли, открылся доступ
        if (deps.stillHere && call(deps.stillHere) === false) return done(s, res('none'));
        s.state = 'sheet';
        const open = () => a.purchase();
        return Promise.resolve()
          .then(() => (typeof deps.wrapSheet === 'function' ? deps.wrapSheet(open) : open()))
          .then(null, () => ({ status: 'error' }))
          .then((r) => afterSheet(s, r));
      });
    }).then(null, () => done(s, res('failed')));
  }

  // «Восстановить покупку» (сменил телефон, ответ шторки потерялся). opts.already - пришли из окна 4000020.
  function restore(opts = {}) {
    if (S) return Promise.resolve(BUSY);
    const s = begin('restore');
    const already = opts.already === true;
    return snapshot(ad(), { timeoutMs: T.restoreMs }).then((sn) => {
      if (sn.state === 'owned') return done(s, grant('restored', sn.ackId));
      if (sn.state === 'unknown') { watchLate(sn); return done(s, res('error')); }
      if (sn.unavailable) return done(s, res('unavailable'));
      if (sn.pending) return wait(s, sn.pendingId);   // оплата ещё обрабатывается - не «не найдена», а ждём
      return done(s, res(already ? 'alreadyhidden' : 'notfound'));
    }).then(null, () => done(s, res('error')));
  }

  // При входе в сейф магазин видит свежую оплату «в обработке» (pay.js autoRestorePro → onPending):
  // ждать её итога без шторки.
  function watch(pendingId) {
    if (S) return Promise.resolve(BUSY);
    if (!pendingId) return Promise.resolve(res('none'));
    ad();   // подписка на purchaseLate
    return wait(begin('watch'), String(pendingId));
  }

  // Возврат в приложение. Сессия идёт - её итог даёт плагин, JS ничего не угадывает. «Проверим позже» -
  // один раз перепроверить ту покупку. → true, если проверка запущена.
  function resume() {
    if (S || !laterId) return false;
    const pid = laterId;
    checkPurchase(ad(), pid, { timeoutMs: T.ownsMs }).then((c) => {
      if (c && c.status === 'ok' && !hasPro() && !S) call(deps.onLate, grant('ok', pid));
    }, () => {});
    return true;
  }

  return {
    buy, restore, watch, resume,
    busy: () => !!S,
    state: () => (S ? S.state : 'idle'),
    polling: () => !!bg,
  };
}
