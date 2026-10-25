// Интервью голосом (shared/interview.js — темы и вопросы, routes/interviews.js — маршруты).
// Черновик — не правка дерева: в журнал не пишется. «Сохранить в истории» — обычная правка, одно действие в журнале:
// сводка «интервью» (entity 'interview', save — unsave), истории с голосом и фото в альбом. Отменяется из «Последних правок»,
// после отмены черновик можно сохранить снова: файлы копируются, а не переносятся.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './tenants.js';
import { logChange } from './changes.js';
import { HttpError, alive } from './tree.js';
import { createStory } from './stories.js';
import { snapshot } from './album.js';
import { mediaPath } from './routes/media.js';
import { hasAnswer, ivTitle } from '../../shared/interview.js';

export const ivPath = (id, thumb = false) => path.join(dataDir(), 'interview', thumb ? `${id}.thumb` : id);

// Для запроса: отменено ли сохранение интервью i (и отмену не вернули).
export const SAVED_UNDONE = `exists (select 1 from changes c join changes r on r.id = c.reverted_by
  where c.op = i.saved_op and r.reverted_by is null)`;

const short = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

// Ответы по вопросам: { qkey: { skipped, note, files } }.
export async function answersOf(db, ids) {
  const [answers, files] = await Promise.all([
    db.q('select interview_id, qkey, skipped, note from interview_answers where interview_id = any($1::uuid[])', [ids]),
    db.q(`select id, interview_id, qkey, kind, mime, bytes, name, thumb, duration from interview_files
          where interview_id = any($1::uuid[]) order by created_at, id`, [ids]),
  ]);
  const out = new Map(ids.map((id) => [id, {}]));
  const at = (iv, k) => (out.get(iv)[k] ??= { skipped: false, note: '', files: [] });
  for (const a of answers) Object.assign(at(a.interview_id, a.qkey), { skipped: a.skipped, note: a.note });
  for (const f of files) at(f.interview_id, f.qkey).files.push(f);
  return out;
}

// «Сохранить в истории». iv — строка интервью (под for update). Возвращает { stories, photos }.
export async function saveInterview(db, userId, iv) {
  if (!(await alive(db, iv.person_id))) throw new HttpError(404, 'Человек удалён. Сначала верните его.');
  const answers = (await answersOf(db, [iv.id])).get(iv.id);
  const list = iv.questions.map((x) => ({ ...x, a: answers[x.key] })).filter((x) => x.a && !x.a.skipped);
  const stories = list.filter((x) => hasAnswer(x.a));
  const photos = list.flatMap((x) => x.a.files.filter((f) => f.kind === 'photo').map((f) => ({ ...f, text: x.text })));
  if (!stories.length && !photos.length) throw new HttpError(400, 'В интервью пока нет ни одного ответа');
  const title = ivTitle(iv.created_at);
  // Сводка — первой: по ней «Последние правки» подписывают всё действие.
  await logChange(db, userId, 'interview', iv.id, 'save', null,
    { title, about: iv.about, stories: stories.length, photos: photos.length, op: db.op }, [iv.person_id]);
  const copy = async (f) => {
    const mid = crypto.randomUUID();
    await fsp.copyFile(ivPath(f.id), mediaPath(mid));
    if (f.thumb) await fsp.copyFile(ivPath(f.id, true), mediaPath(mid, true));
    db.copied?.push(mid);
    return mid;
  };
  let no = 0;
  for (const x of stories) {
    const voice = x.a.files.find((f) => f.kind === 'audio');
    let audioId = null;
    if (voice) {
      audioId = await copy(voice);
      await db.q(`insert into media (id, kind, mime, bytes, name, duration, created_by) values ($1, 'audio', $2, $3, $4, $5, $6)`,
        [audioId, voice.mime, voice.bytes, voice.name, voice.duration, userId]);
    }
    const s = await createStory(db, userId, iv.person_id, { title: short(x.text, 200), date: '', body: x.a.note, audio_id: audioId });
    await db.q('update stories set interview_id = $2, interview_no = $3 where id = $1', [s.id, iv.id, ++no]);
  }
  for (const f of photos) {
    const mid = await copy(f);
    const m = (await db.q(
      `insert into media (id, kind, mime, bytes, name, caption, date, thumb, created_by)
       values ($1, 'photo', $2, $3, $4, $5, '', $6, $7) returning *`,
      [mid, f.mime, f.bytes, f.name, short(`${title}: ${f.text}`, 500), f.thumb, userId],
    ))[0];
    await db.q('insert into media_persons (media_id, person_id) values ($1, $2)', [mid, iv.person_id]);
    await logChange(db, userId, 'media', mid, 'add', null, snapshot(m), [iv.person_id]);
  }
  await db.q('update interviews set saved_op = $2 where id = $1', [iv.id, db.op]);
  return { stories: stories.length, photos: photos.length };
}

// Обратная операция для сводки: сами истории и фото отменяются своими записями.
// Вернуть отменённое сохранение можно, только если интервью с тех пор не сохранили заново.
export async function undoInterview(db, userId, e) {
  if (e.action === 'save') return logChange(db, userId, 'interview', e.entity_id, 'unsave', e.after, null, e.persons);
  const iv = (await db.q('select saved_op from interviews where id = $1 for update', [e.entity_id]))[0];
  if (iv && iv.saved_op !== e.before?.op) throw new HttpError(409, 'Это интервью уже сохранили заново. Сначала отмените новое сохранение.');
  return logChange(db, userId, 'interview', e.entity_id, 'save', null, e.before, e.persons);
}
