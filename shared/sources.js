// Источники сведений: шаблоны записей, краткая строка ссылки на архивное дело, сведения и достоверность.
// Общий код телефона (форма, значки) и сервера (проверка, GEDCOM).

// Поля источника. Шифр дела: архив, фонд, опись, дело, лист (и «об.» — оборот листа).
export const SOURCE_FIELDS = ['kind', 'title', 'archive', 'fond', 'opis', 'delo', 'sheet', 'verso', 'url', 'media_id', 'note'];
const ARCHIVE = ['archive', 'fond', 'opis', 'delo', 'sheet'];

// Шаблоны: какие поля показывать и подсказки к ним. title — подсказка к названию.
export const KINDS = {
  metric: { label: 'Метрическая книга', title: 'Например: метрическая книга Троицкой церкви с. Горки, 1912', fields: ARCHIVE },
  revision: { label: 'Ревизская сказка', title: 'Например: ревизская сказка д. Горки, 1858', fields: ARCHIVE },
  confession: { label: 'Исповедная ведомость', title: 'Например: исповедная ведомость Троицкой церкви, 1890', fields: ARCHIVE },
  household: { label: 'Похозяйственная книга', title: 'Например: похозяйственная книга сельсовета, 1947–1949', fields: ARCHIVE },
  zags: { label: 'Документ ЗАГС', title: 'Например: свидетельство о браке или запись акта о рождении', fields: ['archive', 'delo', 'sheet'] },
  military: { label: 'Военный документ', title: 'Например: донесение о потерях, наградной лист, военный билет', fields: [...ARCHIVE, 'url'] },
  pamyat: { label: '«Память народа»', title: 'Например: карточка на сайте pamyat-naroda.ru', fields: ['url', ...ARCHIVE] },
  memorial: { label: '«Мемориал»', title: 'Например: запись в базе obd-memorial.ru', fields: ['url', ...ARCHIVE] },
  legend: { label: 'Семейное предание', title: 'Например: со слов бабушки Клавдии', fields: [] },
  other: { label: 'Другое', title: 'Что это за источник', fields: [...ARCHIVE, 'url'] },
};
export const KIND_KEYS = Object.keys(KINDS);

export const FIELD_LABELS = {
  title: 'Название', archive: 'Архив', fond: 'Фонд', opis: 'Опись', delo: 'Дело', sheet: 'Лист', verso: 'Оборот листа',
  url: 'Ссылка', media_id: 'Скан', note: 'Заметка',
};
export const FIELD_HINTS = {
  archive: 'например: ГАТО', fond: 'например: 160', opis: 'например: 1', delo: 'например: 12', sheet: 'например: 34',
  url: 'https://…',
};

// Краткая строка ссылки на дело: «ГАТО, ф. 160, оп. 1, д. 12, л. 34 об.». Пустая — шифра нет.
export function citeText(s) {
  if (!s) return '';
  const sheet = s.sheet ? `л. ${s.sheet}${s.verso ? ' об.' : ''}` : '';
  return [s.archive, s.fond && `ф. ${s.fond}`, s.opis && `оп. ${s.opis}`, s.delo && `д. ${s.delo}`, sheet].filter(Boolean).join(', ');
}

// Название для списков: своё или по шаблону.
export const sourceTitle = (s) => s?.title || KINDS[s?.kind]?.label || 'Источник';
// Вид источника — подписью к названию, если название его не повторяет («Метрическая книга Троицкой церкви…»).
export function kindNote(s) {
  const label = KINDS[s?.kind]?.label || '';
  const plain = (t) => t.toLowerCase().replace(/[«»"]/g, '');
  return s?.title && !plain(s.title).startsWith(plain(label)) ? label : '';
}

// Сведения, к которым привязываются источники и достоверность. У человека — его поля, у семьи — брак.
// Потом сюда добавятся события хронологии (subject 'event').
export const FACTS = {
  person: {
    name: 'Имя', birth_date: 'Дата рождения', birth_place: 'Место рождения', death_date: 'Дата смерти', death_place: 'Место смерти',
    burial_place: 'Место захоронения', occupation: 'Род занятий', other: 'Другое',
  },
  family: { marriage: 'Брак' },
};
export const factLabel = (subject, fact) => FACTS[subject]?.[fact] || 'Другое';

export const QUALITY = {
  document: { label: 'Подтверждено документом', short: 'документ', quay: 3 },
  oral: { label: 'Со слов', short: 'со слов', quay: 1 },
  guess: { label: 'Предположение', short: 'предположение', quay: 0 },
};
