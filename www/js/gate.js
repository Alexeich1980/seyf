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
export const PRO_PRICE_RUB = 990;

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
