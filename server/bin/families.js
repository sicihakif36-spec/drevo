// Семьи на сервере — для того, кто держит сервер (в приложении то же видно в «Главная → Семьи на сервере»).
//   node bin/families.js                       — список: номер, название, владельцы, люди, место
//   node bin/families.js delete abc123         — что будет удалено
//   node bin/families.js delete abc123 --yes   — удалить семью навсегда: дерево, входы, файлы
// Удалить можно только семью, вход в которую закрыт («Закрыть вход» в приложении). Главную — нельзя.
// Перед удалением сделайте копию: deploy/backup.sh.
import fsp from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { USED, dataDir, sizeText, tenantById, tenants, withTenant } from '../src/tenants.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { yes: { type: 'boolean', default: false } } });
await migrate(() => {});

const summary = (t) => withTenant(t, async () => (await q(
  `select (select value #>> '{}' from settings where key = 'title') as title,
     (select count(*)::int from persons where deleted_at is null) as persons,
     (select coalesce(string_agg(name, ', ' order by created_at), '') from users where role = 'owner' and not disabled) as owners,
     ${USED} as used`,
))[0]);

const [cmd, id] = positionals;
if (!cmd) {
  for (const t of tenants()) {
    const s = await summary(t);
    const place = `${sizeText(Number(s.used))}${t.quota_mb ? ` из ${sizeText(t.quota_mb * 1024 * 1024)}` : ''}`;
    console.log(`${t.main ? 'главная' : t.id}\t«${s.title}»\tвладельцы: ${s.owners || '—'}\tлюдей: ${s.persons}\tместо: ${place}${t.closed_at ? '\tвход закрыт' : ''}`);
  }
} else if (cmd === 'delete') {
  const t = tenantById(id || '');
  if (!t) {
    console.error(`Семьи «${id || ''}» нет. Список: node bin/families.js`);
    process.exitCode = 1;
  } else if (t.main) {
    console.error('Главную семью удалить нельзя');
    process.exitCode = 1;
  } else if (!t.closed_at) {
    console.error('Сначала закройте вход в эту семью: «Главная → Семьи на сервере → Закрыть вход»');
    process.exitCode = 1;
  } else {
    const s = await summary(t);
    if (!values.yes) {
      console.log(`Будет удалено навсегда: «${s.title}» (владельцы: ${s.owners || '—'}), ${s.persons} человек, файлы ${sizeText(Number(s.used))}.`);
      console.log(`Чтобы удалить, повторите с --yes. Перед этим сделайте копию: deploy/backup.sh`);
    } else {
      // Запись о семье и её схема — одной транзакцией; работающий сервер перечитает список сам.
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('delete from core.tenants where id = $1', [t.id]);
        await client.query(`drop schema ${t.schema} cascade`);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
      await fsp.rm(dataDir(t), { recursive: true, force: true });
      console.log(`Семья «${s.title}» удалена.`);
    }
  }
} else {
  console.error('Команды: без команды — список, delete <номер> [--yes] — удалить');
  process.exitCode = 1;
}
await pool.end();
