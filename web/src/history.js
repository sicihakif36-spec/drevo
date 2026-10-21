// Подписи к журналу правок: одно действие пользователя — одна или несколько строк.
import { fullName } from '@shared/names.js';

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

// Строки действия. Служебные записи (пустая семья создана или убрана) не показываем.
export function opLines(op, name) {
  // Первое фото само становится главным, удалённое перестаёт им быть — отдельной строкой это не показываем.
  const withFiles = op.entries.some((e) => e.entity === 'media' && ['add', 'delete', 'restore'].includes(e.action));
  const lines = [
    ...mediaLines(op.entries.filter((e) => e.entity === 'media'), name),
    ...op.entries.map((e) => {
      if (e.entity === 'person') return e.action === 'photo' && withFiles ? null : personLine(e, name);
      return e.entity === 'family' ? familyLine(e, name) : null;
    }),
  ].filter(Boolean);
  return lines.length ? lines : ['изменил(а) связи'];
}

// «было: …» для правок карточки.
export function opWas(op) {
  return op.entries
    .filter((e) => e.entity !== 'family' && e.action === 'update')
    .map((e) => 'было: ' + Object.values(e.before || {}).map((v) => (v === '' ? '—' : String(v))).join(', '));
}

export const restoresSomeone = (op) => op.entries.some((e) => e.entity !== 'family' && e.action === 'delete');
