// autolock.js — единая логика автоблокировки: по таймеру бездействия и при уходе в фон.
// Чистое ядро без глобалов: таймер инъектируется (тест подставляет поддельный).
// Привязка к событиям телефона (Capacitor App) и браузера — снаружи, в app.js.
export function createAutoLock({ timeoutMs, onLock, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let handle = null;
  let ms = timeoutMs;
  function disarm() { if (handle != null) { clearTimer(handle); handle = null; } }
  function arm() { disarm(); handle = setTimer(onLock, ms); }
  function activity() { arm(); }        // любое действие — сброс таймера
  function background() { disarm(); onLock(); }  // уход в фон — немедленная блокировка
  function setTimeoutMs(v) { if (Number(v) > 0) ms = Number(v); }  // сменить таймер (настройка «Безопасность»)
  return { arm, disarm, activity, background, setTimeoutMs };
}

// Решение при возврате из фона (заслон 18.8): пока не вышли за окно автоблока — восстановить
// тот же экран (DOM жив, ничего не перерисовываем и не сбрасываем на витрину/лок); вышли за
// окно — запереть. На телефоне фоновые таймеры заморожены, поэтому прошедшее время считаем
// вручную по метке ухода в фон, а не полагаемся на setTimeout. Чистая логика — под тест.
export function resumeDecision(backgroundedAt, now, autolockMs) {
  if (!backgroundedAt) return 'restore';
  if (!(Number(autolockMs) > 0)) return 'restore';
  return (now - backgroundedAt >= autolockMs) ? 'lock' : 'restore';
}

// Решение при возврате из фона с учётом СОБСТВЕННОГО системного окна (сохранение/выбор файла, камера,
// печать, шторка оплаты RuStore). Косяк #17: системное окно не должно запирать сейф МГНОВЕННО - человек
// ушёл в выбор папки/печать/банк, а не бросил телефон. Мгновенного запирания при уходе в фон нет ни для
// кого (18.8), поэтому флаг systemWindowOpen на решение НЕ влияет: правило «в фоне дольше окна автоблока
// → при возврате запереть» действует всегда.
// Баг 1.3.3 (проход на телефоне 27.10, REPORT п.8): раньше при systemWindowOpen всегда 'restore', а метка
// фона при открытом окне не ставилась - печать → «Домой» на 6 мин → возврат = сейф открыт без входа.
// Теперь метка фона ставится и при открытом окне (момент открытия окна = начало «фона», app.js onBackground).
export function foregroundDecision({ systemWindowOpen, backgroundedAt, now, autolockMs }) {
  void systemWindowOpen;   // принимается для ясности вызова; на решение не влияет (см. выше)
  return resumeDecision(backgroundedAt, now, autolockMs);
}
