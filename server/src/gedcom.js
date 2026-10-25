// Разбор файла GEDCOM 5.5.1 (из Древа или другой программы) в люди, семьи, события ленты жизни и источники приложения.
// Только чтение файла: в базу пишет src/gedimport.js. Всё непонятное не роняет разбор, а попадает в skipped — «не загрузится: …».
// Обратная сторона — routes/export.js (toGedcom): что там пишется, здесь читается так же.
import { HttpError } from './tree.js';
import { EVENT_KINDS } from '../../shared/events.js';
import { KINDS, QUALITY } from '../../shared/sources.js';
import { OLD_STYLE, guessSex, parseDate } from '../../shared/names.js';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_PERSONS = 10000;
const LIVE_YEARS = 110; // родился раньше — уже не живой, даже если о смерти ничего нет

// ---------- Кодировка и строки ----------

// Байты файла -> текст: UTF-8 (и UTF-16 с меткой), а если файл им не читается — windows-1251 (CHAR ANSI) или cp866 по заголовку.
export function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'UTF-8' };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'UTF-16' };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'UTF-16' };
  if (buf[0] === 0x30 && buf[1] === 0x00) return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'UTF-16' };
  const head = buf.subarray(0, 8192).toString('latin1');
  const char = (head.match(/^\s*1\s+CHAR\s+(\S+)/m)?.[1] || '').toUpperCase();
  if (char === 'ANSEL') {
    throw new HttpError(400, 'Файл в старой кодировке ANSEL, её приложение не читает. Сохраните файл заново в программе, где он сделан, выбрав кодировку UTF-8.');
  }
  // Файл, который читается как UTF-8, — в UTF-8, что бы ни было в заголовке: русский текст в windows-1251 так не читается.
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' };
  } catch {
    if (['IBM866', 'CP866'].includes(char)) return { text: new TextDecoder('ibm866').decode(buf), encoding: 'cp866' };
    return { text: new TextDecoder('windows-1251').decode(buf), encoding: 'windows-1251' };
  }
}

const LINE = /^\s*(\d{1,2})\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?: (.*))?$/;

// Текст -> записи верхнего уровня: { level, xref, tag, value, children }. CONT и CONC склеиваются в value.
export function parseLines(text) {
  const roots = [];
  const stack = [];
  let bad = 0;
  let total = 0;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (!raw.trim()) continue;
    total++;
    const m = raw.match(LINE);
    if (!m) { bad++; continue; }
    const level = Number(m[1]);
    const tag = m[3].toUpperCase();
    const value = (m[4] ?? '').replace(/@@/g, '@');
    if (level === 0) stack.length = 0;
    else if (level > stack.length) { bad++; continue; }
    stack.length = level;
    const parent = stack[level - 1];
    if (parent && (tag === 'CONT' || tag === 'CONC')) {
      parent.value += (tag === 'CONT' ? '\n' : '') + value;
      continue;
    }
    const node = { level, xref: m[2] || '', tag, value, children: [] };
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  if (!roots.length || roots[0].tag !== 'HEAD' || bad > total / 2) {
    throw new HttpError(400, 'Это не похоже на файл GEDCOM. Выберите файл с расширением .ged, сохранённый программой для родословных.');
  }
  return { roots, bad };
}

const kid = (node, tag) => node.children.find((c) => c.tag === tag);
const kids = (node, tag) => node.children.filter((c) => c.tag === tag);
const val = (node, tag) => (kid(node, tag)?.value || '').trim();

// ---------- Даты ----------

const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const pad = (n) => String(n).padStart(2, '0');

