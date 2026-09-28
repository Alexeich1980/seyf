// seed-networks.js — список сетей для поля «Сеть / тип» раздела Seed-фраз (заход 2 п.17).
// Выпадающий список в гамме приложения (не нативный select). «Другое» — ручной ввод.
// Один источник правды (используется редактором и тестом).
export const SEED_NETWORKS = ['Bitcoin', 'Ethereum', 'TON', 'Tron', 'Solana'];

// Известная ли это сеть из списка (точное совпадение). Иное непустое значение = «Другое».
export function isKnownNetwork(v) {
  return SEED_NETWORKS.includes(String(v == null ? '' : v).trim());
}
