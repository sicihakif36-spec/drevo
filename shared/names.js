// Имена, даты и родство: общие для сервера (печать) и телефона.

const MALE_ON_A = new Set(['илья', 'никита', 'фома', 'кузьма', 'савва', 'лука', 'фока', 'данила', 'гаврила', 'мина', 'иона', 'миша', 'саша', 'паша', 'гоша', 'коля', 'ваня', 'петя', 'вася', 'дима', 'серёжа', 'сережа', 'лёша', 'леша', 'вова', 'юра', 'женя']);

// ---------- Сравнение имён ----------
// Татарские буквы и ё — как русские: «Әминә» = «Амина». Одна функция для поиска, проверки дубликатов и загрузки из файла.
const TATAR = { 'ә': 'а', 'ө': 'о', 'ү': 'у', 'һ': 'х', 'җ': 'ж', 'ң': 'н', 'ё': 'е' };
export const TATAR_LETTERS = /[әөүһҗң]/i;
export const foldName = (s) => String(s ?? '').trim().toLowerCase().replace(/[әөүһҗңё]/g, (c) => TATAR[c]);
// Ещё грубее — для похожих написаний одного имени: Ренат и Ринат, Ильгамия и Илһамия, Ульфат и Өлфәт, Габдулла и Габдула.
// Гласные по созвучию, г/х/һ — одна буква, без ь и ъ, двойные буквы — одной.
export function looseName(s) {
  return foldName(s).replace(/дж/g, 'ж').replace(/[ьъ]/g, '').replace(/[оуюө]/g, 'у').replace(/[еиэыё]/g, 'и').replace(/я/g, 'а')
    .replace(/[гх]/g, 'х').replace(/(.)\1+/g, '$1').replace(/([хк])ий/g, '$1и');
}
// Одно ли это имя (фамилия, отчество) в разных написаниях. Пустое ни с чем не совпадает.
export const sameName = (a, b) => Boolean(looseName(a)) && looseName(a) === looseName(b);
// Отчество без окончания: «Закирович» и «Закир улы» — от одного имени.
const patronymicRoot = (s) => looseName(s).replace(/\s*(увич|увна|ивич|ивна|инична|ична|ич|кизи|ули|ухли)$/, '');
export const samePatronymic = (a, b) => sameName(a, b) || (Boolean(patronymicRoot(a)) && patronymicRoot(a) === patronymicRoot(b));
// Есть ли в тексте все слова запроса — для поиска людей: «амина» находит «Әминә», «ильгамия» — «Илһамия».
export function textHas(text, query) {
  const hay = looseName(text);
  return looseName(query).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
// Человек подходит под поиск: по фамилии, имени, отчеству, фамилии при рождении и второму написанию.
export const personHas = (p, query) => textHas(`${fullName(p)} ${p?.birth_surname || ''} ${altName(p)}`, query);

// ---------- Второе написание имени ----------
// Основное написание — как в семейной схеме (часто по-татарски), второе — как в документах (по-русски) или латиницей.
export const ALT_FIELDS = ['alt_surname', 'alt_given', 'alt_patronymic'];
export const altName = (p) => (p ? [p.alt_surname, p.alt_given, p.alt_patronymic].filter((x) => String(x || '').trim()).join(' ') : '');
// Как человек записан во втором написании: незаполненное — как в основном.
export const altPerson = (p) => ({ ...p, surname: p.alt_surname || p.surname, given: p.alt_given || p.given, patronymic: p.alt_patronymic || p.patronymic });
// Оба написания для сравнения: основное и, если есть, второе.
export const spellings = (p) => (altName(p) ? [p, altPerson(p)] : [p]);
const TATAR_PATRONYMIC = /\s(улы|углы|кызы|кзы)$/i;
// Записан ли человек по-татарски: татарские буквы или отчество «… улы» / «… кызы».
export const isTatarName = (p) => [p?.surname, p?.given, p?.patronymic].some((x) => TATAR_LETTERS.test(x || '')) || TATAR_PATRONYMIC.test(String(p?.patronymic || '').trim());
// Подпись второго написания по его буквам: «В документах» (русские буквы), «По-татарски», «Латиницей».
export function altLabel(p) {
  const s = altName(p);
  if (/[a-z]/i.test(s)) return 'Латиницей';
  if (isTatarName({ surname: p.alt_surname, given: p.alt_given, patronymic: p.alt_patronymic })) return 'По-татарски';
  return 'В документах';
}

// Татарские буквы — как в русских документах: Рәшит -> Рашит, Гыйльмия -> Гильмия, Гөлнара -> Гульнара, Һади -> Хади.
// ө в именах по-русски обычно у: Мөхәммәт -> Мухаммат, Төхфәт -> Тухфат, Өлфәт -> Ульфат.
const RU_LETTERS = { 'ә': 'а', 'ө': 'у', 'ү': 'у', 'һ': 'х', 'җ': 'ж', 'ң': 'н' };
function ruWord(w) {
  const low = w.toLowerCase()
    .replace(/өл(?=[бвгджзклмнпрстфхцчшщһҗң])/g, 'уль')
    .replace(/([гк])ый/g, '$1и')
    .replace(/[әөүһҗң]/g, (c) => RU_LETTERS[c]);
  // Заглавные — как были: по первой букве слова и частей через дефис.
  return low.replace(/(^|[-\s])(\S)/g, (m, a, c) => a + c.toUpperCase());
}
export const russianLetters = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).map(ruWord).join(' ');

