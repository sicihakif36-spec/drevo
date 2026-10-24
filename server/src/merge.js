// Объединение двух карточек одного человека: всё со второй карточки (remove) переносится на первую (keep), вторая удаляется.
// Одно действие в журнале, отменяется целиком. Порядок записей важен — откат идёт с конца:
// 1. person 'merge' — перенос привязок, у которых нет своих записей журнала: отметки на фото и в документах, истории,
//    события ленты жизни, источники и достоверность, обсуждение, вопросы исследования, «это я» у пользователей, приглашения, анкеты,
//    вопросы родным.
//    Снимок — какие строки перенесены и какие убраны как повтор: откат ('unmerge') возвращает в точности их.
// 2. Связи — обычными записями семьи (set_partner, add_child, drop…), их откат уже есть.
// 3. Поля карточки — person 'update', главное фото — person 'photo'.
// 4. Вторая карточка — person 'delete' (к этому моменту у неё нет ни связей, ни привязок).
import { logChange } from './changes.js';
import {
  HttpError, FAMILY_FIELDS, SLOTS, addChild, removeChild, setPartner, unsetPartner, dropFamily, dropEmpty, deletePerson,
} from './tree.js';
import { setMain } from './album.js';
import { MERGE_FIELDS, mergedPerson } from '../../shared/checks.js';
import { fullName } from '../../shared/names.js';

// Таблицы «файл/история/событие — человек»: ключ строки — первый столбец.
const LINKS = [['media_persons', 'media_id'], ['story_persons', 'story_id'], ['event_persons', 'event_id']];
// Просто ссылки на человека: строка переносится целиком. Приглашение — по md5 хеша токена: сам хеш в журнал не пишем.
const REFS = [['comments', 'id'], ['research_questions', 'id'], ['users', 'id'], ['surveys', 'id'], ['invites', 'md5(token_hash)'], ['asks', 'id']];

const LATER = 'После объединения были другие правки. Сначала отмените их.';

// Что перенести. subjects — пары [откуда, куда] для источников и достоверности: человек и слитые семьи.
// prefer — у какого сведения оставить достоверность, если она есть у обоих: { 'person:birth_date': 'remove' }.
async function planMoves(db, from, into, subjects, prefer = {}) {
  const plan = { from, into, links: {}, refs: {}, citations: { moved: [], dropped: [] }, quality: { moved: [], dropped: [] } };
  for (const [table, key] of LINKS) {
    const rows = await db.q(
      `select ${key} as k, exists (select 1 from ${table} y where y.${key} = x.${key} and y.person_id = $2) as dup
       from ${table} x where person_id = $1 order by ${key}`, [from, into]);
    plan.links[table] = { moved: rows.filter((r) => !r.dup).map((r) => r.k), dropped: rows.filter((r) => r.dup).map((r) => r.k) };
  }
  for (const [table, key] of REFS) {
    plan.refs[table] = (await db.q(`select ${key} as k from ${table} where person_id = $1 order by 1`, [from])).map((r) => r.k);
  }
  for (const [subject, a, b] of subjects) {
    for (const c of await db.q('select * from citations where subject = $1 and subject_id = $2 order by id', [subject, a])) {
      const dup = (await db.q('select 1 from citations where subject = $1 and subject_id = $2 and fact = $3 and source_id = $4',
        [subject, b, c.fact, c.source_id]))[0];
      if (dup) plan.citations.dropped.push(c);
      else plan.citations.moved.push([c.id, a, b]);
    }
    for (const x of await db.q('select * from fact_quality where subject = $1 and subject_id = $2 order by fact', [subject, a])) {
      const there = (await db.q('select * from fact_quality where subject = $1 and subject_id = $2 and fact = $3', [subject, b, x.fact]))[0];
      // Достоверность есть у обоих: остаётся та, чьё значение выбрано.
      if (there && prefer[`${subject}:${x.fact}`] !== 'remove') plan.quality.dropped.push(x);
      else {
        if (there) plan.quality.dropped.push(there);
        plan.quality.moved.push([subject, a, b, x.fact]);
      }
    }
  }
  return plan;
}

