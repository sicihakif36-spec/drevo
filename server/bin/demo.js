// Вымышленная семья для проверки интерфейса и печати. Только для разработки:
//   node bin/demo.js   (очищает базу!)
// Печатает ссылку входа владельца Сергея и пароль демо: он же у участницы Елены.
import { pool, tx } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createInvite } from '../src/auth.js';
import { hashPassword } from '../src/password.js';
import { logChange } from '../src/changes.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { mediaPath } from '../src/routes/media.js';
import { toMp3 } from '../src/audio.js';
import { snapshot } from '../src/album.js';
import { snapshot as storySnapshot } from '../src/stories.js';
import { createSource, cite, setQuality } from '../src/sources.js';
import { createEvent } from '../src/timeline.js';
import { createPlace } from '../src/places.js';
import { demoImage, demoLetter, demoVoice } from './demo-media.js';

if (process.env.NODE_ENV === 'production') { console.error('Не запускайте на рабочей базе'); process.exit(1); }
await pool.query('drop schema public cascade; create schema public;');
await migrate(() => {});
const P = async (o) => (await pool.query(
  `insert into persons (sex, surname, given, patronymic, birth_surname, living, birth_date, birth_place, death_date)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
  [o.sex, o.surname || '', o.given, o.patronymic || '', o.birth_surname || '', o.living ?? false, o.b || '', o.place || '', o.d || ''],
)).rows[0].id;
const F = async (a, b, kids, start = '') => {
  const id = (await pool.query('insert into families (partner1, partner2, start_date) values ($1,$2,$3) returning id', [a, b, start])).rows[0].id;
  for (const k of kids) await pool.query('insert into family_children (family_id, child_id) values ($1,$2)', [id, k]);
  return id;
};
// Точная дата через n дней в году year: чтобы в ленте были видны ближайшие даты.
const soon = (n, year) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${year}`;
};
// У Ивана дата рождения по старому стилю: покажется как «12 (24) марта 1880».
const ivan = await P({ sex: 'M', surname: 'Смирнов', given: 'Иван', patronymic: 'Фёдорович', b: '12.03.1880 ст. ст.', d: '1942', place: 'д. Горки' });
const agr = await P({ sex: 'F', surname: 'Смирнова', given: 'Аграфена', patronymic: 'Петровна', birth_surname: 'Кузнецова', b: '1884', d: soon(7, 1976), place: 'г. Старица' });
const nik = await P({ sex: 'M', surname: 'Орлов', given: 'Николай', patronymic: 'Степанович', b: '1890', d: '1944' });
const pel = await P({ sex: 'F', surname: 'Орлова', given: 'Пелагея', patronymic: 'Ивановна', b: 'до 1895', d: '1971' });
const petr = await P({ sex: 'M', surname: 'Смирнов', given: 'Пётр', patronymic: 'Иванович', b: '12.06.1912', d: soon(0, 1985), place: 'д. Горки' });
const vas = await P({ sex: 'M', surname: 'Смирнов', given: 'Василий', patronymic: 'Иванович', b: '1915', d: '1943' });
const klav = await P({ sex: 'F', surname: 'Смирнова', given: 'Клавдия', patronymic: 'Николаевна', birth_surname: 'Орлова', b: '1918', d: '2001' });
const tam = await P({ sex: 'F', surname: 'Орлова', given: 'Тамара', patronymic: 'Николаевна', b: '1922', d: '2010' });
const yuri = await P({ sex: 'M', surname: 'Смирнов', given: 'Юрий', patronymic: 'Петрович', b: '1946', d: '2019', place: 'Калинин' });
const gal = await P({ sex: 'F', surname: 'Смирнова', given: 'Галина', patronymic: 'Андреевна', birth_surname: 'Белова', b: '1949', living: true });
const lyuda = await P({ sex: 'F', surname: 'Козлова', given: 'Людмила', patronymic: 'Петровна', birth_surname: 'Смирнова', b: '1950', living: true });
const sergey = await P({ sex: 'M', surname: 'Смирнов', given: 'Сергей', patronymic: 'Юрьевич', b: '1972', living: true, place: 'Тверь' });
const olga = await P({ sex: 'F', surname: 'Смирнова', given: 'Ольга', patronymic: 'Викторовна', b: '1975', living: true });
const elena = await P({ sex: 'F', surname: 'Петрова', given: 'Елена', patronymic: 'Юрьевна', birth_surname: 'Смирнова', b: soon(16, 1976), living: true });
const anna = await P({ sex: 'F', surname: 'Смирнова', given: 'Анна', patronymic: 'Сергеевна', b: soon(3, 1998), living: true });
const dmitry = await P({ sex: 'M', surname: 'Смирнов', given: 'Дмитрий', patronymic: 'Сергеевич', b: '2003', living: true });
const misha = await P({ sex: 'M', surname: 'Новиков', given: 'Михаил', patronymic: 'Андреевич', b: '2022', living: true });
const andrey = await P({ sex: 'M', surname: 'Новиков', given: 'Андрей', patronymic: 'Олегович', b: '1996', living: true });
await F(ivan, agr, [petr, vas]);
await F(nik, pel, [klav, tam]);
const petrKlav = await F(petr, klav, [yuri, lyuda], '1945');
await F(yuri, gal, [sergey, elena], '1970');
await F(sergey, olga, [anna, dmitry], '1997');
await F(andrey, anna, [misha], '2021');
// Ленту оба открывали вчера: правки Елены ниже — новые для Сергея.
const u = (await pool.query("insert into users (name, role, person_id, feed_seen_at) values ('Сергей', 'owner', $1, now() - interval '1 day') returning id", [sergey])).rows[0];
const ed = (await pool.query("insert into users (name, role, person_id, feed_seen_at) values ('Елена', 'editor', $1, now() - interval '1 day') returning id", [elena])).rows[0];
await tx(async (db) => {
  await db.q("update persons set birth_place = 'д. Горки', occupation = 'тракторист' where id = $1", [vas]);
  await logChange(db, ed.id, 'person', vas, 'update', { birth_place: '', occupation: '' }, { birth_place: 'д. Горки', occupation: 'тракторист' });
});
await tx(async (db) => {
  await db.q("update persons set notes = 'Пекла лучшие пироги в деревне.' where id = $1", [agr]);
  await logChange(db, ed.id, 'person', agr, 'update', { notes: '' }, { notes: 'Пекла лучшие пироги в деревне.' });
});
// Фото и документы. Групповое фото с живой Людмилой гостю не видно; свадебное и портрет — видны.
fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });
async function media(db, { image, pdf, kind = 'photo', caption, date, name, persons, user = u.id }) {
  const m = (await db.q(
    `insert into media (kind, mime, bytes, name, caption, date, thumb, created_by)
     values ($1, $2, 0, $3, $4, $5, $6, $7) returning *`,
    [kind, pdf ? 'application/pdf' : 'image/png', name, caption, date, Boolean(image), user],
  ))[0];
  if (image) {
    const { full, thumb } = demoImage(image);
    fs.writeFileSync(mediaPath(m.id), full);
    fs.writeFileSync(mediaPath(m.id, true), thumb);
  } else await demoLetter(mediaPath(m.id));
  await db.q('update media set bytes = $1 where id = $2', [fs.statSync(mediaPath(m.id)).size, m.id]);
  for (const p of persons) await db.q('insert into media_persons (media_id, person_id) values ($1, $2)', [m.id, p]);
  await logChange(db, user, 'media', m.id, 'add', null, snapshot(m), persons);
  return m.id;
}
let metrika;
await tx(async (db) => {
  const portrait = await media(db, { image: 'portrait', caption: 'Иван Фёдорович в молодости', date: 'около 1910', name: 'ivan.jpg', persons: [ivan] });
  const wedding = await media(db, { image: 'wedding', caption: 'Свадьба Петра и Клавдии', date: '1945', name: 'svadba.jpg', persons: [petr, klav] });
  metrika = await media(db, { image: 'scan', kind: 'doc', caption: 'Метрика Петра Ивановича', date: '1912', name: 'metrika.jpg', persons: [petr] });
  await db.q('update persons set photo_id = $1 where id = $2', [portrait, ivan]);
  await db.q('update persons set photo_id = $1 where id = $2', [wedding, petr]);
});
// Елена добавила одним действием групповое фото и письмо — новое в ленте у Сергея.
await tx(async (db) => {
  await media(db, { image: 'group', caption: 'Вся семья у дома в Горках', date: 'лето 1975', name: 'gorki.jpg', persons: [petr, klav, yuri, lyuda], user: ed.id });
  await media(db, { pdf: true, kind: 'doc', caption: 'Письмо Василия с фронта', date: 'март 1942', name: 'pismo.pdf', persons: [vas, petr], user: ed.id });
});
// Истории. Рассказ о войне с записью голоса — гостю виден; про летние приезды (с живой Людмилой) — нет.
async function story(db, { title, date, body, persons, voice, user = u.id }) {
  let audio = null;
  if (voice) {
    // Как с телефона: запись переводится в MP3 тем же ffmpeg, длительность — от него.
    const wav = `${mediaPath('demo-voice')}.wav`;
    fs.writeFileSync(wav, demoVoice(voice));
    audio = crypto.randomUUID();
    const sec = await toMp3(wav, mediaPath(audio)).finally(() => fs.rmSync(wav, { force: true }));
    await db.q("insert into media (id, kind, mime, bytes, name, duration, created_by) values ($1, 'audio', 'audio/mpeg', $2, 'golos.mp3', $3, $4)",
      [audio, fs.statSync(mediaPath(audio)).size, sec, user]);
  }
  const s = (await db.q('insert into stories (title, date, body, audio_id, created_by) values ($1, $2, $3, $4, $5) returning *',
    [title, date, body, audio, user]))[0];
  for (const p of persons) await db.q('insert into story_persons (story_id, person_id) values ($1, $2)', [s.id, p]);
  await logChange(db, user, 'story', s.id, 'add', null, storySnapshot(s), persons);
}
await tx((db) => story(db, {
  title: 'Как дед Пётр уходил на фронт', date: 'лето 1941', persons: [petr, vas], voice: 20,
  body: 'Бабушка Клава рассказывала: провожали всей деревней, у правления. Пётр обещал вернуться к покосу, а вернулся только в сорок пятом.\n\nВасилий ушёл через год и писал письма до весны сорок третьего.',
}));
await tx((db) => story(db, {
  title: 'Лето в Горках', date: '1960-е', persons: [klav, lyuda], user: ed.id,
  body: 'Каждое лето Людмилу отправляли к бабушке в Горки. Ходили за земляникой, а вечером пили чай на крыльце.',
}));
// Источники. Метрика Петра со сканом из альбома; «Память народа» о Василии (добавила Елена — новое для Сергея);
// семейное предание — общий источник для Ивана и Аграфены. Брак Петра и Клавдии — «со слов», без источника.
const person = (id, fact) => ({ subject: 'person', subject_id: id, fact });
await tx(async (db) => {
  const s = await createSource(db, u.id, { kind: 'metric', title: 'Метрическая книга Троицкой церкви с. Горки, 1912',
    archive: 'ГАТО', fond: '160', opis: '1', delo: '12', sheet: '34', verso: true, media_id: metrika });
  for (const fact of ['birth_date', 'birth_place']) {
    await cite(db, u.id, { source_id: s.id, ...person(petr, fact), page: 'запись № 57' });
    await setQuality(db, u.id, person(petr, fact), 'document');
  }
});
await tx(async (db) => {
  const s = await createSource(db, u.id, { kind: 'legend', title: 'Рассказы бабушки Клавдии',
    note: 'Записано со слов Клавдии Николаевны летом 1995 года в Горках.' });
  await cite(db, u.id, { source_id: s.id, ...person(ivan, 'birth_place') });
  await cite(db, u.id, { source_id: s.id, ...person(agr, 'name'), page: 'девичья фамилия' });
  await setQuality(db, u.id, person(ivan, 'birth_place'), 'oral');
  await setQuality(db, u.id, person(ivan, 'birth_date'), 'guess');
  await setQuality(db, u.id, { subject: 'family', subject_id: petrKlav, fact: 'marriage' }, 'oral');
});
await tx(async (db) => {
  const s = await createSource(db, ed.id, { kind: 'pamyat', title: 'Донесение о безвозвратных потерях',
    url: 'https://pamyat-naroda.ru/', archive: 'ЦАМО', fond: '58', opis: '18001', delo: '1234', sheet: '56' });
  await cite(db, ed.id, { source_id: s.id, ...person(vas, 'death_date'), page: 'строка 14' });
  await setQuality(db, ed.id, person(vas, 'death_date'), 'document');
});
// Лента жизни. Война и награда Петра — с источником; переезд в Калинин всей семьёй (с живой Людмилой — гостю не виден);
// учёба Юрия добавлена Еленой — новое для Сергея.
await tx(async (db) => {
  const war = await createEvent(db, u.id, [petr], { kind: 'war', date: '1941–1945', title: 'Великая Отечественная, Калининский фронт',
    unit: '243-я стрелковая дивизия', rank: 'старший сержант', body: 'Ушёл добровольцем летом 1941-го. Был ранен под Ржевом, после госпиталя вернулся в часть.' });
  const award = await createEvent(db, u.id, [petr], { kind: 'award', date: '05.1943', title: 'Медаль «За отвагу»', place: 'под Ржевом',
    body: 'За то, что вынес с поля боя раненого командира взвода.' });
  const s = await createSource(db, u.id, { kind: 'pamyat', title: 'Наградной лист', url: 'https://pamyat-naroda.ru/',
    archive: 'ЦАМО', fond: '33', opis: '682524', delo: '213', sheet: '87' });
  for (const id of [war.id, award.id]) {
    await cite(db, u.id, { source_id: s.id, subject: 'event', subject_id: id, fact: 'event' });
    await setQuality(db, u.id, { subject: 'event', subject_id: id, fact: 'event' }, 'document');
  }
});
await tx(async (db) => {
  await createEvent(db, u.id, [petr], { kind: 'study', date: 'с 1926 по 1929', title: 'школа крестьянской молодёжи', place: 'с. Горки' });
  await createEvent(db, u.id, [petr], { kind: 'work', date: 'с 1946 по 1972', title: 'завод «Пролетарка», мастер цеха', place: 'г. Калинин' });
  await createEvent(db, u.id, [petr, klav, yuri, lyuda], { kind: 'move', date: 'около 1952', place: 'г. Калинин', title: 'из д. Горки',
    body: 'Дали комнату в бараке на Пролетарке, через пять лет — квартиру.' });
  await createEvent(db, u.id, [vas], { kind: 'army', date: '1937–1939', place: 'Ленинградский военный округ', rank: 'рядовой' });
});
await tx((db) => createEvent(db, ed.id, [yuri], { kind: 'study', date: '1963–1968', title: 'Калининский политехнический институт',
  place: 'г. Калинин', body: 'Инженер-механик, учился на вечернем, днём работал на заводе.' }));
