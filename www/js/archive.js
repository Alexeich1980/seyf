// archive.js - «Архив для близких» (1.3.3, утверждено Алексеем 27.10.2026). Чистая часть без DOM:
// схема разделов, тексты (docs/teksty-arhiv-faq-draft.md, дословно), хранение в vault.archive с миграцией,
// сборка листа без секретов (вариант 1), полная модель для зашифрованного файла (вариант 2), шифрование
// файла (PBKDF2-SHA256 + AES-GCM через WebCrypto - тот же, что открывает файл в браузере доверенного),
// проверка пароля файла, своё окно даты (сетка месяца), напоминание раз в полгода.
// БЕСПЛАТНО в любой версии и без лимитов (Алексей 27.10): ни гейта, ни счётчиков тут нет (заслон -
// tests/archive-133.test.mjs). Окна рисует js/archive-ui.js.
//
// Хранение: vault.archive внутри зашифрованного сейфа (как записи разделов; шифруется тем же DEK,
// попадает в резервную копию .dat). Старые хранилища без archive открываются как раньше:
// normalizeArchive дозаполняет пустой архив, остальное в vault не трогает.

import { estimateStrength } from './generator.js';

export const ARCHIVE_V = 1;
const NBSP = '\u00a0';

// ---------- тексты (утверждены Алексеем 27.10.2026) ----------
export const ARCHIVE_TITLE = 'Архив для близких';
export const ARCHIVE_INTRO = 'Внимание! Если о вашем вкладе, брокерском счёте, активах или долгах не знает никто из родных, они не смогут вступить в наследство: по закону на это есть 6 месяцев, и искать наследников никто не будет. Соберите здесь, где что лежит и к кому обращаться, и передайте доступ одному-двум доверенным людям. Доступны 2 варианта:';
export const ARCHIVE_LOCAL_NOTE = 'Архив хранится только на вашем устройстве и никуда не отправляется - в интернет он попадёт, только если вы сами его кому-то отправите.';
export const ISSUE_SHEET = Object.freeze({
  title: 'Только основная информация',
  text: 'Лист без логинов, паролей, ПИН-кодов и номеров карт: что у вас есть, где документы и кому звонить. Можно распечатать и положить в конверт или сохранить PDF.',
});
export const ISSUE_FULL = Object.freeze({
  title: 'Основная информация + логины и пароли',
  text: 'То же плюс логины, пароли, номера карт и ПИН-коды. Сохраняется файлом под паролем. Файл и пароль передайте разными путями: например, файл на флешке, пароль на бумаге при встрече. Деньги со счетов наследники получают через нотариуса: пароль от банка помогает найти счета, но не даёт права ими распоряжаться.',
});
export const FILE_PW = Object.freeze({
  title: 'Пароль для файла',
  label: 'Пароль для файла',
  placeholder: 'Не мастер-пароль Сейфа',
  label2: 'Повторите пароль',
  hint: 'Этот пароль вы отдадите доверенному лицу, поэтому не используйте для него мастер-пароль Сейфа. Запишите его на бумаге и передайте отдельно от файла.',
  opens: 'Сейф сохранит архив файлом под паролем: без пароля его никто не прочитает. Доверенный человек откроет файл в любом браузере, ставить Сейф ему не нужно.',
  more: 'Что будет в файле и как его передать',
  button: 'Сохранить файл',
  done: 'Файл сохранён. Пароль к нему передайте отдельно.',
});
// Подписи галочек (Алексей «ок» 27.10.2026, ревью 1.3.3 М3): что именно уйдёт в лист, а что только в файл.
export const PICK_CAPTION = 'В лист для печати попадут названия и банки, без номеров и паролей. Пароли и номера - только в файл под паролем.';
export const ACCOUNTS_CAPTION = 'В лист - только название сайта. Логин и пароль - только в файл под паролем.';
// Решил сам (ревью М3/М4): для документов, контактов, кодов 2FA и Wi-Fi - что из них в листе.
export const DOCS_CAPTION = 'В лист - только название документа. Номер и даты - только в файл под паролем.';
export const CONTACTS_CAPTION = 'В лист попадут имя, телефон и почта. Ссылки и заметки - только в файл под паролем.';
export const SOURCE_CAPTIONS = Object.freeze({
  totp: 'В лист - только название. Секретный ключ - только в файл под паролем.',
  wifi: 'В лист - только название. Имя сети и пароль - только в файл под паролем.',
});
export function pickCaption(sectionId) {
  return { money: PICK_CAPTION, documents: DOCS_CAPTION, contacts: CONTACTS_CAPTION, accounts: ACCOUNTS_CAPTION }[sectionId] || '';
}
export const ADD_MANUAL = '+ Добавить вручную';
export const CLOSED_NOTE = 'В бесплатной версии этот раздел сейфа закрыт. Впишите нужное прямо сюда, кнопкой «Добавить вручную».';
// Подписи первого экрана и служебные строки (проход «новичок» 27.10.2026; не из утверждённых текстов).
// Карточки выдачи: что получится (лист / файл), чтобы до нажатия было видно разницу.
export const ISSUE_SHEET_SUB = 'лист без паролей: печать или PDF';
export const ISSUE_FULL_SUB = 'файл под паролем для доверенного человека';
export const SECTIONS_HEAD = 'Что записать в архив';
// Пустой архив: человек сначала жмёт кнопку выдачи (они выше разделов) - ведём к разделам.
export const START_HINT = 'Начните отсюда: откройте раздел и впишите, что знаете. Потом вернитесь к кнопкам выше.';
export const EMPTY_ALERT = 'Архив пока пуст. Сначала впишите что-нибудь в разделы: они ниже, под кнопками.';
// После сохранения файла - имя файла, чтобы его было легко найти и передать.
export function fileSavedText(name) { return 'Файл «' + name + '» сохранён. Пароль к нему передайте отдельно.'; }
export const REMIND = Object.freeze({
  title: 'Архив для близких',
  text: 'Полгода прошло. Что-то поменялось: новый вклад, закрытый кредит, другой телефон у нотариуса? Обновите архив и, если нужно, передайте новую версию.',
  open: 'Открыть архив',
  later: 'Позже',
});
export const SHEET = Object.freeze({
  leadSheet: 'Здесь записано, что у меня есть, какие долги и к кому обращаться. Паролей здесь нет.',
  leadFull: 'Здесь записано, что у меня есть, какие долги и к кому обращаться, а также логины и пароли.',
  lead2: 'Начните с раздела «Кому звонить». С документами идите к нотариусу: на вступление в наследство по закону 6 месяцев.',
});

