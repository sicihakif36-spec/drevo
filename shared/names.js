// Имена, даты и родство: общие для сервера (печать) и телефона.

const MALE_ON_A = new Set(['илья', 'никита', 'фома', 'кузьма', 'савва', 'лука', 'фока', 'данила', 'гаврила', 'мина', 'иона', 'миша', 'саша', 'паша', 'гоша', 'коля', 'ваня', 'петя', 'вася', 'дима', 'серёжа', 'сережа', 'лёша', 'леша', 'вова', 'юра', 'женя']);

export function fullName(p) {
  if (!p) return '';
  return [p.surname, p.given, p.patronymic].filter(Boolean).join(' ') || 'Без имени';
}

export function shortName(p) {
  if (!p) return '';
  const first = [p.given, p.patronymic].filter(Boolean).join(' ');
  return { first: first || (p.surname ? '' : 'Без имени'), last: p.surname || '' };
}

// «около 1890», «12.03.1890», «до 1917», «между 1880 и 1885» -> { year, approx }
export function parseDate(text) {
  if (!text) return null;
  const t = String(text).trim().toLowerCase();
  const m = t.match(/(\d{3,4})(?!.*\d{3,4})/);
  const year = m ? Number(m[1]) : null;
  const approx = /около|ок\.|~|приблиз|между|до |после|\?|ст\. ?ст/.test(t) || /^(до|после)/.test(t);
  return { year, approx, text: String(text).trim() };
}

// Дата или период в свободной форме для ленты жизни: «1941–1945», «с 1950 по 1962», «с 1950», «около 1930», «март 1942».
// -> { from, to, since, year, key }: from и to — начало и конец периода текстом (to пустой — одна дата), since — «с 1950» без конца,
// year — первый год, key — для сортировки по году, месяцу и дню. Без года — null.
const MONTH_WORDS = [/янв/, /фев/, /март/, /апр/, /ма[йяе]/, /июн/, /июл/, /авг/, /сен/, /окт/, /ноя/, /дек/];
function dateKey(text) {
  const t = text.toLowerCase();
  const y = t.match(/\d{3,4}/);
  if (!y) return null;
  let m = t.match(/(\d{1,2})\.(\d{1,2})\.\d{3,4}/);
  if (m) return { year: Number(y[0]), key: Number(y[0]) * 10000 + Number(m[2]) * 100 + Number(m[1]) };
  m = t.match(/(?:^|\D)(\d{1,2})\.\d{3,4}/);
  const month = m ? Number(m[1]) : MONTH_WORDS.findIndex((w) => w.test(t)) + 1;
  return { year: Number(y[0]), key: Number(y[0]) * 10000 + (month <= 12 ? month : 0) * 100 };
}
export function parsePeriod(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(?:с|со|между)?\s*(.*?\d{3,4}.*?)\s*(?:[–—-]|\s(?:по|до|и)\s)\s*(.*\d{3,4}.*)$/i);
  const since = !m && /^со?\s.*\d{3,4}/i.test(t);
  const from = m ? m[1] : since ? t.replace(/^со?\s+/i, '') : t;
  const k = dateKey(from);
  return k && { from, to: m ? m[2] : '', since, ...k };
}

// Точная дата «12.03.1890» -> { day, month, year }. Неточные («около 1890», «1890», «ст. ст.») — null.
export function exactDate(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [day, month, year] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) return null;
  return { day, month, year };
}

const daysInMonth = (month, year) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// «1 год», «3 года», «28 лет».
export function yearsText(n) {
  const a = n % 10;
  const b = n % 100;
  const word = a === 1 && b !== 11 ? 'год' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'года' : 'лет';
  return `${n} ${word}`;
}

// Памятные даты на days дней вперёд, сегодняшние первыми: дни рождения живых (kind 'birthday'),
// годовщины рождения и смерти ушедших ('birth', 'death'). years — сколько лет исполняется, round — круглая дата.
export function upcomingDates(persons, today = new Date(), days = 30) {
  const DAY = 86400000;
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const out = [];
  for (const p of persons) {
    const dates = p.living ? [['birthday', p.birth_date]] : [['birth', p.birth_date], ['death', p.death_date]];
    for (const [kind, text] of dates) {
      const d = exactDate(text);
      if (!d) continue;
      for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
        // 29 февраля в невисокосный год отмечаем 28-го.
        const day = Math.min(d.day, daysInMonth(d.month, y));
        const at = Date.UTC(y, d.month - 1, day);
        const inDays = Math.round((at - start) / DAY);
        if (inDays < 0) continue;
        const years = y - d.year;
        if (inDays <= days && years > 0) {
          out.push({ person: p, kind, day, month: d.month, inDays, years, round: years % (kind === 'birthday' ? 10 : 50) === 0 });
        }
        break;
      }
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays || fullName(a.person).localeCompare(fullName(b.person), 'ru'));
}