// Применить перенос: forward — с from на into, иначе обратно. Строки, которых уже нет на месте, — значит, после были правки.
async function applyMoves(db, plan, forward) {
  const [a, b] = forward ? [plan.from, plan.into] : [plan.into, plan.from];
  const must = (rows) => { if (!rows.length) throw new HttpError(409, LATER); };
  const ins = (table, row) => {
    const cols = Object.keys(row);
    return db.q(`insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]));
  };
  if (forward) {
    for (const c of plan.citations.dropped) must(await db.q('delete from citations where id = $1 returning 1', [c.id]));
    for (const x of plan.quality.dropped) {
      must(await db.q('delete from fact_quality where subject = $1 and subject_id = $2 and fact = $3 returning 1', [x.subject, x.subject_id, x.fact]));
    }
  }
  for (const [table, key] of LINKS) {
    const { moved, dropped } = plan.links[table];
    for (const k of moved) must(await db.q(`update ${table} set person_id = $3 where ${key} = $1 and person_id = $2 returning 1`, [k, a, b]));
    for (const k of dropped) {
      if (forward) must(await db.q(`delete from ${table} where ${key} = $1 and person_id = $2 returning 1`, [k, a]));
      else await db.q(`insert into ${table} (${key}, person_id) values ($1, $2) on conflict do nothing`, [k, b]);
    }
  }
  for (const [table, key] of REFS) {
    // Ссылки не обязаны остаться: пользователь мог сам указать себя другим человеком. Переносим те, что на месте.
    // В записях до появления вопросов родным их нет.
    for (const k of plan.refs[table] || []) await db.q(`update ${table} set person_id = $3 where ${key} = $1 and person_id = $2`, [k, a, b]);
  }
  for (const [id, x, y] of plan.citations.moved) {
    const [from, to] = forward ? [x, y] : [y, x];
    must(await db.q('update citations set subject_id = $3 where id = $1 and subject_id = $2 returning 1', [id, from, to]));
  }
  for (const [subject, x, y, fact] of plan.quality.moved) {
    const [from, to] = forward ? [x, y] : [y, x];
    if ((await db.q('select 1 from fact_quality where subject = $1 and subject_id = $2 and fact = $3', [subject, to, fact]))[0]) throw new HttpError(409, LATER);
    must(await db.q('update fact_quality set subject_id = $3 where subject = $1 and subject_id = $2 and fact = $4 returning 1', [subject, from, to, fact]));
  }
  if (!forward) {
    for (const c of plan.citations.dropped) await ins('citations', c);
    for (const x of plan.quality.dropped) await ins('fact_quality', x);
  }
}

// Откат и повтор записи 'merge' (revert.js).
export async function undoMerge(db, userId, e) {
  const forward = e.action === 'unmerge';
  const plan = forward ? e.before : e.after;
  await applyMoves(db, plan, forward);
  return forward
    ? logChange(db, userId, 'person', e.entity_id, 'merge', null, plan, [plan.into, plan.from])
    : logChange(db, userId, 'person', e.entity_id, 'unmerge', plan, null, [plan.into, plan.from]);
}

const partners = (f) => SLOTS.map((s) => f[s]).filter(Boolean);
const kids = async (db, fid) => db.q('select child_id, kind from family_children where family_id = $1 order by child_id', [fid]);

// Объединить: keep остаётся, remove удаляется. choice — { поле: 'keep' | 'remove' | 'both' }, photo — 'keep' | 'remove'.
// versions — { keep, remove }: карточки не менялись с тех пор, как их сравнивали.
export async function mergePersons(db, userId, { keep: keepId, remove: removeId, choice = {}, photo = 'keep', versions = {} }) {
  if (!keepId || !removeId || keepId === removeId) throw new HttpError(400, 'Выберите две разные карточки');
  const rows = await db.q('select * from persons where id = any($1) and deleted_at is null order by id for update', [[keepId, removeId]]);
  const keep = rows.find((p) => p.id === keepId);
  const remove = rows.find((p) => p.id === removeId);
  if (!keep || !remove) throw new HttpError(404, 'Человек не найден');
  if ((versions.keep && Number(versions.keep) !== keep.version) || (versions.remove && Number(versions.remove) !== remove.version)) {
    throw new HttpError(409, 'Карточку только что изменил кто-то другой. Проверьте и объедините ещё раз.');
  }
  const fams = await db.q('select * from families where partner1 = any($1) or partner2 = any($1) or id in (select family_id from family_children where child_id = any($1)) order by created_at, id for update', [[keepId, removeId]]);
  const fc = await db.q('select * from family_children where family_id = any($1)', [fams.map((f) => f.id)]);
  const childOf = (pid) => fams.filter((f) => fc.some((c) => c.family_id === f.id && c.child_id === pid));
  const spouseOf = (pid) => fams.filter((f) => partners(f).includes(pid));
  if (childOf(keepId).some((f) => partners(f).includes(removeId)) || childOf(removeId).some((f) => partners(f).includes(keepId))) {
    throw new HttpError(400, 'Нельзя объединить родителя с ребёнком: это точно разные люди');
  }

  // Браки второй карточки с тем же мужем или женой, что у первой, сливаются в один.
  const mergeInto = new Map();
  for (const f of spouseOf(removeId)) {
    const other = partners(f).find((x) => x !== removeId) || null;
    if (other === keepId) continue;
    const g = spouseOf(keepId).find((x) => x.id !== f.id && (partners(x).find((y) => y !== keepId) || null) === other);
    if (g) mergeInto.set(f.id, g);
  }

  // 1. Привязки.
  const prefer = Object.fromEntries(Object.entries(choice).map(([k, v]) => [`person:${['surname', 'given', 'patronymic'].includes(k) ? 'name' : k}`, v]));
  const plan = await planMoves(db, removeId, keepId,
    [['person', removeId, keepId], ...[...mergeInto].map(([fid, g]) => ['family', fid, g.id])], prefer);
  await applyMoves(db, plan, true);
  const changeId = await logChange(db, userId, 'person', keepId, 'merge', null, { ...plan, name: fullName(remove) }, [keepId, removeId]);

  // 2. Связи. Браки.
  const touched = [];
  for (const f of spouseOf(removeId)) {
    const slot = SLOTS.find((s) => f[s] === removeId);
    const g = mergeInto.get(f.id);
    if (partners(f).includes(keepId)) {
      await unsetPartner(db, userId, f.id, slot, removeId);
      touched.push(f.id);
    } else if (g) {
      const have = new Set((await kids(db, g.id)).map((c) => c.child_id));
      for (const c of await kids(db, f.id)) {
        await removeChild(db, userId, f.id, c.child_id);
        if (!have.has(c.child_id)) await addChild(db, userId, g.id, c.child_id, c.kind);
      }
      // Сведения о браке, которых нет у оставшегося, — со слитого.
      const cols = FAMILY_FIELDS.filter((c) => c !== 'kind' && !g[c] && f[c]);
      if (cols.length) {
        await db.q(`update families set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [g.id, ...cols.map((c) => f[c])]);
        await logChange(db, userId, 'family', g.id, 'update', Object.fromEntries(cols.map((c) => [c, g[c]])),
          Object.fromEntries(cols.map((c) => [c, f[c]])), partners(g));
      }
      await dropFamily(db, userId, (await db.q('select * from families where id = $1', [f.id]))[0]);
    } else {
      await unsetPartner(db, userId, f.id, slot, removeId);
      await setPartner(db, userId, f.id, slot, keepId);
    }
  }
  // Родители.
  for (const f of childOf(removeId)) {
    const kind = fc.find((c) => c.family_id === f.id && c.child_id === removeId).kind;
    const mine = (await db.q('select f.* from family_children c join families f on f.id = c.family_id where c.child_id = $1 order by f.created_at, f.id', [keepId]));
    await removeChild(db, userId, f.id, removeId);
    touched.push(f.id);
    if (mine.some((g) => g.id === f.id)) continue;
    const pf = partners(f);
    // Эти родители у оставшегося уже есть.
    if (pf.length && mine.some((g) => pf.every((x) => partners(g).includes(x)))) continue;
    const g = mine.find((x) => partners(x).length && partners(x).every((y) => pf.includes(y)));
    if (g) {
      // У оставшегося родителей меньше: переходит в семью, где они все и ещё другие.
      const k = (await db.q('select kind from family_children where family_id = $1 and child_id = $2', [g.id, keepId]))[0].kind;
      await removeChild(db, userId, g.id, keepId);
      await addChild(db, userId, f.id, keepId, k);
      if (!(await kids(db, g.id)).length && partners(g).length < 2) await dropFamily(db, userId, (await db.q('select * from families where id = $1', [g.id]))[0]);
      continue;
    }
    await addChild(db, userId, f.id, keepId, kind);
  }

  // 3. Поля и главное фото.
  const merged = mergedPerson(keep, remove, choice);
  const cols = MERGE_FIELDS.filter((c) => merged[c] !== keep[c]);
  if (cols.length) {
    await db.q(`update persons set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() where id = $1`,
      [keepId, ...cols.map((c) => merged[c])]);
    await logChange(db, userId, 'person', keepId, 'update', Object.fromEntries(cols.map((c) => [c, keep[c]])), Object.fromEntries(cols.map((c) => [c, merged[c]])));
  }
  if (photo === 'remove' && remove.photo_id) await setMain(db, userId, keepId, remove.photo_id);

  // 4. Вторая карточка.
  await deletePerson(db, userId, removeId);
  await dropEmpty(db, userId, touched);
  return { ok: true, id: keepId, changeId };
}
