// Первая ссылка-приглашение для владельца:
//   node bin/invite.js --role owner --name "Janay"
import { parseArgs } from 'node:util';
import { createInvite } from '../src/auth.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';

const { values } = parseArgs({ options: { role: { type: 'string', default: 'owner' }, name: { type: 'string', default: '' }, days: { type: 'string', default: '7' } } });
await migrate(() => {});
const { url } = await createInvite({ role: values.role, label: values.name, days: Number(values.days) });
console.log(`Ссылка для входа (${values.role}), действует ${values.days} дн., открывается один раз:\n${url}`);
await pool.end();
