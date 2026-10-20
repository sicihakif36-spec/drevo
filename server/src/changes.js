export async function logChange(q, userId, entity, entityId, action, before, after) {
  const rows = await q(
    'insert into changes (user_id, entity, entity_id, action, before, after) values ($1, $2, $3, $4, $5, $6) returning id',
    [userId, entity, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null],
  );
  return rows[0].id;
}
