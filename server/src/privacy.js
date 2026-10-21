// Гости (только просмотр) видят у живых родственников лишь имена: без дат, мест, заметок и фото.
import { isPrivate } from '../../shared/names.js';
import { q } from './db.js';

const HIDDEN = {
  birth_surname: '', birth_date: '', birth_place: '', death_date: '', death_place: '', burial_place: '',
  occupation: '', notes: '', photo_id: null, hidden: true,
};

export const isGuest = (user) => user?.role === 'viewer';

export function hideLiving(data) {
  const hidden = new Set(data.persons.filter((p) => isPrivate(p)).map((p) => p.id));
  return {
    ...data,
    persons: data.persons.map((p) => (hidden.has(p.id) ? { ...p, ...HIDDEN } : p)),
    families: data.families.map((f) => (hidden.has(f.partner1) || hidden.has(f.partner2) ? { ...f, start_date: '', end_date: '' } : f)),
  };
}

// Запись журнала для гостя. В before/after лежат старые значения, в том числе данные живых,
// поэтому оставляем только то, что нужно для подписи: имена и пол, названия полей, «есть фото или нет», кто с кем связан.
const NAME = ['surname', 'given', 'patronymic', 'sex'];
const LINK = ['partner1', 'partner2', 'partners', 'children', 'child_id', 'kind'];
const pick = (o, keys) => o && Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const fieldsOnly = (o) => o && Object.fromEntries(Object.keys(o).map((k) => [k, null]));
// В старых записях снимок семьи — сама строка семьи, без детей.
const familySnap = (s) => s && { family: pick(s.family || s, ['id', ...LINK]), children: (s.children || []).map((c) => pick(c, ['child_id', 'kind'])) };

export function trimEntry(e) {
  const both = (fn) => ({ ...e, before: fn(e.before), after: fn(e.after) });
  if (e.entity === 'person') {
    if (e.action === 'create') return both((x) => pick(x, NAME));
    if (e.action === 'delete') return both((x) => x && { person: pick(x.person, NAME) });
    if (e.action === 'photo') return both((x) => x && { photo_id: Boolean(x.photo_id) });
    return both(fieldsOnly);
  }
  if (e.action === 'create' || e.action === 'drop') return both(familySnap);
  if (e.action === 'update') return both(fieldsOnly);
  return both((x) => pick(x, LINK));
}

// Кого гость видит без подробностей: их карточки, обсуждения и комментарии в ленте скрыты.
export async function privateIds() {
  const rows = await q('select id, living, birth_date from persons where living and deleted_at is null');
  return rows.filter((p) => isPrivate(p)).map((p) => p.id);
}
