// Проверка дерева: противоречия в датах и связях, вероятные дубли, люди без связей. Общая для телефона и сервера.
// Неточные даты («около 1890», «до 1917», «между 1880 и 1885», только год) читаются как промежуток лет:
// находка — только если противоречие есть при любом прочтении промежутка. Старый стиль расхождением не считается.
import {
  buildIndex, parentsOf, childrenOf, spousesOf, fullName, foldName, looseName, sameName, samePatronymic, exactDate, isOldStyle, withOldStyle,
  yearsText, parseDate, nameGenitive,
} from './names.js';
import { treeParts } from './wholetree.js';

// ---------- Даты как промежуток ----------

export const ABOUT = 5; // «около 1890» — от 1885 до 1895
const OLD = 13 / 365; // старый стиль отстаёт не больше чем на 13 дней
const MONTHS_RU = [/^янв/, /^фев/, /^мар/, /^апр/, /^ма[йяе]$/, /^июн/, /^июл/, /^авг/, /^сен/, /^окт/, /^ноя/, /^дек/];
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (w) => {
  const x = w.toLowerCase().replace(/\.$/, '');
  const ru = MONTHS_RU.findIndex((r) => r.test(x));
  return ru >= 0 ? ru + 1 : MONTHS_EN.indexOf(x.slice(0, 3)) + 1;
};
const daysIn = (m, y) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// День как доля года: 1 июля 1990 — около 1990,5.
const at = (y, m = 1, d = 1) => y + (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / (86400000 * (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365));
const DAY = 1 / 365;

// Части даты: «12.03.1890», «03.1890», «12 марта 1890», «март 1890», «1890», «1890-е». Непонятное — bad.
const ATOM = /(\d{1,2})\.(\d{1,2})\.(\d+)|(\d{1,2})\.(\d+)|(?:(\d{1,2})\s+)?([a-zа-яё]{3,}\.?)\s+(\d+)|(\d+)(-?(?:е|х)(?![а-яa-z]))?/giu;
function atoms(t) {
  const out = [];
  for (const m of t.matchAll(ATOM)) {
    if (m[3]) {
      const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (m[3].length !== 4 || mo < 1 || mo > 12 || d < 1 || d > daysIn(mo, y)) return null;
      out.push([at(y, mo, d), at(y, mo, d) + DAY]);
    } else if (m[5]) {
      const [mo, y] = [Number(m[4]), Number(m[5])];
      if (m[5].length !== 4 || mo < 1 || mo > 12) return null;
      out.push([at(y, mo), mo === 12 ? y + 1 : at(y, mo + 1)]);
    } else if (m[8]) {
      const y = Number(m[8]);
      if (m[8].length !== 4) return null;
      const mo = monthOf(m[7]);
      if (!mo) { out.push([y, y + 1]); continue; } // «лето 1945», «г. 1945» — просто год
      const d = m[6] ? Number(m[6]) : null;
      if (d !== null && (d < 1 || d > daysIn(mo, y))) return null;
      out.push(d ? [at(y, mo, d), at(y, mo, d) + DAY] : [at(y, mo), mo === 12 ? y + 1 : at(y, mo + 1)]);
    } else if (m[9]) {
      const y = Number(m[9]);
      if (m[9].length !== 4) return null;
      out.push(m[10] && y % 10 === 0 ? [y, y + 10] : [y, y + 1]);
    }
  }
  return out;
}

// Текст даты -> { lo, hi, exact } (годы с долями: hi — не включая), null — даты нет, { bad: true } — непонятна.
export function dateRange(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const ex = exactDate(raw);
  if (ex) {
    const lo = at(ex.year, ex.month, ex.day);
    // До 1918 точную дату могли записать по старому стилю и без пометки: расхождение до 13 дней — не находка.
    const slack = lo < 1918.2 ? OLD : 0;
    return { lo: lo - slack, hi: lo + DAY + slack, exact: true };
  }
  const old = isOldStyle(raw);
  const t = foldName(withOldStyle(raw, false)).replace(/[()]/g, ' ');
  const parts = atoms(t);
  if (!parts || !parts.length || parts.length > 2) return { bad: true };
  let lo = parts[0][0];
  let hi = parts.at(-1)[1];
  if (lo >= hi) return { bad: true };
  const about = /(^|\s)(около|ок\.?|приблиз\S*|примерно|abt|est|cal)(\s|$)|[~?]/.test(t);
  if (parts.length === 1) {
    if (/^(до|bef|to|не позже|не позднее)(\s|$)/.test(t)) lo = -Infinity;
    else if (/^(после|aft|не раньше|не ранее)(\s|$)/.test(t)) hi = Infinity;
  }
  if (about) { lo -= ABOUT; hi += ABOUT; }
  // Даты до 1918 могли записать по старому стилю и без пометки.
  if (old || lo < 1918.2) { lo -= OLD; hi += OLD; }
  return { lo, hi, exact: false };
}

// Год для фразы: «1967», «около 1967».
function yearText(text) {
  const d = parseDate(text);
  return d?.year ? `${d.approx || /abt|est|cal|bef|aft|bet/i.test(text) ? 'около ' : ''}${d.year}` : String(text);
}
const plainYear = (text) => parseDate(text)?.year ?? null;

// ---------- Подписи ----------

const nameOf = (p) => (p ? p.given || fullName(p) : '');
const ofName = (p) => nameGenitive(p, true); // «у Марата»
const his = (p) => (p?.sex === 'F' ? 'её' : 'его');
const PARENT = { M: ['отец', 'отцу'], F: ['мать', 'матери'], U: ['родитель', 'родителю'] };
const parentWord = (p, i = 0) => (PARENT[p.sex] || PARENT.U)[i];
const died = (p) => (p.sex === 'F' ? 'умерла' : 'умер');
const born = (p) => (p.sex === 'F' ? 'родилась' : 'родился');
const yearsOld = (a, b, approx) => `${approx ? 'около ' : ''}${yearsText(Math.max(0, a - b))}`;

// ---------- Находки ----------

export const LEVELS = ['error', 'warn', 'dup', 'alone'];
export const LEVEL_TITLE = { error: 'Ошибки', warn: 'Стоит проверить', dup: 'Возможно, один человек', alone: 'Без связей' };
// Что входит в отметку «Всё верно»: если у людей находки что-то из этого изменится, находка вернётся.
const SIG_FIELDS = ['surname', 'given', 'patronymic', 'birth_surname', 'sex', 'living', 'birth_date', 'death_date'];

export const PERSON_DATES = [['birth_date', 'рождения'], ['death_date', 'смерти']];

// Все находки по дереву. data — как из /api/tree (persons, families, children), idx — готовый buildIndex (необязательно).
// -> [{ key, kind, level, persons: [id], text, fix: id, field, sig, strong }], самые важные первыми.
export function checkTree(data, { idx = buildIndex(data), now = new Date() } = {}) {
  const today = now.getFullYear() + (now - new Date(now.getFullYear(), 0, 1)) / (365.25 * 86400000);
  const out = [];
  const P = idx.persons;
  const range = new Map(); // id -> { birth, death }
  for (const p of P.values()) range.set(p.id, { birth: dateRange(p.birth_date), death: dateRange(p.death_date) });
  const ok = (r) => r && !r.bad;
  const add = (kind, level, persons, text, extra = {}) => {
    const ids = [...new Set(persons)].filter(Boolean);
    const fix = extra.fix || ids[0];
    const key = [kind, extra.field, fix, [...ids].sort().join(',')].filter(Boolean).join(':');
    out.push({ key, kind, level, persons: ids, text, ...extra, fix });
  };
  // Вид связи ребёнка в семье: проверки возраста — только для родных детей.
  const childKind = new Map(data.children.map((c) => [`${c.family_id}:${c.child_id}`, c.kind || 'birth']));
  const birthParents = (id) => {
    const out2 = [];
    for (const fid of idx.parentFamilies.get(id) || []) {
      if (childKind.get(`${fid}:${id}`) !== 'birth') continue;
      const f = idx.families.get(fid);
      for (const pid of [f.partner1, f.partner2]) if (pid && P.has(pid) && !out2.includes(pid)) out2.push(pid);
    }
    return out2;
  };

  // Промежутки с концом «не включая»: «меньше 13 лет при любом прочтении» — это maxAge <= 13.
  // Даты одного человека.
  for (const p of P.values()) {
    const { birth, death } = range.get(p.id);
    for (const [field, word] of PERSON_DATES) {
      const r = field === 'birth_date' ? birth : death;
      if (r?.bad) add('bad_date', 'warn', [p.id], `Приложение не понимает дату ${word} у ${ofName(p)}: «${p[field]}». Запишите, например, 12.03.1890, 1890 или около 1890`, { field });
      else if (r && r.lo > today) add('future', 'error', [p.id], `Дата ${word} у ${ofName(p)} — ${p[field]}: она ещё не наступила`, { field });
    }
    if (ok(birth) && ok(death) && death.hi < birth.lo) {
      add('death_before_birth', 'error', [p.id], `${nameOf(p)} ${born(p)} в ${yearText(p.birth_date)} году, а ${died(p)} — в ${yearText(p.death_date)}: смерть раньше рождения`, { field: 'death_date' });
    }
    if (p.living && !p.death_date && ok(birth) && today - birth.hi > 110) {
      add('too_old', 'warn', [p.id], `${nameOf(p)} ${born(p)} в ${yearText(p.birth_date)} году и ${p.sex === 'F' ? 'отмечена живой' : 'отмечен живым'}: сейчас было бы ${yearsText(Math.floor(today - birth.lo))}. Жив${p.sex === 'F' ? 'а' : ''} ли?`, { field: 'living' });
    }
  }

  // Родители и дети.
  for (const c of P.values()) {
    const cb = range.get(c.id).birth;
    const bp = birthParents(c.id);
    if (bp.length > 2) {
      add('many_parents', 'error', [c.id, ...bp], `У ${ofName(c)} записано ${bp.length} родителя: ${bp.map((id) => fullName(P.get(id))).join(', ')}. Родных родителей двое — уберите лишнюю связь`, { links: true });
    }
    if (!ok(cb)) continue;
    for (const pid of bp) {
      const p = P.get(pid);
      const { birth: pb, death: pd } = range.get(pid);
      const approx = !(cb.hi - cb.lo <= 1.1 && ok(pb) && pb.hi - pb.lo <= 1.1);
      const cy = plainYear(c.birth_date);
      const head = `${nameOf(c)} ${born(c)} в ${yearText(c.birth_date)} году, а ${his(c)} ${parentWord(p)}`;
      if (ok(pb)) {
        const maxAge = cb.hi - pb.lo;
        const minAge = cb.lo - pb.hi;
        const age = () => yearsOld(cy, plainYear(p.birth_date), approx);
        if (maxAge <= 0) add('parent_younger', 'error', [c.id, pid], `${head} — в ${yearText(p.birth_date)}: ${parentWord(p)} младше ребёнка`, { fix: pid, field: 'birth_date' });
        else if (maxAge <= 13) add('parent_young', 'error', [c.id, pid], `${head} — в ${yearText(p.birth_date)}: ${parentWord(p, 1)} было ${age()}`, { fix: pid, field: 'birth_date' });
        else if (maxAge <= 15) add('parent_young', 'warn', [c.id, pid], `${head} — в ${yearText(p.birth_date)}: ${parentWord(p, 1)} было ${age()}`, { fix: pid, field: 'birth_date' });
        else if (p.sex === 'F' && minAge > 55) add('mother_old', 'warn', [c.id, pid], `${head} — в ${yearText(p.birth_date)}: матери было ${age()}`, { fix: pid, field: 'birth_date' });
      }
      if (ok(pd)) {
        // После смерти отца ребёнок может родиться в пределах 10 месяцев.
        const gap = p.sex === 'F' ? 0 : 10 / 12;
        if (cb.lo > pd.hi + gap) {
          add('after_death', 'error', [c.id, pid], `${head} ${died(p)} в ${yearText(p.death_date)}${p.sex === 'F' ? '' : ' — больше чем за 10 месяцев до рождения'}`, { fix: pid, field: 'death_date' });
        }
      }
    }
  }

  // Браки.
  for (const f of idx.families.values()) {
    const pair = [f.partner1, f.partner2].filter((id) => id && P.has(id));
    const r = dateRange(f.start_date);
    if (pair.length && r?.bad) add('bad_date', 'warn', pair, `${pair.map((id) => nameOf(P.get(id))).join(' и ')}: приложение не понимает дату брака «${f.start_date}»`, { field: `family:${f.id}` });
    else if (pair.length && r && r.lo > today) add('future', 'error', pair, `${pair.map((id) => nameOf(P.get(id))).join(' и ')}: дата брака — ${f.start_date}, она ещё не наступила`, { field: `family:${f.id}` });
    if (pair.length === 2) {
      const [a, b] = pair.map((id) => P.get(id));
      if (parentsOf(idx, a.id).includes(b.id) || parentsOf(idx, b.id).includes(a.id)) {
        const [kid, par] = parentsOf(idx, a.id).includes(b.id) ? [a, b] : [b, a];
        add('spouse_parent', 'error', [a.id, b.id], `${nameOf(a)} и ${nameOf(b)} записаны мужем и женой, но ${nameOf(par)} — ${his(kid)} ${parentWord(par)}`, { links: true });
      } else {
        const pa = birthParents(a.id);
        if (birthParents(b.id).some((x) => pa.includes(x))) {
          add('sibling_marriage', 'error', [a.id, b.id], `${nameOf(a)} и ${nameOf(b)} записаны мужем и женой, но у них общие родители: это брат и сестра`, { links: true });
        }
      }
    }
    if (!ok(r)) continue;
    for (const id of pair) {
      const p = P.get(id);
      const { birth, death } = range.get(id);
      const other = pair.find((x) => x !== id);
      const who = other ? `${nameOf(p)} и ${nameOf(P.get(other))}` : nameOf(p);
      if (ok(birth) && r.hi - birth.lo <= 14) {
        add('marriage_young', 'warn', [id, other], `${who}: брак в ${yearText(f.start_date)} году, а ${nameOf(p)} ${born(p)} в ${yearText(p.birth_date)} — ${p.sex === 'F' ? 'ей' : 'ему'} было ${yearsOld(plainYear(f.start_date), plainYear(p.birth_date), r.hi - r.lo > 1.1 || birth.hi - birth.lo > 1.1)}`, { fix: id, field: 'birth_date' });
      }
      if (ok(death) && r.lo > death.hi) {
        add('marriage_after_death', 'error', [id, other], `${who}: брак в ${yearText(f.start_date)} году, а ${nameOf(p)} ${died(p)} в ${yearText(p.death_date)}`, { fix: id, field: 'death_date' });
      }
    }
  }

  // Замкнутый круг: человек — собственный предок. Обход в глубину по родителям.
  const state = new Map(); // 1 — на пути, 2 — проверен
  for (const start of P.keys()) {
    if (state.get(start)) continue;
    const stack = [[start, parentsOf(idx, start), 0]];
    const path = [start];
    state.set(start, 1);
    while (stack.length) {
      const top = stack.at(-1);
      if (top[2] >= top[1].length) {
        state.set(top[0], 2);
        stack.pop();
        path.pop();
        continue;
      }
      const next = top[1][top[2]++];
      if (!P.has(next)) continue;
      const s = state.get(next);
      if (s === 1) {
        const ring = path.slice(path.indexOf(next));
        add('cycle', 'error', ring, `${nameOf(P.get(next))} ${P.get(next).sex === 'F' ? 'записана' : 'записан'} собственным предком: ${[...ring.slice().reverse(), next].map((id) => nameOf(P.get(id))).join(' → ')} — проверьте, кто чей ребёнок`, { links: true });
        continue;
      }
      if (s === 2) continue;
      state.set(next, 1);
      path.push(next);
      stack.push([next, parentsOf(idx, next), 0]);
    }
  }

  out.push(...findDuplicates(idx, range));

  // Без связей: одинокие люди и маленькие оторванные части.
  const parts = treeParts(idx);
  const main = parts.list[0]?.length || 0;
  for (const [i, ids] of parts.list.entries()) {
    if (i === 0 && main > 5) continue;
    if (ids.length === 1 && P.size > 1) add('alone', 'alone', ids, `${nameOf(P.get(ids[0]))} ни с кем не ${P.get(ids[0]).sex === 'F' ? 'связана' : 'связан'} в дереве: укажите родителей, мужа или жену, детей — или это лишняя карточка`);
    else if (ids.length >= 2 && ids.length <= 5 && main > 5) {
      add('island', 'alone', ids, `${ids.map((id) => nameOf(P.get(id))).join(', ')} — ${ids.length === 2 ? 'двое связаны' : `${ids.length} человека связаны`} друг с другом, но не с остальным деревом`);
    }
  }

  const seen = new Set();
  const list = out.filter((x) => !seen.has(x.key) && seen.add(x.key));
  // sig считается при первом обращении: нужен только для находок с отметками.
  for (const x of list) {
    let sig = null;
    Object.defineProperty(x, 'sig', { enumerable: true, get: () => (sig ??= signature(x, P, idx)) });
  }
  const rank = (x) => LEVELS.indexOf(x.level) * 10 - (x.strong ? 1 : 0);
  return list.sort((a, b) => rank(a) - rank(b));
}

// К чему относится находка: фраза и данные её людей (для брака — ещё и его дата). Сравнивается строкой.
function signature(x, P, idx) {
  const fam = x.field?.startsWith('family:') ? idx.families.get(x.field.slice(7)) : null;
  return JSON.stringify([x.text, ...[...x.persons].sort().map((id) => [id, ...SIG_FIELDS.map((f) => P.get(id)?.[f] ?? null)]), fam?.start_date ?? null]);
}

// ---------- Вероятные дубли ----------

// Предки человека (с ним самим): для проверки «родные по прямой».
function ancestorsOf(idx, id, cache) {
  if (cache.has(id)) return cache.get(id);
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) for (const p of parentsOf(idx, queue.shift())) if (!seen.has(p)) { seen.add(p); queue.push(p); }
  cache.set(id, seen);
  return seen;
}

