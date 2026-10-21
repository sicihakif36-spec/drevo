// Полный архив «Скачать всё»: всё дерево одним ZIP — страховка семьи и перенос в другую программу.
// Внутри: дерево.ged с файлами, оригиналы фото, документов и записей голоса по папкам людей, истории текстом,
// index.html — страница, которая открывается без интернета, и прочтите.txt.
// Архив не собирается в памяти: archivePlan() только перечисляет файлы, а writeArchive() отдаёт их потоком по одному.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import yazl from 'yazl';
import { q } from './db.js';
import { mediaPath } from './routes/media.js';
import { loadTreeData } from './routes/print.js';
import { sourceData } from './routes/sources.js';
import { eventData } from './routes/timeline.js';
import { listPlaces } from './routes/places.js';
import { toGedcom } from './routes/export.js';
import { buildIndex, childrenOf, dateText, fullName, parentsOf, parseDate, spousesOf } from '../../shared/names.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/mpeg': 'mp3' };
const DIRS = { photo: 'Фото', doc: 'Документы', audio: 'Записи голоса' };
// Вид файла в GEDCOM (SOURCE_MEDIA_TYPE): снимок, документ, запись.
const GED_TYPE = { photo: 'photo', doc: 'manuscript', audio: 'audio' };

// Имя файла или папки, которое примут Windows, macOS, Linux и телефоны: без / \ : * ? " < > |, управляющих знаков,
// точек и пробелов по краям (на Mac и Linux имя с точкой спрячется, Windows их срезает), без CON, NUL, COM1 и т. п.
// Длина — в буквах: путь целиком должен уложиться в 260 знаков Windows.
export function safeName(text, fallback = 'без названия', max = 60) {
  let t = String(text ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ');
  t = [...t].slice(0, max).join('').replace(/^[\s.]+|[\s.]+$/g, '');
  if (!t) t = fallback;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(t)) t = `_${t}`;
  return t;
}

// Одинаковые имена не затирают друг друга: «фото.jpg», «фото (2).jpg». Сравнение без учёта регистра:
// на Windows и Mac «Фото» и «фото» — одно и то же.
export class Names {
  constructor() { this.taken = new Set(); }
  take(dir, base, ext = '') {
    const tail = ext ? `.${ext}` : '';
    for (let n = 1; ; n++) {
      const name = `${dir ? `${dir}/` : ''}${base}${n > 1 ? ` (${n})` : ''}${tail}`;
      if (!this.taken.has(name.toLowerCase())) {
        this.taken.add(name.toLowerCase());
        return name;
      }
    }
  }
}

// Годы жизни для папки и страницы: «1890–1960», «1890–…», «р. 1950».
function years(p) {
  const y = (d) => {
    const x = parseDate(d);
    return x?.year ? `${x.approx ? '~' : ''}${x.year}` : '';
  };
  const b = y(p.birth_date);
  const d = y(p.death_date);
  if (p.living) return b ? `р. ${b}` : '';
  return b || d ? `${b || '…'}–${d || '…'}` : '';
}

const stripExt = (name) => String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');

