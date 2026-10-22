// Выдуманные деревья для проверок «Всего дерева».
// clans() — похоже на настоящее: три рода, связанные браками, 7 поколений, около 190 человек;
// мужчина с двумя жёнами и детьми от обеих, вдова, вышедшая замуж второй раз, брак двоюродных, люди без фамилии.
// randomTree(n) — случайное большое дерево на n человек.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = {
  M: ['Ринат', 'Пётр', 'Ильдар', 'Николай', 'Фарит', 'Михаил', 'Габдулла', 'Сергей', 'Марат', 'Иван', 'Рустам', 'Юрий'],
  F: ['Амина', 'Мария', 'Гульнара', 'Анна', 'Ильгамия', 'Вера', 'Зульфия', 'Ольга', 'Наиля', 'Клавдия', 'Роза', 'Елена'],
};
const OUT = ['Иванов', 'Гарипов', 'Соколов', 'Валиев', 'Морозов', 'Закиров', 'Лебедев', 'Нуриев'];

function maker() {
  const persons = [];
  const families = [];
  const children = [];
  let k = 0;
  const person = (sex, gen, surname, extra = {}) => {
    const id = `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`;
    const year = 1850 + gen * 26 + (k % 7);
    persons.push({
      id, sex, surname: surname ? (sex === 'F' ? `${surname}а` : surname) : '', given: NAMES[sex][k % NAMES[sex].length],
      patronymic: '', birth_surname: '', living: year > 1940, birth_date: String(year), death_date: year > 1940 ? '' : String(year + 65),
      birth_place: '', death_place: '', burial_place: '', occupation: '', notes: '', photo_id: null, gen, ...extra,
    });
    return id;
  };
  const family = (a, b) => {
    const id = `00000000-0000-4000-9000-${String(families.length + 1).padStart(12, '0')}`;
    families.push({ id, partner1: a, partner2: b, kind: 'marriage', start_date: '', place: '', end_date: '' });
    return id;
  };
  const child = (fam, c) => children.push({ family_id: fam, child_id: c });
  return { persons, families, children, person, family, child };
}

export function clans(seed = 7) {
  const rnd = rng(seed);
  const m = maker();
  const sur = (id) => m.persons.find((p) => p.id === id).surname.replace(/а$/, '');
  const byId = (id) => m.persons.find((p) => p.id === id);
  const spouseOf = new Map();
  const marry = (a, b) => {
    const [h, w] = byId(a).sex === 'M' ? [a, b] : [b, a];
    const f = m.family(h, w);
    spouseOf.set(a, f);
    spouseOf.set(b, f);
    return f;
  };
  const CLANS = ['Сафин', 'Петров', 'Хасанов'];
  let gen0 = [];
  const clanOf = new Map();
  for (const c of CLANS) {
    const h = m.person('M', 0, c);
    const w = m.person('F', 0, OUT[gen0.length]);
    clanOf.set(h, c);
    marry(h, w);
    gen0.push(h);
  }
  let cur = gen0;
  const special = {};
  for (let g = 1; g < 7; g++) {
    const next = [];
    // браки между родами: незамужние и неженатые одного поколения из разных родов
    const single = cur.filter((id) => !spouseOf.has(id));
    for (const a of single) {
      if (spouseOf.has(a) || rnd() < 0.8) continue;
      const b = single.find((x) => x !== a && !spouseOf.has(x) && byId(x).sex !== byId(a).sex && clanOf.get(x) !== clanOf.get(a));
      if (b) marry(a, b);
    }
    for (const id of cur) {
      if (!spouseOf.has(id)) {
        if (rnd() < 0.2) continue; // не женат, детей нет
        const p = byId(id);
        // жена (муж) со стороны; изредка — без фамилии
        const s = m.person(p.sex === 'M' ? 'F' : 'M', g - 1, rnd() < 0.15 ? '' : OUT[Math.floor(rnd() * OUT.length)]);
        marry(id, s);
      }
    }
    const fams = [...new Set(cur.map((id) => spouseOf.get(id)).filter(Boolean))];
    const budget = [0, 8, 13, 19, 26, 30, 30][g];
    let made = 0;
    for (const f of fams) {
      const fam = m.families.find((x) => x.id === f);
      const dad = fam.partner1;
      const n = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < n && made < budget; i++) {
        const sex = rnd() < 0.5 ? 'M' : 'F';
        const c = m.person(sex, g, rnd() < 0.08 ? '' : sur(dad) || CLANS[0]);
        clanOf.set(c, clanOf.get(dad) || clanOf.get(fam.partner2));
        m.child(f, c);
        next.push(c);
        made++;
      }
    }
    // Особые случаи.
    if (g === 3) {
      // мужчина с двумя жёнами и детьми от обеих
      const man = cur.find((id) => byId(id).sex === 'M' && spouseOf.has(id) && m.children.some((c) => c.family_id === spouseOf.get(id)));
      const w2 = m.person('F', 2, 'Валиев');
      const f2 = m.family(man, w2);
      for (let i = 0; i < 2; i++) {
        const c = m.person(i ? 'F' : 'M', 3, sur(man));
        clanOf.set(c, clanOf.get(man));
        m.child(f2, c);
        next.push(c);
      }
      special.twoWives = man;
    }
    if (g === 4) {
      // вдова вышла замуж второй раз, дети от обоих браков
      const wife = cur.find((id) => byId(id).sex === 'F' && spouseOf.has(id) && m.children.some((c) => c.family_id === spouseOf.get(id)));
      const h2 = m.person('M', 3, 'Морозов');
      const f2 = m.family(h2, wife);
      const c = m.person('M', 4, 'Морозов');
      m.child(f2, c);
      next.push(c);
      special.remarried = wife;
    }
    if (g === 5) {
      // брак двоюродных: дети родных братьев (сестёр), у них ребёнок
      const sib = (id) => m.children.find((c) => c.child_id === id)?.family_id;
      let pair = null;
      for (const a of next) {
        for (const b of next) {
          if (pair || a === b || byId(a).sex !== 'M' || byId(b).sex !== 'F' || spouseOf.has(a) || spouseOf.has(b)) continue;
          const pa = m.families.find((f) => f.id === sib(a));
          const pb = m.families.find((f) => f.id === sib(b));
          if (!pa || !pb || pa === pb) continue;
          const ga = [pa.partner1, pa.partner2].map(sib).filter(Boolean);
          const gb = [pb.partner1, pb.partner2].map(sib).filter(Boolean);
          if (ga.some((x) => gb.includes(x))) pair = [a, b];
        }
      }
      if (pair) {
        marry(...pair);
        special.cousins = pair;
      }
    }
    cur = next;
  }
  for (const p of m.persons) delete p.gen;
  return { persons: m.persons, families: m.families, children: m.children, special };
}