// Одна дата: «12 MAR 1890» -> «12.03.1890», «MAR 1890» -> «03.1890», «1890» -> «1890». Двойной год «1720/21» — первым.
function exact(s) {
  const t = s.trim().toUpperCase().replace(/\s+/g, ' ');
  let m = t.match(/^(\d{1,2}) ([A-Z]{3})\.? (\d{3,4})(?:\/\d{1,2})?$/);
  if (m && MON[m[2]]) return `${pad(m[1])}.${pad(MON[m[2]])}.${m[3]}`;
  m = t.match(/^([A-Z]{3})\.? (\d{3,4})(?:\/\d{1,2})?$/);
  if (m && MON[m[1]]) return `${pad(MON[m[1]])}.${m[2]}`;
  m = t.match(/^(\d{3,4})(?:\/\d{1,2})?$/);
  if (m) return m[1];
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{3,4})$/);
  if (m) return `${pad(m[1])}.${pad(m[2])}.${m[3]}`;
  return null;
}

// Дата GEDCOM -> как пишет приложение (обратное к gedDate и gedPeriod): ABT/EST/CAL -> «около», BEF -> «до», AFT -> «после»,
// BET … AND … -> «между … и …», FROM … TO … -> «1941–1945», FROM … -> «с 1950», «(фраза)» -> фраза.
// По юлианскому календарю (@#DJULIAN@) — с пометкой «ст. ст.». Непонятное — как записано.
export function fromGedDate(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  const phrase = s.match(/\(([^)]*)\)/)?.[1]?.trim() || '';
  if (/^\(.*\)$/.test(s)) return phrase;
  const julian = /@#DJULIAN@/i.test(s);
  s = s.replace(/@#D[A-Z ]+@/gi, ' ').replace(/\(.*\)/, '').replace(/^INT\s+/i, '').replace(/\s+/g, ' ').trim();
  const old = (x) => (julian ? `${x} ${OLD_STYLE}` : x);
  let m = s.match(/^BET (.+) AND (.+)$/i);
  if (m && exact(m[1]) && exact(m[2])) return old(`между ${exact(m[1])} и ${exact(m[2])}`);
  m = s.match(/^FROM (.+?)(?: TO (.+))?$/i);
  if (m && exact(m[1]) && (!m[2] || exact(m[2]))) return old(m[2] ? `${exact(m[1])}–${exact(m[2])}` : `с ${exact(m[1])}`);
  m = s.match(/^TO (.+)$/i);
  if (m && exact(m[1])) return old(`до ${exact(m[1])}`);
  m = s.match(/^(ABT|EST|CAL|BEF|AFT)\.? (.+)$/i);
  if (m && exact(m[2])) return old(`${{ BEF: 'до', AFT: 'после' }[m[1].toUpperCase()] || 'около'} ${exact(m[2])}`);
  if (exact(s)) return old(exact(s));
  return phrase || String(raw).trim();
}

// ---------- Имена ----------

const TATAR_PATR = /^(кызы|улы|углы|оглы|кизи)$/i;
// Отчество внутри имени: «Иван Петрович» -> Иван + Петрович, «Әминә Дәүләтшә кызы» -> Әминә + Дәүләтшә кызы.
export function splitPatronymic(given) {
  const w = String(given || '').trim().split(/\s+/).filter(Boolean);
  if (w.length >= 3 && TATAR_PATR.test(w.at(-1))) return { given: w.slice(0, -2).join(' '), patronymic: w.slice(-2).join(' ') };
  if (w.length >= 2 && /(вич|вна|ична|ич)$/i.test(w.at(-1))) return { given: w.slice(0, -1).join(' '), patronymic: w.at(-1) };
  return { given: w.join(' '), patronymic: '' };
}

