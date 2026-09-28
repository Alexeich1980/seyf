// cardicons.js — иконки разделов и записей (mobile-only, НЕ core). Новый плоский векторный
// набор (вариант A, утверждён Алексеем): единый стиль, бирюза + золотой акцент, тёмная деталь
// #0e1719 для контура/тени. БЕЗ белого чипа — глиф сидит прямо на карточке. ОДИН набор на обе
// темы: цвета иконки заданы CSS-переменными, привязанными к самому <svg> (класс .cardicon-svg),
// поэтому в светлой теме, где глобальный --teal перекрашивается в тёмный, иконки остаются
// бирюзовыми (тёмная деталь на мятной заливке читается и на светлой карточке — проверено).
//
// Растровый путь (PNG-лист) ОТКЛЮЧЁН: теперь везде вектор. renderCardIcon(id,size) всегда
// отдаёт inline-SVG. id записи хранится в entry.icon (mobile-поле, ядро не трогаем).
//
// Тело иконки — набор <path>/<rect>/<circle> в кадре 24×24 с собственными заливками (fill),
// использующими var(--teal), var(--gold), var(--teal-deep) и #0e1719. Обёртку <svg> (viewBox
// + класс) накручивает renderCardIcon; никаких общих stroke/fill на <svg> не навязываем.
// Порядок КЛЮЧЕЙ = порядок плиток в пикере (все 31: 10 эталонных + 21 остальных).
export const CARD_ICON_PATHS = {
  // --- 10 эталонных (заданы дословно; seed заменён на криптомонету ₿ по правке Алексея) ---
  key: '<circle cx="8.5" cy="8.5" r="4.7" fill="var(--teal)"/><circle cx="8.5" cy="8.5" r="1.8" fill="none" stroke="#0e1719" stroke-width="1.4" opacity=".55"/><path d="M11.7 11.7 19 19M16 17l2-2M18.4 15.2 20.2 17" stroke="var(--gold)" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
  card: '<rect x="3" y="6" width="18" height="12.5" rx="2.6" fill="var(--teal)"/><rect x="3" y="9" width="18" height="2.4" fill="#0e1719" opacity=".5"/><rect x="6" y="14" width="5" height="2" rx="1" fill="#0e1719" opacity=".45"/><circle cx="17" cy="15" r="1.7" fill="var(--gold)"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3" fill="var(--teal)"/><path d="M14 12h7v4h-7a2 2 0 0 1 0-4z" fill="#0e1719" opacity=".28"/><circle cx="16.5" cy="14" r="1.5" fill="var(--gold)"/>',
  // seed = криптомонета (бирюзовый кружок + золотой знак ₿), НЕ росток.
  seed: '<circle cx="12" cy="12" r="8.6" fill="var(--teal)"/><text x="12" y="16.6" font-size="13" font-weight="800" text-anchor="middle" fill="#0e1719" font-family="system-ui, Arial, sans-serif">₿</text>',
  doc: '<path d="M7 3.2h7l4 4v13.6a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1z" fill="var(--teal)"/><path d="M14 3.2V7h4" fill="#0e1719" opacity=".3"/><path d="M9 12h6M9 15h6" stroke="#0e1719" stroke-width="1.5" opacity=".45" stroke-linecap="round"/><circle cx="16.5" cy="17.5" r="2.4" fill="var(--gold)"/><path d="m15.4 17.5.8.8 1.5-1.6" stroke="#0e1719" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  note: '<rect x="4.5" y="4" width="15" height="16" rx="3" fill="var(--teal)"/><path d="M8 9h8M8 12.5h8M8 16h5" stroke="#0e1719" stroke-width="1.6" opacity=".45" stroke-linecap="round"/><path d="M13 4h4l2.5 2.5V9z" fill="var(--gold)"/>',
  twofa: '<path d="M12 3.2 19 6v5.5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6z" fill="var(--teal)"/><text x="12" y="13.4" font-size="7.5" font-weight="800" text-anchor="middle" fill="#0e1719" opacity=".65" font-family="system-ui">2FA</text><circle cx="12" cy="16.5" r="1.4" fill="var(--gold)"/>',
  user: '<circle cx="12" cy="8.4" r="4" fill="var(--teal)"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0z" fill="var(--teal)"/><circle cx="18.5" cy="7" r="3" fill="var(--gold)"/><path d="M18.5 5.6v2.8M17.1 7h2.8" stroke="#0e1719" stroke-width="1.3" stroke-linecap="round"/>',
  wifi: '<path d="M3.5 9.5C8 5.5 16 5.5 20.5 9.5" stroke="var(--teal)" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M6.5 13C9.5 10.3 14.5 10.3 17.5 13" stroke="var(--teal)" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M9.5 16.3c1.6-1.4 3.4-1.4 5 0" stroke="var(--teal)" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="12" cy="19.3" r="1.8" fill="var(--gold)"/>',
  bank: '<path d="M12 3.5 20.5 8H3.5z" fill="var(--teal)"/><rect x="5" y="9.5" width="2.6" height="7" fill="var(--teal)"/><rect x="10.7" y="9.5" width="2.6" height="7" fill="var(--teal)"/><rect x="16.4" y="9.5" width="2.6" height="7" fill="var(--teal)"/><rect x="3.5" y="18" width="17" height="2.5" rx="1" fill="var(--teal)"/><circle cx="12" cy="6.4" r="1.4" fill="var(--gold)"/>',

  // --- остальные (та же мера: бирюза + один золотой акцент + тёмная деталь) ---
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.6" fill="var(--teal)"/><path d="M3.6 7 12 13l8.4-6" fill="none" stroke="#0e1719" stroke-width="1.7" opacity=".45" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18.5" cy="15.5" r="1.7" fill="var(--gold)"/>',
  chat: '<path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-4 3.2V7a2 2 0 0 1 2-2z" fill="var(--teal)"/><path d="M8 9.5h8M8 12.5h5" stroke="#0e1719" stroke-width="1.6" opacity=".45" stroke-linecap="round"/><circle cx="16.5" cy="12.3" r="1.4" fill="var(--gold)"/>',
  share: '<circle cx="7" cy="12" r="3" fill="var(--teal)"/><circle cx="17" cy="6.5" r="3" fill="var(--teal)"/><circle cx="17" cy="17.5" r="3" fill="var(--gold)"/><path d="M9.5 10.6 14.5 7.7M9.5 13.4 14.5 16.3" stroke="#0e1719" stroke-width="1.6" opacity=".4" stroke-linecap="round"/>',
  cart: '<path d="M3 4.5h2.2l2.3 10.2h9.1l1.9-7.3H6.4" fill="none" stroke="var(--teal)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="18.5" r="1.8" fill="var(--gold)"/><circle cx="16" cy="18.5" r="1.8" fill="var(--gold)"/>',
  guard: '<path d="M12 3.2 19.5 6v5.6c0 4.6-3.1 7.8-7.5 9-4.4-1.2-7.5-4.4-7.5-9V6z" fill="var(--teal)"/><path d="m8.4 12 2.4 2.4 4.8-5" fill="none" stroke="var(--gold)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  work: '<rect x="3" y="7.5" width="18" height="11.5" rx="2.4" fill="var(--teal)"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" fill="none" stroke="#0e1719" stroke-width="1.7" opacity=".5" stroke-linecap="round"/><rect x="10" y="11.5" width="4" height="3" rx="1" fill="var(--gold)"/>',
  cloud: '<path d="M7.5 18.5A4.5 4.5 0 0 1 7 9.6 5.6 5.6 0 0 1 17.6 10.4 3.9 3.9 0 0 1 17 18.5z" fill="var(--teal)"/><path d="M12 11.6v4.2M9.8 13.8 12 16l2.2-2.2" fill="none" stroke="var(--gold)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  media: '<rect x="3" y="5" width="18" height="14" rx="2.6" fill="var(--teal)"/><circle cx="8.5" cy="9.5" r="1.8" fill="var(--gold)"/><path d="M4 17l4.5-4.5 3 3L15 11l5 5.5" fill="none" stroke="#0e1719" stroke-width="1.6" opacity=".45" stroke-linecap="round" stroke-linejoin="round"/>',
  game: '<rect x="2.5" y="7.5" width="19" height="9.5" rx="4.75" fill="var(--teal)"/><path d="M7.5 10.5v3M6 12h3" stroke="#0e1719" stroke-width="1.7" opacity=".5" stroke-linecap="round"/><circle cx="15.5" cy="11.3" r="1.3" fill="var(--gold)"/><circle cx="17.7" cy="13.6" r="1.3" fill="var(--gold)"/>',
  travel: '<path d="M20.5 4 3.5 11.2l6.2 2 2 6.2z" fill="var(--teal)"/><path d="M20.5 4 9.7 13.2" fill="none" stroke="#0e1719" stroke-width="1.5" opacity=".4" stroke-linecap="round"/><path d="M9.7 13.2 11.7 19.4l2.4-5.1z" fill="var(--gold)"/>',
  heart: '<path d="M12 20.3S3.6 15.1 3.6 9.3A4.6 4.6 0 0 1 12 6.6 4.6 4.6 0 0 1 20.4 9.3C20.4 15.1 12 20.3 12 20.3z" fill="var(--teal)"/><path d="M8.8 9.2a2.3 2.3 0 0 1 3.2-1.1" fill="none" stroke="var(--gold)" stroke-width="1.7" stroke-linecap="round"/>',
  edu: '<path d="M12 4 22 8.5 12 13 2 8.5z" fill="var(--teal)"/><path d="M6 10.8v3.4c0 1.6 2.7 2.9 6 2.9s6-1.3 6-2.9v-3.4" fill="none" stroke="#0e1719" stroke-width="1.7" opacity=".45" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 8.7v4.6" stroke="var(--gold)" stroke-width="1.6" stroke-linecap="round"/><circle cx="21" cy="14.2" r="1.3" fill="var(--gold)"/>',
  home: '<path d="M12 3.5 21 11.2 19 11.2 19 19.5 5 19.5 5 11.2 3 11.2z" fill="var(--teal)"/><rect x="10.2" y="13.5" width="3.6" height="6" rx="1" fill="var(--gold)"/>',
  car: '<path d="M3 14l1.6-4.2A3 3 0 0 1 7.4 8h9.2a3 3 0 0 1 2.8 1.8L21 14v3.5a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1V17H6.5v.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill="var(--teal)"/><path d="M5.5 13.5 6.6 10h10.8l1.1 3.5z" fill="#0e1719" opacity=".32"/><circle cx="7.5" cy="16.8" r="1.5" fill="var(--gold)"/><circle cx="16.5" cy="16.8" r="1.5" fill="var(--gold)"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4" fill="var(--teal)"/><path d="M7.7 10.5V7.8a4.3 4.3 0 0 1 8.6 0v2.7" fill="none" stroke="#0e1719" stroke-width="1.9" opacity=".5" stroke-linecap="round"/><circle cx="12" cy="14.4" r="1.7" fill="var(--gold)"/><path d="M12 15.4v2.4" stroke="var(--gold)" stroke-width="1.8" stroke-linecap="round"/>',
  star: '<path d="M12 3.2 14.6 9l6.3.6-4.7 4.2 1.4 6.2L12 16.8 6.4 20l1.4-6.2L3.1 9.6 9.4 9z" fill="var(--teal)"/><circle cx="12" cy="12" r="1.9" fill="var(--gold)"/>',
  safe: '<rect x="3" y="4.5" width="18" height="15" rx="2.6" fill="var(--teal)"/><circle cx="10.5" cy="12" r="3.6" fill="none" stroke="#0e1719" stroke-width="1.7" opacity=".5"/><circle cx="10.5" cy="12" r="1.4" fill="var(--gold)"/><path d="M17 9.5v5" stroke="#0e1719" stroke-width="1.7" opacity=".4" stroke-linecap="round"/>',
  phone: '<rect x="6.5" y="3" width="11" height="18" rx="2.8" fill="var(--teal)"/><rect x="8.3" y="5.5" width="7.4" height="10" rx="1" fill="#0e1719" opacity=".3"/><circle cx="12" cy="18" r="1.3" fill="var(--gold)"/>',
  globe: '<circle cx="12" cy="12" r="8.6" fill="var(--teal)"/><path d="M3.4 12h17.2M12 3.4c2.4 2.3 3.7 5.4 3.7 8.6S14.4 18.3 12 20.6c-2.4-2.3-3.7-5.4-3.7-8.6S9.6 5.7 12 3.4z" fill="none" stroke="#0e1719" stroke-width="1.5" opacity=".45"/><circle cx="15.4" cy="8" r="1.5" fill="var(--gold)"/>',
  gift: '<rect x="4" y="9.5" width="16" height="10.5" rx="2" fill="var(--teal)"/><rect x="3" y="8.3" width="18" height="3.4" rx="1" fill="var(--teal)"/><path d="M12 8.3V20" stroke="var(--gold)" stroke-width="2.2"/><path d="M12 8.3c-1.5-3.5-5.5-3-5 .5M12 8.3c1.5-3.5 5.5-3 5 .5" fill="none" stroke="var(--gold)" stroke-width="1.8" stroke-linecap="round"/>',
  records: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6" fill="var(--teal)"/><path d="M8 9h3.5M13.5 9h3.5M8 12h3.5M13.5 12h3.5M8 15h3.5M13.5 15h3.5" stroke="#0e1719" stroke-width="1.6" opacity=".45" stroke-linecap="round"/><circle cx="6" cy="9" r="1" fill="var(--gold)"/><circle cx="6" cy="12" r="1" fill="var(--gold)"/><circle cx="6" cy="15" r="1" fill="var(--gold)"/>',
};

