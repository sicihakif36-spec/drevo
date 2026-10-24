// Откат действия целиком: записи журнала с общим op отменяются в обратном порядке.
// Откат — тоже действие в журнале, его можно отменить и так вернуть отменённое.
import { logChange } from './changes.js';
import {
  HttpError, PERSON_FIELDS, FAMILY_FIELDS, SLOTS, alive, addChild, removeChild, setPartner, unsetPartner,
  dropFamily, restoreFamily, dropEmpty, deletePerson, restorePerson,
} from './tree.js';
import { MEDIA_FIELDS, deleteMedia, restoreMedia, tag, untag } from './album.js';
import { STORY_FIELDS, deleteStory, restoreStory, updateStory, linkPerson, unlinkPerson } from './stories.js';
import { SOURCE_FIELDS } from '../../shared/sources.js';
import { deleteSource, restoreSource, updateSource, cite, uncite, updateCitation, setQuality } from './sources.js';
import { EVENT_FIELDS } from '../../shared/events.js';
import { deleteEvent, restoreEvent, updateEvent, addParticipant, removeParticipant } from './timeline.js';
import { PLACE_FIELDS } from '../../shared/places.js';
import { deletePlace, restorePlace, updatePlace } from './places.js';
import {
  QUESTION_FIELDS, NOTE_FIELDS, deleteQuestion, restoreQuestion, updateQuestion, deleteNote, restoreNote, updateNote,
} from './research.js';
import { undoMerge } from './merge.js';

const LATER = 'После этой правки были другие. Сначала отмените более поздние правки.';
const GONE = 'Этот человек удалён. Сначала верните его.';
const SOURCE_GONE = 'Этот источник удалён. Сначала верните его.';
const EVENT_GONE = 'Это событие удалено. Сначала верните его.';
const pick = (o, cols) => Object.fromEntries(cols.map((c) => [c, o[c]]));

