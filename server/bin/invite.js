// Первая ссылка-приглашение для владельца:
//   node bin/invite.js --role owner --name "Janay"
//   node bin/invite.js --name "Ольга" --family abc123 — новый владелец другой семьи на сервере (номер — в node bin/families.js)
import { parseArgs } from 'node:util';
import { createInvite } from '../src/auth.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { mainTenant, tenantById, withTenant } from '../src/tenants.js';

const { values } = parseArgs({ options: { role: { type: 'string', default: 'owner' }, name: { type: 'string', default: '' }, days: { type: 'string', default: '3' }, family: { type: 'string', default: '' } } });
await migrate(() => {});
const tenant = values.family ? tenantById(values.family) : mainTenant();
if (!tenant) {
  console.error(`Семьи «${values.family}» на сервере нет. Список семей: node bin/families.js`);
  await pool.end();
  process.exit(1);
}
const { url } = await withTenant(tenant, () => createInvite({ role: values.role, label: values.name, days: Number(values.days) }));
console.log(`Ссылка для входа (${values.role}), действует ${values.days} дн., открывается один раз:\n${url}`);
await pool.end();
