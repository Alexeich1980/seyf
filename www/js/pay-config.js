// pay-config.js — ЕДИНОЕ место для боевых идентификаторов RuStore Pay «Сейфа».
// Подставить из RuStore Консоли (rustore.ru/console) ПЕРЕД боевым релизом. НЕ core.
//
//   PRODUCT_ID     — id непотребляемого товара «Полная версия». Тип в Консоли:
//                    НЕПОТРЕБЛЯЕМЫЙ (NON_CONSUMABLE) — разовая покупка навсегда, без подписки.
//   CONSOLE_APP_ID — id приложения из карточки в Консоли. Его же ПРОДУБЛИРОВАТЬ в
//                    android/app/src/main/res/values/strings.xml (rustore_console_app_id):
//                    нативный SDK читает id именно оттуда, а этот файл — источник правды
//                    для JS и место, где оба значения задокументированы вместе.
//
// Пока стоят плейсхолдеры: JS-адаптер работает в MOCK (браузер/дев), нативная покупка на
// девайсе отвечает «оплата не сконфигурирована» и НЕ выдаёт Pro бесплатно (см. RuStorePayPlugin).

export const PLACEHOLDER = 'РАЗМЕСТИТЬ_APP_ID_ИЗ_RUSTORE_CONSOLE';

// id товара «Полная версия» (см. задание п.24: продукт «seyf-pro»). Одно место для JS.
export const PRODUCT_ID = 'seyf-pro';

// id приложения в Консоли. Держать в синхроне со strings.xml. Пока — плейсхолдер.
export const CONSOLE_APP_ID = '2063760405';

// вписан ли боевой console_app_id (не плейсхолдер/не пусто). Заглушкой пользуется только
// диагностика; выбор mock/real делает окружение (нативный плагин сам читает strings.xml).
export function isConfigured() {
  const v = CONSOLE_APP_ID;
  return !!v && v.trim() !== '' && v.indexOf('РАЗМЕСТИТЬ') !== 0;
}
