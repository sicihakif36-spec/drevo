// Откат действия целиком: записи журнала с общим op отменяются в обратном порядке.
// Откат — тоже действие в журнале, его можно отменить и так вернуть отменённое.
import { logChange } from './changes.js';
import {
  HttpError, PERSON_FIELDS, FAMILY_FIELDS, SLOTS, alive, addChild, removeChild, setPartner, unsetPartner,
  dropFamily, restoreFamily, dropEmpty, deletePerson, restorePerson,
} from './tree.js';

const LATER = 'После этой правки были другие. Сначала отмените более поздние правки.';
const GONE = 'Этот человек удалён. Сначала верните его.';
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
      await db.q('update persons set photo_id = $1, version = version + 1, updated_at = now() where id = $2', [before.photo_id ?? null, cur.id]);
      return logChange(db, userId, 'person', cur.id, 'photo', { photo_id: cur.photo_id }, { photo_id: before.photo_id ?? null });
    }
    case 'create':
    case 'restore':
      if (cur.deleted_at) throw new HttpError(409, 'Этот человек уже удалён');
      return deletePerson(db, userId, cur.id);
    case 'delete':
      return restorePerson(db, userId, cur.id, before);
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

export async function revertOp(db, userId, changeId) {
  const head = (await db.q('select op from changes where id = $1', [changeId]))[0];
  if (!head) throw new HttpError(404, 'Правка не найдена');
  const entries = await db.q('select * from changes where op = $1 order by id desc for update', [head.op]);
  if (entries.some((e) => e.reverted_by)) throw new HttpError(409, 'Это действие уже отменено');
  const families = [];
  let first = null;
  for (const e of entries) {
    if (e.entity === 'family') families.push(e.entity_id);
    const id = e.entity === 'person' ? await undoPerson(db, userId, e) : await undoFamily(db, userId, e);
    first ??= id;
  }
  // Пустые семьи убираем в конце: по ходу отката они ещё нужны.
  await dropEmpty(db, userId, families);
  await db.q('update changes set reverted_by = $1 where op = $2', [first, head.op]);
}
