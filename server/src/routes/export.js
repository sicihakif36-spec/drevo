import { need } from '../auth.js';
import { loadTreeData } from './print.js';

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

export function toGedcom(data) {
  const ids = new Map(data.persons.map((p, i) => [p.id, `@I${i + 1}@`]));
  const fids = new Map(data.families.map((f, i) => [f.id, `@F${i + 1}@`]));
  const L = ['0 HEAD', '1 SOUR DREVO', '2 NAME Древо', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', '1 LANG Russian'];
  const line = (lvl, tag, val) => { if (val) L.push(`${lvl} ${tag} ${String(val).replace(/\r?\n/g, ' ')}`); };
  const event = (tag, date, place) => {
    if (!date && !place) return;
    L.push(`1 ${tag}`);
    line(2, 'DATE', gedDate(date));
    line(2, 'PLAC', place);
  };
  for (const p of data.persons) {
    L.push(`0 ${ids.get(p.id)} INDI`);
    const given = [p.given, p.patronymic].filter(Boolean).join(' ');
    L.push(`1 NAME ${given} /${p.surname}/`.replace(/\s+/g, ' ').trim());
    line(2, 'GIVN', p.given);
    line(2, 'SURN', p.surname);
    line(2, '_PATR', p.patronymic);
    if (p.birth_surname && p.birth_surname !== p.surname) {
      L.push(`1 NAME ${given} /${p.birth_surname}/`.replace(/\s+/g, ' ').trim());
      L.push('2 TYPE birth');
    }
    line(1, 'SEX', p.sex === 'U' ? 'U' : p.sex);
    event('BIRT', p.birth_date, p.birth_place);
    if (!p.living) {
      if (p.death_date || p.death_place) event('DEAT', p.death_date, p.death_place);
      else L.push('1 DEAT Y');
    }
    if (p.burial_place) event('BURI', '', p.burial_place);
    line(1, 'OCCU', p.occupation);
    if (p.notes) {
      const parts = p.notes.split(/\r?\n/);
      L.push(`1 NOTE ${parts[0]}`);
      for (const part of parts.slice(1)) L.push(`2 CONT ${part}`);
    }
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
    if (f.kind === 'marriage' && (f.start_date || (f.partner1 && f.partner2))) event('MARR', f.start_date, '');
    if (f.ended === 'divorce') { if (f.end_date) event('DIV', f.end_date, ''); else L.push('1 DIV Y'); }
  }
  L.push('0 TRLR');
  return L.join('\n') + '\n';
}

export default async function exportRoutes(app) {
  app.get('/api/export.ged', { preHandler: need('viewer') }, async (req, reply) => {
    const data = await loadTreeData();
    const date = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="drevo-${date}.ged"`);
    return toGedcom(data);
  });
}
