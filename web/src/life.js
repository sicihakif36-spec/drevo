// Лента жизни человека: сведения из дерева (рождение, браки, рождение детей, смерть, захоронение) и свои события вперемешку по годам.
// Приблизительные даты и периоды встают по первому году, без даты — в конце.
import { fullName, parsePeriod, birthYear, spousesOf, yearsText } from '@shared/names.js';
import { EVENT_KINDS, eventTitle } from '@shared/events.js';

// Пункт: { key, at — разбор даты, title, date, place, note, age, go — куда ведёт нажатие, event — своё событие }.
// go: 'edit' — карточка человека, { person } — карточка другого, { family } — дата брака.
export function lifeItems(p, idx, events) {
  const items = [];
  const push = (x) => items.push({ ...x, at: parsePeriod(x.date) });
  push({ key: 'birth', title: p.sex === 'F' ? 'Родилась' : p.sex === 'M' ? 'Родился' : 'Рождение', date: p.birth_date, place: p.birth_place, go: 'edit' });
  for (const s of spousesOf(idx, p.id)) {
    const f = idx.families.get(s.familyId);
    const spouse = s.spouseId && idx.persons.get(s.spouseId);
    if (spouse) {
      push({ key: `marriage-${f.id}`, title: `Брак: ${fullName(spouse)}`, date: f.start_date, go: { family: f, spouse } });
    }
    for (const id of f.children) {
      const c = idx.persons.get(id);
      if (!c) continue;
      const word = c.sex === 'F' ? 'Родилась дочь' : c.sex === 'M' ? 'Родился сын' : 'Родился ребёнок';
      push({ key: `child-${id}`, title: `${word}: ${[c.given, c.patronymic].filter(Boolean).join(' ') || fullName(c)}`, date: c.birth_date, go: { person: c } });
    }
  }
  if (!p.living) {
    push({ key: 'death', title: p.sex === 'F' ? 'Умерла' : p.sex === 'M' ? 'Умер' : 'Смерть', date: p.death_date, place: p.death_place, go: 'edit' });
  }
  for (const e of events) {
    const k = EVENT_KINDS[e.kind] || EVENT_KINDS.other;
    const what = e.kind !== 'other' || !k.main ? e.title : '';
    push({ key: e.id, title: eventTitle(e), date: e.date, place: e.place, note: [what, e.unit, e.rank].filter(Boolean).join(', '), event: e });
  }
  // Дети без даты рождения в ленту не встают: их и так видно в «Семье».
  const shown = items.filter((x) => x.at || !x.key.startsWith('child-'));
  // Захоронение — сразу после смерти: своей даты у него нет.
  if (!p.living && p.burial_place) {
    const death = shown.find((x) => x.key === 'death');
    shown.push({ key: 'burial', title: 'Похоронен' + (p.sex === 'F' ? 'а' : ''), date: '', place: p.burial_place, go: 'edit',
      at: death.at && { ...death.at, key: death.at.key + 0.5 } });
  }
  const born = birthYear(p);
  for (const x of shown) if (born && x.at && x.key !== 'birth' && x.at.year > born) x.age = `в ${yearsText(x.at.year - born)}`;
  // Без даты — в конце, в порядке добавления; рождение и смерть без даты — первым и последним пунктом.
  const rank = (x) => (x.at ? 0 : x.key === 'birth' ? -1 : x.key === 'death' || x.key === 'burial' ? 2 : 1);
  return shown
    .filter((x) => x.at || x.event || x.place || x.key.startsWith('marriage-'))
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => rank(a) - rank(b) || (a.at && b.at ? a.at.key - b.at.key : 0) || a.i - b.i);
}
