// Вымышленная семья для проверки интерфейса и печати. Только для разработки:
//   node bin/demo.js   (очищает базу!)
import { pool, tx } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createInvite } from '../src/auth.js';
import { logChange } from '../src/changes.js';

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
const ivan = await P({ sex: 'M', surname: 'Смирнов', given: 'Иван', patronymic: 'Фёдорович', b: 'около 1880', d: '1942', place: 'д. Горки, Тверская губ.' });
const agr = await P({ sex: 'F', surname: 'Смирнова', given: 'Аграфена', patronymic: 'Петровна', birth_surname: 'Кузнецова', b: '1884', d: soon(7, 1976) });
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
await F(petr, klav, [yuri, lyuda], '1945');
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
// Обсуждение: Сергей писал давно, Елена — после его прошлого визита.
const say = (person, user, body, ago) => pool.query(
  'insert into comments (person_id, user_id, body, created_at) values ($1, $2, $3, now() - $4::interval)', [person, user, body, ago]);
await say(agr, u.id, 'Кто помнит, где стоял её дом в Горках?', '3 days');
await say(agr, ed.id, 'Дом стоял у колодца, напротив церкви.\nБабушка рассказывала, что окна были синие.', '2 hours');
await say(petr, ed.id, 'Дедушка Петя всю жизнь хранил письма с фронта от брата Василия. Они у мамы в шкатулке.', '1 hour');
const { url } = await createInvite({ role: 'owner', label: 'Сергей', forUser: u.id });
console.log(url);
await pool.end();
