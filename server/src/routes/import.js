// «Ещё → Загрузить дерево из файла» — владелец и участники. Сначала файл присылается целиком и разбирается для предпросмотра
// (src/gedcom.js); он полежит на сервере сутки, пока загрузивший решает, кто из файла уже есть в дереве. Файл видит
// только тот, кто его прислал. Потом — загрузка одним действием (src/gedimport.js) по этому же файлу; отменить её
// может любой участник или владелец из «Последних правок», как любую правку.
// Ответ ИИ-помощника из «Исследования» (routes/research.js) идёт так же, но файл привязан к вопросу поиска,
// и после загрузки в журнал вопроса пишется запись о ней.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { dataDir } from '../tenants.js';
import { HttpError } from '../tree.js';
import { parseGedcom, MAX_BYTES } from '../gedcom.js';
import { previewGedcom, loadGedcom } from '../gedimport.js';
import { createNote } from '../research.js';

const DAY = 86400000;
const loading = new Set();
const dir = () => path.join(dataDir(), 'import');
const file = (id) => path.join(dir(), `${id}.ged`);
const meta = (id) => path.join(dir(), `${id}.json`);

// Файлы, которые так и не загрузили, — через сутки долой.
async function cleanup() {
  for (const f of await fsp.readdir(dir()).catch(() => [])) {
    const stat = await fsp.stat(path.join(dir(), f)).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > DAY) await fsp.rm(path.join(dir(), f), { force: true });
  }
}

// Только свой файл: чужие незагруженные файлы не видны никому, даже владельцу.
async function stored(id, user) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'Файл не найден');
  const m = JSON.parse(await fsp.readFile(meta(id), 'utf8').catch(() => 'null'));
  if (!m || m.user_id !== user.id) throw new HttpError(404, 'Файл уже загружен или устарел. Выберите его ещё раз.');
  return { ...m, buf: await fsp.readFile(file(id)) };
}

const treePersons = () => q('select id, sex, surname, given, patronymic, birth_surname, alt_surname, alt_given, alt_patronymic, birth_date, death_date, living from persons where deleted_at is null');

// Разобрать файл и оставить его на сутки для загрузки. extra — что запомнить вместе с ним (вопрос поиска, отчёт помощника).
export async function keepForImport(buf, name, user, extra = {}) {
  await cleanup();
  const g = parseGedcom(buf);
  if (!g.persons.length) throw new HttpError(400, 'В файле нет ни одного человека');
  const id = crypto.randomUUID();
  await fsp.mkdir(dir(), { recursive: true });
  await fsp.writeFile(file(id), buf);
  await fsp.writeFile(meta(id), JSON.stringify({ ...extra, name, user_id: user.id }));
  return { id, name, ...previewGedcom(g, await treePersons()) };
}

const count = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};

export default async function importRoutes(app) {
  app.post('/api/import', { preHandler: need('editor') }, async (req) => {
    const part = await req.file({ limits: { fileSize: MAX_BYTES } });
    if (!part) throw new HttpError(400, 'Выберите файл');
    let buf;
    try {
      buf = await part.toBuffer();
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, `Файл слишком большой: больше ${MAX_BYTES / 1024 / 1024} МБ.`);
      throw err;
    }
    const name = String(part.filename || 'файл.ged').slice(0, 200);
    if (!buf.length) throw new HttpError(400, 'Файл пустой');
    return keepForImport(buf, name, req.user);
  });

  // Решения по людям — только отличные от «новый»: у тысяч людей остальное подразумевается.
  app.post('/api/import/:id/load', { preHandler: need('editor'), bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const id = req.params.id;
    const m = await stored(id, req.user);
    // Двойное нажатие не загрузит файл дважды.
    if (loading.has(id)) throw new HttpError(409, 'Этот файл уже загружается, подождите');
    loading.add(id);
    const g = parseGedcom(m.buf);
    const started = Date.now();
    let res;
    try {
      res = await tx(async (db) => {
        db.importId = id;
        const out = await loadGedcom(db, req.user.id, g, req.body || {}, m.name);
        // Ответ помощника: запись в журнал вопроса — в том же действии, отмена загрузки убирает и её.
        const x = m.question_id && (await db.q('select 1 from research_questions where id = $1 and deleted_at is null', [m.question_id]))[0];
        if (x) {
          const what = [count(out.persons, 'новый человек', 'новых человека', 'новых человек'), out.matched && `${out.matched} дополнено`].filter(Boolean).join(', ');
          out.note = (await createNote(db, req.user.id, m.question_id, {
            result: 'found', place: 'Ответ ИИ-помощника', op: db.op,
            body: [`Загружено из ответа помощника: ${what}.`, m.report].filter(Boolean).join('\n\n').slice(0, 20000),
          })).id;
          out.question_id = m.question_id;
        }
        return out;
      });
    } finally {
      loading.delete(id);
    }
    req.log.info({ persons: g.persons.length, ms: Date.now() - started }, 'загрузка из файла');
    await fsp.rm(file(id), { force: true });
    await fsp.rm(meta(id), { force: true });
    return res;
  });

  // Передумал загружать.
  app.delete('/api/import/:id', { preHandler: need('editor') }, async (req) => {
    await stored(req.params.id, req.user);
    await fsp.rm(file(req.params.id), { force: true });
    await fsp.rm(meta(req.params.id), { force: true });
    return { ok: true };
  });
}
