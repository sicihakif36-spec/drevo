// «Спросить у родных» (shared/asks.js — пределы и подсказки, routes/asks.js — маршруты).
// Сами вопросы и ответы — не правка дерева: в журнал не пишутся. А вот что делают с ответом —
// история, фото в альбом, запись в журнал поиска — обычные правки: одно действие в журнале, отменяется из «Последних правок».
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { logChange } from './changes.js';
import { HttpError, alive } from './tree.js';
import { createStory } from './stories.js';
import { createNote } from './research.js';
import { snapshot } from './album.js';
import { mediaPath } from './routes/media.js';

export const askPath = (id, thumb = false) => path.join(config.dataDir, 'ask', thumb ? `${id}.thumb` : id);

// Для запроса: отменено ли действие из колонки col вопроса a (и отмену не вернули).
export const undone = (col) => `exists (select 1 from changes c join changes r on r.id = c.reverted_by
  where c.op = a.${col} and r.reverted_by is null)`;

const short = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

// «Сохранить как историю»: текст ответа, запись голоса — в историю человека, фото — в его альбом.
// Файлы копируются: если сохранение отменят, ответ можно сохранить снова.
export async function saveStory(db, userId, a, files) {
  if (!(await alive(db, a.person_id))) throw new HttpError(404, 'Человек удалён. Сначала верните его.');
  const voice = files.find((f) => f.kind === 'audio');
  const photos = files.filter((f) => f.kind === 'photo');
  if (!a.answer && !voice && !photos.length) throw new HttpError(400, 'В ответе нечего сохранять');
  const copy = async (f) => {
    const mid = crypto.randomUUID();
    await fsp.copyFile(askPath(f.id), mediaPath(mid));
    if (f.thumb) await fsp.copyFile(askPath(f.id, true), mediaPath(mid, true));
    db.copied?.push(mid);
    return mid;
  };
  let story = null;
  if (a.answer || voice) {
    let audioId = null;
    if (voice) {
      audioId = await copy(voice);
      await db.q(`insert into media (id, kind, mime, bytes, name, duration, created_by) values ($1, 'audio', $2, $3, $4, $5, $6)`,
        [audioId, voice.mime, voice.bytes, voice.name, voice.duration, userId]);
    }
    const title = short(`${a.who}: ${a.question}`, 200);
    story = await createStory(db, userId, a.person_id, { title, date: '', body: a.answer || '', audio_id: audioId });
  }
  for (const f of photos) {
    const mid = await copy(f);
    const m = (await db.q(
      `insert into media (id, kind, mime, bytes, name, caption, date, thumb, created_by)
       values ($1, 'photo', $2, $3, $4, $5, '', $6, $7) returning *`,
      [mid, f.mime, f.bytes, f.name, short(`Прислал(а) ${a.who}`, 500), f.thumb, userId],
    ))[0];
    await db.q('insert into media_persons (media_id, person_id) values ($1, $2)', [mid, a.person_id]);
    await logChange(db, userId, 'media', mid, 'add', null, snapshot(m), [a.person_id]);
  }
  await db.q('update asks set story_op = $2 where id = $1', [a.id, db.op]);
  return story;
}

// «Записать в журнал поиска»: ответ — запись к вопросу исследования, из которого спрашивали.
export async function saveNote(db, userId, a) {
  if (!a.research_id) throw new HttpError(400, 'Этот вопрос задан не из исследования');
  if (!a.answer) throw new HttpError(400, 'В ответе нет текста — запишите в журнал поиска сами');
  const n = await createNote(db, userId, a.research_id, {
    result: '',
    place: short(`Спросили: ${a.who}`, 300),
    body: short(`Вопрос: ${a.question}\nОтвет: ${a.answer}`, 20000),
  });
  await db.q('update asks set note_op = $2 where id = $1', [a.id, db.op]);
  return n;
}