export function lifespan(p) {
  const b = parseDate(p.birth_date);
  const d = parseDate(p.death_date);
  const fmt = (x) => (x && x.year ? (x.approx ? '~' : '') + x.year : '');
  const bs = fmt(b);
  const ds = fmt(d);
  if (!p.living) return bs || ds ? `${bs || '?'} – ${ds || '?'}` : '';
  return bs ? `р. ${bs}` : '';
}

export function birthYear(p) {
  return parseDate(p.birth_date)?.year ?? null;
}

// Живые моложе 100 лет (и живые без года рождения): их даты, места и фото видят только участники.
export function isPrivate(p, year = new Date().getFullYear()) {
  if (!p.living) return false;
  const b = birthYear(p);
  return !b || year - b < 100;
}

// Отчество по имени отца.
export function patronymicFrom(fatherGiven, sex) {
  if (!fatherGiven) return '';
  const n = fatherGiven.trim();
  const low = n.toLowerCase();
  const f = sex === 'F';
  const special = { 'илья': ['Ильич', 'Ильинична'], 'лука': ['Лукич', 'Лукинична'], 'фома': ['Фомич', 'Фоминична'], 'кузьма': ['Кузьмич', 'Кузьминична'], 'никита': ['Никитич', 'Никитична'], 'савва': ['Саввич', 'Саввична'], 'яков': ['Яковлевич', 'Яковлевна'], 'павел': ['Павлович', 'Павловна'], 'лев': ['Львович', 'Львовна'], 'пётр': ['Петрович', 'Петровна'], 'петр': ['Петрович', 'Петровна'], 'михаил': ['Михайлович', 'Михайловна'] };
  if (special[low]) return special[low][f ? 1 : 0];
  if (/ий$/.test(low)) return n.slice(0, -2) + (f ? 'ьевна' : 'ьевич');
  if (/[ае]й$/.test(low) || /[оуюя]й$/.test(low)) return n.slice(0, -1) + (f ? 'евна' : 'евич');
  if (/ь$/.test(low)) return n.slice(0, -1) + (f ? 'евна' : 'евич');
  if (/[ая]$/.test(low)) return n.slice(0, -1) + (f ? 'ична' : 'ич');
  if (/[жшчщц]$/.test(low)) return n + (f ? 'евна' : 'евич');
  return n + (f ? 'овна' : 'ович');
}

// Фамилия ребёнка по фамилии отца с учётом рода.
export function surnameFor(fatherSurname, sex) {
  if (!fatherSurname) return '';
  const s = fatherSurname.trim();
  const low = s.toLowerCase();
  if (sex === 'F') {
    if (/(ов|ев|ёв|ин|ын)$/.test(low)) return s + 'а';
    if (/(ский|цкий)$/.test(low)) return s.slice(0, -2) + 'ая';
    if (/ой$/.test(low)) return s.slice(0, -2) + 'ая';
    return s;
  }
  if (/(ова|ева|ёва|ина|ына)$/.test(low)) return s.slice(0, -1);
  if (/(ская|цкая)$/.test(low)) return s.slice(0, -2) + 'ий';
  return s;
}

export function guessSex(given, patronymic) {
  const p = (patronymic || '').toLowerCase();
  if (/(вна|чна|кызы)$/.test(p)) return 'F';
  if (/(вич|ич|оглы)$/.test(p)) return 'M';
  const g = (given || '').trim().toLowerCase();
  if (!g) return 'U';
  if (MALE_ON_A.has(g)) return 'M';
  if (/[аяь]$/.test(g) && !/ь$/.test(g)) return 'F';
  if (/(любовь|нинель|адель|рахиль|юдифь|эсфирь)$/.test(g)) return 'F';
  return 'M';
}

// ---------- Родство ----------

const ANC = { M: ['отец', 'дед', 'прадед'], F: ['мать', 'бабушка', 'прабабушка'] };
const DESC = { M: ['сын', 'внук', 'правнук'], F: ['дочь', 'внучка', 'правнучка'] };

function prefixed(base, n, words) {
  if (n <= words.length) return words[n - 1];
  return 'пра'.repeat(n - words.length) + words[words.length - 1];
}

function cousinWord(level) {
  return ['', 'родной', 'двоюродный', 'троюродный', 'четвероюродный'][level] || `${level}-юродный`;
}

export function kinshipTerm(up, down, sex, side) {
  const s = sex === 'F' ? 'F' : 'M';
  if (up === 0 && down === 0) return 'это вы';
  let term = null;
  if (down === 0) term = prefixed(null, up, ANC[s]);
  else if (up === 0) term = prefixed(null, down, DESC[s]);
  else if (up === 1 && down === 1) term = s === 'F' ? 'сестра' : 'брат';
  else if (up === down) {
    const w = cousinWord(up);
    term = `${s === 'F' ? w.replace(/ый$/, 'ая').replace(/ой$/, 'ая') : w} ${s === 'F' ? 'сестра' : 'брат'}`;
  } else if (down === 1 && up === 2) term = s === 'F' ? 'тётя' : 'дядя';
  else if (down === 1 && up >= 3) term = (s === 'F' ? 'двоюродная ' : 'двоюродный ') + 'пра'.repeat(up - 3) + (s === 'F' ? 'бабушка' : 'дед');
  else if (up === 1 && down >= 2) term = (down === 2 ? (s === 'F' ? 'племянница' : 'племянник') : 'внучатый ' + (s === 'F' ? 'племянница' : 'племянник'));
  else term = 'родственник';
  if (side && up > 1 && down === 0) term += side === 'father' ? ' по отцу' : ' по матери';
  return term;
}