// Татарское отчество -> русское: «Хәсән улы» -> «Хасанович», «Габдулла кызы» -> «Габдулловна», «Вәли улы» -> «Валиевич».
// Где русская форма неочевидна (имя отца на -а, кроме -улла, — «Муса», «Дәүләтшә»; на -у, -о, -е; женское имя) — пусто: пусть решит человек.
export function russianPatronymic(patronymic, sex) {
  const m = String(patronymic || '').trim().match(/^(.+?)\s+(улы|углы|кызы|кзы)$/i);
  if (!m) return TATAR_LETTERS.test(patronymic || '') ? russianLetters(patronymic) : String(patronymic || '').trim();
  const father = russianLetters(m[1]);
  if (/\s/.test(father)) return '';
  const f = /^к/i.test(m[2]) || sex === 'F';
  const low = father.toLowerCase();
  if (/лла$/.test(low)) return father.slice(0, -1) + (f ? 'овна' : 'ович');
  if (/[ауоыэеюё]$/.test(low)) return '';
  if (/и$/.test(low)) return father + (f ? 'евна' : 'евич');
  if (/я$/.test(low)) return '';
  return patronymicFrom(father, f ? 'F' : 'M');
}

// Подсказка второго написания по-русски: { alt_surname, alt_given, alt_patronymic }. Отчество пустое, если правило не подходит.
export function suggestRussian(p) {
  return {
    alt_surname: russianLetters(p.surname),
    alt_given: russianLetters(p.given),
    alt_patronymic: russianPatronymic(p.patronymic, p.sex),
  };
}

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
  const approx = /около|ок\.|~|приблиз|между|до |после|\?/.test(t) || /^(до|после)/.test(t);
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
  // Точная дата по старому стилю — по новому: «12.03.1890 ст. ст.» встаёт на 24 марта.
  const d = exactDate(text);
  if (d) return { year: d.year, key: d.year * 10000 + d.month * 100 + d.day };
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

// Старый стиль — юлианский календарь, в России до 31.01.1918 включительно; следующий день — 14.02.1918 нового стиля.
// В тексте даты — пометка «ст. ст.» в конце: «12.03.1890 ст. ст.». Без пометки дата читается как раньше — по новому стилю.
export const OLD_STYLE = 'ст. ст.';
const OLD_RE = /(?:^|\s)ст\.\s?ст\.?$/i;
export const isOldStyle = (text) => OLD_RE.test(String(text || '').trim());
// Поставить или снять пометку «ст. ст.».
export function withOldStyle(text, on) {
  const t = String(text || '').trim().replace(OLD_RE, '').trim();
  return on && t ? `${t} ${OLD_STYLE}` : t;
}
// Можно ли дате быть по старому стилю: есть год и он не позже 1918.
export function canBeOldStyle(text) {
  const y = String(text || '').match(/\d{3,4}/g);
  return Boolean(y) && y.every((x) => Number(x) <= 1918);
}

