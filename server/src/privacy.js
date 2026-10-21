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
  // Файлы: без подписей, имён и id — только вид (фото или документ) и кто отмечен.
  if (e.entity === 'media') {
    const f = e.action === 'update' ? fieldsOnly : (x) => pick(x, ['kind', 'person_id']);
    return { ...both(f), entity_id: null };
  }
  // Истории: без заголовков, дат и текста — только кто связан и есть ли запись голоса.
  if (e.entity === 'story') {
    const f = e.action === 'update' ? fieldsOnly : (x) => pick(x, ['person_id', 'audio']);
    return { ...both(f), entity_id: null };
  }
  if (e.action === 'create' || e.action === 'drop') return both(familySnap);
  if (e.action === 'update') return both(fieldsOnly);
  return both((x) => pick(x, LINK));
}

// Какие из файлов ids гость может видеть: файл не удалён, на нём отмечен кто-то из дерева и нет ни одного живого.
// Групповое фото с живым человеком гостю не показывается совсем — ни в альбоме, ни по ссылке, ни главным фото ушедшего.
export async function guestMedia(ids) {
  if (!ids.length) return new Set();
  const rows = await q(
    `select m.id, p.living, p.birth_date, p.deleted_at from media m
     join media_persons mp on mp.media_id = m.id join persons p on p.id = mp.person_id
     where m.id = any($1::uuid[]) and m.deleted_at is null`,
    [ids],
  );
  const bad = new Set(rows.filter((r) => isPrivate(r)).map((r) => r.id));
  return new Set(rows.filter((r) => !r.deleted_at && !bad.has(r.id)).map((r) => r.id));
}

// Какие из историй ids гость может видеть: история не удалена, связана с кем-то из дерева и ни с одним живым.
// Как с групповым фото: история с живым гостю не показывается совсем — ни в карточке ушедшего, ни запись голоса по ссылке.
export async function guestStories(ids) {
  if (!ids.length) return new Set();
  const rows = await q(
    `select s.id, p.living, p.birth_date, p.deleted_at from stories s
     join story_persons sp on sp.story_id = s.id join persons p on p.id = sp.person_id
     where s.id = any($1::uuid[]) and s.deleted_at is null`,
    [ids],
  );
  const bad = new Set(rows.filter((r) => isPrivate(r)).map((r) => r.id));
  return new Set(rows.filter((r) => !r.deleted_at && !bad.has(r.id)).map((r) => r.id));
}

// Дерево для гостя: hideLiving и без главных фото, которые гостю не видны.
export async function guestTree(data) {
  const out = hideLiving(data);
  const ok = await guestMedia(out.persons.map((p) => p.photo_id).filter(Boolean));
  return { ...out, persons: out.persons.map((p) => (p.photo_id && !ok.has(p.photo_id) ? { ...p, photo_id: null } : p)) };
}

// Кого гость видит без подробностей: их карточки, обсуждения и комментарии в ленте скрыты.
export async function privateIds() {
  const rows = await q('select id, living, birth_date from persons where living and deleted_at is null');
  return rows.filter((p) => isPrivate(p)).map((p) => p.id);
}
