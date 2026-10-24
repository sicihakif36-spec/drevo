// Владелец забыл пароль (или потерял телефон): сбросить пароль, выйти на всех его устройствах и дать новую ссылку
// для его же входа — по ней он придумает новый пароль. Дерево и права не меняются.
//   node bin/password.js                — если владелец один
//   node bin/password.js --name "Сергей" — если владельцев несколько
import { parseArgs } from 'node:util';
import { createInvite } from '../src/auth.js';
import { migrate } from '../src/migrate.js';
import { pool, tx } from '../src/db.js';

const { values } = parseArgs({ options: { name: { type: 'string', default: '' } } });
await migrate(() => {});
const owners = (await pool.query("select id, name from users where role = 'owner' and not disabled order by created_at")).rows;
const name = values.name.trim().toLowerCase();
const found = name ? owners.filter((u) => u.name.trim().toLowerCase() === name) : owners;
if (found.length !== 1) {
  console.error(found.length ? 'Владельцев несколько. Укажите имя:' : name ? `Владельца с именем «${values.name}» нет. Владельцы:` : 'Владельцев нет.');
  for (const u of owners) console.error(`  ${u.name}`);
  if (!owners.length) console.error('Первая ссылка владельца: deploy/invite.sh "Имя"');
  await pool.end();
  process.exit(1);
}
const [owner] = found;
await tx(async (db) => {
  await db.q('update users set password_hash = null where id = $1', [owner.id]);
  await db.q('delete from sessions where user_id = $1', [owner.id]);
  await db.q('delete from invites where for_user = $1 and used_at is null', [owner.id]);
});
const { url } = await createInvite({ role: 'owner', label: owner.name, forUser: owner.id });
console.log(`Пароль владельца «${owner.name}» сброшен, вход на всех его устройствах закрыт.
Откройте ссылку на своём телефоне (действует 3 дня, один раз) и придумайте новый пароль:
${url}`);
await pool.end();
