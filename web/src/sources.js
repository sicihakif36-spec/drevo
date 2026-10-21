// Источники и достоверность в карточке: что известно о каждом сведении человека и его браков.
// data — ответ GET /api/persons/:id/sources: { quality, citations, sources }.
import { fullName } from '@shared/names.js';
import { FACTS } from '@shared/sources.js';

// Отметка достоверности и источники одного сведения.
export function factInfo(data, subject, subjectId, fact) {
  if (!data) return { quality: null, cites: [] };
  const quality = data.quality.find((x) => x.subject === subject && x.subject_id === subjectId && x.fact === fact)?.quality || null;
  const cites = data.citations
    .filter((c) => c.subject === subject && c.subject_id === subjectId && c.fact === fact)
    .map((c) => ({ ...c, source: data.sources.find((s) => s.id === c.source_id) }))
    .filter((c) => c.source);
  return { quality, cites };
}

// Сведения человека, к которым можно указать источник: заполненные поля, имя, «другое» и браки.
export function personFacts(p, marriages) {
  const out = [{ subject: 'person', id: p.id, fact: 'name', label: FACTS.person.name, value: fullName(p) }];
  for (const [fact, label] of Object.entries(FACTS.person)) {
    if (p[fact]) out.push({ subject: 'person', id: p.id, fact, label, value: p[fact] });
  }
  for (const m of marriages) {
    if (!m.spouse) continue;
    out.push({ subject: 'family', id: m.familyId, fact: 'marriage', label: `Брак: ${fullName(m.spouse)}`, value: m.fam.start_date });
  }
  out.push({ subject: 'person', id: p.id, fact: 'other', label: FACTS.person.other, value: '' });
  return out;
}