// Порядок в пикере (первый чип «Авто» = иконка по разделу, добавляется в app.js отдельно).
export const CARD_ICON_IDS = Object.keys(CARD_ICON_PATHS);

// Иконка раздела по умолчанию, когда пользователь не выбрал свою (entry.icon пуст).
const SECTION_DEFAULT = {
  passwords: 'key', cards: 'card', wallets: 'wallet', seed: 'seed',
  documents: 'doc', notes: 'note', totp: 'twofa',
  contacts: 'user', wifi: 'wifi', requisites: 'bank',
};
export function sectionDefaultIcon(section) { return SECTION_DEFAULT[section] || 'lock'; }

// Итоговая иконка записи: выбранная пользователем или дефолт раздела. Всегда валидный id.
export function resolveIconId(entry, section) {
  const id = entry && entry.icon;
  if (id && CARD_ICON_PATHS[id]) return id;
  return sectionDefaultIcon(section);
}

// HTML иконки: inline-SVG. Заливки/акценты заданы внутри тела (var(--teal)/var(--gold)/
// var(--teal-deep)/#0e1719); класс .cardicon-svg фиксирует эти переменные на бирюзу+золото
// в обеих темах (см. app.css). Общих stroke/fill на <svg> не навешиваем.
export function renderCardIcon(id, size = 20) {
  const body = CARD_ICON_PATHS[id] || CARD_ICON_PATHS.lock;
  return '<svg xmlns="http://www.w3.org/2000/svg" class="cardicon-svg" width="' + size +
    '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
}
