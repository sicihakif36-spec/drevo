// Обновления у всех сразу: GET /api/events — поток Server-Sent Events.
// Источник — NOTIFY из базы (migrations/005_events.sql): одно подключение с LISTEN на всё приложение,
// при обрыве переподключается. События без данных людей: tree — дерево изменилось, comments — новое в обсуждении,
// asks — в вопросах родным (гостям не шлётся).
// Гость не узнаёт об обсуждении живых: по событиям было бы видно, что там пишут.
import pg from 'pg';
import { config } from './config.js';
import { q } from './db.js';
import { need, sessionUser, ALIVE } from './auth.js';
import { isGuest, privateIds } from './privacy.js';

const GLUE = 300; // одно действие — несколько записей журнала: склеиваем в одно событие
const PING = 25000; // пустая строка, чтобы прокси не рвали молчащее соединение; заодно перепроверяем вход
const RETRY = 3000;

export function eventsPlugin(app, { ping = PING } = {}) {
  const streams = new Set();
  let client = null;
  let ready = null;
  let closed = false;
  let pending = null;
  let pinger = null;
  let retry = null;
  let waiting = 0; // запросы, которые ждут LISTEN: пока они есть, подключение не отпускаем

  function listen() {
    if (!ready) {
      const c = new pg.Client({ connectionString: config.databaseUrl });
      const lost = (err) => {
        if (client !== c) return;
        client = null;
        ready = null;
        c.end().catch(() => {});
        if (err) app.log.warn({ err }, 'обрыв LISTEN, переподключаюсь');
        // Пока связи не было, события потеряны: пусть телефоны перечитают всё.
        if (!closed && streams.size) retry = setTimeout(() => listen().then(() => push({ kind: 'tree' }, { kind: 'comments' }, { kind: 'asks' })).catch(() => {}), RETRY);
      };
      client = c;
      c.on('notification', (m) => { try { push(JSON.parse(m.payload)); } catch { /* чужое уведомление */ } });
      c.on('error', lost);
      c.on('end', () => lost());
      ready = c.connect().then(() => c.query('listen drevo'));
      ready.catch(lost);
    }
    return ready;
  }

  // Склеить события за GLUE мс и разослать.
  function push(...events) {
    if (!pending) {
      pending = new Map();
      setTimeout(flush, GLUE);
    }
    for (const e of events) pending.set(e.kind + (e.person_id || ''), e);
  }

  async function flush() {
    const events = [...pending.values()];
    pending = null;
    const guests = [...streams].some((s) => isGuest(s.user));
    // Не удалось узнать, кто живой, — гостям об обсуждениях не сообщаем вовсе.
    const hidden = guests && events.some((e) => e.person_id) ? await privateIds().then((ids) => new Set(ids), () => null) : new Set();
    for (const s of streams) {
      for (const { kind, ...data } of events) {
        if (isGuest(s.user) && data.person_id && (!hidden || hidden.has(data.person_id))) continue;
        // Вопросы родным гостю не видны вовсе.
        if (isGuest(s.user) && kind === 'asks') continue;
        s.raw.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    }
  }

  // Вышел или отключён — закрыть поток (телефон переподключится и получит 401); сменилась роль — учитывать новую.
  async function recheck() {
    const list = [...streams];
    if (!list.length) return;
    const rows = await q(
      `select s.token_hash, u.id, u.name, u.role, u.person_id, u.password_hash is not null as has_password
       from sessions s join users u on u.id = s.user_id
       where s.token_hash = any($1) and not u.disabled and not s.pending and ${ALIVE}`,
      [list.map((s) => s.session)],
    );
    const users = new Map(rows.map((r) => [r.token_hash, sessionUser(r)]));
    for (const s of list) {
      if (users.has(s.session)) s.user = users.get(s.session);
      else {
        streams.delete(s);
        s.raw.end();
      }
    }
  }

  function stop() {
    clearInterval(pinger);
    clearTimeout(retry);
    pinger = null;
    const c = client;
    client = null;
    ready = null;
    return c?.end().catch(() => {});
  }

  app.get('/api/events', { preHandler: need('viewer') }, async (req, reply) => {
    waiting++;
    try {
      await listen();
    } finally {
      waiting--;
    }
    reply.hijack();
    // Телефон ушёл, пока ждали подключения к базе.
    if (req.raw.socket.destroyed) {
      if (!streams.size) stop();
      return;
    }
    const s = { user: req.user, session: req.sessionHash, raw: reply.raw };
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    });
    // retry — через сколько телефон переподключится после обрыва.
    reply.raw.write(`retry: ${RETRY}\n\n`);
    streams.add(s);
    pinger ??= setInterval(() => {
      for (const x of streams) x.raw.write(':\n\n');
      recheck().catch((err) => app.log.warn({ err }, 'не удалось перепроверить вход'));
    }, ping);
    reply.raw.on('close', () => {
      streams.delete(s);
      // Никого не осталось — отпустить подключение к базе.
      if (!streams.size && !waiting) stop();
    });
  });

  app.addHook('preClose', async () => {
    closed = true;
    for (const s of streams) s.raw.end();
    streams.clear();
    await stop();
  });
}