// ---------- схема разделов (поля, подсказки, источники-галочки) ----------
// type: text | area | choice | multi | date. Подписи и заглушки - из утверждённых текстов.
// multi (замечание Алексея З1, 27.10.2026): несколько вариантов сразу (в одном банке вклад + счёт + брокерский;
// один полис - жизнь + здоровье). Хранится списком строк; старое одиночное значение - список из одного.
// replace (З3): снятый вариант при чтении заменяется на его состав («несчастный случай» -> жизнь + здоровье).
const f = (key, label, placeholder, extra = {}) => ({ key, label, placeholder: placeholder || '', type: 'text', ...extra });
const choice = (key, label, options) => ({ key, label, placeholder: '', type: 'choice', options });
const multi = (key, label, options, replace) => ({ key, label, placeholder: '', type: 'multi', options, ...(replace ? { replace } : {}) });

export const ARCHIVE_SECTIONS = Object.freeze([
  {
    id: 'money', title: 'Деньги',
    hint: 'Финансовые компании не станут искать ваших родных, если с вами что-то случится. Запишите, где лежат деньги, активы, а также необходимые контактные данные.',
    sources: ['cards', 'requisites', 'wallets', 'seed'],
    sourceCaption: 'Из сейфа: карты, реквизиты, электронные кошельки, seed-фразы',
    fields: [
      f('company', 'Банк или компания', 'Банк, брокер, биржа'),
      multi('what', 'Что там', ['вклад', 'счёт', 'брокерский счёт', 'ИИС', 'зарубежный счёт', 'криптовалюта', 'банковская ячейка', 'наличные', 'другое']),
      f('amount', 'Примерная сумма (необязательно)', 'Например, около 500' + NBSP + '000' + NBSP + '₽'),
      f('contract', 'Где договор', 'Например, папка «Банк» в шкафу или приложение банка'),
      f('manager', 'Контакт менеджера', 'Имя и телефон'),
      f('note', 'Заметка', 'Например, ключ от ячейки в верхнем ящике стола', { type: 'area' }),
    ],
  },
  {
    id: 'documents', title: 'Документы',
    hint: 'Нотариусу и банку понадобятся оригиналы. Запишите, где они хранятся, чтобы облегчить родным поиски.',
    sources: ['documents'],
    sourceCaption: 'Из раздела «Документы»: только названия, без сканов',
    fields: [
      f('doc', 'Документ', 'Например, свидетельство о собственности на квартиру'),
      f('original', 'Где оригинал', 'Например, синяя папка в шкафу в спальне'),
      f('copy', 'Где копия (необязательно)', 'Например, скан в Сейфе, копия у сестры'),
    ],
  },
  {
    id: 'contacts', title: 'Кому звонить',
    hint: 'Кто в курсе ваших дел и поможет родным в первые недели: нотариус, юрист, финансовый консультант, бухгалтер, друг.',
    sources: ['contacts'],
    sourceCaption: 'Из «Избранных контактов»',
    fields: [
      f('who', 'Кто это', 'Например, нотариус, бухгалтер, брат'),
      f('name', 'Имя', 'Как зовут'),
      f('phone', 'Телефон', '+7', { inputmode: 'tel' }),
      f('help', 'Чем поможет', 'Например, ведёт мои налоги и знает всё про ИП'),
    ],
  },
  {
    id: 'insurance', title: 'Страховки',
    hint: 'Если есть полис страхования жизни или от несчастного случая, родным может полагаться выплата. Получить её они смогут, только если узнают о полисе.',
    fields: [
      f('company', 'Страховая компания', 'Название'),
      multi('what', 'Что застраховано', ['жизнь', 'здоровье', 'квартира', 'машина', 'другое'],
        { 'несчастный случай': ['жизнь', 'здоровье'] }),
      f('policy', 'Номер полиса', 'Как в договоре'),
      f('beneficiary', 'Кто получает выплату', 'Например, жена и дети'),
      { key: 'until', label: 'Действует до', placeholder: 'Выбрать дату', type: 'date' },
      f('where', 'Где полис', 'Например, папка «Страховки», почта'),
    ],
  },
  {
    id: 'debts', title: 'Долги',
    hint: 'Кредит не ждёт: пока родные разбираются, набегают пени. А о деньгах, которые должны вам, кроме вас никто не знает.',
    kinds: [
      {
        id: 'mine', label: 'Мои долги',
        fields: [
          f('to', 'Кому', 'Например, банк, кредитная карта, заём у знакомого'),
          f('left', 'Сколько осталось', 'Например, 1' + NBSP + '200' + NBSP + '000' + NBSP + '₽'),
          f('pay', 'Платёж и срок', 'Например, 25' + NBSP + '000' + NBSP + '₽ до 15-го числа'),
          choice('insured', 'Кредит застрахован?', ['да', 'нет', 'не знаю']),
          f('contract', 'Где договор', 'Например, приложение банка, папка «Кредит»'),
        ],
      },
      {
        id: 'owed', label: 'Мне должны',
        fields: [
          f('who', 'Кто должен', 'Имя и телефон'),
          f('sum', 'Сколько', 'Например, 150' + NBSP + '000' + NBSP + '₽'),
          f('proof', 'Чем подтверждено', 'Например, расписка в папке «Документы» или перевод с карты'),
          f('when', 'Когда обещал вернуть', 'Например, до лета'),
        ],
      },
    ],
  },
  {
    id: 'property', title: 'Недвижимость и автомобиль',
    hint: 'Что оформлено на вас и где хранятся документы. Если сдаёте квартиру, кто арендатор и как с ним связаться.',
    fields: [
      choice('what', 'Что это', ['квартира', 'дом', 'дача', 'земля', 'гараж', 'машина', 'другое']),
      f('address', 'Адрес или марка', 'Например, СПб, ул. Садовая, 10, кв. 5'),
      f('share', 'Чья доля', 'Например, вся моя или половина с женой'),
      f('docs', 'Где документы', 'Например, папка «Квартира»'),
      f('keys', 'Где ключи', 'Например, запасные у мамы'),
      f('tenant', 'Арендатор (если сдаётся)', 'Имя, телефон, когда платит'),
    ],
  },
  {
    id: 'payments', title: 'Регулярные платежи',
    hint: 'Квартплату и налоги нужно платить дальше, чтобы не копились долги. Подписки - отключить, чтобы не списывались зря.',
    fields: [
      f('what', 'За что', 'Например, квартплата, интернет, онлайн-кино'),
      f('sum', 'Сколько и когда', 'Например, 6' + NBSP + '500' + NBSP + '₽ до 10-го числа'),
      f('from', 'Откуда списывается', 'Например, автоплатёж с карты'),
      choice('action', 'Что сделать', ['продолжать', 'отключить']),
    ],
  },
  {
    id: 'accounts', title: 'Аккаунты',
    hint: 'Что делать с почтой и страницами в соцсетях: закрыть, оставить на память или передать.',
    sources: ['passwords', 'totp', 'wifi'],
    sourceCaption: 'Из сейфа: пароли, коды 2FA, пароли Wi-Fi',
    fields: [
      f('account', 'Аккаунт', 'Например, почта, ВКонтакте, облако с фото'),
      choice('action', 'Что сделать', ['закрыть', 'оставить на память', 'передать', 'пусть решат сами']),
      f('note', 'Заметка', 'Например, на эту почту приходят письма из банка, не удалять первые полгода', { type: 'area' }),
    ],
  },
  {
    id: 'wishes', title: 'Пожелания', single: true,
    hint: 'Всё, что хочется сказать близким, кроме денег: питомцы, кому что отдать на память, важные просьбы. Это не завещание, а ваши слова для семьи.',
    fields: [
      choice('will', 'Завещание', ['есть', 'нет']),
      f('willWhere', 'Где завещание (если есть)', 'Например, у нотариуса Ивановой, копия в папке «Документы»'),
      f('wishes', 'Пожелания', 'Например, кота Барсика забирает сестра', { type: 'area' }),
    ],
    notes: { will: 'Завещание нужно, только если вас не устраивает, как имущество разделится по закону.' },
  },
]);

