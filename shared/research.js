// Исследование: вопросы поиска, запрос для ИИ-помощника и разбор его ответа. Общий код телефона и сервера.
// Помощником человек пользуется сам: приложение готовит текст запроса (PROMPT — тот же, что в docs/issledovanie.md)
// и принимает ответ — вырезает из него файл GEDCOM для обычной загрузки из файла. Сервер ни к какому ИИ не обращается.
import { fullName, lifespan, dateText, isPrivate, parentsOf, siblingsOf, spousesOf, childrenOf } from './names.js';
import { EVENT_KINDS, eventTitle } from './events.js';

export const STATUSES = {
  open: { label: 'Ищем' },
  found: { label: 'Нашли' },
  notfound: { label: 'Не нашли' },
};
export const RESULTS = {
  '': { label: 'Заметка' },
  found: { label: 'Нашли' },
  notfound: { label: 'Не нашли' },
};
export const QUESTION_MAX = 300;
export const NOTE_LIMITS = { place: 300, url: 1000, ref: 300, body: 20000 };
// Ответ помощника целиком — не больше (в нём файл GEDCOM; большие деревья загружают файлом).
export const ANSWER_MAX = 2 * 1024 * 1024;

const GED_LINE = /^\s*\d{1,2}\s+(@[^@\s]+@\s+)?[A-Za-z0-9_]+( .*)?$/;
const HEAD = /^\s*0\s+HEAD\s*$/;
const TRLR = /^\s*0\s+TRLR\s*$/;
const FENCE = /^\s*(```|~~~)/;

// Ответ помощника -> { gedcom, report } или null, если файла GEDCOM в тексте нет.
// GEDCOM — от «0 HEAD» до «0 TRLR» (или до конца блока кода и до конца текста, если TRLR нет);
// report — остальной текст (отчёт помощника: что нашли, что делать дальше).
export function extractGedcom(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const start = lines.findIndex((l) => HEAD.test(l));
  if (start < 0) return null;
  // Файл внутри блока кода ```…```: до его конца.
  const fenced = lines.slice(0, start).filter((l) => FENCE.test(l)).length % 2 === 1;
  let end = lines.length;
  let closed = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (TRLR.test(lines[i])) { end = i + 1; closed = true; break; }
    if (FENCE.test(lines[i])) { end = i; break; }
  }
  // Без TRLR и вне блока кода файл кончается там, где снова пошёл текст отчёта.
  if (!closed && !fenced) {
    const bad = lines.slice(start, end).findIndex((l) => l.trim() && !GED_LINE.test(l));
    if (bad > 0) end = start + bad;
  }
  const body = lines.slice(start, end).map((l) => l.trim()).filter(Boolean);
  if (!closed) body.push('0 TRLR');

  // Отчёт — всё, кроме файла и черт блока кода вокруг него.
  let head = lines.slice(0, start);
  if (fenced) head = head.slice(0, head.findLastIndex((l) => FENCE.test(l)));
  let rest = end;
  if (fenced) {
    const j = lines.findIndex((l, i) => i >= end && FENCE.test(l));
    if (j >= 0 && lines.slice(end, j).every((l) => !l.trim())) rest = j + 1;
  }
  const report = [...head, ...lines.slice(rest)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { gedcom: `${body.join('\n')}\n`, report };
}

// ---------- Запрос помощнику ----------

// Промпт из docs/issledovanie.md. {who}, {faith}, {kin}, {goal} заполняет buildPrompt.
export const PROMPT = `Ты — помощник-генеалог. Помогаешь найти моих предков и родственников и собрать найденное
в файл для загрузки в семейное дерево «Древо».

ЧТО ИЗВЕСТНО
— Кого ищем: {who}
— Вероисповедание и национальность: {faith}
— Родители, братья и сёстры, супруги, дети: {kin}
— Что хочу узнать: {goal}

КАК РАБОТАТЬ
1. Если данных мало, сначала задай мне уточняющие вопросы: место до волости и уезда,
   вероисповедание, годы.
2. Составь план поиска: какие источники подходят для этой семьи, эпохи и места,
   в каком порядке их смотреть и что искать в каждом.
3. Если умеешь открывать сайты — ищи сам. Если нет — скажи, где и что искать мне
   и какой запрос вводить.
4. Ничего не придумывай. Каждое сведение — только с источником: название, архив и шифр
   (фонд, опись, дело, лист) или ссылка. Не нашёл — так и напиши. Отделяй найденное
   в документах от предположений.
5. Совпадения проверяй осторожно: тот же человек или однофамилец? Объясни почему.
6. О живых людях — только то, что сообщил я. Не ищи адреса и телефоны.
7. Учитывай разные написания имён: Ситдик/Ситдыйк/Сиддик, Габдулла/Абдулла,
   Ногман/Нугуман, Рафгат/Рәфгат; до 1928 года — арабская графика, в 1928–1939 — латиница.

ГДЕ ИСКАТЬ (выбери подходящее)
— Великая Отечественная: «Память народа», ОБД «Мемориал», «Подвиг народа»,
  «Бессмертный полк», книги памяти регионов.
— Репрессии: «Возвращённые имена», «Открытый список», книги памяти жертв репрессий.
— До 1917 года: ревизские сказки (1719–1858), перепись 1897 года, метрические книги
  (у мусульман — книги указных мулл с 1828 года), посемейные списки; для Татарстана —
  Главархив РТ, для Челябинска — ОГАЧО.
— После 1917 года: похозяйственные книги сельсоветов, запросы в ЗАГС,
  архивы вузов и предприятий.
— Сообщества: форум ВГД (vgd.ru), FamilySearch; деревья на MyHeritage и Geni —
  только как подсказка, не как источник.

РЕЗУЛЬТАТ
А) Короткий отчёт: что нашли, что не нашли, что делать дальше.
Б) Файл GEDCOM 5.5.1 в кодировке UTF-8 одним блоком кода — только найденное, с источниками:
— 0 HEAD / 1 CHAR UTF-8 / 1 GEDC / 2 VERS 5.5.1 / 2 FORM LINEAGE-LINKED; в конце 0 TRLR.
— Человек: 0 @I1@ INDI; 1 NAME Имя Отчество /Фамилия/; 2 GIVN Имя; 2 SURN Фамилия;
  2 _PATR Отчество (татарское тоже, например «Дәүләтшә кызы»).
  Девичья фамилия — второй 1 NAME Имя Отчество /Девичья/ с 2 TYPE birth. 1 SEX M или F.
