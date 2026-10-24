// Загрузка дерева из файла GEDCOM (разбор — src/gedcom.js). Предпросмотр: кто из файла, возможно, уже есть в дереве.
// Загрузка — одно действие в журнале из обычных записей (люди, семьи и дети, события, источники, цитаты, достоверность),
// поэтому откат отменяет её целиком уже существующими обратными операциями (revert.js). Первая запись действия — 'import'
// со сводкой: по ней лента пишет одну строку «загрузка из файла — 186 человек», а не сотни.
import { logChange } from './changes.js';
import { HttpError, PERSON_FIELDS, alive, addChild, setPartner } from './tree.js';
import { fillPlan } from './surveys.js';
import { createEvent } from './timeline.js';
import { createSource, cite, setQuality } from './sources.js';
import { matchScore } from '../../shared/survey.js';
import { looseName, fullName, spellings } from '../../shared/names.js';
import { citeText } from '../../shared/sources.js';

// Поля человека, которые дописываются найденному в дереве.
export const FILL_FIELDS = ['surname', 'given', 'patronymic', 'birth_surname', 'alt_surname', 'alt_given', 'alt_patronymic', 'birth_date', 'birth_place', 'death_date', 'death_place',
  'burial_place', 'occupation', 'notes'];

// Кто из дерева может быть этим человеком, самые похожие первыми (как findMatches в анкете, но по указателю имён: людей тысячи).
export function matchIndex(treePersons) {
  const byName = new Map();
  // По имени в любом написании: «Рәшит» и «Рашит» — в одной ячейке, «Гыйльмия» и «Гильмия» — тоже.
  for (const p of treePersons) {
    for (const k of new Set(spellings(p).map((x) => looseName(x.given)))) if (k) byName.set(k, [...(byName.get(k) || []), p]);
  }
  const cands = (rec) => [...new Set(spellings(rec).flatMap((x) => byName.get(looseName(x.given)) || []))];
  return (rec, limit = 3) => cands(rec)
    .map((p) => ({ p, score: matchScore(rec, p) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p.id);
}

// Предпросмотр для телефона: сводка, что не загрузится, люди файла с родными (для подсказки, кто это) и возможными совпадениями.
export function previewGedcom(g, treePersons) {
  const find = matchIndex(treePersons);
  const rel = new Map(g.persons.map((p) => [p.ref, { parents: [], spouses: [], children: [] }]));
  for (const f of g.families) {
    const pair = [f.husb, f.wife].filter(Boolean);
    for (const a of pair) for (const b of pair) if (a !== b) rel.get(a).spouses.push(b);
    for (const c of f.children) {
      rel.get(c.ref).parents.push(...pair);
      for (const a of pair) rel.get(a).children.push(c.ref);
    }
  }
  const events = new Map();
  for (const ev of g.events) for (const r of ev.persons) events.set(r, (events.get(r) || 0) + 1);
  return {
    counts: g.counts,
    skipped: g.skipped,
    encoding: g.encoding,
    people: g.persons.map((p) => ({ ...p, ...rel.get(p.ref), events: events.get(p.ref) || 0, cands: find(p) })),
  };
}

const uuid = (v) => /^[0-9a-f-]{36}$/.test(String(v || ''));

// Загрузить разобранный файл g. plan.people: { [ref]: { action: 'new' | 'match' | 'skip', person_id, replace: [поля] } },
// без решения — новый человек. -> { ids: { ref: id }, created, matched, notes: [что не связано], change }.
export async function loadGedcom(db, userId, g, plan = {}, file = '') {
  const decisions = plan.people && typeof plan.people === 'object' ? plan.people : {};
  const notes = [];
  // Сводка — первой записью: в ленте и «Последних правках» она главная строка. Числа дописываются в конце.
  const head = await logChange(db, userId, 'import', db.importId, 'load', null, { file }, []);

  const ids = new Map(); // ref -> id в дереве
  const matched = new Set(); // id найденных в дереве
  const final = new Map(); // id -> сведения после загрузки (для цитат)
  const used = new Map();
  let created = 0;
  const cols = PERSON_FIELDS.filter((c) => c !== 'photo_id');
  for (const p of g.persons) {
    const d = decisions[p.ref] || {};
    const action = ['match', 'skip'].includes(d.action) ? d.action : 'new';
    if (action === 'skip') continue;
    if (action === 'match') {
      if (!uuid(d.person_id) || !(await alive(db, d.person_id))) throw new HttpError(404, `${fullName(p)}: человек из дерева не найден. Обновите страницу.`);
      if (used.has(d.person_id)) throw new HttpError(400, `Один и тот же человек из дерева выбран дважды: ${fullName(used.get(d.person_id))} и ${fullName(p)}`);
      used.set(d.person_id, p);
      const cur = (await db.q('select * from persons where id = $1 for update', [d.person_id]))[0];
      const set = fillPlan(cur, p, Array.isArray(d.replace) ? d.replace : [], FILL_FIELDS);
      const keys = Object.keys(set);
      if (keys.length) {
        await db.q(`update persons set ${keys.map((c, i) => `${c} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = now() where id = $1`,
          [cur.id, ...keys.map((c) => set[c])]);
        await logChange(db, userId, 'person', cur.id, 'update', Object.fromEntries(keys.map((c) => [c, cur[c]])), set);
      }
      ids.set(p.ref, cur.id);
      matched.add(cur.id);
      final.set(cur.id, { ...cur, ...set });
      continue;
    }
    const row = (await db.q(
      `insert into persons (${[...cols, 'created_by'].join(', ')}) values (${[...cols, 'u'].map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
      [...cols.map((c) => p[c]), userId],
    ))[0];
    await logChange(db, userId, 'person', row.id, 'create', null, row);
    ids.set(p.ref, row.id);
    final.set(row.id, row);
    created++;
  }
  if (!ids.size) throw new HttpError(400, 'Нечего загружать: все люди из файла пропущены');
  const name = (id) => fullName(final.get(id));

  // Семьи. Если кто-то из семьи найден в дереве — ищем его семью, чтобы дополнить её, а не завести вторую такую же.
  const famIds = new Map();
  let families = 0;
  for (const f of g.families) {
    const partners = [...new Set([f.husb, f.wife].map((r) => ids.get(r)).filter(Boolean))];
    const kidsIn = f.children.filter((c) => ids.has(c.ref)).map((c) => ({ id: ids.get(c.ref), kind: c.kind }))
      .filter((c) => !partners.includes(c.id));
    if (!partners.length && kidsIn.length < 2) continue;
    const old = [...partners, ...kidsIn.map((c) => c.id)].some((id) => matched.has(id));
    let fam = old ? await existingFamily(db, partners, kidsIn.map((c) => c.id)) : null;
    if (fam) {
      for (const p of partners) {
        if (fam.partner1 === p || fam.partner2 === p) continue;
        const slot = !fam.partner1 ? 'partner1' : !fam.partner2 ? 'partner2' : null;
        if (!slot) { notes.push(`${name(p)} — в дереве у семьи уже двое супругов; не связан(а)`); continue; }
        await setPartner(db, userId, fam.id, slot, p);
        fam[slot] = p;
      }
      // Сведения о браке — только в пустые поля.
      const set = {};
      for (const k of ['start_date', 'place', 'end_date', 'ended']) if (f[k] && !fam[k]) set[k] = f[k];
      const keys = Object.keys(set);
      if (keys.length) {
        await db.q(`update families set ${keys.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [fam.id, ...keys.map((c) => set[c])]);
        await logChange(db, userId, 'family', fam.id, 'update', Object.fromEntries(keys.map((c) => [c, fam[c]])), set, [fam.partner1, fam.partner2]);
      }
    } else {
      fam = (await db.q(
        `insert into families (partner1, partner2, kind, start_date, place, end_date, ended) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [partners[0] || null, partners[1] || null, f.kind, f.start_date, f.place, f.end_date, f.ended],
      ))[0];
      await logChange(db, userId, 'family', fam.id, 'create', null, { family: fam, children: [] }, partners);
      families++;
    }
    famIds.set(f.ref, fam.id);
    const inFam = new Set((await db.q('select child_id from family_children where family_id = $1', [fam.id])).map((r) => r.child_id));
    for (const c of kidsIn) {
      if (inFam.has(c.id)) continue;
      // У найденного в дереве ребёнка уже есть другие родители — не путаем.
      if (matched.has(c.id) && (await db.q('select 1 from family_children where child_id = $1', [c.id]))[0]) {
        notes.push(`${name(c.id)} — в дереве уже указаны другие родители; не связан(а) с семьёй ${[fam.partner1, fam.partner2].filter(Boolean).map(name).join(' и ')}`);
        continue;
      }
      await addChild(db, userId, fam.id, c.id, c.kind);
      inFam.add(c.id);
    }
  }

  // События ленты жизни. Такое же событие у найденного в дереве человека уже есть — не повторяем.
  const evIds = new Map();
  let events = 0;
  for (const ev of g.events) {
    const persons = [...new Set(ev.persons.map((r) => ids.get(r)).filter(Boolean))];
    if (!persons.length) continue;
    const same = persons.some((id) => matched.has(id)) ? (await db.q(
      `select e.id from life_events e join event_persons ep on ep.event_id = e.id
       where ep.person_id = any($1) and e.deleted_at is null and e.kind = $2 and e.date = $3 and e.title = $4 and e.place = $5 limit 1`,
      [persons.filter((id) => matched.has(id)), ev.kind, ev.date, ev.title, ev.place]))[0] : null;
    if (same) continue;
    const { kind, date, place, title, body, unit, rank } = ev;
    evIds.set(ev.ref, (await createEvent(db, userId, persons, { kind, date, place, title, body, unit, rank })).id);
    events++;
  }

  // Источники: заводятся, когда на них первый раз ссылаются (у пропущенных людей — нет); такой же источник в дереве — он и есть.
  const srcIds = new Map();
  let sources = 0;
  const key = (s) => [s.kind, s.title, citeText(s), s.url].map((x) => String(x || '').trim().toLowerCase()).join('|');
  const tree = new Map((await db.q('select * from sources where deleted_at is null')).map((s) => [key(s), s.id]));
  const byRef = new Map(g.sources.map((s) => [s.ref, s]));
  const source = async (ref) => {
    if (srcIds.has(ref)) return srcIds.get(ref);
    const s = byRef.get(ref);
    let id = tree.get(key(s));
    if (!id) {
      const { kind, title, archive, fond, opis, delo, sheet, verso, url, note } = s;
      id = (await createSource(db, userId, { kind, title, archive, fond, opis, delo, sheet, verso, url, note })).id;
      tree.set(key(s), id);
      sources++;
    }
    srcIds.set(ref, id);
    return id;
  };
  const fromFile = new Map(g.persons.map((p) => [p.ref, p]));
  // Сведение, к которому привязать цитату: у найденного в дереве — только если в дереве теперь то же, что в файле.
  const subjectOf = (x) => {
    if (x.subject === 'family') return famIds.get(x.ref);
    if (x.subject === 'event') return evIds.get(x.ref);
    const id = ids.get(x.ref);
    if (!id || !matched.has(id) || ['name', 'other'].includes(x.fact)) return id;
    return final.get(id)[x.fact] === fromFile.get(x.ref)[x.fact] ? id : null;
  };
  for (const c of g.citations) {
    const sid = subjectOf(c);
    if (sid) await cite(db, userId, { source_id: await source(c.sref), subject: c.subject, subject_id: sid, fact: c.fact, page: c.page });
  }
  for (const x of g.quality) {
    const sid = subjectOf(x);
    if (!sid) continue;
    const cur = (await db.q('select 1 from fact_quality where subject = $1 and subject_id = $2 and fact = $3', [x.subject, sid, x.fact]))[0];
    if (!cur) await setQuality(db, userId, { subject: x.subject, subject_id: sid, fact: x.fact }, x.quality);
  }
  // Источники, на которые в файле никто не ссылается, — тоже в дерево: их туда положили не зря.
  const cited = new Set(g.citations.map((c) => c.sref));
  for (const s of g.sources) if (!cited.has(s.ref)) await source(s.ref);

  const summary = { file, persons: created, matched: matched.size, families, events, sources };
  await db.q('update changes set after = $2 where id = $1', [head, JSON.stringify(summary)]);
  return { ids: Object.fromEntries(ids), ...summary, notes, change: head };
}

// Семья из дерева, которую дополняет семья из файла: в ней нет чужих супругов и она та же — оба супруга совпали
// или в ней уже есть кто-то из детей.
async function existingFamily(db, partners, kidIds) {
  const fams = await db.q(
    `select f.*, array(select child_id from family_children c where c.family_id = f.id) as kids from families f
     where f.partner1 = any($1) or f.partner2 = any($1) or f.id in (select family_id from family_children where child_id = any($2))`,
    [partners, kidIds]);
  let best = null;
  let bestScore = 0;
  for (const f of fams) {
    const theirs = [f.partner1, f.partner2].filter(Boolean);
    const missing = partners.filter((p) => !theirs.includes(p));
    if (theirs.length + missing.length > 2) continue;
    const common = f.kids.filter((k) => kidIds.includes(k)).length;
    const both = partners.length === 2 && !missing.length;
    if (!both && !common) continue;
    const score = (2 - missing.length) * 10 + common;
    if (score > bestScore) [best, bestScore] = [f, score];
  }
  if (best) delete best.kids;
  return best;
}
