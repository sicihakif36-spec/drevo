// Поколенная роспись: потомки родоначальника по коленам, у каждого сквозной номер и ссылка на номер отца или матери,
// браки, дети со ссылками на номера в следующем колене, в конце — алфавитный указатель. Одна сборка для экрана
// (предпросмотр текстом) и PDF (server/src/rospis.js): запись — абзацы из кусочков текста, у ссылки на номер — ref.
import { dateText, fullName, isPrivate, lifespan, nameGenitive, parentsOf, parsePeriod, shortGenitive, spousesOf, surnameGenitive, todayText } from './names.js';
import { lifeItems } from './life.js';
import { sourceLine } from './sources.js';

export const MAX_GENS = 30;

export function parseRospisOptions(qs = {}) {
  const gens = Number(qs.gens);
  return {
    root: qs.root ? String(qs.root) : '',
    gens: Number.isInteger(gens) && gens > 0 ? Math.min(gens, MAX_GENS) : 0, // 0 — все колена
    line: qs.line === 'male' ? 'male' : 'all',
    events: qs.events !== '0',
    notes: qs.notes !== '0',
    sources: qs.sources === '1',
    hideLiving: qs.hideLiving === '1',
    theme: ['classic', 'modern', 'bw'].includes(qs.theme) ? qs.theme : 'classic',
    title: String(qs.title ?? '').trim().slice(0, 120),
  };
}

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n) {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

export const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

// «Смирнова (Орлова) Клавдия Николаевна».
export function bookName(p) {
  const birth = p.birth_surname && p.birth_surname !== p.surname ? `(${p.birth_surname})` : '';
  return [p.surname, birth, p.given, p.patronymic].filter(Boolean).join(' ') || 'Без имени';
}

const join = (...a) => a.filter(Boolean).join(', ');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const childWord = (p) => (p.sex === 'F' ? 'дочь' : p.sex === 'M' ? 'сын' : 'ребёнок');
// Неразрывные пробелы: «1918 – 2001», «№ 12», «р. 1949» не разрываются между строками.
// После тире — «склейка» U+2060: перенос после тире иначе разрешён.
const nb = (s) => String(s || '').replace(/ /g, '\u00a0').replace(/–/g, '–\u2060');
// Знаки препинания после ссылки — в саму ссылку: иначе перенос строки может оставить запятую или точку в начале строки.
function glue(parts) {
  const out = [];
  for (const x of parts) {
    const prev = out[out.length - 1];
    let t = x.t;
    const m = prev?.ref && !x.ref && t.match(/^[,.;:)]+/);
    if (m) {
      out[out.length - 1] = { ...prev, t: prev.t + m[0] };
      t = t.slice(m[0].length);
    }
    if (t) out.push({ ...x, t });
  }
  return out;
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function spouseLabel(f, s, k) {
  const [F, M] = [s.sex === 'F', s.sex === 'M'];
  if (f.kind === 'unknown') return F ? 'Мать детей' : M ? 'Отец детей' : 'Второй родитель';
  const w = f.kind === 'partners' ? (F ? 'гражданская жена' : M ? 'гражданский муж' : 'спутник жизни') : F ? 'жена' : M ? 'муж' : 'супруг(а)';
  return k ? `${k}-${F ? 'я' : 'й'} ${w}` : cap(w);
}

// o — parseRospisOptions; extras — события ленты жизни и источники, уже по правилам приватности: { events, sources, citations }.
export function buildRospis(idx, rootId, o, extras = {}) {
  const root = idx.persons.get(rootId);
  if (!root) return null;
  const get = (id) => idx.persons.get(id);
  // Скрытый живой: только имя. Порядок без его дат — чтобы на экране и в PDF номера совпадали.
  const hid = (p) => Boolean(p && (p.hidden || (o.hideLiving && isPrivate(p))));
  // Фамилия при рождении у живого скрыта, как в privacy.js.
  const name = (p) => bookName(hid(p) ? { ...p, birth_surname: '' } : p);
  const famHidden = (f) => hid(get(f.partner1)) || hid(get(f.partner2));
  const key = (d) => parsePeriod(d)?.key ?? Infinity;
  const pkey = (p) => (hid(p) ? Infinity : key(p.birth_date));
  const time = (x) => new Date(x || 0).getTime() || 0;
  const byBirth = (a, b) => pkey(get(a)) - pkey(get(b)) || fullName(get(a)).localeCompare(fullName(get(b)), 'ru') || cmp(a, b);
  const families = (id) => spousesOf(idx, id)
    .map((s) => ({ f: idx.families.get(s.familyId), spouse: s.spouseId && s.spouseId !== id ? get(s.spouseId) : null }))
    .sort((a, b) => (famHidden(a.f) ? Infinity : key(a.f.start_date)) - (famHidden(b.f) ? Infinity : key(b.f.start_date))
      || time(a.f.created_at) - time(b.f.created_at) || cmp(a.f.id, b.f.id));
  const kids = (f) => f.children.filter((c) => idx.persons.has(c)).sort(byBirth);
  // Фамильная роспись: дальше идут только сыновья (и сам родоначальник).
  const continues = (id) => o.line !== 'male' || id === rootId || get(id).sex === 'M';

  // Номера по коленам: в колене — по порядку номеров родителей, у родителя — по бракам и годам рождения.
  const num = new Map([[rootId, 1]]);
  const from = new Map(); // кто из родителей дал номер
  const gens = [];
  let cur = [rootId];
  const limit = o.gens || Infinity;
  for (let g = 1; cur.length && g <= limit; g++) {
    gens.push(cur);
    if (g === limit) break;
    const next = [];
    for (const id of cur) {
      if (!continues(id)) continue;
      for (const { f } of families(id)) for (const c of kids(f)) {
        if (num.has(c)) continue;
        num.set(c, num.size + 1);
        from.set(c, id);
        next.push(c);
      }
    }
    cur = next;
  }

  // События и источники по людям.
  const evBy = new Map();
  for (const e of extras.events || []) {
    if ((e.persons || []).some((id) => hid(get(id)))) continue;
    for (const id of e.persons || []) (evBy.get(id) || evBy.set(id, []).get(id)).push(e);
  }
  const srcById = new Map((extras.sources || []).map((s) => [s.id, s]));
  const citBy = new Map();
  for (const c of extras.citations || []) {
    if (!srcById.has(c.source_id) || (c.persons || []).some((id) => hid(get(id)))) continue;
    for (const id of c.persons || []) (citBy.get(id) || citBy.set(id, []).get(id)).push(c);
  }

  const mentioned = new Map(); // супруги не из потомков -> номера записей
  const ref = (n) => ({ t: `№\u00a0${n}`, ref: n });
  const parentsText = (p) => {
    const ps = parentsOf(idx, p.id).map(get).filter(Boolean);
    if (!ps.length) return '';
    const dad = ps.find((x) => x.sex === 'M');
    const mom = ps.find((x) => x.sex === 'F');
    const list = [dad, mom, ...ps.filter((x) => x !== dad && x !== mom)].filter(Boolean).slice(0, 2);
    return `${childWord(p)} ${list.map(shortGenitive).join(' и ')}`;
  };
  const bond = (f) => {
    if (famHidden(f)) return '';
    const divorce = f.ended === 'divorce' && `развод${f.end_date ? ` ${dateText(f.end_date)}` : ''}`;
    return [join(f.start_date && `с ${dateText(f.start_date)}`, f.place), divorce].filter(Boolean).join('; ');
  };

  const entry = (id) => {
    const p = get(id);
    const n = num.get(id);
    const paras = [];
    const head = [{ t: `${n}. ${name(p)}`, b: true }];
    const ps = parentsOf(idx, id).filter((x) => x !== id && num.has(x) && continues(x)).sort((a, b) => num.get(a) - num.get(b));
    if (id === rootId) head.push({ t: p.sex === 'F' ? ' — родоначальница' : ' — родоначальник' });
    else if (ps.length) {
      head.push({ t: ` — ${childWord(p)} ` });
      ps.forEach((x, i) => head.push(...(i ? [{ t: ' и ' }] : []), ref(num.get(x))));
    }
    paras.push({ kind: 'head', parts: head });

    if (!hid(p)) {
      const she = p.sex === 'F';
      const born = join(dateText(p.birth_date), p.birth_place);
      const died = join(dateText(p.death_date), p.death_place);
      const facts = [
        born && `${she ? 'Родилась' : 'Родился'}: ${born}.`,
        !p.living && died && `${she ? 'Умерла' : 'Умер'}: ${died}.`,
        !p.living && p.burial_place && `${she ? 'Похоронена' : 'Похоронен'}: ${p.burial_place}.`,
        p.occupation && `Род занятий: ${p.occupation}.`,
      ].filter(Boolean);
      if (facts.length) paras.push({ kind: 'facts', parts: [{ t: facts.join(' ') }] });
      if (o.events) {
        const items = lifeItems(p, idx, evBy.get(id) || []).filter((x) => x.event).map((x) =>
          [x.date && dateText(x.date), `${x.title}${x.note ? ` (${x.note})` : ''}${x.place ? `, ${x.place}` : ''}`].filter(Boolean).join(' — '));
        if (items.length) paras.push({ kind: 'events', parts: [{ t: 'Жизнь: ', b: true }, { t: `${items.join('; ')}.` }] });
      }
      if (o.notes && p.notes?.trim()) paras.push({ kind: 'note', parts: [{ t: p.notes.trim() }] });
    }

    const fams = families(id);
    const many = fams.filter((x) => x.spouse && x.f.kind !== 'unknown').length > 1;
    let k = 0;
    for (const { f, spouse } of fams) {
      if (spouse) {
        if (f.kind !== 'unknown') k++;
        const parts = [{ t: spouseLabel(f, spouse, many && f.kind !== 'unknown' ? k : 0), b: true }];
        if (bond(f)) parts.push({ t: ` (${bond(f)})` });
        parts.push({ t: `: ${name(spouse)}` });
        const life = hid(spouse) ? '' : nb(lifespan(spouse));
        if (life) parts.push({ t: `, ${life}` });
        if (num.has(spouse.id)) parts.push({ t: ', см. ' }, ref(num.get(spouse.id)));
        else {
          const par = parentsText(spouse);
          if (par) parts.push({ t: `, ${par}` });
          (mentioned.get(spouse.id) || mentioned.set(spouse.id, []).get(spouse.id)).push(n);
        }
        parts.push({ t: '.' });
        paras.push({ kind: 'marriage', parts });
      }
      const list = continues(id) ? kids(f) : [];
      if (!list.length) continue;
      const one = list.length === 1 ? get(list[0]) : null;
      const parts = [{ t: one ? `${cap(childWord(one))}: ` : 'Дети: ', b: true }];
      list.forEach((c, i) => {
        const x = get(c);
        if (i) parts.push({ t: ', ' });
        const name = x.given || fullName(x);
        if (!num.has(c)) parts.push({ t: `${name}${!hid(x) && lifespan(x) ? ` (${nb(lifespan(x))})` : ''}` });
        else parts.push({ t: `${name} ` }, { ...ref(num.get(c)), t: from.get(c) === id ? `(№\u00a0${num.get(c)})` : `(см.\u00a0№\u00a0${num.get(c)})` });
      });
      parts.push({ t: '.' });
      paras.push({ kind: 'kids', parts });
    }

    if (o.sources && !hid(p)) {
      const cits = citBy.get(id) || [];
      for (const sid of new Set(cits.map((c) => c.source_id))) {
        paras.push({ kind: 'source', parts: [{ t: sourceLine(srcById.get(sid), cits) }] });
      }
    }
    return { id, num: n, paras: paras.map((p) => ({ ...p, parts: glue(p.parts) })) };
  };

  const out = gens.map((ids, i) => ({ n: i + 1, title: `${roman(i + 1)} колено`, entries: ids.map(entry) }));

  // Указатель: потомки и их мужья и жёны по алфавиту, с номерами записей.
  const index = [...num.keys()].map((id) => ({ id, nums: [num.get(id)], own: true }))
    .concat([...mentioned].map(([id, nums]) => ({ id, nums: [...new Set(nums)].sort((a, b) => a - b), own: false })))
    .map((x) => ({ ...x, name: name(get(x.id)), life: hid(get(x.id)) ? '' : nb(lifespan(get(x.id))) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.nums[0] - b.nums[0]);
  for (const x of index) {
    x.letter = x.name.charAt(0).toUpperCase();
    x.parts = glue([{ t: `${x.name}${x.life ? `, ${x.life}` : ''} — ` },
      ...x.nums.flatMap((n, i) => [...(i ? [{ t: ', ' }] : []), { t: String(n), ref: n, b: x.own && i === 0 }])]);
  }

  const desc = num.size;
  const total = index.length;
  const female = root.sex === 'F' || (root.sex !== 'M' && /(вна|чна)$/.test(root.patronymic || ''));
  const intro = [];
  const life = hid(root) ? '' : nb(lifespan(root));
  intro.push([{ t: root.sex === 'F' ? 'Родоначальница — ' : 'Родоначальник — ' }, { t: name(root), b: true }, { t: `${life ? ` (${life})` : ''}.` }]);
  intro.push([{ t: `В росписи ${out.length} ${plural(out.length, 'колено', 'колена', 'колен')} и ${total} ${plural(total, 'человек', 'человека', 'человек')}`
    + (total > desc ? `: ${desc} ${plural(desc, 'потомок', 'потомка', 'потомков')} и ${total - desc} — их мужья и жёны.` : '.') }]);
  if (o.line === 'male') intro.push([{ t: 'Роспись фамильная, по мужской линии: описаны сыновья и дочери, а их дети — только у сыновей.' }]);
  intro.push([{ t: 'У каждого свой номер. «Сын № 3» — сын того, кто описан под № 3; номер у ребёнка — где он описан в следующем колене.' }]);
  if (o.hideLiving || [...num.keys(), ...mentioned.keys()].some((id) => get(id).hidden)) {
    intro.push([{ t: 'Даты и места живых родственников не показываются.' }]);
  }
  intro.push([{ t: `Составлено ${todayText()}.` }]);

  return {
    title: o.title || 'Поколенная роспись',
    subtitle: `потомков ${[root.given ? nameGenitive(root) : fullName(root), root.given && surnameGenitive(root.surname, female)].filter(Boolean).join(' ')}`
      + (o.line === 'male' ? ' по мужской линии' : ''),
    root: rootId,
    intro,
    gens: out,
    index,
    count: { gens: out.length, desc, total },
  };
}

// Вся роспись простым текстом: для проверок и чтобы видеть, что совпадает с экраном.
export const partsText = (parts) => parts.map((x) => x.t).join('');
export function rospisText(r) {
  const lines = [r.title, r.subtitle, ...r.intro.map(partsText)];
  for (const g of r.gens) {
    lines.push('', g.title);
    for (const e of g.entries) lines.push(...e.paras.map((p) => partsText(p.parts)));
  }
  lines.push('', 'Указатель имён');
  for (const x of r.index) lines.push(partsText(x.parts));
  return lines.join('\n');
}