— 1 BIRT, 1 DEAT, 1 BURI с 2 DATE и 2 PLAC — место полностью: «д. Урманче,
  Мамадышский уезд, Казанская губерния». Умер, дата неизвестна — 1 DEAT Y.
— Даты: 12 MAR 1890; ABT 1890 (около); BEF 1890 (до); AFT 1890 (после);
  BET 1880 AND 1885; FROM 1941 TO 1945; старый стиль — @#DJULIAN@ 12 MAR 1880.
— 1 OCCU род занятий. События: 1 EDUC учёба; 1 _MILT с 2 TYPE Война или
  2 TYPE Служба в армии; 1 RESI — переезд, место в 2 PLAC; 1 EVEN название
  с 2 TYPE Награда. Подробности — 2 NOTE.
— Заметки: 1 NOTE текст, следующие строки — 2 CONT.
— Семья: 0 @F1@ FAM; 1 HUSB @I1@; 1 WIFE @I2@; 1 CHIL @I3@; 1 MARR с 2 DATE и 2 PLAC; 1 DIV.
— Источник: 0 @S1@ SOUR; 1 TITL название; 1 ABBR шифр («ГА РТ, ф. 4, оп. 1, д. 2,
  л. 3 об.»); 1 _TYPE Метрическая книга; 1 NOTE ссылка.
— Ссылка на источник у сведения: 2 SOUR @S1@; 3 PAGE запись № 5;
  3 QUAY 3 — документ, 1 — со слов, 0 — предположение.
— Людей, которые уже есть в моём дереве, включай с теми же именами и годами:
  «Древо» само предложит, что это они, и новые связи встанут к ним.
