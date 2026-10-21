// Подписи к журналу правок: одно действие пользователя — одна или несколько строк.
import { fullName } from '@shared/names.js';
import { KINDS, QUALITY, factLabel } from '@shared/sources.js';
import { eventTitle } from '@shared/events.js';

export const FIELDS = [
  ['surname', 'Фамилия'], ['given', 'Имя'], ['patronymic', 'Отчество'], ['birth_surname', 'Фамилия при рождении'],
  ['birth_date', 'Дата рождения'], ['birth_place', 'Место рождения'], ['death_date', 'Дата смерти'], ['death_place', 'Место смерти'],
  ['burial_place', 'Место захоронения'], ['occupation', 'Род занятий'], ['notes', 'Заметки и воспоминания'],
];
const LABEL = Object.fromEntries([...FIELDS, ['sex', 'Пол'], ['living', 'Жив(а)']]);

// Имя по id: из дерева, а для удалённых — из снимков в самом журнале.
export function namer(ops, idx) {
  const snap = new Map();
  for (const op of ops) {
    for (const e of op.entries) {
      const p = e.entity !== 'person' ? null : e.action === 'create' ? e.after : e.action === 'delete' ? e.before?.person : null;
      if (p) snap.set(e.entity_id, fullName(p));
    }
  }
  return (id) => (idx?.persons.has(id) ? fullName(idx.persons.get(id)) : snap.get(id) || 'удалённый человек');
}

function personLine(e, name) {
  const n = name(e.entity_id);
  if (e.action === 'create') return `добавил(а) ${n}`;
  if (e.action === 'delete') return `удалил(а) ${n}`;
  if (e.action === 'restore') return `вернул(а) ${n}`;
  if (e.action === 'photo') return `${e.after?.photo_id ? 'сменил(а)' : 'убрал(а)'} главное фото: ${n}`;
  if (e.action === 'update') return `изменил(а) ${n}: ${Object.keys(e.after || {}).map((k) => (LABEL[k] || k).toLowerCase()).join(', ')}`;
  return null;
}

function familyLine(e, name) {
  const adds = ['set_partner', 'add_child'].includes(e.action);
  const x = adds ? e.after || {} : e.before || {};
  const list = (ids) => ids.map(name).join(', ');
  const couple = (f) => (f?.partner1 && f?.partner2 ? `${name(f.partner1)} и ${name(f.partner2)}` : null);
  switch (e.action) {
    case 'set_partner':
    case 'unset_partner': {
      const id = x.partner1 || x.partner2;
      if (!x.partners) return `${adds ? 'указал(а)' : 'убрал(а)'} связь: ${name(id)}`;
      const other = x.partners.filter((p) => p !== id);
      if (x.children.length) return `${adds ? 'указал(а)' : 'убрал(а)'} родителя: ${name(id)}; дети: ${list(x.children)}`;
      if (other.length) return `${adds ? 'указал(а) супругов' : 'убрал(а) связь супругов'}: ${name(id)} и ${name(other[0])}`;
      return null;
    }
    case 'add_child':
    case 'remove_child': {
      if (!x.partners) return `${adds ? 'указал(а)' : 'убрал(а)'} ребёнка: ${name(x.child_id)}`;
      if (x.partners.length) return `${adds ? 'указал(а)' : 'убрал(а)'} ребёнка: ${name(x.child_id)}; родители: ${list(x.partners)}`;
      const sibs = x.children.filter((c) => c !== x.child_id);
      return sibs.length ? `${adds ? 'указал(а)' : 'убрал(а) связь'} братьев и сестёр: ${list([x.child_id, ...sibs])}` : null;
    }
    case 'create': {
      const pair = couple(e.after?.family || e.after);
      return pair && `указал(а) супругов: ${pair}`;
    }
    case 'drop': {
      const pair = couple(e.before?.family);
      return pair && `убрал(а) связь супругов: ${pair}`;
    }
    case 'update':
      return 'изменил(а) сведения о браке';
  }
  return null;
}

const count = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};
// «3 фото и 1 документ».
function files(kinds) {
  const docs = kinds.filter((k) => k === 'doc').length;
  const photos = kinds.length - docs;
  return [photos && `${photos} фото`, docs && count(docs, 'документ', 'документа', 'документов')].filter(Boolean).join(' и ');
}

