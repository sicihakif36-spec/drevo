// Анкета для родственника (shared/survey.js — что спрашиваем). Здесь — загрузка ответов в дерево:
// одно действие в журнале из обычных записей (люди, связи через link, дописанные поля, история, фото в альбом),
// поэтому откат отменяет его целиком уже существующими обратными операциями (revert.js).
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './tenants.js';
import { logChange } from './changes.js';
import { HttpError, PERSON_FIELDS, alive, link, addChild } from './tree.js';
import { createStory } from './stories.js';
import { snapshot } from './album.js';
import { mediaPath } from './routes/media.js';
import { cleanAnswers, surveyPeople, TEXT_FIELDS, ROLES } from '../../shared/survey.js';
import { fullName } from '../../shared/names.js';

export const SURVEY_DAYS = 30;
export const surveyPath = (id, thumb = false) => path.join(dataDir(), 'survey', thumb ? `${id}.thumb` : id);

// Состояние анкеты для списка: отправлена, заполняется, заполнена, загружена, отозвана, истекла.
// undone — загрузку отменили (и отмену не вернули): анкету можно загрузить снова.
export function surveyStatus(s, now = new Date()) {
  if (s.revoked_at) return 'revoked';
  if (s.loaded_op && !s.undone) return 'loaded';
  if (s.submitted_at) return 'submitted';
  if (s.expires_at < now) return 'expired';
  return s.saved_at ? 'filling' : 'sent';
}

// Для запроса: отменена ли загрузка анкеты s.
export const UNDONE = `exists (select 1 from changes c join changes r on r.id = c.reverted_by
  where c.op = s.loaded_op and r.reverted_by is null)`;

const trim = (v) => String(v ?? '').trim();

// Сведения о человеке из анкеты с поправками того, кто загружает (fix — только известные поля).
function personData(rec, fix = {}) {
  const out = {};
  for (const k of TEXT_FIELDS) out[k] = trim(k in fix ? fix[k] : rec[k]).slice(0, k === 'notes' ? 20000 : 300);
  const sex = 'sex' in fix ? fix.sex : rec.sex;
  out.sex = ['M', 'F'].includes(sex) ? sex : 'U';
  const living = 'living' in fix ? fix.living : rec.living;
  // «Жив» — если не сказано обратное и нет сведений о смерти.
  out.living = living === true || (living !== false && !out.death_date && !out.death_place);
  if (out.living) Object.assign(out, { death_date: '', death_place: '' });
  return out;
}

