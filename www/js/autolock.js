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

// Решение при возврате из фона с поправкой на СОБСТВЕННОЕ системное окно (корень косяка #17
// «после Сохранить приложение закрывается»). Когда мы сами открываем системное окно —
// сохранение файла (SaveFile), выбор файла (pickFiles) или камеру (captureFromCamera) —
// приложение уходит в фон, но это НЕ уход пользователя: запирать нельзя, иначе выбор папки
// в проводнике (может длиться дольше окна автоблока) выкидывает на экран блокировки.
// Пока флаг systemWindowOpen поднят — всегда 'restore'; иначе обычное окно времени.
export function foregroundDecision({ systemWindowOpen, backgroundedAt, now, autolockMs }) {
  if (systemWindowOpen) return 'restore';
  return resumeDecision(backgroundedAt, now, autolockMs);
}
