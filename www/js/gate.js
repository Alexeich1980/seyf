// gate.js — free-гейт мобильного «Сейфа». НЕ core (мобильная монетизация; десктоп её не имеет),
// поэтому под core-drift не попадает. Здесь ЕДИНАЯ таблица лимитов бесплатной версии: все числа
// в одном месте, правятся одной строкой. Логика чистая — на ней держатся тесты (границы + мутация).
//
// Модель Pro-флага: покупка отмечается ВНУТРИ зашифрованного vault (vault.pro), а не в localStorage.
// Vault целиком шифруется AES-256-GCM ключом DEK; GCM-тег аутентифицирует каждое поле, включая pro.
// Правкой .dat/localStorage БЕЗ мастер-пароля флаг не подделать: тег не сойдётся, файл отвергнут.
// Честно (ревью 1.3.0, п.1b): владелец, знающий свой мастер-пароль, может расшифровать СВОЮ копию,
// вписать pro и зашифровать обратно - криптография этому не мешает. Поэтому isPro дополнительно
// проверяет ИСТОЧНИК отметки: в боевой сборке признаются только 'rustore' (покупка через RuStore
// Pay) и 'license' (подписанный ключ). Отметка тест-мока ('mock') или любая другая - не Pro, в том
// числе в уже подделанных копиях (напр. .dat из браузерного мока старой сборки).

// Лимиты бесплатной версии по разделам (задание п.24). Pro снимает их все (безлимит). Раздел
// без записи здесь считается безлимитным (не блокируем то, для чего лимит не задан). Лимит 0
// (избранные контакты, важные реквизиты) = в FREE раздел закрыт для СОЗДАНИЯ полностью: даже
// первая запись ведёт в окно Pro. УЖЕ созданные записи (импорт/бывший Pro) доступны всегда —
// гейт стоит только на добавлении новой (см. canAdd + перехват в app.openEditor).
export const FREE_LIMITS = {
  passwords: 7,
  cards: 3,
  documents: 3,
  wallets: 3,
  notes: 3,
  wifi: 3,
  totp: 1,
  seed: 1,
  contacts: 0,
  requisites: 0,
};

// Цена полной версии (разовая покупка через RuStore Pay). Одно место для UI и текстов.
// Обычная цена: с ней сравнивается цена из магазина, она же зачёркнута в период акции.
export const PRO_PRICE_RUB = 990;

// Акция (решение Алексея 22.10.2026): полная версия 690 ₽ вместо 990 ₽ до 31 декабря 2026
// включительно, по локальной дате телефона. Цену товара в Консоли RuStore Алексей ставит 690 в
// день выхода 1.3.3 и возвращает 990 1 января 2027. Показываем ФАКТИЧЕСКУЮ цену магазина:
// PROMO_PRICE_RUB - только запасная, когда магазин цену не отдал (нет сети/RuStore) в период
// акции. После PROMO_END слово «акция» не показываем, даже если в магазине ещё старая цена.
export const PROMO_PRICE_RUB = 690;
export const PROMO_END = Object.freeze({ year: 2026, month: 12, day: 31 });   // последний день, включительно

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
  'сентября', 'октября', 'ноября', 'декабря'];
const NBSP = '\u00a0';

// Идёт ли акция в эту локальную дату (время суток не важно: весь последний день - акция).
export function promoActive(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return false;
  const a = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const b = PROMO_END.year * 10000 + PROMO_END.month * 100 + PROMO_END.day;
  return a <= b;
}

// «990 ₽» с неразрывными пробелами (разряды и перед ₽).
export function rub(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) + NBSP + '₽';
}

// Подпись акции: «Акция до 31 декабря» (из PROMO_END, не отдельной строкой-копией).
export function promoNote() {
  return 'Акция до ' + PROMO_END.day + NBSP + MONTHS_GEN[PROMO_END.month - 1];
}

// Что показать на месте цены. storeRub - цена из магазина в рублях (число) или null (не пришла).
// → { price: число, old: число|null (зачёркнутая обычная), promo: bool }
//   магазин дешевле обычной и акция идёт → старая зачёркнута, новая из магазина, «акция»;
//   магазин = обычной или акция прошла → обычный вид, цена магазина;
//   магазина нет: в акцию - PROMO_PRICE_RUB с пометкой акции, после - PRO_PRICE_RUB.
export function priceView(storeRub, now = new Date()) {
  const active = promoActive(now);
  const has = typeof storeRub === 'number' && Number.isFinite(storeRub) && storeRub > 0;
  if (!has) return active
    ? { price: PROMO_PRICE_RUB, old: PRO_PRICE_RUB, promo: true }
    : { price: PRO_PRICE_RUB, old: null, promo: false };
  const promo = active && storeRub < PRO_PRICE_RUB;
  return { price: storeRub, old: promo ? PRO_PRICE_RUB : null, promo };
}

// Подписи цены для экрана (окно «Полная версия», меню). storeRub - число из магазина (pay.js
// priceRub) или null, storeText - та же цена в виде «690 ₽» (pay.js formatPrice) или null.
// → { now: «690 ₽», old: «990 ₽»|null (зачеркнуть), note: «Акция до 31 декабря»|null }.
// Цена магазина в незнакомом виде (не рубли) - показываем как пришла, без акции.
export function priceDisplay(storeRub, storeText, now = new Date()) {
  const has = typeof storeRub === 'number' && Number.isFinite(storeRub) && storeRub > 0;
  if (!has && storeText) return { now: String(storeText), old: null, note: null };
  const v = priceView(has ? storeRub : null, now);
  return {
    now: has && storeText ? String(storeText) : rub(v.price),
    old: v.old ? rub(v.old) : null,
    note: v.promo ? promoNote() : null,
  };
}

// Источники отметки Pro, которые признаёт боевая (не FULL) сборка. Одно место.
export const PRO_SOURCES = Object.freeze(['rustore', 'license']);

// Куплена ли полная версия. Строгая проверка: только объект с purchased === true.
// Любые «похожие» значения (строка 'PRO', purchased:'true'/1, голый true) - НЕ Pro.
// Источник: без opts.anySource (боевая сборка) признаются только PRO_SOURCES ('rustore'/'license');
// anySource=true передаёт только тест-сборка (Access.FULL), где mock-покупка законна.
export function isPro(vault, opts = {}) {
  if (!(vault && vault.pro && vault.pro.purchased === true)) return false;
  if (opts && opts.anySource === true) return true;
  return PRO_SOURCES.includes(vault.pro.source);
}

// Можно ли добавить новую запись в раздел. Возвращает {allowed, limit, used}.
// Pro → всегда можно (limit:Infinity). Иначе сравнение с лимитом на границе used==limit.
export function canAdd(vault, section, isProFlag) {
  const used = ((vault && vault.sections && vault.sections[section]) || []).length;
  if (isProFlag) return { allowed: true, limit: Infinity, used };
  const hasLimit = Object.prototype.hasOwnProperty.call(FREE_LIMITS, section);
  const limit = hasLimit ? FREE_LIMITS[section] : Infinity;
  const atLimit = used >= limit;            // достигли/превысили лимит — добавление закрыто
  return { allowed: !atLimit, limit, used };
}

// Отметить полную версию купленной. Пишет в vault.pro; сохранение и шифрование — снаружи
// (saveFile перешифрует vault под DEK, флаг попадает под GCM-тег).
export function markPro(vault, info = {}) {
  vault.pro = {
    purchased: true,
    source: info.source || 'rustore',
    purchaseId: info.purchaseId || null,
    at: new Date().toISOString(),
  };
  return vault;
}