// Файлы альбома: несколько загруженных разом — одной строкой: «добавил(а) 3 фото: Смирнов Иван Фёдорович».
function mediaLines(entries, name) {
  const lines = [];
  for (const [action, verb] of [['add', 'добавил(а)'], ['delete', 'удалил(а)'], ['restore', 'вернул(а)']]) {
    const list = entries.filter((e) => e.action === action);
    if (!list.length) continue;
    const who = [...new Set(list.flatMap((e) => e.persons || []))].map(name).join(', ');
    lines.push(`${verb} ${files(list.map((e) => (e.before || e.after)?.kind))}${who ? `: ${who}` : ''}`);
  }
  for (const e of entries) {
    const where = (x) => (x?.kind === 'doc' ? 'на документе' : 'на фото');
    if (e.action === 'update') {
      const what = Object.keys(e.after || {}).map((k) => (k === 'date' ? 'дату' : 'подпись')).join(' и ');
      lines.push(`изменил(а) ${what} у фото: ${(e.persons || []).map(name).join(', ')}`);
    }
    if (e.action === 'tag') lines.push(`отметил(а) ${where(e.after)}: ${name(e.after?.person_id)}`);
    if (e.action === 'untag') lines.push(`убрал(а) отметку ${where(e.before)}: ${name(e.before?.person_id)}`);
  }
  return lines;
}

// Истории: «добавил(а) историю «Рыбалка на Волге»: Смирнов Пётр Иванович». Гостю заголовки не приходят — без них.
const STORY_FIELD = { title: 'заголовок', date: 'дату', body: 'текст', audio_id: 'запись голоса' };
function storyLine(e, name) {
  const x = e.after || e.before || {};
  const title = x.title ? ` «${x.title}»` : '';
  const who = (e.persons || []).map(name).join(', ');
  switch (e.action) {
    case 'add': return `добавил(а) историю${title}${x.audio ? ' с записью голоса' : ''}${who ? `: ${who}` : ''}`;
    case 'delete': return `удалил(а) историю${title}${who ? `: ${who}` : ''}`;
    case 'restore': return `вернул(а) историю${title}${who ? `: ${who}` : ''}`;
    case 'update': {
      const what = Object.keys(e.before || {}).map((k) => STORY_FIELD[k] || k).join(', ');
      return `изменил(а) историю${title}${what ? `: ${what}` : ''}`;
    }
    case 'link': return `связал(а) историю${title} с: ${name(e.after?.person_id)}`;
    case 'unlink': return `убрал(а) историю${title} из карточки: ${name(e.before?.person_id)}`;
  }
  return null;
}

// События ленты жизни: «добавил(а) событие «Служба в армии»: Смирнов Пётр Иванович».
// Гостю приходит только вид события, а у события с живым — и без вида: «добавил(а) событие: …».
const EVENT_FIELD = { kind: 'вид', date: 'дату', place: 'место', title: 'название', body: 'описание', unit: 'часть', rank: 'звание' };
function eventLine(e, name) {
  const x = e.after || e.before || {};
  const title = x.kind ? ` «${eventTitle(x)}»` : '';
  const who = (e.persons || []).map(name).join(', ');
  switch (e.action) {
    case 'add': return `добавил(а) событие${title}${who ? `: ${who}` : ''}`;
    case 'delete': return `удалил(а) событие${title}${who ? `: ${who}` : ''}`;
    case 'restore': return `вернул(а) событие${title}${who ? `: ${who}` : ''}`;
    case 'update': {
      const what = Object.keys(e.before || {}).map((k) => EVENT_FIELD[k] || k).join(', ');
      return `изменил(а) событие${title}${what ? `: ${what}` : ''}`;
    }
    case 'link': return `добавил(а) участника события${title}: ${name(e.after?.person_id)}`;
    case 'unlink': return `убрал(а) участника события${title}: ${name(e.before?.person_id)}`;
  }
  return null;
}