export const SECTION_IDS = ARCHIVE_SECTIONS.map((s) => s.id);
export function sectionById(id) { return ARCHIVE_SECTIONS.find((s) => s.id === id) || null; }
// Поля записи с учётом вида (Долги: «Мои долги» / «Мне должны»).
export function fieldsFor(sec, kind) {
  if (!sec) return [];
  if (sec.kinds) { const k = sec.kinds.find((x) => x.id === kind) || sec.kinds[0]; return k.fields; }
  return sec.fields || [];
}

// Источники-галочки: разделы сейфа, откуда можно отметить записи.
// М4 (ревью 1.3.3): коды 2FA и пароли Wi-Fi - в лист только названия, секреты - только в файл.
export const PICK_SOURCES = ['cards', 'requisites', 'wallets', 'seed', 'documents', 'contacts', 'passwords', 'totp', 'wifi'];
const SOURCE_LABELS = {
  cards: 'Карты', requisites: 'Важные реквизиты', wallets: 'Электронные кошельки', seed: 'Seed-фразы',
  documents: 'Документы', contacts: 'Избранные контакты', passwords: 'Пароли', totp: 'Коды 2FA', wifi: 'Пароли Wi-Fi',
};
export function sourceLabel(src) { return SOURCE_LABELS[src] || src; }

// ---------- хранение и миграция ----------
export function emptyArchive() {
  return {
    v: ARCHIVE_V,
    items: Object.fromEntries(SECTION_IDS.filter((id) => !sectionById(id).single).map((id) => [id, []])),
    wishes: {},
    picks: Object.fromEntries(PICK_SOURCES.map((s) => [s, []])),
    owner: '',
    updatedAt: null,
  };
}