// Юлианский день (число дней от начала счёта) -> дата по новому стилю, и обратно для старого.
function julianDay(day, month, year) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
}
function gregorianFrom(jd) {
  const a = jd + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor(1461 * d / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return { day: e - Math.floor((153 * m + 2) / 5) + 1, month: m + 3 - 12 * Math.floor(m / 10), year: 100 * b + d - 4800 + Math.floor(m / 10) };
}
// Старый стиль -> новый: { day, month, year } -> { day, month, year }. Разница 10 дней в XVII веке, 11 в XVIII, 12 в XIX, 13 в XX.
export const toNewStyle = ({ day, month, year }) => gregorianFrom(julianDay(day, month, year));

// Точная дата «12.03.1890» -> { day, month, year }. Неточные («около 1890», «1890») — null.
// По старому стилю («12.03.1890 ст. ст.») — день по новому стилю, а как записано — в old: годовщины и порядок считаются по новому.
export function exactDate(text) {
  const t = String(text || '').trim();
  const old = isOldStyle(t);
  const m = (old ? t.replace(OLD_RE, '').trim() : t).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [day, month, year] = m.slice(1).map(Number);
  // В юлианском календаре високосный — каждый четвёртый год, и 1900-й тоже.
  const leap = old && month === 2 && year % 4 === 0;
  if (month < 1 || month > 12 || day < 1 || day > (leap ? 29 : daysInMonth(month, year))) return null;
  if (!old) return { day, month, year };
  // После 31.01.1918 старого стиля в России не было.
  if (year * 10000 + month * 100 + day > 19180131) return null;
  return { ...toNewStyle({ day, month, year }), old: { day, month, year } };
}

const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
// Дата для показа: по старому стилю — в обоих, «12 (24) марта 1890», «28 февраля (12 марта) 1890»,
// «25 декабря 1890 (6 января 1891)». Остальные — как записаны.
export function dateText(text) {
  const d = exactDate(text);
  if (!d?.old) return String(text || '').trim();
  const o = d.old;
  if (o.year !== d.year) return `${o.day} ${MONTHS_OF[o.month - 1]} ${o.year} (${d.day} ${MONTHS_OF[d.month - 1]} ${d.year})`;
  if (o.month !== d.month) return `${o.day} ${MONTHS_OF[o.month - 1]} (${d.day} ${MONTHS_OF[d.month - 1]}) ${d.year}`;
  return `${o.day} (${d.day}) ${MONTHS_OF[d.month - 1]} ${d.year}`;
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
  // Татарское имя отца — татарское отчество: «Дәүләтшә кызы», «Дәүләтшә улы».
  if (TATAR_LETTERS.test(n)) return `${n} ${f ? 'кызы' : 'улы'}`;
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
  if (/(вна|чна|кызы|кизи)$/.test(p)) return 'F';
  if (/(вич|ич|оглы|улы|углы)$/.test(p)) return 'M';
  const g = (given || '').trim().toLowerCase();
  if (!g) return 'U';
  if (MALE_ON_A.has(g)) return 'M';
  if (/[аяь]$/.test(g) && !/ь$/.test(g)) return 'F';
  if (/(любовь|нинель|адель|рахиль|юдифь|эсфирь)$/.test(g)) return 'F';
  return 'M';
}

// Родительный падеж имени с отчеством: «для Сергея Юрьевича». Фамилию не склоняем.
// Незнакомое окончание оставляем как есть: лучше несклонённое имя, чем исковерканное.
function wordGenitive(w, female) {
  const low = w.toLowerCase();
  const keep = (tail, n = 1) => w.slice(0, -n) + tail;
  if (/(вич|ич)$/.test(low)) return w + 'а';
  if (/на$/.test(low) && female) return keep('ы');
  const special = { 'пётр': 'Петра', 'петр': 'Петра', 'павел': 'Павла', 'лев': 'Льва' };
  if (!female && special[low]) return special[low];
  if (/[гкхжчшщ]а$/.test(low)) return keep('и');
  if (/а$/.test(low)) return keep('ы');
  if (/я$/.test(low)) return keep('и');
  if (female) return /ь$/.test(low) ? keep('и') : w;
  if (/[йь]$/.test(low)) return keep('я');
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(low)) return w + 'а';
  return w;
}
// Винительный: «Петра», «Илью», «Анну», «Любовь».
function wordAccusative(w, female) {
  const low = w.toLowerCase();
  if (/а$/.test(low)) return w.slice(0, -1) + 'у'; // Анну, Никиту
  if (/я$/.test(low)) return w.slice(0, -1) + 'ю'; // Марию, Илью
  return female ? w : wordGenitive(w, false);
}
const isFemale = (p) => (p.sex === 'U' || !p.sex ? guessSex(p.given, p.patronymic) : p.sex) === 'F';
// Татарские слова и отчества «Дәүләтшә кызы» не склоняем: лучше как записано, чем исковеркать.
const keepCase = (w) => TATAR_LETTERS.test(w) || /\s/.test(w);
function nameCase(p, word, patronymic) {
  if (!p?.given) return fullName(p);
  const female = isFemale(p);
  return [p.given, patronymic && p.patronymic].filter(Boolean).map((w) => (keepCase(w.trim()) ? w.trim() : word(w.trim(), female))).join(' ');
}
// Предложный: «о Петре», «об Анне», «о Марии», «о Любови», «о Сергее».
function wordPrepositional(w, female) {
  const low = w.toLowerCase();
  const special = { 'пётр': 'Петре', 'петр': 'Петре', 'павел': 'Павле', 'лев': 'Льве' };
  if (!female && special[low]) return special[low];
  if (/(ия|ий)$/.test(low)) return w.slice(0, -1) + 'и';
  if (/[ая]$/.test(low)) return w.slice(0, -1) + 'е';
  if (/(вич|ич)$/.test(low)) return w + 'е';
  if (female) return /ь$/.test(low) ? w.slice(0, -1) + 'и' : w;
  if (/[йь]$/.test(low)) return w.slice(0, -1) + 'е';
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(low)) return w + 'е';
  return w;
}
// «для Сергея Юрьевича»; short — только имя: «у Петра».
export const nameGenitive = (p, short = false) => nameCase(p, wordGenitive, !short);
// «Удалить Анну Петровну»; short — только имя: «Убрать Юрия».
export const nameAccusative = (p, short = false) => nameCase(p, wordAccusative, !short);
// «Рассказ о Петре»; short — только имя.
export const namePrepositional = (p, short = false) => nameCase(p, wordPrepositional, !short);

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

