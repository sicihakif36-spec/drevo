// Несколько браков у мужа и у жены: Иван — женат на Анне, потом на Марии; Мария до Ивана была замужем за Петром;
// Пётр потом женат на Ольге. У каждого брака свои дети; у Ивана ещё ребёнок, мать которого не записана.
let n = 0;
export function marriages() {
  const persons = [];
  const families = [];
  const children = [];
  const P = (given, surname, sex, year) => {
    const id = `p${++n}`;
    persons.push({ id, given, surname, sex, birth_date: year ? String(year) : null, living: false });
    return id;
  };
  const F = (a, b, kids) => {
    const id = `f${++n}`;
    families.push({ id, partner1: a, partner2: b });
    for (const c of kids) children.push({ family_id: id, child_id: c });
    return id;
  };
  const ded = P('Степан', 'Иванов', 'M', 1900);
  const baba = P('Дарья', 'Иванова', 'F', 1902);
  const ivan = P('Иван', 'Иванов', 'M', 1925);
  F(ded, baba, [ivan, P('Нина', 'Иванова', 'F', 1928)]);
  const anna = P('Анна', 'Сидорова', 'F', 1927);
  const maria = P('Мария', 'Кузнецова', 'F', 1930);
  const petr = P('Пётр', 'Кузнецов', 'M', 1926);
  const olga = P('Ольга', 'Белова', 'F', 1932);
  F(ivan, anna, [P('Алексей', 'Иванов', 'M', 1948), P('Анастасия', 'Иванова', 'F', 1950)]);
  F(petr, maria, [P('Павел', 'Кузнецов', 'M', 1950)]);
  F(ivan, maria, [P('Михаил', 'Иванов', 'M', 1956), P('Марина', 'Иванова', 'F', 1958), P('Максим', 'Иванов', 'M', 1960)]);
  F(petr, olga, [P('Олег', 'Кузнецов', 'M', 1960)]);
  F(ivan, null, [P('Яков', 'Иванов', 'M', 1945)]);
  return { data: { persons, families, children }, ivan, maria, petr, anna };
}
