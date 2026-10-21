// Анкета для родственника: что спрашиваем и в каком порядке. Одно описание для страницы по ссылке,
// для загрузки ответов в дерево и для бумажного бланка (шаг 5): бланк печатает те же шаги и поля,
// у «много» — несколько пустых мест (paper).
import { parseDate, patronymicFrom, surnameFor } from './names.js';

// Кем приходится человек тому, кто заполняет. many — сколько можно указать, sex — пол заранее.
export const ROLES = {
  self: { label: 'Вы' },
  spouse: { label: 'Муж или жена', many: 5, add: 'Ещё муж или жена', paper: 2 },
  child: { label: 'Ребёнок', many: 20, add: 'Добавить ребёнка', paper: 4 },
  father: { label: 'Отец', sex: 'M' },
  mother: { label: 'Мать', sex: 'F' },
  ff: { label: 'Дедушка по отцу', sex: 'M' },
  fm: { label: 'Бабушка по отцу', sex: 'F' },
  mf: { label: 'Дедушка по матери', sex: 'M' },
  mm: { label: 'Бабушка по матери', sex: 'F' },
  sibling: { label: 'Брат или сестра', many: 20, add: 'Добавить брата или сестру', paper: 4 },
};

// Шаги анкеты. roles — о ком спрашиваем на этом шаге.
export const STEPS = [
  { key: 'self', title: 'О себе', roles: ['self'], hint: 'Начнём с вас. Заполните, что знаете: обязательно только имя.' },
  { key: 'spouse', title: 'Муж или жена', roles: ['spouse'], hint: 'Если браков было несколько — добавьте каждого. Если не было — пропустите шаг.' },
  { key: 'children', title: 'Дети', roles: ['child'], hint: 'Все дети, и уже умершие тоже.' },
  { key: 'parents', title: 'Родители', roles: ['father', 'mother'] },
  { key: 'grand_f', title: 'Бабушка и дедушка по отцу', roles: ['ff', 'fm'], hint: 'Родители вашего отца.' },
  { key: 'grand_m', title: 'Бабушка и дедушка по матери', roles: ['mf', 'mm'], hint: 'Родители вашей матери.' },
  { key: 'siblings', title: 'Братья и сёстры', roles: ['sibling'], hint: 'Родные, двоюродных не нужно.' },
  { key: 'story', title: 'Что ещё помните', story: true, hint: 'Расскажите своими словами: откуда семья, где жили, кем работали, что пережили, семейные истории.' },
  { key: 'photos', title: 'Фотографии', photos: true, hint: 'Старые семейные фото, если они есть в телефоне. Можно подписать, кто на фото.' },
];

// Поля о каждом человеке, в порядке на экране и на бумаге. dead — только у умерших.
export const FIELDS = [
  { key: 'given', label: 'Имя' },
  { key: 'patronymic', label: 'Отчество' },
  { key: 'surname', label: 'Фамилия' },
  { key: 'birth_surname', label: 'Фамилия при рождении', hint: 'если меняли, например девичья' },
  { key: 'sex', label: 'Пол', kind: 'sex' },
  { key: 'living', label: 'Жив или умер', kind: 'living' },
  { key: 'birth_date', label: 'Дата рождения', kind: 'date', placeholder: 'например, 1930 или около 1930' },
  { key: 'birth_place', label: 'Место рождения', kind: 'place', placeholder: 'город, село, область' },
  { key: 'death_date', label: 'Дата смерти', kind: 'date', dead: true, placeholder: 'год или дата' },
  { key: 'death_place', label: 'Место смерти', kind: 'place', dead: true },
  { key: 'occupation', label: 'Род занятий', placeholder: 'кем работал(а), где служил(а)' },
  { key: 'notes', label: 'Что ещё знаете', kind: 'text' },
];

export const TEXT_FIELDS = FIELDS.filter((f) => !f.kind || ['date', 'place', 'text'].includes(f.kind)).map((f) => f.key);
export const MAX_STORY = 20000;
export const MAX_PHOTOS = 12;
const MAX = { notes: 2000 };

export const newId = () => Math.random().toString(36).slice(2, 10);

// Человек из анкеты: только известные поля, строки обрезаны. В черновике пробелы не убираем — человек ещё пишет.
function cleanPerson(x, role) {
  const o = x && typeof x === 'object' ? x : {};
  const out = { id: /^[a-z0-9]{1,16}$/.test(o.id) ? o.id : newId() };
  for (const k of TEXT_FIELDS) out[k] = String(o[k] ?? '').slice(0, MAX[k] || 300);
  out.sex = ['M', 'F'].includes(o.sex) ? o.sex : ROLES[role].sex || 'U';
  out.living = typeof o.living === 'boolean' ? o.living : null;
  // Второй родитель ребёнка — кто-то из супругов (id записи).
  if (role === 'child') out.parent2 = /^[a-z0-9]{1,16}$/.test(o.parent2) ? o.parent2 : '';
  return out;
}

