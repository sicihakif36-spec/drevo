// Перед каждым файлом тестов (npm test, --import): других семей на сервере нет — тесты, как и раньше, очищают базу целиком.
// Главную семью каждый файл очищает сам (drop schema public); здесь — семьи, оставшиеся от families.test.js или демо.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from '../src/config.js';

const db = new pg.Client({ connectionString: config.databaseUrl });
await db.connect();
try {
  if ((await db.query("select to_regclass('core.tenants') as t")).rows[0].t) {
    for (const t of (await db.query('select id, schema from core.tenants where not main')).rows) {
      await db.query(`drop schema if exists ${t.schema} cascade`);
      fs.rmSync(path.join(config.dataDir, 'families', t.id), { recursive: true, force: true });
    }
    await db.query('delete from core.tenant_links');
    await db.query('delete from core.tenants where not main');
  }
} finally {
  await db.end();
}
