// secvis.js — метаданные разделов для мобильной оболочки (только мобайл, НЕ ядро):
//   1) видимость разделов на витрине (пользователь прячет неиспользуемые) — заслон 18.3;
//   2) есть ли в разделе секретные поля (нужно, чтобы не рисовать «глаз» там, где скрывать
//      нечего) — заслон 18.14.
// Логика чистая и тестируемая: storage и схема инъектируются, DOM тут нет.

// Ключ хранения скрытых разделов. Значение — JSON-массив id разделов.
export const HIDDEN_SECTIONS_KEY = 'seyf_hidden_sections';

// Прочитать множество скрытых разделов из storage (битое/пустое → пусто, не падаем).
export function getHiddenSections(storage) {
  try {
    const raw = storage && storage.getItem(HIDDEN_SECTIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// Сохранить множество скрытых разделов (тихо, storage может быть недоступен).
export function setHiddenSections(storage, hidden) {
  try {
    const arr = Array.isArray(hidden) ? hidden.filter((s) => typeof s === 'string') : [];
    if (storage) storage.setItem(HIDDEN_SECTIONS_KEY, JSON.stringify(arr));
    return arr;
  } catch {
    return Array.isArray(hidden) ? hidden.slice() : [];
  }
}

export function isSectionHidden(storage, section) {
  return getHiddenSections(storage).includes(section);
}

// Переключить видимость одного раздела, вернуть новое множество скрытых.
// Заслон: нельзя спрятать ВСЕ разделы (иначе витрина пустая). Пытаемся спрятать
// последний видимый → не прячем, возвращаем прежнее множество (UI покажет отказ).
export function toggleSectionHidden(storage, allSections, section) {
  const hidden = getHiddenSections(storage);
  const idx = hidden.indexOf(section);
  if (idx >= 0) {
    hidden.splice(idx, 1);                         // показать снова — всегда можно
    return setHiddenSections(storage, hidden);
  }
  const visibleLeft = allSections.filter((s) => !hidden.includes(s)).length;
  if (visibleLeft <= 1) return hidden.slice();      // это последний видимый — не прячем
  hidden.push(section);
  return setHiddenSections(storage, hidden);
}

// Разделы, которые показываем на витрине (порядок исходного списка сохраняется).
export function visibleSections(allSections, storage) {
  const hidden = getHiddenSections(storage);
  const vis = allSections.filter((s) => !hidden.includes(s));
  return vis.length ? vis : allSections.slice();     // страховка: пусто быть не должно
}

// Есть ли в разделе секретные поля: по схеме (type === 'secret') ИЛИ произвольное поле,
// помеченное «секрет» и непустое, хотя бы у одной записи. schema = FIELD_SCHEMA[section].
export function sectionHasSecrets(schema, entries) {
  const bySchema = Array.isArray(schema) && schema.some((f) => f && f.type === 'secret');
  if (bySchema) return true;
  return Array.isArray(entries) && entries.some((e) =>
    Array.isArray(e && e.customFields) && e.customFields.some((c) => c && c.secret && c.value));
}