// Ответы как их прислал телефон -> только то, что мы спрашиваем.
export function cleanAnswers(a) {
  const src = a && typeof a === 'object' ? a : {};
  const people = {};
  const ids = new Set();
  for (const [role, r] of Object.entries(ROLES)) {
    const v = src.people?.[role];
    const list = r.many ? (Array.isArray(v) ? v.slice(0, r.many) : []) : [v];
    const clean = list.map((x) => {
      const p = cleanPerson(x, role);
      while (ids.has(p.id)) p.id = newId();
      ids.add(p.id);
      return p;
    });
    people[role] = r.many ? clean : clean[0];
  }
  const step = Number.isInteger(src.step) ? Math.min(Math.max(src.step, 0), STEPS.length + 1) : 0;
  return { people, story: String(src.story ?? '').slice(0, MAX_STORY), step };
}

export const filled = (p) => Boolean(p && String(p.given || '').trim());

// Все указанные люди по порядку шагов: [{ role, person }]. Без имени человек не считается.
export function surveyPeople(answers) {
  const out = [];
  for (const s of STEPS) {
    for (const role of s.roles || []) {
      const v = answers?.people?.[role];
      for (const p of ROLES[role].many ? v || [] : [v]) if (filled(p)) out.push({ role, person: p });
    }
  }
  return out;
}

const t = (s) => String(s || '').trim();

// Отец человека из анкеты: для отчества и фамилии.
function fatherIn(P, role, p) {
  if (role === 'self' || role === 'sibling') return P.father;
  if (role === 'father') return P.ff;
  if (role === 'mother') return P.mf;
  if (role === 'child') {
    const spouses = (P.spouse || []).filter(filled);
    const other = spouses.find((s) => s.id === p.parent2) || (spouses.length === 1 ? spouses[0] : null);
    return [P.self, other].find((x) => x?.sex === 'M' && filled(x)) || null;
  }
  return null;
}

// Подсказка отчества и фамилий по родству, как при добавлении человека в дерево: { surname, patronymic, birth_surname }.
export function suggest(answers, role, p) {
  const P = answers.people;
  const sex = p.sex;
  const out = { surname: '', patronymic: '', birth_surname: '' };
  const fa = fatherIn(P, role, p);
  if (fa && t(fa.given)) out.patronymic = patronymicFrom(t(fa.given), sex);
  const male = (s) => surnameFor(t(s), 'M');
  const female = (s) => surnameFor(t(s), 'F');
  const self = P.self || {};
  switch (role) {
    case 'self':
    case 'sibling':
      if (t(P.father?.surname)) {
        if (sex === 'F') out.birth_surname = female(P.father.surname);
        else out.surname = male(P.father.surname);
      }
      break;
    case 'child':
      if (fa && t(fa.surname)) out.surname = surnameFor(t(fa.surname), sex);
      break;
    case 'spouse':
      if (t(self.surname) && self.sex !== sex && self.sex !== 'U') out.surname = surnameFor(t(self.surname), sex);
      break;
    case 'father': {
      const s = self.sex === 'F' ? t(self.birth_surname) || t(self.surname) : t(self.surname);
      if (s) out.surname = male(s);
      break;
    }
    case 'mother':
      if (t(P.father?.surname)) out.surname = female(P.father.surname);
      if (t(P.mf?.surname)) out.birth_surname = female(P.mf.surname);
      break;
    case 'ff':
      if (t(P.father?.surname)) out.surname = male(P.father.surname);
      break;
    case 'fm':
      if (t(P.ff?.surname) || t(P.father?.surname)) out.surname = female(t(P.ff?.surname) || P.father.surname);
      break;
    case 'mf':
      if (t(P.mother?.birth_surname)) out.surname = male(P.mother.birth_surname);
      break;
    case 'mm':
      if (t(P.mf?.surname) || t(P.mother?.birth_surname)) out.surname = female(t(P.mf?.surname) || P.mother.birth_surname);
      break;
  }
  return out;
}

const norm = (s) => t(s).toLowerCase().replace(/ё/g, 'е');

// Похож ли человек из анкеты на человека из дерева: по имени, отчеству, фамилии и году рождения, как проверка дубликатов.
// 0 — точно не он (другое имя, другое отчество, годы рождения расходятся больше чем на 5 лет).
export function matchScore(rec, p) {
  if (!norm(rec.given) || norm(rec.given) !== norm(p.given)) return 0;
  let score = 1;
  if (norm(rec.patronymic) && norm(p.patronymic)) {
    if (norm(rec.patronymic) !== norm(p.patronymic)) return 0;
    score += 2;
  }
  const mine = [rec.surname, rec.birth_surname].map(norm).filter(Boolean);
  const theirs = [p.surname, p.birth_surname].map(norm).filter(Boolean);
  if (mine.length && theirs.length) score += mine.some((s) => theirs.includes(s)) ? 2 : -1;
  const a = parseDate(rec.birth_date)?.year;
  const b = parseDate(p.birth_date)?.year;
  if (a && b) {
    if (Math.abs(a - b) > 5) return 0;
    if (Math.abs(a - b) <= 2) score += 2;
  }
  return score;
}

// Кто из дерева может быть этим человеком, самые похожие первыми. kin — кто по уже выбранным совпадениям
// приходится ему нужной роднёй (например, родители того, кто заполнял): им прибавка.
export function findMatches(rec, persons, kin = new Set(), limit = 3) {
  return persons
    .map((p) => ({ p, score: matchScore(rec, p) + (kin.has(p.id) ? 3 : 0) }))
    .filter((x) => x.score >= 2 && matchScore(rec, x.p) > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}
