import path from 'node:path';

export const config = {
  port: Number(process.env.PORT || 8095),
  host: process.env.HOST || '127.0.0.1',
  databaseUrl: process.env.DATABASE_URL || 'postgres://drevo:drevo@127.0.0.1:5432/drevo',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),
  dataDir: process.env.DATA_DIR || path.resolve('var'),
  webDir: process.env.WEB_DIR || path.resolve('../web/dist'),
  secureCookies: process.env.SECURE_COOKIES !== 'false',
};