// Что кладётся в архив. entries — по порядку: { path, file, size, mtime } для файлов с диска, { path, buffer } для текстов.
export async function archivePlan(user) {
  const [tree, src, ev, places, media, stories, settings] = await Promise.all([
    loadTreeData(user, false), sourceData(user), eventData(user), listPlaces(),
    // Групповое фото лежит у первого отмеченного: у того, к кому его загрузили, потом — по порядку отметок в журнале.
    q(`select m.id, m.kind, m.mime, m.name, m.caption, m.date, m.created_at,
         array(select mp.person_id from media_persons mp join persons p on p.id = mp.person_id and p.deleted_at is null
               where mp.media_id = m.id
               order by (select min(c.id) from changes c where c.entity_id = m.id and c.entity = 'media'
                           and ((c.action = 'add' and c.persons[1] = mp.person_id)
                             or (c.action = 'tag' and c.after->>'person_id' = mp.person_id::text))) nulls last, mp.ctid) as persons
       from media m where m.deleted_at is null and m.kind in ('photo', 'doc') order by m.created_at, m.id`),
    q(`select s.id, s.title, s.date, s.body, s.created_at, u.name as user_name,
         a.id as audio_id, a.mime as audio_mime, a.created_at as audio_at,
         array(select sp.person_id from story_persons sp join persons p on p.id = sp.person_id and p.deleted_at is null
               where sp.story_id = s.id order by sp.ctid) as persons
       from stories s left join users u on u.id = s.created_by
       left join media a on a.id = s.audio_id and a.kind = 'audio' and a.deleted_at is null
       where s.deleted_at is null order by s.created_at, s.id`),
    q("select value from settings where key = 'title'"),
  ]);
  const title = settings[0]?.value || 'Семейное древо';
  const persons = [...tree.persons].sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru')
    || (parseDate(a.birth_date)?.year ?? 9999) - (parseDate(b.birth_date)?.year ?? 9999) || a.id.localeCompare(b.id));
  const data = { ...tree, persons, ...src, ...ev, places };
  const live = new Set(persons.map((p) => p.id));

  // Папка человека — одна для фото, документов, записей и историй; тёзки различаются годами, а если и они совпали — номером.
  const folders = new Names();
  const folder = new Map(persons.map((p) => [p.id, folders.take('', safeName(`${fullName(p)}${years(p) ? ` (${years(p)})` : ''}`, 'Без имени', 70))]));

  const names = new Names();
  const files = [];
  let missing = 0;
  const addFile = async (m, kind, owner, base) => {
    const st = await fsp.stat(mediaPath(m.id)).catch(() => null);
    if (!st?.isFile()) {
      missing++;
      return null;
    }
    const ext = EXT[m.mime] || 'bin';
    const f = { id: m.id, kind, size: st.size, mtime: m.created_at, file: mediaPath(m.id), ext,
      path: names.take(`${DIRS[kind]}/${folder.get(owner)}`, safeName(base, kind === 'photo' ? 'фото' : kind === 'doc' ? 'документ' : 'запись'), ext) };
    files.push(f);
    return f;
  };

  const objects = [];
  const fileOf = new Map();
  for (const m of media) {
    const tagged = m.persons.filter((id) => live.has(id));
    if (!tagged.length) continue;
    const f = await addFile(m, m.kind, tagged[0], m.caption || stripExt(m.name));
    if (!f) continue;
    fileOf.set(m.id, f);
    objects.push({ id: m.id, file: f.path, form: f.ext, type: GED_TYPE[m.kind], title: [m.caption, m.date].filter(Boolean).join(', '),
      persons: tagged, main: [], kind: m.kind });
  }
  // Главное фото у каждого отмеченного своё: ищем по человеку, а не по файлу.
  const photoOf = new Map(persons.filter((p) => p.photo_id && fileOf.has(p.photo_id)).map((p) => [p.id, fileOf.get(p.photo_id)]));
  for (const o of objects) o.main = o.persons.filter((id) => photoOf.get(id)?.id === o.id);

  const storyList = [];
  for (const s of stories) {
    const about = s.persons.filter((id) => live.has(id));
    if (!about.length) continue;
    const story = { ...s, persons: about, audio: null };
    if (s.audio_id) {
      story.audio = await addFile({ id: s.audio_id, mime: s.audio_mime, created_at: s.audio_at }, 'audio', about[0], s.title || 'запись');
      if (story.audio) objects.push({ id: s.audio_id, file: story.audio.path, form: story.audio.ext, type: 'audio', title: s.title, persons: about, kind: 'audio' });
    }
    storyList.push(story);
  }
  for (const s of storyList) {
    s.path = names.take(`Истории/${folder.get(s.persons[0])}`, safeName(s.title, 'история'), 'txt');
  }

  const stamp = new Date();
  const counts = {
    persons: persons.length,
    photos: files.filter((f) => f.kind === 'photo').length,
    docs: files.filter((f) => f.kind === 'doc').length,
    audio: files.filter((f) => f.kind === 'audio').length,
    stories: storyList.length,
    missing,
  };
  const ged = toGedcom({ ...data, objects, stories: storyList });
  const idx = buildIndex(data);
  const text = (s) => Buffer.from(`\ufeff${s.replace(/\r?\n/g, '\r\n')}`);
  const entries = [
    { path: 'прочтите.txt', buffer: text(readme(title, stamp, counts)) },
    { path: 'index.html', buffer: Buffer.from(indexHtml({ title, stamp, counts, persons, idx, objects, fileOf, photoOf, stories: storyList })) },
    { path: 'дерево.ged', buffer: Buffer.from(ged) },
    ...storyList.map((s) => ({ path: s.path, buffer: text(storyText(s, idx)) })),
    ...files,
  ];
  return { title, stamp, counts, files: files.length, entries };
}