const t = (s) => String(s || '').trim();
const surnames = (p) => [p.surname, p.birth_surname].filter((x) => t(x));
// Годы расходятся больше чем на 3 при любом прочтении.
const farYears = (a, b) => a && b && !a.bad && !b.bad && (a.lo - b.hi > 3 || b.lo - a.hi > 3);

function findDuplicates(idx, range) {
  const out = [];
  // Указатель: имя + фамилия (или девичья) в грубом написании. Внутри — по году рождения, сравниваем только соседей по годам.
  const info = new Map();
  const byKey = new Map();
  for (const p of idx.persons.values()) {
    const g = looseName(p.given);
    const sur = [...new Set(surnames(p).map(looseName).filter(Boolean))];
    if (!g || !sur.length) continue;
    const b = range.get(p.id).birth;
    info.set(p.id, { p, pat: looseName(p.patronymic), b: b && !b.bad ? b : null });
    for (const s of sur) {
      const k = `${g}|${s}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(info.get(p.id));
    }
  }
  const anc = new Map();
  const seen = new Set();
  const loose = new Map();
  const given = (id) => {
    if (!loose.has(id)) loose.set(id, looseName(idx.persons.get(id)?.given));
    return loose.get(id);
  };
  const consider = (x, y) => {
    const [a, b] = x.p.id < y.p.id ? [x.p, y.p] : [y.p, x.p];
    const key = `${a.id},${b.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (a.sex !== 'U' && b.sex !== 'U' && a.sex !== b.sex) return;
    if (x.pat && y.pat && x.pat !== y.pat && !samePatronymic(a.patronymic, b.patronymic)) return;
    if (farYears(range.get(a.id).death, range.get(b.id).death)) return;
    if (ancestorsOf(idx, a.id, anc).has(b.id) || ancestorsOf(idx, b.id, anc).has(a.id)) return;
    const pa = parentsOf(idx, a.id);
    const pb = parentsOf(idx, b.id);
    // Родители известны у обоих и совсем разные — это разные люди (двоюродные тёзки).
    if (pa.length && pb.length && !pa.some((u) => pb.some((v) => u === v || (given(u) && given(u) === given(v))))) return;
    const sa = spousesOf(idx, a.id).map((s) => s.spouseId).filter(Boolean);
    if (sa.includes(b.id)) return;
    const sb = spousesOf(idx, b.id).map((s) => s.spouseId).filter(Boolean);
    const reasons = [];
    if (pa.some((u) => pb.includes(u))) reasons.push('общие родители');
    if (sa.some((u) => sb.includes(u))) reasons.push(a.sex === 'F' ? 'один муж' : 'одна жена');
    const kids = childrenOf(idx, a.id);
    if (childrenOf(idx, b.id).some((u) => kids.includes(u))) reasons.push('общие дети');
    if (t(a.birth_date) && foldName(a.birth_date) === foldName(b.birth_date)) reasons.push('одна дата рождения');
    const desc = (p) => [fullName(p), t(p.birth_date) && `${yearText(p.birth_date)} г. р.`].filter(Boolean).join(', ');
    out.push({
      key: `dup:${a.id},${b.id}`,
      kind: 'dup',
      level: 'dup',
      persons: [a.id, b.id],
      fix: a.id,
      strong: reasons.length > 0,
      text: `Похоже, это один человек: ${desc(a)} — и ${desc(b)}${reasons.length ? `. Совпадает: ${reasons.join(', ')}` : ''}`,
    });
  };
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    // Без года рождения — со всеми; с годом — только с теми, кто родился не дальше чем через 3 года.
    const free = list.filter((x) => !x.b);
    const dated = list.filter((x) => x.b).sort((a, b) => a.b.lo - b.b.lo);
    for (let i = 0; i < free.length; i++) for (let j = 0; j < list.length; j++) if (list[j] !== free[i]) consider(free[i], list[j]);
    for (let i = 0; i < dated.length; i++) {
      for (let j = i + 1; j < dated.length && dated[j].b.lo - dated[i].b.hi <= 3; j++) consider(dated[i], dated[j]);
    }
  }
  return out;
}

// ---------- Отметки «Всё верно» ----------

// Находки без отмеченных: отметка действует, пока данные людей те же (sig совпадает).
export function openFindings(findings, marks = []) {
  const done = new Map(marks.map((m) => [m.key, m.sig]));
  return findings.filter((x) => !done.has(x.key) || done.get(x.key) !== x.sig);
}
// Отметки, которые сейчас что-то скрывают, — для списка «Отмечено как верное».
export function activeMarks(findings, marks = []) {
  const by = new Map(findings.map((x) => [x.key, x]));
  return marks.filter((m) => by.get(m.key)?.sig === m.sig).map((m) => ({ ...m, finding: by.get(m.key) }));
}
// Сводка: сколько находок каждого вида.
export function countByLevel(findings) {
  return Object.fromEntries(LEVELS.map((l) => [l, findings.filter((x) => x.level === l).length]));
}

// ---------- Объединение дублей ----------

export const MERGE_FIELDS = ['surname', 'given', 'patronymic', 'birth_surname', 'sex', 'living', 'birth_date', 'birth_place', 'death_date',
  'death_place', 'burial_place', 'occupation', 'notes'];

// Насколько точна дата: точный день лучше месяца, месяц лучше года, год лучше «около».
export function datePrecision(text) {
  const r = dateRange(text);
  if (!r) return 0;
  if (r.bad) return 0.5;
  return r.exact ? 5 : r.hi - r.lo <= 0.1 ? 4 : r.hi - r.lo <= 1.1 ? 3 : r.hi - r.lo < Infinity ? 2 : 1;
}

// Что оставить по умолчанию: { поле: 'keep' | 'remove' | 'both' } — заполненное и более точное, при равенстве — оставшегося.
export function defaultChoice(keep, remove) {
  const out = {};
  for (const f of MERGE_FIELDS) {
    const a = keep[f];
    const b = remove[f];
    let pick = 'keep';
    if (f === 'sex') pick = a === 'U' && b !== 'U' ? 'remove' : 'keep';
    else if (f === 'living') pick = a && !b ? 'remove' : 'keep';
    else if (f.endsWith('_date')) pick = datePrecision(b) > datePrecision(a) ? 'remove' : 'keep';
    else if (f === 'notes') pick = !t(a) && t(b) ? 'remove' : t(a) && t(b) && t(a) !== t(b) ? 'both' : 'keep';
    else pick = !t(a) && t(b) ? 'remove' : 'keep';
    out[f] = pick;
  }
  return out;
}

// Карточка после объединения: значения по выбору. Указана дата смерти — человек не живой.
export function mergedPerson(keep, remove, choice) {
  const out = { ...keep };
  for (const f of MERGE_FIELDS) {
    const c = choice[f] || 'keep';
    if (c === 'remove') out[f] = remove[f];
    else if (c === 'both' && f === 'notes') out[f] = [t(keep.notes), t(remove.notes)].filter(Boolean).join('\n\n');
  }
  if (t(out.death_date)) out.living = false;
  if (out.living) Object.assign(out, { death_date: '', death_place: '', burial_place: '' });
  return out;
}
