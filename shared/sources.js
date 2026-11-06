// Источники сведений: шаблоны записей, краткая строка ссылки на архивное дело, сведения и достоверность.
// Общий код телефона (форма, значки) и сервера (проверка, GEDCOM).
import { eventTitle } from './events.js';

// Источник — две ступени. Документ — то, что пишется один раз: метрическая книга Нижнеуфалейского завода за 1913 год,
// её архив, фонд, опись, дело. Страница документа — то, что касается этого человека: лист и оборот, номер записи,
// ссылка, скан и заметка. К сведениям людей привязываются страницы (таблица sources), у одного документа их много.
export const DOC_FIELDS = ['kind', 'title', 'archive', 'fond', 'opis', 'delo', 'note'];
export const SOURCE_FIELDS = ['document_id', 'sheet', 'verso', 'record', 'url', 'media_id', 'note'];
const ARCHIVE = ['archive', 'fond', 'opis', 'delo'];
const SHEET = ['sheet', 'record'];

// Шаблоны: поля документа (fields) и страницы (page), подсказки к ним. title — подсказка к названию документа,
// part — как называть страницу.
export const KINDS = {
  metric: { label: 'Метрическая книга', title: 'Например: метрическая книга Троицкой церкви с. Горки, 1912', fields: ARCHIVE, page: SHEET },
  revision: { label: 'Ревизская сказка', title: 'Например: ревизская сказка д. Горки, 1858', fields: ARCHIVE, page: SHEET },
  confession: { label: 'Исповедная ведомость', title: 'Например: исповедная ведомость Троицкой церкви, 1890', fields: ARCHIVE, page: SHEET },
  household: { label: 'Похозяйственная книга', title: 'Например: похозяйственная книга сельсовета, 1947–1949', fields: ARCHIVE, page: SHEET },
  zags: { label: 'Документ ЗАГС', title: 'Например: книга записей актов о рождении, 1950', fields: ['archive', 'delo'], page: SHEET },
  military: { label: 'Военный документ', title: 'Например: донесение о потерях, наградной лист, военный билет', fields: ARCHIVE, page: [...SHEET, 'url'] },
  pamyat: { label: '«Память народа»', title: 'Например: донесение о безвозвратных потерях 1943 г.', fields: ARCHIVE, page: ['url', ...SHEET] },
  memorial: { label: '«Мемориал»', title: 'Например: донесение о безвозвратных потерях 1943 г.', fields: ARCHIVE, page: ['url', ...SHEET] },
  legend: { label: 'Семейное предание', title: 'Например: со слов бабушки Клавдии', fields: [], page: [], part: 'Запись' },
  other: { label: 'Другое', title: 'Что это за источник', fields: ARCHIVE, page: [...SHEET, 'url'] },
};
export const KIND_KEYS = Object.keys(KINDS);
export const partName = (kind) => KINDS[kind]?.part || 'Страница';

export const FIELD_LABELS = {
  title: 'Название', archive: 'Архив', fond: 'Фонд', opis: 'Опись', delo: 'Дело', sheet: 'Лист', verso: 'Оборот листа',
  record: 'Номер записи', url: 'Ссылка', media_id: 'Скан', note: 'Заметка',
};
export const FIELD_HINTS = {
  archive: 'например: ГАТО', fond: 'например: 160', opis: 'например: 1', delo: 'например: 12', sheet: 'например: 34',
  record: 'например: 57', url: 'https://…',
};

// Шифр дела документа: «ГАТО, ф. 160, оп. 1, д. 12». Пустая — шифра нет.
export function docCite(d) {
  if (!d) return '';
  return [d.archive, d.fond && `ф. ${d.fond}`, d.opis && `оп. ${d.opis}`, d.delo && `д. ${d.delo}`].filter(Boolean).join(', ');
}
// Номер записи: «запись № 57»; написанное словами — как есть.
export const recordText = (r) => (!r ? '' : /^\d/.test(r) ? `запись № ${r}` : r);
// Страница словами: «л. 34 об., запись № 57».
export function pageText(s) {
  if (!s) return '';
  return [s.sheet && `л. ${s.sheet}${s.verso ? ' об.' : ''}`, recordText(s.record)].filter(Boolean).join(', ');
}
// Полная строка ссылки на страницу: «ГАТО, ф. 160, оп. 1, д. 12, л. 34 об.». Номер записи сюда не входит.
export function citeText(s) {
  if (!s) return '';
  const sheet = s.sheet ? `л. ${s.sheet}${s.verso ? ' об.' : ''}` : '';
  return [docCite(s), sheet].filter(Boolean).join(', ');
}

// Название для списков: своё или по шаблону.
export const sourceTitle = (s) => s?.title || KINDS[s?.kind]?.label || 'Источник';
// Вид источника — подписью к названию, если название его не повторяет («Метрическая книга Троицкой церкви…»).
export function kindNote(s) {
  const label = KINDS[s?.kind]?.label || '';
  const plain = (t) => t.toLowerCase().replace(/[«»"]/g, '');
  return s?.title && !plain(s.title).startsWith(plain(label)) ? label : '';
}

// Одинаковые документы: название и шифр без оглядки на регистр, «ё», кавычки, пробелы и точки в конце.
export const plainText = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"„“”']/g, '')
  .replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/[\s,.;:]+$/, '').trim();
export const docKey = (d) => [d.kind, d.title, d.archive, d.fond, d.opis, d.delo].map(plainText).join('|');

// Сведения, к которым привязываются источники и достоверность. У человека — его поля, у семьи — брак,
// у события ленты жизни — само событие.
export const FACTS = {
  person: {
    name: 'Имя', birth_date: 'Дата рождения', birth_place: 'Место рождения', death_date: 'Дата смерти', death_place: 'Место смерти',
    burial_place: 'Место захоронения', occupation: 'Род занятий', other: 'Другое',
  },
  family: { marriage: 'Брак' },
  event: { event: 'Событие' },
};
export const factLabel = (subject, fact) => FACTS[subject]?.[fact] || 'Другое';

export const QUALITY = {
  document: { label: 'Подтверждено документом', short: 'документ', quay: 3 },
  oral: { label: 'Со слов', short: 'со слов', quay: 1 },
  guess: { label: 'Предположение', short: 'предположение', quay: 0 },
};

// Источник одной строкой (карточка в PDF, роспись): «По документу: Метрическая книга…, ГАТО, ф. 160… — дата рождения, брак».
// citations — привязки этого человека (у события — event_kind и event_title).
export function sourceLine(s, citations) {
  const join = (...a) => a.filter(Boolean).join(', ');
  const mine = citations.filter((c) => c.source_id === s.id);
  const facts = [...new Set(mine.map((c) => (c.subject === 'event' ? eventTitle({ kind: c.event_kind, title: c.event_title }) : factLabel(c.subject, c.fact)).toLowerCase()))];
  const pages = [...new Set(mine.map((c) => c.page).filter(Boolean))];
  const what = join(sourceTitle(s), kindNote(s), citeText(s), recordText(s.record), ...pages);
  return `${s.kind === 'legend' ? 'Со слов' : 'По документу'}: ${what}${facts.length ? ` — ${facts.join(', ')}` : ''}`;
}
