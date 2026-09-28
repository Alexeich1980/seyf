// cardtitle.js - заголовок карточки карты, когда первое поле (банк) пустое (mobile-only,
// не core). Раньше карта без банка показывалась как «(без названия)», даже если номер введён.
// Даём осмысленный заголовок: замаскированный номер «Карта •••• 1234» или просто «Карта».
export function cardFallbackTitle(entry) {
  const digits = String((entry && entry.number) || '').replace(/\D+/g, '');
  return digits.length >= 4 ? 'Карта •••• ' + digits.slice(-4) : 'Карта';
}

// Нужен ли фолбэк-заголовок: карта без непустого банка. Номер при этом может быть или нет.
export function needsCardFallbackTitle(entry) {
  const bank = entry && entry.bank;
  return bank == null || String(bank).trim() === '';
}

// Фолбэк-заголовок для Wi-Fi и Реквизитов (v3-4, чистая функция для теста). Если «Название»
// (name) задано - фолбэк не нужен (''), core покажет name. Иначе: Wi-Fi → имя сети (SSID);
// Реквизиты → первое непустое поле из банк/счёт/БИК/корр/ИНН/IBAN. Нет данных → '' (core
// покажет «(без названия)»). Не мутирует entry, DOM не трогает.
export function fallbackTitleFor(section, entry) {
  const e = entry || {};
  if (String(e.name == null ? '' : e.name).trim()) return '';
  if (section === 'wifi') return String(e.ssid == null ? '' : e.ssid).trim();
  if (section === 'requisites') {
    for (const k of ['bank', 'account', 'bik', 'corr', 'inn', 'iban']) {
      const v = String(e[k] == null ? '' : e[k]).trim();
      if (v) return v;
    }
    return '';
  }
  return '';
}
