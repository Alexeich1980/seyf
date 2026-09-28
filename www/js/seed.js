// seed.js — логика раздела «Seed-фразы» (только мобайл, не входит в общее ядро).
// Отвечает за инварианты раздела: проверку количества слов (12/18/24 — защита от
// потерянного/лишнего слова), проверку каждого слова по офлайн-списку BIP-39 (заход 2 п.16 —
// защита от опечатки/кириллицы) и запоминание свёрнутого баннера-предупреждения.
import { isBip39Word } from './bip39-wordlist.js';

// BIP-39 допускает мнемонику из 12, 15, 18, 21 или 24 слов (спека 8b п.4). Все пять —
// валидны. Расширять/менять список — здесь, в одном месте (используется и в UI, и в проверке).
export const SEED_LENGTHS = [12, 15, 18, 21, 24];

// Разбить введённую фразу на слова: по любым пробелам/переводам строк, без пустых,
// в нижнем регистре (seed-слова регистронезависимы — так не поймаем ложное «не совпало»).
export function parseSeedWords(str) {
  return String(str == null ? '' : str)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

// Проверка количества слов. Принимает массив слов ИЛИ строку. Возвращает
// { valid, count, expected, message } — message непустой и называет число слов, если count неверный.
export function validateSeedPhrase(words) {
  const arr = Array.isArray(words) ? words : parseSeedWords(words);
  const count = arr.length;
  const valid = SEED_LENGTHS.includes(count);
  let message = '';
  if (count === 0) {
    message = 'Введите seed-фразу по словам.';
  } else if (!valid) {
    message = `Сейчас слов: ${count}. Seed-фраза должна содержать 12, 15, 18, 21 или 24 слова - проверьте, не потеряно ли слово и нет ли лишнего.`;
  }
  return { valid, count, expected: SEED_LENGTHS.slice(), message };
}

// Слово seed-фразы валидно, если это ЛАТИНСКОЕ слово из списка BIP-39 без пробелов и иных
// символов (заход 2 п.16). Кириллица/цифры/пробел/мусор → false. Регистр не важен.
export function seedWordValid(word) {
  const w = String(word == null ? '' : word).trim().toLowerCase();
  if (!w) return false;
  if (!/^[a-z]+$/.test(w)) return false;          // латиница, без пробелов/цифр/кириллицы
  return isBip39Word(w);
}

// Заполненные, но невалидные слова: [{index, word}]. Пустые поля не считаем (юзер ещё вводит).
// Принимает массив слов (значения полей) ИЛИ строку. Для подсветки и проверки на сохранении.
export function invalidSeedWords(words) {
  const arr = Array.isArray(words) ? words : parseSeedWords(words);
  const bad = [];
  arr.forEach((w, i) => { const s = String(w == null ? '' : w).trim(); if (s && !seedWordValid(s)) bad.push({ index: i, word: s }); });
  return bad;
}

// Смена длины seed-фразы (12↔24 и т.п.) сама по себе НЕ является правкой записи (заслон
// 18.9): предупреждение о несохранённом при закрытии должно всплывать, только если хотя бы
// одно слово уже введено/правилось. Чистое правило — под тест (а не «на глаз» в app.js).
export function seedLengthChangeIsDirty(filledWordCount) {
  return Number(filledWordCount) > 0;
}

// --- баннер-предупреждение: запоминаем нажатие «Понял, принял», больше не всплывает ---
export const SEED_BANNER_KEY = 'seyf_seed_banner_dismissed';

export function isSeedBannerDismissed(storage) {
  try {
    return !!storage && storage.getItem(SEED_BANNER_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissSeedBanner(storage) {
  try {
    if (storage) storage.setItem(SEED_BANNER_KEY, '1');
  } catch {
    /* хранилище недоступно — не критично, баннер просто покажется снова */
  }
}
