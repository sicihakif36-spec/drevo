// Гости (только просмотр) видят у живых родственников лишь имена: без дат, мест, заметок и фото.
// Родственник (роль relative) — не гость: видит всё, как участник, только не правит.
import { isPrivate } from '../../shared/names.js';
import { q } from './db.js';
import { RESEARCH } from './changes.js';

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
    families: data.families.map((f) => (hidden.has(f.partner1) || hidden.has(f.partner2) ? { ...f, start_date: '', place: '', end_date: '' } : f)),
  };
}

// Запись журнала для гостя. В before/after лежат старые значения, в том числе данные живых,
// поэтому оставляем только то, что нужно для подписи: имена и пол, названия полей, «есть фото или нет», кто с кем связан.
const NAME = ['surname', 'given', 'patronymic', 'alt_surname', 'alt_given', 'alt_patronymic', 'sex'];
const LINK = ['partner1', 'partner2', 'partners', 'children', 'child_id', 'kind'];
const pick = (o, keys) => o && Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
// Имя для подписи: второе написание — только если оно есть.
const nameOf = (o) => o && Object.fromEntries(Object.entries(pick(o, NAME)).filter(([k, v]) => !k.startsWith('alt_') || v));
const fieldsOnly = (o) => o && Object.fromEntries(Object.keys(o).map((k) => [k, null]));
// В старых записях снимок семьи — сама строка семьи, без детей.
const familySnap = (s) => s && { family: pick(s.family || s, ['id', ...LINK]), children: (s.children || []).map((c) => pick(c, ['child_id', 'kind'])) };

// hidden — живые (см. privateIds): о событии с живым участником гостю известно только, что оно есть.
export function trimEntry(e, hidden = new Set()) {
  const both = (fn) => ({ ...e, before: fn(e.before), after: fn(e.after) });
  // Исследование гостю не отдаётся вовсе (listOps research: false); если запись всё же сюда попала — без содержимого.
  if (RESEARCH.includes(e.entity)) return { ...e, before: null, after: null, entity_id: null };
  if (e.entity === 'person') {
    if (e.action === 'create') return both(nameOf);
    if (e.action === 'delete') return both((x) => x && { person: nameOf(x.person) });
    if (e.action === 'photo') return both((x) => x && { photo_id: Boolean(x.photo_id) });
    // Объединение дублей: кого с кем, без перенесённых привязок.
    if (e.action === 'merge' || e.action === 'unmerge') return both((x) => x && pick(x, ['from', 'into']));
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
  // Источники: без названий и шифров дел — только вид источника и к какому сведению привязан;
  // у достоверности — само сведение и есть ли отметка, без самой отметки.
  // Места справочника: только вид и полное название — сам справочник гостю виден, данных людей в нём нет.
  if (e.entity === 'place') return both((x) => pick(x, ['kind', 'title']));
  // Загрузка из файла: только числа и имя файла.
  if (e.entity === 'import') return both((x) => pick(x, ['file', 'persons', 'matched', 'families', 'events', 'sources']));
  // Интервью, сохранённое в истории: только сколько историй и фото — без даты и имени.
  if (e.entity === 'interview') return { ...both((x) => pick(x, ['stories', 'photos'])), entity_id: null };
  if (e.entity === 'source') return { ...both((x) => pick(x, ['kind'])), entity_id: null };
  if (e.entity === 'citation') return { ...both((x) => pick(x, ['kind', 'subject', 'fact'])), entity_id: null };
  if (e.entity === 'quality') return { ...both((x) => x && { ...pick(x, ['subject', 'fact']), marked: Boolean(x.quality) }), entity_id: null };
  // События: без описаний, мест, дат и названий — только вид, участник и какие поля правили; у события с живым — и без вида.
  if (e.entity === 'event') {
    const keep = (e.persons || []).some((id) => hidden.has(id)) ? ['person_id'] : ['kind', 'person_id'];
    return { ...e, before: e.action === 'update' ? fieldsOnly(e.before) : pick(e.before, keep), after: pick(e.after, keep), entity_id: null };
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

// Какие из событий ids гость может видеть: событие не удалено, у него есть участник в дереве и ни одного живого.
export async function guestEvents(ids) {
  if (!ids.length) return new Set();
  const rows = await q(
    `select e.id, p.living, p.birth_date, p.deleted_at from life_events e
     join event_persons ep on ep.event_id = e.id join persons p on p.id = ep.person_id
     where e.id = any($1::uuid[]) and e.deleted_at is null`,
    [ids],
  );
  const bad = new Set(rows.filter((r) => isPrivate(r)).map((r) => r.id));
  return new Set(rows.filter((r) => !r.deleted_at && !bad.has(r.id)).map((r) => r.id));
}

// Какие из источников ids гость может видеть: источник не удалён, привязан к сведениям кого-то из дерева и ни одного живого.
// Как с фото: источник, который касается живого (сам человек, супруг в браке или участник события), гостю не показывается совсем.
export async function guestSources(ids) {
  if (!ids.length) return new Set();
  const rows = await q(
    `select s.id, p.living, p.birth_date, p.deleted_at from sources s
     join citations c on c.source_id = s.id
     left join families f on c.subject = 'family' and f.id = c.subject_id
     left join event_persons ep on c.subject = 'event' and ep.event_id = c.subject_id
     join persons p on (c.subject = 'person' and p.id = c.subject_id) or p.id in (f.partner1, f.partner2) or p.id = ep.person_id
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