// Индекс связей из выгрузки дерева.
export function buildIndex(data) {
  const persons = new Map(data.persons.map((p) => [p.id, p]));
  const families = new Map(data.families.map((f) => [f.id, { ...f, children: [] }]));
  const parentFamilies = new Map();
  const spouseFamilies = new Map();
  for (const c of data.children) {
    const f = families.get(c.family_id);
    if (!f) continue;
    f.children.push(c.child_id);
    if (!parentFamilies.has(c.child_id)) parentFamilies.set(c.child_id, []);
    parentFamilies.get(c.child_id).push(f.id);
  }
  for (const f of families.values()) {
    for (const id of [f.partner1, f.partner2]) {
      if (!id) continue;
      if (!spouseFamilies.has(id)) spouseFamilies.set(id, []);
      spouseFamilies.get(id).push(f.id);
    }
    f.children.sort((a, b) => (birthYear(persons.get(a)) ?? 9999) - (birthYear(persons.get(b)) ?? 9999));
  }
  return { persons, families, parentFamilies, spouseFamilies };
}

export function parentsOf(idx, id) {
  const out = [];
  for (const fid of idx.parentFamilies.get(id) || []) {
    const f = idx.families.get(fid);
    for (const pid of [f.partner1, f.partner2]) if (pid && !out.includes(pid)) out.push(pid);
  }
  return out;
}

export function spousesOf(idx, id) {
  const out = [];
  for (const fid of idx.spouseFamilies.get(id) || []) {
    const f = idx.families.get(fid);
    const other = f.partner1 === id ? f.partner2 : f.partner1;
    out.push({ familyId: fid, spouseId: other || null });
  }
  return out;
}

export function childrenOf(idx, id) {
  const out = [];
  for (const fid of idx.spouseFamilies.get(id) || []) for (const c of idx.families.get(fid).children) if (!out.includes(c)) out.push(c);
  return out;
}

export function siblingsOf(idx, id) {
  const out = [];
  for (const fid of idx.parentFamilies.get(id) || []) for (const c of idx.families.get(fid).children) if (c !== id && !out.includes(c)) out.push(c);
  return out;
}

// Родство target относительно me: поиск ближайшего общего предка.
export function kinship(idx, me, target) {
  if (!me || !target || !idx.persons.has(me) || !idx.persons.has(target)) return null;
  if (me === target) return 'это вы';
  const t = idx.persons.get(target);
  for (const s of spousesOf(idx, me)) if (s.spouseId === target) return t.sex === 'F' ? 'жена' : 'муж';
  const ancestors = (start) => {
    const dist = new Map([[start, { d: 0, side: null }]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const { d, side } = dist.get(cur);
      for (const p of parentsOf(idx, cur)) {
        if (dist.has(p)) continue;
        const sx = idx.persons.get(p)?.sex;
        dist.set(p, { d: d + 1, side: side ?? (sx === 'M' ? 'father' : 'mother') });
        queue.push(p);
      }
    }
    return dist;
  };
  const a = ancestors(me);
  const b = ancestors(target);
  let best = null;
  for (const [id, x] of a) {
    const y = b.get(id);
    if (y && (!best || x.d + y.d < best.up + best.down)) best = { up: x.d, down: y.d, side: x.side };
  }
  if (!best) {
    // Родственники супруга
    for (const s of spousesOf(idx, me)) {
      if (!s.spouseId) continue;
      const sa = ancestors(s.spouseId);
      if (sa.has(target) && sa.get(target).d === 1) return t.sex === 'F' ? 'тёща / свекровь' : 'тесть / свёкор';
    }
    for (const c of childrenOf(idx, me)) for (const s of spousesOf(idx, c)) if (s.spouseId === target) return t.sex === 'F' ? 'невестка' : 'зять';
    return null;
  }
  return kinshipTerm(best.up, best.down, t.sex, best.down === 0 ? best.side : null);
}

export function missingFields(p, idx) {
  const miss = [];
  if (!p.birth_date) miss.push('дата рождения');
  if (!p.birth_place) miss.push('место рождения');
  if (!p.living && !p.death_date) miss.push('дата смерти');
  if (!p.photo_id) miss.push('фото');
  if (idx && parentsOf(idx, p.id).length < 2) miss.push('родители');
  return miss;
}
