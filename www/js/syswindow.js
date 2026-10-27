// syswindow.js - «сейчас открыто НАШЕ системное окно» (сохранение файла, выбор файла, камера, шторка
// оплаты, печать Android). Пока оно открыто, уход приложения в фон - не уход пользователя и не запирает
// сейф (корень косяка #17). Чистая логика без глобалов - под тест (tests/adv133b-fixes.test.mjs).
//
// Ревью 1.3.3 М1: окно печати Android живёт дольше вызова плагина. run(fn, { untilForeground: true })
// держит флаг, пока приложение не вернётся на передний план: если fn закончилась, а приложение ещё в фоне
// (окно печати открыто), флаг снимается только на foreground(). Счётчик - на случай двух окон подряд.
export function createSysWindow() {
  let open = 0;
  let hidden = false;
  let waiters = [];
  return {
    isOpen: () => open > 0,
    isHidden: () => hidden,
    // уход в фон - отмечаем всегда (даже при открытом окне): по этой отметке run ждёт возврата
    background() { hidden = true; },
    // возврат на передний план - отпустить всех, кто ждал возврата
    foreground() {
      hidden = false;
      const w = waiters; waiters = [];
      for (const r of w) r();
    },
    async run(fn, { untilForeground = false } = {}) {
      open += 1;
      try { return await fn(); }
      finally {
        if (untilForeground && hidden) await new Promise((r) => { waiters.push(r); });
        open -= 1;
      }
    },
  };
}
