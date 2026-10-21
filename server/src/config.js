import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const config = {
  port: Number(process.env.PORT || 8095),
  host: process.env.HOST || '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL || 'postgres://drevo:drevo@127.0.0.1:5432/drevo',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // По умолчанию — server/var, откуда бы ни запускали: сервер, тесты и bin/demo.js видят одни файлы.
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL('../var', import.meta.url)),
  webDir: process.env.WEB_DIR || path.resolve('../web/dist'),
  secureCookies: process.env.SECURE_COOKIES !== 'false',
};
