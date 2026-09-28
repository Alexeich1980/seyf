// sectionsx.js — mobile-only расширение разделов «Сейфа» (batch2): Контакты, Wi-Fi, Реквизиты.
// Подписи и схемы полей новых разделов НЕ в core ui.js (иначе core-drift краснеет — ядро
// обязано быть байт-в-байт с десктопом). Вместо этого модуль при импорте ДОРЕГИСТРИРУЕТ их
// в живые объекты UI.SECTION_LABELS / UI.FIELD_SCHEMA (мутация содержимого объекта, а не
// переопределение const-биндинга — это законно и ядро не трогает). Все места, читающие эти
// объекты (редактор, карточка, поиск, paywall, подсказки), сразу видят новые разделы.
//
// Схемы держим на стандартных типах core-renderField (text|copy|secret|textarea), чтобы не
// добавлять новый тип в core. Действия «Позвонить»/«Открыть» для Контактов дорисовывает
// mobile-слой (app.decorateContactCard) поверх core-карточки, как это уже сделано для
// «Документов» — ядро при этом не меняется.
import * as UI from './ui.js';
import { SECTIONS } from './sections.js';

export const EXTRA_LABELS = {
  contacts: 'Избранные контакты',
  wifi: 'Пароли Wi-Fi',
  requisites: 'Важные реквизиты',
};

// type: text | copy | secret | textarea. Первое поле — заголовок карточки (core: schema[0]).
export const EXTRA_SCHEMA = {
  // Контакты: секретов нет → «глаз» не рисуется (secvis.sectionHasSecrets = false).
  // phone получает кнопку «Позвонить» (tel:), link — «Открыть» (system) в mobile-декораторе.
  contacts: [
    { key: 'name', label: 'Имя', type: 'text' },
    { key: 'phone', label: 'Телефон', type: 'copy' },
    { key: 'email', label: 'E-mail', type: 'copy' },
    { key: 'link', label: 'Мессенджер или ссылка', type: 'copy' },
    { key: 'note', label: 'Заметка', type: 'textarea' },
  ],
  // Wi-Fi: «Название» (Домашний/Гостевой/На работе) - заголовок карточки, отдельно от «Имя сети
  // (SSID)» (п.20). Пароль - секрет (скрыт, «глаз», копирование через clipboard-guard). Порядок
  // тела: имя сети, пароль, заметка. Если «Название» пусто - заголовок берётся по SSID
  // (app.applyTitleFallback; миграции данных нет).
  wifi: [
    { key: 'name', label: 'Название', type: 'text' },
    { key: 'ssid', label: 'Имя сети (SSID)', type: 'text' },
    { key: 'password', label: 'Пароль', type: 'secret' },
    { key: 'note', label: 'Заметка', type: 'textarea' },
  ],
  // Реквизиты: «Название» (Бизнес/Жена/Партнёр) - заголовок карточки, чтобы в превью было
  // понятно, чьи реквизиты (п.21). Числовые поля - copy (кнопка копирования); длинные (счёт/
  // IBAN) не ломают карточку (CSS: word-break/ellipsis). Секретов нет → без «глаза». Если
  // «Название» пусто - заголовок по первому непустому полю (app.applyTitleFallback).
  requisites: [
    { key: 'name', label: 'Название', type: 'text' },
    { key: 'bank', label: 'Банк', type: 'text' },
    { key: 'account', label: 'Расчётный счёт', type: 'copy' },
    { key: 'bik', label: 'БИК', type: 'copy' },
    { key: 'corr', label: 'Корр. счёт', type: 'copy' },
    { key: 'inn', label: 'ИНН / получатель', type: 'copy' },
    { key: 'ogrn', label: 'ОГРН/ОГРНИП', type: 'copy' },
    { key: 'iban', label: 'IBAN', type: 'copy' },
    { key: 'note', label: 'Заметка', type: 'textarea' },
  ],
};

// Дорегистрация в живые core-объекты (мутация содержимого, не переопределение биндинга).
for (const k of Object.keys(EXTRA_LABELS)) UI.SECTION_LABELS[k] = EXTRA_LABELS[k];
for (const k of Object.keys(EXTRA_SCHEMA)) UI.FIELD_SCHEMA[k] = EXTRA_SCHEMA[k];

// Заслон апгрейда: vault, созданный в batch1 (7 разделов), не имеет ключей новых разделов.
// core-store.searchEntries идёт по vault.sections[section] без защиты и упал бы после
// обновления. Дозаполняем недостающие разделы пустыми массивами при открытии сейфа.
// Чистая функция (без DOM) — на ней тест.
export function ensureSections(vault) {
  if (!vault || typeof vault !== 'object') return vault;
  if (!vault.sections || typeof vault.sections !== 'object') vault.sections = {};
  for (const s of SECTIONS) {
    if (!Array.isArray(vault.sections[s])) vault.sections[s] = [];
  }
  return vault;
}
