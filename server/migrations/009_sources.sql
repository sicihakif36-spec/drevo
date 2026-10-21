-- Источники и достоверность (src/sources.js). Источник — отдельная запись, общая для многих людей:
-- одна метрическая книга подтверждает рождение нескольких. Удаление мягкое.
create table sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'other'
    check (kind in ('metric', 'revision', 'confession', 'household', 'zags', 'military', 'pamyat', 'memorial', 'legend', 'other')),
  title text not null default '',
  archive text not null default '', -- шифр дела: «ГАТО, ф. 160, оп. 1, д. 12, л. 34 об.»
  fond text not null default '',
  opis text not null default '',
  delo text not null default '',
  sheet text not null default '',
  verso boolean not null default false, -- оборот листа
  url text not null default '',
  media_id uuid references media(id), -- скан из альбома
  note text not null default '',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Сведение — subject (person или family; потом и событие хронологии), его id и что именно: birth_date, marriage…
-- Без внешнего ключа на subject_id: семья при отмене удаляется и возвращается с тем же id, привязки её дождутся.

-- Привязка источника к сведению; page — уточнение: номер записи, страница.
create table citations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id),
  subject text not null check (subject in ('person', 'family')),
  subject_id uuid not null,
  fact text not null,
  page text not null default '',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (subject, subject_id, fact, source_id)
);
create index citations_source on citations (source_id);

-- Достоверность сведения: ставится и без источника («со слов» бабушки).
create table fact_quality (
  subject text not null check (subject in ('person', 'family')),
  subject_id uuid not null,
  fact text not null,
  quality text not null check (quality in ('document', 'oral', 'guess')),
  primary key (subject, subject_id, fact)
);