// Источники: «добавил(а) источник «Метрическая книга…» — дата рождения: Смирнов Пётр Иванович».
// Гостю названия не приходят — тогда вид источника: «источник (Ревизская сказка)», а у достоверности — без самой отметки.
const SOURCE_FIELD = {
  kind: 'вид', title: 'название', archive: 'архив', fond: 'фонд', opis: 'опись', delo: 'дело', sheet: 'лист', verso: 'оборот',
  url: 'ссылку', media_id: 'скан', note: 'заметку',
};
const sourceName = (x) => (x?.title ? `источник «${x.title}»` : KINDS[x?.kind] ? `источник (${KINDS[x.kind].label})` : 'источник');
// «— дата рождения: Смирнов Пётр Иванович».
const factOf = (e, name) => {
  const x = e.after || e.before || {};
  const who = (e.persons || []).map(name).join(', ');
  return `${x.fact ? ` — ${factLabel(x.subject, x.fact).toLowerCase()}` : ''}${who ? `: ${who}` : ''}`;
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
      const what = q ? `отметил(а): ${q.label.toLowerCase()}` : e.after?.marked ? 'отметил(а) достоверность' : 'убрал(а) отметку достоверности';
      lines.push(what + factOf(e, name));
    } else if (e.entity === 'citation') {
      if (merged.includes(e)) continue;
      if (e.action === 'add') lines.push(`указал(а) ${sourceName(x)}${factOf(e, name)}`);
      if (e.action === 'remove') lines.push(`убрал(а) ${sourceName(x)}${factOf(e, name)}`);
      if (e.action === 'update') lines.push(`изменил(а) уточнение к источнику${factOf(e, name)}`);
    } else if (e.action === 'add') {
      lines.push(`добавил(а) ${sourceName(x)}${merged.map((c) => factOf(c, name)).join(';')}`);
    } else if (e.action === 'update') {
      const fields = Object.keys(e.before || {}).map((k) => SOURCE_FIELD[k] || k).join(', ');
      lines.push(`изменил(а) ${sourceName(x)}${fields ? `: ${fields}` : ''}`);
    } else if (e.action === 'delete' || e.action === 'restore') {
      const who = (e.persons || []).map(name).join(', ');
      lines.push(`${e.action === 'delete' ? 'удалил(а)' : 'вернул(а)'} ${sourceName(x)}${who ? `: ${who}` : ''}`);
    }
  }
  return lines;
}

// Строки действия. Служебные записи (пустая семья создана или убрана) не показываем.
export function opLines(op, name) {
  // Первое фото само становится главным, удалённое перестаёт им быть — отдельной строкой это не показываем.
  const withFiles = op.entries.some((e) => e.entity === 'media' && ['add', 'delete', 'restore'].includes(e.action));
  const lines = [
    ...mediaLines(op.entries.filter((e) => e.entity === 'media'), name),
    ...sourceLines(op.entries.filter((e) => ['source', 'citation', 'quality'].includes(e.entity)), name),
    ...op.entries.map((e) => {
      if (e.entity === 'person') return e.action === 'photo' && withFiles ? null : personLine(e, name);
      if (e.entity === 'story') return storyLine(e, name);
      if (e.entity === 'event') return eventLine(e, name);
      return e.entity === 'family' ? familyLine(e, name) : null;
    }),
  ].filter(Boolean);
  return lines.length ? lines : ['изменил(а) связи'];
}

// «было: …» для правок карточки.
// У истории — только заголовок и дата: текст длинный, а запись голоса словами не покажешь. У источника — без скана и оборота.
// У события — без вида и описания.
const WAS = {
  story: ['title', 'date'], source: ['title', 'archive', 'fond', 'opis', 'delo', 'sheet', 'url'], event: ['date', 'place', 'title', 'unit', 'rank'],
};
export function opWas(op) {
  return op.entries
    .filter((e) => e.entity !== 'family' && e.action === 'update')
    .map((e) => Object.entries(e.before || {}).filter(([k]) => !WAS[e.entity] || WAS[e.entity].includes(k)).map(([, v]) => v))
    .filter((vals) => vals.length)
    .map((vals) => 'было: ' + vals.map((v) => (v === '' ? '—' : String(v))).join(', '));
}

export const restoresSomeone = (op) => op.entries.some((e) => e.entity !== 'family' && e.action === 'delete');
