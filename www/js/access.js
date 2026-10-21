// access.js — флаги сборки доступа «Сейфа». НЕ core (мобильная монетизация).
//
// ЗАСЛОН FAIL-CLOSED (в отличие от «Хомяка», где по умолчанию всё открыто): для менеджера
// паролей цена ошибки — бесплатно розданная Полная версия, поэтому полный доступ включается
// ТОЛЬКО когда сборка ЯВНО его вшила (window.SEYF_FULL_ACCESS === true). Нет флага (релиз/OTA,
// браузер без флага) → FULL=false → лимиты активны. Флаг ставит www/buildflags.js:
//   debug-APK (node build-apk.js)        → SEYF_FULL_ACCESS=true  (демо/тесты без упора в лимиты);
//   release-APK (build-apk.js --release) → SEYF_FULL_ACCESS=false (лимиты активны);
//   OTA (build-ota.js --release)         → SEYF_FULL_ACCESS=false (стамп-заслон, даже если www грязный).
// Значение FULL на боевом устройстве потом приходит НЕ отсюда, а от факта покупки/ключа
// (см. pay.js hasFullAccess → Gate.isPro: покупка/лицензия лежат в зашифрованном vault.pro).
//
//   PAY — оплата подключена (window.SEYF_PAY !== false). По умолчанию true: адаптер (payment.js)
//         сам решает mock (браузер/дев) или боевой RuStore (нативка с плагином и боевым id).
//   DEMO  — демо-режим первого запуска (window.SEYF_DEMO !== false). По умолчанию включён (тест-канал,
//           браузер); релиз/стор-сборка вшивает SEYF_DEMO=false (build-lib.js shipFlags) - первый
//           запуск сразу ведёт к созданию мастер-пароля. app.js: demoEnabled = Demo.DEMO_ENABLED && DEMO.
//   STORE — сторовая сборка (window.SEYF_STORE === true, только build-apk.js --store): обновления
//           ТОЛЬКО через RuStore. update.js не ходит в сеть вообще (ни манифеста, ни zip, ни APK),
//           boot.js не откатывается на скачанные веб-сборки. Строго true, как и FULL.

const W = (typeof window !== 'undefined') ? window : {};

// полный доступ: строго true, только если сборка явно вшила флаг (fail-closed)
export const FULL = (W.SEYF_FULL_ACCESS === true);
// оплата подключена: true, пока сборка явно не выключила
export const PAY = (W.SEYF_PAY !== false);
// демо первого запуска: включено, пока сборка явно не выключила (релиз/стор выключают)
export const DEMO = (W.SEYF_DEMO !== false);
// сторовая сборка: строго true, только если сборка явно вшила флаг
export const STORE = (W.SEYF_STORE === true);

// экспорт для не-модульных потребителей/QA (напр. проверить window.Access.FULL в консоли)
if (typeof window !== 'undefined') {
  try { window.Access = { FULL, PAY, DEMO, STORE }; } catch (e) {}
}