// Фамилия в родительном падеже: «Орлова» (Орлов), «Орловой» (Орлова), «Вяземского», «Вяземской».
// Незнакомое окончание — как есть («Шевченко», «Цой»): лучше несклонённая, чем исковерканная.
export function surnameGenitive(s, female) {
  const w = String(s || '').trim();
  if (!w) return '';
  if (w.includes('-')) return w.split('-').map((x) => surnameGenitive(x, female)).join('-');
  const low = w.toLowerCase();
  if (female) {
    if (/(ова|ева|ёва|ина|ына)$/.test(low)) return w.slice(0, -1) + 'ой';
    if (low.length > 4 && /ая$/.test(low)) return w.slice(0, -2) + 'ой';
    return w;
  }
  if (/(ов|ев|ёв|ин|ын)$/.test(low)) return w + 'а';
  // Короткие («Цой», «Бий») — как есть: это не прилагательные.
  if (low.length > 4 && /(ий|ый|ой)$/.test(low)) return w.slice(0, -2) + 'ого';
  return w;
}

// «Николая Орлова», «Анны Орловой»: имя и фамилия в родительном падеже (для «дочь Николая Орлова»).
export function shortGenitive(p) {
  if (!p) return '';
  const female = isFemale(p);
  const given = p.given ? wordGenitive(p.given.trim(), female) : '';
  return [given, surnameGenitive(p.surname, female)].filter(Boolean).join(' ') || fullName(p);
}

// «21 октября 2026 года» по Москве: сервер живёт по UTC.
export const todayText = (d = new Date()) => `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).replace(/\s*г\.$/, '')} года`;
