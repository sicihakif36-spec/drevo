// Выдуманное большое дерево потомков для проверок печати: родоначальник, у каждого — жена и дети, пока не наберётся n потомков.
export function bigTree(n = 2500, { kids = 4 } = {}) {
  const persons = [];
  const families = [];
  const children = [];
  const NAMES = { M: ['Иван', 'Пётр', 'Василий', 'Николай', 'Фёдор', 'Михаил'], F: ['Анна', 'Мария', 'Клавдия', 'Прасковья', 'Евдокия'] };
  const SUR = ['Смирнов', 'Орлов', 'Кузнецов', 'Белов', 'Воронцов'];
  let k = 0;
  const make = (sex, gen, surname, extra = {}) => {
    const id = `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`;
    const female = sex === 'F';
    const year = 1800 + gen * 27 + (k % 9);
    persons.push({
      id, sex, surname: female ? `${surname}а` : surname, given: NAMES[sex][k % NAMES[sex].length], patronymic: female ? 'Ивановна' : 'Петрович',
      birth_surname: '', living: year > 1935, birth_date: `${String(1 + (k % 28)).padStart(2, '0')}.0${1 + (k % 9)}.${year}`, birth_place: 'д. Горки',
      death_date: year > 1935 ? '' : String(year + 60), death_place: year > 1935 ? '' : 'г. Тверь', burial_place: '', occupation: k % 3 ? 'крестьянин' : '',
      notes: k % 5 ? '' : 'Жил в деревне, держал пасеку, был церковным старостой. Дом стоял у самого пруда.', photo_id: null, created_at: new Date(2026, 0, 1, 0, 0, k), ...extra,
    });
    return id;
  };
  const root = make('M', 0, 'Смирнов');
  let cur = [root];
  let desc = 1;
  for (let gen = 1; desc < n; gen++) {
    const next = [];
    for (const id of cur) {
      if (desc >= n) break;
      const p = persons.find((x) => x.id === id);
      const wife = make(p.sex === 'M' ? 'F' : 'M', gen - 1, SUR[k % SUR.length]);
      const fam = `00000000-0000-4000-9000-${String(families.length + 1).padStart(12, '0')}`;
      families.push({ id: fam, partner1: p.sex === 'M' ? id : wife, partner2: p.sex === 'M' ? wife : id, kind: 'marriage', start_date: String(1800 + gen * 27), place: 'с. Горки', ended: '', end_date: '', created_at: new Date(2026, 0, 1) });
      for (let i = 0; i < kids && desc < n; i++) {
        const sur = p.sex === 'M' ? p.surname : persons.find((x) => x.id === wife).surname;
        const c = make(i % 2 ? 'F' : 'M', gen, sur.replace(/а$/, ''));
        children.push({ family_id: fam, child_id: c });
        next.push(c);
        desc++;
      }
    }
    cur = next;
  }
  return { persons, families, children, root };
}