// Справочник мест: «д. Горки» и «г. Старица» в карточках станут полными старыми названиями.
await tx(async (db) => {
  await createPlace(db, u.id, { kind: 'village', name: 'Горки', volost: 'Ивановская', uezd: 'Старицкий', gubernia: 'Тверская',
    now: 'Старицкий район, Тверская область', note: 'Церковь Троицы, приход села Горки.' }, 'д. Горки');
  await createPlace(db, u.id, { kind: 'town', name: 'Старица', uezd: 'Старицкий', gubernia: 'Тверская', now: 'г. Старица, Тверская область' }, 'г. Старица');
});
// Родственница: видит всё, обсуждает, не правит.
await pool.query("insert into users (name, role, feed_seen_at) values ('Бабушка Валя', 'relative', now() - interval '1 day')");
// Обсуждение: Сергей писал давно, Елена — после его прошлого визита.
const say = (person, user, body, ago) => pool.query(
  'insert into comments (person_id, user_id, body, created_at) values ($1, $2, $3, now() - $4::interval)', [person, user, body, ago]);
await say(agr, u.id, 'Кто помнит, где стоял её дом в Горках?', '3 days');
await say(agr, ed.id, 'Дом стоял у колодца, напротив церкви.\nБабушка рассказывала, что окна были синие.', '2 hours');
await say(petr, ed.id, 'Дедушка Петя всю жизнь хранил письма с фронта от брата Василия. Они у мамы в шкатулке.', '1 hour');
// Пароль владельца и участницы — как у настоящих: при входе по ссылке его спросят.
const DEMO_PASSWORD = 'drevo-demo';
await pool.query('update users set password_hash = $1 where id = any($2)', [await hashPassword(DEMO_PASSWORD), [u.id, ed.id]]);
const { url } = await createInvite({ role: 'owner', label: 'Сергей', forUser: u.id });
console.log(url);
console.log(`Пароль: ${DEMO_PASSWORD}`);
await pool.end();