// Примерный вес архива: файлы хранятся без сжатия (фото, PDF и MP3 уже сжаты), плюс заголовки ZIP.
export function planSize(plan) {
  return plan.entries.reduce((n, e) => n + (e.buffer ? e.buffer.length : e.size) + 200 + 2 * Buffer.byteLength(e.path), 22);
}

function storyText(s, idx) {
  const who = s.persons.map((id) => fullName(idx.persons.get(id))).join(', ');
  const head = [
    s.title || 'История',
    s.date && `Когда: ${dateText(s.date)}`,
    `О ком: ${who}`,
    s.user_name && `Записал(а): ${s.user_name}`,
    s.audio && `Запись голоса: ${s.audio.path}`,
  ].filter(Boolean).join('\n');
  return `${head}\n${s.body ? `\n${s.body.trimEnd()}\n` : ''}`;
}

const plural = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};
// «21 октября 2026 года» (по Москве: сервер живёт по UTC).
const dayText = (d) => `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).replace(/\s*г\.$/, '')} года`;

export function countsText(c) {
  return [plural(c.persons, 'человек', 'человека', 'человек'), plural(c.photos, 'фото', 'фото', 'фото'),
    plural(c.docs, 'документ', 'документа', 'документов'), plural(c.audio, 'запись голоса', 'записи голоса', 'записей голоса'),
    plural(c.stories, 'история', 'истории', 'историй')].join(', ');
}