// Случайное дерево на n человек: дети, родители, повторные браки, браки между ветками одного поколения.
// Поколение у каждого своё и согласованное (ребёнок на одно ниже родителей), браки — только в одном поколении и не по прямой линии.
export function randomTree(n, seed = 1) {
  const rnd = rng(seed);
  const m = maker();
  const depth = new Map();
  const parentsOf = new Map();
  const famsOf = new Map();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const add = (sex, d) => {
    const id = m.person(sex, d + 4, rnd() < 0.1 ? '' : OUT[Math.floor(rnd() * OUT.length)]);
    depth.set(id, d);
    famsOf.set(id, []);
    return id;
  };
  const couple = (a, b) => {
    const [h, w] = b && sexes.get(a) === 'F' ? [b, a] : [a, b];
    const f = m.family(h, w || null);
    for (const x of [a, b]) if (x) famsOf.get(x).push(f);
    return f;
  };
  const sexes = new Map();
  const make = (sex, d) => { const id = add(sex, d); sexes.set(id, sex); return id; };
  const ids = [make('M', 0)];
  const ancestors = (id, out = new Set()) => {
    for (const p of parentsOf.get(id) || []) if (!out.has(p)) { out.add(p); ancestors(p, out); }
    return out;
  };
  while (ids.length < n) {
    const p = pick(ids);
    const r = rnd();
    const d = depth.get(p);
    if (r < 0.5) {
      let f = famsOf.get(p).length ? pick(famsOf.get(p)) : null;
      if (!f) {
        const s = rnd() < 0.85 ? make(sexes.get(p) === 'M' ? 'F' : 'M', d) : null;
        if (s) ids.push(s);
        f = couple(p, s);
      }
      const c = make(rnd() < 0.5 ? 'M' : 'F', d + 1);
      ids.push(c);
      m.child(f, c);
      const fam = m.families.find((x) => x.id === f);
      parentsOf.set(c, [fam.partner1, fam.partner2].filter(Boolean));
    } else if (r < 0.68) {
      if (parentsOf.has(p)) continue;
      const a = make('M', d - 1);
      const b = make('F', d - 1);
      ids.push(a, b);
      const f = couple(a, b);
      m.child(f, p);
      parentsOf.set(p, [a, b]);
    } else if (r < 0.8) {
      const s = make(sexes.get(p) === 'M' ? 'F' : 'M', d);
      ids.push(s);
      couple(p, s);
    } else if (r < 0.86) {
      // брак двух уже известных людей одного поколения из разных веток
      const q = pick(ids);
      if (q === p || depth.get(q) !== d || sexes.get(q) === sexes.get(p)) continue;
      if (ancestors(p).has(q) || ancestors(q).has(p)) continue;
      couple(p, q);
    }
  }
  for (const p of m.persons) delete p.gen;
  return { persons: m.persons, families: m.families, children: m.children };
}
