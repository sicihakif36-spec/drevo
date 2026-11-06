// Источник — две ступени: документ (название, архив, фонд, опись, дело) и его страницы (лист, номер записи, скан, ссылка),
// см. shared/sources.js. Раньше каждая страница была отдельным источником, и название с шифром дела писались каждый раз.
// Здесь одинаковые источники собираются в один документ, а их листы и записи становятся его страницами.
// Одинаковые — с тем же названием (без оглядки на регистр, «ё», кавычки и пробелы) и тем же шифром; незаполненный
// фонд, опись или дело не мешают: страницу, где шифр не дописали, кладём к документу, где он есть.
// Лист и номер записи, вписанные в конец названия («…, 1913 г., л. 34 об., запись № 57»), переносятся в страницу.

const KINDS = ['metric', 'revision', 'confession', 'household', 'zags', 'military', 'pamyat', 'memorial', 'legend', 'other'];
const CIPHER = ['archive', 'fond', 'opis', 'delo'];

const plain = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"„“”']/g, '')
  .replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/[\s,.;:]+$/, '').trim();
const tidy = (t) => String(t || '').replace(/[\s,;:]+$/, '').trim();

// Хвосты названия: что это и куда переносится. Номер дела и т. п. — только цифры, чтобы «д. Горки» (деревня) осталось.
const TAILS = [
  [/(?:^|[\s,;])(?:л\.|лл\.|лист)\s*(\d+[а-яa-z]?)\s*(об\.?|оборот)?\s*$/i, (m, x) => ({ sheet: m[1], verso: Boolean(m[2]) || x.verso })],
  [/(?:^|[\s,;])(?:запись|зап\.|а\/з|актовая запись)\s*№?\s*(\d+[а-яa-z]?)\s*$/i, (m) => ({ record: m[1] })],
  [/(?:^|[\s,;])№\s*(\d+[а-яa-z]?)\s*$/i, (m) => ({ record: m[1] })],
  [/(?:^|[\s,;])(?:д\.|дело)\s*(\d[\dа-яa-z/-]*)\s*$/i, (m) => ({ delo: m[1] })],
  [/(?:^|[\s,;])(?:оп\.|опись)\s*(\d[\dа-яa-z/-]*)\s*$/i, (m) => ({ opis: m[1] })],
  [/(?:^|[\s,;])(?:ф\.|фонд)\s*((?:р-?)?\d[\dа-яa-z/-]*)\s*$/i, (m) => ({ fond: m[1] })],
];

// Лист, запись и шифр из конца названия — в пустые поля. Поле уже заполнено другим — дальше не трогаем.
export function peel(s) {
  const x = { ...s, title: String(s.title || '').trim() };
  for (let more = true; more;) {
    more = false;
    for (const [re, take] of TAILS) {
      const m = re.exec(x.title);
      if (!m) continue;
      const got = take(m, x);
      if (Object.entries(got).some(([k, v]) => typeof v === 'string' && x[k] && plain(x[k]) !== plain(v))) return x;
      Object.assign(x, got);
      x.title = tidy(x.title.slice(0, m.index));
      more = true;
      break;
    }
  }
  return x;
}

// Страница подходит к документу: вид тот же (или у одного «Другое»), шифр не спорит.
const fits = (d, s) => (d.kind === s.kind || d.kind === 'other' || s.kind === 'other')
  && CIPHER.every((f) => !plain(d[f]) || !plain(s[f]) || plain(d[f]) === plain(s[f]));

export function group(sources) {
  const docs = [];
  const byTitle = new Map();
  for (const raw of sources) {
    const s = peel(raw);
    const title = plain(s.title);
    const cipher = CIPHER.map((f) => plain(s[f])).join('|');
    let d = null;
    if (title) {
      d = (byTitle.get(title) || []).find((x) => fits(x, s));
    } else if (cipher !== '|||') {
      // Без названия — только с точно таким же шифром и видом.
      d = (byTitle.get(`#${s.kind}#${cipher}`) || [])[0];
    }
    if (!d) {
      d = { kind: s.kind, title: s.title, archive: '', fond: '', opis: '', delo: '', pages: [] };
      const key = title || (cipher !== '|||' ? `#${s.kind}#${cipher}` : null);
      if (key) byTitle.set(key, [...(byTitle.get(key) || []), d]);
      docs.push(d);
    }
    if (d.kind === 'other' && s.kind !== 'other') d.kind = s.kind;
    for (const f of CIPHER) if (!d[f] && s[f]) d[f] = s[f];
    d.pages.push(s);
  }
  return docs;
}

export default async function documents(client) {
  await client.query(`
    create table documents (
      id uuid primary key default gen_random_uuid(),
      kind text not null default 'other' check (kind in (${KINDS.map((k) => `'${k}'`).join(', ')})),
      title text not null default '',
      archive text not null default '',
      fond text not null default '',
      opis text not null default '',
      delo text not null default '',
      note text not null default '',
      created_by uuid references users(id),
      created_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    alter table sources add column document_id uuid references documents(id);
    alter table sources add column record text not null default ''; -- номер записи на странице
    create index sources_document on sources (document_id);
  `);
  const { rows } = await client.query('select * from sources order by created_at, id');
  for (const d of group(rows)) {
    const first = d.pages[0];
    // Удалённым документ становится, только если удалены все его страницы.
    const live = d.pages.some((p) => !p.deleted_at);
    const gone = live ? null : d.pages.map((p) => p.deleted_at).sort((a, b) => b - a)[0];
    const { rows: [doc] } = await client.query(
      `insert into documents (kind, title, archive, fond, opis, delo, created_by, created_at, deleted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [d.kind, d.title, d.archive, d.fond, d.opis, d.delo, first.created_by, first.created_at, gone],
    );
    for (const p of d.pages) {
      await client.query('update sources set document_id = $2, sheet = $3, verso = $4, record = $5 where id = $1',
        [p.id, doc.id, p.sheet || '', Boolean(p.verso), p.record || '']);
    }
  }
  await client.query(`
    alter table sources alter column document_id set not null;
    alter table sources drop column kind, drop column title, drop column archive, drop column fond, drop column opis, drop column delo;
  `);
}
