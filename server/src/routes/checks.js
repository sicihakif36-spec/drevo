// Проверка дерева: находки считаются на телефоне по дереву (shared/checks.js), здесь — отметки «Всё верно» / «Это разные люди»
// и объединение дублей. Всё — только владельцу и участникам: в находках и отметках даты живых.
import { q, tx } from '../db.js';
import { need } from '../auth.js';
import { HttpError } from '../tree.js';
import { checkTree } from '../../../shared/checks.js';
import { mergePersons } from '../merge.js';

export async function treeData(db = { q }) {
  const [persons, families, children] = await Promise.all([
    db.q('select * from persons where deleted_at is null'),
    db.q('select * from families order by created_at'),
    db.q('select * from family_children'),
  ]);
  return { persons, families, children };
}

// Отметки с именем отметившего: { key, kind, persons, sig, user_id, user_name, at }.
export const listMarks = () => q(
  `select m.key, m.kind, m.persons, m.sig, m.user_id, u.name as user_name, m.at
   from check_marks m left join users u on u.id = m.user_id order by m.at desc`,
);

export default async function checkRoutes(app) {
  app.get('/api/checks/marks', { preHandler: need('editor') }, () => listMarks());

  // Отметить находку проверенной. Что именно отмечено (sig) — по данным на сервере, а не со слов телефона.
  app.post('/api/checks/marks', { preHandler: need('editor') }, async (req) => {
    const key = String(req.body?.key || '');
    const x = checkTree(await treeData()).find((f) => f.key === key);
    if (!x) throw new HttpError(404, 'Этой находки уже нет: данные исправлены');
    await q(
      `insert into check_marks (key, kind, persons, sig, user_id) values ($1, $2, $3, $4, $5)
       on conflict (key) do update set kind = excluded.kind, persons = excluded.persons, sig = excluded.sig, user_id = excluded.user_id, at = now()`,
      [x.key, x.kind, x.persons, x.sig, req.user.id],
    );
    return { ok: true };
  });

  // «Вернуть в проверку».
  app.delete('/api/checks/marks', { preHandler: need('editor') }, async (req) => {
    const r = await q('delete from check_marks where key = $1 returning key', [String(req.query?.key || '')]);
    if (!r.length) throw new HttpError(404, 'Отметка не найдена');
    return { ok: true };
  });

  // Объединить две карточки одного человека: { keep, remove, choice, photo, versions }.
  app.post('/api/merge', { preHandler: need('editor') }, async (req) => tx((db) => mergePersons(db, req.user.id, req.body || {})));
}