function nameOf(node) {
  const m = node.value.match(/^([^/]*)\/([^/]*)\/?(.*)$/);
  let given = (m ? m[1] : node.value).trim();
  let surname = m ? m[2].trim() : '';
  if (val(node, 'GIVN')) given = val(node, 'GIVN');
  if (val(node, 'SURN')) surname = val(node, 'SURN');
  let patronymic = val(node, '_PATR') || val(node, '_PATRN') || val(node, '_MIDN');
  if (patronymic) {
    if (given.endsWith(` ${patronymic}`)) given = given.slice(0, -patronymic.length).trim();
  } else ({ given, patronymic } = splitPatronymic(given));
  return {
    given, surname, patronymic, type: val(node, 'TYPE').toLowerCase(), married: val(node, '_MARNM') || val(node, '_MARN'),
    text: node.value.replace(/\//g, '').replace(/\s+/g, ' ').trim(),
  };
}

// ---------- Разбор ----------

// Подписи того, что не загрузится. Служебные теги (номера, даты изменения записи) не упоминаем вовсе.
const SKIP_LABEL = {
  OBJE: 'фото и файлы (их можно добавить в альбом вручную)', ASSO: 'связи «крёстный», «свидетель»', ALIA: 'ссылки на другие записи о том же человеке',
  ANCI: 'отметки исследователя', DESI: 'отметки исследователя', SUBM: 'сведения о составителе', REPO: 'архивы-хранилища',
  ENGA: 'помолвки', MARB: 'объявления о браке', MARC: 'брачные договоры', MARL: 'разрешения на брак', MARS: 'брачные соглашения',
  ANUL: 'расторжения брака', DIVF: 'заявления о разводе', _STAT: 'вид отношений', FAMNOTE: 'заметки к семьям', FAMEVEN: 'другие события семей',
};
const QUIET = new Set(['CHAN', 'RIN', '_UID', 'UID', 'RFN', 'AFN', 'REFN', '_UPD', 'FAMS', 'FAMC', 'HEAD', 'TRLR', 'CREA', '_FSFTID', 'RESN',
  '_PRIM', 'SUBN', '_TODO', '_FLAG', 'ADDR', 'PHON', 'EMAIL', 'WWW', 'AGE', 'TYPE', 'NAME', 'SEX', 'NOTE', 'SOUR']);

// События человека, у которых нет своего поля: вид ленты жизни и название.
const EVENT_TAGS = {
  CHR: ['other', 'Крещение'], BAPM: ['other', 'Крещение'], CHRA: ['other', 'Крещение'], CONF: ['other', 'Конфирмация'],
  FCOM: ['other', 'Первое причастие'], ORDN: ['other', 'Посвящение в сан'], NATU: ['other', 'Получение гражданства'],
  ADOP: ['other', 'Усыновление'], RETI: ['other', 'Выход на пенсию'], CENS: ['other', 'Перепись'], PROB: ['other', 'Утверждение завещания'],
  WILL: ['other', 'Завещание'], BLES: ['other', 'Благословение'], BARM: ['other', 'Бар-мицва'], BASM: ['other', 'Бат-мицва'],
  GRAD: ['study', ''], EDUC: ['study', ''], _MILT: ['army', ''], _MILI: ['army', ''], MILI: ['army', ''], _MIL: ['army', ''],
  RESI: ['move', ''], EMIG: ['move', 'Эмиграция'], IMMI: ['move', 'Переезд в страну'], _DEG: ['study', ''], _AWAR: ['award', ''], _AWARD: ['award', ''],
};
// Признаки человека — строчками в заметки.
const ATTR_TAGS = {
  NATI: 'Национальность', RELI: 'Вероисповедание', TITL: 'Титул', CAST: 'Сословие', DSCR: 'Внешность', PROP: 'Имущество',
  NCHI: 'Детей', NMR: 'Браков', IDNO: 'Номер документа', _NAMS: 'Тёзка',
};

const QUAY = { 0: 'guess', 1: 'oral', 2: 'document', 3: 'document' };
const QUALITY_WORDS = new Map(Object.entries(QUALITY).flatMap(([k, q]) => [[q.label.toLowerCase(), k], [q.short.toLowerCase(), k]]));
const KIND_BY_LABEL = new Map(Object.entries(KINDS).map(([k, x]) => [x.label.toLowerCase(), k]));
const EVENT_BY_LABEL = new Map(Object.entries(EVENT_KINDS).map(([k, x]) => [x.label.toLowerCase(), k]));

// «ГАТО, ф. 160, оп. 1, д. 12, л. 34 об.» -> поля шифра дела; null — это не шифр.
export function parseCiteText(text) {
  const parts = String(text || '').split(/,\s*/).map((x) => x.trim()).filter(Boolean);
  const out = {};
  for (const [i, p] of parts.entries()) {
    let m;
    if ((m = p.match(/^ф\.\s*(.+)$/i))) out.fond = m[1];
    else if ((m = p.match(/^оп\.\s*(.+)$/i))) out.opis = m[1];
    else if ((m = p.match(/^д\.\s*(.+)$/i))) out.delo = m[1];
    else if ((m = p.match(/^л\.\s*(.+?)(\s+об\.?)?$/i))) Object.assign(out, { sheet: m[1], verso: Boolean(m[2]) });
    else if (i === 0) out.archive = p;
    else return null;
  }
  return out.fond || out.opis || out.delo || out.sheet ? out : null;
}

const cut = (s, n) => String(s || '').trim().slice(0, n);

// Файл -> { persons, families, events, sources, skipped: [{ label, count }], counts, encoding, fromDrevo }.
// Ссылки между записями — по ref (номера из файла: «@I1@»).
export function parseGedcom(buf) {
  if (buf.length > MAX_BYTES) throw new HttpError(413, `Файл слишком большой: больше ${MAX_BYTES / 1024 / 1024} МБ.`);
  const { text, encoding } = decode(buf);
  const { roots, bad } = parseLines(text);
  const head = roots[0];
  const fromDrevo = val(head, 'SOUR') === 'DREVO';
  const skipped = new Map();
  const skip = (tag) => {
    if (QUIET.has(tag)) return;
    const label = SKIP_LABEL[tag] || `сведения с пометкой ${tag}`;
    skipped.set(label, (skipped.get(label) || 0) + 1);
  };
  if (bad) skipped.set('испорченные строки файла', bad);

  const byTag = (tag) => roots.filter((r) => r.tag === tag);
  if (byTag('INDI').length > MAX_PERSONS) {
    throw new HttpError(413, `В файле ${byTag('INDI').length} человек, а загрузить за раз можно не больше ${MAX_PERSONS}.`);
  }
  const noteRecs = new Map(byTag('NOTE').filter((n) => n.xref).map((n) => [n.xref, n.value]));
  const repos = new Map(byTag('REPO').filter((n) => n.xref).map((n) => [n.xref, val(n, 'NAME')]));
  // Заметка: своим текстом или ссылкой на запись NOTE.
  const noteText = (n) => (/^@[^@]+@$/.test(n.value.trim()) ? noteRecs.get(n.value.trim()) || '' : n.value).trim();
  const notesOf = (node) => kids(node, 'NOTE').map(noteText).filter(Boolean);

  // Источники-записи.
  const sources = new Map();
  for (const r of byTag('SOUR')) {
    if (!r.xref) continue;
    const s = { ref: r.xref, kind: KIND_BY_LABEL.get(val(r, '_TYPE').toLowerCase()) || 'other', title: val(r, 'TITL'), url: '' };
    const abbr = val(r, 'ABBR');
    const shelf = parseCiteText(abbr);
    if (shelf) Object.assign(s, shelf);
    else if (!s.title) s.title = abbr;
    const repo = kid(r, 'REPO');
    if (repo && !s.archive) s.archive = repos.get(repo.value.trim()) || repo.value.trim().replace(/^@.*@$/, '');
    const lines = [val(r, 'AUTH') && `Автор: ${val(r, 'AUTH')}`, val(r, 'PUBL') && `Издание: ${val(r, 'PUBL')}`, val(r, 'TEXT'), ...notesOf(r)]
      .filter(Boolean).join('\n').split('\n');
    // Ссылка — отдельной строкой: первая такая идёт в поле «Ссылка».
    const url = lines.findIndex((l) => /^https?:\/\/\S+$/.test(l.trim()));
    if (url >= 0) s.url = cut(lines.splice(url, 1)[0], 1000);
    s.note = cut(lines.join('\n'), 5000);
    if (!s.title && !s.archive && !s.url) s.title = 'Источник из файла';
    s.title = cut(s.title, 300);
    for (const k of ['archive', 'fond', 'opis', 'delo', 'sheet']) s[k] = cut(s[k], { archive: 200, delo: 100 }[k] || 50);
    s.verso = Boolean(s.verso);
    for (const c of r.children) if (!['TITL', 'ABBR', '_TYPE', 'AUTH', 'PUBL', 'TEXT', 'NOTE', 'REPO', 'OBJE', 'DATA'].includes(c.tag)) skip(c.tag);
    if (kid(r, 'OBJE')) skip('OBJE');
    sources.set(s.ref, s);
  }

  // Ссылки на источники у сведения: цитаты (источник, уточнение) и достоверность. Источник текстом без записи — свой источник.
  const cites = [];
  const quality = [];
  const inline = new Map();
  const citesOf = (node, subject, ref, fact) => {
    for (const c of kids(node, 'SOUR')) {
      const q = QUAY[val(c, 'QUAY')];
      let sref = /^@[^@]+@$/.test(c.value.trim()) ? c.value.trim() : '';
      const text = sref ? '' : [c.value, val(c, 'TEXT')].filter(Boolean).join('\n').trim();
      // «со слов» с QUAY без источника — только отметка достоверности (так пишет Древо).
      const word = QUALITY_WORDS.get(text.toLowerCase());
      if (!sref && text && !word) {
        const key = text.toLowerCase();
        if (!inline.has(key)) {
          inline.set(key, `@inline${inline.size + 1}@`);
          sources.set(inline.get(key), { ref: inline.get(key), kind: 'other', title: cut(text.split('\n')[0], 300), note: cut(text.split('\n').slice(1).join('\n'), 5000), url: '', verso: false });
        }
        sref = inline.get(key);
      }
      if (sref && sources.has(sref)) cites.push({ subject, ref, fact, sref, page: cut(val(c, 'PAGE'), 300) });
      if (q || word) quality.push({ subject, ref, fact, quality: q || word });
    }
  };

  // Дата, место и заметки события.
  const facts = (node) => ({
    date: cut(fromGedDate(val(node, 'DATE')), 100),
    place: cut(val(node, 'PLAC') || val(node, 'ADDR'), 300),
    notes: notesOf(node),
  });

  const famKind = new Map(); // «@I1@ @F1@» -> вид родства ребёнка
  const events = [];
  const persons = [];
  for (const r of byTag('INDI')) {
    const p = {
      ref: r.xref, sex: 'U', surname: '', given: '', patronymic: '', birth_surname: '', alt_surname: '', alt_given: '', alt_patronymic: '', living: true, birth_date: '', birth_place: '',
      death_date: '', death_place: '', burial_place: '', occupation: '', notes: '',
    };
    const notes = [];
    const jobs = [];
    let dead = false;
    let birthDone = false;
    let deathDone = false;
    const names = kids(r, 'NAME').map((n) => ({ n, x: nameOf(n) }));
    // Второе написание: имя с TYPE aka, запись _AKA (Family Tree Maker) или ROMN / FONE (латиницей, как слышится) под именем.
    const isAka = (x) => ['aka', 'also known as'].includes(x.x.type);
    const first = names.find((x) => !['birth', 'maiden'].includes(x.x.type) && !isAka(x)) || names[0];
    const alts = [
      ...names.filter((x) => x !== first && isAka(x)),
      ...kids(r, '_AKA').map((n) => ({ n, x: nameOf(n) })),
      ...names.flatMap((x) => [...kids(x.n, 'ROMN'), ...kids(x.n, 'FONE')]).map((n) => ({ n, x: nameOf(n) })),
    ].filter((x) => x.x.given || x.x.surname);
    const alt = alts[0];
    if (first) {
      Object.assign(p, { given: first.x.given, surname: first.x.surname, patronymic: first.x.patronymic });
      const married = names.find((x) => x !== first && x.x.type === 'married');
      const birth = names.find((x) => x !== first && ['birth', 'maiden'].includes(x.x.type));
      if (first.x.married) [p.surname, p.birth_surname] = [first.x.married, first.x.surname];
      if (married?.x.surname) [p.surname, p.birth_surname] = [married.x.surname, first.x.surname];
      if (birth?.x.surname) p.birth_surname = birth.x.surname;
      if (!p.given && !p.patronymic) Object.assign(p, { given: (birth || married)?.x.given || '', patronymic: (birth || married)?.x.patronymic || '' });
      // То, что во втором написании так же, как в основном, не повторяем (Древо пишет второе имя целиком).
      if (alt) for (const k of ['surname', 'given', 'patronymic']) p[`alt_${k}`] = alt.x[k] === p[k] ? '' : alt.x[k];
      for (const x of [...names, ...alts]) if (x !== first && x !== married && x !== birth && x !== alt && x.x.text) notes.push(`Другое имя: ${x.x.text}`);
      for (const x of names) {
        citesOf(x.n, 'person', p.ref, 'name');
        notes.push(...notesOf(x.n));
        if (val(x.n, 'NICK')) notes.push(`Прозвище: ${val(x.n, 'NICK')}`);
      }
    }
    if (p.birth_surname === p.surname) p.birth_surname = '';
    for (const c of r.children) {
      const tag = c.tag;
      if (tag === 'NAME' || tag === '_AKA') continue;
      if (tag === 'SEX') { p.sex = ['M', 'F'].includes(c.value.trim().toUpperCase()) ? c.value.trim().toUpperCase() : 'U'; continue; }
      if (tag === 'NOTE') { notes.push(noteText(c)); continue; }
      if (tag === 'SOUR') continue;
      if (tag === 'FAMC') {
        const pedi = (val(c, 'PEDI') || '').toLowerCase();
        const kind = { adopted: 'adopted', foster: 'foster', step: 'step' }[pedi];
        if (kind) famKind.set(`${p.ref} ${c.value.trim()}`, kind);
        continue;
      }
      if (tag === 'BIRT' && !birthDone) {
        const f = facts(c);
        Object.assign(p, { birth_date: f.date, birth_place: f.place });
        birthDone = Boolean(f.date || f.place);
        notes.push(...f.notes.map((n) => `О рождении: ${n}`));
        citesOf(c, 'person', p.ref, 'birth');
        continue;
      }
      if (tag === 'DEAT' && c.value.trim().toUpperCase() !== 'N') {
        dead = true;
        if (deathDone) continue;
        const f = facts(c);
        Object.assign(p, { death_date: f.date, death_place: f.place });
        deathDone = Boolean(f.date || f.place);
        if (val(c, 'CAUS')) notes.push(`Причина смерти: ${val(c, 'CAUS')}`);
        notes.push(...f.notes.map((n) => `О смерти: ${n}`));
        citesOf(c, 'person', p.ref, 'death');
        continue;
      }
      if (tag === 'BURI' || tag === 'CREM') {
        dead = true;
        const f = facts(c);
        if (f.place && !p.burial_place) p.burial_place = f.place;
        if (f.date) notes.push(`${tag === 'CREM' ? 'Кремация' : 'Похороны'}: ${f.date}`);
        notes.push(...f.notes);
        citesOf(c, 'person', p.ref, 'burial_place');
        continue;
      }
      if (ATTR_TAGS[tag]) {
        const f = facts(c);
        const extra = [f.date, f.place].filter(Boolean).join(', ');
        notes.push(`${ATTR_TAGS[tag]}: ${[c.value.trim() || val(c, 'TYPE'), extra && `(${extra})`].filter(Boolean).join(' ')}`);
        continue;
      }
      const isJob = tag === 'OCCU';
      if (!isJob && !EVENT_TAGS[tag] && tag !== 'EVEN' && tag !== 'FACT') {
        skip(tag);
        continue;
      }
      const f = facts(c);
      const value = c.value.trim();
      const type = val(c, 'TYPE');
      // Род занятий без даты — поле карточки, с датой или местом — ещё и событие «Работа».
      if (isJob) {
        if (!f.date && !f.place && !f.notes.length) {
          if (value) jobs.push({ value, node: c });
          continue;
        }
        if (!fromDrevo && value) jobs.push({ value, node: c, dated: true });
      }
      let [kind, title] = isJob ? ['work', ''] : EVENT_TAGS[tag] || ['other', ''];
      if (tag === 'EVEN' || tag === 'FACT') {
        kind = EVENT_BY_LABEL.get(type.toLowerCase()) || 'other';
        if (kind === 'other') title = [type, value].filter(Boolean).join(': ') || 'Событие';
        else title = value;
      } else if (['army', 'war'].includes(kind)) {
        kind = EVENT_BY_LABEL.get(type.toLowerCase()) === 'war' || /войн/i.test(type) ? 'war' : 'army';
        title = value;
      } else title = [title, value].filter(Boolean).join(': ');
      // У переезда «что именно» — откуда: его пишет только Древо, в заметке. Адрес из RESI без места — местом.
      let place = f.place;
      const moved = kind === 'move' ? title : '';
      if (kind === 'move') {
        title = '';
        if (tag === 'RESI' && value && !place) place = value;
      }
      const ev = { kind, date: f.date, place: cut(place, 300), title: cut(title, 300), body: '', unit: '', rank: '' };
      // Заметка события: «Часть: …», «Звание: …» и подпись поля «что именно» (так пишет Древо) — по своим полям, остальное — описание.
      const body = [];
      const label = `${EVENT_KINDS[kind].title}: `;
      for (const line of f.notes.join('\n').split('\n')) {
        if (EVENT_KINDS[kind].military && line.startsWith('Часть: ') && !ev.unit) ev.unit = cut(line.slice(7), 300);
        else if (EVENT_KINDS[kind].military && line.startsWith('Звание: ') && !ev.rank) ev.rank = cut(line.slice(8), 100);
        else if (line.startsWith(label) && !ev.title) ev.title = cut(line.slice(label.length), 300);
        else body.push(line);
      }
      if (moved && !(tag === 'RESI' && moved === value && !f.place)) body.unshift(moved);
      ev.body = cut(body.join('\n'), 20000);
      ev.persons = [p.ref];
      ev.cites = [];
      ev.node = c;
      events.push(ev);
    }
    const plain = jobs.filter((j) => !j.dated);
    p.occupation = cut((plain.length ? plain : jobs.slice(-1)).map((j) => j.value).join('; '), 300);
    for (const j of plain) citesOf(j.node, 'person', p.ref, 'occupation');
    citesOf(r, 'person', p.ref, 'other');
    p.notes = cut(notes.filter(Boolean).join('\n\n'), 20000);
    for (const k of ['surname', 'given', 'patronymic', 'birth_surname', 'alt_surname', 'alt_given', 'alt_patronymic']) p[k] = cut(p[k], 300);
    if (p.sex === 'U' && p.patronymic) p.sex = guessSex(p.given, p.patronymic);
    const born = parseDate(p.birth_date)?.year;
    p.living = !dead && !(born && new Date().getFullYear() - born > LIVE_YEARS);
    if (!p.given && !p.surname && !p.patronymic) p.given = 'Без имени';
    persons.push(p);
  }
  const known = new Set(persons.map((p) => p.ref));

  // Источники сведения о рождении — к дате, а если её нет — к месту. Так же о смерти.
  const byRef = new Map(persons.map((p) => [p.ref, p]));
  // Вторая отметка достоверности того же события — к месту (Древо пишет их под одним BIRT).
  const marked = new Set();
  for (const x of [...cites, ...quality]) {
    for (const ev of ['birth', 'death']) {
      if (x.fact !== ev) continue;
      const p = byRef.get(x.ref);
      const [date, place] = [`${ev}_date`, `${ev}_place`];
      x.fact = p[date] || !p[place] ? date : place;
      if ('quality' in x && x.fact === date && p[place] && marked.has(`${x.ref} ${date}`)) x.fact = place;
      if ('quality' in x) marked.add(`${x.ref} ${x.fact}`);
    }
  }

  const families = [];
  for (const r of byTag('FAM')) {
    const ref = (tag) => (known.has(val(r, tag)) ? val(r, tag) : null);
    const f = { ref: r.xref, husb: ref('HUSB'), wife: ref('WIFE'), children: [], kind: 'marriage', start_date: '', place: '', end_date: '', ended: '' };
    if (f.husb === f.wife) f.wife = null;
    for (const c of kids(r, 'CHIL')) {
      const id = c.value.trim();
      if (!known.has(id) || id === f.husb || id === f.wife || f.children.some((x) => x.ref === id)) continue;
      const rel = (val(c, '_FREL') || val(c, '_MREL')).toLowerCase();
      const kind = famKind.get(`${id} ${r.xref}`) || { adopted: 'adopted', foster: 'foster', step: 'step' }[rel] || 'birth';
      f.children.push({ ref: id, kind });
    }
    const marr = kid(r, 'MARR');
    if (marr) {
      const x = facts(marr);
      Object.assign(f, { start_date: x.date, place: x.place });
      citesOf(marr, 'family', f.ref, 'marriage');
      if (x.notes.length) skip('FAMNOTE');
    } else if (fromDrevo && f.husb && f.wife) f.kind = 'unknown';
    const div = kid(r, 'DIV');
    if (div && div.value.trim().toUpperCase() !== 'N') Object.assign(f, { ended: 'divorce', end_date: facts(div).date });
    citesOf(r, 'family', f.ref, 'marriage');
    for (const c of r.children) {
      if (['HUSB', 'WIFE', 'CHIL', 'MARR', 'DIV', 'SOUR'].includes(c.tag)) continue;
      skip(c.tag === 'NOTE' ? 'FAMNOTE' : ['EVEN', 'CENS', 'RESI'].includes(c.tag) ? 'FAMEVEN' : c.tag);
    }
    if (f.husb || f.wife || f.children.length) families.push(f);
  }

  // Одно событие у нескольких людей (Древо пишет его у каждого участника) — одним событием с участниками.
  const merged = new Map();
  for (const ev of events) {
    const key = JSON.stringify([ev.kind, ev.date, ev.place, ev.title, ev.body, ev.unit, ev.rank]);
    const one = merged.get(key);
    if (one) {
      for (const id of ev.persons) if (!one.persons.includes(id)) one.persons.push(id);
      one.nodes.push(ev.node);
    } else merged.set(key, { ...ev, ref: `@E${merged.size + 1}@`, nodes: [ev.node] });
  }
  const eventList = [...merged.values()].map(({ node, nodes, cites: _, ...ev }) => {
    for (const n of nodes) citesOf(n, 'event', ev.ref, 'event');
    return ev;
  });

  for (const r of roots) if (!['HEAD', 'TRLR', 'INDI', 'FAM', 'SOUR', 'NOTE', 'REPO', 'SUBM', 'SUBN'].includes(r.tag)) skip(r.tag);

  // Цитаты одного источника у одного сведения — один раз.
  const seen = new Set();
  const citations = cites.filter((c) => {
    const k = `${c.subject}${c.ref}${c.fact}${c.sref}${c.page}`;
    return !seen.has(k) && seen.add(k);
  });
  const usedNotes = persons.filter((p) => p.notes).length;
  return {
    persons, families, events: eventList, sources: [...sources.values()], citations, quality, encoding, fromDrevo,
    skipped: [...skipped].map(([label, count]) => ({ label, count })),
    counts: { persons: persons.length, families: families.length, events: eventList.length, sources: sources.size, notes: usedNotes },
  };
}