async function newPerson(db, userId, data) {
  const cols = Object.keys(data).filter((k) => PERSON_FIELDS.includes(k));
  const p = (await db.q(
    `insert into persons (${[...cols, 'created_by'].join(', ')}) values (${[...cols, 'u'].map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    [...cols.map((c) => data[c]), userId],
  ))[0];
  await logChange(db, userId, 'person', p.id, 'create', null, p);
  return p.id;
}

// Человек уже есть в дереве: дописать пустые поля; непустые — только из replace (явный выбор).
// «Жив» стоит по умолчанию, поэтому «умер» из анкеты без сведений о смерти в дереве — тоже дописывание.
// fields — какие текстовые поля сравнивать (у загрузки из файла их больше, чем в анкете).
export function fillPlan(cur, data, replace = [], fields = TEXT_FIELDS) {
  const set = {};
  for (const k of fields) if (data[k] && data[k] !== cur[k] && (!cur[k] || replace.includes(k))) set[k] = data[k];
  if (data.sex !== 'U' && data.sex !== cur.sex && (cur.sex === 'U' || replace.includes('sex'))) set.sex = data.sex;
  if (data.living !== cur.living) {
    const defaultLiving = cur.living && !cur.death_date && !cur.death_place;
    if ((!data.living && defaultLiving) || replace.includes('living')) set.living = data.living;
  }
  return set;
}

async function fillPerson(db, userId, id, data, replace) {
  const cur = (await db.q('select * from persons where id = $1 and deleted_at is null for update', [id]))[0];
  if (!cur) throw new HttpError(404, 'Человек из дерева, выбранный для совпадения, удалён. Обновите страницу.');
  const set = fillPlan(cur, data, replace);
  const cols = Object.keys(set);
  if (!cols.length) return;
  await db.q(`update persons set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() where id = $1`,
    [id, ...cols.map((c) => set[c])]);
  await logChange(db, userId, 'person', id, 'update', Object.fromEntries(cols.map((c) => [c, cur[c]])), set);
}

const parentFams = (db, id) => db.q(
  `select f.* from family_children c join families f on f.id = c.family_id where c.child_id = $1 order by f.created_at`, [id]);
const partnerFams = (db, id) => db.q('select * from families where partner1 = $1 or partner2 = $1 order by created_at', [id]);
const has = (f, id) => f.partner1 === id || f.partner2 === id;

// Связи по анкете. Уже существующие пропускаются; противоречащие дереву (например, у ребёнка уже двое других родителей)
// не делаются — о них остаётся заметка для того, кто загружал.
function linker(db, userId, notes) {
  const name = async (id) => fullName((await db.q('select surname, given, patronymic from persons where id = $1', [id]))[0]);
  const sexOf = async (id) => (await db.q('select sex from persons where id = $1', [id]))[0].sex;
  // Заметка с именами вместо {0}, {1}.
  const note = async (text, ...ids) => {
    let out = text;
    for (const [i, id] of ids.entries()) out = out.replace(`{${i}}`, await name(id));
    notes.push(out);
  };

  return {
    // Оба родителя уже пара в дереве, а у ребёнка родителей нет — в их семью, а не в новую.
    async parents(ps, c) {
      if (ps.length === 2 && !(await parentFams(db, c)).length) {
        const fam = (await partnerFams(db, ps[0])).find((f) => has(f, ps[1]));
        if (fam) return addChild(db, userId, fam.id, c);
      }
      for (const p of ps) await this.parent(p, c);
    },
    async parent(p, c) {
      const fams = await parentFams(db, c);
      if (fams.some((f) => has(f, p))) return;
      const fam = fams[0];
      if (fam) {
        const others = [fam.partner1, fam.partner2].filter(Boolean);
        const sex = await sexOf(p);
        const same = sex !== 'U' && (await Promise.all(others.map(sexOf))).includes(sex);
        if (others.length === 2 || same) return note('{0} — в дереве уже указаны другие родители; {1} не связан(а) как родитель', c, p);
      }
      await link(db, userId, { to: c, type: 'parent' }, p);
    },
    async spouse(a, b) {
      if ((await partnerFams(db, b)).some((f) => has(f, a))) return;
      await link(db, userId, { to: b, type: 'spouse' }, a);
    },
    async child(c, p, other) {
      const mine = await partnerFams(db, p);
      const kids = mine.length ? await db.q('select 1 from family_children where child_id = $1 and family_id = any($2)', [c, mine.map((f) => f.id)]) : [];
      if (kids.length) return;
      const theirs = await parentFams(db, c);
      if (theirs.length) {
        // У ребёнка уже есть родители: встать вторым родителем можно только рядом с тем же супругом.
        const fam = theirs.find((f) => other && has(f, other) && (!f.partner1 || !f.partner2));
        if (fam) return link(db, userId, { to: c, type: 'parent' }, p);
        return note('{0} — в дереве уже указаны другие родители; не связан(а) как ребёнок: {1}', c, p);
      }
      let fam = other ? mine.find((f) => has(f, other)) : mine.length === 1 ? mine[0] : mine.find((f) => !f.partner1 || !f.partner2);
      if (!fam && mine.length) {
        fam = (await db.q('insert into families (partner1, partner2) values ($1, null) returning *', [p]))[0];
        await logChange(db, userId, 'family', fam.id, 'create', null, { family: fam, children: [] }, [p]);
      }
      await link(db, userId, { to: p, type: 'child', familyId: fam?.id }, c);
    },
    async sibling(a, b) {
      const fa = await parentFams(db, a);
      const fb = await parentFams(db, b);
      if (fa.some((f) => fb.some((g) => g.id === f.id))) return;
      if (fa.length && fb.length) return note('{0} и {1} — в дереве у них разные родители; не связаны как братья и сёстры', a, b);
      // Добавляем в семью того, у кого родители уже указаны.
      if (fa.length) await link(db, userId, { to: a, type: 'sibling' }, b);
      else await link(db, userId, { to: b, type: 'sibling' }, a);
    },
  };
}

// Загрузить анкету s в дерево. plan — решения того, кто загружает:
// people: { [id записи]: { action: 'new' | 'match' | 'skip', person_id, fix: {поле: значение}, replace: [поля] } },
// story: false — без рассказа, photos: [id] — какие фото (по умолчанию все).
// -> { ids: { id записи: id человека }, notes: [что не связано] }
export async function loadSurvey(db, userId, s, plan = {}, files = []) {
  const answers = cleanAnswers(s.answers);
  const P = answers.people;
  const decisions = plan.people && typeof plan.people === 'object' ? plan.people : {};
  const ids = new Map();
  const used = new Map();
  for (const { role, person: rec } of surveyPeople(answers)) {
    const d = decisions[rec.id] || {};
    const action = ['new', 'match', 'skip'].includes(d.action) ? d.action : 'new';
    if (action === 'skip') {
      if (role === 'self') throw new HttpError(400, 'Того, кто заполнял анкету, пропустить нельзя: выберите «новый человек» или человека из дерева');
      continue;
    }
    const data = personData(rec, d.fix && typeof d.fix === 'object' ? d.fix : {});
    if (!data.given && !data.surname) throw new HttpError(400, `${ROLES[role].label}: укажите имя`);
    if (action === 'match') {
      const id = String(d.person_id || '');
      if (!/^[0-9a-f-]{36}$/.test(id) || !(await alive(db, id))) throw new HttpError(404, `${ROLES[role].label}: человек из дерева не найден. Обновите страницу.`);
      if (used.has(id)) throw new HttpError(400, `Один и тот же человек из дерева выбран дважды: ${ROLES[used.get(id)].label.toLowerCase()} и ${ROLES[role].label.toLowerCase()}`);
      used.set(id, role);
      await fillPerson(db, userId, id, data, Array.isArray(d.replace) ? d.replace : []);
      ids.set(rec.id, id);
    } else ids.set(rec.id, await newPerson(db, userId, data));
  }
  if (!ids.size) throw new HttpError(400, 'В анкете нет ни одного человека с именем');
  const self = ids.get(P.self.id);
  if (!self) throw new HttpError(400, 'В анкете не указано имя того, кто её заполнял');

  const notes = [];
  const L = linker(db, userId, notes);
  const id = (rec) => (rec ? ids.get(rec.id) : undefined);
  // Сначала родители: братья и сёстры потом встают в ту же семью.
  for (const [ps, c] of [[[P.father, P.mother], P.self], [[P.ff, P.fm], P.father], [[P.mf, P.mm], P.mother]]) {
    const known = ps.map(id).filter(Boolean);
    if (known.length && id(c)) await L.parents(known, id(c));
  }
  const spouses = P.spouse.filter((x) => id(x));
  for (const x of spouses) await L.spouse(id(x), self);
  for (const c of P.child.filter((x) => id(x))) {
    const other = spouses.find((x) => x.id === c.parent2) || (spouses.length === 1 ? spouses[0] : null);
    await L.child(id(c), self, other ? id(other) : null);
  }
  for (const x of P.sibling.filter((y) => id(y))) await L.sibling(id(x), self);

  if (plan.story !== false && answers.story.trim()) {
    const who = [P.self.given, P.self.patronymic].map(trim).filter(Boolean).join(' ') || s.name;
    await createStory(db, userId, self, { title: `Воспоминания: ${who}`.slice(0, 200), date: '', body: answers.story.trim() });
  }

  // Фото — в альбом того, кто заполнял: копии файлов анкеты (анкету можно загрузить снова, если загрузку отменят).
  const wanted = Array.isArray(plan.photos) ? new Set(plan.photos) : null;
  for (const f of files.filter((x) => !wanted || wanted.has(x.id))) {
    const mid = crypto.randomUUID();
    await fsp.copyFile(surveyPath(f.id), mediaPath(mid));
    if (f.thumb) await fsp.copyFile(surveyPath(f.id, true), mediaPath(mid, true));
    db.copied?.push(mid);
    const m = (await db.q(
      `insert into media (id, kind, mime, bytes, name, caption, date, thumb, created_by)
       values ($1, 'photo', $2, $3, $4, $5, '', $6, $7) returning *`,
      [mid, f.mime, f.bytes, f.name, f.caption, f.thumb, userId],
    ))[0];
    await db.q('insert into media_persons (media_id, person_id) values ($1, $2)', [mid, self]);
    await logChange(db, userId, 'media', mid, 'add', null, snapshot(m), [self]);
  }

  await db.q('update surveys set loaded_op = $2, loaded_by = $3, loaded_at = now() where id = $1', [s.id, db.op, userId]);
  return { ids: Object.fromEntries(ids), notes };
}