const MAX_VAL = 4000;
// Значение поля «несколько вариантов» -> список: строка (старое одиночное значение) - список из одного,
// снятый вариант - его замена (fd.replace), без пустых и повторов, в порядке списка вариантов
// (неизвестные - в конце, как были: вдруг новая версия).
export function multiValues(fd, v) {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' ? [v] : []);
  const rep = (fd && fd.replace) || {};
  const out = [];
  for (const x of raw) {
    if (typeof x !== 'string' || !x.trim()) continue;
    const s = x.trim().slice(0, 300);
    for (const y of Object.prototype.hasOwnProperty.call(rep, s) ? rep[s] : [s]) if (!out.includes(y)) out.push(y);
  }
  const opts = (fd && fd.options) || [];
  const rank = (s) => { const i = opts.indexOf(s); return i < 0 ? opts.length : i; };
  return out.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((p) => p[0]);
}
// Текст значения для листа, файла и строки списка: несколько вариантов - через запятую.
export function fieldText(fd, v) {
  if (fd && fd.type === 'multi') return multiValues(fd, v).join(', ');
  return typeof v === 'string' ? v : '';
}
function cleanFields(obj, fields) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const fd of fields) {
    const v = obj[fd.key];
    if (fd.type === 'multi') { const list = multiValues(fd, v); if (list.length) out[fd.key] = list; continue; }
    if (typeof v === 'string' && v.trim()) out[fd.key] = v.slice(0, MAX_VAL);
  }
  return out;
}
// Миграция полей записи (З1/З3): поля «несколько вариантов» - к списку; остальные поля и неизвестные
// ключи - как были (ничего не теряем).
function migrateFields(fobj, fields) {
  const out = { ...fobj };
  for (const fd of fields) {
    if (fd.type !== 'multi' || !Object.prototype.hasOwnProperty.call(out, fd.key)) continue;
    const list = multiValues(fd, out[fd.key]);
    if (list.length) out[fd.key] = list; else delete out[fd.key];
  }
  return out;
}
function newId() {
  try { return globalThis.crypto.randomUUID(); } catch (e) { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2); }
}

// Привести архив к текущей схеме. Нет архива (старое хранилище) - пустой. Битые/чужие значения
// отбрасываются поштучно, остальное сохраняется: неизвестное поле записи не теряем (вдруг новая версия).
export function normalizeArchive(a) {
  const base = emptyArchive();
  if (!a || typeof a !== 'object' || Array.isArray(a)) return base;
  const out = { ...a, v: Math.max(ARCHIVE_V, Number(a.v) || ARCHIVE_V), items: { ...base.items }, picks: { ...base.picks } };
  const items = (a.items && typeof a.items === 'object') ? a.items : {};
  for (const id of Object.keys(base.items)) {
    const list = Array.isArray(items[id]) ? items[id] : [];
    const sec = sectionById(id);
    out.items[id] = list
      .filter((it) => it && typeof it === 'object' && it.f && typeof it.f === 'object')
      .map((it) => ({ ...it, id: typeof it.id === 'string' && it.id ? it.id : newId(), f: migrateFields(it.f, fieldsFor(sec, it.kind)) }));
  }
  out.wishes = (a.wishes && typeof a.wishes === 'object' && !Array.isArray(a.wishes)) ? { ...a.wishes } : {};
  const picks = (a.picks && typeof a.picks === 'object') ? a.picks : {};
  for (const s of PICK_SOURCES) {
    out.picks[s] = Array.isArray(picks[s]) ? [...new Set(picks[s].filter((x) => typeof x === 'string' && x))] : [];
  }
  out.owner = typeof a.owner === 'string' ? a.owner.slice(0, 120) : '';
  out.updatedAt = typeof a.updatedAt === 'string' ? a.updatedAt : null;
  return out;
}
// Дозаполнить архив в открытом хранилище (старые сейфы, свежая копия .dat). Остальной vault не трогаем.
export function ensureArchive(vault) {
  if (!vault || typeof vault !== 'object') return vault;
  vault.archive = normalizeArchive(vault.archive);
  return vault;
}

export function touch(archive, now = new Date()) { archive.updatedAt = new Date(now).toISOString(); return archive; }

// Записи (без лимитов: архив бесплатный в любой версии).
export function addItem(archive, sectionId, fields, kind) {
  const sec = sectionById(sectionId);
  if (!sec || sec.single) return null;
  const item = { id: newId(), f: cleanFields(fields, fieldsFor(sec, kind)) };
  if (sec.kinds) item.kind = (sec.kinds.find((k) => k.id === kind) || sec.kinds[0]).id;
  archive.items[sectionId].push(item);
  return item;
}
export function updateItem(archive, sectionId, id, fields) {
  const sec = sectionById(sectionId);
  const it = sec && !sec.single ? archive.items[sectionId].find((x) => x.id === id) : null;
  if (!it) return null;
  it.f = cleanFields(fields, fieldsFor(sec, it.kind));
  return it;
}
export function removeItem(archive, sectionId, id) {
  const list = archive.items[sectionId];
  if (!Array.isArray(list)) return false;
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}
export function setWishes(archive, fields) {
  archive.wishes = cleanFields(fields, sectionById('wishes').fields);
  return archive.wishes;
}
export function togglePick(archive, source, entryId, on) {
  if (!PICK_SOURCES.includes(source)) return false;
  const list = archive.picks[source];
  const has = list.includes(entryId);
  if (on && !has) list.push(entryId);
  if (!on && has) list.splice(list.indexOf(entryId), 1);
  return on;
}

