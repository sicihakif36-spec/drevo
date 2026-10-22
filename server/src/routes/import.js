// «Ещё → Загрузить дерево из файла» — только владелец. Сначала файл присылается целиком и разбирается для предпросмотра
// (src/gedcom.js); он полежит на сервере сутки, пока владелец решает, кто из файла уже есть в дереве. Потом — загрузка
// одним действием (src/gedimport.js) по этому же файлу.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { config } from '../config.js';
import { HttpError } from '../tree.js';
import { parseGedcom, MAX_BYTES } from '../gedcom.js';
import { previewGedcom, loadGedcom } from '../gedimport.js';

const DAY = 86400000;
const loading = new Set();
const dir = () => path.join(config.dataDir, 'import');
const file = (id) => path.join(dir(), `${id}.ged`);
const meta = (id) => path.join(dir(), `${id}.json`);

// Файлы, которые так и не загрузили, — через сутки долой.
async function cleanup() {
  for (const f of await fsp.readdir(dir()).catch(() => [])) {
    const stat = await fsp.stat(path.join(dir(), f)).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > DAY) await fsp.rm(path.join(dir(), f), { force: true });
  }
}

async function stored(id, user) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, 'Файл не найден');
  const m = JSON.parse(await fsp.readFile(meta(id), 'utf8').catch(() => 'null'));
  if (!m || m.user_id !== user.id) throw new HttpError(404, 'Файл уже загружен или устарел. Выберите его ещё раз.');
  return { ...m, buf: await fsp.readFile(file(id)) };
}

const treePersons = () => q('select id, sex, surname, given, patronymic, birth_surname, birth_date, death_date, living from persons where deleted_at is null');

export default async function importRoutes(app) {
  await fsp.mkdir(dir(), { recursive: true });

  app.post('/api/import', { preHandler: need('owner') }, async (req) => {
    await cleanup();
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
    const g = parseGedcom(buf);
    if (!g.persons.length) throw new HttpError(400, 'В файле нет ни одного человека');
    const id = crypto.randomUUID();
    await fsp.writeFile(file(id), buf);
    await fsp.writeFile(meta(id), JSON.stringify({ name, user_id: req.user.id }));
    return { id, name, ...previewGedcom(g, await treePersons()) };
  });

  // Решения по людям — только отличные от «новый»: у тысяч людей остальное подразумевается.
  app.post('/api/import/:id/load', { preHandler: need('owner'), bodyLimit: 4 * 1024 * 1024 }, async (req) => {
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
        return loadGedcom(db, req.user.id, g, req.body || {}, m.name);
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
  app.delete('/api/import/:id', { preHandler: need('owner') }, async (req) => {
    await stored(req.params.id, req.user);
    await fsp.rm(file(req.params.id), { force: true });
    await fsp.rm(meta(req.params.id), { force: true });
    return { ok: true };
  });
}