— Предположения — только с QUAY 0 и заметкой «предположение: почему».`;

export const FAITH_UNKNOWN = 'не знаю — спроси меня, если это важно для поиска';
export const GOAL_EMPTY = 'всё, что удастся найти о нём и его предках';

const by = (sex, m, f, u) => (sex === 'F' ? f : sex === 'M' ? m : u);
// «д. Горки (сейчас: Тверская область, Старицкий район)».
const placeText = (text, now) => [text, now?.(text) && `(сейчас: ${now(text)})`].filter(Boolean).join(' ');

// Сведения о человеке для запроса. open — можно ли показывать даты и места (ушедший, старше 100 лет или отмечено «добавить даты живых»).
function facts(p, open, now) {
  if (!open) return [];
  const out = [];
  const life = (label, date, place) => {
    const t = [dateText(date), placeText(place, now)].filter(Boolean).join(', ');
    if (t) out.push(`${label}: ${t}`);
  };
  life(by(p.sex, 'родился', 'родилась', 'родился(ась)'), p.birth_date, p.birth_place);
  if (!p.living) life(by(p.sex, 'умер', 'умерла', 'умер(ла)'), p.death_date, p.death_place);
  if (!p.living && p.burial_place) out.push(`${by(p.sex, 'похоронен', 'похоронена', 'похоронен(а)')}: ${placeText(p.burial_place, now)}`);
  if (p.birth_surname && p.birth_surname !== p.surname) out.push(`фамилия при рождении: ${p.birth_surname}`);
  if (p.occupation) out.push(`род занятий: ${p.occupation}`);
  return out;
}

// Короткая строка о родном: «Смирнов Иван Фёдорович, 1860 – 1920» или у живого без дат: «Смирнова Анна Петровна (жива)».
function kinLine(p, open) {
  const alive = p.living ? ` (${by(p.sex, 'жив', 'жива', 'жив(а)')})` : '';
  if (!open) return `${fullName(p)}${alive}`;
  const extra = [lifespan(p), p.birth_place && `род. ${p.birth_place}`].filter(Boolean).join(', ');
  return `${fullName(p)}${extra ? `, ${extra}` : ''}${p.living ? alive : ''}`;
}

// Событие ленты жизни: «1941–1945 — Война: Калининский фронт, 30-я армия, рядовой, д. Ржев».
function eventLine(e) {
  const k = EVENT_KINDS[e.kind] || EVENT_KINDS.other;
  const what = e.kind !== 'other' || !k.main ? e.title : '';
  const tail = [what, e.unit, e.rank, e.place].filter(Boolean).join(', ');
  return `${e.date ? `${dateText(e.date)} — ` : ''}${eventTitle(e)}${tail ? `: ${tail}` : ''}`;
}

// Запрос помощнику о человеке p. idx — указатель дерева (buildIndex), events — его события ленты жизни,
// goal — «что хочу узнать», faith — вероисповедание и национальность, living — добавить даты и места живых,
// now(text) — как место называется сейчас (справочник мест). Живые моложе 100 лет (isPrivate) без living — только имя и кем приходится.
export function buildPrompt({ person: p, idx, events = [], goal = '', faith = '', living = false, now = null, year }) {
  const open = (x) => living || !isPrivate(x, year);
  const get = (id) => idx.persons.get(id);
  const indent = '\n  ';
  const self = [kinLine(p, open(p)), ...facts(p, open(p), now).map((x) => x[0].toUpperCase() + x.slice(1))];
  if (open(p) && events.length) self.push(`Из жизни: ${events.map(eventLine).join('; ')}`);

  const kin = [];
  for (const x of parentsOf(idx, p.id).map(get).filter(Boolean)) kin.push(`${by(x.sex, 'Отец', 'Мать', 'Родитель')}: ${kinLine(x, open(x))}`);
  for (const x of siblingsOf(idx, p.id).map(get).filter(Boolean)) kin.push(`${by(x.sex, 'Брат', 'Сестра', 'Брат или сестра')}: ${kinLine(x, open(x))}`);
  for (const s of spousesOf(idx, p.id)) {
    const x = s.spouseId && get(s.spouseId);
    if (!x) continue;
    const f = idx.families.get(s.familyId);
    // Дата и место брака — как у гостя: скрыты, если кто-то из пары живой.
    const both = open(p) && open(x);
    const word = f.kind === 'partners' ? 'вместе с' : 'брак';
    const when = both && (f.start_date || f.place) ? `; ${word} ${[dateText(f.start_date), f.place].filter(Boolean).join(', ')}` : '';
    const ended = f.ended === 'divorce' ? `; развод${both && f.end_date ? ` ${dateText(f.end_date)}` : ''}` : '';
    kin.push(`${by(x.sex, 'Муж', 'Жена', 'Супруг')}: ${kinLine(x, open(x))}${when}${ended}`);
  }
  for (const x of childrenOf(idx, p.id).map(get).filter(Boolean)) kin.push(`${by(x.sex, 'Сын', 'Дочь', 'Ребёнок')}: ${kinLine(x, open(x))}`);

  return PROMPT
    .replace('{who}', self.join(indent))
    .replace('{faith}', String(faith || '').trim() || FAITH_UNKNOWN)
    .replace('{kin}', kin.length ? indent + kin.join(indent) : 'пока ничего не известно')
    .replace('{goal}', String(goal || '').trim() || GOAL_EMPTY);
}