// Отмеченные записи сейфа, которые ещё существуют (удалённую запись тихо пропускаем).
export function pickedEntries(archive, vault, source) {
  const ids = (archive && archive.picks && archive.picks[source]) || [];
  const list = (vault && vault.sections && vault.sections[source]) || [];
  return list.filter((e) => e && ids.includes(e.id));
}
// Сколько заполнено в разделе архива (для строки на первом экране).
export function sectionCount(archive, vault, sectionId) {
  const sec = sectionById(sectionId);
  if (!sec || !archive) return 0;
  if (sec.single) return Object.keys(archive.wishes || {}).length ? 1 : 0;
  let n = (archive.items[sectionId] || []).length;
  for (const s of sec.sources || []) n += pickedEntries(archive, vault, s).length;
  return n;
}
export function isFilled(archive, vault) {
  return SECTION_IDS.some((id) => sectionCount(archive, vault, id) > 0);
}

// Закрыт ли источник в бесплатной версии (лимит 0 - Реквизиты, Контакты) и пуст: тогда вместо
// галочек строка «впишите вручную». Созданные раньше записи (импорт, бывшая полная версия) отмечать можно.
export function sourceClosed(source, vault, { full, freeLimits }) {
  if (full) return false;
  const limit = freeLimits && Object.prototype.hasOwnProperty.call(freeLimits, source) ? freeLimits[source] : Infinity;
  const has = ((vault && vault.sections && vault.sections[source]) || []).length > 0;
  return limit === 0 && !has;
}

