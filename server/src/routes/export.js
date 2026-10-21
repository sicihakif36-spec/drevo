import { need } from '../auth.js';
import { loadTreeData } from './print.js';
import { sourceData } from './sources.js';
import { citeText, sourceTitle, QUALITY, KINDS } from '../../../shared/sources.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// «12.03.1890» -> «12 MAR 1890», «около 1890» -> «ABT 1890», иначе фраза в скобках.
export function gedDate(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const low = t.toLowerCase();
  let prefix = '';
  if (/^(около|ок\.|~|примерно)/.test(low)) prefix = 'ABT ';
  else if (/^до\b/.test(low)) prefix = 'BEF ';
  else if (/^после\b/.test(low)) prefix = 'AFT ';
  const between = low.match(/между\s+(\d{3,4})\s+и\s+(\d{3,4})/);
  if (between) return `BET ${between[1]} AND ${between[2]}`;
  const core = t.replace(/^(около|ок\.|~|примерно|до|после)\s*/i, '');
  let m = core.match(/^(\d{1,2})\.(\d{1,2})\.(\d{3,4})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${prefix}${Number(m[1])} ${MONTHS[Number(m[2]) - 1]} ${m[3]}`;
  m = core.match(/^(\d{1,2})\.(\d{3,4})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${prefix}${MONTHS[Number(m[1]) - 1]} ${m[2]}`;
  m = core.match(/^(\d{3,4})$/);
  if (m) return `${prefix}${m[1]}`;
  return `(${t.replace(/[()]/g, '')})`;
}

// Сведение -> событие GEDCOM, под которым стоят его источники. «Другое» — источник у самого человека.
const FACT_TAG = {
  name: 'NAME', birth_date: 'BIRT', birth_place: 'BIRT', death_date: 'DEAT', death_place: 'DEAT', burial_place: 'BURI',
  occupation: 'OCCU', marriage: 'MARR', other: '',
};

// data.sources, data.citations, data.quality — источники (routes/sources.js, sourceData); без них — только дерево.
export function toGedcom(data) {
  const ids = new Map(data.persons.map((p, i) => [p.id, `@I${i + 1}@`]));
  const fids = new Map(data.families.map((f, i) => [f.id, `@F${i + 1}@`]));
  const sids = new Map((data.sources || []).map((s, i) => [s.id, `@S${i + 1}@`]));
  const L = ['0 HEAD', '1 SOUR DREVO', '2 NAME Древо', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', '1 LANG Russian'];
  const flat = (v) => String(v).replace(/\r?\n/g, ' ');
  const line = (lvl, tag, val) => { if (val) L.push(`${lvl} ${tag} ${flat(val)}`); };
  const note = (lvl, text) => {
    const parts = String(text).split(/\r?\n/);
    L.push(`${lvl} NOTE ${parts[0]}`);
    for (const part of parts.slice(1)) L.push(`${lvl + 1} CONT ${part}`);
  };
  // Цитаты под событием tag: источники сведений с уточнением (PAGE) и достоверностью (QUAY).
  // Достоверность без источника — цитата-описание: «2 SOUR со слов» с QUAY.
  const quality = new Map((data.quality || []).map((x) => [`${x.subject_id}:${x.fact}`, x.quality]));
  const cites = new Map();
  for (const c of data.citations || []) {
    if (!sids.has(c.source_id)) continue;
    const k = `${c.subject_id}:${FACT_TAG[c.fact]}`;
    cites.set(k, [...(cites.get(k) || []), c]);
  }
  const sources = (lvl, subjectId, tag) => {
    const done = new Set();
    for (const c of cites.get(`${subjectId}:${tag}`) || []) {
      if (done.has(c.source_id + c.page)) continue;
      done.add(c.source_id + c.page);
      L.push(`${lvl} SOUR ${sids.get(c.source_id)}`);
      line(lvl + 1, 'PAGE', c.page);
      const qy = quality.get(`${subjectId}:${c.fact}`);
      if (qy) L.push(`${lvl + 1} QUAY ${QUALITY[qy].quay}`);
    }
    // Достоверность сведений этого события, у которых источника нет.
    const facts = Object.keys(FACT_TAG).filter((f) => FACT_TAG[f] === tag);
    for (const f of facts) {
      const qy = quality.get(`${subjectId}:${f}`);
      if (!qy || (cites.get(`${subjectId}:${tag}`) || []).some((c) => c.fact === f)) continue;
      L.push(`${lvl} SOUR ${QUALITY[qy].label.toLowerCase()}`);
      L.push(`${lvl + 1} QUAY ${QUALITY[qy].quay}`);
    }
  };
  const event = (tag, date, place, subjectId) => {
    if (!date && !place) return;
    L.push(`1 ${tag}`);
    line(2, 'DATE', gedDate(date));
    line(2, 'PLAC', place);
    sources(2, subjectId, tag);
  };
  for (const p of data.persons) {
    L.push(`0 ${ids.get(p.id)} INDI`);
    const given = [p.given, p.patronymic].filter(Boolean).join(' ');
    L.push(`1 NAME ${given} /${p.surname}/`.replace(/\s+/g, ' ').trim());
    line(2, 'GIVN', p.given);
    line(2, 'SURN', p.surname);
    line(2, '_PATR', p.patronymic);
    sources(2, p.id, 'NAME');
    if (p.birth_surname && p.birth_surname !== p.surname) {
      L.push(`1 NAME ${given} /${p.birth_surname}/`.replace(/\s+/g, ' ').trim());
      L.push('2 TYPE birth');
    }
    line(1, 'SEX', p.sex === 'U' ? 'U' : p.sex);
    event('BIRT', p.birth_date, p.birth_place, p.id);
    if (!p.living) {
      if (p.death_date || p.death_place) event('DEAT', p.death_date, p.death_place, p.id);
      else {
        L.push('1 DEAT Y');
        sources(2, p.id, 'DEAT');
      }
    }
    if (p.burial_place) event('BURI', '', p.burial_place, p.id);
    if (p.occupation) {
      line(1, 'OCCU', p.occupation);
      sources(2, p.id, 'OCCU');
    }
    if (p.notes) note(1, p.notes);
    sources(1, p.id, '');
    for (const f of data.families) if (f.partner1 === p.id || f.partner2 === p.id) L.push(`1 FAMS ${fids.get(f.id)}`);
    for (const c of data.children) if (c.child_id === p.id && fids.has(c.family_id)) L.push(`1 FAMC ${fids.get(c.family_id)}`);
  }
  const sex = new Map(data.persons.map((p) => [p.id, p.sex]));
  for (const f of data.families) {
    L.push(`0 ${fids.get(f.id)} FAM`);
    let [h, w] = [f.partner1, f.partner2];
    if (sex.get(h) === 'F' || sex.get(w) === 'M') [h, w] = [w, h];
    if (h && ids.has(h)) L.push(`1 HUSB ${ids.get(h)}`);
    if (w && ids.has(w)) L.push(`1 WIFE ${ids.get(w)}`);
    for (const c of data.children) if (c.family_id === f.id && ids.has(c.child_id)) L.push(`1 CHIL ${ids.get(c.child_id)}`);
    if (f.kind === 'marriage' && (f.start_date || (f.partner1 && f.partner2))) {
      if (f.start_date) event('MARR', f.start_date, '', f.id);
      else {
        L.push('1 MARR Y');
        sources(2, f.id, 'MARR');
      }
    }
    if (f.ended === 'divorce') { if (f.end_date) event('DIV', f.end_date, ''); else L.push('1 DIV Y'); }
  }
  // Источники: название, шифр дела, ссылка и заметка.
  for (const s of data.sources || []) {
    L.push(`0 ${sids.get(s.id)} SOUR`);
    line(1, 'TITL', sourceTitle(s));
    line(1, 'ABBR', citeText(s));
    line(1, '_TYPE', KINDS[s.kind]?.label);
    const text = [s.url, s.note].filter(Boolean).join('\n');
    if (text) note(1, text);
  }
  L.push('0 TRLR');
  return L.join('\n') + '\n';
}

export default async function exportRoutes(app) {
  app.get('/api/export.ged', { preHandler: need('viewer') }, async (req, reply) => {
    const data = { ...(await loadTreeData(req.user)), ...(await sourceData(req.user)) };
    const date = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="drevo-${date}.ged"`);
    return toGedcom(data);
  });
}