async function undoPerson(db, userId, e) {
  const before = e.before || {};
  const after = e.after || {};
  const cur = (await db.q('select * from persons where id = $1 for update', [e.entity_id]))[0];
  if (!cur) throw new HttpError(404, 'Человек не найден');
  switch (e.action) {
    case 'update': {
      const cols = Object.keys(before).filter((c) => PERSON_FIELDS.includes(c));
      if (!cols.length) break;
      await db.q(`update persons set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() where id = $1`,
        [cur.id, ...cols.map((c) => before[c])]);
      return logChange(db, userId, 'person', cur.id, 'update', pick(cur, cols), pick(before, cols));
    }
    case 'photo': {
      if ((cur.photo_id ?? null) !== (after.photo_id ?? null)) throw new HttpError(409, LATER);
      if (before.photo_id && (await db.q('select 1 from media where id = $1 and deleted_at is not null', [before.photo_id]))[0]) {
        throw new HttpError(409, 'Прежнее главное фото удалено. Сначала верните его.');
      }
      await db.q('update persons set photo_id = $1, version = version + 1, updated_at = now() where id = $2', [before.photo_id ?? null, cur.id]);
      return logChange(db, userId, 'person', cur.id, 'photo', { photo_id: cur.photo_id }, { photo_id: before.photo_id ?? null });
    }
    case 'create':
    case 'restore':
      if (cur.deleted_at) throw new HttpError(409, 'Этот человек уже удалён');
      return deletePerson(db, userId, cur.id);
    case 'delete':
      return restorePerson(db, userId, cur.id, before);
    case 'merge':
    case 'unmerge':
      return undoMerge(db, userId, e);
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

async function undoFamily(db, userId, e) {
  const before = e.before || {};
  const after = e.after || {};
  if (e.action === 'drop') return restoreFamily(db, userId, before);
  const fam = (await db.q('select * from families where id = $1 for update', [e.entity_id]))[0];
  if (!fam) throw new HttpError(409, 'Этой семьи уже нет в дереве');
  switch (e.action) {
    case 'create': {
      // В старых записях after — сама строка семьи.
      const snap = after.family ? after : { family: after, children: [] };
      const allowed = new Set(snap.children.map((c) => c.child_id));
      const kids = await db.q('select child_id from family_children where family_id = $1', [fam.id]);
      if (SLOTS.some((s) => fam[s] && fam[s] !== snap.family[s]) || kids.some((k) => !allowed.has(k.child_id))) throw new HttpError(409, LATER);
      return dropFamily(db, userId, fam);
    }
    case 'update': {
      const cols = Object.keys(before).filter((c) => FAMILY_FIELDS.includes(c));
      if (!cols.length) break;
      await db.q(`update families set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [fam.id, ...cols.map((c) => before[c])]);
      return logChange(db, userId, 'family', fam.id, 'update', pick(fam, cols), pick(before, cols), [fam.partner1, fam.partner2]);
    }
    case 'set_partner': {
      const slot = SLOTS.find((s) => s in after);
      if (!slot || fam[slot] !== after[slot]) throw new HttpError(409, LATER);
      return unsetPartner(db, userId, fam.id, slot, after[slot]);
    }
    case 'unset_partner': {
      const slot = SLOTS.find((s) => s in before);
      if (!slot || fam[slot]) throw new HttpError(409, LATER);
      if (!(await alive(db, before[slot]))) throw new HttpError(409, GONE);
      return setPartner(db, userId, fam.id, slot, before[slot]);
    }
    case 'add_child': {
      const id = await removeChild(db, userId, fam.id, after.child_id);
      if (!id) throw new HttpError(409, LATER);
      return id;
    }
    case 'remove_child':
      if (!(await alive(db, before.child_id))) throw new HttpError(409, GONE);
      return addChild(db, userId, fam.id, before.child_id, before.kind || 'birth');
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

async function undoMedia(db, userId, e) {
  const m = (await db.q('select * from media where id = $1 for update', [e.entity_id]))[0];
  if (!m) throw new HttpError(404, 'Файл не найден');
  switch (e.action) {
    case 'add':
    case 'restore':
      if (m.deleted_at) throw new HttpError(409, 'Этот файл уже удалён');
      return deleteMedia(db, userId, m.id);
    case 'delete':
      return restoreMedia(db, userId, m.id);
  }
  if (m.deleted_at) throw new HttpError(409, 'Этот файл удалён. Сначала верните его.');
  switch (e.action) {
    case 'update': {
      const before = e.before || {};
      const cols = Object.keys(before).filter((c) => MEDIA_FIELDS.includes(c));
      if (!cols.length) break;
      await db.q(`update media set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [m.id, ...cols.map((c) => before[c])]);
      return logChange(db, userId, 'media', m.id, 'update', pick(m, cols), pick(before, cols), e.persons);
    }
    case 'tag': {
      const id = await untag(db, userId, m.id, e.after.person_id);
      if (!id) throw new HttpError(409, LATER);
      return id;
    }
    case 'untag': {
      if (!(await alive(db, e.before.person_id))) throw new HttpError(409, GONE);
      const id = await tag(db, userId, m.id, e.before.person_id);
      if (!id) throw new HttpError(409, LATER);
      return id;
    }
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

async function undoStory(db, userId, e) {
  const s = (await db.q('select * from stories where id = $1 for update', [e.entity_id]))[0];
  if (!s) throw new HttpError(404, 'История не найдена');
  switch (e.action) {
    case 'add':
    case 'restore':
      if (s.deleted_at) throw new HttpError(409, 'Эта история уже удалена');
      return deleteStory(db, userId, s.id);
    case 'delete':
      return restoreStory(db, userId, s.id);
  }
  if (s.deleted_at) throw new HttpError(409, 'Эта история удалена. Сначала верните её.');
  switch (e.action) {
    case 'update': {
      const before = e.before || {};
      const id = await updateStory(db, userId, s.id, pick(before, Object.keys(before).filter((c) => STORY_FIELDS.includes(c))));
      if (!id) throw new HttpError(409, 'Здесь уже всё как было до этой правки');
      return id;
    }
    case 'link': {
      const id = await unlinkPerson(db, userId, s.id, e.after.person_id);
      if (!id) throw new HttpError(409, LATER);
      return id;
    }
    case 'unlink': {
      if (!(await alive(db, e.before.person_id))) throw new HttpError(409, GONE);
      const id = await linkPerson(db, userId, s.id, e.before.person_id);
      if (!id) throw new HttpError(409, LATER);
      return id;
    }
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

async function undoEvent(db, userId, e) {
  const ev = (await db.q('select * from life_events where id = $1 for update', [e.entity_id]))[0];
  if (!ev) throw new HttpError(404, 'Событие не найдено');
  switch (e.action) {
    case 'add':
    case 'restore':
      if (ev.deleted_at) throw new HttpError(409, 'Это событие уже удалено');
      return deleteEvent(db, userId, ev.id);
    case 'delete':
      return restoreEvent(db, userId, ev.id);
  }
  if (ev.deleted_at) throw new HttpError(409, EVENT_GONE);
  switch (e.action) {
    case 'update': {
      const before = e.before || {};
      const id = await updateEvent(db, userId, ev.id, pick(before, Object.keys(before).filter((c) => EVENT_FIELDS.includes(c))));
      if (!id) throw new HttpError(409, 'Здесь уже всё как было до этой правки');
      return id;
    }
    case 'link': {
      const id = await removeParticipant(db, userId, ev.id, e.after.person_id);
      if (!id) throw new HttpError(409, LATER);
      return id;
    }
    case 'unlink': {
      if (!(await alive(db, e.before.person_id))) throw new HttpError(409, GONE);
      const id = await addParticipant(db, userId, ev.id, e.before.person_id);
      if (!id) throw new HttpError(409, LATER);
      return id;
    }
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

// Место справочника. Новое название у людей возвращают их собственные записи в том же действии — здесь только само место.
async function undoPlace(db, userId, e) {
  const p = (await db.q('select * from places where id = $1 for update', [e.entity_id]))[0];
  if (!p) throw new HttpError(404, 'Место не найдено');
  switch (e.action) {
    case 'add':
    case 'restore':
      if (p.deleted_at) throw new HttpError(409, 'Это место уже удалено');
      return deletePlace(db, userId, p.id);
    case 'delete':
      return restorePlace(db, userId, p.id);
    case 'update': {
      if (p.deleted_at) throw new HttpError(409, 'Это место удалено. Сначала верните его.');
      const before = e.before || {};
      const id = await updatePlace(db, userId, p.id, pick(before, Object.keys(before).filter((c) => PLACE_FIELDS.includes(c))), { carry: false });
      if (!id) throw new HttpError(409, 'Здесь уже всё как было до этой правки');
      return id;
    }
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

// Сведение, к которому вернётся источник или отметка, на месте: человек и событие не удалены.
async function factThere(db, subject, id) {
  if (subject === 'person' && !(await alive(db, id))) throw new HttpError(409, GONE);
  if (subject === 'event' && !(await db.q('select 1 from life_events where id = $1 and deleted_at is null', [id]))[0]) {
    throw new HttpError(409, EVENT_GONE);
  }
}

async function undoSource(db, userId, e) {
  const s = (await db.q('select * from sources where id = $1 for update', [e.entity_id]))[0];
  if (!s) throw new HttpError(404, 'Источник не найден');
  switch (e.action) {
    case 'add':
    case 'restore':
      if (s.deleted_at) throw new HttpError(409, 'Этот источник уже удалён');
      return deleteSource(db, userId, s.id);
    case 'delete':
      return restoreSource(db, userId, s.id);
    case 'update': {
      if (s.deleted_at) throw new HttpError(409, SOURCE_GONE);
      const before = e.before || {};
      const id = await updateSource(db, userId, s.id, pick(before, Object.keys(before).filter((c) => SOURCE_FIELDS.includes(c))));
      if (!id) throw new HttpError(409, 'Здесь уже всё как было до этой правки');
      return id;
    }
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

// Привязка источника к сведению: снимок в журнале — сама строка привязки.
async function undoCitation(db, userId, e) {
  const x = e.after || e.before;
  if ((await db.q('select 1 from sources where id = $1 and deleted_at is not null', [x.source_id]))[0]) throw new HttpError(409, SOURCE_GONE);
  switch (e.action) {
    case 'add': {
      const id = await uncite(db, userId, e.entity_id);
      if (!id) throw new HttpError(409, LATER);
      return id;
    }
    case 'remove': {
      await factThere(db, x.subject, x.subject_id);
      const c = await cite(db, userId, x, e.entity_id);
      if (!c) throw new HttpError(409, LATER);
      return c.changeId;
    }
    case 'update': {
      const cur = (await db.q('select page from citations where id = $1', [e.entity_id]))[0];
      if (!cur || cur.page !== e.after.page) throw new HttpError(409, LATER);
      return updateCitation(db, userId, e.entity_id, e.before.page);
    }
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

async function undoQuality(db, userId, e) {
  const { subject, fact } = e.before;
  await factThere(db, subject, e.entity_id);
  const cur = (await db.q('select quality from fact_quality where subject = $1 and subject_id = $2 and fact = $3',
    [subject, e.entity_id, fact]))[0]?.quality ?? null;
  if (cur !== e.after.quality) throw new HttpError(409, LATER);
  return setQuality(db, userId, { subject, subject_id: e.entity_id, fact }, e.before.quality);
}

// Исследование: вопрос поиска и запись по ходу поиска.
async function undoResearch(db, userId, e) {
  const x = (await db.q('select * from research_questions where id = $1 for update', [e.entity_id]))[0];
  if (!x) throw new HttpError(404, 'Вопрос не найден');
  switch (e.action) {
    case 'add':
    case 'restore':
      if (x.deleted_at) throw new HttpError(409, 'Этот вопрос уже удалён');
      return deleteQuestion(db, userId, x.id);
    case 'delete':
      return restoreQuestion(db, userId, x.id);
    case 'update': {
      if (x.deleted_at) throw new HttpError(409, 'Этот вопрос удалён. Сначала верните его.');
      const before = e.before || {};
      const id = await updateQuestion(db, userId, x.id, pick(before, Object.keys(before).filter((c) => QUESTION_FIELDS.includes(c))));
      if (!id) throw new HttpError(409, 'Здесь уже всё как было до этой правки');
      return id;
    }
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

async function undoResearchNote(db, userId, e) {
  const n = (await db.q('select * from research_notes where id = $1 for update', [e.entity_id]))[0];
  if (!n) throw new HttpError(404, 'Запись не найдена');
  switch (e.action) {
    case 'add':
    case 'restore':
      if (n.deleted_at) throw new HttpError(409, 'Эта запись уже удалена');
      return deleteNote(db, userId, n.id);
    case 'delete':
      return restoreNote(db, userId, n.id);
    case 'update': {
      if (n.deleted_at) throw new HttpError(409, 'Эта запись удалена. Сначала верните её.');
      const before = e.before || {};
      const id = await updateNote(db, userId, n.id, pick(before, Object.keys(before).filter((c) => NOTE_FIELDS.includes(c))));
      if (!id) throw new HttpError(409, 'Здесь уже всё как было до этой правки');
      return id;
    }
  }
  throw new HttpError(400, 'Эту правку нельзя отменить автоматически');
}

// Сводка загрузки из файла: сама ничего не меняет, люди и связи отменяются своими записями.
async function undoImport(db, userId, e) {
  if (e.action === 'load') return logChange(db, userId, 'import', e.entity_id, 'revert', e.after, null, []);
  return logChange(db, userId, 'import', e.entity_id, 'load', null, e.before, []);
}

export async function revertOp(db, userId, changeId) {
  const head = (await db.q('select op from changes where id = $1', [changeId]))[0];
  if (!head) throw new HttpError(404, 'Правка не найдена');
  const entries = await db.q('select * from changes where op = $1 order by id desc for update', [head.op]);
  if (entries.some((e) => e.reverted_by)) throw new HttpError(409, 'Это действие уже отменено');
  const families = [];
  let first = null;
  for (const e of entries) {
    if (e.entity === 'family') families.push(e.entity_id);
    const undo = {
      person: undoPerson, media: undoMedia, family: undoFamily, story: undoStory, source: undoSource, citation: undoCitation, quality: undoQuality,
      event: undoEvent, place: undoPlace, import: undoImport, research: undoResearch, research_note: undoResearchNote,
    }[e.entity];
    const id = await undo(db, userId, e);
    first ??= id;
  }
  // Пустые семьи убираем в конце: по ходу отката они ещё нужны.
  await dropEmpty(db, userId, families);
  await db.q('update changes set reverted_by = $1 where op = $2', [first, head.op]);
}
