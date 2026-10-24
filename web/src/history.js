// Подписи к журналу правок без «добавил(а)»: кто сделал, пишется отдельно — «Елена: новое фото у Петра Ивановича».
// Одно действие — несколько строк: первая главная, остальные показываются под «Ещё N изменений».
import { fullName, nameGenitive } from '@shared/names.js';
import { KINDS, QUALITY, factLabel } from '@shared/sources.js';
import { eventTitle } from '@shared/events.js';
import { ANSWER_FILE } from '@shared/research.js';

export const FIELDS = [
  ['surname', 'Фамилия'], ['given', 'Имя'], ['patronymic', 'Отчество'], ['birth_surname', 'Фамилия при рождении'],
  ['birth_date', 'Дата рождения'], ['birth_place', 'Место рождения'], ['death_date', 'Дата смерти'], ['death_place', 'Место смерти'],
  ['burial_place', 'Место захоронения'], ['occupation', 'Род занятий'], ['notes', 'Заметки и воспоминания'],
];
const LABEL = Object.fromEntries([...FIELDS, ['sex', 'Пол'], ['living', 'Жив или умер']]);

// Имя по id: из дерева, а для удалённых — из снимков в самом журнале.
// name(id) — «Смирнов Пётр Иванович», name.gen(ids) — «у кого»: «Петра Ивановича и Клавдии Николаевны», name.sex(id).
export function namer(ops, idx) {
  const snap = new Map();
  for (const op of ops) {
    for (const e of op.entries) {
      const p = e.entity !== 'person' ? null : e.action === 'create' ? e.after : e.action === 'delete' ? e.before?.person : null;
      if (p) snap.set(e.entity_id, p);
    }
  }
  const get = (id) => (idx?.persons.has(id) ? idx.persons.get(id) : snap.get(id));
  const name = (id) => (get(id) ? fullName(get(id)) : 'удалённый человек');
  name.sex = (id) => get(id)?.sex;
  name.gen = (ids) => and([...new Set([ids].flat().filter(Boolean))].map((id) => (get(id) ? nameGenitive(get(id)) : 'удалённого человека')));
  return name;
}
// «А», «А и Б», «А, Б и В».
const and = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}`);
// По полу: «удалён» / «удалена».
const bySex = (sex, m, f) => (sex === 'F' ? f : m);
// « у Петра Ивановича» — если известно, у кого.
const at = (ids, name) => ((ids || []).filter(Boolean).length ? ` у ${name.gen(ids)}` : '');

function personLine(e, name) {
  const n = name(e.entity_id);
  const sex = e.after?.sex || e.before?.person?.sex || name.sex(e.entity_id);
  if (e.action === 'create') return `новый человек в дереве: ${n}`;
  if (e.action === 'delete') return `${bySex(sex, 'удалён', 'удалена')} из дерева: ${n}`;
  if (e.action === 'restore') return `${bySex(sex, 'возвращён', 'возвращена')} в дерево: ${n}`;
  if (e.action === 'photo') return `${e.after?.photo_id ? 'другое фото на карточке' : 'убрано фото с карточки'}${at([e.entity_id], name)}`;
  if (e.action === 'update') return `исправлено${at([e.entity_id], name)}: ${Object.keys(e.after || {}).map((k) => (LABEL[k] || k).toLowerCase()).join(', ')}`;
  return null;
}

const FAMILY_FIELD = { kind: 'вид связи', start_date: 'дата', place: 'место', ended: 'чем закончился', end_date: 'дата развода' };
function familyLine(e, name) {
  const adds = ['set_partner', 'add_child'].includes(e.action);
  const x = adds ? e.after || {} : e.before || {};
  const list = (ids) => ids.map(name).join(', ');
  const couple = (f) => (f?.partner1 && f?.partner2 ? `${name(f.partner1)} и ${name(f.partner2)}` : null);
  switch (e.action) {
    case 'set_partner':
    case 'unset_partner': {
      const id = x.partner1 || x.partner2;
      if (!x.partners) return `${adds ? 'новая связь' : 'убрана связь'}: ${name(id)}`;
      const other = x.partners.filter((p) => p !== id);
      if (x.children.length) return `${adds ? 'указан родитель' : 'убран родитель'}${at(x.children, name)}: ${name(id)}`;
      if (other.length) return `${adds ? 'указана семья' : 'убрана связь мужа и жены'}: ${name(id)} и ${name(other[0])}`;
      return null;
    }
    case 'add_child':
    case 'remove_child': {
      const sex = name.sex(x.child_id);
      if (!x.partners) return `${adds ? 'новый ребёнок' : 'убран ребёнок'}: ${name(x.child_id)}`;
      if (x.partners.length) return `${adds ? bySex(sex, 'новый сын', 'новая дочь') : bySex(sex, 'убран из детей', 'убрана из детей')}${adds ? at(x.partners, name) : ` ${name.gen(x.partners)}`}: ${name(x.child_id)}`;
      const sibs = x.children.filter((c) => c !== x.child_id);
      return sibs.length ? `${adds ? 'указаны братья и сёстры' : 'убрана связь братьев и сестёр'}: ${list([x.child_id, ...sibs])}` : null;
    }
    case 'create': {
      const pair = couple(e.after?.family || e.after);
      return pair && `указана семья: ${pair}`;
    }
    case 'drop': {
      const pair = couple(e.before?.family);
      return pair && `убрана связь мужа и жены: ${pair}`;
    }
    case 'update': {
      const what = Object.keys(FAMILY_FIELD).filter((k) => k in (e.after || {})).map((k) => FAMILY_FIELD[k]).join(', ');
      return `исправлены сведения о браке${at(e.persons?.length === 2 ? e.persons : [], name)}${what ? ` — ${what}` : ''}`;
    }
  }
  return null;
}

const count = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};
// «новое фото», «3 новых фото и новый документ»; без fresh — «3 фото и 1 документ».
function files(kinds, fresh) {
  const docs = kinds.filter((k) => k === 'doc').length;
  const photos = kinds.length - docs;
  if (fresh) {
    return [photos && (photos === 1 ? 'новое фото' : `${photos} новых фото`),
      docs && (docs === 1 ? 'новый документ' : count(docs, 'новый документ', 'новых документа', 'новых документов'))].filter(Boolean).join(' и ');
  }
  return [photos && `${photos} фото`, docs && count(docs, 'документ', 'документа', 'документов')].filter(Boolean).join(' и ');
}

// Файлы альбома: несколько загруженных разом — одной строкой: «3 новых фото у Ивана Фёдоровича».
function mediaLines(entries, name) {
  const lines = [];
  for (const [action, verb] of [['add', ''], ['delete', 'удалено: '], ['restore', 'возвращено: ']]) {
    const list = entries.filter((e) => e.action === action);
    if (!list.length) continue;
    lines.push(`${verb}${files(list.map((e) => (e.before || e.after)?.kind), action === 'add')}${at(list.flatMap((e) => e.persons || []), name)}`);
  }
  for (const e of entries) {
    const where = (x) => (x?.kind === 'doc' ? 'в документе' : 'на фото');
    if (e.action === 'update') {
      const what = Object.keys(e.after || {}).map((k) => (k === 'date' ? 'дата' : 'подпись')).join(' и ');
      lines.push(`исправлена ${what} к фото${at(e.persons, name)}`);
    }
    if (e.action === 'tag') lines.push(`${bySex(name.sex(e.after?.person_id), 'отмечен', 'отмечена')} ${where(e.after)}: ${name(e.after?.person_id)}`);
    if (e.action === 'untag') lines.push(`убрана отметка ${where(e.before)}: ${name(e.before?.person_id)}`);
  }
  return lines;
}

// Истории: «новая история у Петра Ивановича — «Рыбалка на Волге»». Гостю заголовки не приходят — без них.
const STORY_FIELD = { title: 'заголовок', date: 'дата', body: 'текст', audio_id: 'запись голоса' };
function storyLine(e, name) {
  const x = e.after || e.before || {};
  const title = x.title ? ` — «${x.title}»` : '';
  const who = at(e.persons, name);
  switch (e.action) {
    case 'add': return `новая история${x.audio ? ' с записью голоса' : ''}${who}${title}`;
    case 'delete': return `удалена история${who}${title}`;
    case 'restore': return `возвращена история${who}${title}`;
    case 'update': {
      const what = Object.keys(e.before || {}).map((k) => STORY_FIELD[k] || k).join(', ');
      return `исправлена история${title}${what ? `: ${what}` : ''}`;
    }
    case 'link': return `история теперь и${at([e.after?.person_id], name)}${title}`;
    case 'unlink': return `история убрана из карточки ${name.gen(e.before?.person_id)}${title}`;
  }
  return null;
}

// События ленты жизни: «новое событие у Юрия Петровича — «Учёба»».
// Гостю приходит только вид события, а у события с живым — и без вида: «новое событие у …».
const EVENT_FIELD = { kind: 'вид', date: 'дата', place: 'место', title: 'название', body: 'описание', unit: 'часть', rank: 'звание' };
function eventLine(e, name) {
  const x = e.after || e.before || {};
  const title = x.kind ? ` — «${eventTitle(x)}»` : '';
  const who = at(e.persons, name);
  switch (e.action) {
    case 'add': return `новое событие${who}${title}`;
    case 'delete': return `удалено событие${who}${title}`;
    case 'restore': return `возвращено событие${who}${title}`;
    case 'update': {
      const what = Object.keys(e.before || {}).map((k) => EVENT_FIELD[k] || k).join(', ');
      return `исправлено событие${who}${title}${what ? `: ${what}` : ''}`;
    }
    case 'link': return `новый участник события${title}: ${name(e.after?.person_id)}`;
    case 'unlink': return `убран участник события${title}: ${name(e.before?.person_id)}`;
  }
  return null;
}

// Источники: «новый источник «Метрическая книга…» у Петра Ивановича — дата рождения».
// Гостю названия не приходят — тогда вид источника: «источник (Ревизская сказка)», а у достоверности — без самой отметки.
const SOURCE_FIELD = {
  kind: 'вид', title: 'название', archive: 'архив', fond: 'фонд', opis: 'опись', delo: 'дело', sheet: 'лист', verso: 'оборот',
  url: 'ссылка', media_id: 'скан', note: 'заметка',
};
const sourceName = (x) => (x?.title ? `источник «${x.title}»` : KINDS[x?.kind] ? `источник (${KINDS[x.kind].label})` : 'источник');
// « у Петра Ивановича — дата рождения».
const factOf = (e, name) => {
  const x = e.after || e.before || {};
  return `${at(e.persons, name)}${x.fact ? ` — ${factLabel(x.subject, x.fact).toLowerCase()}` : ''}`;
};
function sourceLines(entries, name) {
  const lines = [];
  // Новый источник сразу привязан к сведению — одной строкой.
  const added = entries.filter((e) => e.entity === 'source' && e.action === 'add');
  const merged = added.length === 1 ? entries.filter((e) => e.entity === 'citation' && e.action === 'add') : [];
  for (const e of entries) {
    const x = e.after || e.before || {};
    if (e.entity === 'quality') {
      const q = QUALITY[e.after?.quality];
      const what = q ? `отмечено «${q.label.toLowerCase()}»` : e.after?.marked ? 'отмечена достоверность' : 'убрана отметка достоверности';
      lines.push(what + factOf(e, name));
    } else if (e.entity === 'citation') {
      if (merged.includes(e)) continue;
      if (e.action === 'add') lines.push(`указан ${sourceName(x)}${factOf(e, name)}`);
      if (e.action === 'remove') lines.push(`убран ${sourceName(x)}${factOf(e, name)}`);
      if (e.action === 'update') lines.push(`исправлено уточнение к источнику${factOf(e, name)}`);
    } else if (e.action === 'add') {
      const facts = [...new Set(merged.map((c) => c.after?.fact && factLabel(c.after.subject, c.after.fact).toLowerCase()).filter(Boolean))];
      lines.push(`новый ${sourceName(x)}${at(merged.flatMap((c) => c.persons || []), name)}${facts.length ? ` — ${facts.join(', ')}` : ''}`);
    } else if (e.action === 'update') {
      const fields = Object.keys(e.before || {}).map((k) => SOURCE_FIELD[k] || k).join(', ');
      lines.push(`исправлен ${sourceName(x)}${fields ? `: ${fields}` : ''}`);
    } else if (e.action === 'delete' || e.action === 'restore') {
      lines.push(`${e.action === 'delete' ? 'удалён' : 'возвращён'} ${sourceName(x)}${at(e.persons, name)}`);
    }
  }
  return lines;
}

// Места справочника: «новое место в справочнике — «деревня Горки, Старицкий уезд, Тверская губерния»». Новое название само
// записывается в карточки — одной строкой: «новое название места записано в карточки: Смирнов Иван Петрович, …».
const PLACE_FIELD = {
  kind: 'вид', name: 'название', volost: 'волость', uezd: 'уезд', gubernia: 'губерния', country: 'страна', now: 'как сейчас', note: 'заметка',
};
function placeLines(entries, name) {
  const lines = [];
  for (const e of entries.filter((x) => x.entity === 'place')) {
    const x = e.after || e.before || {};
    const t = x.title ? ` — «${x.title}»` : '';
    if (e.action === 'add') lines.push(`новое место в справочнике${t}`);
    if (e.action === 'delete') lines.push(`убрано место из справочника${t}`);
    if (e.action === 'restore') lines.push(`возвращено место в справочник${t}`);
    if (e.action === 'update') {
      const what = Object.keys(e.before || {}).filter((k) => PLACE_FIELD[k]).map((k) => PLACE_FIELD[k]).join(', ');
      lines.push(`исправлено место${t}${what ? `: ${what}` : ''}`);
    }
  }
  const who = [...new Set(entries.filter((e) => e.entity !== 'place').flatMap((e) => e.persons || []))].filter(Boolean).map(name);
  if (who.length) lines.push(`новое название места записано в карточки: ${who.join(', ')}`);
  return lines;
}

// Исследование (видят только владелец и участники): «новый вопрос поиска у Петра Ивановича — «Где погиб в 1943»»,
// «новая запись поиска у … — «…»», «вопрос «…»: нашли».
const STATUS_WORD = { open: 'ищем', found: 'нашли', notfound: 'не нашли' };
const NOTE_FIELD = { result: 'итог', place: 'где искали', url: 'ссылка', ref: 'шифр', body: 'что нашли' };
function researchLine(e, name) {
  const x = e.after || e.before || {};
  const title = x.title ? ` — «${x.title}»` : '';
  const who = at(e.persons, name);
  if (e.entity === 'research_note') {
    switch (e.action) {
      case 'add': return `новая запись поиска${who}${title}`;
      case 'delete': return `удалена запись поиска${who}${title}`;
      case 'restore': return `возвращена запись поиска${who}${title}`;
      case 'update': return `исправлена запись поиска${who}${title}: ${Object.keys(e.before || {}).map((k) => NOTE_FIELD[k] || k).join(', ')}`;
    }
    return null;
  }
  switch (e.action) {
    case 'add': return `новый вопрос поиска${who}${title}`;
    case 'delete': return `удалён вопрос поиска${who}${title}`;
    case 'restore': return `возвращён вопрос поиска${who}${title}`;
    case 'update': {
      if (Object.keys(e.before || {}).join() === 'status') return `вопрос поиска${who}${title}: ${STATUS_WORD[e.after?.status] || e.after?.status}`;
      return `исправлен вопрос поиска${who}${title}`;
    }
  }
  return null;
}

// Загрузка из файла — одной строкой-сводкой: «загрузка из файла «семья.ged» — 186 человек, 52 семьи, 40 событий».
// Подробности — только у небольших загрузок: тысячи строк никто читать не будет.
export function importSummary(x, undo = false) {
  const what = [
    x?.persons && count(x.persons, 'новый человек', 'новых человека', 'новых человек'),
    x?.matched && `дополнено ${count(x.matched, 'карточка', 'карточки', 'карточек')}`,
    x?.families && count(x.families, 'семья', 'семьи', 'семей'),
    x?.events && count(x.events, 'событие', 'события', 'событий'),
    x?.sources && count(x.sources, 'источник', 'источника', 'источников'),
  ].filter(Boolean).join(', ');
  // Ответ ИИ-помощника из «Исследования» (routes/research.js) загружается как файл с этим именем.
  const where = x?.file === ANSWER_FILE ? 'из ответа помощника' : `из файла${x?.file ? ` «${x.file}»` : ''}`;
  return `${undo ? 'отменена загрузка' : 'загрузка'} ${where}${what ? ` — ${what}` : ''}`;
}
const SMALL_IMPORT = 40;

// Строки действия, главная — первой. Служебные записи (пустая семья создана или убрана) не показываем.
export function opLines(op, name) {
  const imp = op.entries.find((e) => e.entity === 'import');
  if (imp) {
    const head = importSummary(imp.after || imp.before, imp.action === 'revert');
    if ((op.total || op.entries.length) > SMALL_IMPORT) return [head];
    return [head, ...opLines({ ...op, entries: op.entries.filter((e) => e !== imp) }, name).filter((l) => l !== 'изменены связи')];
  }
  if (op.entries.some((e) => e.entity === 'place')) return placeLines(op.entries, name);
  // Первое фото само становится главным, удалённое перестаёт им быть — отдельной строкой это не показываем.
  const withFiles = op.entries.some((e) => e.entity === 'media' && ['add', 'delete', 'restore'].includes(e.action));
  const lines = [
    ...mediaLines(op.entries.filter((e) => e.entity === 'media'), name),
    ...sourceLines(op.entries.filter((e) => ['source', 'citation', 'quality'].includes(e.entity)), name),
    ...op.entries.map((e) => {
      if (e.entity === 'person') return e.action === 'photo' && withFiles ? null : personLine(e, name);
      if (e.entity === 'story') return storyLine(e, name);
      if (e.entity === 'event') return eventLine(e, name);
      if (e.entity === 'research' || e.entity === 'research_note') return researchLine(e, name);
      return e.entity === 'family' ? familyLine(e, name) : null;
    }),
  ].filter(Boolean);
  return lines.length ? lines : ['изменены связи'];
}

// «Ещё 3 изменения».
export const moreText = (n) => `Ещё ${count(n, 'изменение', 'изменения', 'изменений')}`;

// «было: …» для правок карточки.
// У истории — только заголовок и дата: текст длинный, а запись голоса словами не покажешь. У источника — без скана и оборота.
// У события — без вида и описания.
const WAS = {
  story: ['title', 'date'], place: ['title', 'now'], source: ['title', 'archive', 'fond', 'opis', 'delo', 'sheet', 'url'], event: ['date', 'place', 'title', 'unit', 'rank'],
  research: ['title'], research_note: ['place', 'ref', 'url'],
};
export function opWas(op) {
  // Загрузка из файла показывается сводкой — без «было».
  if (op.entries.some((e) => e.entity === 'import')) return [];
  // У правки места — только само место: в карточках было его прежнее название.
  const withPlace = op.entries.some((e) => e.entity === 'place');
  return op.entries
    .filter((e) => (!withPlace || e.entity === 'place') && e.entity !== 'family' && e.action === 'update')
    .map((e) => Object.entries(e.before || {}).filter(([k]) => !WAS[e.entity] || WAS[e.entity].includes(k)).map(([, v]) => v).filter((v) => v !== null && v !== undefined)) // гостю старые значения не приходят
    .filter((vals) => vals.length)
    .map((vals) => 'было: ' + vals.map((v) => (v === '' ? '—' : String(v))).join(', '));
}

export const restoresSomeone = (op) => op.entries.some((e) => e.entity !== 'family' && e.action === 'delete');