function readme(title, stamp, c) {
  return `«${title}» — полный архив семейного древа

Собран ${dayText(stamp)}.
В архиве: ${countsText(c)}.
${c.missing ? `\n${plural(c.missing, 'файл не нашёлся', 'файла не нашлись', 'файлов не нашлись')} на сервере, их в архиве нет.\n` : ''}
Как открыть
1. Сначала распакуйте архив. На компьютере с Windows: правой кнопкой по архиву — «Извлечь всё».
   На Mac — двойной щелчок по архиву. На телефоне — в приложении «Файлы».
2. Откройте файл index.html двойным щелчком. Он откроется в браузере, интернет не нужен:
   список людей с фото, родителями, супругами, детьми, историями и документами.

Что где лежит
  index.html      — страница для просмотра всего дерева.
  дерево.ged      — всё дерево в формате GEDCOM, для других программ.
  Фото            — фотографии, по папкам людей. Общее фото лежит у одного человека, остальные ссылаются на него.
  Документы       — сканы и PDF, по папкам людей.
  Записи голоса   — рассказы голосом, MP3.
  Истории         — истории текстом.

Перенести в другую программу
Gramps, MyHeritage, «Древо Жизни» и другие умеют загружать GEDCOM: выберите в программе «Импорт» и файл дерево.ged.
Фото подхватятся, если дерево.ged лежит рядом с папками «Фото» и «Документы», как в этом архиве.

Храните копию архива в двух местах, например на компьютере и на флешке.
`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
// Ссылка на файл рядом со страницей: каждая часть пути — своим кодом, «/» остаются.
const href = (p) => p.split('/').map(encodeURIComponent).join('/');

function indexHtml({ title, stamp, counts, persons, idx, objects, fileOf, photoOf, stories }) {
  const num = new Map(persons.map((p, i) => [p.id, i + 1]));
  const link = (id) => (num.has(id) ? `<a href="#p${num.get(id)}">${esc(fullName(idx.persons.get(id)))}</a>` : '');
  const links = (ids) => ids.filter((id) => num.has(id)).map(link).join(', ');
  const byPerson = (list) => {
    const m = new Map();
    for (const x of list) for (const id of x.persons) m.set(id, m.get(id) || []).get(id).push(x);
    return m;
  };
  const objectsOf = byPerson(objects.filter((o) => o.kind !== 'audio'));
  const storiesOf = byPerson(stories);
  const cards = persons.map((p) => {
    const n = num.get(p.id);
    const life = years(p);
    const main = photoOf.get(p.id);
    const facts = [
      ['Родил' + (p.sex === 'F' ? 'ась' : 'ся'), [dateText(p.birth_date), p.birth_place].filter(Boolean).join(', ')],
      [p.sex === 'F' ? 'Умерла' : 'Умер', p.living ? '' : [dateText(p.death_date), p.death_place].filter(Boolean).join(', ')],
      ['Похоронен' + (p.sex === 'F' ? 'а' : ''), p.burial_place],
      ['Занятие', p.occupation],
      ['Фамилия при рождении', p.birth_surname && p.birth_surname !== p.surname ? p.birth_surname : ''],
    ].filter(([, v]) => v);
    const spouses = spousesOf(idx, p.id).map((s) => s.spouseId).filter(Boolean);
    const rel = [
      ['Родители', links(parentsOf(idx, p.id))],
      ['Супруги', links(spouses)],
      ['Дети', links(childrenOf(idx, p.id))],
    ].filter(([, v]) => v);
    const own = objectsOf.get(p.id) || [];
    const photos = own.filter((o) => o.kind === 'photo');
    const docs = own.filter((o) => o.kind === 'doc');
    const tales = storiesOf.get(p.id) || [];
    return `<section class="person" id="p${n}" data-name="${esc(fullName(p).toLowerCase())}">
<div class="head">${main ? `<img class="main" src="${href(main.path)}" alt="" loading="lazy">` : `<div class="main none">${esc((p.surname || p.given || '?')[0])}</div>`}
<div><h2>${esc(fullName(p))}</h2>${life ? `<div class="muted">${esc(life)}</div>` : ''}</div></div>
${facts.length || rel.length ? `<dl>${[...facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`), ...rel.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)].join('')}</dl>` : ''}
${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ''}
${photos.length ? `<h3>Фото</h3><div class="photos">${photos.map((o) => `<a href="${href(o.file)}"><img src="${href(o.file)}" alt="${esc(o.title)}" title="${esc(o.title)}" loading="lazy"></a>`).join('')}</div>` : ''}
${docs.length ? `<h3>Документы</h3><ul>${docs.map((o) => `<li><a href="${href(o.file)}">${esc(o.title || o.file.split('/').pop())}</a></li>`).join('')}</ul>` : ''}
${tales.length ? `<h3>Истории</h3>${tales.map((s) => `<details><summary>${esc(s.title || 'История')}${s.date ? ` <span class="muted">· ${esc(dateText(s.date))}</span>` : ''}</summary>
${s.body ? `<p class="notes">${esc(s.body)}</p>` : ''}${s.audio ? `<audio controls preload="none" src="${href(s.audio.path)}"></audio>` : ''}
<p class="small"><a href="${href(s.path)}">Текстом</a>${s.audio ? ` · <a href="${href(s.audio.path)}">Запись голоса</a>` : ''}</p></details>`).join('')}` : ''}
<p class="small"><a href="#top">↑ К списку</a></p>
</section>`;
  });
  const list = persons.map((p) => `<li data-name="${esc(fullName(p).toLowerCase())}"><a href="#p${num.get(p.id)}">${esc(fullName(p))}</a>${years(p) ? ` <span class="muted">${esc(years(p))}</span>` : ''}</li>`);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark; --bg: #faf7f2; --card: #fff; --text: #222; --muted: #6b645c; --line: #e3ddd3; --accent: #7a4e2d; }
@media (prefers-color-scheme: dark) { :root { --bg: #1b1a18; --card: #262422; --text: #eee; --muted: #a39d94; --line: #3a3733; --accent: #e0a878; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 16px; }
h1 { margin: 8px 0 4px; font-size: 28px; }
h2 { margin: 0; font-size: 21px; overflow-wrap: anywhere; }
h3 { margin: 16px 0 6px; font-size: 16px; color: var(--muted); }
a { color: var(--accent); }
.muted { color: var(--muted); }
.small { font-size: 14px; }
input { width: 100%; font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); }
ul.index { columns: 2 260px; padding-left: 20px; }
ul.index li { break-inside: avoid; }
.person { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin: 16px 0; }
.head { display: flex; gap: 14px; align-items: center; }
.main { width: 96px; height: 96px; object-fit: cover; border-radius: 12px; flex: none; }
.main.none { display: flex; align-items: center; justify-content: center; background: var(--line); font-size: 40px; color: var(--muted); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 12px 0 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.notes { white-space: pre-wrap; overflow-wrap: anywhere; }
.photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.photos img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; display: block; }
details { border-top: 1px solid var(--line); padding: 8px 0; }
summary { cursor: pointer; font-weight: 600; }
audio { width: 100%; margin-top: 6px; }
@media (max-width: 480px) { dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
@media print { .person { break-inside: avoid; } #find { display: none; } }
</style>
</head>
<body>
<main id="top">
<h1>${esc(title)}</h1>
<p class="muted">Полный архив семейного древа, собран ${esc(dayText(stamp))}. ${esc(countsText(counts))}.</p>
<p><input id="find" type="search" placeholder="Найти по имени" aria-label="Найти по имени"></p>
<ul class="index">${list.join('\n')}</ul>
${cards.join('\n')}
</main>
<script>
// Поиск по имени: прячет тех, кто не подходит. Без него страница тоже работает.
document.getElementById('find').addEventListener('input', function (e) {
  var t = e.target.value.trim().toLowerCase();
  document.querySelectorAll('[data-name]').forEach(function (el) { el.hidden = t !== '' && el.dataset.name.indexOf(t) < 0; });
});
</script>
</body>
</html>
`;
}

// yazl 3.3.1 заранее считает размер с записями ZIP64 в конце архива, как только оглавление больше 64 КБ
// (около тысячи файлов), а пишет их, только если оглавление больше 4 ГБ. Без поправки браузер ждёт лишние 76 байт
// и считает скачивание оборвавшимся. Оглавление считается так же, как в yazl; тест проверяет это на 3000 файлах.
function zip64Overcount(zip, size) {
  const dir = zip.entries.reduce((n, e) => n + 46 + e.utf8FileName.length + e.fileComment.length
    + (e.forceDosTimestamp ? 0 : 9) + (e.useZip64Format() ? 28 : 0), 0);
  const counted = dir >= 0xffff;
  const written = zip.entries.length >= 0xffff || dir >= 0xffffffff || size - dir - 76 - 22 >= 0xffffffff;
  return counted && !written ? 76 : 0;
}

// Отдаёт архив потоком в out. Файлы хранятся без сжатия, поэтому размер известен заранее (onSize — до первого байта).
// Читается один файл за раз, и только когда получатель готов принять ещё: память не растёт, сколько бы ни весили фото.
// Вернуть abort(): прервать, если получатель ушёл.
export function writeArchive(plan, out, { onSize, onError } = {}) {
  const zip = new yazl.ZipFile();
  let aborted = false;
  let current = null;
  zip.on('error', (err) => {
    if (!aborted) onError?.(err);
    aborted = true;
    current?.destroy();
    out.destroy(err);
  });
  for (const e of plan.entries) {
    if (e.buffer) {
      zip.addBuffer(e.buffer, e.path, { compress: false, mtime: plan.stamp });
      continue;
    }
    zip.addReadStreamLazy(e.path, { compress: false, size: e.size, mtime: e.mtime }, (cb) => {
      if (aborted) return cb(new Error('скачивание прервано'));
      current = fs.createReadStream(e.file);
      return cb(null, current);
    });
  }
  zip.end({}, (size) => onSize?.(size - zip64Overcount(zip, size)));
  zip.outputStream.pipe(out);
  return () => {
    aborted = true;
    current?.destroy();
  };
}