// ---------- что из записи сейфа идёт в лист и в файл ----------
// ЛИСТ (вариант 1): только белый список НЕсекретных полей. Логины, пароли, ПИН, CVV, номера карт и
// кошельков, реквизиты счетов, seed-фразы, ключи 2FA, номера документов и произвольные поля - НИКОГДА.
export const SHEET_FIELDS = Object.freeze({
  cards: ['bank', 'holder'],
  requisites: ['name', 'bank'],
  wallets: ['description', 'url'],
  seed: ['name', 'network'],
  documents: ['description'],
  contacts: ['name', 'phone', 'email'],
  passwords: ['description', 'url'],
  totp: ['name'],
  wifi: ['name'],
});
const PICK_TITLE_FIELD = { cards: 'bank', requisites: 'name', wallets: 'description', seed: 'name', documents: 'description', contacts: 'name', passwords: 'description', totp: 'name', wifi: 'name' };
const PICK_FALLBACK = { cards: 'Карта', requisites: 'Реквизиты', wallets: 'Кошелёк', seed: 'Seed-фраза', documents: 'Документ', contacts: 'Контакт', passwords: 'Аккаунт', totp: 'Код 2FA', wifi: 'Wi-Fi' };
// Ссылка в листе: без логина и пароля внутри адреса (https://user:pass@host -> https://host).
export function stripUserinfo(url) {
  const s = String(url == null ? '' : url).trim();
  return s.replace(/^((?:[a-z][a-z0-9+.-]*:)?\/\/)[^/?#\s]*@/i, '$1').replace(/^[^/?#\s:@]+:[^/?#\s@]*@(?=[^/?#\s@]+)/, '');
}
// Название отмеченной записи (галочка, лист): только несекретное поле.
export function pickTitle(source, entry) {
  const k = PICK_TITLE_FIELD[source];
  const v = entry && typeof entry[k] === 'string' ? entry[k].trim() : '';
  if (source === 'cards') return v ? 'Карта ' + v : 'Карта';
  if (source === 'requisites' && !v && entry && entry.bank) return String(entry.bank);
  if (source === 'wifi' && !v && entry && typeof entry.ssid === 'string' && entry.ssid.trim()) return 'Wi-Fi ' + entry.ssid.trim();
  return v || PICK_FALLBACK[source] || '';
}

function labelOf(schema, source, key) {
  const fd = ((schema && schema[source]) || []).find((x) => x.key === key);
  return fd ? fd.label.replace(/\s*\((ММ\/ГГ|SSID)\)$/, '') : key;
}

function fmtDateRu(d) {
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}

// Модель документа: { title, made, lead[], sections:[{title, rows:[{title, lines:[[label,value]]}]}], footer }.
// full=false - лист без секретов; full=true - всё, в том числе секреты (только для шифрования).
function buildModel(archive, vault, { schema, now = new Date(), full }) {
  const a = normalizeArchive(archive);
  const date = fmtDateRu(new Date(now));
  const owner = (a.owner || '').trim();
  const sections = [];
  for (const sec of ARCHIVE_SECTIONS) {
    const rows = [];
    if (sec.single) {
      const lines = sec.fields.filter((fd) => a.wishes[fd.key]).map((fd) => [fd.label, a.wishes[fd.key]]);
      if (lines.length) rows.push({ title: '', lines });
    } else {
      for (const src of sec.sources || []) {
        for (const e of pickedEntries(a, vault, src)) {
          const keys = full
            ? ((schema && schema[src]) || []).map((x) => x.key).filter((k) => k !== 'passwordChanged')
            : SHEET_FIELDS[src];
          const lines = [];
          for (const k of keys) {
            if (k === PICK_TITLE_FIELD[src]) continue;
            const v = e[k];
            if (typeof v === 'string' && v.trim()) lines.push([labelOf(schema, src, k), !full && k === 'url' ? stripUserinfo(v) : v]);
          }
          if (full) {
            if (src === 'documents' && e.expiry) lines.push(['Действует до', String(e.expiry)]);
            if (src === 'totp') {   // нестандартные параметры кода - иначе ключ на другом телефоне даст не те цифры
              if (e.digits && Number(e.digits) !== 6) lines.push(['Цифр в коде', String(e.digits)]);
              if (e.period && Number(e.period) !== 30) lines.push(['Период, сек', String(e.period)]);
              if (e.algorithm && String(e.algorithm).toUpperCase() !== 'SHA1') lines.push(['Алгоритм', String(e.algorithm)]);
            }
            for (const cf of Array.isArray(e.customFields) ? e.customFields : []) {
              if (cf && typeof cf.value === 'string' && cf.value.trim()) lines.push([String(cf.label || cf.name || 'Поле'), cf.value]);
            }
          }
          rows.push({ title: pickTitle(src, e), from: sourceLabel(src), lines });
        }
      }
      for (const it of a.items[sec.id] || []) {
        const fields = fieldsFor(sec, it.kind);
        const lines = fields.map((fd) => [fd.label, fieldText(fd, it.f[fd.key])]).filter((l) => l[1]);
        if (!lines.length) continue;
        const kind = sec.kinds ? (sec.kinds.find((k) => k.id === it.kind) || sec.kinds[0]).label : '';
        rows.push({ title: kind, lines });
      }
    }
    if (rows.length) sections.push({ title: sec.title, rows });
  }
  return {
    title: ARCHIVE_TITLE,
    made: 'Составлено: ' + date + '.' + (owner ? ' Кто составил: ' + owner + '.' : ''),
    lead: [full ? SHEET.leadFull : SHEET.leadSheet, SHEET.lead2],
    sections,
    footer: 'Сведения на ' + date + '. Если с тех пор что-то поменялось, их может не быть в листе.',
  };
}
export function buildSheetModel(archive, vault, opts = {}) { return buildModel(archive, vault, { ...opts, full: false }); }
export function buildFullModel(archive, vault, opts = {}) { return buildModel(archive, vault, { ...opts, full: true }); }

// ---------- печатный лист (вариант 1): самодостаточный HTML без скриптов и сети ----------
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const SHEET_CSS = 'body{font-family:"Segoe UI",Roboto,Arial,sans-serif;color:#111;margin:0;padding:24px;line-height:1.45;font-size:13pt}'
  + 'h1{font-size:20pt;margin:0 0 4px}.made{color:#444;margin:0 0 12px}.lead{margin:0 0 6px}'
  + 'h2{font-size:14pt;margin:20px 0 6px;padding-bottom:4px;border-bottom:1.5px solid #111;break-after:avoid}'
  + '.row{margin:0 0 10px;padding:6px 0;border-bottom:1px solid #ddd;break-inside:avoid}.rt{font-weight:700}.from{color:#555;font-weight:400}'
  + 'table{border-collapse:collapse;width:100%;table-layout:fixed}td{vertical-align:top;padding:2px 8px 2px 0}td.k{color:#444;width:38%}'
  + 'td.v{white-space:pre-wrap;overflow-wrap:anywhere}.foot{margin-top:24px;color:#444;font-size:11pt}'
  + '@page{size:A4;margin:16mm}@media print{body{padding:0}}';
export function renderSheetHtml(model) {
  const e = escapeHtml;
  let h = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + e(model.title) + '</title><style>' + SHEET_CSS + '</style></head><body>';
  h += '<h1>' + e(model.title) + '</h1><p class="made">' + e(model.made) + '</p>';
  for (const l of model.lead) h += '<p class="lead">' + e(l) + '</p>';
  for (const s of model.sections) {
    h += '<h2>' + e(s.title) + '</h2>';
    for (const r of s.rows) {
      h += '<div class="row">';
      if (r.title) h += '<div class="rt">' + e(r.title) + (r.from ? ' <span class="from">(' + e(r.from) + ')</span>' : '') + '</div>';
      if (r.lines.length) h += '<table>' + r.lines.map(([k, v]) => '<tr><td class="k">' + e(k) + '</td><td class="v">' + e(v) + '</td></tr>').join('') + '</table>';
      h += '</div>';
    }
  }
  h += '<p class="foot">' + e(model.footer) + '</p></body></html>';
  return h;
}

// ---------- пароль файла (вариант 2) ----------
// Ревью 1.3.3 В2: планка - оценка стойкости приложения (generator.estimateStrength, «средний» и выше) плюс
// запрет того, что подбирают первым: популярные слова (password, пароль, qwerty...), ряды клавиатуры и
// алфавита (1234, qwerty, йцукен, абвг), повторы (aaaa, 1111, abab). Такие куски вырезаются, и остаток
// должен быть не короче FILE_PW_CORE знаков. Подсказка ведёт к 3-4 случайным словам (кнопка «Придумать пароль»).
export const FILE_PW_MIN = 10;
export const FILE_PW_CORE = 8;
export const FILE_PW_TIP = 'Нажмите «Придумать пароль» или возьмите 3-4 случайных слова.';
export const FILE_PW_GEN = 'Придумать пароль';
const POPULAR = ['password', 'passw0rd', 'pass', 'qwerty', 'admin', 'letmein', 'welcome', 'iloveyou', 'monkey', 'dragon',
  'football', 'master', 'sunshine', 'princess', 'superman', 'secret', 'login', 'hello', 'qwertz', 'azerty', 'zaq1', 'xsw2',
  'gfhjkm', 'пароль', 'парол', 'привет', 'любовь', 'россия', 'секрет', 'логин', 'админ'];
const KEY_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdefghijklmnopqrstuvwxyz',
  'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', 'абвгдежзийклмнопрстуфхцчшщъыьэюя'];
const ROWS_BOTH = KEY_ROWS.flatMap((r) => [r, [...r].reverse().join('')]);
// Остаток пароля после вырезания предсказуемых кусков (для проверки и для теста).
export function passwordCore(pw) {
  let s = String(pw == null ? '' : pw).normalize('NFC').toLowerCase();
  for (const w of POPULAR) s = s.split(w).join('\u0000');
  // ряды клавиатуры/алфавита (вперёд и назад) от 3 знаков подряд
  let out = '', i = 0;
  while (i < s.length) {
    let best = 1;
    for (const r of ROWS_BOTH) {
      const at = r.indexOf(s[i]);
      if (at < 0) continue;
      let n = 1;
      while (i + n < s.length && r[at + n] === s[i + n]) n++;
      if (n > best) best = n;
    }
    if (best >= 3) { out += '\u0000'; i += best; } else { out += s[i]; i += 1; }
  }
  // повторы кусков 1-4 знака (aaaa, 1111, abab, 123123): оставить одну копию
  out = out.replace(/(.{1,4}?)\1+/g, '$1');
  return out.split('\u0000').join('');
}
export function filePasswordProblem(pw, pw2) {
  const s = String(pw == null ? '' : pw).normalize('NFC');
  if (!s.trim()) return 'Придумайте пароль для файла. ' + FILE_PW_TIP;
  if (s.length < FILE_PW_MIN) return 'Пароль короче ' + FILE_PW_MIN + ' знаков. ' + FILE_PW_TIP;
  if (passwordCore(s).length < FILE_PW_CORE || estimateStrength(s).score < 2) {
    return 'Слишком простой пароль, такие подбирают первыми. ' + FILE_PW_TIP;
  }
  if (s !== String(pw2 == null ? '' : pw2).normalize('NFC')) return 'Пароли не совпадают.';
  return '';
}
// М6 (ревью 1.3.3): «это мастер-пароль?» - снятием обёртки ключа (pwWrap), без расшифровки всего сейфа.
// Функции ядра (crypto.js) приходят параметром: ядро не меняется. Пароль нигде не хранится.
export async function opensVaultKey(file, pw, C) {
  try {
    const kek = await C.deriveKEK(pw, C.unb64(file.kdf.salt), file.kdf.iterations);
    await C.unwrapDEK(kek, C.unb64(file.pwWrap.iv), C.unb64(file.pwWrap.ct));
    return true;
  } catch (e) { return false; }
}
export const FILE_PW_IS_MASTER = 'Это мастер-пароль Сейфа. Для файла придумайте другой пароль.';

// ---------- шифрование файла для доверенного лица ----------
// Формат конверта: {seyfArchive:1, kdf:'PBKDF2-SHA256', it, salt, iv, ct} (base64). Внутри - JSON модели
// (buildFullModel). Тот же алгоритм живёт в VIEWER_CORE (строка ниже) - им файл открывается в браузере.
export const FILE_ITERATIONS = 600000;
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function unb64(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function fileKey(password, salt, it, subtle) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: it, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptPayload(obj, password, { iterations = FILE_ITERATIONS } = {}) {
  const c = globalThis.crypto;
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await fileKey(String(password).normalize('NFC'), salt, iterations, c.subtle);
  const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { seyfArchive: 1, kdf: 'PBKDF2-SHA256', it: iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
export async function decryptPayload(env, password) {
  const c = globalThis.crypto;
  const key = await fileKey(String(password).normalize('NFC'), unb64(env.salt), env.it, c.subtle);
  const pt = await c.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// Код просмотра внутри файла (ES5, без сети, без библиотек). seyfOpen(env, pw) -> Promise<model>
// (неверный пароль - отказ). Рисует только через textContent: содержимое не исполняется.
export const VIEWER_CORE = [
  'function seyfB64(s){var b=atob(s),o=new Uint8Array(b.length);for(var i=0;i<b.length;i++)o[i]=b.charCodeAt(i);return o;}',
  'function seyfOpen(env,pw){var c=(typeof crypto!=="undefined"&&crypto.subtle)?crypto:null;',
  ' if(!c)return Promise.reject(new Error("nocrypto"));pw=String(pw);if(pw.normalize)pw=pw.normalize("NFC");',
  ' return c.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]).then(function(base){',
  '  return c.subtle.deriveKey({name:"PBKDF2",salt:seyfB64(env.salt),iterations:env.it,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);',
  ' }).then(function(key){return c.subtle.decrypt({name:"AES-GCM",iv:seyfB64(env.iv)},key,seyfB64(env.ct));})',
  ' .then(function(pt){return JSON.parse(new TextDecoder().decode(pt));});}',
].join('\n');
// Ревью 1.3.3 М2: если файл открыли там, где скрипты не работают (просмотр в мессенджере, почте) или нет
// расшифровки (crypto.subtle), человек видит, что делать, а не пустую форму.
export const VIEWER_NOJS = 'Здесь файл не открыть. Откройте этот файл в браузере (Chrome, Яндекс Браузер, Safari).';
const VIEWER_UI = [
  'if(!(typeof crypto!=="undefined"&&crypto.subtle&&typeof TextEncoder!=="undefined")){document.getElementById("nocrypto").hidden=false;document.getElementById("pw").disabled=true;document.getElementById("go").disabled=true;}',
  'function seyfEl(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}',
  'function seyfRender(m){var r=document.getElementById("doc");r.textContent="";',
  ' r.appendChild(seyfEl("h1","",m.title));r.appendChild(seyfEl("p","made",m.made));',
  ' m.lead.forEach(function(l){r.appendChild(seyfEl("p","lead",l));});',
  ' m.sections.forEach(function(s){r.appendChild(seyfEl("h2","",s.title));',
  '  s.rows.forEach(function(w){var d=seyfEl("div","row");if(w.title){var t=seyfEl("div","rt",w.title);if(w.from)t.appendChild(seyfEl("span","from"," ("+w.from+")"));d.appendChild(t);}',
  '   var tb=seyfEl("table");w.lines.forEach(function(l){var tr=seyfEl("tr");tr.appendChild(seyfEl("td","k",l[0]));tr.appendChild(seyfEl("td","v",l[1]));tb.appendChild(tr);});d.appendChild(tb);r.appendChild(d);});});',
  ' r.appendChild(seyfEl("p","foot",m.footer));document.getElementById("gate").hidden=true;r.hidden=false;}',
  'document.getElementById("gate").onsubmit=function(ev){ev.preventDefault();var b=document.getElementById("go"),er=document.getElementById("err");',
  ' var env=JSON.parse(document.getElementById("seyf-data").textContent);b.disabled=true;er.textContent="Открываю…";',
  ' seyfOpen(env,document.getElementById("pw").value).then(function(m){document.getElementById("pw").value="";seyfRender(m);},function(e){b.disabled=false;',
  '  er.textContent=(e&&e.message==="nocrypto")?' + JSON.stringify(VIEWER_NOJS) + ':"Пароль не подошёл. Проверьте раскладку и большие буквы.";});};',
].join('\n');
const VIEWER_CSS = SHEET_CSS + '#gate{max-width:420px;margin:12vh auto 0;font-size:12pt}#gate h1{font-size:18pt}'
  + 'input{width:100%;box-sizing:border-box;font-size:14pt;padding:10px;margin:8px 0;border:1px solid #888;border-radius:8px}'
  + 'button{font-size:13pt;padding:10px 18px;border:0;border-radius:8px;background:#0F766E;color:#fff}#err{color:#B00020;min-height:1.4em}[hidden]{display:none!important}'
  + '.nojs{max-width:420px;margin:12vh auto 0;font-size:13pt;padding:14px;border:1.5px solid #B00020;border-radius:8px}#nocrypto{color:#B00020;font-weight:600}';
// Самодостаточный зашифрованный HTML: открывается в любом браузере, сеть закрыта CSP (connect-src не
// разрешён: default-src 'none'), данные - только шифртекст в <script type="application/json">.
export function buildEncryptedHtml(env) {
  const data = JSON.stringify(env).replace(/</g, '\\u003c');
  return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + ARCHIVE_TITLE + '</title><style>' + VIEWER_CSS + '</style></head><body>'
    + '<noscript><style>#gate{display:none!important}</style><div class="nojs"><h1>' + ARCHIVE_TITLE + '</h1><p>' + VIEWER_NOJS + '</p></div></noscript>'
    + '<form id="gate"><h1>' + ARCHIVE_TITLE + '</h1><p>Файл закрыт паролем. Введите пароль, который вам передали отдельно от файла. Пароля нет - спросите у того, кто дал файл.</p>'
    + '<p id="nocrypto" hidden>' + VIEWER_NOJS + '</p>'
    + '<input id="pw" type="password" autocomplete="off" placeholder="Пароль" aria-label="Пароль">'
    + '<button id="go" type="submit">Открыть</button><p id="err" role="alert"></p></form>'
    + '<main id="doc" hidden></main>'
    + '<script type="application/json" id="seyf-data">' + data + '</script>'
    + '<script>' + VIEWER_CORE + '\n' + VIEWER_UI + '</script></body></html>';
}

// ---------- своё окно даты ----------
// ДД.ММ.ГГГГ <-> {y,m(1-12),d}. Сетка месяца с понедельника: массив недель по 7 (null - пустая клетка).
export function parseDate(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d };
}
export function formatDate({ y, m, d }) {
  return String(d).padStart(2, '0') + '.' + String(m).padStart(2, '0') + '.' + y;
}
export function monthGrid(y, m) {
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;          // пн = 0
  const days = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export function shiftMonth(y, m, delta) {
  const t = y * 12 + (m - 1) + delta;
  return { y: Math.floor(t / 12), m: (t % 12 + 12) % 12 + 1 };
}

// ---------- напоминание раз в полгода ----------
// Только если архив заполнен хотя бы частично. Отсчёт от последней правки архива или от «Открыть архив»
// в напоминании; «Позже» (и закрытие фоном/назад) - напомнить через месяц.
export const NUDGE_KEY = 'seyf_archive_nudge';
export const HALF_YEAR_MS = 182 * 864e5;
export const LATER_MS = 30 * 864e5;
export function readNudge(ls) {
  try { const v = JSON.parse((ls && ls.getItem(NUDGE_KEY)) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
export function writeNudge(ls, st) { try { if (ls) ls.setItem(NUDGE_KEY, JSON.stringify(st || {})); } catch (e) {} }
export function archiveDue({ archive, vault, stamp, now = Date.now() }) {
  if (!archive || !isFilled(archive, vault)) return false;
  const st = stamp || {};
  const edited = archive.updatedAt ? Date.parse(archive.updatedAt) : 0;
  const base = Math.max(Number.isFinite(edited) ? edited : 0, Number(st.reviewedAt) || 0);
  if (!base) return false;
  if (now < base + HALF_YEAR_MS) return false;
  if (st.laterUntil && now < Number(st.laterUntil)) return false;
  return true;
}
export function nudgeLater(stamp, now = Date.now()) { return { ...(stamp || {}), laterUntil: now + LATER_MS }; }
export function nudgeReviewed(stamp, now = Date.now()) { return { ...(stamp || {}), reviewedAt: now, laterUntil: 0 }; }
